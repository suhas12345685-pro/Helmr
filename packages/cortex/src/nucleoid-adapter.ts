import type { LogicProvider, LogicInput, LogicExplanation, LogicSuggestion } from './logic-provider.js';
import { evaluatePlan, evaluateToolReceipt } from './policy.js';

export interface NucleoidAdapterOptions {
  enabled?: boolean;
}

export class NucleoidLogicProvider implements LogicProvider {
  readonly name = 'nucleoid';
  private readonly enabled: boolean;
  private nucleoid: { run: (code: string) => unknown } | null = null;

  constructor(options: NucleoidAdapterOptions = {}) {
    this.enabled = options.enabled ?? false;

    if (this.enabled) {
      this.tryLoadNucleoid();
    }
  }

  private tryLoadNucleoid(): void {
    try {
      // nucleoidai is CommonJS — dynamic import needed in ESM context
      const mod = require('nucleoidai') as { run: (code: string) => unknown };
      this.nucleoid = mod;
    } catch {
      this.nucleoid = null;
    }
  }

  async explain(input: LogicInput): Promise<LogicExplanation> {
    const helmrDecision =
      input.kind === 'plan' && input.plan
        ? evaluatePlan(input.plan)
        : input.kind === 'receipt' && input.receipt
          ? evaluateToolReceipt(input.receipt)
          : { allowed: true, requiresApproval: false, reasons: [] };

    if (!this.enabled || !this.nucleoid) {
      return {
        provider: 'helmr-deterministic',
        allowed: helmrDecision.allowed,
        summary: helmrDecision.allowed ? 'Allowed by Helmr policy' : 'Denied by Helmr policy',
        reasons: helmrDecision.reasons,
      };
    }

    const nucleoidReasons = this.tryNucleoidExplain(input);

    return {
      provider: 'nucleoid',
      allowed: helmrDecision.allowed,
      summary: nucleoidReasons ?? (helmrDecision.allowed ? 'Allowed' : 'Denied'),
      reasons: helmrDecision.reasons,
    };
  }

  async suggest(input: LogicInput): Promise<LogicSuggestion[]> {
    if (!this.enabled || !this.nucleoid) {
      return [];
    }

    if (input.kind === 'plan' && input.plan) {
      const hasDangerous = input.plan.steps.some((step) =>
        step.requiredCapabilities.some(
          (c) =>
            c === 'workspace_write' ||
            c === 'shell_write' ||
            c === 'git_write' ||
            c === 'package_install',
        ),
      );

      if (hasDangerous) {
        return [
          {
            title: 'Split into read-then-write phases',
            description:
              'Separate the read-only inspection steps from write operations so the human can review the plan before any mutations occur.',
          },
        ];
      }
    }

    return [];
  }

  private tryNucleoidExplain(input: LogicInput): string | null {
    if (!this.nucleoid) return null;

    try {
      const code = buildNucleoidQuery(input);
      const result = this.nucleoid.run(code);
      return typeof result === 'string' ? result : null;
    } catch {
      return null;
    }
  }
}

function buildNucleoidQuery(input: LogicInput): string {
  if (input.kind === 'plan' && input.plan) {
    const capabilities = input.plan.steps.flatMap((s) => s.requiredCapabilities);
    const unique = [...new Set(capabilities)];
    return `"Plan requires: ${unique.join(', ')}. Risk: ${input.plan.risk}. Approval required: ${input.plan.requiresApproval}"`;
  }

  if (input.kind === 'receipt' && input.receipt) {
    return `"Receipt for ${input.receipt.tool} using ${input.receipt.capability}. Risk: ${input.receipt.risk}. Approval: ${input.receipt.approval}"`;
  }

  return '"no input"';
}
