#!/usr/bin/env node
import { createServer as createNetServer } from "node:net";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(SCRIPT_DIR, "..");
const BUNDLED_EXTENSION_DIR = join(PLUGIN_ROOT, "assets/chrome-extension/chrome-mv3");
const BUNDLED_DASHBOARD_DIR = join(PLUGIN_ROOT, "assets/dashboard-static");
const RUNTIME_HOME = join(homedir(), ".temu-ai-workbench");
const RUNTIME_DASHBOARD_DIR = join(RUNTIME_HOME, "dashboard-static");
const DEFAULT_WORKSPACE = join(homedir(), "Code/temu");
const VERSION = "0.1.0";

function parseArgs(argv) {
  const parsed = { command: "help", flags: {}, passThrough: [] };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) {
    parsed.command = rest.shift();
  }
  for (const arg of rest) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...value] = arg.slice(2).split("=");
      parsed.flags[key] = value.join("=");
      parsed.passThrough.push(arg);
    } else if (arg.startsWith("--")) {
      parsed.flags[arg.slice(2)] = "1";
      parsed.passThrough.push(arg);
    } else {
      parsed.passThrough.push(arg);
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
  return [
    explicit,
    process.env.TEMU_WORKSPACE,
    process.cwd(),
    DEFAULT_WORKSPACE,
    join(homedir(), "Code/temu"),
  ].filter(Boolean);
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
  throw new Error(
    `Cannot find TEMU workspace. Set TEMU_WORKSPACE or pass --workspace. Tried: ${candidateWorkspaces(explicit)
      .map((item) => resolve(item))
      .join(", ")}`,
  );
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

function longRun(cwd, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function pathState(path) {
  if (!existsSync(path)) return "missing";
  const stats = statSync(path);
  if (stats.isDirectory()) return "ok";
  return "present";
}

function ensureRuntimeDashboard(flags = {}) {
  const target = resolve(flags.dir ?? process.env.TEMU_DASHBOARD_STATIC_DIR ?? RUNTIME_DASHBOARD_DIR);
  const targetIndex = join(target, "index.html");
  const bundledIndex = join(BUNDLED_DASHBOARD_DIR, "index.html");
  if (!existsSync(bundledIndex)) {
    throw new Error(`Missing bundled dashboard: ${BUNDLED_DASHBOARD_DIR}`);
  }
  if (flags.reset || !existsSync(targetIndex)) {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(BUNDLED_DASHBOARD_DIR, target, { recursive: true });
  }
  return target;
}

function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function listFiles(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path).sort();
}

async function isPortOpen(port) {
  return new Promise((resolveResult) => {
    const server = createNetServer();
    server.once("error", () => resolveResult(true));
    server.once("listening", () => {
      server.close(() => resolveResult(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

function copyExtensionFromWorkspace(root) {
  const source = join(root, "extensions/1688-capture/dist/chrome-mv3");
  const manifest = join(source, "manifest.json");
  if (!existsSync(manifest)) {
    throw new Error(`Chrome extension build is missing: ${manifest}`);
  }
  rmSync(BUNDLED_EXTENSION_DIR, { recursive: true, force: true });
  mkdirSync(dirname(BUNDLED_EXTENSION_DIR), { recursive: true });
  cpSync(source, BUNDLED_EXTENSION_DIR, { recursive: true });
  return { source, bundled: BUNDLED_EXTENSION_DIR };
}

function printExtensionInstructions(extensionDir) {
  console.log(`Chrome extension unpacked path:
${extensionDir}

Load in Chrome:
1. Open chrome://extensions/
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the folder above
5. Keep the capture service running at http://127.0.0.1:9788
`);
}

async function doctor(flags) {
  const root = workspace(flags, { required: false });
  const npmVersion = root ? run(root, "npm", ["--version"], { capture: true }).trim() : "not_checked_without_workspace";
  const nodeVersion = process.version;
  const extensionDir = root ? join(root, "extensions/1688-capture/dist/chrome-mv3") : "";
  const deployZip = root ? join(root, "apps/competitor-dashboard/deploy/temu-dashboard-static.zip") : "";
  const listingPackages = root ? join(root, "apps/competitor-dashboard/data/listing-packages.json") : "";
  const captureOpen = await isPortOpen(9788);
  const dashboardOpen = await isPortOpen(5177);
  const summary = {
    version: VERSION,
    workspace: root ?? "missing",
    node: nodeVersion,
    npm: npmVersion,
    nodeModules: root ? pathState(join(root, "node_modules")) : "not_checked_without_workspace",
    chromeExtension: root ? pathState(extensionDir) : "not_checked_without_workspace",
    bundledChromeExtension: pathState(BUNDLED_EXTENSION_DIR),
    captureService9788: captureOpen ? "running" : "not_running",
    dashboard5177: dashboardOpen ? "running" : "not_running",
    listingPackages: root ? pathState(listingPackages) : "not_checked_without_workspace",
    deployZip: root && existsSync(deployZip) ? `${deployZip} (${Math.round(statSync(deployZip).size / 1024)} KB)` : "missing",
    projectRoutes: root ? listFiles(join(root, "apps/competitor-dashboard/data")).filter((file) => file.endsWith(".json")) : [],
  };
  console.log(JSON.stringify(summary, null, 2));
}

function install(flags) {
  const root = workspace(flags);
  if (!existsSync(join(root, "node_modules"))) {
    run(root, "npm", ["install"]);
  }
  runNpm(root, "build:1688-extension");
  copyExtensionFromWorkspace(root);
  runNpm(root, "build:competitors");
  console.log("TEMU workbench install check completed.");
  printExtensionInstructions(BUNDLED_EXTENSION_DIR);
}

function extension(flags) {
  const root = workspace(flags);
  runNpm(root, "build:1688-extension");
  const copied = copyExtensionFromWorkspace(root);
  printExtensionInstructions(copied.bundled);
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

function serveStatic(flags) {
  const root = ensureRuntimeDashboard(flags);
  if (!existsSync(join(root, "index.html"))) {
    throw new Error(`Missing bundled dashboard index.html: ${root}`);
  }
  const port = Number(flags.port ?? process.env.PORT ?? 4177);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".pdf": "application/pdf",
  };

  createHttpServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    let filePath = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(root)) filePath = join(root, "index.html");
    if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = join(root, "index.html");
    res.setHeader("content-type", types[extname(filePath).toLowerCase()] || "application/octet-stream");
    createReadStream(filePath).pipe(res);
  }).listen(port, "0.0.0.0", () => {
    console.log(`TEMU bundled dashboard: http://127.0.0.1:${port}/`);
    console.log(`Static root: ${root}`);
  });
}

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value, null, 2));
}

function readRequestJson(req) {
  return new Promise((resolveResult, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolveResult(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function assetRootFor(platform, productId) {
  if (platform === "1688") return `assets/1688/${productId}`;
  if (platform === "temu") return `assets/temu/${productId}`;
  if (platform === "amazon") return `assets/amazon/${productId}`;
  return `assets/captures/${platform}/${productId}`;
}

function extensionFromContentType(contentType) {
  if (/jpeg|jpg/i.test(contentType)) return ".jpg";
  if (/png/i.test(contentType)) return ".png";
  if (/webp/i.test(contentType)) return ".webp";
  if (/gif/i.test(contentType)) return ".gif";
  if (/mp4/i.test(contentType)) return ".mp4";
  if (/webm/i.test(contentType)) return ".webm";
  return "";
}

function extensionFromUrl(url) {
  try {
    const parsed = new URL(url);
    const ext = extname(parsed.pathname).toLowerCase();
    if (ext && ext.length <= 8) return ext;
  } catch {
    return "";
  }
  return "";
}

async function downloadAsset(asset, rawDir, index) {
  const url = asset.url;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      referer: "https://detail.1688.com/",
    },
  });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "";
  const type = asset.type === "video" || /^video\//i.test(contentType) ? "video" : "image";
  const ext = extensionFromUrl(url) || extensionFromContentType(contentType) || (type === "video" ? ".mp4" : ".jpg");
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 12);
  const file = `${String(index + 1).padStart(2, "0")}_${hash}${ext}`;
  const dest = join(rawDir, file);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(dest, buffer);
  return {
    file: `raw/${file}`,
    type,
    url,
    bytes: buffer.length,
    role: asset.role,
    section: asset.section,
  };
}

async function downloadAssets(payload, assetRootAbs) {
  const rawDir = join(assetRootAbs, "raw");
  mkdirSync(rawDir, { recursive: true });
  const candidates = Array.isArray(payload.assets) ? payload.assets.slice(0, 80) : [];
  const downloaded = [];
  for (let index = 0; index < candidates.length; index += 1) {
    try {
      const item = await downloadAsset(candidates[index], rawDir, index);
      if (item) downloaded.push(item);
    } catch {
      // Keep capture usable when individual CDN assets reject direct download.
    }
  }
  return downloaded;
}

function upsertById(items, item) {
  const index = items.findIndex((existing) => existing?.id === item.id);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.unshift(item);
}

function updateDashboardData(dashboardRoot, payload, downloaded) {
  const platform = payload.platform || "1688";
  const productId = payload.page?.productId || payload.productId || createHash("sha1").update(payload.page?.url || Date.now().toString()).digest("hex").slice(0, 12);
  const now = new Date().toISOString();
  const dataRoot = join(dashboardRoot, "apps/competitor-dashboard/data");
  const publicAssetRoot = `/${assetRootFor(platform, productId)}`;
  const title = payload.structuredText?.title || payload.page?.title || productId;
  const url = payload.page?.url || "";
  const media = downloaded.map((asset) => ({
    file: asset.file,
    path: `${publicAssetRoot}/${asset.file}`,
    type: asset.type,
    url: asset.url,
    bytes: asset.bytes,
    role: asset.role,
  }));

  if (platform === "1688") {
    const file = join(dataRoot, "sources-1688.json");
    const data = readJsonFile(file, { generatedAt: now, sources: [] });
    if (!Array.isArray(data.sources)) data.sources = [];
    upsertById(data.sources, {
      id: productId,
      platform: "1688",
      offerId: productId,
      title,
      url,
      status: "已采集",
      projectIds: [],
      priceCny: Number(payload.page?.price) || null,
      knownSpecs: {},
      structured: {
        productAttributes: payload.structuredText?.attributes || {},
        packageRows: [],
        detailFields: {},
      },
      folders: {
        root: publicAssetRoot,
        raw: `${publicAssetRoot}/raw`,
        keyMedia: `${publicAssetRoot}/raw`,
        temuReadyPng: "",
      },
      files: {
        structuredJson: `${publicAssetRoot}/raw/capture-payload.json`,
        materialMeaning: "",
        manualPdf: "",
      },
      keyMedia: media.slice(0, 12).map((asset, index) => ({
        file: asset.file,
        type: asset.type,
        priority: index < 10 ? "P1" : "P2",
        meaning: asset.role || asset.url,
        suggestion: "Captured by TEMU AI Workbench runtime. Review before uploading.",
        bytes: asset.bytes,
      })),
      detailMedia: media.slice(12).map((asset) => ({
        file: asset.file,
        type: asset.type,
        role: asset.role || "detail",
        bytes: asset.bytes,
      })),
    });
    data.generatedAt = now;
    writeJsonFile(file, data);
    return { page: "sources", url: `http://127.0.0.1:4177/sources/${productId}` };
  }

  const file = join(dataRoot, "competitors.json");
  const data = readJsonFile(file, { generatedAt: now, projectRoot: "", competitors: [] });
  if (!Array.isArray(data.competitors)) data.competitors = [];
  upsertById(data.competitors, {
    id: productId,
    platform,
    basePath: publicAssetRoot,
    structuredPath: `${publicAssetRoot}/raw/capture-payload.json`,
    structured: {
      capturedAt: now,
      source: { platform, url, productId },
      product: { titleFromUrl: title },
      price: { visibleText: payload.page?.price || "" },
      structuredText: payload.structuredText || {},
    },
    folders: {
      root: publicAssetRoot,
      raw: `${publicAssetRoot}/raw`,
      keyMedia: `${publicAssetRoot}/raw`,
    },
    media: {
      keyMedia: media.slice(0, 12),
      raw: media,
    },
  });
  data.generatedAt = now;
  data.projectRoot = "";
  writeJsonFile(file, data);
  return { page: "competitors", url: `http://127.0.0.1:4177/competitors/${productId}` };
}

async function handleStandaloneCapture(payload, dashboardRoot) {
  const platform = payload.platform || "1688";
  const productId = payload.page?.productId || payload.productId;
  if (!productId) throw new Error("Missing payload.page.productId");
  const assetRootAbs = join(dashboardRoot, assetRootFor(platform, productId));
  mkdirSync(join(assetRootAbs, "raw"), { recursive: true });
  writeJsonFile(join(assetRootAbs, "raw/capture-payload.json"), payload);
  writeJsonFile(join(assetRootAbs, "raw/assets.json"), payload.assets || []);
  const downloaded = await downloadAssets(payload, assetRootAbs);
  writeJsonFile(join(assetRootAbs, "raw/downloaded-assets.json"), downloaded);
  const route = updateDashboardData(dashboardRoot, payload, downloaded);
  return {
    ok: true,
    productId,
    offerId: platform === "1688" ? productId : undefined,
    downloaded: {
      images: downloaded.filter((asset) => asset.type === "image").length,
      videos: downloaded.filter((asset) => asset.type === "video").length,
      keyMedia: downloaded.length,
    },
    paths: { root: assetRootAbs },
    dashboardUrl: route.url,
  };
}

function serveStandaloneCapture(flags) {
  const dashboardRoot = ensureRuntimeDashboard(flags);
  const port = Number(process.env.TEMU_1688_CAPTURE_PORT || flags.port || 9788);
  createHttpServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type,x-temu-capture-source,x-temu-capture-token");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "temu-ai-workbench-runtime-capture", dashboardRoot });
      return;
    }
    if (req.method === "POST" && (url.pathname === "/api/capture" || url.pathname === "/api/1688/capture")) {
      try {
        const payload = await readRequestJson(req);
        const result = await handleStandaloneCapture(payload, dashboardRoot);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    sendJson(res, 404, { ok: false, error: "not found" });
  }).listen(port, "127.0.0.1", () => {
    console.log(`TEMU runtime capture server: http://127.0.0.1:${port}`);
    console.log(`Dashboard preview: temu-workbench preview`);
    console.log(`Dashboard data root: ${dashboardRoot}`);
  });
}

function listing(flags) {
  const root = workspace(flags);
  if (!flags["offer-id"]) {
    throw new Error("Missing --offer-id=<1688 offer id>");
  }
  const args = ["run", "listing:temu", "--", `--offer-id=${flags["offer-id"]}`];
  if (flags["declaration-price-cny"]) {
    args.push(`--declaration-price-cny=${flags["declaration-price-cny"]}`);
  }
  if (flags["image-dir"]) {
    args.push(`--image-dir=${flags["image-dir"]}`);
  }
  if (flags["out-name"]) {
    args.push(`--out-name=${flags["out-name"]}`);
  }
  run(root, "npm", args);
  console.log(`Listing package generated for offer ${flags["offer-id"]}.`);
  console.log(`Open: http://127.0.0.1:5177/`);
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
  console.log("TEMU workbench smoke checks passed.");
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || flags.help || flags.h) {
    printHelp();
    return;
  }
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
