import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installPromptEnhance } from "./packages/renderer-extension/src/renderer-prompt-enhance.ts";
      const main = document.createElement("div");
      main.id = "main-composer";
      main.setAttribute("data-codex-composer-root", "true");
      const mainInput = document.createElement("textarea"); mainInput.value = "normal draft";
      const mainFooter = document.createElement("div");
      const mainSend = document.createElement("button"); mainSend.type = "submit"; mainSend.textContent = "Send";
      mainFooter.append(mainSend); main.append(mainInput, mainFooter); document.body.append(main);
      const turn = document.createElement("section"); turn.setAttribute("data-turn-key", "turn-one");
      const edit = document.createElement("form"); edit.id = "edit-form";
      const editInput = document.createElement("textarea"); editInput.value = "edit draft";
      const editFooter = document.createElement("div");
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
      const editSend = document.createElement("button"); editSend.type = "submit"; editSend.textContent = "Send";
      editFooter.append(cancel, editSend); edit.append(editInput, editFooter); turn.append(edit); document.body.append(turn);
      edit.__reactFiber$edit = {
        memoizedProps: { initialMessage: "edit draft", onCancel() {}, onDraftChange() {}, onSubmit() {}, hostId: "local" },
        return: { memoizedProps: { threadId: "thread-one", turnId: "turn-one" }, return: null },
      };
      globalThis.sendCount = 0;
      mainSend.addEventListener("click", () => globalThis.sendCount++);
      editSend.addEventListener("click", () => globalThis.sendCount++);
      globalThis.enhanceRequests = [];
      globalThis.enhanceResolvers = [];
      globalThis.enhance = installPromptEnhance({
        sendRequest(method, params) {
          if (method.endsWith("/cancel")) return Promise.resolve({ cancelled: true });
          if (!method.endsWith("/generate")) throw new Error("Unexpected method: " + method);
          globalThis.enhanceRequests.push(params);
          return new Promise((resolve) => globalThis.enhanceResolvers.push(resolve));
        },
        getContext(composer) {
          return composer.id === "main-composer" ? { taskId: "thread-one", navigationKey: "route-one" } : null;
        },
      });
    `,
    resolveDir: repositoryRoot,
    sourcefile: "renderer-enhancement-edit-e2e-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2024",
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  write: false,
});

const browserOutput = outputFiles[0];
if (!browserOutput) throw new Error("Edit enhancement E2E bundle was not generated");
const browserBundle = browserOutput.text;

async function installFixture(page: Page): Promise<void> {
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ content: browserBundle });
  await expect(page.locator('[data-codexhost-prompt-enhance="true"]')).toHaveCount(2);
}

async function resolveRequest(page: Page, index: number, output: string): Promise<void> {
  await page.evaluate(
    ({ index, output }) => {
      const resolve = Reflect.get(globalThis, "enhanceResolvers") as Array<
        (value: unknown) => void
      >;
      const requests = Reflect.get(globalThis, "enhanceRequests") as Array<{ requestId: string }>;
      resolve[index]?.({ requestId: requests[index]?.requestId, output });
    },
    { index, output },
  );
}

test("normal and message-edit drafts enhance and undo independently without submitting", async ({
  page,
}) => {
  await installFixture(page);
  const normal = page.locator("#main-composer");
  const edit = page.locator("#edit-form");

  await normal.locator('[data-codexhost-prompt-enhance="true"]').click();
  await resolveRequest(page, 0, "improved normal");
  await expect(normal.locator("textarea")).toHaveValue("improved normal");
  await normal.locator('[data-codexhost-prompt-enhance-undo="true"]').click();
  await expect(normal.locator("textarea")).toHaveValue("normal draft");

  await edit.locator('[data-codexhost-prompt-enhance="true"]').click();
  await resolveRequest(page, 1, "improved edit");
  await expect(edit.locator("textarea")).toHaveValue("improved edit");
  await edit.locator('[data-codexhost-prompt-enhance-undo="true"]').click();
  await expect(edit.locator("textarea")).toHaveValue("edit draft");
  expect(await page.evaluate(() => Reflect.get(globalThis, "sendCount"))).toBe(0);
});

test("late edit results never overwrite changed, closed, or reidentified edit forms", async ({
  page,
}) => {
  await installFixture(page);
  const edit = page.locator("#edit-form");
  const input = edit.locator("textarea");

  await edit.locator('[data-codexhost-prompt-enhance="true"]').click();
  await input.fill("user changed draft");
  await resolveRequest(page, 0, "late result");
  await expect(input).toHaveValue("user changed draft");

  await edit.locator('[data-codexhost-prompt-enhance="true"]').click();
  await page
    .locator("[data-turn-key]")
    .evaluate((turn) => turn.setAttribute("data-turn-key", "turn-two"));
  await resolveRequest(page, 1, "wrong identity result");
  await expect(input).toHaveValue("user changed draft");

  await edit.locator('[data-codexhost-prompt-enhance="true"]').click();
  await edit.evaluate((form) => {
    Reflect.get(form, "__reactFiber$edit").memoizedProps.hostId = "other-host";
  });
  await resolveRequest(page, 2, "wrong host result");
  await expect(input).toHaveValue("user changed draft");

  await edit.locator('[data-codexhost-prompt-enhance="true"]').click();
  await page.locator("[data-turn-key]").evaluate((turn) => turn.remove());
  await resolveRequest(page, 3, "closed result");
  await expect(page.locator("#edit-form")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(globalThis, "sendCount"))).toBe(0);
});

test("replacement edit forms mount once while unrelated and disabled forms cannot generate", async ({
  page,
}) => {
  await installFixture(page);
  await page.evaluate(() => {
    const doc = Reflect.get(globalThis, "document") as Document;
    const turn = doc.querySelector("[data-turn-key]");
    const old = doc.querySelector("#edit-form");
    if (!turn || !old) throw new Error("Missing edit fixture");
    const replacement = old.cloneNode(true) as HTMLFormElement;
    replacement.id = "replacement-edit";
    replacement
      .querySelectorAll("[data-codexhost-enhance-controls]")
      .forEach((controls) => controls.remove());
    Reflect.set(replacement, "__reactFiber$edit", Reflect.get(old, "__reactFiber$edit"));
    old.replaceWith(replacement);
    const unrelated = doc.createElement("form");
    unrelated.id = "unrelated";
    unrelated.innerHTML = '<textarea>unrelated</textarea><button type="submit">Send</button>';
    doc.body.append(unrelated);
    const disabled = doc.createElement("form");
    disabled.id = "disabled-edit";
    disabled.innerHTML =
      '<textarea>disabled</textarea><button type="submit" disabled>Send</button>';
    Reflect.set(disabled, "__reactFiber$edit", Reflect.get(replacement, "__reactFiber$edit"));
    turn.append(disabled);
  });
  await expect(page.locator('[data-codexhost-prompt-enhance="true"]')).toHaveCount(3);
  await expect(page.locator("#unrelated [data-codexhost-prompt-enhance]")).toHaveCount(0);
  await page.locator("#disabled-edit [data-codexhost-prompt-enhance]").click();
  expect(
    await page.evaluate(() => (Reflect.get(globalThis, "enhanceRequests") as unknown[]).length),
  ).toBe(0);

  await page.locator("#replacement-edit [data-codexhost-prompt-enhance]").click();
  await resolveRequest(page, 0, "replacement result");
  await expect(page.locator("#replacement-edit textarea")).toHaveValue("replacement result");
  await expect(page.locator('[data-codexhost-prompt-enhance="true"]')).toHaveCount(3);
});

test("a stale primary Fiber cannot authorize a late result after an alternate identity change", async ({
  page,
}) => {
  await installFixture(page);
  const edit = page.locator("#edit-form");
  await edit.locator('[data-codexhost-prompt-enhance="true"]').click();
  await edit.evaluate((form) => {
    const original = Reflect.get(form, "__reactFiber$edit");
    original.alternate = {
      memoizedProps: { ...original.memoizedProps },
      return: {
        memoizedProps: { threadId: "thread-two", turnId: "turn-two", hostId: "local" },
        return: null,
      },
    };
  });
  await resolveRequest(page, 0, "stale result");
  await expect(edit.locator("textarea")).toHaveValue("edit draft");
  expect(await page.evaluate(() => Reflect.get(globalThis, "sendCount"))).toBe(0);
});
