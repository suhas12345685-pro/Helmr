import type { HelmrPlan, ToolReceipt } from '../../shared/src/index.js';

export interface LogicInput {
  kind: 'plan' | 'receipt';
  plan?: HelmrPlan;
  receipt?: ToolReceipt;
}

export interface LogicExplanation {
  provider: string;
  allowed: boolean;
  summary: string;
  reasons: string[];
}

export interface LogicSuggestion {
  title: string;
  description: string;
}

export interface LogicProvider {
  name: string;
  explain(input: LogicInput): Promise<LogicExplanation>;
  suggest?(input: LogicInput): Promise<LogicSuggestion[]>;
}
