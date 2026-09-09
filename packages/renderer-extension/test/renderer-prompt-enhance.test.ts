import { describe, expect, it, vi } from "vitest";
import {
  createPromptEnhanceController,
  type PromptEnhanceEditor,
} from "../src/renderer-prompt-enhance.js";

function editor(initial: string): PromptEnhanceEditor {
  let value = initial;
  return {
    read: () => value,
    write: (next) => {
      value = next;
      return true;
    },
    isComposing: () => false,
    value: () => value,
  };
}

describe("prompt enhance controller", () => {
  it("only writes an enhancement when the draft is unchanged", async () => {
    const target = editor("fix bug");
    const request = vi.fn(async () => ({ text: "Fix the bug and add regression tests." }));
    const controller = createPromptEnhanceController({
      editor: target,
      sendRequest: request,
      context: { taskId: "t1", navigationKey: "n1" },
    });

    const result = await controller.enhance();
    expect(result.status).toBe("applied");
    expect(target.read()).toContain("regression");
    expect(controller.undo()).toBe(true);
    expect(target.read()).toBe("fix bug");
  });

  it("rejects a changed draft and does not overwrite it", async () => {
    const target = editor("fix bug");
    let release!: (value: { text: string }) => void;
    const request = vi.fn(() => new Promise<{ text: string }>((resolve) => (release = resolve)));
    const controller = createPromptEnhanceController({
      editor: target,
      sendRequest: request,
      context: { taskId: "t1", navigationKey: "n1" },
    });
    const pending = controller.enhance();
    target.write("user changed draft");
    release({ text: "enhanced" });
    await expect(pending).resolves.toMatchObject({ status: "conflict" });
    expect(target.read()).toBe("user changed draft");
    expect(controller.retainedResult).toBe("enhanced");
  });

  it("aborts an in-flight request when stop is pressed", async () => {
    const target = editor("draft");
    let signal!: AbortSignal;
    const request = vi.fn(
      (_method: string, _params: unknown, options?: { signal?: AbortSignal }) => {
        if (options?.signal) signal = options.signal;
        return new Promise<{ text: string }>(() => undefined);
      },
    );
    const controller = createPromptEnhanceController({ editor: target, sendRequest: request });
    const pending = controller.enhance();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(controller.stop()).toBe(true);
    expect(signal.aborted).toBe(true);
    await expect(pending).resolves.toMatchObject({ status: "aborted" });
  });

  it("does not apply a stale navigation result", async () => {
    const target = editor("draft");
    const request = vi.fn(async () => ({ text: "enhanced" }));
    let context = { taskId: "t1", navigationKey: "n1" };
    const controller = createPromptEnhanceController({
      editor: target,
      sendRequest: request,
      getContext: () => context,
      context,
    });
    context = { taskId: "t2", navigationKey: "n2" };
    await expect(controller.enhance()).resolves.toMatchObject({ status: "stale" });
    expect(target.read()).toBe("draft");
  });

  it("preserves whitespace and refuses undo after user editing", async () => {
    const target = editor("original");
    const controller = createPromptEnhanceController({
      editor: target,
      sendRequest: async () => ({ output: "  enhanced\n\n" }),
    });
    await controller.enhance();
    expect(target.read()).toBe("  enhanced\n\n");
    target.write("my edited result");
    expect(controller.canUndo).toBe(false);
    expect(controller.undo()).toBe(false);
    expect(target.read()).toBe("my edited result");
  });

  it("rejects IME conflicts and retains the complete result", async () => {
    const target = editor("original");
    let composing = false;
    target.isComposing = () => composing;
    const deferred = Promise.withResolvers<unknown>();
    const controller = createPromptEnhanceController({
      editor: target,
      sendRequest: () => deferred.promise,
    });
    const pending = controller.enhance();
    composing = true;
    deferred.resolve({ output: "new result" });
    expect((await pending).status).toBe("composing");
    expect(target.read()).toBe("original");
    expect(controller.retainedResult).toBe("new result");
  });

  it("keeps undo scoped to its original context", async () => {
    const target = editor("original");
    let taskId = "one";
    const controller = createPromptEnhanceController({
      editor: target,
      getContext: () => ({ taskId }),
      sendRequest: async () => ({ output: "new" }),
    });
    await controller.enhance();
    taskId = "two";
    expect(controller.undo()).toBe(false);
    expect(target.read()).toBe("new");
  });

  it("disposes active requests and prevents later writes or restarts", async () => {
    const target = editor("original");
    const deferred = Promise.withResolvers<unknown>();
    const send = vi.fn((method: string) =>
      method.endsWith("/cancel") ? Promise.resolve({ cancelled: true }) : deferred.promise,
    );
    const controller = createPromptEnhanceController({ editor: target, sendRequest: send });
    const pending = controller.enhance();
    controller.dispose();
    deferred.resolve({ output: "late" });
    expect((await pending).status).toBe("aborted");
    expect(target.read()).toBe("original");
    expect((await controller.enhance()).status).toBe("stale");
    expect(send.mock.calls.map((call) => call[0])).toEqual([
      "codexhost/prompt-enhance/generate",
      "codexhost/prompt-enhance/cancel",
    ]);
  });
});
