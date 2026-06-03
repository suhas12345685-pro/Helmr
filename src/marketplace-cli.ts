import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  SubmissionStore,
  loadSubmissionSource,
  submitCapability,
  runPipeline,
  type SubmissionRecord,
} from '../packages/marketplace-submissions/src/index.js';
import {
  SecurityScanner,
  formatScanReport,
  buildFixReport,
  applyAutoFixes,
  formatFixReport,
} from '../packages/security-scanner/src/index.js';
import { getHelmrPaths } from './paths.js';

/** Where the marketplace keeps its durable state. */
function marketplaceDir(): string {
  return join(getHelmrPaths().dataDir, 'marketplace');
}
function submissionsDir(): string {
  return join(marketplaceDir(), 'submissions');
}
function reportsDir(): string {
  return join(marketplaceDir(), 'reports');
}

async function openStore(): Promise<SubmissionStore> {
  const store = new SubmissionStore(submissionsDir());
  await store.init();
  return store;
}

function printRecord(r: SubmissionRecord): void {
  console.log(`  id:           ${r.id}`);
  console.log(`  kind:         ${r.kind}`);
  console.log(`  decision:     ${r.decision}`);
  console.log(`  status:       ${r.status}`);
  console.log(`  trust level:  ${r.trustLevel}`);
  console.log(`  risk level:   ${r.riskLevel}`);
  console.log(`  scan:         ${r.scanStatus} (severity ${r.scanSeverity}, ${r.scanFindingCount} findings)`);
  console.log(`  installable:  ${r.installable}`);
  console.log(`  auto-enabled: ${r.autoEnabled}`);
  if (r.scanReportPath) console.log(`  report:       ${r.scanReportPath}`);
}

/**
 * Dispatch `helmr marketplace <sub> ...`. Returns the process exit code.
 *
 * Subcommands: submit, scan, fix, quarantine, approve, reject, publish, report,
 * plus `list` for convenience.
 */
export async function runMarketplaceCommand(args: string[]): Promise<number> {
  const sub = args[0];
  const target = args[1];

  switch (sub) {
    case 'submit': {
      if (!target) return usage('submit <path|github:owner/repo>');
      const loaded = await loadSubmissionSource(target);
      const store = await openStore();
      // Persist the scan report alongside the record so it is always visible.
      const scanReportPath = join(reportsDir(), `${Date.now()}.md`);
      const { pipeline, record } = await submitCapability(loaded, store, {
        source: target,
        scanReportPath,
      });
      await mkdir(reportsDir(), { recursive: true });
      await writeFile(scanReportPath, formatScanReport(pipeline.scan, `Scan: ${record.id}`), 'utf8');

      console.log(`\nSubmission processed: ${target}`);
      console.log('-'.repeat(60));
      printRecord(record);
      console.log('-'.repeat(60));
      console.log('Reasons:');
      for (const reason of pipeline.reasons) console.log(`  - ${reason}`);
      if (record.decision === 'FAIL') {
        console.log('\nBlocked and quarantined. Run `helmr marketplace fix` for suggestions.');
        return 1;
      }
      if (record.decision === 'NEEDS_REVIEW') {
        console.log('\nNeeds maintainer review before publishing.');
        return 0;
      }
      console.log('\nPassed basic checks. Installable as community (unverified) pending review.');
      return 0;
    }

    case 'scan': {
      if (!target) return usage('scan <path|github:owner/repo>');
      const loaded = await loadSubmissionSource(target);
      const scanner = new SecurityScanner();
      const result = scanner.scanFiles(loaded.files, loaded.manifestRaw && typeof loaded.manifestRaw === 'object'
        ? {
            permissions: (loaded.manifestRaw as Record<string, string[]>)['permissions'] ?? [],
            riskLevel: (loaded.manifestRaw as Record<string, 'low' | 'medium' | 'high'>)['riskLevel'],
          }
        : undefined);
      console.log(formatScanReport(result, `Scan: ${target}`));
      return result.pass ? 0 : 1;
    }

    case 'fix': {
      if (!target) return usage('fix <path|github:owner/repo>');
      const loaded = await loadSubmissionSource(target);
      const pipeline = runPipeline(loaded.manifestRaw, loaded.files);
      const report = buildFixReport(pipeline.scan);
      console.log(formatFixReport(report));
      const { fixed } = applyAutoFixes(loaded.files, pipeline.scan);
      if (fixed.length > 0) {
        console.log(`\n${fixed.length} finding(s) are auto-fixable.`);
        console.log('Re-run `helmr marketplace scan` after applying fixes to confirm a clean scan.');
      } else {
        console.log('\nNo automatic fixes available; address the findings above manually.');
      }
      return 0;
    }

    case 'quarantine': {
      if (!target) return usage('quarantine <id>');
      const store = await openStore();
      const reason = args.slice(2).join(' ') || 'manual quarantine';
      const record = await store.quarantine(target, reason);
      if (!record) return notFound(target);
      console.log(`Quarantined ${target}.`);
      printRecord(record);
      return 0;
    }

    case 'approve': {
      if (!target) return usage('approve <id>');
      const store = await openStore();
      const record = await store.approve(target);
      if (!record) return notFound(target);
      console.log(`Approved ${target}.`);
      printRecord(record);
      return 0;
    }

    case 'reject': {
      if (!target) return usage('reject <id>');
      const store = await openStore();
      const reason = args.slice(2).join(' ') || 'rejected by maintainer';
      const record = await store.reject(target, reason);
      if (!record) return notFound(target);
      console.log(`Rejected ${target}: ${reason}`);
      return 0;
    }

    case 'publish': {
      if (!target) return usage('publish <id>');
      const store = await openStore();
      const { record, error } = await store.publish(target);
      if (error) {
        console.error(`Cannot publish ${target}: ${error}`);
        return 1;
      }
      console.log(`Published ${target}.`);
      if (record) printRecord(record);
      return 0;
    }

    case 'report': {
      if (!target) return usage('report <id>');
      const store = await openStore();
      const record = await store.get(target);
      if (!record) return notFound(target);
      console.log(JSON.stringify(record, null, 2));
      return 0;
    }

    case 'list': {
      const store = await openStore();
      const records = await store.list();
      if (records.length === 0) {
        console.log('No submissions yet.');
        return 0;
      }
      for (const r of records) {
        console.log(`${r.id}  [${r.trustLevel}]  ${r.status}  scan:${r.scanStatus}  risk:${r.riskLevel}`);
      }
      return 0;
    }

    default:
      console.error(`Unknown marketplace subcommand: ${sub ?? '(none)'}`);
      console.error('Usage: helmr marketplace <submit|scan|fix|quarantine|approve|reject|publish|report|list> ...');
      return 1;
  }
}

function usage(form: string): number {
  console.error(`Usage: helmr marketplace ${form}`);
  return 1;
}

function notFound(id: string): number {
  console.error(`No submission found with id "${id}".`);
  return 1;
}
