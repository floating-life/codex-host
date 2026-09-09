import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi } from "vitest";
import { PromptEnhanceService } from "../src/prompt-enhance.js";

async function service(fetchImpl: typeof fetch = fetch) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexhost-prompt-enhance-"));
  return {
    service: new PromptEnhanceService({
      dataDirectory: dir,
      environment: { WB_KEY: "secret" },
      fetchImpl,
    }),
    dir,
  };
}

const manualConfig = {
  enabled: true,
  mode: "workbuddy" as const,
  protocol: "chat-completions" as const,
  baseUrl: "https://example.test",
  model: "m",
  apiKey: "secret",
};

function openSse(stream: string): { response: Response; close: () => void } {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      controller.enqueue(encoder.encode(stream));
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    close: () => {
      try {
        controller.close();
      } catch {
        // The service may have already cancelled the stream after its terminal event.
      }
    },
  };
}

async function settlesWithin<T>(value: Promise<T>, milliseconds = 100): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      value,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("request did not settle after protocol completion")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("PromptEnhanceService", () => {
  it("keeps the current credentials usable when saving fails", async () => {
    const { service: value, dir } = await service(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }),
          ),
      ),
    );
    await value.writeConfig(manualConfig);
    const before = value.readConfig();
    await rename(dir, dir + "-preserved");
    await writeFile(dir, "blocked directory");
    await expect(
      value.writeConfig({ apiKey: "replacement", model: "replacement" }),
    ).rejects.toThrow();
    expect(value.readConfig()).toEqual(before);
    await expect(
      value.generate({ requestId: "still-valid", ownerId: "test", prompt: "draft" }),
    ).resolves.toMatchObject({ output: "ok" });
  });
  it("serializes concurrent partial saves without losing the earlier setting", async () => {
    const { service: value, dir } = await service();
    await value.writeConfig(manualConfig);
    await Promise.all([
      value.writeConfig({ model: "next-model" }),
      value.writeConfig({ mode: "creative" }),
    ]);
    expect(value.readConfig()).toMatchObject({
      model: "next-model",
      mode: "creative",
      hasApiKey: true,
    });
    const stored = JSON.parse(await readFile(path.join(dir, "prompt-enhance.json"), "utf8"));
    expect(stored).toMatchObject({ model: "next-model", mode: "creative", apiKey: "secret" });
  });
  it("persists a manual API key but never returns it", async () => {
    const { service: value, dir } = await service();
    await value.writeConfig({
      ...manualConfig,
      mode: "creative",
      protocol: "responses",
    });
    expect(value.readConfig()).toEqual({
      enabled: true,
      mode: "creative",
      protocol: "responses",
      baseUrl: "https://example.test",
      model: "m",
      credentialMode: "manual",
      hasApiKey: true,
    });
    const stored = await readFile(path.join(dir, "prompt-enhance.json"), "utf8");
    expect(stored).toContain("secret");
    expect(JSON.stringify(value.readConfig())).not.toContain("secret");
  });

  it("preserves a manual key for a blank update and clears it only explicitly", async () => {
    const { service: value, dir } = await service();
    await value.writeConfig(manualConfig);
    await value.writeConfig({ apiKey: "" });
    expect(value.readConfig()).toMatchObject({ hasApiKey: true });
    await value.writeConfig({ clearApiKey: true });
    expect(value.readConfig()).toMatchObject({ hasApiKey: false });
    expect(await readFile(path.join(dir, "prompt-enhance.json"), "utf8")).not.toContain("secret");
  });

  it("uses manual settings changed immediately before the next request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("https://changed.test/chat/completions");
      expect(init?.headers).toMatchObject({ authorization: "Bearer changed-key" });
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "changed-model" });
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "enhanced" } }] }),
        { status: 200 },
      );
    });
    const { service: value } = await service(fetchImpl);
    await value.writeConfig(manualConfig);
    await value.writeConfig({
      baseUrl: "https://changed.test",
      model: "changed-model",
      apiKey: "changed-key",
    });
    await expect(
      value.generate({ requestId: "r", ownerId: "o", prompt: "draft" }),
    ).resolves.toMatchObject({
      output: "enhanced",
    });
  });

  it("restores a persisted manual key after restart", async () => {
    const { service: initial, dir } = await service();
    await initial.writeConfig(manualConfig);
    const reloaded = new PromptEnhanceService({
      dataDirectory: dir,
      environment: {},
      fetchImpl: async (_url, init) => {
        expect(init?.headers).toMatchObject({ authorization: "Bearer secret" });
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: "enhanced" } }],
          }),
          { status: 200 },
        );
      },
    });
    await reloaded.initialize();
    await expect(
      reloaded.generate({ requestId: "r", ownerId: "o", prompt: "draft" }),
    ).resolves.toMatchObject({
      output: "enhanced",
    });
  });

  it("parses Chat Completions JSON and sends only the current prompt", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "m",
        messages: expect.any(Array),
      });
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "enhanced" } }] }),
        { status: 200 },
      );
    });
    const { service: value } = await service(fetchImpl);
    await value.writeConfig({
      enabled: true,
      mode: "workbuddy",
      protocol: "chat-completions",
      baseUrl: "https://example.test",
      model: "m",
      credentialMode: "environment",
      apiKeyEnv: "WB_KEY",
    });
    await expect(
      value.generate({ requestId: "r1", prompt: "draft", mode: "workbuddy", ownerId: "owner" }),
    ).resolves.toEqual({ requestId: "r1", output: "enhanced" });
  });

  it("parses Responses SSE and rejects empty output", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          'data: {"type":"response.output_text.delta","delta":"hello"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    );
    const { service: value } = await service(fetchImpl);
    await value.writeConfig({
      enabled: true,
      mode: "creative",
      protocol: "responses",
      baseUrl: "https://example.test",
      model: "m",
      credentialMode: "environment",
      apiKeyEnv: "WB_KEY",
    });
    await expect(
      value.generate({ requestId: "r1", prompt: "draft", mode: "creative", ownerId: "owner" }),
    ).resolves.toEqual({ requestId: "r1", output: "hello" });
    const empty = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ output: [] }), { status: 200 }),
    );
    const { service: emptyService } = await service(empty);
    await emptyService.writeConfig({
      enabled: true,
      mode: "creative",
      protocol: "responses",
      baseUrl: "https://example.test",
      model: "m",
      credentialMode: "environment",
      apiKeyEnv: "WB_KEY",
    });
    await expect(
      emptyService.generate({
        requestId: "r2",
        prompt: "draft",
        mode: "creative",
        ownerId: "owner",
      }),
    ).rejects.toThrow(/empty|complete/i);
  });

  it("scopes cancellation to the owner", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          resolveFetch = resolve;
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const { service: value } = await service(fetchImpl);
    await value.writeConfig({
      enabled: true,
      mode: "workbuddy",
      protocol: "chat-completions",
      baseUrl: "https://example.test",
      model: "m",
      credentialMode: "environment",
      apiKeyEnv: "WB_KEY",
    });
    const pending = value.generate({
      requestId: "r1",
      prompt: "draft",
      mode: "workbuddy",
      ownerId: "owner-a",
    });
    expect(value.cancel("owner-b")).toBe(false);
    expect(value.cancel("owner-a")).toBe(true);
    await expect(pending).rejects.toThrow(/cancel/i);
  });

  it.each([
    [
      "chat length",
      "chat-completions",
      { choices: [{ finish_reason: "length", message: { content: "partial" } }] },
    ],
    [
      "chat content filter",
      "chat-completions",
      { choices: [{ finish_reason: "content_filter", message: { content: "partial" } }] },
    ],
    [
      "responses incomplete",
      "responses",
      { status: "incomplete", output: [{ content: [{ text: "partial" }] }] },
    ],
    [
      "responses error",
      "responses",
      { status: "failed", output: [{ content: [{ text: "partial" }] }] },
    ],
  ])("rejects incomplete %s JSON", async (_name, protocol, response) => {
    const { service: value } = await service(
      async () => new Response(JSON.stringify(response), { status: 200 }),
    );
    await value.writeConfig({
      enabled: true,
      mode: "workbuddy",
      protocol: protocol as "responses" | "chat-completions",
      baseUrl: "https://example.test",
      model: "m",
      credentialMode: "environment",
      apiKeyEnv: "WB_KEY",
    });
    await expect(value.generate({ requestId: "r", ownerId: "o", prompt: "draft" })).rejects.toThrow(
      /complete|failed|incomplete/i,
    );
  });

  it.each([
    [
      "chat length",
      "chat-completions",
      'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
    ],
    [
      "response failed",
      "responses",
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: {"type":"response.failed"}\n\ndata: [DONE]\n\n',
    ],
    ["bare done", "responses", "data: [DONE]\n\n"],
  ])("rejects non-success %s SSE", async (_name, protocol, stream) => {
    const { service: value } = await service(
      async () =>
        new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    await value.writeConfig({
      enabled: true,
      mode: "workbuddy",
      protocol: protocol as "responses" | "chat-completions",
      baseUrl: "https://example.test",
      model: "m",
      credentialMode: "environment",
      apiKeyEnv: "WB_KEY",
    });
    await expect(value.generate({ requestId: "r", ownerId: "o", prompt: "draft" })).rejects.toThrow(
      /complete|failed|cancel/i,
    );
  });

  it("uses completed Responses text once, preserves valid whitespace, and ignores reasoning deltas", async () => {
    const stream = [
      'data: {"type":"response.reasoning.delta","delta":"hidden"}\n\n',
      'data: {"type":"response.completed","response":{"status":"completed","output_text":"  enhanced  "}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const { service: value } = await service(
      async () =>
        new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    await value.writeConfig({
      enabled: true,
      mode: "workbuddy",
      protocol: "responses",
      baseUrl: "https://example.test",
      model: "m",
      credentialMode: "environment",
      apiKeyEnv: "WB_KEY",
    });
    await expect(
      value.generate({ requestId: "r", ownerId: "o", prompt: "draft" }),
    ).resolves.toEqual({ requestId: "r", output: "  enhanced  " });
  });

  it("accepts the official Responses SSE completion without a Chat-style DONE marker", async () => {
    const stream =
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';
    const { service: value } = await service(
      async () =>
        new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    await value.writeConfig({
      enabled: true,
      mode: "workbuddy",
      protocol: "responses",
      baseUrl: "https://example.test",
      model: "m",
      credentialMode: "environment",
      apiKeyEnv: "WB_KEY",
    });
    await expect(
      value.generate({ requestId: "r", ownerId: "o", prompt: "draft" }),
    ).resolves.toMatchObject({ output: "ok" });
  });

  it("returns after a Responses completion event without waiting for the connection to close", async () => {
    const open = openSse(
      'data: {"type":"response.output_text.delta","delta":"complete"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
    );
    const { service: value } = await service(async () => open.response);
    await value.writeConfig({ ...manualConfig, protocol: "responses" });
    try {
      await expect(
        settlesWithin(value.generate({ requestId: "r", ownerId: "o", prompt: "draft" })),
      ).resolves.toEqual({ requestId: "r", output: "complete" });
    } finally {
      open.close();
      value.close();
    }
  });

  it("returns after a Chat stop and DONE marker without waiting for the connection to close", async () => {
    const open = openSse(
      'data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
    const { service: value } = await service(async () => open.response);
    await value.writeConfig(manualConfig);
    try {
      await expect(
        settlesWithin(value.generate({ requestId: "r", ownerId: "o", prompt: "draft" })),
      ).resolves.toEqual({ requestId: "r", output: "complete" });
    } finally {
      open.close();
      value.close();
    }
  });

  it("rejects a Responses completion event whose status is not completed", async () => {
    const { service: value } = await service(
      async () =>
        new Response(
          'data: {"type":"response.completed","response":{"status":"failed","output_text":"partial"}}\n\n',
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    );
    await value.writeConfig({ ...manualConfig, protocol: "responses" });
    await expect(value.generate({ requestId: "r", ownerId: "o", prompt: "draft" })).rejects.toThrow(
      /complete/i,
    );
  });

  it("cancels an open SSE reader when its owner cancels the request", async () => {
    const open = openSse('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    const { service: value } = await service(async () => open.response);
    await value.writeConfig(manualConfig);
    try {
      const pending = value.generate({ requestId: "r", ownerId: "o", prompt: "draft" });
      await Promise.resolve();
      expect(value.cancel("o", "r")).toBe(true);
      await expect(settlesWithin(pending)).rejects.toThrow(/cancel/i);
    } finally {
      open.close();
      value.close();
    }
  });

  it("rejects malformed event data that follows a valid SSE delta in the same chunk", async () => {
    const { service: value } = await service(
      async () =>
        new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: not-json\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    await value.writeConfig(manualConfig);
    await expect(value.generate({ requestId: "r", ownerId: "o", prompt: "draft" })).rejects.toThrow(
      /malformed/i,
    );
  });

  it("preserves UTF-8 text when an SSE delta is split across byte chunks", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"response.output_text.delta","delta":"中文"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 49));
        controller.enqueue(bytes.slice(49));
      },
    });
    const { service: value } = await service(
      async () =>
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    await value.writeConfig({ ...manualConfig, protocol: "responses" });
    await expect(
      value.generate({ requestId: "r", ownerId: "o", prompt: "draft" }),
    ).resolves.toEqual({ requestId: "r", output: "中文" });
  });

  it("rejects whitespace-only output", async () => {
    const { service: value } = await service(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "   " } }] }),
          { status: 200 },
        ),
    );
    await value.writeConfig({
      enabled: true,
      mode: "workbuddy",
      protocol: "chat-completions",
      baseUrl: "https://example.test",
      model: "m",
      credentialMode: "environment",
      apiKeyEnv: "WB_KEY",
    });
    await expect(value.generate({ requestId: "r", ownerId: "o", prompt: "draft" })).rejects.toThrow(
      /empty/i,
    );
  });
});
