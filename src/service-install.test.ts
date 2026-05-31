import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createServiceInstallPlan, formatServiceInstallPlan, installHelmrService } from './service-install.js';

test('service install plans render Windows and WSL2 commands without executing them', () => {
  const windows = createServiceInstallPlan({ target: 'windows', helmrBin: 'helmr.cmd' });
  assert.match(formatServiceInstallPlan(windows), /Task Scheduler/);
  assert.match(windows.commands[0] ?? '', /schtasks \/Create/);
  assert.deepEqual(windows.files, []);

  const wsl2 = createServiceInstallPlan({ target: 'wsl2', homeDir: '/home/tester' });
  assert.equal(wsl2.files[0]?.path, '/home/tester/.config/systemd/user/helmr.service');
  assert.match(wsl2.files[0]?.content ?? '', /ExecStart=helmr start/);
  assert.ok(wsl2.commands.includes('systemctl --user enable --now helmr.service'));
});

test('installHelmrService writes only the WSL2 user unit file and supports dry-run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-service-install-'));
  try {
    const dryRun = await installHelmrService({ target: 'wsl2', homeDir: dir, dryRun: true });
    assert.equal(dryRun.files.length, 1);

    const installed = await installHelmrService({ target: 'wsl2', homeDir: dir });
    const content = await readFile(installed.files[0]!.path, 'utf8');
    assert.match(content, /Description=Helmr self-hosted AI orchestrator/);
    assert.match(content, /ExecStart=helmr start/);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
