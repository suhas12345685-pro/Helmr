'use client';

import { useState } from 'react';
import {
  Channel,
  configureChannel,
  startChannelPairing,
  completeChannelPairing,
} from '@/lib/api';
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
    '4. After saving, enter your numeric Telegram user ID and exchange a pairing code',
  ],
  discord: [
    '1. Go to discord.com/developers/applications',
    '2. Create a new application and add a Bot',
    '3. Copy the bot token and paste below',
    '4. Invite the bot to your server, then pair with your Discord user ID',
  ],
  slack: [
    '1. Go to api.slack.com/apps and create an app with Socket Mode',
    '2. Add Bot User OAuth Token and App-Level Token',
    '3. Pair by entering your Slack user ID below',
  ],
  whatsapp: [
    '1. Go to business.whatsapp.com and set up an account',
    '2. Get your API token from the developer console',
    '3. Pair by entering your administrator phone number',
  ],
  signal: [
    '1. Install signal-cli locally and register a number',
    '2. Verify reachability of the signal-cli daemon',
    '3. Pair by entering your administrator Signal number',
  ],
  teams: [
    '1. Register a bot in Azure Bot Framework',
    '2. Enter tenant + app values below',
    '3. Pair by exchanging a code in DM with the bot',
  ],
  'google-chat': [
    '1. Create a Google Cloud service account',
    '2. Provide the service account JSON',
    '3. Pair by exchanging a code in DM with the bot app',
  ],
};

const CREDENTIAL_FIELDS: Record<string, { key: string; label: string; placeholder: string; secret?: boolean }[]> = {
  telegram: [{ key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-...', secret: true }],
  discord: [
    { key: 'botToken', label: 'Bot Token', placeholder: 'MTk4NjIyND...', secret: true },
    { key: 'guildId', label: 'Server / Guild ID', placeholder: '123456789012345678' },
  ],
  slack: [
    { key: 'botToken', label: 'Bot User OAuth Token', placeholder: 'xoxb-...', secret: true },
    { key: 'appToken', label: 'App-Level Token', placeholder: 'xapp-...', secret: true },
  ],
  whatsapp: [
    { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '1234567890' },
    { key: 'apiToken', label: 'Access Token', placeholder: 'EAAGm0P...', secret: true },
  ],
  signal: [
    { key: 'daemonUrl', label: 'signal-cli daemon URL', placeholder: 'http://localhost:8089' },
    { key: 'phoneNumber', label: 'Bot phone number', placeholder: '+15551234567' },
  ],
  teams: [
    { key: 'tenantId', label: 'Tenant ID', placeholder: 'tenant-uuid' },
    { key: 'appId', label: 'App ID', placeholder: 'app-uuid' },
    { key: 'appToken', label: 'App password', placeholder: 'secret', secret: true },
  ],
  'google-chat': [
    { key: 'serviceAccount', label: 'Service account JSON', placeholder: '{ ... }', secret: true },
    { key: 'spaceId', label: 'Target space ID', placeholder: 'spaces/...' },
  ],
};

type Phase = 'setup' | 'saved' | 'pairing' | 'paired' | 'failed';

export function ChannelCard({ channel, onSaved }: ChannelCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [adminId, setAdminId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialPhase: Phase = channel.pairingState === 'paired'
    ? 'paired'
    : channel.pairingState === 'pending'
      ? 'pairing'
      : 'setup';
  const [phase, setPhase] = useState<Phase>(initialPhase);

  const instructions = SETUP_INSTRUCTIONS[channel.name];
  const fields = CREDENTIAL_FIELDS[channel.name];
  const isWebChat = channel.name === 'webchat';

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await configureChannel(channel.name, credentials);
      setPhase('saved');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure channel');
      setPhase('failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleStartPairing() {
    if (!adminId.trim()) {
      setError('Enter the administrator account ID first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ticket = await startChannelPairing(channel.name, adminId.trim());
      setPairingCode(ticket.code);
      setPhase('pairing');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start pairing');
    } finally {
      setBusy(false);
    }
  }

  async function handleCompletePairing() {
    if (!enteredCode.trim()) {
      setError('Enter the pairing code that was shown above (or received in DM).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeChannelPairing(channel.name, enteredCode.trim());
      setPhase('paired');
      setPairingCode('');
      setEnteredCode('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pairing code was rejected');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">{channel.label}</h3>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={channel.status} />
            <StatusBadge status={channel.pairingState ?? 'unpaired'} />
          </div>
        </div>
      </div>
      {isWebChat && channel.endpoint && (
        <div className="mt-2 bg-gray-900 rounded p-2">
          <p className="text-xs text-gray-400 mb-1">Endpoint</p>
          <code className="text-xs font-mono text-indigo-300">{channel.endpoint}</code>
        </div>
      )}
      {!isWebChat && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors mt-2"
        >
          {expanded ? 'Cancel' : phase === 'paired' ? 'Reconfigure' : 'Set up'}
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
          {phase !== 'paired' && fields?.map((field) => (
            <div key={field.key}>
              <label className="block text-xs text-gray-400 mb-1">{field.label}</label>
              <input
                type={field.secret ? 'password' : 'text'}
                value={credentials[field.key] ?? ''}
                onChange={(e) =>
                  setCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={field.placeholder}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          ))}
          {phase === 'setup' && (
            <button
              onClick={handleSave}
              disabled={busy}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors"
            >
              {busy ? 'Saving…' : 'Save credentials'}
            </button>
          )}
          {(phase === 'saved' || phase === 'pairing') && (
            <div className="space-y-2 border-t border-gray-700 pt-3">
              <label className="block text-xs text-gray-400">Administrator account ID</label>
              <input
                type="text"
                value={adminId}
                onChange={(e) => setAdminId(e.target.value)}
                placeholder="Numeric user ID, phone number, or handle"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              {phase === 'saved' && (
                <button
                  onClick={handleStartPairing}
                  disabled={busy}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors"
                >
                  {busy ? 'Issuing code…' : 'Start pairing'}
                </button>
              )}
              {phase === 'pairing' && (
                <>
                  {pairingCode && (
                    <div className="bg-gray-900 rounded p-3 text-center">
                      <p className="text-xs text-gray-400 mb-1">Pairing code (expires in 10 minutes)</p>
                      <p className="text-xl font-mono tracking-widest text-indigo-300">{pairingCode}</p>
                      <p className="text-[10px] text-gray-500 mt-1">
                        Send this code from the administrator account in {channel.label}, or paste it back here.
                      </p>
                    </div>
                  )}
                  <input
                    type="text"
                    value={enteredCode}
                    onChange={(e) => setEnteredCode(e.target.value.toUpperCase())}
                    placeholder="Paste pairing code"
                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleCompletePairing}
                    disabled={busy}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors"
                  >
                    {busy ? 'Verifying…' : 'Complete pairing'}
                  </button>
                </>
              )}
            </div>
          )}
          {phase === 'paired' && (
            <div className="bg-gray-900 rounded p-3 text-xs text-green-300">
              Paired. The channel is now allowed to deliver messages into Helmr.
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
