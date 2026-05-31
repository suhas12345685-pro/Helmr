# Helmr Architecture and Installation Blueprint

Status: R&D source of truth
Last researched: 2026-05-28
Workspace: `C:\Users\DELL\Helmr`

Helmr is a self-hosted, TypeScript-first AI orchestration system. A user describes an outcome, Helmr converts that request into a normalized job, plans the work, verifies the plan, runs safe tools and specialist agents, records the evidence, and shows the result in Hatchery.

The product promise is simple:

> Outcome in. Verified agent work out. The human stays in control.

Helmr is not just an LLM wrapper. It is a controlled runtime around agents. The LLM can propose plans and write reasoning, but the control plane owns identity, queueing, permissions, locks, approvals, execution, audit logs, and installation.

---

## 1. Current Project State

The workspace has moved beyond the original placeholder scaffold into an implemented local-first Helmr spine. It currently contains:

- `architecture.md`, this blueprint and implementation-status reference.
- `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.base.json`, `pnpm-workspace.yaml`, and workspace-aware verification scripts.
- `src/`, including the CLI, daemon/runtime entrypoints, self-test, local planner fallback, and production-readiness helpers.
- `packages/shared`, `packages/gateway`, `packages/scheduler`, `packages/cortex`, `packages/hands`, `packages/memory`, `packages/mastra`, `packages/council`, `packages/router`, `packages/subagents`, `packages/channels`, `packages/config`, `packages/hatchery-api`, `packages/mcp`, `packages/browser`, `packages/sandbox`, and `packages/create-helmr`, each with a package manifest.
- `apps/hatchery-web` and `apps/hatchery-tui`.
- `docs/`, `deploy/`, `scripts/install.sh` / `scripts/install.ps1`, and user service install helpers production/deployment support files.
- `node_modules`, installed packages for local development and verification.

Installed latest package set from the current npm registry:

```txt
@mastra/core@1.37.1
@mastra/memory@1.20.0
@mastra/mcp@1.8.1
@mastra/libsql@1.11.1
@mastra/pg@1.11.1
@mastra/observability@1.14.0
@mastra/client-js@1.21.1
@mastra/server@1.37.1
@mastra/loggers@1.1.1
mastra@1.10.2
nucleoidai@0.7.10
typescript@6.0.3
zod@4.4.3
```

Installed model provider packages:

```txt
@ai-sdk/openai
@ai-sdk/anthropic
@ai-sdk/google
@ai-sdk/perplexity
@ai-sdk/groq
@ai-sdk/xai
```

Verification performed after completing the current implementation cleanup:

```powershell
npx mastra --version
# 1.10.2

npm run typecheck
# passes

npm test
# passes: 180 tests

npm run verify
# passes: typecheck, unit/integration/e2e tests, Hatchery Web build, Hatchery TUI build, create-helmr tests
```

Known issue:

```txt
npm audit reports 3 moderate vulnerabilities from nucleoidai through old uuid dependencies.
There is no direct npm audit fix available at the time of this research.
```

Decision: Mastra is safe to make part of the core architecture. Nucleoid should stay optional and experimental until its dependency and package maturity improve.

Implementation status note: the repo-contained architecture items are implemented and verified locally. External release operations, such as publishing `helmr` / `create-helmr` to npm and hosting `install.sh` / `install.ps1` at `helmr.ai`, remain release tasks outside this repository checkout.

---

## 2. Product Goal

Helmr should become a self-hosted AI agent operating layer that can:

- Accept requests from local CLI first, then webhooks, chat channels, scheduled runs, and remote clients.
- Normalize every incoming request into one internal event shape.
- Authenticate the event source before it can affect a workspace.
- Queue jobs durably.
- Lock a workspace before mutating files, git state, package locks, or environment files.
- Ask a planning agent to decompose the job.
- Verify the proposed plan with deterministic policy checks.
- Route safe subtasks to model-backed agents or local tools.
- Execute tools only through structured tool receipts.
- Persist job state, logs, memory, and audit evidence.
- Show progress, approvals, logs, and results in Hatchery.

Helmr should start local-first and self-hosted. Cloud model APIs are allowed, but the control plane and audit trail must remain owned by the user.

---

## 3. Design Principles

### 3.1 Self-Hosted Control

Helmr may call external model providers, but the core runtime should work from a user-controlled machine, WSL2 instance, VPS, container, or cloud VM.

Local state must remain inspectable:

- Markdown policy files.
- JSONL audit logs.
- SQLite databases.
- Optional Postgres for multi-worker deployments.

### 3.2 Deterministic Before Agentic

The LLM should not be the permission system, job scheduler, package installer, or shell runner.

Helmr separates:

- Intake.
- Authentication.
- Queueing.
- Planning.
- Verification.
- Execution.
- Memory.
- Rendering.

### 3.3 One Workspace, One Writer

Only one mutating job may write to a workspace at a time.

Read-only indexing can run concurrently, but anything that edits files, runs formatters, changes git state, installs packages, or writes env/config files must acquire a workspace write lock.

### 3.4 Tool Receipts, Not Raw Commands

Agents do not send raw shell commands directly to the OS. They request a tool call. The tool call becomes a structured receipt. The Cortex validates it. Hands executes it only if allowed.

### 3.5 Boring Security Core

The security core must be simple, explicit, and test-heavy. Neuro-symbolic or experimental engines can assist later, but the authoritative allow/block decision belongs to Helmr-owned deterministic code.

---

## 4. Three-Plane Architecture

Helmr is organized into three planes.

### 4.1 Control Plane

The control plane owns everything that must be deterministic:

- Event intake.
- Authentication.
- Rate limits.
- Queueing.
- Job state.
- Workspace locks.
- Approvals.
- Audit records.
- Configuration.
- Daemon lifecycle.

Packages:

```txt
packages/shared
packages/gateway
packages/scheduler
packages/cortex
packages/memory
packages/hatchery-api
```

### 4.2 Reasoning Plane

The reasoning plane owns model-backed work:

- Council planner.
- Specialist agents.
- Model router.
- Memory retrieval.
- Plan repair.
- Result synthesis.

Mastra powers this layer.

Packages:

```txt
packages/mastra
packages/council
packages/router
packages/subagents
```

### 4.3 Execution Plane

The execution plane owns actions against the outside world:

- Shell.
- Git.
- Filesystem.
- Browser automation.
- MCP tools.
- Package install.
- Service management.
- Docker or sandboxed execution.

Packages:

```txt
packages/hands
packages/browser
packages/mcp
packages/sandbox
```

---

## 5. Core Runtime Flow

1. User runs a local command, sends a webhook, or schedules a job.
2. Gateway authenticates the source.
3. Gateway normalizes the input into `HelmrEvent`.
4. Scheduler creates a durable `HelmrJob`.
5. Scheduler assigns priority and lane.
6. Council planner creates a typed `HelmrPlan`.
7. Cortex validates the plan against policy.
8. If needed, Hatchery asks the human for approval.
9. Sub-agent pool runs independent subtasks through Mastra.
10. Hands executes approved tool receipts.
11. Memory writes JSONL audit records and database state.
12. Council merges sub-results.
13. Hatchery displays the final result and full evidence trail.

---

## 6. Mastra Integration

Mastra is the agent and workflow framework for Helmr.

Official install flow for a standalone Mastra project:

```powershell
npm create mastra@latest
```

Official npm behavior matters here: `npm create mastra@latest` resolves to a `create-mastra` initializer package and runs its bin. Helmr should follow the same pattern with `create-helmr`.

Helmr should not ask normal users to run Mastra separately. Mastra is an internal engine.

### 6.1 Mastra Responsibilities

Mastra should own:

- Agent definitions.
- Agent tools.
- Agent memory adapters.
- Structured workflows.
- Supervisor or specialist agent patterns.
- MCP client/server integration.
- Observability integration.

Mastra should not own:

- Workspace trust policy.
- Installer lifecycle.
- Helmr daemon identity.
- Job queue truth.
- Final tool permission checks.
- Audit source of truth.

### 6.2 Mastra Package Layout

```txt
packages/mastra/
  src/
    index.ts
    agents/
      council.agent.ts
      coding.agent.ts
      research.agent.ts
      fast.agent.ts
      browser.agent.ts
    workflows/
      intake.workflow.ts
      planning.workflow.ts
      execution.workflow.ts
      review.workflow.ts
      delivery.workflow.ts
    tools/
      read-workspace.tool.ts
      request-receipt.tool.ts
      mcp.toolset.ts
    memory/
      mastra-memory.ts
```

### 6.3 Mastra Workflows

Use workflows for predictable product flows:

- Intake.
- Planning.
- Verification.
- Human approval.
- Execution.
- Review.
- Delivery.

Use agents for open-ended reasoning inside bounded workflow steps.

Rule: deterministic workflow first, agent autonomy second.

### 6.4 Mastra Scripts

Current root scripts:

```json
{
  "dev": "mastra dev",
  "build": "mastra build",
  "start:mastra": "mastra start",
  "typecheck": "tsc --noEmit"
}
```

As the monorepo grows, these should become workspace-aware:

```json
{
  "dev": "turbo dev",
  "build": "turbo build",
  "typecheck": "turbo typecheck",
  "test": "turbo test",
  "dev:mastra": "mastra dev",
  "start:mastra": "mastra start"
}
```

---

## 7. Nucleoid Decision

The requested Nucleoid package has been installed as:

```powershell
npm install nucleoidai@latest
```

Current installed version:

```txt
nucleoidai@0.7.10
```

Research conclusion:

- `nucleoidai` is the current package.
- `nucleoidjs` is older.
- `@nucleoidai/ide` does not currently resolve from npm.
- `@nucleoidai/expert` exists, but has weak CLI/bin signal.
- `nuclioed.ai` appears to be a typo or confusion with `nucleoid.ai`.
- `nucleoidai` currently brings moderate audit findings through old `uuid` dependencies.

Decision: Nucleoid is not the authoritative Logic Cortex for the MVP.

Correct role:

```txt
Core Cortex:
  Helmr-owned deterministic TypeScript policy checks.

Nucleoid:
  Optional experimental neuro-symbolic provider behind an adapter.
```

### 7.1 Nucleoid Adapter Contract

```typescript
export interface LogicProvider {
  name: string;
  explain(input: LogicInput): Promise<LogicExplanation>;
  suggest?(input: LogicInput): Promise<LogicSuggestion[]>;
}
```

Nucleoid may explain or suggest. It must not be the final allow/block authority until:

- Its package chain has clean audit status.
- Its APIs are stable enough for tests.
- Its behavior is deterministic enough for replay.
- Helmr has a full policy conformance test suite.

---

## 8. Data Contracts

### 8.1 HelmrEvent

```typescript
export interface HelmrEvent {
  id: string;
  createdAt: string;
  source: 'cli' | 'webhook' | 'chat' | 'cron' | 'heartbeat' | 'api';
  principal: {
    id: string;
    type: 'local-user' | 'service-account' | 'remote-user';
    trustLevel: 'owner' | 'trusted' | 'limited' | 'untrusted';
  };
  workspace: {
    id: string;
    path: string;
  };
  payload: {
    text: string;
    attachments?: Array<{ name: string; uri: string; kind: string }>;
  };
  requestedCapabilities: Capability[];
}
```

### 8.2 HelmrJob

```typescript
export interface HelmrJob {
  id: string;
  eventId: string;
  workspaceId: string;
  status: 'queued' | 'planning' | 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  lane: 'interactive' | 'background' | 'maintenance';
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  leaseUntil?: string;
}
```

### 8.3 HelmrPlan

```typescript
export interface HelmrPlan {
  id: string;
  jobId: string;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  steps: PlanStep[];
}

export interface PlanStep {
  id: string;
  title: string;
  kind: 'reason' | 'read' | 'write' | 'command' | 'browser' | 'mcp' | 'review';
  agent: 'council' | 'coding' | 'research' | 'fast' | 'browser' | 'none';
  canRunInParallelWith: string[];
  requiredCapabilities: Capability[];
}
```

### 8.4 ToolReceipt

```typescript
export interface ToolReceipt {
  id: string;
  jobId: string;
  stepId: string;
  tool: string;
  capability: Capability;
  input: unknown;
  risk: 'low' | 'medium' | 'high';
  approval: 'not_required' | 'required' | 'approved' | 'denied';
  createdAt: string;
}
```

### 8.5 Capability

```typescript
export type Capability =
  | 'workspace_read'
  | 'workspace_write'
  | 'shell_read'
  | 'shell_write'
  | 'git_read'
  | 'git_write'
  | 'network'
  | 'browser'
  | 'package_install'
  | 'service_install'
  | 'secrets_read';
```

---

## 9. Package Architecture

Recommended monorepo shape:

```txt
helmr/
  apps/
    hatchery-tui/
    hatchery-web/
  packages/
    shared/
    gateway/
    scheduler/
    cortex/
    hands/
    memory/
    mastra/
    council/
    router/
    subagents/
    mcp/
    browser/
    sandbox/
  scripts/
  docs/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

### 9.1 Package Purposes

`packages/shared`

- Zod schemas.
- TypeScript contracts.
- Error types.
- Capability definitions.

`packages/gateway`

- CLI and HTTP intake.
- Event normalization.
- Authentication.

`packages/scheduler`

- Durable queue.
- Lane priority.
- Lease handling.
- Retry policy.
- Workspace lock integration.

`packages/cortex`

- Plan validation.
- Tool receipt validation.
- Risk scoring.
- Approval matrix.
- Optional Nucleoid adapter.

`packages/hands`

- Safe filesystem, shell, git, package, and browser tool adapters.
- Output cleaning.
- Receipt execution.

`packages/memory`

- JSONL audit writer.
- SQLite state.
- FTS5 index.
- Replay helpers.

`packages/mastra`

- Mastra instance.
- Agents.
- Workflows.
- Tools.
- Memory adapters.

`apps/hatchery-tui`

- Terminal dashboard.
- Job list.
- Approval prompts.
- Log tail.

`apps/hatchery-web`

- Browser dashboard.
- Approvals.
- Logs.
- Memory browser.
- Settings.

---

## 10. Storage Strategy

### 10.1 MVP Local Mode

Use SQLite first.

```txt
.helmr/
  config/
    AGENTS.md
    TOOLS.md
    MODELS.md
    CHANNELS.md
    IDENTITY.md
  data/
    helmr.sqlite
    memory.sqlite
  audit/
    events.jsonl
    jobs.jsonl
    tools.jsonl
  logs/
    daemon.log
```

`HEARTBEAT.md` is intentionally not created by installer or Hatchery onboarding. It is created or updated only when the user asks for a recurring follow-up, reminder, monitor, or scheduled run through chat.

SQLite tables:

- `events`
- `jobs`
- `plans`
- `tool_receipts`
- `approvals`
- `runs`
- `memory_items`
- `workspace_locks`

SQLite FTS5 indexes:

- audit summaries.
- memory notes.
- workspace snippets.
- job results.

### 10.2 Scale Mode

Move durable job state and shared memory to Postgres.

Use:

- `@mastra/pg` for Mastra storage.
- `pg-boss` for durable queue.
- Postgres advisory locks for multi-worker workspace locks.
- `pgvector` later for shared vector memory.

---

## 11. Queue and Locking

### 11.1 MVP Queue

Start with a SQLite-backed job table:

- `queued`
- `leased`
- `running`
- `awaiting_approval`
- `succeeded`
- `failed`
- `cancelled`

Each worker claims jobs by transaction, setting `leaseUntil`.

### 11.2 Production Queue

Use Postgres and `pg-boss` when Helmr needs:

- multiple workers.
- retries.
- cron jobs.
- priorities.
- dead-letter queues.
- concurrency policies.

### 11.3 Workspace Locks

Local lock:

```txt
proper-lockfile
```

Scale lock:

```txt
Postgres advisory locks
```

Lock levels:

- `read`: indexing, summarization, inspection.
- `write`: editing files, package install, formatters, git writes.
- `exclusive`: migrations, service install, destructive operations.

---

## 12. Model Routing

Helmr should support one-provider mode and multi-provider orchestrator mode. Hatchery owns provider setup, model selection, credential entry, handshake testing, and routing assignment. The installer and CLI must not ask provider or model questions during normal setup.

Installed provider packages:

```txt
@ai-sdk/openai
@ai-sdk/anthropic
@ai-sdk/google
@ai-sdk/perplexity
@ai-sdk/groq
@ai-sdk/xai
```

Provider cards shown in Hatchery:

```txt
OpenAI
Anthropic
Google Gemini
Moonshot / Kimi
DeepSeek
xAI / Grok
OpenRouter
Ollama local
```

Provider status model:

```txt
not_configured
instructions_viewed
credentials_entered
handshake_testing
connected
pairing_required
paired
active
failed
disabled
```

Authentication methods:

- API key where supported.
- CLI configuration where an official local CLI is available.
- OAuth only when the provider offers an official supported flow.
- Ollama local endpoint URL.

Hatchery must show exact setup instructions for each provider: where to get credentials, what the credential does, where it is stored, how the handshake works, and what success looks like. Secrets must never be written to Markdown config or shown in logs.

Model lists are dynamically fetched where possible. Static model lists are fallback examples only because provider model names change over time. A custom model string is always available, but it must pass a handshake or require an explicit "save unverified" confirmation.

Routing is config-driven:

```yaml
default:
  provider: anthropic
  model: claude-sonnet-latest

tasks:
  planning:
    provider: anthropic
    model: claude-opus-latest
  coding:
    provider: anthropic
    model: claude-sonnet-latest
  research:
    provider: google
    model: gemini-pro-latest
  speed:
    provider: groq
    model: fast-default
```

Multi-provider orchestrator mode requires at least two connected providers. The user assigns a primary high-tier model and optional secondary cheaper/local models. The router can offload low-risk, simple, administrative, or cost-sensitive work to cheaper models, but advanced reasoning, risky operations, architecture decisions, and final synthesis must escalate to the primary model.

Do not hard-code claims like "provider X is always best." Do not add a default Perplexity provider. Store routing as policy and let users override it in `MODELS.md`.

---

## 13. Hands Tool Runtime

Hands is the only layer that touches tools.

Tool categories:

- Filesystem read.
- Filesystem write.
- Shell read.
- Shell write.
- Git read.
- Git write.
- Package install.
- Browser automation.
- MCP tool.
- Service install.

Hands must:

- Receive only validated tool receipts.
- Enforce workspace boundaries.
- Redact secrets from output.
- Remove noisy terminal control output.
- Stream structured progress.
- Persist stdout/stderr summaries.
- Return typed `ToolResult`.

Dangerous operations require approval:

- recursive delete.
- global package install.
- package lock mutation.
- environment file edits.
- git push.
- service install.
- secret access.

---

## 14. Hatchery

Hatchery is the human control room.

Hatchery owns onboarding and configuration after the bootstrap installer starts the local runtime. The CLI is bootstrap and admin only; it must not ask normal users workspace, provider, model, channel, tool, or personality questions.

Hatchery WebUI is the primary onboarding surface. Hatchery TUI should mirror the same flow for terminal-only users.

Hatchery onboarding responsibilities:

- Show system readiness: hardware, OS, shell, Node, npm, Git, disk, permissions, and network.
- Ask workspace and deployment-profile questions.
- Configure providers, credentials, model roles, and routing.
- Configure channels and show detailed connection instructions.
- Configure tools and approval boundaries.
- Build the agent identity/personality profile.
- Run channel pairing handshakes.
- Run self-tests and mark the system ready.

Hatchery runtime responsibilities:

- active jobs.
- queued jobs.
- plan preview.
- approvals.
- logs.
- final result.
- provider/channel health.
- pairing status.
- setup recovery steps.

Default ports:

```txt
Gateway API: 3999
Hatchery WebUI: 4000
Sub-agent IPC: 1899
Nucleoid optional panel: disabled by default
```

Hatchery must never be the source of truth. It reads from the control plane.

Hatchery writes:

```txt
.helmr/config/AGENTS.md
.helmr/config/TOOLS.md
.helmr/config/MODELS.md
.helmr/config/CHANNELS.md
.helmr/config/IDENTITY.md
```

Hatchery does not write:

```txt
.helmr/config/HEARTBEAT.md
```

`HEARTBEAT.md` is created or updated only through chat/runtime scheduling requests such as "remind me every morning", "check this repo every Friday", or "keep watching this job".

---

## 15. Installation Design

The installation experience must be:

```txt
install -> system/runtime checks -> Helmr/Mastra/Nucleoid install -> daemon start -> Hatchery onboarding -> provider setup -> channel setup -> pairing -> ready
```

The user should not need to understand Mastra, Nucleoid, workspaces, queues, or config files to begin.

The installer remains bootstrap-only. Hatchery owns all onboarding and setup screens after the runtime starts.

### 15.1 Correct npm Create Model

Research finding from npm behavior:

```txt
npm create helmr@latest
```

is equivalent to:

```txt
npm exec create-helmr@latest
```

The `@latest` suffix is intentional. npm can use an already installed or cached initializer when no version is specified. Writing `@latest` tells npm to resolve the current `latest` dist-tag from the registry and run that version. This is important for an installer because bug fixes, Node compatibility checks, and security patches should reach new users immediately.

Therefore Helmr needs at least two npm packages:

```txt
create-helmr
helmr
```

Optional later package:

```txt
helmr-agent
```

Recommended naming:

```txt
create-helmr:
  npm initializer package.
  Scaffolds or configures a Helmr workspace.

helmr:
  actual CLI and runtime package.
  Provides bin command `helmr`.

helmr-agent:
  optional alias or compatibility package later.
  Avoid it for MVP unless there is a strong branding reason.
```

### 15.2 User Install Commands

Primary first-run command:

```powershell
npm create helmr@latest
```

OpenClaw-style one-liner alternatives:

```powershell
powershell -c "irm https://helmr.ai/install.ps1 | iex"
```

```bash
curl -fsSL https://helmr.ai/install.sh | bash
```

These scripts should be thin wrappers around the same installer logic. They should detect the OS, verify Node.js/npm, install or invoke `create-helmr@latest`, start Gateway/Hatchery, and then open Hatchery onboarding. They must print what they are about to do before making changes, and they must support a dry run:

```powershell
powershell -c "irm https://helmr.ai/install.ps1 | iex" --dry-run
```

```bash
curl -fsSL https://helmr.ai/install.sh | bash -s -- --dry-run
```

Direct CLI install:

```powershell
npm install -g helmr@latest
helmr start --open-hatchery
```

One-shot no-global command:

```powershell
npx helmr@latest start --open-hatchery
```

Developer install from repo:

```powershell
git clone <repo-url> helmr
cd helmr
npm install
npm run typecheck
npm run dev
```

### 15.3 What `create-helmr` Does

`create-helmr` is a thin bootstrapper.

Responsibilities:

1. Detect hardware, OS, shell, permissions, disk, network, Node.js, npm, and Git.
2. Install or guide Node.js setup if missing or unsupported.
3. Create the minimum runtime directory if needed.
4. Install `helmr@latest`.
5. Ensure Mastra and Nucleoid runtime dependencies are available.
6. Start Gateway and Hatchery.
7. Open Hatchery onboarding.

It should not contain the whole runtime.

`create-helmr` must not ask model, provider, channel, workspace, tool, or personality questions in the terminal during the normal path.

### 15.4 Hatchery Onboarding

Hatchery onboarding performs guided setup:

1. Show system readiness:
   - CPU architecture.
   - RAM and disk.
   - OS and shell.
   - Node.js and npm.
   - Git.
   - network.
   - local write permissions.
2. Choose deployment profile:
   - local.
   - wsl2.
   - vps.
   - container.
3. Choose workspace path.
4. Create `.helmr/` state directories.
5. Create Hatchery-managed config files:
   - `AGENTS.md`
   - `TOOLS.md`
   - `MODELS.md`
   - `CHANNELS.md`
   - `IDENTITY.md`
6. Configure model providers and routing.
7. Validate credentials without printing them.
8. Choose storage mode:
   - SQLite local.
   - Postgres advanced.
9. Configure communication channels.
10. Build personality/identity profile.
11. Run pairing handshakes.
12. Run self-test.
13. Show ready state and exact next command.

Hatchery must not create or modify `HEARTBEAT.md`. Heartbeats are created later through chat.

### 15.5 First-Run UX

Target terminal experience:

```txt
npm create helmr@latest

Helmr setup

1. Checking hardware and OS
2. Checking Node.js, npm, Git, permissions, and network
3. Installing Helmr runtime
4. Preparing Mastra and Nucleoid runtime dependencies
5. Starting Gateway and Hatchery
6. Opening Hatchery onboarding

Continue setup in Hatchery:
  http://localhost:4000

The terminal can stay open for logs or be closed after Hatchery confirms the daemon is running.
```

### 15.6 Self-Test

Self-test checks:

- Node version.
- npm version.
- package install.
- writable `.helmr` directory.
- SQLite open/read/write.
- model provider configuration.
- channel configuration.
- pairing status.
- Mastra runtime import.
- basic planner mock.
- Cortex policy evaluation.
- Hands read-only command.
- Hatchery API/TUI connection.

Self-test should not require an expensive model call unless the user explicitly chooses "test provider calls."

### 15.7 Windows and WSL2

Because this project is currently on Windows, the installer must handle:

- PowerShell execution.
- Windows paths.
- WSL2 paths.
- long path warnings.
- antivirus delays around `node_modules`.
- service installation through Task Scheduler, not systemd.

Windows service command:

```powershell
helmr install-service --windows
```

WSL2 service command:

```bash
helmr install-service --wsl2
```

### 15.8 Installer Package Dependencies

`create-helmr` should stay small:

```txt
@clack/prompts
execa
fs-extra
semver
picocolors
```

`helmr` owns runtime dependencies:

```txt
@mastra/core
@mastra/memory
@mastra/mcp
@mastra/libsql
@mastra/pg
@ai-sdk/openai
@ai-sdk/anthropic
@ai-sdk/google
@ai-sdk/perplexity
@ai-sdk/groq
@ai-sdk/xai
zod
commander
better-sqlite3
drizzle-orm
pino
proper-lockfile
```

Optional:

```txt
nucleoidai
playwright
ink
next
```

Nucleoid should not be installed automatically in the default MVP path until the audit issue is resolved or explicitly accepted by the user.

---

## 16. Channel Configuration and Pairing

Hatchery is the only normal place to configure channels. Every channel card must show:

- What external account, app, token, file, or local daemon is required.
- Where the user goes outside Helmr to create it.
- What the credential is used for.
- What permissions the channel receives.
- How the connection test works.
- How pairing works.
- What success and failure look like.

Channel status model:

```txt
not_configured
instructions_viewed
credentials_entered
handshake_testing
connected
pairing_required
paired
active
failed
disabled
```

No channel can enqueue jobs, run tools, or send commands into Helmr until pairing succeeds.

### 16.1 WebChat

WebChat requires no external API keys.

Setup:

1. Hatchery enables the local WebSocket channel.
2. The channel is bound to the active Hatchery browser/TUI session.
3. The current local user is treated as the owner principal.

Pairing:

- Manual token pairing is skipped because the user is already authenticated in Hatchery.

Success:

- Hatchery shows "WebChat active".

### 16.2 WhatsApp

Setup:

1. Hatchery shows Linked Devices instructions.
2. Hatchery starts the WhatsApp channel adapter.
3. Hatchery renders a QR login frame or terminal-compatible QR panel.
4. The user opens WhatsApp on their phone, goes to Linked Devices, and scans the QR code.

Pairing:

1. Hatchery asks for the administrator phone number.
2. The bot sends a direct message containing a single-use pairing code.
3. The user enters that code in Hatchery.
4. Hatchery marks the admin account paired.

Permissions:

- Default: message intake only.
- Tool execution requires explicit tool policy approval.

### 16.3 Telegram

Setup:

1. Hatchery instructs the user to message `@BotFather`.
2. The user creates a bot.
3. The user pastes the HTTP API token into Hatchery.
4. Hatchery tests the bot token.

Pairing:

1. Hatchery instructs the user to retrieve their Telegram numeric user ID.
2. The user enters that ID.
3. The bot sends the user a pairing code.
4. The user enters the code in Hatchery.

### 16.4 Discord

Setup:

1. Hatchery shows Discord Developer Portal instructions.
2. The user creates an application and bot.
3. The user enables required bot privileges.
4. The user enters bot token, master admin user ID, and primary server ID.
5. Hatchery tests bot login and server access.

Pairing:

1. The bot sends a DM activation code to the master admin user ID.
2. The user enters that code in Hatchery.

### 16.5 Slack

Setup:

1. Hatchery generates an App Manifest YAML/JSON block.
2. The user pastes it into Slack Developer Portal.
3. The user enables Socket Mode.
4. The user enters Bot User OAuth Token and App-Level Token.
5. Hatchery tests Socket Mode connectivity.

Pairing:

1. The user opens the bot app DM in Slack.
2. The user sends any pairing prompt.
3. The bot returns a validation code.
4. The user enters the code in Hatchery.

### 16.6 Google Chat

Setup:

1. Hatchery shows Google Cloud setup instructions.
2. The user provides service account credentials JSON by file path or paste.
3. Hatchery validates the service account and target workspace/audience.

Pairing:

1. The user opens a direct message or Space with the bot app.
2. The bot replies with a pairing code.
3. The user enters the code in Hatchery.

### 16.7 Signal

Setup:

1. Hatchery detects a local `signal-cli` daemon or shows installation instructions.
2. Hatchery validates daemon reachability.
3. Hatchery does not create unsafe symlinks or hidden permission changes automatically.

Pairing:

1. The user sends a direct message from their personal number to the bot number.
2. The bot replies with a pairing code.
3. The user enters the code in Hatchery.

### 16.8 IRC

Setup fields:

```txt
server host
network port
TLS enabled
channel target
bot nickname
SASL/OAuth credentials
```

Pairing:

1. The bot joins the configured channel.
2. The user opens a private query with the bot nickname.
3. The user sends a pairing message.
4. The bot whispers a pairing code.
5. The user enters the code in Hatchery.

### 16.9 Microsoft Teams

Setup:

1. Hatchery shows Azure Bot Framework instructions.
2. The user enters app registration values and tenant configuration.
3. Hatchery validates the bot registration.

Pairing:

1. The user opens a direct chat with the Teams bot.
2. The user sends a pairing prompt.
3. The bot returns a pairing code.
4. The user enters the code in Hatchery.

### 16.10 WeChat

Setup:

1. Hatchery shows a third-party wrapper warning.
2. Hatchery starts the configured wrapper.
3. Hatchery renders a QR login handshake.

Pairing:

1. The user adds or messages the bot account.
2. The bot sends a pairing code.
3. The user enters the code in Hatchery.

### 16.11 iMessage

iMessage is macOS-only and advanced.

Setup:

1. Hatchery checks OS and architecture.
2. Hatchery explains the required local permissions.
3. Hatchery must not silently modify system files, database permissions, or privacy permissions.
4. The user must explicitly approve any local bridge setup.

Pairing:

1. The gateway sends a temporary verification token to the administrator Apple ID or phone number.
2. The user enters the token in Hatchery.

### 16.12 Pairing Security Rules

- Pairing codes are single-use.
- Pairing codes expire quickly.
- Pairing codes are never logged in plaintext.
- Failed pairing leaves the channel disabled or pairing-required.
- Unpaired channels cannot enqueue jobs.
- Paired channels still obey tool policy, model policy, and approval gates.

---

## 17. MVP Scope

The MVP should prove the spine, not the whole future.

MVP includes:

- Local CLI trigger.
- SQLite job store.
- Workspace locks.
- Zod contracts.
- Mock planner or one real model provider.
- Mastra Council agent.
- Cortex plan validation.
- Hands read-only shell/git/file tools.
- JSONL audit logs.
- Hatchery TUI basics.
- Typecheck and tests.

MVP defers:

- WebUI.
- remote chat channels.
- plugin marketplace.
- dynamic MCP installation.
- self-healing agents.
- Nucleoid as core policy engine.
- Docker sandbox.
- long-running multi-day jobs.
- Temporal/Inngest.
- multi-tenant cloud operation.

### 17.1 MVP Demo

The first demo:

```txt
helmr ask "summarize this workspace and identify next development steps"
```

Expected behavior:

1. Event created.
2. Job queued.
3. Council plans read-only inspection.
4. Cortex approves because it is read-only.
5. Hands reads files and package metadata.
6. Memory writes JSONL audit records.
7. Hatchery shows progress.
8. Final answer summarizes workspace state and next steps.

---

## 18. Implementation Roadmap

### Phase 0: Repo Foundation

- Convert to workspace monorepo.
- Add `packages/shared`.
- Add base TypeScript config.
- Add lint/test/build scripts.
- Keep Mastra and Nucleoid installed.
- Add basic CI commands locally.

Exit criteria:

```powershell
npm run typecheck
npm test
```

### Phase 1: Shared Contracts

- `HelmrEvent`
- `HelmrJob`
- `HelmrPlan`
- `PlanStep`
- `ToolReceipt`
- `ToolResult`
- `Capability`

Exit criteria:

- schemas compile.
- schema tests pass.

### Phase 2: Gateway and CLI

- `helmr ask`
- `helmr status`
- `helmr hatchery`
- event normalization.

Exit criteria:

- local CLI creates a queued job.

### Phase 3: Scheduler and Memory

- SQLite job store.
- JSONL audit writer.
- workspace lock.
- retry and lease basics.

Exit criteria:

- job can move queued to running to succeeded.

### Phase 4: Cortex

- deterministic policy engine.
- approval matrix.
- tool receipt validation.
- Nucleoid optional adapter stub.

Exit criteria:

- unsafe write command is blocked.
- safe read command is allowed.

### Phase 5: Mastra Council

- Mastra instance.
- Council agent.
- simple workflow.
- model provider config.

Exit criteria:

- planner can produce typed plan JSON.

### Phase 6: Hands

- read-only shell.
- git status/log.
- file read.
- output cleaner.

Exit criteria:

- only approved receipts execute.

### Phase 7: Hatchery Onboarding

- WebUI onboarding flow.
- TUI mirror for terminal-only users.
- provider cards.
- channel cards.
- pairing screens.
- config preview.
- self-test results.

Exit criteria:

- Hatchery can create `AGENTS.md`, `TOOLS.md`, `MODELS.md`, `CHANNELS.md`, and `IDENTITY.md`.
- Hatchery does not create or modify `HEARTBEAT.md`.

### Phase 8: Hatchery Runtime

- active job list.
- log view.
- approval prompt.
- result view.

Exit criteria:

- MVP demo visible in Hatchery.

### Phase 9: Installer

- `create-helmr`.
- hosted `install.ps1`.
- hosted `install.sh`.
- system/runtime checks.
- Gateway start.
- Hatchery open.
- self-test.
- `install -> Hatchery onboarding -> pairing -> ready` flow.

Exit criteria:

```powershell
npm create helmr@latest
```

works from a clean directory after packages are published.

---

## 19. Testing Strategy

Unit tests:

- schema validation.
- config parsing.
- risk scoring.
- approval matrix.
- command policy.

Integration tests:

- CLI to queue.
- queue to worker.
- worker to Cortex.
- Cortex to Hands.
- Hands to audit.
- Hatchery writes the expected config files.
- Hatchery does not write `HEARTBEAT.md`.

End-to-end tests:

- `helmr ask` read-only workspace summary.
- denied dangerous command.
- approval-required package install.
- self-test.
- onboarding dry run.
- installer opens Hatchery without asking provider/channel/model questions in terminal.
- provider card validates credentials and custom model strings.
- channel card blocks activation until pairing succeeds.

Security tests:

- path traversal blocked.
- env secret redaction.
- untrusted event cannot write.
- package install requires approval.
- workspace lock prevents concurrent writes.
- secrets never appear in Markdown config, logs, previews, or audit output.
- pairing codes are single-use, expiring, and redacted.

---

## 20. Research Sources

Mastra:

- https://mastra.ai/docs
- https://mastra.ai/en/docs/local-dev/creating-a-new-project
- https://mastra.ai/en/docs/tools-mcp/mcp-overview
- https://mastra.ai/ai-agent-framework
- https://github.com/mastra-ai/mastra
- https://www.npmjs.com/package/@mastra/core

Nucleoid:

- https://github.com/NucleoidAI/Nucleoid
- https://www.npmjs.com/package/nucleoidai

npm create behavior:

- https://docs.npmjs.com/cli/v11/commands/npm-init/

Supporting package directions:

- https://www.npmjs.com/package/better-sqlite3
- https://orm.drizzle.team/docs/overview
- https://github.com/timgit/pg-boss
- https://www.sqlite.org/fts5.html
- https://ts.sdk.modelcontextprotocol.io/

---

## 21. Final Architecture Decision

Helmr should be built as:

```txt
Self-hosted TypeScript agent orchestrator
with a deterministic control plane,
Mastra-powered reasoning plane,
receipt-based execution plane,
SQLite-first local state,
Hatchery as the human control room,
and a real npm installer flow:
install -> system/runtime checks -> runtime install -> daemon start -> Hatchery onboarding -> channel pairing -> ready.
```

Mastra is core.

Nucleoid is installed for R&D but optional in architecture.

The first engineering milestone is not "all agents forever." It is a safe local loop:

```txt
helmr ask -> event -> job -> plan -> verify -> read-only tools -> audit -> Hatchery -> answer
```

Once that loop is solid, Helmr can grow into parallel sub-agents, browser tools, MCP integrations, WebUI, remote channels, and long-running autonomous workflows.
