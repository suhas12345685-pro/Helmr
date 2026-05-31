import { randomUUID } from 'node:crypto';

import type { HealingProbe, Incident, Remediation } from '../../scheduler/src/self-healing.js';
import type { ChannelAdapter } from './types.js';

export interface ChannelHealingSource {
  getAdapters(): readonly ChannelAdapter[];
}

/**
 * Detects channel adapters that have dropped into a `failed` state — a socket
 * died, a gateway closed — so the self-healing agent can restart them. This is
 * the channel subsystem's contribution to the MAPE-K monitor step.
 */
export function createChannelHealingProbe(source: ChannelHealingSource): HealingProbe {
  return {
    name: 'channels',
    async detect(): Promise<Incident[]> {
      return source
        .getAdapters()
        .filter((adapter) => adapter.getStatus() === 'failed')
        .map((adapter) => ({
          id: `incident_${randomUUID()}`,
          subsystem: 'channels',
          target: adapter.kind,
          symptom: `channel ${adapter.kind} is in a failed state`,
          rootCause: 'adapter connection dropped or errored',
          severity: 'warning' as const,
        }));
    },
  };
}

/**
 * Restarts a failed channel adapter (stop → markPaired → start) and validates
 * that it came back to an active state.
 */
export function createChannelRemediation(source: ChannelHealingSource): Remediation {
  const find = (kind?: string): ChannelAdapter | undefined =>
    source.getAdapters().find((adapter) => adapter.kind === kind);

  return {
    name: 'restart-channel',
    canHandle: (incident) => incident.subsystem === 'channels' && Boolean(incident.target),
    async remediate(incident) {
      const adapter = find(incident.target);
      if (!adapter) return { action: 'noop', detail: 'adapter no longer supervised' };
      await adapter.stop();
      adapter.markPaired();
      await adapter.start();
      return { action: 'restarted', detail: adapter.kind };
    },
    async validate(incident) {
      const adapter = find(incident.target);
      if (!adapter) return true;
      return adapter.getStatus() === 'active';
    },
  };
}
