import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
const executablePath = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (executablePath) test.use({ launchOptions: { executablePath } });
const { outputFiles } = await build({
  stdin: {
    contents: `
import {installPromptEnhance} from './packages/renderer-extension/src/renderer-prompt-enhance.ts';
import {enhancementMutationRelevant} from './packages/renderer-extension/src/renderer-enhancement-targets.ts';
globalThis.enhancementMutationRelevant=enhancementMutationRelevant;
const composer=document.createElement('div');composer.dataset.codexComposerRoot='true';
composer.innerHTML='<textarea>draft</textarea><button type="submit">Send</button>';
const transcript=document.createElement('article');transcript.id='transcript';
document.body.append(transcript,composer);globalThis.scans=0;
globalThis.enhancement=installPromptEnhance({getComposers:()=>{globalThis.scans++;return [composer];},getContext:()=>({taskId:'one'}),sendRequest:async()=>({})});
globalThis.twoFrames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
`,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  loader: { ".png": "dataurl", ".svg": "dataurl", ".css": "text" },
});
const bundle = outputFiles[0];
if (!bundle) throw new Error("No test bundle");

test("ignores unrelated transcript updates and coalesces editor layout mutations", async ({
  page,
}) => {
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: bundle.text });
  await page.evaluate(() => Reflect.get(globalThis, "twoFrames")());
  const baseline = await page.evaluate(() => Reflect.get(globalThis, "scans"));
  await page.evaluate(async () => {
    for (let n = 0; n < 100; n++)
      document.getElementById("transcript")?.append(document.createElement("span"));
    await Reflect.get(globalThis, "twoFrames")();
  });
  expect(await page.evaluate(() => Reflect.get(globalThis, "scans"))).toBe(baseline);
  await page.evaluate(async () => {
    const composer = document.querySelector("[data-codex-composer-root]");
    for (let n = 0; n < 100; n++) composer?.append(document.createElement("span"));
    await Reflect.get(globalThis, "twoFrames")();
  });
  const extra = (await page.evaluate(() => Reflect.get(globalThis, "scans"))) - baseline;
  expect(extra).toBe(0);
  await page.evaluate(async () => {
    const button = document.querySelector('[data-codex-composer-root] button[type="submit"]');
    button?.replaceWith(button.cloneNode(true));
    await Reflect.get(globalThis, "twoFrames")();
  });
  const afterReplacement = (await page.evaluate(() => Reflect.get(globalThis, "scans"))) - baseline;
  expect(afterReplacement).toBeGreaterThan(0);
  expect(afterReplacement).toBeLessThanOrEqual(2);
  await expect(page.locator("[data-codexhost-prompt-enhance]")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const input = document.createElement("div");
          input.contentEditable = "true";
          document.querySelector("[data-codex-composer-root]")?.append(input);
          const observer = new MutationObserver((records) => {
            observer.disconnect();
            resolve(Reflect.get(globalThis, "enhancementMutationRelevant")(records));
          });
          observer.observe(input, { attributes: true });
          input.contentEditable = "false";
        }),
    ),
  ).toBe(true);
  await page.evaluate(() => Reflect.get(globalThis, "enhancement").dispose());
  await expect(page.locator("[data-codexhost-prompt-enhance]")).toHaveCount(0);
});
