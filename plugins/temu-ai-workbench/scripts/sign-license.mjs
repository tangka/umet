#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sign } from "node:crypto";

const PRODUCT = "temu-ai-workbench";

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

const privateKeyPath =
  process.env.UMET_TEMU_LICENSE_PRIVATE_KEY ?? path.join(os.homedir(), ".umet-vendor", "temu-ai-workbench-license-private.pem");
const out = arg("--out", "license.json");
const customer = arg("--customer", "Customer");
const licenseId = arg("--license-id", `umet_temu_${Date.now()}`);
const machineId = arg("--machine-id", "");
const expiresAt = arg("--expires-at", "2027-12-31T23:59:59+08:00");
const features = arg("--features", "*")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (!fs.existsSync(privateKeyPath)) throw new Error(`Missing private key: ${privateKeyPath}`);

const payload = {
  product: PRODUCT,
  licenseId,
  customer,
  machineId,
  features,
  issuedAt: new Date().toISOString(),
  expiresAt,
};
const privateKey = fs.readFileSync(privateKeyPath, "utf8");
const signature = sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64");
const license = { ...payload, signature };

if (hasFlag("--code")) {
  console.log(base64Url(JSON.stringify(license)));
} else {
  fs.writeFileSync(out, `${JSON.stringify(license, null, 2)}\n`, { mode: 0o600 });
  console.log(out);
}
