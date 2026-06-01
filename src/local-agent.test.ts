import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createLocalPlan,
  planRequiresCodingAgent,
  synthesizeLocalAnswer,
  shouldUseLocalAgentFallback,
  extractRequestedFiles,
} from './local-agent.js';

test('local planner creates a safe read-only workspace summary plan', () => {
  const plan = createLocalPlan({
    jobId: 'job_local',
    request: 'summarize this workspace and identify next development steps',
  });

  assert.equal(plan.id, 'plan_job_local');
  assert.equal(plan.jobId, 'job_local');
  assert.equal(plan.risk, 'low');
  assert.equal(plan.requiresApproval, false);
  assert.deepEqual(
    plan.steps.map((step) => step.requiredCapabilities),
    [['workspace_read'], ['workspace_read'], ['git_read']],
  );
  assert.equal(plan.steps[0]?.title.toLowerCase().includes('file'), false);
});

test('local synthesizer returns concrete workspace observations and next steps', () => {
  const answer = synthesizeLocalAnswer({
    request: 'summarize this workspace and identify next development steps',
    workspacePath: 'C:/project',
    stepOutputs: {
      inspect_workspace: {
        root: 'C:/project',
        files: [
          'package.json',
          'architecture.md',
          'packages/shared/src/contracts.ts',
          'apps/hatchery-web/app/page.tsx',
        ],
      },
      read_package: {
        name: 'helmr',
        scripts: { typecheck: 'tsc --noEmit', test: 'node --test' },
        dependencies: { '@mastra/core': '^1.0.0' },
      },
      git_status: 'fatal: not a git repository',
    },
  });

  assert.match(answer, /Workspace Summary/);
  assert.match(answer, /helmr/);
  assert.match(answer, /package.json/);
  assert.match(answer, /architecture.md/);
  assert.match(answer, /Next Development Steps/);
  assert.match(answer, /git repository/);
});



test('local planner builds dynamic read-only steps from file and git history requests', () => {
  const plan = createLocalPlan({
    jobId: 'job_dynamic',
    request: 'review README.md and packages/shared/src/contracts.ts, then include git history',
  });

  assert.equal(plan.risk, 'low');
  assert.equal(plan.requiresApproval, false);
  assert.match(plan.summary, /Dynamically inspect/);
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    [
      'inspect_workspace',
      'read_file_readme_md',
      'read_file_packages_shared_src_contracts_ts',
      'git_status',
      'git_log',
    ],
  );
  assert.deepEqual(plan.steps[1]?.requiredCapabilities, ['workspace_read']);
  assert.deepEqual(plan.steps[3]?.requiredCapabilities, ['git_read']);
  assert.deepEqual(plan.steps[0]?.canRunInParallelWith, [
    'read_file_readme_md',
    'read_file_packages_shared_src_contracts_ts',
  ]);
});

test('requested file extraction is deterministic and rejects unsafe paths', () => {
  assert.deepEqual(
    extractRequestedFiles('compare ./README.md, src/runtime.ts, ../secret.env, and /tmp/other.txt'),
    ['README.md', 'src/runtime.ts'],
  );
});

test('local fallback is used when no model provider key or explicit model is configured', () => {
  assert.equal(shouldUseLocalAgentFallback({}), true);
  assert.equal(shouldUseLocalAgentFallback({ HELMR_MODEL: 'anthropic/claude-sonnet-latest' }), false);
  assert.equal(shouldUseLocalAgentFallback({ OPENAI_API_KEY: 'sk-test' }), false);
});

test('read-only command and git steps do not require the coding agent', () => {
  const plan = createLocalPlan({
    jobId: 'job_read_only',
    request: 'summarize this workspace and inspect git status',
  });

  assert.equal(planRequiresCodingAgent(plan), false);
  assert.equal(
    planRequiresCodingAgent({
      ...plan,
      steps: [
        ...plan.steps,
        {
          id: 'write_file',
          title: 'Write implementation file',
          kind: 'write',
          agent: 'coding',
          canRunInParallelWith: [],
          requiredCapabilities: ['workspace_write'],
        },
      ],
    }),
    true,
  );
});
