'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { fetchJobs, fetchJob, Job, AuditEvent, ToolReceipt } from '@/lib/api';
import { JobCard } from '@/components/JobCard';
import { StatusBadge } from '@/components/StatusBadge';

function AuditTrail({ events }: { events: AuditEvent[] }) {
  return (
    <div className="space-y-1">
      {events.map((ev) => (
        <div key={ev.id} className="flex gap-3 text-xs">
          <span className="text-gray-500 font-mono flex-shrink-0">
            {new Date(ev.timestamp).toLocaleTimeString()}
          </span>
          <span
            className={
              ev.level === 'error'
                ? 'text-red-400'
                : ev.level === 'warn'
                ? 'text-yellow-400'
                : 'text-gray-300'
            }
          >
            {ev.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function ToolReceiptList({ receipts }: { receipts: ToolReceipt[] }) {
  return (
    <div className="space-y-2">
      {receipts.map((r, i) => (
        <div key={i} className="bg-gray-900 rounded p-3 text-xs font-mono">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-indigo-400 font-semibold">{r.tool}</span>
            <span className="text-gray-500">{new Date(r.timestamp).toLocaleTimeString()}</span>
          </div>
          <div className="text-gray-400">In: <span className="text-gray-300">{r.input}</span></div>
          <div className="text-gray-400 mt-1">Out: <span className="text-gray-300">{r.output}</span></div>
        </div>
      ))}
    </div>
  );
}

function JobDetail({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJob(jobId)
      .then((j) => { if (!cancelled) { setJob(j); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [jobId]);

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading job...</div>;
  if (error || !job) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="text-indigo-400 text-sm mb-4">← Back</button>
        <p className="text-red-400 text-sm">{error ?? 'Job not found'}</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <button onClick={onBack} className="text-indigo-400 text-sm hover:text-indigo-300">
        ← Back to jobs
      </button>
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-xs text-gray-400">{job.id}</span>
          <StatusBadge status={job.status} />
          <StatusBadge status={job.risk} label={`${job.risk} risk`} />
        </div>
        <p className="text-gray-200 mt-2">{job.planSummary}</p>
        <p className="text-xs text-gray-500 mt-1">{new Date(job.createdAt).toLocaleString()}</p>
      </div>
      {job.planSteps && job.planSteps.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Plan Steps</h3>
          <ol className="space-y-1">
            {job.planSteps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="text-indigo-400 font-mono flex-shrink-0">{i + 1}.</span>
                <span className="text-gray-300">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {job.result && (
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Result</h3>
          <div className="bg-gray-900 rounded p-3 font-mono text-xs text-gray-300 whitespace-pre-wrap">
            {job.result}
          </div>
        </section>
      )}
      {job.toolReceipts && job.toolReceipts.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Tool Receipts</h3>
          <ToolReceiptList receipts={job.toolReceipts} />
        </section>
      )}
      {job.auditTrail && job.auditTrail.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Audit Trail</h3>
          <div className="bg-gray-900 rounded p-3">
            <AuditTrail events={job.auditTrail} />
          </div>
        </section>
      )}
    </div>
  );
}

function JobsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedId = searchParams.get('id');

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchJobs();
      setJobs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (selectedId) {
    return (
      <JobDetail
        jobId={selectedId}
        onBack={() => router.push('/jobs')}
      />
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-100">Jobs</h2>
        <button
          onClick={load}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Refresh
        </button>
      </div>
      {loading && <p className="text-gray-400 text-sm">Loading...</p>}
      {error && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 text-red-400 text-sm">
          Gateway unavailable: {error}
        </div>
      )}
      {!loading && !error && jobs.length === 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 text-center">
          <p className="text-gray-400 text-sm">No jobs found.</p>
        </div>
      )}
      <div className="space-y-2">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            onClick={() => router.push(`/jobs?id=${job.id}`)}
          />
        ))}
      </div>
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-6 text-gray-400 text-sm">Loading jobs...</div>}>
      <JobsPageContent />
    </Suspense>
  );
}
