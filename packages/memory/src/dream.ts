import { randomUUID } from 'node:crypto';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DreamJobMemory {
  id: string;
  status: string;
  payloadText?: string;
  lastError?: string;
  updatedAt: string;
}

export interface Dream {
  id: string;
  createdAt: string;
  reflection: string;
  themes: string[];
  suggestions: string[];
  jobsConsidered: number;
}

export interface SynthesizeDreamInput {
  recentJobs: DreamJobMemory[];
  now?: Date;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'what', 'when',
  'your', 'you', 'are', 'was', 'were', 'will', 'can', 'how', 'why', 'all',
  'any', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'it', 'be', 'as', 'at',
  'helmr', 'please', 'run', 'job', 'jobs',
]);

/**
 * Consolidate recent job memory into a "dream": a deterministic reflection the
 * system produces while idle. No model key is required — it mirrors the local
 * agent fallback so dreaming works fully self-hosted and offline. Dreams
 * summarize what Helmr has been doing, surface recurring themes, and propose
 * next steps drawn from observed successes and failures.
 */
export function synthesizeDream(input: SynthesizeDreamInput): Dream {
  const now = input.now ?? new Date();
  const jobs = input.recentJobs;

  const succeeded = jobs.filter((j) => j.status === 'succeeded').length;
  const failed = jobs.filter((j) => j.status === 'failed');
  const awaiting = jobs.filter((j) => j.status === 'awaiting_approval').length;

  const themes = extractThemes(jobs);
  const suggestions: string[] = [];

  if (jobs.length === 0) {
    suggestions.push('No recent activity — propose a workspace inspection to stay warm.');
  }
  if (failed.length > 0) {
    const sample = failed[0]?.lastError?.trim();
    suggestions.push(
      `Investigate ${failed.length} failed job(s)` +
        (sample ? `; most recent error: ${truncate(sample, 140)}` : '') + '.',
    );
  }
  if (awaiting > 0) {
    suggestions.push(`Nudge the owner: ${awaiting} job(s) are waiting on approval.`);
  }
  if (themes.length > 0) {
    suggestions.push(`Recurring focus on "${themes.slice(0, 3).join('", "')}" — consider a standing playbook.`);
  }
  if (suggestions.length === 0) {
    suggestions.push('System healthy and idle — keep audit chain verification and self-test green.');
  }

  const reflection =
    `While idle, Helmr reviewed ${jobs.length} recent job(s): ` +
    `${succeeded} succeeded, ${failed.length} failed, ${awaiting} awaiting approval. ` +
    (themes.length > 0
      ? `Attention clustered around ${themes.slice(0, 3).join(', ')}.`
      : 'No dominant theme emerged.');

  return {
    id: `dream_${randomUUID()}`,
    createdAt: now.toISOString(),
    reflection,
    themes,
    suggestions,
    jobsConsidered: jobs.length,
  };
}

function extractThemes(jobs: DreamJobMemory[]): string[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const text = job.payloadText?.toLowerCase() ?? '';
    for (const word of text.split(/[^a-z0-9]+/)) {
      if (word.length < 3 || STOP_WORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Append-only journal of dreams, stored as JSONL alongside the rest of Helmr's
 * local memory so a dream history can be replayed and surfaced in Hatchery.
 */
export class DreamJournal {
  private readonly filePath: string;

  constructor(private readonly rootDir: string) {
    this.filePath = join(rootDir, 'dreams.jsonl');
  }

  async record(dream: Dream): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(dream)}\n`, 'utf8');
  }

  async list(limit = 20): Promise<Dream[]> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const dreams = content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Dream);
      return dreams.slice(-limit).reverse();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
