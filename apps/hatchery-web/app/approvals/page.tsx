'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchApprovals, approveJob, denyJob, Approval } from '@/lib/api';
import { ApprovalCard } from '@/components/ApprovalCard';

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchApprovals();
      setApprovals(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 5_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  async function handleApprove(id: string) {
    setActioning(id);
    try {
      await approveJob(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setActioning(null);
    }
  }

  async function handleDeny(id: string) {
    setActioning(id);
    try {
      await denyJob(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deny');
    } finally {
      setActioning(null);
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Pending Approvals</h2>
          <p className="text-xs text-gray-500 mt-0.5">Auto-refreshes every 5 seconds</p>
        </div>
        <button
          onClick={load}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Refresh
        </button>
      </div>
      {loading && <p className="text-gray-400 text-sm">Loading...</p>}
      {error && (
        <div className="bg-gray-800 rounded-lg border border-red-800 p-4 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}
      {!loading && approvals.length === 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
          <p className="text-gray-400 text-sm">No pending approvals.</p>
          <p className="text-gray-500 text-xs mt-1">New approvals will appear here automatically.</p>
        </div>
      )}
      <div className="space-y-3">
        {approvals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            onApprove={handleApprove}
            onDeny={handleDeny}
            loading={actioning === approval.id}
          />
        ))}
      </div>
    </div>
  );
}
