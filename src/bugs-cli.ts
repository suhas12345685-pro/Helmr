import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  BugStore,
  triageBug,
  canAutoOpenFixBranch,
  fixBranchName,
  generateFailingTest,
  type BugReportInput,
  type StoredBug,
} from '../packages/bug-triage/src/index.js';
import { getHelmrPaths } from './paths.js';

function bugsDir(): string {
  return join(getHelmrPaths().dataDir, 'bugs');
}
function bugTestsDir(): string {
  return join(bugsDir(), 'tests');
}

async function openStore(): Promise<BugStore> {
  const store = new BugStore(bugsDir());
  await store.init();
  return store;
}

/** Parse `--key value` flags and free text into a bug report input. */
function parseBugFlags(args: string[]): BugReportInput {
  let title = '';
  let description = '';
  const steps: string[] = [];
  let expected: string | undefined;
  let actual: string | undefined;
  let capabilityId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--title' && args[i + 1]) title = args[++i]!;
    else if (arg === '--description' && args[i + 1]) description = args[++i]!;
    else if (arg === '--step' && args[i + 1]) steps.push(args[++i]!);
    else if (arg === '--expected' && args[i + 1]) expected = args[++i]!;
    else if (arg === '--actual' && args[i + 1]) actual = args[++i]!;
    else if (arg === '--capability' && args[i + 1]) capabilityId = args[++i]!;
    else if (!arg!.startsWith('--') && !title) title = arg!;
  }
  if (!description) description = title;
  return { title, description, steps, expected, actual, capabilityId };
}

/**
 * Dispatch `helmr bugs <sub> ...`. Returns the process exit code.
 *
 * Subcommands: report, reproduce <id>, fix <id>, scan <id>, create-pr <id>.
 */
export async function runBugsCommand(args: string[]): Promise<number> {
  const sub = args[0];
  const id = args[1];

  switch (sub) {
    case 'report': {
      const input = parseBugFlags(args.slice(1));
      if (!input.title) {
        console.error('Usage: helmr bugs report --title "..." [--description "..."] [--step "..."]* [--expected "..."] [--actual "..."]');
        return 1;
      }
      const report = triageBug(input);
      const store = await openStore();
      const stored: StoredBug = {
        ...report,
        status: report.reproducible ? 'reported' : 'needs_reproduction',
        updatedAt: report.createdAt,
      };
      await store.write(stored);
      console.log(`Filed bug ${report.id}`);
      console.log(`  severity:     ${report.severity}`);
      console.log(`  labels:       ${report.labels.join(', ')}`);
      console.log(`  reproducible: ${report.reproducible}`);
      if (!report.reproducible) {
        console.log(`  Please provide: ${report.missingInfo.join(', ')}`);
        console.log(`  Re-run with --step / --expected / --actual to enable reproduction.`);
      }
      return 0;
    }

    case 'reproduce': {
      if (!id) return usage('reproduce <id>');
      const store = await openStore();
      const bug = await store.get(id);
      if (!bug) return notFound(id);
      if (!bug.reproducible) {
        console.log(`Bug ${id} is not reproducible yet. Missing: ${bug.missingInfo.join(', ')}.`);
        return 1;
      }
      // Generate a failing regression test that encodes the reproduction.
      await mkdir(bugTestsDir(), { recursive: true });
      const testPath = join(bugTestsDir(), `${id}.test.ts`);
      await writeFile(testPath, generateFailingTest(bug), 'utf8');
      await store.patch(id, { status: 'reproduced', failingTestPath: testPath });
      console.log(`Reproduction captured for ${id}.`);
      console.log(`  Failing test written to: ${testPath}`);
      console.log('  This test FAILs until the bug is fixed.');
      return 0;
    }

    case 'scan': {
      if (!id) return usage('scan <id>');
      const store = await openStore();
      const bug = await store.get(id);
      if (!bug) return notFound(id);
      const gate = canAutoOpenFixBranch(bug);
      console.log(`Bug ${id} (${bug.severity})`);
      console.log(`  reproducible:        ${bug.reproducible}`);
      console.log(`  auto-fix branch ok:  ${gate.allowed}`);
      console.log(`  reason:              ${gate.reason}`);
      return 0;
    }

    case 'fix': {
      if (!id) return usage('fix <id>');
      const store = await openStore();
      const bug = await store.get(id);
      if (!bug) return notFound(id);
      const gate = canAutoOpenFixBranch(bug);
      if (!gate.allowed) {
        console.error(`Cannot auto-open a fix for ${id}: ${gate.reason}`);
        return 1;
      }
      const branch = fixBranchName(bug);
      await store.patch(id, { status: 'fixing', fixBranch: branch });
      console.log(`Prepared fix for ${id}.`);
      console.log(`  suggested branch: ${branch}`);
      if (bug.failingTestPath) {
        console.log(`  failing test:     ${bug.failingTestPath}`);
      } else {
        console.log('  Tip: run `helmr bugs reproduce` first to capture a failing test.');
      }
      console.log('  Implement the fix, run all checks, then `helmr bugs create-pr`.');
      return 0;
    }

    case 'create-pr': {
      if (!id) return usage('create-pr <id>');
      const store = await openStore();
      const bug = await store.get(id);
      if (!bug) return notFound(id);
      const branch = bug.fixBranch ?? fixBranchName(bug);
      console.log(`PR scaffold for ${id}:`);
      console.log(`  branch: ${branch}`);
      console.log(`  title:  fix: ${bug.input.title} (${id})`);
      console.log('  body:');
      console.log(`    Fixes ${id} (severity: ${bug.severity}).`);
      console.log(`    ${bug.input.description}`);
      console.log('    All checks must pass before this PR is opened.');
      await store.patch(id, { status: 'pr_opened', fixBranch: branch });
      console.log('\nRun `npm run verify` and push the branch to open the PR.');
      return 0;
    }

    default:
      console.error(`Unknown bugs subcommand: ${sub ?? '(none)'}`);
      console.error('Usage: helmr bugs <report|reproduce|fix|scan|create-pr> ...');
      return 1;
  }
}

function usage(form: string): number {
  console.error(`Usage: helmr bugs ${form}`);
  return 1;
}

function notFound(id: string): number {
  console.error(`No bug found with id "${id}".`);
  return 1;
}
