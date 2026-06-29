#!/usr/bin/env node
import { createServer } from "node:net";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(SCRIPT_DIR, "..");
const BUNDLED_EXTENSION_DIR = join(PLUGIN_ROOT, "assets/chrome-extension/chrome-mv3");
const DEFAULT_WORKSPACE = join(homedir(), "Code/temu");
const VERSION = "0.1.0";

function parseArgs(argv) {
  const parsed = { command: "help", flags: {} };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) parsed.command = rest.shift();
  for (const arg of rest) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...value] = arg.slice(2).split("=");
      parsed.flags[key] = value.join("=");
    } else if (arg.startsWith("--")) {
      parsed.flags[arg.slice(2)] = "1";
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`temu-workbench ${VERSION}

Usage:
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
`);
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
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || flags.help || flags.h) return printHelp();
  if (command === "doctor") return doctor(flags);
  if (command === "install") return install(flags);
  if (command === "extension") return extension(flags);
  if (command === "capture") return capture(flags);
  if (command === "dashboard") return dashboard(flags);
  if (command === "listing") return listing(flags);
  if (command === "package") return packageDashboard(flags);
  if (command === "smoke") return smoke(flags);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
