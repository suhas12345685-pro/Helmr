# Soul & Embodiment

Two core architecture layers: Helmr's **soul** (who it is) and its **embodiment
runtime** (how it spins up many independent agents with their own bodies).

---

## 1. `soul.md` — the constitution

`/soul.md` (repo root) is Helmr's identity, loyalty rules, and operating
principles. It is the **source of truth**: the runtime loads it; the code never
owns the text. If `soul.md` and code disagree, `soul.md` wins.

It defines who Helmr is, who the Operator is, the Prime Directive, personality,
operating instincts, loyalty rules, **Chaos Mode** (how to behave when the user
is angry/stressed/confused/rushing or making architecture decisions), autonomy
boundaries, multi-agent coordination philosophy, privacy/trust, failure
behavior, voice, and a "Never Forget" list.

### Loading it

`src/soul.ts` provides the loader:

```ts
import { loadSoul, buildSoulContext, SoulLoader } from './soul.js';

loadSoul();          // { found, path, content, error? } — cached, never throws
buildSoulContext();  // prompt-ready <helmr-soul> block, or '' if missing
new SoulLoader(path) // explicit path / custom logger, e.g. for tests
```

Behavior:

- Resolves `HELMR_SOUL_PATH` → `<cwd>/soul.md` → repo-root `soul.md`.
- Validates the file exists and is non-empty.
- **Fails safe**: a missing/empty/unreadable soul logs a clear `[soul] …` error
  and returns `{ found: false, content: '' }` instead of throwing.
- `buildSoulContext()` is spliced into the council and coding prompts in
  `src/runtime.ts`, so Helmr reasons inside its constitution. If the soul is
  missing, the splice is a harmless empty string.

To edit Helmr's soul, edit `soul.md`. To re-read after a change, call
`SoulLoader.reload()`.

---

## 2. Multi-Agent Embodied Operator Runtime

`packages/embodiment` lets Helmr spin up many agents, each with its own isolated
**body**. A body is: virtual eyes (`VisualPerceptionStream`), a `VirtualKeyboard`,
a `VirtualMouse`, an isolated workspace + session, a memory/log stream, a task
lifecycle, and a coordination channel.

### The hard rule

**No agent ever touches the Operator's real keyboard, mouse, or desktop cursor.**
Five agents do not fight over one cursor or one browser window. Each agent gets
its own workspace and its own virtual input layer. The user's machine is theirs.

### Layered architecture

```
HELMR Core / Brain
  └─ Soul Layer (soul.md + SoulLoader)
  └─ Council / Orchestrator
       └─ MultiAgentRuntime
            ├─ WorkspaceProvider  (mock | browser | container | vm | vnc | app)
            │    └─ per-agent: VisualPerceptionStream + VirtualKeyboard + VirtualMouse
            ├─ AgentBody[]        (one isolated body per agent)
            ├─ CoordinationBus    (direct / broadcast / orchestrator messages)
            ├─ TaskLedger         (append-only record of everything)
            └─ Permission System  (zones; deny-by-default)
```

### Live visual perception ≠ screenshots

This is **not** a screenshot→OCR→click-coordinate loop. The abstraction is a
`VisualPerceptionStream` whose unit is a structured `VisualObservation`:

```ts
type VisualObservation = {
  agentId; workspaceId; timestamp;
  visibleText?; uiElements?; focusedElement?; cursor?;
  appState?; changeSummary?; rawVisualRef?;
};
```

The agent perceives **understood UI state over time** — roles, names, text, form
fields, focus, loading/error states, and what *changed* since the last
observation — sourced from a browser accessibility tree / DOM, with raw frame
input available when structure isn't enough. The loop is:

```
observe live workspace → understand current UI state → decide next action
   → act through virtual hands → observe the change → continue
```

`rawVisualRef` is an opaque pointer to a frame if a CV/vision model needs pixels.
It is deliberately *not* the product abstraction — perception is structured first.

### Providers

A `WorkspaceProvider` creates isolated workspaces and attaches a body to each:

```ts
interface WorkspaceProvider {
  readonly kind: WorkspaceKind;
  createWorkspace(req: WorkspaceRequest): Promise<WorkspaceHandle>;
  destroyWorkspace(workspaceId: string): Promise<void>;
  attachVision(workspaceId: string): Promise<VisualPerceptionStream>;
  attachKeyboard(workspaceId: string): Promise<VirtualKeyboard>;
  attachMouse(workspaceId: string): Promise<VirtualMouse>;
}
```

Shipped providers:

- **`MockWorkspaceProvider`** — the working, fully-tested provider. Each
  workspace is an isolated in-memory "screen" with its own UI elements, cursor,
  and typed values. Proves the whole model (isolation, independent input,
  permission enforcement) with no real browser.
- **`BrowserWorkspaceProvider`** — the browser path. Each agent gets its own
  isolated browser **context** (own cookies/storage/page), never the Operator's
  browser. It is **driver-injected** (`BrowserDriver`) so no heavy automation
  dependency is bundled — plug in Playwright, Puppeteer, or a CDP/remote-browser
  driver. Perception comes from DOM/accessibility snapshots + change events.

#### Adding a new provider

Implement `WorkspaceProvider` for your surface (container desktop, VM, VNC/noVNC,
app automation). Each `attach*` must return input/perception bound to **that one
workspace** and must enforce permissions. Hand the provider to
`new MultiAgentRuntime(provider)` — nothing else changes.

### Coordination

Agents talk through a `CoordinationBus` instead of guessing:

```ts
type AgentMessage = {
  fromAgentId; toAgentId?;
  channel: "direct" | "broadcast" | "orchestrator";
  type: "status" | "handoff" | "question" | "result" | "error" | "heartbeat";
  payload; timestamp;
};
```

- `direct` → one agent, `broadcast` → all others, `orchestrator` → Helmr.
- The orchestrator observes direct and broadcast traffic too, for the ledger.
- Every message is recorded in `bus.history()`.

### Task ledger

`TaskLedger` is the append-only record of what every agent does — task id,
assigned agent, workspace, status, actions, observations, errors, result, and
timestamps. It exists for debugging, trust, replay, and safety.

### Permission model (deny-by-default)

Agents do **not** get unlimited access. Zones:

`read_only`, `browser_safe`, `workspace_only`, `local_files_read`,
`local_files_write`, `external_network`, `dangerous_action_requires_user_approval`.

Default for a new agent is `['read_only', 'workspace_only']`. Virtual input
requires `workspace_only` (a `read_only` agent can observe but not type/click).
Browser navigation requires `browser_safe`. Dangerous actions require user
approval unless the dangerous-action zone is explicitly granted.

### Example: parallel research swarm

```ts
const runtime = new MultiAgentRuntime(new MockWorkspaceProvider(), { mode: 'swarm' });

const [research, verify, writer, qa] = await runtime.spawnAgents([
  { role: 'research', workspaceKind: 'browser-context', permissions: ['read_only','workspace_only','browser_safe'] },
  { role: 'verify',   workspaceKind: 'browser-context', permissions: ['read_only','workspace_only','browser_safe'] },
  { role: 'writer',   permissions: ['read_only','workspace_only'] },
  { role: 'qa',       permissions: ['read_only','workspace_only'] },
]);

runtime.assignTask(research.agentId, { description: 'Research competitors + pricing' });
// agents observe their own workspaces, act through their own hands, and
// coordinate via runtime.bus; the orchestrator merges runtime.collectResults().
```

They work in parallel, can message each other when needed, are tracked in the
ledger, and the orchestrator merges their output into one result — while the
Operator's real keyboard and mouse stay untouched.
