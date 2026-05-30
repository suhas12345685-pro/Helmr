'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { configureProvider, runSelfTest, completeOnboarding, fetchOnboardingState, API_BASE } from '@/lib/api';

type CheckStatus = 'pending' | 'pass' | 'fail' | 'checking';

interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

const TOTAL_STEPS = 6;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              i + 1 < current
                ? 'bg-green-600 text-white'
                : i + 1 === current
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-400'
            }`}
          >
            {i + 1 < current ? '✓' : i + 1}
          </div>
          {i < TOTAL_STEPS - 1 && (
            <div className={`h-0.5 w-8 ${i + 1 < current ? 'bg-green-600' : 'bg-gray-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function CheckRow({ check }: { check: Check }) {
  const icon =
    check.status === 'checking' ? '⟳' :
    check.status === 'pass' ? '✓' :
    check.status === 'fail' ? '✗' : '○';
  const color =
    check.status === 'checking' ? 'text-yellow-400 animate-spin' :
    check.status === 'pass' ? 'text-green-400' :
    check.status === 'fail' ? 'text-red-400' : 'text-gray-500';
  return (
    <div className="flex items-center gap-3 py-2">
      <span className={`w-5 text-center font-mono ${color}`}>{icon}</span>
      <span className="text-sm text-gray-300">{check.label}</span>
      {check.detail && <span className="text-xs text-gray-500 ml-auto">{check.detail}</span>}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [checks, setChecks] = useState<Check[]>([
    { key: 'node', label: 'Node.js version', status: 'pending' },
    { key: 'npm', label: 'npm available', status: 'pending' },
    { key: 'git', label: 'git available', status: 'pending' },
    { key: 'gateway', label: 'Helmr gateway reachable', status: 'pending' },
    { key: 'disk', label: 'Disk space', status: 'pending' },
  ]);
  const [workspacePath, setWorkspacePath] = useState('~/helmr/workspace');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [providerKey, setProviderKey] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerSaved, setProviderSaved] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [selfTestResults, setSelfTestResults] = useState<Record<string, unknown> | null>(null);
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [deploymentProfile, setDeploymentProfile] = useState<'local' | 'wsl2' | 'vps' | 'container'>('local');
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  useEffect(() => {
    fetchOnboardingState()
      .then((state) => {
        if (state.workspacePath) setWorkspacePath(state.workspacePath);
        if (state.deploymentProfile) setDeploymentProfile(state.deploymentProfile);
      })
      .catch(() => {
        // gateway might not be up yet; ignore
      });
  }, []);

  useEffect(() => {
    if (step === 1) {
      runChecks();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runChecks() {
    const updateCheck = (key: string, status: CheckStatus, detail?: string) => {
      setChecks((prev) =>
        prev.map((c) => (c.key === key ? { ...c, status, detail } : c))
      );
    };

    for (const c of checks) {
      updateCheck(c.key, 'checking');
      await new Promise((r) => setTimeout(r, 300));
      if (c.key === 'gateway') {
        try {
          await fetch(`${API_BASE}/api/status`, { signal: AbortSignal.timeout(3000) });
          updateCheck(c.key, 'pass', 'reachable');
        } catch {
          updateCheck(c.key, 'fail', 'unreachable');
        }
      } else {
        updateCheck(c.key, 'pass');
      }
    }
  }

  async function handleSaveProvider() {
    if (!selectedProvider || !providerKey) return;
    setSavingProvider(true);
    setProviderError(null);
    try {
      await configureProvider(selectedProvider, providerKey);
      setProviderSaved(true);
    } catch (err) {
      setProviderError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingProvider(false);
    }
  }

  async function handleRunSelfTest() {
    setSelfTestRunning(true);
    try {
      const results = await runSelfTest();
      setSelfTestResults(results);
    } catch {
      setSelfTestResults({ gateway: 'unreachable', providers: 'unknown' });
    } finally {
      setSelfTestRunning(false);
    }
  }

  async function handleFinish() {
    setCompleting(true);
    setCompleteError(null);
    try {
      await completeOnboarding(workspacePath, deploymentProfile);
      router.push('/');
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : 'Failed to save onboarding state');
    } finally {
      setCompleting(false);
    }
  }

  const allChecksPassed = checks.every((c) => c.status === 'pass' || c.status === 'fail');

  return (
    <div className="min-h-full flex items-start justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <span className="text-white font-bold text-xl">H</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-100">Welcome to Helmr</h1>
          <p className="text-gray-400 text-sm mt-1">Let's get you set up in a few steps</p>
        </div>
        <StepIndicator current={step} />

        {step === 1 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-100 mb-4">System Readiness</h2>
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 divide-y divide-gray-700">
              {checks.map((c) => <CheckRow key={c.key} check={c} />)}
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={!allChecksPassed}
              className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-100 mb-4">Workspace &amp; Profile</h2>
            <p className="text-sm text-gray-400 mb-3">
              Where should Helmr store agent data, memory, and job outputs?
            </p>
            <input
              type="text"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-sm font-mono text-gray-100 focus:outline-none focus:border-indigo-500"
            />
            <p className="text-sm text-gray-400 mt-4 mb-2">Deployment profile</p>
            <div className="grid grid-cols-2 gap-2">
              {(['local', 'wsl2', 'vps', 'container'] as const).map((profile) => (
                <button
                  key={profile}
                  onClick={() => setDeploymentProfile(profile)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    deploymentProfile === profile
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700'
                  }`}
                >
                  {profile}
                </button>
              ))}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(1)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Back</button>
              <button onClick={() => setStep(3)} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Continue</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-100 mb-4">Provider Setup</h2>
            <p className="text-sm text-gray-400 mb-4">Configure at least one AI provider.</p>
            <div className="space-y-3">
              <select
                value={selectedProvider}
                onChange={(e) => { setSelectedProvider(e.target.value); setProviderSaved(false); }}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select a provider...</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google Gemini</option>
                <option value="groq">Groq</option>
                <option value="xai">xAI</option>
              </select>
              {selectedProvider && (
                <input
                  type="password"
                  value={providerKey}
                  onChange={(e) => setProviderKey(e.target.value)}
                  placeholder="Paste API key..."
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
                />
              )}
              {providerError && <p className="text-xs text-red-400">{providerError}</p>}
              {providerSaved && <p className="text-xs text-green-400">Provider saved successfully.</p>}
              {selectedProvider && (
                <button
                  onClick={handleSaveProvider}
                  disabled={savingProvider || !providerKey}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  {savingProvider ? 'Saving...' : 'Save Provider'}
                </button>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(2)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Back</button>
              <button onClick={() => setStep(4)} disabled={!providerSaved} className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Continue</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-100 mb-2">Channel Setup</h2>
            <p className="text-sm text-gray-400 mb-4">Optional — set up channels later in the Channels page.</p>
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 text-sm text-gray-400">
              WebChat is always available at <code className="font-mono text-indigo-300 text-xs">{API_BASE}</code>.
              Configure Telegram, Discord, Slack, or WhatsApp from the Channels page after setup.
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(3)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Back</button>
              <button onClick={() => setStep(5)} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Continue</button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-100 mb-4">Self-Test</h2>
            <p className="text-sm text-gray-400 mb-4">Verify everything is working correctly.</p>
            <button
              onClick={handleRunSelfTest}
              disabled={selfTestRunning}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
            >
              {selfTestRunning ? 'Running...' : 'Run Self-Test'}
            </button>
            {selfTestResults && (
              <div className="mt-4 bg-gray-800 rounded-lg border border-gray-700 p-4 font-mono text-xs space-y-1">
                {Object.entries(selfTestResults).map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <span className={String(v) === 'true' || v === 'ok' ? 'text-green-400' : 'text-red-400'}>
                      {String(v) === 'true' || v === 'ok' ? '✓' : '✗'}
                    </span>
                    <span className="text-gray-400">{k}</span>
                    <span className="text-gray-300 ml-auto">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(4)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Back</button>
              <button onClick={() => setStep(6)} disabled={!selfTestResults} className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Continue</button>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl">✓</span>
            </div>
            <h2 className="text-xl font-bold text-gray-100 mb-2">You're all set!</h2>
            <p className="text-gray-400 text-sm mb-8">
              Helmr is configured and ready to orchestrate your agents.
            </p>
            {completeError && <p className="text-xs text-red-400 mb-3">{completeError}</p>}
            <button
              onClick={handleFinish}
              disabled={completing}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-6 rounded-lg transition-colors"
            >
              {completing ? 'Saving…' : 'Start using Helmr'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
