'use client';

import { Approval } from '@/lib/api';
import { StatusBadge } from './StatusBadge';

interface ApprovalCardProps {
  approval: Approval;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  loading?: boolean;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function ApprovalCard({ approval, onApprove, onDeny, loading }: ApprovalCardProps) {
  return (
    <div className="bg-gray-800 rounded-lg border border-yellow-700 p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-gray-400 truncate">{approval.jobId}</span>
            <StatusBadge status={approval.riskLevel} label={`${approval.riskLevel} risk`} />
          </div>
          <p className="text-sm text-gray-200 mb-1">{approval.planSummary}</p>
          <p className="text-xs text-gray-400">
            Capability: <span className="text-indigo-400 font-mono">{approval.capabilityRequired}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">{formatTimestamp(approval.createdAt)}</p>
        </div>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => onApprove(approval.id)}
          disabled={loading}
          className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => onDeny(approval.id)}
          disabled={loading}
          className="flex-1 bg-red-800 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
