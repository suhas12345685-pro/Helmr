import { createClient } from '@libsql/client';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface HelmrStateLocations {
  dataDir: string;
  auditDir: string;
  configDir: string;
}

export interface HelmrBackupOptions extends HelmrStateLocations {
  backupDir: string;
  dbFileName?: string;
}

export interface HelmrRestoreOptions extends HelmrStateLocations {
  backupDir: string;
  dbFileName?: string;
}

export interface HelmrBackupManifest {
  dbPath: string;
  auditDir: string;
  configDir: string;
}

/**
 * Create a portable snapshot of Helmr's durable state.
 *
 * The SQLite file is copied with SQLite's `VACUUM INTO` command so callers can
 * safely snapshot a running daemon without risking a torn raw file copy. Audit
 * and config directories are file-backed state and are copied recursively into
 * the backup bundle next to the database snapshot.
 */
export async function backupHelmrState(options: HelmrBackupOptions): Promise<HelmrBackupManifest> {
  const dbFileName = options.dbFileName ?? 'helmr.db';
  const sourceDbPath = join(options.dataDir, dbFileName);
  const backupDbPath = join(options.backupDir, dbFileName);
  const backupAuditDir = join(options.backupDir, 'audit');
  const backupConfigDir = join(options.backupDir, 'config');

  await mkdir(options.backupDir, { recursive: true });
  await rm(backupDbPath, { force: true });
  await sqliteOnlineBackup(sourceDbPath, backupDbPath);
  await copyDirectoryOrCreateEmpty(options.auditDir, backupAuditDir);
  await copyDirectoryOrCreateEmpty(options.configDir, backupConfigDir);

  return {
    dbPath: backupDbPath,
    auditDir: backupAuditDir,
    configDir: backupConfigDir,
  };
}

/** Restore a Helmr state snapshot created by {@link backupHelmrState}. */
export async function restoreHelmrState(options: HelmrRestoreOptions): Promise<void> {
  const dbFileName = options.dbFileName ?? 'helmr.db';
  const backupDbPath = join(options.backupDir, dbFileName);
  const targetDbPath = join(options.dataDir, dbFileName);

  await mkdir(options.dataDir, { recursive: true });
  await rm(targetDbPath, { force: true });
  await cp(backupDbPath, targetDbPath, { force: true });

  await replaceDirectory(join(options.backupDir, 'audit'), options.auditDir);
  await replaceDirectory(join(options.backupDir, 'config'), options.configDir);
}

async function sqliteOnlineBackup(sourceDbPath: string, backupDbPath: string): Promise<void> {
  await mkdir(dirname(backupDbPath), { recursive: true });
  const client = createClient({ url: `file:${sourceDbPath}` });
  try {
    await client.execute(`VACUUM INTO ${sqliteStringLiteral(backupDbPath)}`);
  } finally {
    client.close();
  }
}

async function copyDirectoryOrCreateEmpty(sourceDir: string, targetDir: string): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  try {
    await cp(sourceDir, targetDir, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    await mkdir(targetDir, { recursive: true });
  }
}

async function replaceDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
}

function sqliteStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
