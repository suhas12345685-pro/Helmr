import {
  BrowserActionSchema,
  browserActionRisk,
  type BrowserAction,
} from './actions.js';
import {
  NullBrowserDriver,
  type BrowserDriver,
  type BrowserActionResult,
} from './driver.js';

export interface BrowserSessionOptions {
  driver?: BrowserDriver;
  /** Whether the controlling job was granted the `browser` capability. */
  browserCapabilityGranted?: boolean;
}

/**
 * Wraps a browser driver with the same guardrails as the rest of the execution
 * plane: every action is schema-validated, the `browser` capability must be
 * granted before anything runs, and a history is kept for the audit trail.
 */
export class BrowserSession {
  private readonly driver: BrowserDriver;
  private readonly granted: boolean;
  readonly history: Array<{ action: BrowserAction; result: BrowserActionResult }> = [];

  constructor(options: BrowserSessionOptions = {}) {
    this.driver = options.driver ?? new NullBrowserDriver();
    this.granted = options.browserCapabilityGranted ?? false;
  }

  get driverName(): string {
    return this.driver.name;
  }

  async run(input: unknown): Promise<BrowserActionResult> {
    if (!this.granted) {
      throw new Error('browser capability not granted for this job');
    }

    const action = BrowserActionSchema.parse(input);
    const available = await this.driver.isAvailable();
    if (!available) {
      const result: BrowserActionResult = {
        kind: action.kind,
        ok: false,
        error: `browser driver "${this.driver.name}" is not available`,
      };
      this.history.push({ action, result });
      return result;
    }

    const result = await this.driver.execute(action);
    this.history.push({ action, result });
    return result;
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

/**
 * Builds the input object for a `request_receipt` call from a browser action,
 * so the browser agent routes through the same approval pipeline as every
 * other tool. The capability is always `browser`.
 */
export function browserReceiptInput(
  jobId: string,
  stepId: string,
  action: BrowserAction,
): {
  jobId: string;
  stepId: string;
  tool: string;
  capability: 'browser';
  input: BrowserAction;
  risk: 'low' | 'medium';
} {
  const parsed = BrowserActionSchema.parse(action);
  return {
    jobId,
    stepId,
    tool: `browser_${parsed.kind}`,
    capability: 'browser',
    input: parsed,
    risk: browserActionRisk(parsed),
  };
}
