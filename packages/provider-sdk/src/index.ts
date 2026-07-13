import { z } from 'zod';

export const ProviderAuthMethodSchema = z.enum(['api_key', 'oauth', 'cli', 'local']);
export const ProviderManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default('0.1.0'),
  authMethods: z.array(ProviderAuthMethodSchema).min(1),
  models: z.array(z.object({ id: z.string().min(1), displayName: z.string().optional(), capabilities: z.array(z.string()).default([]), contextWindow: z.number().int().positive().optional(), cost: z.object({ inputPerMTok: z.number().nonnegative(), outputPerMTok: z.number().nonnegative() }).optional() })).default([]),
  routingHints: z.array(z.string()).default([]),
  failover: z.object({ retryableErrors: z.array(z.string()).default([]), fallbackProviderIds: z.array(z.string()).default([]) }).default({}),
});
export type ProviderManifest = z.infer<typeof ProviderManifestSchema>;
export interface ProviderRuntime { manifest: ProviderManifest; validate(): Promise<{ ok: boolean; detail: string }>; listModels(): Promise<ProviderManifest['models']> }
export function defineProvider(manifest: ProviderManifest, runtime: Omit<ProviderRuntime, 'manifest'>): ProviderRuntime { return { manifest: ProviderManifestSchema.parse(manifest), ...runtime }; }
export const STARTER_PROVIDERS: z.input<typeof ProviderManifestSchema>[] = [
  { id: 'openai', name: 'OpenAI', authMethods: ['api_key', 'oauth'], models: [{ id: 'gpt-4.1', capabilities: ['text','tool-use'] }] },
  { id: 'anthropic', name: 'Anthropic', authMethods: ['api_key'], models: [{ id: 'claude-sonnet-4-5', capabilities: ['text','tool-use'] }] },
  { id: 'google-gemini', name: 'Google Gemini', authMethods: ['api_key', 'oauth'], models: [{ id: 'gemini-2.5-pro', capabilities: ['text','vision'] }] },
  { id: 'groq', name: 'Groq', authMethods: ['api_key'], models: [{ id: 'llama-3.3-70b-versatile', capabilities: ['text'] }] },
  { id: 'perplexity-sonar', name: 'Perplexity Sonar', authMethods: ['api_key'], models: [{ id: 'sonar-pro', capabilities: ['text','research'] }] },
  { id: 'xai-grok', name: 'xAI/Grok', authMethods: ['api_key'], models: [{ id: 'grok-4', capabilities: ['text'] }] },
  { id: 'deepseek', name: 'DeepSeek', authMethods: ['api_key'], models: [{ id: 'deepseek-chat', capabilities: ['text'] }] },
  { id: 'kimi', name: 'Kimi', authMethods: ['api_key'], models: [{ id: 'kimi-k2', capabilities: ['text'] }] },
  { id: 'ollama', name: 'Ollama', authMethods: ['local'], models: [{ id: 'llama3.1', capabilities: ['text','local'] }] },
  { id: 'lm-studio', name: 'LM Studio', authMethods: ['local'], models: [{ id: 'local-model', capabilities: ['text','local'] }] },
];
