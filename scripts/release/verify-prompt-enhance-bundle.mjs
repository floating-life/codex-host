import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const hostPath = path.join(root, "packages/host-runtime/src/app-server-host.ts");
const servicePath = path.join(root, "packages/host-runtime/src/prompt-enhance.ts");
const rendererPath = path.join(root, "packages/renderer-extension/src/renderer-prompt-enhance.ts");
const bindingPath = path.join(root, "packages/renderer-extension/src/renderer-binding-probe.ts");

const checks = [
  [hostPath, "PromptEnhanceService", "Host service"],
  [hostPath, "codexhost/prompt-enhance/generate", "Host RPC"],
  [servicePath, "class PromptEnhanceService", "Prompt Enhance implementation"],
  [rendererPath, "installPromptEnhance", "Renderer control"],
  [bindingPath, "installPromptEnhance", "Renderer binding"],
];

for (const [file, marker, label] of checks) {
  const source = await readFile(file, "utf8");
  if (!source.includes(marker)) throw new Error(`${label} marker missing: ${path.relative(root, file)}`);
}

console.log("Prompt Enhance source integrity: PASS");
