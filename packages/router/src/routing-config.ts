import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export type TaskKind = 'planning' | 'coding' | 'research' | 'speed' | 'review' | 'default';

export interface ModelRoute {
  provider: string;
  model: string;
}

export interface RoutingConfig {
  default: ModelRoute;
  tasks: Partial<Record<TaskKind, ModelRoute>>;
}

export const DEFAULT_ROUTING: RoutingConfig = {
  default: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  tasks: {
    planning: { provider: 'anthropic', model: 'claude-opus-4-7' },
    coding: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    research: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    speed: { provider: 'anthropic', model: 'claude-haiku-4-5' },
    review: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  },
};

export async function loadRoutingConfig(configPath: string): Promise<RoutingConfig> {
  try {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw) as RoutingConfig;
  } catch {
    return DEFAULT_ROUTING;
  }
}

export async function saveRoutingConfig(configPath: string, config: RoutingConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export function toMastraModelId(route: ModelRoute): string {
  return `${route.provider}/${route.model}`;
}
