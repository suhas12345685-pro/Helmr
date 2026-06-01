import { randomUUID } from 'node:crypto';
import { evaluateToolReceipt } from '../../cortex/src/policy.js';
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
import type { ToolReceipt, ToolResult } from '../../shared/src/index.js';

export async function executeReceipt(receipt: ToolReceipt, workspacePath: string): Promise<ToolResult> {
  const decision = evaluateToolReceipt(receipt);

  if (!decision.allowed) {
    return makeResult(receipt, 'failed', undefined, `denied: ${decision.reasons.join('; ')}`);
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

  switch (receipt.tool) {
    case 'read_workspace':
      return summarizeWorkspace(workspacePath, (input['limit'] as number) ?? 200);

    case 'read_workspace_file':
      return readWorkspaceFile(workspacePath, input['filePath'] as string);

    case 'shell_read':
      return runShellRead(workspacePath, input['argv'] as string[]);

    case 'git_status':
      return runGitStatus(workspacePath);

    case 'git_log':
      return runGitLog(workspacePath, (input['maxCount'] as number) ?? 10);

    case 'write_workspace_file':
      return writeWorkspaceFile(workspacePath, input['filePath'] as string, input['content'] as string);

    case 'delete_workspace_file':
      return deleteWorkspaceFile(workspacePath, input['filePath'] as string);

    case 'rename_workspace_file':
      return renameWorkspaceFile(workspacePath, input['fromPath'] as string, input['toPath'] as string);

    case 'shell_write':
      return runShellWrite(workspacePath, input['argv'] as string[]);

    case 'git_add':
      return gitAdd(workspacePath, input['paths'] as string[]);

    case 'git_commit':
      return gitCommit(workspacePath, input['message'] as string);

    case 'git_checkout':
      return gitCheckout(workspacePath, input['ref'] as string, input['newBranch'] === true);

    case 'package_install':
      return npmInstall(workspacePath, input['packages'] as string[], {
        dev: input['dev'] === true,
        exact: input['exact'] === true,
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
