'use client';

import { useState } from 'react';
import { Provider, configureProvider } from '@/lib/api';
import { StatusBadge } from './StatusBadge';

interface ProviderCardProps {
  provider: Provider;
  onSaved: () => void;
}

export function ProviderCard({ provider, onSaved }: ProviderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await configureProvider(provider.name, apiKey);
      setApiKey('');
      setExpanded(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">{provider.label}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{provider.description}</p>
        </div>
        <StatusBadge status={provider.status} />
      </div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors mt-1"
      >
        {expanded ? 'Cancel' : 'Configure'}
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste API key..."
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim()}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors"
          >
            {saving ? 'Saving...' : 'Save & Test'}
          </button>
        </div>
      )}
    </div>
  );
}
