import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const temp = await mkdtemp(join(tmpdir(), 'helmr-pack-'));
try {
  execFileSync('npm', ['pack', '--dry-run'], { cwd: root, stdio: 'inherit' });
  const packName = execFileSync('npm', ['pack', '--json'], { cwd: root, encoding: 'utf8' });
  const tarball = JSON.parse(packName)[0].filename;
  execFileSync('npm', ['init', '-y'], { cwd: temp, stdio: 'ignore' });
  execFileSync('npm', ['install', join(root, tarball)], { cwd: temp, stdio: 'inherit' });
  execFileSync(join(temp, 'node_modules/.bin/helmr'), ['--help'], { cwd: temp, stdio: 'inherit', env: { ...process.env, HELMR_AUTH_MODE: 'none' } });
  execFileSync(join(temp, 'node_modules/.bin/helmr'), ['self-test'], { cwd: temp, stdio: 'inherit', env: { ...process.env, HELMR_AUTH_MODE: 'none' } });
} finally {
  await rm(temp, { recursive: true, force: true });
}
