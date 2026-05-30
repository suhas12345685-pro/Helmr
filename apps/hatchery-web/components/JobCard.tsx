'use client';

import { Job } from '@/lib/api';
import { StatusBadge } from './StatusBadge';

interface JobCardProps {
  job: Job;
  onClick?: () => void;
  compact?: boolean;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function JobCard({ job, onClick, compact = false }: JobCardProps) {
  return (
    <div
      className={`bg-gray-800 rounded-lg border border-gray-700 p-4 ${
        onClick ? 'cursor-pointer hover:border-indigo-500 transition-colors' : ''
      }`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-gray-400 truncate">{job.id}</span>
            <StatusBadge status={job.status} />
            <StatusBadge status={job.risk} label={`${job.risk} risk`} />
          </div>
          <p className="text-sm text-gray-200 truncate">{job.planSummary}</p>
          {!compact && (
            <p className="text-xs text-gray-500 mt-1">{formatTimestamp(job.createdAt)}</p>
          )}
        </div>
        {onClick && (
          <span className="text-gray-500 text-sm flex-shrink-0">›</span>
        )}
      </div>
    </div>
  );
}
