/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it, vi } from "vitest";
import { createRendererModelClient } from "../src/renderer-model-client.js";

describe("Prompt Enhance request integration", () => {
  it("routes draft-only generation through the existing Host client", async () => {
    const sendRequest = vi.fn(async () => ({ requestId: "request-1", output: "Improved draft" }));
    const client = createRendererModelClient([{ sendRequest }]);
    expect(client?.promptEnhanceRequest).toBeTypeOf("function");
    const params = {
      requestId: "request-1",
      ownerId: "window-1",
      prompt: "Fix the bug",
      mode: "workbuddy",
    };
    await expect(
      client!.promptEnhanceRequest!("codexhost/prompt-enhance/generate", params),
    ).resolves.toEqual({ requestId: "request-1", output: "Improved draft" });
    expect(sendRequest).toHaveBeenCalledWith("codexhost/prompt-enhance/generate", params);
  });

  it("rejects unrelated methods and draft requests carrying history before transport", async () => {
    const sendRequest = vi.fn();
    const client = createRendererModelClient([{ sendRequest }]);
    expect(client?.promptEnhanceRequest).toBeTypeOf("function");
    await expect(client!.promptEnhanceRequest!("thread/start", {})).rejects.toThrow();
    await expect(
      client!.promptEnhanceRequest!("codexhost/prompt-enhance/generate", {
        requestId: "request-1",
        ownerId: "window-1",
        prompt: "Fix",
        history: ["private"],
      }),
    ).rejects.toThrow();
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("rejects mismatched completion identities and secret-bearing configuration responses", async () => {
    const sendRequest = vi.fn(async () => ({ requestId: "other-request", output: "Wrong result" }));
    const client = createRendererModelClient([{ sendRequest }]);
    expect(client?.promptEnhanceRequest).toBeTypeOf("function");
    await expect(
      client!.promptEnhanceRequest!("codexhost/prompt-enhance/generate", {
        requestId: "request-1",
        ownerId: "window-1",
        prompt: "Fix",
      }),
    ).rejects.toThrow();
    const read = createRendererModelClient([
      {
        sendRequest: async () => ({
          enabled: true,
          mode: "workbuddy",
          protocol: "responses",
          baseUrl: "https://example.com/v1",
          model: "test",
          apiKey: "do-not-persist",
        }),
      },
    ]);
    await expect(
      read!.promptEnhanceRequest!("codexhost/prompt-enhance/config/read", {}),
    ).rejects.toThrow();
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });
});
