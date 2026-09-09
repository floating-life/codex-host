import { EDITOR_SELECTOR, sendButtonWithin } from "./renderer-composer-dom.js";
import { createEnhancementEditor } from "./renderer-prompt-enhance-editor.js";
import {
  enhancementTargets,
  enhancementContext,
  enhancementMutationRelevant,
} from "./renderer-enhancement-targets.js";
import { openEnhancementSettings } from "./renderer-enhancement-settings.js";
import {
  createEnhancementNotice,
  enhancementFailureMessage,
} from "./renderer-enhancement-notice.js";

export const PROMPT_ENHANCE_GENERATE_METHOD = "codexhost/prompt-enhance/generate";
export const PROMPT_ENHANCE_CANCEL_METHOD = "codexhost/prompt-enhance/cancel";
export interface PromptEnhanceContext {
  taskId?: string;
  navigationKey?: string;
}
export interface PromptEnhanceEditor {
  read(): string;
  write(value: string): boolean;
  isComposing(): boolean;
  value?(): string;
  snapshot?(): unknown;
  equals?(snapshot: unknown): boolean;
  undo?(before: unknown): boolean;
  isValid?(): boolean;
}
type Send = (
  method: string,
  params: unknown,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;
export interface PromptEnhanceInstallOptions {
  ownerDocument?: Document;
  sendRequest: Send;
  getComposers?: () => readonly Element[];
  getContext?: (composer: Element) => PromptEnhanceContext | null;
}
interface ControllerOptions {
  editor: PromptEnhanceEditor;
  sendRequest: Send;
  context?: PromptEnhanceContext | null;
  getContext?: () => PromptEnhanceContext | null;
}
export type PromptEnhanceResult = {
  status: "applied" | "empty" | "busy" | "composing" | "conflict" | "stale" | "aborted" | "error";
  text?: string;
  error?: unknown;
};
function sameContext(a: PromptEnhanceContext | null, b: PromptEnhanceContext | null): boolean {
  return (
    (a?.taskId ?? null) === (b?.taskId ?? null) &&
    (a?.navigationKey ?? null) === (b?.navigationKey ?? null)
  );
}
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
function requestIdentity(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function createPromptEnhanceController(options: ControllerOptions) {
  const ownerId = requestIdentity();
  const editor = options.editor;
  const context = () => options.getContext?.() ?? options.context ?? null;
  const snapshot = () => (editor.snapshot ? editor.snapshot() : editor.read());
  const equals = (value: unknown) =>
    editor.equals ? editor.equals(value) : editor.read() === value;
  let active: { abort: AbortController; id: string } | null = null;
  let disposed = false;
  let retained: string | null = null;
  let last: {
    before: unknown;
    after: unknown;
    text: string;
    context: PromptEnhanceContext | null;
  } | null = null;
  const valid = () => !disposed && (!editor.isValid || editor.isValid());
  const canUndo = () =>
    valid() &&
    !active &&
    !editor.isComposing() &&
    !!last &&
    sameContext(last.context, context()) &&
    equals(last.after);
  const stop = () => {
    const request = active;
    if (!request) return false;
    active = null;
    request.abort.abort();
    void options
      .sendRequest(PROMPT_ENHANCE_CANCEL_METHOD, { ownerId, requestId: request.id })
      .catch(() => undefined);
    return true;
  };
  return {
    async enhance(): Promise<PromptEnhanceResult> {
      if (active) return { status: "busy" };
      if (!valid()) return { status: "stale" };
      if (editor.isComposing()) return { status: "composing" };
      let before: unknown;
      let draft: string;
      try {
        draft = editor.read();
        before = snapshot();
      } catch {
        return { status: "error" };
      }
      if (!draft.trim()) return { status: "empty" };
      const startedContext = options.context ?? context();
      if (options.getContext && !startedContext) return { status: "stale" };
      const request = { abort: new AbortController(), id: requestIdentity() };
      active = request;
      const timeout = setTimeout(() => {
        if (active === request) stop();
      }, 90_000);
      try {
        const result = await abortable(
          options.sendRequest(
            PROMPT_ENHANCE_GENERATE_METHOD,
            { ownerId, requestId: request.id, prompt: draft },
            { signal: request.abort.signal },
          ),
          request.abort.signal,
        );
        if (!valid() || request.abort.signal.aborted || active !== request)
          return { status: "aborted" };
        const raw =
          typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
        const output = raw.output ?? raw.text;
        if (
          typeof output !== "string" ||
          !output.trim() ||
          (raw.requestId !== undefined && raw.requestId !== request.id)
        )
          return { status: "error" };
        retained = output;
        if (!sameContext(startedContext, context())) return { status: "stale" };
        if (editor.isComposing()) return { status: "composing" };
        if (!equals(before)) return { status: "conflict" };
        if (!editor.write(output)) return { status: "error" };
        last = { before, after: snapshot(), text: draft, context: startedContext };
        return { status: "applied", text: output };
      } catch (error) {
        return request.abort.signal.aborted ? { status: "aborted" } : { status: "error", error };
      } finally {
        clearTimeout(timeout);
        if (active === request) active = null;
      }
    },
    stop,
    undo(): boolean {
      try {
        if (!canUndo() || !last) return false;
        const restored = editor.undo ? editor.undo(last.before) : editor.write(last.text);
        if (!restored || !equals(last.before)) return false;
        last = null;
        return true;
      } catch {
        return false;
      }
    },
    dispose() {
      stop();
      disposed = true;
      last = null;
    },
    get busy() {
      return active !== null;
    },
    get canUndo() {
      try {
        return canUndo();
      } catch {
        return false;
      }
    },
    get retainedResult() {
      return retained;
    },
  };
}
const messages: Record<PromptEnhanceResult["status"], string> = {
  applied: "已增强；请检查后自行发送。",
  empty: "请先输入草稿。",
  busy: "正在增强…",
  composing: "输入法仍在编辑，未覆盖草稿。",
  conflict: "草稿已修改，结果保留在设置中。",
  stale: "编辑对象已变化，未覆盖草稿。",
  aborted: "已停止或超时，原文保留。",
  error: "增强失败，请检查配置；完整结果可在设置中复制。",
};
export function installPromptEnhance(options: PromptEnhanceInstallOptions) {
  const document = options.ownerDocument ?? globalThis.document;
  type Mounted = {
    editor: Element;
    controls: Element;
    send: HTMLButtonElement;
    available(): boolean;
    controller: ReturnType<typeof createPromptEnhanceController>;
    dispose(): void;
    sync(): void;
  };
  const mounted = new Map<Element, Mounted>();
  const notice = createEnhancementNotice(document);
  let retained: string | null = null;
  let disposed = false;
  let closeSettings: (() => void) | null = null;
  const openSettings = () => {
    closeSettings = openEnhancementSettings(document, options.sendRequest, () => retained);
  };
  const refresh = () => {
    if (disposed) return;
    const composers = options.getComposers?.() ?? enhancementTargets(document);
    for (const [composer, item] of mounted) {
      if (
        !composer.isConnected ||
        !item.controls.isConnected ||
        !item.available() ||
        sendButtonWithin(composer) !== item.send ||
        !composers.includes(composer) ||
        composer.querySelector(EDITOR_SELECTOR) !== item.editor
      ) {
        item.dispose();
        mounted.delete(composer);
      } else item.sync();
    }
    for (const composer of composers) {
      if (mounted.has(composer)) continue;
      const editor = composer.querySelector(EDITOR_SELECTOR);
      const send = sendButtonWithin(composer);
      if (!editor || !send?.parentElement) continue;
      const adapter = createEnhancementEditor(editor);
      if (!adapter) continue;
      const controller = createPromptEnhanceController({
        editor: adapter,
        sendRequest: options.sendRequest,
        getContext: () => {
          if (send.disabled || !send.isConnected) return null;
          return enhancementContext(composer, options.getContext);
        },
      });
      const controls = document.createElement("span");
      controls.dataset.codexhostEnhanceControls = "true";
      controls.style.cssText = "display:inline-flex;align-items:center;gap:4px";
      const button = (text: string, title: string) => {
        const element = document.createElement("button");
        element.type = "button";
        element.textContent = text;
        element.title = title;
        element.setAttribute("aria-label", title);
        return element;
      };
      const enhance = button("✨", "增强提示词（再次点击停止；右键设置）");
      enhance.dataset.codexhostPromptEnhance = "true";
      const undo = button("↶", "撤销本轮增强");
      undo.dataset.codexhostPromptEnhanceUndo = "true";
      let localGeneration = 0;
      const sync = () => {
        const disabled = !controller.canUndo;
        if (undo.disabled !== disabled) undo.disabled = disabled;
        const text = controller.busy ? "■" : "✨";
        if (enhance.textContent !== text) enhance.textContent = text;
      };
      enhance.addEventListener("click", () => {
        if (controller.busy) {
          controller.stop();
          notice.show(messages.aborted, enhance);
          sync();
          return;
        }
        const generation = ++localGeneration;
        const pending = controller.enhance();
        if (controller.busy) notice.show(messages.busy, enhance, 0);
        sync();
        void pending.then((result) => {
          if (disposed || generation !== localGeneration) return;
          retained = controller.retainedResult ?? retained;
          notice.show(
            result.status === "error"
              ? enhancementFailureMessage(result.error)
              : messages[result.status],
            enhance,
            result.status === "applied" ? 2500 : 6000,
          );
          sync();
        });
      });
      enhance.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openSettings();
      });
      undo.addEventListener("click", () => {
        notice.show(
          controller.undo() ? "已撤销本轮增强。" : "当前内容或撤销历史已变化，未覆盖。",
          enhance,
        );
        sync();
      });
      editor.addEventListener("input", sync);
      controls.append(undo, enhance);
      send.parentElement.insertBefore(controls, send);
      mounted.set(composer, {
        editor,
        controls,
        send,
        available: adapter.isValid,
        controller,
        sync,
        dispose() {
          localGeneration++;
          controller.dispose();
          adapter.dispose();
          editor.removeEventListener("input", sync);
          controls.remove();
        },
      });
      sync();
    }
  };
  let refreshFrame: number | null = null;
  const observer = new MutationObserver((records) => {
    for (const item of mounted.values()) {
      if (
        records.some(
          (record) => record.target === item.editor || item.editor.contains(record.target),
        )
      )
        item.sync();
    }
    if (disposed || refreshFrame !== null || !enhancementMutationRelevant(records)) return;
    refreshFrame =
      document.defaultView?.requestAnimationFrame(() => {
        refreshFrame = null;
        refresh();
      }) ?? null;
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "contenteditable",
      "disabled",
      "data-turn-key",
      "data-above-composer-conversation-id",
    ],
  });
  refresh();
  return {
    refresh,
    openSettings,
    get retainedResult() {
      return retained;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      if (refreshFrame !== null) document.defaultView?.cancelAnimationFrame(refreshFrame);
      notice.dispose();
      closeSettings?.();
      for (const item of mounted.values()) item.dispose();
      mounted.clear();
    },
  };
}
