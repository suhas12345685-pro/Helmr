export type SubagentKind = 'council' | 'coding' | 'research' | 'fast' | 'browser';

export interface SubagentDescriptor {
  kind: SubagentKind;
  description: string;
  defaultCapabilities: string[];
}

export const SUBAGENTS: readonly SubagentDescriptor[] = [
  {
    kind: 'council',
    description: 'Plans work and synthesizes results inside deterministic workflow boundaries.',
    defaultCapabilities: ['workspace_read'],
  },
  {
    kind: 'coding',
    description: 'Handles approved code changes through receipt-gated tools.',
    defaultCapabilities: ['workspace_read', 'workspace_write', 'shell_read', 'git_read'],
  },
  {
    kind: 'research',
    description: 'Performs read-only analysis and result synthesis.',
    defaultCapabilities: ['workspace_read', 'network'],
  },
  {
    kind: 'fast',
    description: 'Handles low-risk quick classification and routing tasks.',
    defaultCapabilities: ['workspace_read'],
  },
  {
    kind: 'browser',
    description: 'Reserved for approved browser automation tasks.',
    defaultCapabilities: ['browser', 'network'],
  },
] as const;

export function getSubagent(kind: SubagentKind): SubagentDescriptor {
  const found = SUBAGENTS.find((agent) => agent.kind === kind);
  if (!found) {
    throw new Error(`unknown subagent: ${kind}`);
  }
  return found;
}
