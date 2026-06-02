import { createHash } from 'node:crypto';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AuditRecordKind = 'event' | 'job' | 'plan' | 'receipt' | 'result' | 'budget';

export interface AuditRecord {
  kind: AuditRecordKind;
  jobId: string;
  createdAt: string;
  data: unknown;
  previousHash?: string;
  hash?: string;
}

export interface AuditVerification {
  valid: boolean;
  recordsChecked: number;
  failureReason?: string;
}

export class JsonlAuditLog {
  constructor(private readonly rootDir: string) {}

  async append(record: AuditRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const previousHash = await this.getLastHash(record.jobId);
    const chained = withHash(record, previousHash);
    await appendFile(this.pathForJob(record.jobId), `${JSON.stringify(chained)}\n`, 'utf8');
  }

  async readJob(jobId: string): Promise<AuditRecord[]> {
    try {
      const content = await readFile(this.pathForJob(jobId), 'utf8');
      return content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditRecord);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async verifyJob(jobId: string): Promise<AuditVerification> {
    const lines = await this.readLines(jobId);
    let previousHash: string | undefined;

    for (let index = 0; index < lines.length; index++) {
      const record = JSON.parse(lines[index] ?? '') as AuditRecord;
      const expectedHash = hashRecord({ ...record, hash: undefined });
      const lineNumber = index + 1;

      if (record.previousHash !== previousHash) {
        return {
          valid: false,
          recordsChecked: index,
          failureReason: `previous hash mismatch at line ${lineNumber}`,
        };
      }

      if (record.hash !== expectedHash) {
        return {
          valid: false,
          recordsChecked: index,
          failureReason: `hash mismatch at line ${lineNumber}`,
        };
      }

      previousHash = record.hash;
    }

    return { valid: true, recordsChecked: lines.length };
  }

  private async getLastHash(jobId: string): Promise<string | undefined> {
    const lines = await this.readLines(jobId);
    const lastLine = lines.at(-1);
    if (!lastLine) {
      return undefined;
    }

    const record = JSON.parse(lastLine) as AuditRecord;
    return record.hash;
  }

  private async readLines(jobId: string): Promise<string[]> {
    try {
      const content = await readFile(this.pathForJob(jobId), 'utf8');
      return content.split('\n').filter(Boolean);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private pathForJob(jobId: string): string {
    return join(this.rootDir, `${jobId}.jsonl`);
  }
}

function withHash(record: AuditRecord, previousHash: string | undefined): AuditRecord {
  const base = { ...record, previousHash, hash: undefined };
  return { ...base, hash: hashRecord(base) };
}

function hashRecord(record: AuditRecord): string {
  const stableRecord = { ...record };
  delete stableRecord.hash;
  return createHash('sha256').update(JSON.stringify(stableRecord)).digest('hex');
}
