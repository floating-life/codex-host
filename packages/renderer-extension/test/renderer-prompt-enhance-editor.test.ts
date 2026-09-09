/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import { createEnhancementEditor } from "../src/renderer-prompt-enhance-editor.js";

function fakeTextarea(value: string) {
  const listeners = new Map<string, () => void>();
  return {
    tagName: "TEXTAREA",
    value,
    isConnected: true,
    classList: { contains: () => false },
    closest: () => null,
    getAttribute: () => null,
    addEventListener: (name: string, cb: () => void) => listeners.set(name, cb),
    removeEventListener: (name: string) => listeners.delete(name),
    dispatchEvent: () => true,
  } as unknown as Element & { value: string };
}

describe("prompt enhancement editor adapter", () => {
  it("preserves exact textarea whitespace in snapshots and writes", () => {
    const input = fakeTextarea("  draft  ");
    const adapter = createEnhancementEditor(input)!;
    const before = adapter.snapshot();
    expect(adapter.equals(before)).toBe(true);
    expect(adapter.write("  enhanced  ")).toBe(true);
    expect(adapter.read()).toBe("  enhanced  ");
    expect(adapter.equals(before)).toBe(false);
    adapter.dispose();
  });

  it("fails closed for unsupported contenteditable", () => {
    const input = fakeTextarea("draft");
    Object.defineProperty(input, "tagName", { value: "DIV" });
    expect(createEnhancementEditor(input)).toBeNull();
  });

  it("probes native undo and rejects transactions that would erase other edits", () => {
    const input = fakeTextarea("draft");
    Object.defineProperties(input, {
      tagName: { value: "DIV" },
      classList: { value: { contains: () => true } },
      getAttribute: { value: () => "true" },
    });
    const doc = (text: string) => ({
      text,
      eq(other: unknown) {
        return (other as { text?: string })?.text === text;
      },
      descendants() {},
    });
    type Doc = ReturnType<typeof doc>;
    const transaction = (value: Doc) => ({
      doc: value,
      setMeta() {
        return this;
      },
    });
    const before = doc("draft");
    let current = before;
    let undoTarget = before;
    const view = {
      dom: input,
      isDestroyed: false,
      get state() {
        return { doc: current, tr: transaction(current) };
      },
      dispatch(value: ReturnType<typeof transaction>) {
        current = value.doc;
      },
    };
    const controller = {
      view,
      getText() {
        return this.view.state.doc.text;
      },
      setText(text: string) {
        this.view.dispatch(transaction(doc(text)));
      },
      undo() {
        this.view.dispatch(transaction(undoTarget));
      },
    };
    Object.defineProperty(input, "__reactFiber$test", {
      value: { memoizedProps: { composerController: controller } },
    });
    const adapter = createEnhancementEditor(input)!;
    expect(adapter.write("enhanced")).toBe(true);
    undoTarget = doc("earlier unrelated edit");
    expect(adapter.undo(before)).toBe(false);
    expect(adapter.read()).toBe("enhanced");
    undoTarget = before;
    expect(adapter.undo(before)).toBe(true);
    expect(adapter.read()).toBe("draft");
  });
});
