import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(projectRoot, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const requiredFiles = [
  "dist/content.bundle.js",
  "dist/options.bundle.js",
  "dist/ddddocr/common_old.onnx",
  "dist/ddddocr/common_old.json",
  "dist/ort-wasm-simd-threaded.wasm",
  "dist/ort-wasm-simd-threaded.mjs"
];
const missing = requiredFiles.filter((relativePath) => !existsSync(join(projectRoot, relativePath)));
if (missing.length) {
  throw new Error("Missing build artifacts: " + missing.join(", "));
}

const runtimeFiles = readdirSync(join(projectRoot, "dist"))
  .filter((name) => /^ort-wasm-simd-threaded\..+\.(?:mjs|wasm)$/.test(name));
if (runtimeFiles.length < 2) {
  throw new Error("No ONNX Runtime Web loader files found");
}

const resources = (manifest.web_accessible_resources || [])
  .flatMap((entry) => entry.resources || []);
for (const resource of ["dist/ddddocr/*", "dist/*.wasm", "dist/*.mjs"]) {
  if (!resources.includes(resource)) {
    throw new Error("Manifest does not expose " + resource);
  }
}

console.log(JSON.stringify({
  files: requiredFiles.length,
  runtimeFiles: runtimeFiles.length,
  manifestVersion: manifest.manifest_version
}));
