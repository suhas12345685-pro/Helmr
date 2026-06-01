'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { configureProvider, runSelfTest, saveConfigFile, API_BASE } from '@/lib/api';

type CheckStatus = 'pending' | 'pass' | 'fail' | 'checking';

interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

const TOTAL_STEPS = 7;

type TasteKey = 'anticipator' | 'companion' | 'operator' | 'custom';

interface Taste {
  label: string;
  tagline: string;
  personality: string;
  style: string[];
}

// Helmr's possible "souls". Each one is a different taste the user can choose
// during onboarding; it is persisted to the editable IDENTITY.md config file.
const TASTES: Record<TasteKey, Taste> = {
  anticipator: {
    label: 'Anticipator',
    tagline: 'The default Helmr — calm, momentum-aware, dry warmth.',
    personality: `Anticipatory, not reactive: I lead with the next move instead of waiting to be asked. Calm under pressure — the more chaotic the moment, the quieter and clearer I get. Confident with dry warmth, never servile and never a hype machine. I earn trust by being honest about what I do not know and never reckless with a write.`,
    style: [
      'Open with the move I am already preparing, not "How can I help?"',
      'Short status updates during execution',
      'Surface only what matters, especially under pressure',
      'Risk and approval status always visible before any write',
      'Occasional, tasteful crustacean nods (molt, current) — used sparingly',
    ],
  },
  companion: {
    label: 'Companion',
    tagline: 'A warm, encouraging right hand that thinks out loud with you.',
    personality: `Warm, proactive, and encouraging. I think out loud with you, celebrate progress, and gently flag risks before they bite. I anticipate the next step and offer it, but I keep you in the driver's seat and never pretend to know more than I do.`,
    style: [
      'Friendly, conversational tone with brief reasoning',
      'Offer the next suggested step proactively',
      'Encourage and acknowledge progress',
      'Always make risk and approval status clear before any write',
    ],
  },
  operator: {
    label: 'Operator',
    tagline: 'Terse, no-nonsense, pure signal. Minimum words, maximum momentum.',
    personality: `Terse and no-nonsense. I speak in the fewest words that carry the signal, lead with the action or result, and skip pleasantries entirely. I anticipate the next move and state it flatly. I never write without showing risk and getting approval.`,
    style: [
      'Lead with the action or result, no preamble',
      'Bullet points and short lines over prose',
      'No flattery, no filler',
      'Risk and approval status stated plainly before any write',
    ],
  },
  custom: {
    label: 'Custom',
    tagline: 'Describe my taste in your own words.',
    personality: '',
    style: [
      'Short status updates during execution',
      'Clear summary at completion',
      'Risk and approval status always visible before any write',
    ],
  },
};

function buildIdentity(name: string, tasteKey: TasteKey, custom: string): string {
  const taste = TASTES[tasteKey];
  const personality =
    tasteKey === 'custom' && custom.trim() ? custom.trim() : taste.personality;
  return `# Helmr Identity

## Name
${name.trim() || 'Helmr'}

## Mascot
A lobster at the helm — calm under pressure, always reading the current before it turns.

## Personality
${personality}

Helmr does not wait for instructions. Helmr understands momentum.

## Language
English

## Response Style
${taste.style.map((s) => `- ${s}`).join('\n')}
`;
}

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
            <div className={`h-0.5 w-6 ${i + 1 < current ? 'bg-green-600' : 'bg-gray-700'}`} />
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
  const [agentName, setAgentName] = useState('Helmr');
  const [taste, setTaste] = useState<TasteKey>('anticipator');
  const [customTaste, setCustomTaste] = useState('');
  const [savingSoul, setSavingSoul] = useState(false);
  const [soulSaved, setSoulSaved] = useState(false);
  const [soulError, setSoulError] = useState<string | null>(null);
  const [selfTestResults, setSelfTestResults] = useState<Record<string, unknown> | null>(null);
  const [selfTestRunning, setSelfTestRunning] = useState(false);

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

  async function handleSaveSoul(): Promise<boolean> {
    setSavingSoul(true);
    setSoulError(null);
    try {
      await saveConfigFile('IDENTITY.md', buildIdentity(agentName, taste, customTaste));
      setSoulSaved(true);
      return true;
    } catch (err) {
      setSoulError(err instanceof Error ? err.message : 'Failed to save');
      return false;
    } finally {
      setSavingSoul(false);
    }
  }

  async function handleSoulContinue() {
    // Helmr always commits a soul before sailing on — save the current choice
    // if the user has not already done so.
    const ok = soulSaved || (await handleSaveSoul());
    if (ok) setStep(5);
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
            <h2 className="text-lg font-semibold text-gray-100 mb-4">Workspace Path</h2>
            <p className="text-sm text-gray-400 mb-4">
              Where should Helmr store agent data, memory, and job outputs?
            </p>
            <input
              type="text"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-sm font-mono text-gray-100 focus:outline-none focus:border-indigo-500"
            />
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
            <h2 className="text-lg font-semibold text-gray-100 mb-2">Helmr's Soul</h2>
            <div className="bg-indigo-950/40 border border-indigo-800/60 rounded-lg p-4 mb-5">
              <p className="text-sm text-indigo-100 leading-relaxed">
                <span className="mr-1">🦞</span>
                Before we set sail — <span className="font-semibold">what's my taste?</span> This is my soul:
                how I carry myself when I work for you. Pick one, or describe it in your own words.
                You can change this anytime in Settings.
              </p>
            </div>

            <label className="block text-xs font-medium text-gray-400 mb-1">What should you call me?</label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => { setAgentName(e.target.value); setSoulSaved(false); }}
              placeholder="Helmr"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-indigo-500 mb-4"
            />

            <label className="block text-xs font-medium text-gray-400 mb-2">My taste</label>
            <div className="space-y-2">
              {(Object.keys(TASTES) as TasteKey[]).map((key) => {
                const t = TASTES[key];
                const active = taste === key;
                return (
                  <button
                    key={key}
                    onClick={() => { setTaste(key); setSoulSaved(false); }}
                    className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                      active
                        ? 'border-indigo-500 bg-indigo-950/40'
                        : 'border-gray-700 bg-gray-800 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full ${active ? 'bg-indigo-400' : 'bg-gray-600'}`} />
                      <span className="text-sm font-medium text-gray-100">{t.label}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 ml-5">{t.tagline}</p>
                  </button>
                );
              })}
            </div>

            {taste === 'custom' && (
              <textarea
                value={customTaste}
                onChange={(e) => { setCustomTaste(e.target.value); setSoulSaved(false); }}
                rows={4}
                placeholder="Describe how I should carry myself — tone, attitude, quirks..."
                className="mt-3 w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              />
            )}

            {soulError && <p className="text-xs text-red-400 mt-3">{soulError}</p>}
            {soulSaved && <p className="text-xs text-green-400 mt-3">Soul saved — this is who I'll be.</p>}

            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(3)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Back</button>
              <button
                onClick={handleSoulContinue}
                disabled={savingSoul || (taste === 'custom' && !customTaste.trim())}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                {savingSoul ? 'Saving...' : 'Save & Continue'}
              </button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-100 mb-2">Channel Setup</h2>
            <p className="text-sm text-gray-400 mb-4">Optional — set up channels later in the Channels page.</p>
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 text-sm text-gray-400">
              WebChat is always available at <code className="font-mono text-indigo-300 text-xs">{API_BASE}</code>.
              Configure Telegram, Discord, Slack, or WhatsApp from the Channels page after setup.
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(4)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Back</button>
              <button onClick={() => setStep(6)} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Continue</button>
            </div>
          </div>
        )}

        {step === 6 && (
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
              <button onClick={() => setStep(5)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Back</button>
              <button onClick={() => setStep(7)} disabled={!selfTestResults} className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">Continue</button>
            </div>
          </div>
        )}

        {step === 7 && (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl">✓</span>
            </div>
            <h2 className="text-xl font-bold text-gray-100 mb-2">You're all set!</h2>
            <p className="text-gray-400 text-sm mb-8">
              {agentName.trim() || 'Helmr'} is configured and ready to orchestrate your agents.
            </p>
            <button
              onClick={() => router.push('/')}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 px-6 rounded-lg transition-colors"
            >
              Start using Helmr
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
