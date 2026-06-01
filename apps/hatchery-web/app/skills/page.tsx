'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchSkills,
  setSkillEnabled,
  deleteSkill,
  createSkill,
  Skill,
} from '@/lib/api';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function SkillCard({ skill, onChanged }: { skill: Skill; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await setSkillEnabled(skill.id, !skill.enabled);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete skill "${skill.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteSkill(skill.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-100">{skill.name}</span>
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
              {skill.kind}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-400">
              {skill.source}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">{skill.description}</p>
        </div>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
            skill.enabled ? 'bg-green-900/60 text-green-300' : 'bg-gray-700 text-gray-400'
          }`}
        >
          {skill.enabled ? 'enabled' : 'disabled'}
        </span>
      </div>

      {skill.triggers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {skill.triggers.map((t) => (
            <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-900 text-indigo-300 border border-gray-700">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-4 pt-3 border-t border-gray-700">
        <button
          onClick={toggle}
          disabled={busy}
          className="flex-1 text-xs font-medium py-1.5 px-3 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-100 transition-colors"
        >
          {skill.enabled ? 'Disable' : 'Enable'}
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="text-xs font-medium py-1.5 px-3 rounded bg-red-900/50 hover:bg-red-900 disabled:opacity-50 text-red-200 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggers, setTriggers] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSkills(await fetchSkills());
      setError(null);
    } catch {
      setError('Gateway unavailable — could not load skills.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    setSaving(true);
    setFormError(null);
    try {
      await createSkill({
        id: slugify(name),
        name: name.trim(),
        description: description.trim(),
        triggers: triggers.split(',').map((t) => t.trim()).filter(Boolean),
        instructions: instructions.trim(),
        source: 'user',
      });
      setName('');
      setDescription('');
      setTriggers('');
      setInstructions('');
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  }

  const canSave = name.trim() && description.trim() && slugify(name);

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Skills</h2>
          <p className="text-sm text-gray-400 mt-1">
            Helmr&apos;s self-taught abilities. Skills are auto-discovered — anything Helmr
            learns from chat shows up here. You can also add one directly.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex-shrink-0"
        >
          {showForm ? 'Close' : 'New Skill'}
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skill name (e.g. Summarize PR)"
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
          />
          {name.trim() && (
            <p className="text-[11px] text-gray-500 font-mono">id: {slugify(name) || '—'}</p>
          )}
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this skill do?"
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
          />
          <input
            value={triggers}
            onChange={(e) => setTriggers(e.target.value)}
            placeholder="Triggers, comma-separated (e.g. summarize pr, pr summary)"
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
          />
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder="Instructions Helmr follows when this skill is active..."
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
          />
          {formError && <p className="text-xs text-red-400">{formError}</p>}
          <button
            onClick={handleCreate}
            disabled={saving || !canSave}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Create Skill'}
          </button>
        </div>
      )}

      {loading && <p className="text-gray-400 text-sm">Loading...</p>}
      {error && (
        <div className="bg-gray-800 rounded-lg border border-yellow-800 p-3 text-yellow-400 text-xs mb-4">
          {error}
        </div>
      )}
      {!loading && skills.length === 0 && !error && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 text-center text-sm text-gray-400">
          No skills yet. Ask Helmr to teach itself one from chat, or add one above.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {skills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
