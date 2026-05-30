import type { HelmrPlan } from '../packages/shared/src/index.js';

export interface LocalPlanOptions {
  jobId: string;
  request: string;
}

export interface LocalSynthesisOptions {
  request: string;
  workspacePath: string;
  stepOutputs: Record<string, unknown>;
}

const MODEL_ENV_KEYS = [
  'HELMR_MODEL',
  'HELMR_COUNCIL_MODEL',
  'HELMR_RESEARCH_MODEL',
  'HELMR_CODING_MODEL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'XAI_API_KEY',
  'PERPLEXITY_API_KEY',
];

export function shouldUseLocalAgentFallback(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return MODEL_ENV_KEYS.every((key) => !env[key]?.trim());
}

export function createLocalPlan(options: LocalPlanOptions): HelmrPlan {
  const request = options.request.toLowerCase();
  const wantsGit = request.includes('git') || request.includes('development steps') || request.includes('status');

  return {
    id: `plan_${options.jobId}`,
    jobId: options.jobId,
    summary: 'Inspect the workspace locally, read package metadata, and summarize next development steps.',
    risk: 'low',
    requiresApproval: false,
    steps: [
      {
        id: 'inspect_workspace',
        title: 'Inspect workspace tree',
        kind: 'read',
        agent: 'none',
        canRunInParallelWith: ['read_package'],
        requiredCapabilities: ['workspace_read'],
      },
      {
        id: 'read_package',
        title: 'Read file package.json',
        kind: 'read',
        agent: 'none',
        canRunInParallelWith: ['inspect_workspace'],
        requiredCapabilities: ['workspace_read'],
      },
      {
        id: 'git_status',
        title: wantsGit ? 'Read git status' : 'Read git status if available',
        kind: 'command',
        agent: 'none',
        canRunInParallelWith: [],
        requiredCapabilities: ['git_read'],
      },
    ],
  };
}

export function planRequiresCodingAgent(plan: HelmrPlan): boolean {
  return plan.steps.some((step) => {
    const capabilities = step.requiredCapabilities;
    return (
      step.kind === 'write' ||
      capabilities.includes('workspace_write') ||
      capabilities.includes('shell_write') ||
      capabilities.includes('git_write') ||
      capabilities.includes('package_install') ||
      capabilities.includes('service_install') ||
      capabilities.includes('secrets_read')
    );
  });
}

export function synthesizeLocalAnswer(options: LocalSynthesisOptions): string {
  const workspace = getWorkspaceSummary(options.stepOutputs['inspect_workspace']);
  const packageInfo = getPackageInfo(options.stepOutputs['read_package']);
  const gitStatus = stringifyOutput(options.stepOutputs['git_status']);
  const notableFiles = workspace.files.slice(0, 12);
  const packageName = packageInfo.name ?? 'this workspace';
  const scripts = Object.keys(packageInfo.scripts ?? {});
  const dependencies = Object.keys(packageInfo.dependencies ?? {});

  return [
    '# Workspace Summary',
    '',
    `Request: ${options.request}`,
    `Workspace: ${options.workspacePath}`,
    `Project: ${packageName}`,
    '',
    '## What I Found',
    '',
    `- Files inspected: ${workspace.files.length}`,
    `- Notable files: ${notableFiles.length ? notableFiles.join(', ') : 'no files found by the read tool'}`,
    `- Available scripts: ${scripts.length ? scripts.join(', ') : 'none listed in package.json'}`,
    `- Key dependencies: ${dependencies.slice(0, 8).join(', ') || 'none listed in package.json'}`,
    `- Git status: ${summarizeGitStatus(gitStatus)}`,
    '',
    '## Next Development Steps',
    '',
    '- Keep the read-only local loop reliable: event, job, plan, policy, receipt, result, and audit should work without a model key.',
    '- Expand Hatchery visibility around the same SQLite records the CLI writes.',
    '- Add approval-resume coverage for write-capable plans before enabling broad coding-agent execution.',
    '- Continue tightening security tests around workspace boundaries, command allowlists, and secret redaction.',
  ].join('\n');
}

function getWorkspaceSummary(value: unknown): { root?: string; files: string[] } {
  if (!value || typeof value !== 'object') {
    return { files: [] };
  }

  const maybeSummary = value as { root?: unknown; files?: unknown };
  return {
    root: typeof maybeSummary.root === 'string' ? maybeSummary.root : undefined,
    files: Array.isArray(maybeSummary.files)
      ? maybeSummary.files.filter((file): file is string => typeof file === 'string')
      : [],
  };
}

function getPackageInfo(value: unknown): {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
} {
  const raw = typeof value === 'string' ? parseJson(value) : value;
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const pkg = raw as {
    name?: unknown;
    scripts?: unknown;
    dependencies?: unknown;
  };

  return {
    name: typeof pkg.name === 'string' ? pkg.name : undefined,
    scripts: isStringRecord(pkg.scripts) ? pkg.scripts : undefined,
    dependencies: isStringRecord(pkg.dependencies) ? pkg.dependencies : undefined,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object';
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const maybeShell = value as { stdout?: unknown; stderr?: unknown };
    if (typeof maybeShell.stdout === 'string' || typeof maybeShell.stderr === 'string') {
      return [maybeShell.stdout, maybeShell.stderr].filter(Boolean).join('\n');
    }
  }
  if (value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

function summarizeGitStatus(status: string): string {
  if (!status.trim()) {
    return 'not reported';
  }
  if (status.includes('not a git repository')) {
    return 'not a git repository';
  }
  if (status.includes('nothing to commit') || status.includes('working tree clean')) {
    return 'clean';
  }
  return status.split('\n').slice(0, 3).join(' ');
}
