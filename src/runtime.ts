import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { normalizeCliEvent } from '../packages/gateway/src/normalize-event.js';
import { SqliteWorkspaceLockManager } from '../packages/scheduler/src/sqlite-workspace-lock.js';
import { JsonlAuditLog } from '../packages/memory/src/audit-jsonl.js';
import { HelmrSQLiteStore } from '../packages/memory/src/sqlite-store.js';
import type { HelmrStoreJob } from '../packages/memory/src/sqlite-store.js';
import { evaluatePlan } from '../packages/cortex/src/policy.js';
import { executePlanSteps } from '../packages/subagents/src/index.js';
import { summarizeWorkspace } from '../packages/hands/src/read-tools.js';
import { councilAgent } from '../packages/mastra/src/agents/council.agent.js';
import { researchAgent } from '../packages/mastra/src/agents/research.agent.js';
import { codingAgent } from '../packages/mastra/src/agents/coding.agent.js';
import { HelmrPlanSchema } from '../packages/shared/src/index.js';
import type { HelmrJob, HelmrPlan } from '../packages/shared/src/index.js';
import {
  createLocalPlan,
  planRequiresCodingAgent,
  shouldUseLocalAgentFallback,
  synthesizeLocalAnswer,
} from './local-agent.js';
import { getHelmrPaths } from './paths.js';

export interface RunJobOptions {
  text: string;
  workspacePath?: string;
  jobId?: string;
  onProgress?: (message: string) => void;
}

export interface RunJobResult {
  jobId: string;
  answer: string;
  plan: HelmrPlan;
  status: 'succeeded' | 'failed' | 'denied' | 'awaiting_approval';
  deniedReasons?: string[];
}

export async function runJob(options: RunJobOptions): Promise<RunJobResult> {
  const { text, workspacePath = process.cwd(), onProgress } = options;

  const log = (msg: string): void => onProgress?.(msg);

  const paths = getHelmrPaths();
  const auditLog = new JsonlAuditLog(paths.auditDir);
  const store = new HelmrSQLiteStore(join(paths.dataDir, 'helmr.db'));
  await store.init();

  const locks = await SqliteWorkspaceLockManager.create({ url: `file:${join(paths.dataDir, 'helmr.db')}` });

  log('Creating event...');
  const event = normalizeCliEvent({ text, workspacePath });

  log('Checking for existing job...');
  const existingJob = options.jobId
    ? await store.getJob(options.jobId)
    : (await store.listJobs()).find(
        (j) =>
          j.payloadText === text &&
          j.workspacePath === workspacePath &&
          (j.status === 'awaiting_approval' || j.status === 'queued' || j.status === 'running')
      );

  const jobId = options.jobId ?? existingJob?.id ?? `job_${randomUUID()}`;

  log('Queueing job...');
  const jobBase: HelmrStoreJob = {
    id: jobId,
    eventId: existingJob?.eventId ?? event.id,
    workspaceId: existingJob?.workspaceId ?? event.workspace.id,
    status: existingJob ? existingJob.status : 'queued',
    lane: existingJob?.lane ?? 'interactive',
    priority: existingJob?.priority ?? 50,
    attempts: existingJob ? existingJob.attempts : 0,
    maxAttempts: existingJob?.maxAttempts ?? 3,
    createdAt: existingJob?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    payloadText: text,
    workspacePath,
  };

  await store.upsertJob(jobBase);

  await auditLog.append({ kind: 'event', jobId, createdAt: event.createdAt, data: event });

  log('Claiming durable job lease...');
  const claimed = await store.claimNextJob({ leaseMs: 60_000 });
  if (!claimed) throw new Error('failed to claim queued job');

  log('Acquiring workspace read lock...');
  const lock = await locks.acquireWithTimeout({
    workspaceId: event.workspace.id,
    ownerId: claimed.id,
    mode: 'read',
    ttlMs: 60_000,
    timeoutMs: 5_000,
  });

  let plan: HelmrPlan | undefined;

  try {

    // 1. Plan check: See if an approved plan already exists in database
    const existingPlan = await store.getPlan(claimed.id);
    plan = existingPlan;

    if (!plan) {
      log('Planning...');
      plan = await runCouncilPlanner(claimed.id, event.workspace.path, text);
      await store.savePlan(plan);
      await auditLog.append({ kind: 'plan', jobId: claimed.id, createdAt: new Date().toISOString(), data: plan });
    }

    log('Validating plan with Cortex...');
    const decision = evaluatePlan(plan);

    if (!decision.allowed || decision.requiresApproval) {
      // Check if plan has been approved by the user in SQLite approvals table
      const approval = await store.getApprovalByJob(claimed.id, 'plan');
      
      if (approval?.decision === 'approved') {
        log('Plan requires approval but has been APPROVED by owner. Continuing execution...');
      } else if (approval?.decision === 'denied') {
        await store.updateJobStatus(claimed.id, 'failed', 'plan denied by owner');
        return {
          jobId: claimed.id,
          answer: 'Job denied by owner review.',
          plan,
          status: 'denied',
          deniedReasons: ['owner denied this plan'],
        };
      } else {
        // Not approved yet (first time or still pending)
        log('Plan requires owner approval. Creating approval request...');
        await store.createApproval(`approval_${claimed.id}`, claimed.id, 'plan');
        await store.updateJobStatus(claimed.id, 'awaiting_approval');
        
        return {
          jobId: claimed.id,
          answer: 'Plan requires human owner approval. Review in Hatchery and approve to execute.',
          plan,
          status: 'awaiting_approval',
          deniedReasons: decision.reasons,
        };
      }
    }

    log('Checking capabilities to select agent...');
    const requiresCodingAgent = planRequiresCodingAgent(plan);

    let answer = '';

    if (requiresCodingAgent) {
      log('Plan requires coding agent execution. Prompting coding agent...');
      const codingPrompt = `You are tasked with executing the following approved code implementation plan:
Plan Summary: ${plan.summary}
Job ID: ${plan.jobId}
Workspace Path: ${event.workspace.path}
Original Request: ${text}

Steps to execute:
${plan.steps
  .map(
    (step) =>
      `- Step ID: ${step.id}\n  Title: ${step.title}\n  Kind: ${step.kind}\n  Capabilities: ${step.requiredCapabilities.join(
        ', ',
      )}`,
  )
  .join('\n')}

INSTRUCTIONS:
1. Always READ relevant files first before making any changes. Use the \`read_workspace\` and \`read_workspace_file\` tools.
2. For ANY code modifications, file writes, file deletions, git commits, or shell writes, you MUST request a tool receipt using the \`request_receipt\` tool.
   When calling \`request_receipt\`, pass the current Step ID as \`stepId\` and the Job ID as \`jobId\`.
   For writing a file: set tool to "write_workspace_file" and capability to "workspace_write", and pass the relative filePath and content in the input object.
   For deleting a file: set tool to "delete_workspace_file" and capability to "workspace_write", and pass the relative filePath in the input object.
   For git add: set tool to "git_add" and capability to "git_write", and pass the paths in the input object.
   For git commit: set tool to "git_commit" and capability to "git_write", and pass the message in the input object.
   For running a mutating shell command: set tool to "shell_write" and capability to "shell_write", and pass an argv string array in the input object.
   For installing packages: set tool to "package_install" and capability to "package_install", and pass packages plus optional dev/exact booleans in the input object.
3. If \`request_receipt\` throws an "Awaiting human approval" error, this is expected behavior. The environment will pause execution to await owner approval. Stop and let the system know you are waiting.
4. After completing code modifications, you MUST verify that the changes compile cleanly. Use the \`shell_read\` tool to run typechecks or compiler commands (e.g. \`tsc --noEmit\` or \`npm run typecheck\`).
5. Provide a summary of your actions once all steps are successfully completed.`;

      const result = await codingAgent.generate([{ role: 'user', content: codingPrompt }]);
      answer = result.text ?? '';
    } else {
      log('Executing approved steps...');
      answer = await executeReadPlan(plan, event.workspace.path, text, log, store);
    }

    await auditLog.append({
      kind: 'result',
      jobId: claimed.id,
      createdAt: new Date().toISOString(),
      data: { answer },
    });

    await store.completeJob(claimed.id);

    return {
      jobId: claimed.id,
      answer,
      plan,
      status: 'succeeded',
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('Awaiting human approval')) {
      log('Awaiting human owner approval for tool execution...');
      await store.updateJobStatus(claimed.id, 'awaiting_approval');
      return {
        jobId: claimed.id,
        answer: 'Awaiting human owner approval for tool execution.',
        plan: plan!,
        status: 'awaiting_approval',
      };
    } else {
      await store.failJob(claimed.id, errMsg);
      throw err;
    }
  } finally {
    await locks.release(lock);
    locks.close();
    store.close();
  }
}

async function runCouncilPlanner(jobId: string, workspacePath: string, text: string): Promise<HelmrPlan> {
  if (shouldUseLocalAgentFallback()) {
    return createLocalPlan({ jobId, request: text });
  }

  const prompt = `Plan this request for job ${jobId}.
Workspace: ${workspacePath}
Request: ${text}

Produce a HelmrPlan JSON object. For a summarization/inspection request, use workspace_read capability only.
The plan id should be "plan_${jobId}".`;

  const result = await councilAgent.generate([{ role: 'user', content: prompt }], {
    structuredOutput: { schema: HelmrPlanSchema },
  });

  return result.object as HelmrPlan;
}

async function executeReadPlan(
  plan: HelmrPlan,
  workspacePath: string,
  originalRequest: string,
  log: (msg: string) => void,
  store: HelmrSQLiteStore,
): Promise<string> {
  log('Starting read execution (parallel batches where the plan allows)...');
  const { executeReceipt } = await import('../packages/hands/src/executor.js');

  // Run independent steps concurrently. Mutually-parallel steps (as declared by
  // the plan via canRunInParallelWith) share a batch; everything else stays
  // ordered. Each step still flows through a receipt for the audit trail.
  const { outputs: stepOutputs } = await executePlanSteps(
    plan,
    async (step) => {
      const capability = step.requiredCapabilities[0] ?? 'workspace_read';
      let toolName = '';
      let input: Record<string, unknown> = {};

      if (step.kind === 'read') {
        if (step.title.toLowerCase().includes('file')) {
          toolName = 'read_workspace_file';
          const fileMatch = step.title.match(/([a-zA-Z0-9_\-\/]+\.[a-zA-Z0-9]+)/);
          input = { filePath: fileMatch ? fileMatch[1] : 'package.json' };
        } else {
          toolName = 'read_workspace';
          input = { limit: 100 };
        }
      } else if (step.kind === 'command') {
        if (step.title.toLowerCase().includes('status')) {
          toolName = 'git_status';
        } else if (step.title.toLowerCase().includes('log')) {
          toolName = 'git_log';
          input = { maxCount: 5 };
        } else {
          toolName = 'shell_read';
          input = { argv: ['node', '--version'] };
        }
      }

      if (!toolName) {
        return undefined;
      }

      const receipt = {
        id: `receipt_${randomUUID()}`,
        jobId: plan.jobId,
        stepId: step.id,
        tool: toolName,
        capability,
        input,
        risk: 'low' as const,
        approval: 'not_required' as const,
        createdAt: new Date().toISOString(),
      };

      await store.saveReceipt(receipt);
      log(`Executing receipt: ${toolName} with input ${JSON.stringify(input)}`);

      const result = await executeReceipt(receipt, workspacePath);
      await store.saveResult(result);

      if (result.status !== 'succeeded') {
        log(`Step ${step.id} failed: ${result.error}`);
        throw new Error(result.error ?? `step ${step.id} failed`);
      }

      log(`Step ${step.id} completed successfully`);
      return result.output;
    },
    {
      onStepStart: (step) => log(`Running step: ${step.title} (${step.id})`),
    },
  );

  // Synthesis
  const prompt = `User request: "${originalRequest}"
Workspace path: ${workspacePath}
Plan: ${plan.summary}

We have executed the plan steps and gathered the following results:
${Object.entries(stepOutputs)
  .map(([stepId, output]) => `Step ${stepId} Output:\n${JSON.stringify(output, null, 2)}`)
  .join('\n\n')}

Analyze these results and provide a comprehensive final answer to the user's request.`;

  if (shouldUseLocalAgentFallback()) {
    return synthesizeLocalAnswer({ request: originalRequest, workspacePath, stepOutputs });
  }

  try {
    const result = await researchAgent.generate([{ role: 'user', content: prompt }]);
    return result.text ?? '';
  } catch {
    return synthesizeLocalAnswer({ request: originalRequest, workspacePath, stepOutputs });
  }
}
