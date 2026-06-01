'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchAgents, fetchTasks, AgentBodyView, TaskLedgerView } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-gray-700 text-gray-300',
  working: 'bg-indigo-900/60 text-indigo-300',
  paused: 'bg-yellow-900/50 text-yellow-300',
  blocked: 'bg-orange-900/50 text-orange-300',
  stopped: 'bg-gray-800 text-gray-500',
  error: 'bg-red-900/60 text-red-300',
  spawning: 'bg-blue-900/50 text-blue-300',
  done: 'bg-green-900/60 text-green-300',
  failed: 'bg-red-900/60 text-red-300',
};

function Badge({ value }: { value: string }) {
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[value] ?? 'bg-gray-700 text-gray-300'}`}>
      {value}
    </span>
  );
}

function AgentCard({ agent }: { agent: AgentBodyView }) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-100">{agent.role}</span>
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
              {agent.workspaceKind}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 font-mono mt-1">{agent.agentId}</p>
        </div>
        <Badge value={agent.status} />
      </div>

      <div className="mt-3 text-xs text-gray-400 space-y-1">
        <div>
          Task: <span className="text-gray-200">{agent.taskState.description ?? '—'}</span>{' '}
          {agent.taskState.status !== 'none' && <Badge value={agent.taskState.status} />}
        </div>
        <div className="font-mono text-[11px] text-gray-500">workspace: {agent.workspaceId}</div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-700">
        {agent.permissions.map((p) => (
          <span key={p} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-900 text-indigo-300 border border-gray-700">
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentBodyView[]>([]);
  const [tasks, setTasks] = useState<TaskLedgerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([fetchAgents(), fetchTasks()]);
      setAgents(a);
      setTasks(t);
      setError(null);
    } catch {
      setError('Gateway unavailable — could not load agents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000); // live-ish refresh
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-100">Agents</h2>
        <p className="text-sm text-gray-400 mt-1">
          Live embodied agents. Each has its own isolated body — workspace, eyes, keyboard, and
          mouse. The user&apos;s real machine is never touched.
        </p>
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading...</p>}
      {error && (
        <div className="bg-gray-800 rounded-lg border border-yellow-800 p-3 text-yellow-400 text-xs mb-4">
          {error}
        </div>
      )}
      {!loading && agents.length === 0 && !error && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 text-center text-sm text-gray-400 mb-6">
          No agents running. Helmr spins these up when a task needs parallel or embodied work.
        </div>
      )}

      {agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
          {agents.map((agent) => (
            <AgentCard key={agent.agentId} agent={agent} />
          ))}
        </div>
      )}

      <h3 className="text-sm font-semibold text-gray-200 mb-3">Task Ledger</h3>
      {tasks.length === 0 ? (
        <p className="text-xs text-gray-500">No tasks recorded yet.</p>
      ) : (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-900 text-gray-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Task</th>
                <th className="text-left px-3 py-2 font-medium">Agent</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {tasks.map((task) => (
                <tr key={task.taskId}>
                  <td className="px-3 py-2 text-gray-200">{task.description}</td>
                  <td className="px-3 py-2 font-mono text-gray-500">{task.assignedAgentId ?? '—'}</td>
                  <td className="px-3 py-2"><Badge value={task.status} /></td>
                  <td className="px-3 py-2 text-gray-400">{task.actions.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
