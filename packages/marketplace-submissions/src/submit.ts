import { readdir, readFile, stat, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import {
  SecurityScanner,
  type ScanFile,
} from '../../security-scanner/src/index.js';

import { MANIFEST_FILENAMES } from './validator.js';
import { runPipeline, type PipelineResult } from './pipeline.js';
import { SubmissionStore, type SubmissionRecord } from './store.js';
import { shouldAutoEnable } from './trust.js';
import type { MarketplaceManifest } from './manifest.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const TEXT_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|sh|bash|zsh|py|rb|go|rs|yaml|yml|toml|md|txt|env)$/i;
const MAX_FILE_BYTES = 1_000_000;

export interface LoadedSubmission {
  files: ScanFile[];
  manifestRaw: unknown;
  manifestPath?: string;
}

/** Read every text file under a directory into in-memory ScanFiles. */
export async function loadSubmissionDir(root: string): Promise<LoadedSubmission> {
  const files: ScanFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const info = await stat(full).catch(() => null);
      if (!info) continue;
      if (info.isDirectory()) {
        await walk(full);
      } else if (info.isFile() && TEXT_EXT.test(entry) && info.size <= MAX_FILE_BYTES) {
        const content = await readFile(full, 'utf8').catch(() => null);
        if (content !== null) {
          files.push({ path: relative(root, full).split(sep).join('/'), content });
        }
      }
    }
  };
  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));

  let manifestRaw: unknown;
  let manifestPath: string | undefined;
  for (const name of MANIFEST_FILENAMES) {
    const found = files.find((f) => f.path === name || f.path.endsWith(`/${name}`));
    if (found) {
      try {
        manifestRaw = JSON.parse(found.content);
        manifestPath = found.path;
        break;
      } catch {
        // Malformed manifest JSON; leave manifestRaw undefined so validation
        // reports the schema error rather than crashing here.
      }
    }
  }
  return { files, manifestRaw, manifestPath };
}

/**
 * Resolve a submission source string to a local directory of files.
 *  - `github:owner/repo` (optionally `#ref`) → shallow git clone into a temp dir.
 *  - any other string → treated as a local filesystem path.
 *
 * The git clone is injectable so tests stay offline.
 */
export async function loadSubmissionSource(
  source: string,
  cloner: GitCloner = defaultCloner,
): Promise<LoadedSubmission> {
  const github = source.match(/^github:([^/\s#]+)\/([^/\s#]+)(?:#(.+))?$/);
  if (github) {
    const [, owner, repo, ref] = github;
    const dest = await mkdtemp(join(tmpdir(), 'helmr-submit-'));
    await cloner(`https://github.com/${owner}/${repo}.git`, ref, dest);
    return loadSubmissionDir(dest);
  }
  return loadSubmissionDir(source);
}

export type GitCloner = (url: string, ref: string | undefined, dest: string) => Promise<void>;

const defaultCloner: GitCloner = async (url, ref, dest) => {
  const { spawn } = await import('node:child_process');
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push(url, dest);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`git clone exited with code ${code}`)),
    );
  });
};

export interface SubmitResult {
  pipeline: PipelineResult;
  record: SubmissionRecord;
}

const scanner = new SecurityScanner();

/**
 * Run a loaded submission through the full pipeline and persist a record. The
 * record's trust level, installability, and auto-enable flag are derived purely
 * from the pipeline decision — a community submission can never publish itself
 * or auto-enable as high risk.
 */
export async function submitCapability(
  loaded: LoadedSubmission,
  store: SubmissionStore,
  options: { source?: string; scanReportPath?: string } = {},
): Promise<SubmitResult> {
  const pipeline = runPipeline(loaded.manifestRaw, loaded.files);
  const now = new Date().toISOString();

  // Fall back to a minimal identity when the manifest itself was invalid.
  const manifest = pipeline.validation.manifest;
  const id = manifest?.id ?? deriveId(loaded, options.source);

  const trustLevel = pipeline.suggestedTrust;
  const installable =
    pipeline.decision === 'PASS' && trustLevel !== 'quarantined' && trustLevel !== 'blocked';
  const autoEnabled =
    installable && manifest
      ? shouldAutoEnable(trustLevel, manifest.riskLevel)
      : false;

  const status =
    pipeline.decision === 'PASS'
      ? 'passed'
      : pipeline.decision === 'NEEDS_REVIEW'
        ? 'needs_review'
        : 'quarantined';

  const record: SubmissionRecord = {
    id,
    kind: manifest?.kind ?? 'skill',
    name: manifest?.name ?? id,
    description: manifest?.description ?? '(no manifest)',
    version: manifest?.version ?? '0.0.0',
    author: manifest?.author ?? 'unknown',
    source: options.source ?? manifest?.source ?? 'community',
    status,
    trustLevel,
    riskLevel: manifest?.riskLevel ?? 'high',
    permissions: manifest?.permissions ?? [],
    decision: pipeline.decision,
    installable,
    autoEnabled,
    scanStatus: pipeline.scan.pass ? 'pass' : 'fail',
    scanSeverity: pipeline.scan.severity,
    scanFindingCount: pipeline.scan.findings.length,
    lastScannedAt: pipeline.scan.scannedAt,
    scanReportPath: options.scanReportPath,
    installCount: 0,
    knownIssues: pipeline.reasons.slice(),
    bugReports: [],
    changelog: manifest?.changelog ?? [],
    reviewNotes: [],
    createdAt: now,
    updatedAt: now,
  };

  const persisted = await store.write(record);
  return { pipeline, record: persisted };
}

function deriveId(loaded: LoadedSubmission, source?: string): string {
  if (source) {
    const cleaned = source.replace(/^github:/, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    if (cleaned) return cleaned.replace(/^-+|-+$/g, '');
  }
  return `submission-${Date.now()}`;
}

export type { MarketplaceManifest };
