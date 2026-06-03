import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { ScanResult } from '../../security-scanner/src/index.js';
import type { MarketplaceManifest } from './manifest.js';
import type { Decision } from './pipeline.js';
import { isInstallable, type TrustLevel } from './trust.js';

const RECORD_SUFFIX = '.submission.json';

/** A capability's lifecycle state in the marketplace. */
export type SubmissionStatus =
  | 'submitted'
  | 'scanning'
  | 'passed'
  | 'failed'
  | 'needs_review'
  | 'quarantined'
  | 'approved'
  | 'rejected'
  | 'published';

/**
 * The durable record for one marketplace submission. It carries everything the
 * marketplace and the Hatchery UI must show for an item: source, author, trust
 * level, risk level, permissions, scan status, last-scanned date, install count,
 * known issues, bug reports, and changelog.
 */
export interface SubmissionRecord {
  id: string;
  kind: MarketplaceManifest['kind'];
  name: string;
  description: string;
  version: string;
  author: string;
  source: string;
  status: SubmissionStatus;
  trustLevel: TrustLevel;
  riskLevel: MarketplaceManifest['riskLevel'];
  permissions: string[];
  decision: Decision;
  /** Whether the item may currently be installed through normal flows. */
  installable: boolean;
  /** Whether the item is enabled by default after install. */
  autoEnabled: boolean;
  scanStatus: 'pending' | 'pass' | 'fail';
  scanSeverity: ScanResult['severity'];
  scanFindingCount: number;
  lastScannedAt?: string;
  scanReportPath?: string;
  installCount: number;
  knownIssues: string[];
  bugReports: string[];
  changelog: string[];
  reviewNotes: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * File-backed store of marketplace submissions, mirroring SkillRegistry's
 * stateless-rescan design: each item is a `<id>.submission.json` file, so an
 * approved or quarantined item is reflected everywhere on the next read with no
 * restart.
 */
export class SubmissionStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}${RECORD_SUFFIX}`);
  }

  async list(): Promise<SubmissionRecord[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }
    const records = await Promise.all(
      entries
        .filter((e) => e.endsWith(RECORD_SUFFIX))
        .sort()
        .map(async (entry) => {
          try {
            return JSON.parse(await readFile(join(this.dir, entry), 'utf8')) as SubmissionRecord;
          } catch {
            return null;
          }
        }),
    );
    return records.filter((r): r is SubmissionRecord => r !== null);
  }

  async get(id: string): Promise<SubmissionRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.fileFor(id), 'utf8')) as SubmissionRecord;
    } catch {
      return undefined;
    }
  }

  async write(record: SubmissionRecord): Promise<SubmissionRecord> {
    await this.init();
    const now = new Date().toISOString();
    const existing = await this.get(record.id);
    const next: SubmissionRecord = {
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt ?? now,
      updatedAt: now,
    };
    await writeFile(this.fileFor(record.id), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  async remove(id: string): Promise<boolean> {
    try {
      await rm(this.fileFor(id));
      return true;
    } catch {
      return false;
    }
  }

  /** Apply a partial update to an existing record. */
  async patch(id: string, patch: Partial<SubmissionRecord>): Promise<SubmissionRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    return this.write({ ...existing, ...patch });
  }

  // --- Lifecycle transitions -------------------------------------------------

  /** Quarantine an item: it failed a scan or is broken and cannot install. */
  async quarantine(id: string, reason: string): Promise<SubmissionRecord | undefined> {
    return this.transition(id, {
      status: 'quarantined',
      trustLevel: 'quarantined',
      installable: false,
      autoEnabled: false,
      reviewNote: `Quarantined: ${reason}`,
    });
  }

  /** Maintainer approval — promotes a reviewed item toward verified. */
  async approve(id: string, note = 'Approved by maintainer'): Promise<SubmissionRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    // Approval only meaningfully applies to items that passed scanning.
    const trust: TrustLevel = existing.scanStatus === 'pass' ? 'verified' : existing.trustLevel;
    return this.transition(id, {
      status: 'approved',
      trustLevel: trust,
      installable: isInstallable(trust),
      reviewNote: note,
    });
  }

  async reject(id: string, reason: string): Promise<SubmissionRecord | undefined> {
    return this.transition(id, {
      status: 'rejected',
      trustLevel: 'blocked',
      installable: false,
      autoEnabled: false,
      reviewNote: `Rejected: ${reason}`,
    });
  }

  /** Publish an approved item so it is visible and installable. */
  async publish(id: string): Promise<{ record?: SubmissionRecord; error?: string }> {
    const existing = await this.get(id);
    if (!existing) return { error: `No submission with id ${id}.` };
    if (existing.scanStatus !== 'pass') {
      return { error: 'Cannot publish: submission has not passed a clean security scan.' };
    }
    if (existing.status !== 'approved') {
      return { error: 'Cannot publish: submission has not been approved by a maintainer.' };
    }
    const record = await this.transition(id, {
      status: 'published',
      installable: true,
      reviewNote: 'Published to marketplace.',
    });
    return { record };
  }

  async recordBug(id: string, summary: string): Promise<SubmissionRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    return this.write({ ...existing, bugReports: [...existing.bugReports, summary] });
  }

  async incrementInstalls(id: string): Promise<SubmissionRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    return this.write({ ...existing, installCount: existing.installCount + 1 });
  }

  private async transition(
    id: string,
    change: Partial<SubmissionRecord> & { reviewNote?: string },
  ): Promise<SubmissionRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    const { reviewNote, ...rest } = change;
    return this.write({
      ...existing,
      ...rest,
      reviewNotes: reviewNote
        ? [...existing.reviewNotes, `${new Date().toISOString()} ${reviewNote}`]
        : existing.reviewNotes,
    });
  }
}
