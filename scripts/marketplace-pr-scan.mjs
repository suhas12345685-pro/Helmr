#!/usr/bin/env node
/**
 * Marketplace PR security gate.
 *
 * Runs the full submission pipeline (manifest validation → security scan →
 * contract tests → decision) over every marketplace submission in the repo,
 * then emits:
 *   - a Markdown PR comment (written to the path in $MARKETPLACE_COMMENT_FILE,
 *     default marketplace-scan-comment.md),
 *   - the labels the PR should carry (written to $GITHUB_OUTPUT as `labels`),
 *   - a non-zero exit code when any submission has a critical/high finding, so
 *     the workflow blocks merge.
 *
 * Submissions live in `marketplace/<id>/` directories, each with a manifest
 * (helmr.manifest.json / manifest.json / skill.json). Pass explicit directories
 * as arguments to scan only those; otherwise every `marketplace/*` dir is scanned.
 *
 * This script imports the compiled packages from dist, so run `npm run build:ts`
 * first (the workflow does).
 */
import { readdir, stat, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const {
  loadSubmissionDir,
  runPipeline,
  deriveLabels,
  shouldBlockMerge,
  renderPrComment,
} = await import(join(repoRoot, 'dist/packages/marketplace-submissions/src/index.js'));

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function discoverSubmissionDirs() {
  const root = join(repoRoot, 'marketplace');
  if (!(await isDir(root))) return [];
  const entries = await readdir(root);
  const dirs = [];
  for (const entry of entries) {
    const full = join(root, entry);
    if (await isDir(full)) dirs.push(full);
  }
  return dirs;
}

async function main() {
  const explicit = process.argv.slice(2);
  const dirs = explicit.length > 0 ? explicit : await discoverSubmissionDirs();

  const results = [];
  for (const dir of dirs) {
    const loaded = await loadSubmissionDir(dir);
    const pipeline = runPipeline(loaded.manifestRaw, loaded.files);
    const id = pipeline.validation.manifest?.id ?? basename(dir);
    results.push({ id, path: dir, pipeline });
    console.log(`Scanned ${id}: ${pipeline.decision} (severity ${pipeline.scan.severity})`);
  }

  const comment = renderPrComment(results);
  const commentFile = process.env.MARKETPLACE_COMMENT_FILE || join(repoRoot, 'marketplace-scan-comment.md');
  await mkdir(dirname(commentFile), { recursive: true });
  await writeFile(commentFile, comment, 'utf8');

  const labels = deriveLabels(results);
  const blocked = shouldBlockMerge(results);

  // Surface results in the workflow run summary.
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, comment + '\n', 'utf8');
  }
  // Hand labels + block decision to later workflow steps.
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `labels=${labels.join(',')}\nblocked=${blocked}\ncomment_file=${commentFile}\n`,
      'utf8',
    );
  }

  console.log(`\nLabels: ${labels.join(', ')}`);
  console.log(`Blocked: ${blocked}`);

  if (blocked) {
    console.error('\n❌ Marketplace security gate failed: critical/high findings present.');
    process.exit(1);
  }
  console.log('\n✅ Marketplace security gate passed.');
}

main().catch((err) => {
  console.error('marketplace-pr-scan failed:', err);
  process.exit(2);
});
