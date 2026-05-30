'use client';

type StatusVariant =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'connected'
  | 'not_configured'
  | 'active'
  | 'inactive'
  | 'testing'
  | 'paired'
  | 'unpaired'
  | 'pending'
  | 'low'
  | 'medium'
  | 'high';

interface StatusBadgeProps {
  status: StatusVariant;
  label?: string;
}

const VARIANT_CLASSES: Record<StatusVariant, string> = {
  queued: 'bg-gray-700 text-gray-300',
  running: 'bg-yellow-900 text-yellow-300',
  succeeded: 'bg-green-900 text-green-300',
  failed: 'bg-red-900 text-red-300',
  connected: 'bg-green-900 text-green-300',
  not_configured: 'bg-gray-700 text-gray-400',
  active: 'bg-green-900 text-green-300',
  inactive: 'bg-gray-700 text-gray-400',
  testing: 'bg-yellow-900 text-yellow-300',
  paired: 'bg-green-900 text-green-300',
  unpaired: 'bg-gray-700 text-gray-400',
  pending: 'bg-yellow-900 text-yellow-300',
  low: 'bg-green-900 text-green-300',
  medium: 'bg-yellow-900 text-yellow-300',
  high: 'bg-red-900 text-red-300',
};

const DEFAULT_LABELS: Record<StatusVariant, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  connected: 'Connected',
  not_configured: 'Not Configured',
  active: 'Active',
  inactive: 'Inactive',
  testing: 'Testing',
  paired: 'Paired',
  unpaired: 'Unpaired',
  pending: 'Pending',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const classes = VARIANT_CLASSES[status] ?? 'bg-gray-700 text-gray-300';
  const text = label ?? DEFAULT_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${classes}`}>
      {text}
    </span>
  );
}
