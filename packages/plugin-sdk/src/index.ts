import { z } from 'zod';

export const PluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  configSchema: z.record(z.string(), z.unknown()).default({}),
  secretsSchema: z.record(z.string(), z.unknown()).default({}),
  approvalPolicy: z.object({ requiredFor: z.array(z.string()).default([]), defaultMode: z.enum(['manual', 'approval-gated', 'disabled']).default('approval-gated') }).default({}),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export interface PluginLogger { info(message: string, meta?: unknown): void; warn(message: string, meta?: unknown): void; error(message: string, meta?: unknown): void }
export interface PluginAudit { record(event: { type: string; pluginId: string; payload?: unknown }): Promise<void> | void }
export interface PluginRuntimeContext { pluginId: string; config: Record<string, unknown>; secrets: Record<string, string>; logger: PluginLogger; audit: PluginAudit }
export interface HelmrPlugin {
  manifest: PluginManifest;
  install?(ctx: PluginRuntimeContext): Promise<void> | void;
  load?(ctx: PluginRuntimeContext): Promise<void> | void;
  start?(ctx: PluginRuntimeContext): Promise<void> | void;
  stop?(ctx: PluginRuntimeContext): Promise<void> | void;
  health?(ctx: PluginRuntimeContext): Promise<{ ok: boolean; detail?: string }> | { ok: boolean; detail?: string };
  uninstall?(ctx: PluginRuntimeContext): Promise<void> | void;
}
export function defineHelmrPlugin(plugin: HelmrPlugin): HelmrPlugin { PluginManifestSchema.parse(plugin.manifest); return plugin; }
export async function runPluginHealth(plugin: HelmrPlugin, ctx: PluginRuntimeContext): Promise<{ ok: boolean; detail: string }> {
  if (!plugin.health) return { ok: true, detail: 'No health hook declared.' };
  const result = await plugin.health(ctx);
  return { ok: result.ok, detail: result.detail ?? (result.ok ? 'healthy' : 'unhealthy') };
}
export function createMemoryPluginHarness(plugin: HelmrPlugin): PluginRuntimeContext {
  return { pluginId: plugin.manifest.id, config: {}, secrets: {}, logger: console, audit: { record: () => undefined } };
}
