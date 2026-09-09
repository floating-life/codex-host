import {
  promptEnhanceConfigSchema,
  promptEnhanceConfigReadParamsSchema,
  promptEnhanceConfigWriteParamsSchema,
  promptEnhanceGenerateParamsSchema,
  promptEnhanceGenerateResultSchema,
  promptEnhanceCancelParamsSchema,
  promptEnhanceCancelResultSchema,
} from "@codexhost/shared-contracts";

/** A feature-scoped bridge, never an arbitrary native request escape hatch. */
export function createEnhancementRequest(
  send: (method: string, params: unknown) => Promise<unknown>,
): (method: string, params: unknown) => Promise<unknown> {
  return async (method, input) => {
    switch (method) {
      case "codexhost/prompt-enhance/config/read":
        return promptEnhanceConfigSchema.parse(
          await send(method, promptEnhanceConfigReadParamsSchema.parse(input)),
        );
      case "codexhost/prompt-enhance/config/write":
        return promptEnhanceConfigSchema.parse(
          await send(method, promptEnhanceConfigWriteParamsSchema.parse(input)),
        );
      case "codexhost/prompt-enhance/generate": {
        const params = promptEnhanceGenerateParamsSchema.parse(input);
        const result = promptEnhanceGenerateResultSchema.parse(await send(method, params));
        if (result.requestId !== params.requestId || !result.output.trim()) {
          throw new Error("Prompt Enhance returned an invalid completion");
        }
        return result;
      }
      case "codexhost/prompt-enhance/cancel":
        return promptEnhanceCancelResultSchema.parse(
          await send(method, promptEnhanceCancelParamsSchema.parse(input)),
        );
      default:
        throw new Error("Unsupported Prompt Enhance method");
    }
  };
}
