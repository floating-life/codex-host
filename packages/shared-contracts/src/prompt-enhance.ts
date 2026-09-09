import { z } from "zod";

export const promptEnhanceModeSchema = z.enum(["workbuddy", "creative"]);
export const promptEnhanceProtocolSchema = z.enum(["chat-completions", "responses"]);
export const promptEnhanceCredentialModeSchema = z.enum(["manual", "environment"]);
export const promptEnhanceConfigSchema = z
  .object({
    enabled: z.boolean(),
    mode: promptEnhanceModeSchema,
    protocol: promptEnhanceProtocolSchema,
    baseUrl: z.string().max(2_000),
    model: z.string().max(500),
    credentialMode: promptEnhanceCredentialModeSchema,
    hasApiKey: z.boolean(),
    apiKeyEnv: z.string().max(128).optional(),
  })
  .strict();
export const promptEnhanceConfigWriteParamsSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: promptEnhanceModeSchema.optional(),
    protocol: promptEnhanceProtocolSchema.optional(),
    baseUrl: z.string().max(2_000).optional(),
    model: z.string().max(500).optional(),
    credentialMode: promptEnhanceCredentialModeSchema.optional(),
    apiKeyEnv: z.string().max(128).optional(),
    // An empty string deliberately preserves the existing manual key.
    apiKey: z.string().max(10_000).optional(),
    clearApiKey: z.boolean().optional(),
  })
  .strict();
export const promptEnhanceConfigReadParamsSchema = z.object({}).strict();
export const promptEnhanceGenerateParamsSchema = z
  .object({
    requestId: z.string().min(1).max(200),
    ownerId: z.string().min(1).max(200),
    prompt: z.string().min(1).max(100_000),
    mode: promptEnhanceModeSchema.optional(),
  })
  .strict();
export const promptEnhanceGenerateResultSchema = z
  .object({
    requestId: z.string().min(1).max(200),
    output: z.string().min(1).max(200_000),
  })
  .strict();
export const promptEnhanceCancelParamsSchema = z
  .object({
    requestId: z.string().min(1).max(200),
    ownerId: z.string().min(1).max(200),
  })
  .strict();
export const promptEnhanceCancelResultSchema = z.object({ cancelled: z.boolean() }).strict();

export type PromptEnhanceConfig = z.infer<typeof promptEnhanceConfigSchema>;
export type PromptEnhanceConfigWriteParams = z.infer<typeof promptEnhanceConfigWriteParamsSchema>;
export type PromptEnhanceGenerateParams = z.infer<typeof promptEnhanceGenerateParamsSchema>;
export type PromptEnhanceGenerateResult = z.infer<typeof promptEnhanceGenerateResultSchema>;
export type PromptEnhanceCancelParams = z.infer<typeof promptEnhanceCancelParamsSchema>;
