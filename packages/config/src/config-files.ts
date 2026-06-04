import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';

export type ConfigFileName = 'AGENTS.md' | 'TOOLS.md' | 'MODELS.md' | 'CHANNELS.md' | 'IDENTITY.md';

const TEMPLATES: Record<ConfigFileName, string> = {
  'AGENTS.md': `# Helmr Agents

## Council
Role: planner
Model: configured via MODELS.md
Capabilities: workspace_read, shell_read, git_read

## Coding
Role: implementation
Capabilities: workspace_read, workspace_write, shell_read

## Research
Role: information gathering (read-only)
Capabilities: workspace_read, shell_read, git_read

## Fast
Role: lightweight quick tasks
Capabilities: workspace_read
`,

  'TOOLS.md': `# Helmr Tools

## read_workspace
Capability: workspace_read
Risk: low
Approval: not_required

## read_workspace_file
Capability: workspace_read
Risk: low
Approval: not_required

## shell_read
Capability: shell_read
Risk: low
Approval: not_required
Allowlist: ls, dir, cat, git status, git log, node --version, npm --version

## write_workspace_file
Capability: workspace_write
Risk: medium
Approval: required

## shell_write
Capability: shell_write
Risk: high
Approval: required
Allowlist: npm install, git add, git commit, git checkout

## git_commit
Capability: git_write
Risk: medium
Approval: required
`,

  'MODELS.md': `# Helmr Model Routing

## Default
Provider: anthropic
Model: claude-sonnet-4-5

## Task Routing

### planning
Provider: anthropic
Model: claude-opus-4-7

### coding
Provider: anthropic
Model: claude-sonnet-4-5

### research
Provider: anthropic
Model: claude-sonnet-4-5

### speed
Provider: anthropic
Model: claude-haiku-4-5
`,

  'CHANNELS.md': `# Helmr Channels

## WebChat
Status: active
Endpoint: ws://localhost:3999/ws
Pairing: not required (local owner)

## Telegram
Status: not_configured
Setup: Create a bot via @BotFather and paste the HTTP API token in Hatchery.

## Discord
Status: not_configured
Setup: Create a bot in Discord Developer Portal and paste the token in Hatchery.

## Slack
Status: not_configured
Setup: Create a Slack App with Socket Mode and paste the tokens in Hatchery.
`,

  'IDENTITY.md': `# Helmr Identity

## Name
Helmr

## Mascot
A lobster at the helm — calm under pressure, always reading the current before it turns.

## Personality
Helmr has a taste of its own. It is anticipatory, not reactive: it leads with the
next move instead of waiting to be asked. Calm under pressure — the more chaotic the
moment, the quieter and clearer it gets. Confident with dry warmth, never servile and
never a hype machine. It earns trust by being honest about what it does not know and
never reckless with a write.

Helmr does not wait for instructions. Helmr understands momentum.

## Language
English

## Response Style
- Open with the move already being prepared, not "How can I help?"
- Short status updates during execution
- Clear summary at completion
- Surface only what matters, especially under pressure
- Risk and approval status always visible before any write
- Occasional, tasteful crustacean nods (molt, current) — used sparingly
`,
};

export class ConfigFileManager {
  constructor(private readonly configDir: string) {}

  /** Absolute path of the config directory this manager owns. */
  get dir(): string {
    return this.configDir;
  }

  async init(): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    for (const name of Object.keys(TEMPLATES) as ConfigFileName[]) {
      const path = join(this.configDir, name);
      const exists = await access(path).then(() => true).catch(() => false);
      if (!exists) {
        await writeFile(path, TEMPLATES[name], 'utf8');
      }
    }
  }

  async read(name: ConfigFileName): Promise<string> {
    return readFile(join(this.configDir, name), 'utf8');
  }

  async write(name: ConfigFileName, content: string): Promise<void> {
    await writeFile(join(this.configDir, name), content, 'utf8');
  }

  async exists(name: ConfigFileName): Promise<boolean> {
    return access(join(this.configDir, name)).then(() => true).catch(() => false);
  }

  templateFor(name: ConfigFileName): string {
    return TEMPLATES[name];
  }
}
