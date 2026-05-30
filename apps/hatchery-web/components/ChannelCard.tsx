'use client';

import { useState } from 'react';
import { Channel, configureChannel } from '@/lib/api';
import { StatusBadge } from './StatusBadge';

interface ChannelCardProps {
  channel: Channel;
  onSaved: () => void;
}

const SETUP_INSTRUCTIONS: Record<string, string[]> = {
  telegram: [
    '1. Open Telegram and search for @BotFather',
    '2. Send /newbot and follow the prompts',
    '3. Copy the bot token and paste below',
    '4. Add your bot to a chat and send a message',
  ],
  discord: [
    '1. Go to discord.com/developers/applications',
    '2. Create a new application and add a Bot',
    '3. Copy the bot token and paste below',
    '4. Invite the bot to your server using OAuth2',
  ],
  slack: [
    '1. Go to api.slack.com/apps and create an app',
    '2. Enable Incoming Webhooks and add to workspace',
    '3. Copy the webhook URL and paste below',
  ],
  whatsapp: [
    '1. Go to business.whatsapp.com and set up an account',
    '2. Get your API token from the developer console',
    '3. Paste your phone number ID and access token below',
  ],
};

const CREDENTIAL_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  telegram: [{ key: 'token', label: 'Bot Token', placeholder: '123456:ABC-...' }],
  discord: [{ key: 'token', label: 'Bot Token', placeholder: 'MTk4NjIyND...' }],
  slack: [{ key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/...' }],
  whatsapp: [
    { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '1234567890' },
    { key: 'accessToken', label: 'Access Token', placeholder: 'EAAGm0P...' },
  ],
};

export function ChannelCard({ channel, onSaved }: ChannelCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const instructions = SETUP_INSTRUCTIONS[channel.name];
  const fields = CREDENTIAL_FIELDS[channel.name];
  const isWebChat = channel.name === 'webchat';

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await configureChannel(channel.name, credentials);
      setExpanded(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure channel');
    } finally {
      setSaving(false);
    }
  }

  const pairingStatus = channel.pairingState ?? 'unpaired';

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">{channel.label}</h3>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={channel.status} />
            <StatusBadge status={pairingStatus} />
          </div>
        </div>
      </div>
      {isWebChat && channel.endpoint && (
        <div className="mt-2 bg-gray-900 rounded p-2">
          <p className="text-xs text-gray-400 mb-1">WebSocket Endpoint</p>
          <code className="text-xs font-mono text-indigo-300">{channel.endpoint}</code>
        </div>
      )}
      {!isWebChat && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors mt-2"
        >
          {expanded ? 'Cancel' : 'Set up'}
        </button>
      )}
      {expanded && !isWebChat && (
        <div className="mt-3 space-y-3">
          {instructions && (
            <div className="bg-gray-900 rounded p-3">
              {instructions.map((step, i) => (
                <p key={i} className="text-xs text-gray-400 leading-relaxed">{step}</p>
              ))}
            </div>
          )}
          {fields?.map((field) => (
            <div key={field.key}>
              <label className="block text-xs text-gray-400 mb-1">{field.label}</label>
              <input
                type="password"
                value={credentials[field.key] ?? ''}
                onChange={(e) =>
                  setCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={field.placeholder}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          ))}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors"
          >
            {saving ? 'Pairing...' : 'Save & Pair'}
          </button>
        </div>
      )}
    </div>
  );
}
