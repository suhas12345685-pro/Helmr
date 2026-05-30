'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchSettings, runSelfTest, restartDaemon } from '@/lib/api';

interface ModelRoute {
  taskType: string;
  provider: string;
  model: string;
}

interface Settings {
  workspacePath?: string;
  modelRoutes?: ModelRoute[];
  daemonStatus?: 'running' | 'stopped' | 'unknown';
  [key: string]: unknown;
}

function SelfTestResults({ results }: { results: Record<string, unknown> | null }) {
  if (!results) return null;
  return (
    <div className="mt-4 bg-gray-900 rounded-lg p-4 font-mono text-xs space-y-1">
      {Object.entries(results).map(([key, val]) => {
        const passed = val === true || val === 'ok' || val === 'pass';
        const failed = val === false || val === 'fail' || val === 'error';
        return (
          <div key={key} className="flex items-center gap-3">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                passed ? 'bg-green-400' : failed ? 'bg-red-400' : 'bg-yellow-400'
              }`}
            />
            <span className="text-gray-400">{key}</span>
            <span className={passed ? 'text-green-300' : failed ? 'text-red-300' : 'text-yellow-300'}>
              {String(val)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selfTestResults, setSelfTestResults] = useState<Record<string, unknown> | null>(null);
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [selfTestError, setSelfTestError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchSettings();
      setSettings(data as Settings);
    } catch {
      setLoadError('Gateway unavailable — settings cannot be loaded.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSelfTest() {
    setSelfTestRunning(true);
    setSelfTestError(null);
    setSelfTestResults(null);
    try {
      const results = await runSelfTest();
      setSelfTestResults(results);
    } catch (err) {
      setSelfTestError(err instanceof Error ? err.message : 'Self-test failed');
    } finally {
      setSelfTestRunning(false);
    }
  }

  async function handleRestartDaemon() {
    setRestarting(true);
    setRestartMsg(null);
    try {
      await restartDaemon();
      setRestartMsg('Daemon restart initiated.');
    } catch (err) {
      setRestartMsg(err instanceof Error ? err.message : 'Restart failed');
    } finally {
      setRestarting(false);
    }
  }

  const modelRoutes: ModelRoute[] = settings?.modelRoutes ?? [
    { taskType: 'default', provider: 'anthropic', model: 'claude-3-5-sonnet' },
    { taskType: 'code', provider: 'anthropic', model: 'claude-3-5-sonnet' },
    { taskType: 'search', provider: 'openai', model: 'gpt-4o' },
    { taskType: 'summarize', provider: 'groq', model: 'llama3-70b' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h2 className="text-lg font-semibold text-gray-100">Settings</h2>

      {loadError && (
        <div className="bg-gray-800 rounded-lg border border-yellow-800 p-3 text-yellow-400 text-xs">
          {loadError}
        </div>
      )}

      <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Workspace</h3>
        <div className="flex items-center gap-3">
          <code className="font-mono text-xs text-indigo-300 bg-gray-900 px-3 py-2 rounded flex-1 truncate">
            {settings?.workspacePath ?? '~/helmr'}
          </code>
        </div>
      </section>

      <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Model Routing</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left pb-2 pr-4">Task Type</th>
                <th className="text-left pb-2 pr-4">Provider</th>
                <th className="text-left pb-2">Model</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {modelRoutes.map((route, i) => (
                <tr key={i}>
                  <td className="py-2 pr-4 text-gray-300 font-mono">{route.taskType}</td>
                  <td className="py-2 pr-4 text-indigo-300">{route.provider}</td>
                  <td className="py-2 text-gray-300 font-mono">{route.model}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Daemon</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                settings?.daemonStatus === 'running' ? 'bg-green-400' : 'bg-gray-500'
              }`}
            />
            <span className="text-xs text-gray-400">
              {settings?.daemonStatus ?? 'unknown'}
            </span>
          </div>
          <button
            onClick={handleRestartDaemon}
            disabled={restarting}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium py-1.5 px-3 rounded transition-colors"
          >
            {restarting ? 'Restarting...' : 'Restart Daemon'}
          </button>
        </div>
        {restartMsg && (
          <p className="text-xs text-gray-400 mt-2">{restartMsg}</p>
        )}
      </section>

      <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300">Self-Test</h3>
          <button
            onClick={handleSelfTest}
            disabled={selfTestRunning}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium py-1.5 px-3 rounded transition-colors"
          >
            {selfTestRunning ? 'Running...' : 'Run Self-Test'}
          </button>
        </div>
        {selfTestError && (
          <p className="text-xs text-red-400">{selfTestError}</p>
        )}
        <SelfTestResults results={selfTestResults} />
      </section>
    </div>
  );
}
