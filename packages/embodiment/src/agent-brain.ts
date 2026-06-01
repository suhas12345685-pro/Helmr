import type { AgentBody, AgentMessageType, VisualObservation } from './types.js';

/**
 * The agent brain loop.
 *
 * This is the perception -> decision -> action -> perception loop that turns a
 * passive AgentBody into a working operator:
 *
 *   observe live workspace -> understand UI state -> decide next action
 *      -> act through virtual hands -> observe the change -> continue
 *
 * The "decision" is pluggable via AgentDecider. A scripted decider drives it
 * deterministically (tests, simple automations); a Mastra-backed decider
 * (packages/mastra) drives it with an LLM. The loop itself is model-agnostic.
 */

export type AgentAction =
  | { type: 'observe' }
  | { type: 'focus'; target: string }
  | { type: 'type'; target?: string; text: string }
  | { type: 'press'; key: string }
  | { type: 'shortcut'; keys: string[] }
  | { type: 'click'; x?: number; y?: number }
  | { type: 'doubleClick'; x?: number; y?: number }
  | { type: 'rightClick'; x?: number; y?: number }
  | { type: 'scroll'; dx: number; dy: number }
  | { type: 'hover'; x: number; y: number }
  | { type: 'wait'; ms?: number }
  | {
      type: 'message';
      channel: 'broadcast' | 'orchestrator' | 'direct';
      toAgentId?: string;
      messageType: AgentMessageType;
      payload: unknown;
    }
  | { type: 'done'; result: unknown }
  | { type: 'fail'; error: string };

export interface BrainContext {
  agentId: string;
  role: string;
  task: string;
  step: number;
  observation: VisualObservation;
  history: AgentAction[];
}

export interface AgentDecider {
  decide(context: BrainContext): Promise<AgentAction>;
}

export interface RunAgentLoopOptions {
  task: string;
  decider: AgentDecider;
  maxSteps?: number;
  onStep?: (context: BrainContext, action: AgentAction) => void;
}

export interface AgentLoopResult {
  status: 'done' | 'failed' | 'max_steps';
  result?: unknown;
  error?: string;
  steps: number;
}

export async function runAgentLoop(
  body: AgentBody,
  options: RunAgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxSteps = options.maxSteps ?? 12;
  const history: AgentAction[] = [];

  body.status = 'working';
  body.taskState = {
    ...body.taskState,
    description: options.task,
    status: 'in_progress',
    startedAt: body.taskState.startedAt ?? new Date().toISOString(),
  };

  for (let step = 0; step < maxSteps; step++) {
    const observation = await body.vision.observe();
    const context: BrainContext = {
      agentId: body.agentId,
      role: body.role,
      task: options.task,
      step,
      observation,
      history: [...history],
    };

    const action = await options.decider.decide(context);
    history.push(action);
    body.memory.append('action', action);
    options.onStep?.(context, action);
    body.lastHeartbeatAt = new Date().toISOString();

    try {
      if (action.type === 'done') {
        body.taskState = {
          ...body.taskState,
          status: 'done',
          result: action.result,
          finishedAt: new Date().toISOString(),
        };
        body.status = 'idle';
        return { status: 'done', result: action.result, steps: step + 1 };
      }
      if (action.type === 'fail') {
        body.taskState = { ...body.taskState, status: 'failed', error: action.error };
        body.status = 'error';
        return { status: 'failed', error: action.error, steps: step + 1 };
      }
      await applyAction(body, action);
    } catch (err) {
      const message = (err as Error).message;
      body.memory.append('action_error', message);
      body.taskState = { ...body.taskState, status: 'failed', error: message };
      body.status = 'error';
      return { status: 'failed', error: message, steps: step + 1 };
    }
  }

  body.taskState = { ...body.taskState, status: 'failed', error: 'max steps reached' };
  body.status = 'error';
  return { status: 'max_steps', steps: maxSteps };
}

async function applyAction(body: AgentBody, action: AgentAction): Promise<void> {
  switch (action.type) {
    case 'observe':
      return;
    case 'focus':
      await body.keyboard.focus(action.target);
      return;
    case 'type':
      if (action.target) await body.keyboard.sendText(action.target, action.text);
      else await body.keyboard.type(action.text);
      return;
    case 'press':
      await body.keyboard.pressKey(action.key);
      return;
    case 'shortcut':
      await body.keyboard.pressShortcut(action.keys);
      return;
    case 'click':
      await body.mouse.click(action.x, action.y);
      return;
    case 'doubleClick':
      await body.mouse.doubleClick(action.x, action.y);
      return;
    case 'rightClick':
      await body.mouse.rightClick(action.x, action.y);
      return;
    case 'scroll':
      await body.mouse.scroll(action.dx, action.dy);
      return;
    case 'hover':
      await body.mouse.hover(action.x, action.y);
      return;
    case 'wait':
      if (action.ms) await new Promise((r) => setTimeout(r, action.ms));
      return;
    case 'message':
      body.communicationChannel.send({
        channel: action.channel,
        toAgentId: action.toAgentId,
        type: action.messageType,
        payload: action.payload,
      });
      return;
    default:
      // done/fail handled by the caller
      return;
  }
}

/** A deterministic decider that plays a fixed list of actions, then is done. */
export class ScriptedDecider implements AgentDecider {
  private index = 0;
  constructor(private readonly script: AgentAction[]) {}
  async decide(): Promise<AgentAction> {
    const action = this.script[this.index];
    this.index += 1;
    return action ?? { type: 'done', result: null };
  }
}
