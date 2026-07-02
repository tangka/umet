#!/usr/bin/env node
import { createServer } from "node:net";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash, verify } from "node:crypto";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(SCRIPT_DIR, "..");
const BUNDLED_EXTENSION_DIR = join(PLUGIN_ROOT, "assets/chrome-extension/chrome-mv3");
const DEFAULT_WORKSPACE = join(homedir(), "Code/temu");
const VERSION = "0.1.1";
const LICENSE_PRODUCT = "temu-ai-workbench";
const LICENSE_HOME = process.env.TEMU_WORKBENCH_HOME ?? join(homedir(), ".umet", "temu-ai-workbench");
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAJJbQCau6VGD3/++ShztgZNF1STmtHkyIpOLA4uUEnj8=
-----END PUBLIC KEY-----`;
const LICENSE_CONTACT = {
  message: "联系 Umet 服务方获取机器授权码",
};
const LICENSE_FEATURE_BY_COMMAND = {
  capture: "capture",
  dashboard: "dashboard",
  listing: "listing",
  package: "package",
  smoke: "smoke",
};

function parseArgs(argv) {
  const parsed = { command: "help", flags: {}, positionals: [] };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) parsed.command = rest.shift();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...value] = arg.slice(2).split("=");
      parsed.flags[key] = value.join("=");
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rest[index + 1];
      if (next && !next.startsWith("--")) {
        parsed.flags[key] = next;
        index += 1;
      } else {
        parsed.flags[key] = "1";
      }
    } else {
      parsed.positionals.push(arg);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`temu-workbench ${VERSION}

Usage:
  temu-workbench license status
  temu-workbench license machine-id
  temu-workbench license request
  temu-workbench license import <license.json>
  temu-workbench doctor [--workspace=/path/to/temu]
  temu-workbench install [--workspace=/path/to/temu]
  temu-workbench extension [--workspace=/path/to/temu] [--open-chrome]
  temu-workbench capture [--workspace=/path/to/temu]
  temu-workbench dashboard [--workspace=/path/to/temu]
  temu-workbench listing --offer-id=<1688OfferId> [--declaration-price-cny=<n>] [--workspace=/path/to/temu]
  temu-workbench package [--workspace=/path/to/temu]
  temu-workbench smoke [--workspace=/path/to/temu]

Environment:
  TEMU_WORKSPACE=/path/to/temu
  TEMU_WORKBENCH_LICENSE_FILE=/path/to/license.json
`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function licensePath() {
  return process.env.TEMU_WORKBENCH_LICENSE_FILE ?? join(LICENSE_HOME, "license.json");
}

function machineId() {
  let username = process.env.USER || process.env.USERNAME || "unknown";
  try {
    username = userInfo().username || username;
  } catch {
    // userInfo can fail in restricted shells; environment fallback is enough for a stable machine code.
  }
  return createHash("sha256")
    .update([hostname(), username, homedir()].join("|"))
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

function licenseStatus(requiredFeature) {
  const file = licensePath();
  const id = machineId();
  if (!existsSync(file)) return { valid: false, path: file, machineId: id, reason: "missing_license" };

  let license;
  try {
    license = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { valid: false, path: file, machineId: id, reason: "invalid_json" };
  }

  const signature = typeof license.signature === "string" ? license.signature : "";
  const payload = { ...license };
  delete payload.signature;
  const features = Array.isArray(license.features) ? license.features.filter((item) => typeof item === "string") : [];
  const base = {
    valid: false,
    path: file,
    machineId: id,
    customer: typeof license.customer === "string" ? license.customer : undefined,
    licenseId: typeof license.licenseId === "string" ? license.licenseId : undefined,
    expiresAt: typeof license.expiresAt === "string" ? license.expiresAt : undefined,
    features,
  };

  if (license.product !== LICENSE_PRODUCT) return { ...base, reason: "wrong_product" };
  if (!signature) return { ...base, reason: "missing_signature" };

  let signatureValid = false;
  try {
    signatureValid = verify(null, Buffer.from(canonicalJson(payload)), LICENSE_PUBLIC_KEY, Buffer.from(signature, "base64"));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { ...base, reason: "bad_signature" };

  const expiresMs = typeof license.expiresAt === "string" ? Date.parse(license.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresMs)) return { ...base, reason: "invalid_expires_at" };
  if (expiresMs < Date.now()) return { ...base, reason: "expired" };

  if (typeof license.machineId === "string" && license.machineId && license.machineId !== id) {
    return { ...base, reason: "machine_mismatch" };
  }

  if (requiredFeature && !features.includes("*") && !features.includes(requiredFeature)) {
    return { ...base, reason: `feature_not_enabled:${requiredFeature}` };
  }

  return { ...base, valid: true };
}

function requireLicense(feature) {
  const status = licenseStatus(feature);
  if (status.valid) return;
  throw new Error(
    [
      `未导入有效授权，功能已停止: ${feature}`,
      `原因: ${status.reason ?? "unknown"}`,
      `机器码: ${status.machineId}`,
      "获取: temu-workbench license request，然后把 machineId 发给 Umet 服务方",
      "导入: temu-workbench license import /path/to/license.json",
    ].join("\n"),
  );
}

function parseLicenseCode(code) {
  const trimmed = code.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function writeLicense(license) {
  mkdirSync(dirname(licensePath()), { recursive: true });
  writeFileSync(licensePath(), `${JSON.stringify(license, null, 2)}\n`, { mode: 0o600 });
  chmodSync(licensePath(), 0o600);
}

function printLicenseHelp() {
  console.log(`temu-workbench license

Usage:
  temu-workbench license status
  temu-workbench license machine-id
  temu-workbench license request
  temu-workbench license import <license.json>
  temu-workbench license import --code=<machine-auth-code>
`);
}

function licenseCommand(positionals, flags) {
  const action = positionals[0] || "status";
  if (action === "help" || flags.help || flags.h) return printLicenseHelp();
  if (action === "status") return printJson(licenseStatus());
  if (action === "machine-id" || action === "machine-code") return printJson({ machineId: machineId() });
  if (action === "request") {
    return printJson({
      product: LICENSE_PRODUCT,
      version: VERSION,
      machineId: machineId(),
      licensePath: licensePath(),
      contact: LICENSE_CONTACT,
      message: "请把 machineId 发给 Umet 服务方获取机器授权码或 license.json",
    });
  }
  if (action === "import") {
    if (flags.code) {
      writeLicense(parseLicenseCode(flags.code));
      return printJson(licenseStatus());
    }
    const src = positionals[1] || flags.file;
    if (!src) throw new Error("Missing license file");
    if (!existsSync(src)) throw new Error(`License file not found: ${src}`);
    mkdirSync(dirname(licensePath()), { recursive: true });
    copyFileSync(src, licensePath());
    chmodSync(licensePath(), 0o600);
    return printJson(licenseStatus());
  }
  throw new Error(`Unknown license command: ${action}`);
}

function candidateWorkspaces(explicit) {
  return [explicit, process.env.TEMU_WORKSPACE, process.cwd(), DEFAULT_WORKSPACE].filter(Boolean);
}

function isTemuWorkspace(path) {
  if (!path) return false;
  const pkg = join(path, "package.json");
  if (!existsSync(pkg)) return false;
  try {
    const data = JSON.parse(readFileSync(pkg, "utf8"));
    return Boolean(data.scripts?.["dev:competitors"] && data.scripts?.["build:1688-extension"]);
  } catch {
    return false;
  }
}

function workspace(flags = {}, options = { required: true }) {
  const explicit = flags.workspace ? resolve(flags.workspace) : undefined;
  for (const candidate of candidateWorkspaces(explicit)) {
    const resolved = resolve(candidate);
    if (isTemuWorkspace(resolved)) return resolved;
  }
  if (!options.required) return null;
  throw new Error(`Cannot find TEMU workspace. Set TEMU_WORKSPACE or pass --workspace.`);
}

function run(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const extra = options.capture ? `\n${result.stdout ?? ""}\n${result.stderr ?? ""}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}${extra}`);
  }
  return result.stdout ?? "";
}

function runNpm(cwd, script, extra = []) {
  run(cwd, "npm", ["run", script, ...extra]);
}

function longRun(cwd, command, args) {
  const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function pathState(path) {
  if (!existsSync(path)) return "missing";
  return statSync(path).isDirectory() ? "ok" : "present";
}

async function isPortOpen(port) {
  return new Promise((resolveResult) => {
    const server = createServer();
    server.once("error", () => resolveResult(true));
    server.once("listening", () => server.close(() => resolveResult(false)));
    server.listen(port, "127.0.0.1");
  });
}

function copyExtensionFromWorkspace(root) {
  const source = join(root, "extensions/1688-capture/dist/chrome-mv3");
  const manifest = join(source, "manifest.json");
  if (!existsSync(manifest)) throw new Error(`Chrome extension build is missing: ${manifest}`);
  rmSync(BUNDLED_EXTENSION_DIR, { recursive: true, force: true });
  mkdirSync(dirname(BUNDLED_EXTENSION_DIR), { recursive: true });
  cpSync(source, BUNDLED_EXTENSION_DIR, { recursive: true });
  return BUNDLED_EXTENSION_DIR;
}

function printExtensionInstructions(extensionDir = BUNDLED_EXTENSION_DIR) {
  console.log(`Chrome extension unpacked path:
${extensionDir}

Load in Chrome:
1. Open chrome://extensions/
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the folder above
`);
}

async function doctor(flags) {
  const root = workspace(flags, { required: false });
  const summary = {
    version: VERSION,
    license: licenseStatus(),
    workspace: root ?? "missing",
    node: process.version,
    npm: root ? run(root, "npm", ["--version"], { capture: true }).trim() : "not_checked_without_workspace",
    nodeModules: root ? pathState(join(root, "node_modules")) : "not_checked_without_workspace",
    workspaceChromeExtension: root ? pathState(join(root, "extensions/1688-capture/dist/chrome-mv3")) : "not_checked_without_workspace",
    bundledChromeExtension: pathState(BUNDLED_EXTENSION_DIR),
    captureService9788: (await isPortOpen(9788)) ? "running" : "not_running",
    dashboard5177: (await isPortOpen(5177)) ? "running" : "not_running",
  };
  console.log(JSON.stringify(summary, null, 2));
}

function install(flags) {
  const root = workspace(flags);
  if (!existsSync(join(root, "node_modules"))) run(root, "npm", ["install"]);
  runNpm(root, "build:1688-extension");
  copyExtensionFromWorkspace(root);
  runNpm(root, "build:competitors");
  printExtensionInstructions();
}

function extension(flags) {
  const root = workspace(flags, { required: false });
  if (root) {
    runNpm(root, "build:1688-extension");
    copyExtensionFromWorkspace(root);
  }
  printExtensionInstructions();
  if (flags["open-chrome"] && process.platform === "darwin") {
    spawnSync("open", ["-a", "Google Chrome", "chrome://extensions/"], { stdio: "ignore" });
  }
}

function capture(flags) {
  const root = workspace(flags);
  longRun(root, "npm", ["run", "serve:1688-capture"]);
}

function dashboard(flags) {
  const root = workspace(flags);
  longRun(root, "npm", ["run", "dev:competitors"]);
}

function listing(flags) {
  const root = workspace(flags);
  if (!flags["offer-id"]) throw new Error("Missing --offer-id=<1688 offer id>");
  const args = ["run", "listing:temu", "--", `--offer-id=${flags["offer-id"]}`];
  if (flags["declaration-price-cny"]) args.push(`--declaration-price-cny=${flags["declaration-price-cny"]}`);
  if (flags["image-dir"]) args.push(`--image-dir=${flags["image-dir"]}`);
  if (flags["out-name"]) args.push(`--out-name=${flags["out-name"]}`);
  run(root, "npm", args);
}

function packageDashboard(flags) {
  const root = workspace(flags);
  runNpm(root, "package:competitors");
}

function smoke(flags) {
  const root = workspace(flags);
  runNpm(root, "build:competitors");
  runNpm(root, "typecheck:1688-capture");
  runNpm(root, "smoke:1688-capture");
  runNpm(root, "build:1688-extension");
  copyExtensionFromWorkspace(root);
}

async function main() {
  const { command, flags, positionals } = parseArgs(process.argv.slice(2));
  if (command === "--version" || command === "version" || flags.version) {
    console.log(VERSION);
    return;
  }
  if (command === "license") return licenseCommand(positionals, flags);
  if (command === "help" || flags.help || flags.h) return printHelp();
  const handlers = {
    doctor,
    install,
    extension,
    capture,
    dashboard,
    listing,
    package: packageDashboard,
    smoke,
  };
  const handler = handlers[command];
  if (!handler) throw new Error(`Unknown command: ${command}`);
  const requiredFeature = LICENSE_FEATURE_BY_COMMAND[command];
  if (requiredFeature) requireLicense(requiredFeature);
  return handler(flags);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
