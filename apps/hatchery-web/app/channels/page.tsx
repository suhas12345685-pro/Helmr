'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchChannels, Channel, API_BASE } from '@/lib/api';
import { ChannelCard } from '@/components/ChannelCard';

const DEFAULT_CHANNELS: Channel[] = [
  {
    name: 'webchat',
    label: 'WebChat',
    status: 'active',
    endpoint: `${typeof window !== 'undefined' ? API_BASE : 'ws://localhost:3999'}`,
    pairingState: 'paired',
  },
  { name: 'telegram', label: 'Telegram', status: 'not_configured', pairingState: 'unpaired' },
  { name: 'discord', label: 'Discord', status: 'not_configured', pairingState: 'unpaired' },
  { name: 'slack', label: 'Slack', status: 'not_configured', pairingState: 'unpaired' },
  { name: 'whatsapp', label: 'WhatsApp', status: 'not_configured', pairingState: 'unpaired' },
  { name: 'signal', label: 'Signal', status: 'not_configured', pairingState: 'unpaired' },
  { name: 'teams', label: 'Microsoft Teams', status: 'not_configured', pairingState: 'unpaired' },
  { name: 'google-chat', label: 'Google Chat', status: 'not_configured', pairingState: 'unpaired' },
];

function mergeChannels(defaults: Channel[], fetched: Channel[]): Channel[] {
  const map = new Map(fetched.map((c) => [c.name, c]));
  return defaults.map((d) => ({
    ...d,
    ...(map.get(d.name) ?? {}),
  }));
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>(DEFAULT_CHANNELS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchChannels();
      setChannels(mergeChannels(DEFAULT_CHANNELS, data));
      setError(null);
    } catch {
      setError('Gateway unavailable — showing defaults.');
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
        <h2 className="text-lg font-semibold text-gray-100">Channels</h2>
        <p className="text-sm text-gray-400 mt-1">
          Connect Helmr to messaging platforms. Each channel creates a persistent pairing.
        </p>
      </div>
      {loading && <p className="text-gray-400 text-sm">Loading...</p>}
      {error && (
        <div className="bg-gray-800 rounded-lg border border-yellow-800 p-3 text-yellow-400 text-xs mb-4">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {channels.map((channel) => (
          <ChannelCard
            key={channel.name}
            channel={channel}
            onSaved={load}
          />
        ))}
      </div>
    </div>
  );
}
