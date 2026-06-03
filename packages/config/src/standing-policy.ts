import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DEFAULT_STANDING_POLICY,
  type StandingApprovalPolicy,
} from '../../cortex/src/gate.js';

/**
 * Persistence for the outward-action standing-approval policy.
 *
 * Stored as `standing-policy.json` in the config dir so an operator declares the
 * edges of autonomy (which outward classes are pre-authorized, under what
 * constraints) without code changes. Absent or malformed file → the fail-safe
 * default (everything outward is gated).
 */

export const STANDING_POLICY_FILE = 'standing-policy.json';

const TEMPLATE: StandingApprovalPolicy = {
  rules: {
    // Examples (commented intent): push only to agent branches, never main; talk
    // only to allow-listed hosts; package installs need explicit approval.
    // git pushes are modeled via the `network` capability's branch constraints
    // until a dedicated git_push capability exists.
    network: { allowHosts: [] },
  },
};

export class StandingPolicyStore {
  constructor(private readonly configDir: string) {}

  private get path(): string {
    return join(this.configDir, STANDING_POLICY_FILE);
  }

  async load(): Promise<StandingApprovalPolicy> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as StandingApprovalPolicy;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.rules !== 'object') {
        return DEFAULT_STANDING_POLICY;
      }
      return parsed;
    } catch {
      return DEFAULT_STANDING_POLICY;
    }
  }

  async save(policy: StandingApprovalPolicy): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await writeFile(this.path, JSON.stringify(policy, null, 2), 'utf8');
  }

  async init(): Promise<void> {
    const exists = await access(this.path).then(() => true).catch(() => false);
    if (!exists) await this.save(TEMPLATE);
  }
}
