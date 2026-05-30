'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchProviders, Provider } from '@/lib/api';
import { ProviderCard } from '@/components/ProviderCard';

const DEFAULT_PROVIDERS: Provider[] = [
  { name: 'anthropic', label: 'Anthropic', status: 'not_configured', description: 'Claude 3 Opus, Sonnet, Haiku' },
  { name: 'openai', label: 'OpenAI', status: 'not_configured', description: 'GPT-4o, GPT-4 Turbo, GPT-3.5' },
  { name: 'google', label: 'Google Gemini', status: 'not_configured', description: 'Gemini 1.5 Pro, Flash' },
  { name: 'groq', label: 'Groq', status: 'not_configured', description: 'Llama 3, Mixtral — ultra-fast inference' },
  { name: 'xai', label: 'xAI', status: 'not_configured', description: 'Grok-1, Grok-1.5' },
  { name: 'ollama', label: 'Ollama', status: 'not_configured', description: 'Local models (no key required)' },
];

function mergeProviders(defaults: Provider[], fetched: Provider[]): Provider[] {
  const map = new Map(fetched.map((p) => [p.name, p]));
  return defaults.map((d) => map.get(d.name) ?? d);
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>(DEFAULT_PROVIDERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchProviders();
      setProviders(mergeProviders(DEFAULT_PROVIDERS, data));
      setError(null);
    } catch {
      setError('Gateway unavailable — showing defaults. Changes will apply when gateway is online.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-100">AI Providers</h2>
        <p className="text-sm text-gray-400 mt-1">
          Configure API keys for each provider. Keys are stored encrypted on the gateway.
        </p>
      </div>
      {loading && <p className="text-gray-400 text-sm">Loading...</p>}
      {error && (
        <div className="bg-gray-800 rounded-lg border border-yellow-800 p-3 text-yellow-400 text-xs mb-4">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {providers.map((provider) => (
          <ProviderCard
            key={provider.name}
            provider={provider}
            onSaved={load}
          />
        ))}
      </div>
    </div>
  );
}
