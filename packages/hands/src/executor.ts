import { randomUUID } from 'node:crypto';
import { evaluateToolReceipt } from '../../cortex/src/policy.js';
import { gateToolReceipt, type StandingApprovalPolicy } from '../../cortex/src/gate.js';
import { CredentialBroker } from '../../config/src/credential-broker.js';
import { isOutwardCapability } from '../../shared/src/index.js';
import { SkillRegistry, parseSkillManifest, globalSkillsDir } from '../../skills/src/index.js';
import { getHelmrPaths } from '../../../src/paths.js';
import { readWorkspaceFile, summarizeWorkspace } from './read-tools.js';
import {
  writeWorkspaceFile,
  deleteWorkspaceFile,
  renameWorkspaceFile,
  runShellWrite,
  gitAdd,
  gitCommit,
  gitCheckout,
  npmInstall,
} from './write-tools.js';
import { runShellRead, runGitStatus, runGitLog } from './shell-tools.js';
import { gitPush, httpRequest, messageSend } from './outward-tools.js';
import type { ToolReceipt, ToolResult } from '../../shared/src/index.js';

export interface ExecuteReceiptOptions {
  /** Standing-approval policy for the outward-action gate. */
  standingPolicy?: StandingApprovalPolicy;
}

export async function executeReceipt(
  receipt: ToolReceipt,
  workspacePath: string,
  options: ExecuteReceiptOptions = {},
): Promise<ToolResult> {
  const decision = evaluateToolReceipt(receipt);

  if (!decision.allowed) {
    return makeResult(receipt, 'failed', undefined, `denied: ${decision.reasons.join('; ')}`);
  }

  // Outward-action gate: actions that escape the box must clear a tier. `gated`
  // requires explicit authority (an approved receipt); `standing` runs under
  // pre-authorized policy; inward work is `auto`. Approval already satisfied
  // above lets an operator-approved receipt through even when gated.
  if (isOutwardCapability(receipt.capability)) {
    const gate = gateToolReceipt(receipt, options.standingPolicy);
    if (gate.tier === 'gated' && receipt.approval !== 'approved') {
      return makeResult(receipt, 'failed', undefined, `gated: ${gate.reason}`);
    }
  }

  try {
    const output = await dispatch(receipt, workspacePath);
    return makeResult(receipt, 'succeeded', output);
  } catch (err) {
    return makeResult(receipt, 'failed', undefined, (err as Error).message);
  }
}

async function dispatch(receipt: ToolReceipt, workspacePath: string): Promise<unknown> {
  const input = receipt.input as Record<string, unknown>;

  // Scope the subprocess env to only what this receipt's capability requires —
  // a git/npm tool never inherits the daemon's provider API keys. The grant is
  // recorded by names only (the broker never logs values).
  const broker = new CredentialBroker();
  const { env: scopedEnv } = broker.grant([receipt.capability]);

  switch (receipt.tool) {
    case 'read_workspace':
      return summarizeWorkspace(workspacePath, (input['limit'] as number) ?? 200);

    case 'read_workspace_file':
      return readWorkspaceFile(workspacePath, input['filePath'] as string);

    case 'shell_read':
      return runShellRead(workspacePath, input['argv'] as string[], scopedEnv);

    case 'git_status':
      return runGitStatus(workspacePath, scopedEnv);

    case 'git_log':
      return runGitLog(workspacePath, (input['maxCount'] as number) ?? 10, scopedEnv);

    case 'write_workspace_file':
      return writeWorkspaceFile(workspacePath, input['filePath'] as string, input['content'] as string);

    case 'delete_workspace_file':
      return deleteWorkspaceFile(workspacePath, input['filePath'] as string);

    case 'rename_workspace_file':
      return renameWorkspaceFile(workspacePath, input['fromPath'] as string, input['toPath'] as string);

    case 'shell_write':
      return runShellWrite(workspacePath, input['argv'] as string[], scopedEnv);

    case 'git_add':
      return gitAdd(workspacePath, input['paths'] as string[], scopedEnv);

    case 'git_commit':
      return gitCommit(workspacePath, input['message'] as string, scopedEnv);

    case 'git_checkout':
      return gitCheckout(workspacePath, input['ref'] as string, input['newBranch'] === true, scopedEnv);

    case 'package_install':
      return npmInstall(
        workspacePath,
        input['packages'] as string[],
        { dev: input['dev'] === true, exact: input['exact'] === true },
        scopedEnv,
      );

    case 'git_push':
      return gitPush(
        workspacePath,
        {
          remote: input['remote'] as string | undefined,
          branch: input['branch'] as string,
          setUpstream: input['setUpstream'] === true,
          force: input['force'] === true,
        },
        scopedEnv,
      );

    case 'http_request':
      return httpRequest({
        url: input['url'] as string,
        method: input['method'] as string | undefined,
        headers: input['headers'] as Record<string, string> | undefined,
        body: input['body'] as string | undefined,
        timeoutMs: input['timeoutMs'] as number | undefined,
      });

    case 'message_send':
      return messageSend({
        channel: input['channel'] as string,
        text: input['text'] as string,
        webhookUrl: input['webhookUrl'] as string,
        extra: input['extra'] as Record<string, unknown> | undefined,
      });

    case 'list_skills':
      return new SkillRegistry(globalSkillsDir(getHelmrPaths().dataDir)).list();

    case 'create_skill': {
      // Self-extension: persist a new/updated skill manifest into Helmr's global
      // skills dir. It is auto-discovered on the next list (and hot-reloaded by
      // any watching consumer) — no restart or code change required.
      const registry = new SkillRegistry(globalSkillsDir(getHelmrPaths().dataDir));
      const manifest = parseSkillManifest(input);
      return registry.write(manifest);
    }

    default:
      throw new Error(`unknown tool: ${receipt.tool}`);
  }
}

function makeResult(
  receipt: ToolReceipt,
  status: ToolResult['status'],
  output?: unknown,
  error?: string,
): ToolResult {
  return {
    id: `result_${randomUUID()}`,
    receiptId: receipt.id,
    jobId: receipt.jobId,
    status,
    output,
    error,
    createdAt: new Date().toISOString(),
  };
}
