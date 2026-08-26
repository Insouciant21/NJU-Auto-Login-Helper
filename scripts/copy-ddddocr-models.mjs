import { mkdirSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modelSource = join(projectRoot, "ddddocr");
const modelTarget = join(projectRoot, "dist", "ddddocr");
const ortSource = join(projectRoot, "node_modules", "onnxruntime-web", "dist");

rmSync(modelTarget, { recursive: true, force: true });
mkdirSync(modelTarget, { recursive: true });
for (const name of ["common_old.onnx", "common_old.json"]) {
  copyFileSync(join(modelSource, name), join(modelTarget, name));
}

for (const name of readdirSync(ortSource)) {
  if (name.startsWith("ort-wasm-simd-threaded.") && /\.(mjs|wasm)$/.test(name)) {
    copyFileSync(join(ortSource, name), join(projectRoot, "dist", name));
  }
}
