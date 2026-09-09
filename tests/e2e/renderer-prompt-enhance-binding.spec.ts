/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });
const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererBindingProbe } from './packages/renderer-extension/src/renderer-binding-probe.ts';
      import { createRendererModelClient } from './packages/renderer-extension/src/renderer-model-client.ts';
      const composer = document.createElement('div');
      composer.setAttribute('data-codex-composer-root', 'true');
      const editor = document.createElement('textarea');
      editor.setAttribute('data-codex-composer', 'true');
      editor.value = 'Fix the bug';
      const modelState = { atom: {}, get: () => ({ isManuallyChanged: false, modelSettings: null, serviceTier: null }), set: () => undefined };
      editor.__reactFiber$enhance = { updateQueue: { memoCache: { data: [
        [undefined, modelState, modelState],
        [{}, {}, 'client-new-thread:enhance', modelState, undefined, modelState, modelState],
      ] } }, return: null };
      const toolbar = document.createElement('div');
      const send = document.createElement('button'); send.type = 'submit'; send.textContent = 'Send';
      toolbar.append(send); composer.append(editor, toolbar); document.body.append(composer);
      globalThis.enhanceCalls = []; globalThis.sendCount = 0;
      send.onclick = () => globalThis.sendCount++;
      const config = { enabled: true, mode: 'workbuddy', protocol: 'responses', baseUrl: 'https://example.invalid/v1', model: 'test', credentialMode:'manual', hasApiKey:true };
      const client = createRendererModelClient([{ sendRequest: async (method, params) => {
        if (method.startsWith('codexhost/prompt-enhance/')) globalThis.enhanceCalls.push({method, params});
        if (method === 'codexhost/prompt-enhance/config/read') return config;
        if (method === 'codexhost/prompt-enhance/config/write') {const {apiKey,clearApiKey,...safe}=params; Object.assign(config,safe); if(apiKey)config.hasApiKey=true; if(clearApiKey)config.hasApiKey=false; return config;}
        if (method === 'codexhost/prompt-enhance/generate') {if(globalThis.failEnhance)throw Object.assign(new Error('unknown variant'),{code:-32601});return {requestId: params.requestId, output: 'Improved draft'};}
        if (method === 'codexhost/prompt-enhance/cancel') return {cancelled: true};
        throw Object.assign(new Error('Unavailable test capability'), {code: -32601});
      } }]);
      globalThis.binding = installRendererBindingProbe({enabledAgents: ['codex']});
      globalThis.binding.setAdapter({state:'ready',reason:'ready',modelUpdates:0,hook:'model-state'}, undefined, () => true, client);
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

test("production binding mounts enhancement, applies a draft without submit, and disposes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: outputFiles[0]!.text });
  const enhance = page.locator('[data-codexhost-prompt-enhance="true"]');
  await expect(enhance).toHaveCount(1);
  await enhance.click();
  await expect(page.locator("textarea").first()).toHaveValue("Improved draft");
  expect(await page.evaluate(() => Reflect.get(globalThis, "sendCount"))).toBe(0);
  const calls = await page.evaluate(() => Reflect.get(globalThis, "enhanceCalls"));
  expect(
    calls.filter((entry: { method: string }) => entry.method.endsWith("/generate")),
  ).toHaveLength(1);
  await page.evaluate(() => Reflect.get(globalThis, "binding").dispose());
  await expect(enhance).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("manual credentials save without redisplaying the key or generating", async ({ page }) => {
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: outputFiles[0]!.text });
  await page.locator('[data-codexhost-prompt-enhance="true"]').click({ button: "right" });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("启用增强")).toBeChecked();
  await dialog.getByLabel("增强模式").selectOption("creative");
  await dialog.getByLabel("模型 ID").fill("fast-enhancer");
  await expect(dialog.getByLabel("凭据方式")).toHaveValue("manual");
  await dialog.getByLabel("清除已保存的 Key").check();
  await dialog.getByLabel("API Key", { exact: true }).fill("synthetic-manual-key");
  await expect(dialog.getByLabel("清除已保存的 Key")).not.toBeChecked();
  await dialog.getByRole("button", { name: "保存配置" }).click();
  await expect(dialog.getByRole("status")).toContainText("配置已保存");
  const calls = await page.evaluate(() => Reflect.get(globalThis, "enhanceCalls"));
  expect(
    calls.filter((entry: { method: string }) => entry.method.endsWith("/generate")),
  ).toHaveLength(0);
  expect(
    calls.find((entry: { method: string }) => entry.method.endsWith("/write")).params,
  ).toMatchObject({
    mode: "creative",
    model: "fast-enhancer",
    credentialMode: "manual",
    apiKey: "synthetic-manual-key",
  });
  await expect(dialog.getByLabel("API Key", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("failure is dismissible and does not take composer toolbar space", async ({ page }) => {
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: outputFiles[0]!.text });
  await page.evaluate(() => Reflect.set(globalThis, "failEnhance", true));
  await page.locator('[data-codexhost-prompt-enhance="true"]').click();
  const notice = page.locator("[data-codexhost-enhance-notice]");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Host");
  expect(await notice.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  expect(await notice.evaluate((el) => !!el.closest("[data-codex-composer-root]"))).toBe(false);
  await notice.getByRole("button", { name: "关闭提示" }).click();
  await expect(notice).toBeHidden();
  await expect(page.locator("textarea").first()).toHaveValue("Fix the bug");
  await page.locator('[data-codexhost-prompt-enhance="true"]').click();
  await page.mouse.move(0, 0);
  await expect(notice).toBeVisible();
  await expect(notice).toBeHidden({ timeout: 9000 });
});
