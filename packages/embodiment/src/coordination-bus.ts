import type { AgentChannel, AgentMessage, CoordinationBus } from './types.js';

/**
 * In-memory coordination bus. Agents talk through it instead of guessing about
 * each other. Routing:
 *   - channel "direct"       -> the single toAgentId
 *   - channel "broadcast"    -> every subscribed agent except the sender
 *   - channel "orchestrator" -> orchestrator subscribers
 * Every message is recorded for replay, trust, and debugging.
 */
export class InMemoryCoordinationBus implements CoordinationBus {
  private readonly agentListeners = new Map<string, Set<(m: AgentMessage) => void>>();
  private readonly orchestratorListeners = new Set<(m: AgentMessage) => void>();
  private readonly log: AgentMessage[] = [];

  publish(message: AgentMessage): void {
    this.log.push(message);

    if (message.channel === 'orchestrator') {
      for (const listener of this.orchestratorListeners) listener(message);
      return;
    }

    if (message.channel === 'direct') {
      if (!message.toAgentId) return;
      for (const listener of this.agentListeners.get(message.toAgentId) ?? []) listener(message);
      // The orchestrator can observe direct traffic too, for the ledger.
      for (const listener of this.orchestratorListeners) listener(message);
      return;
    }

    // broadcast: everyone except the sender, plus the orchestrator.
    for (const [agentId, listeners] of this.agentListeners) {
      if (agentId === message.fromAgentId) continue;
      for (const listener of listeners) listener(message);
    }
    for (const listener of this.orchestratorListeners) listener(message);
  }

  subscribe(agentId: string, listener: (m: AgentMessage) => void): () => void {
    let set = this.agentListeners.get(agentId);
    if (!set) {
      set = new Set();
      this.agentListeners.set(agentId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  subscribeOrchestrator(listener: (m: AgentMessage) => void): () => void {
    this.orchestratorListeners.add(listener);
    return () => {
      this.orchestratorListeners.delete(listener);
    };
  }

  channelFor(agentId: string): AgentChannel {
    return {
      agentId,
      send: (message) => {
        this.publish({
          ...message,
          fromAgentId: agentId,
          timestamp: new Date().toISOString(),
        });
      },
      onMessage: (listener) => this.subscribe(agentId, listener),
    };
  }

  history(): AgentMessage[] {
    return [...this.log];
  }
}
