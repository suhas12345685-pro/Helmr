import { fetchJobs, fetchJobStats, Job, JobStats } from '@/lib/api';
import { JobCard } from '@/components/JobCard';
import Link from 'next/link';

async function getStats(): Promise<JobStats | null> {
  try {
    return await fetchJobStats();
  } catch {
    try {
      const jobs = await fetchJobs();
      return {
        total: jobs.length,
        running: jobs.filter((j) => j.status === 'running').length,
        queued: jobs.filter((j) => j.status === 'queued').length,
        succeeded: jobs.filter((j) => j.status === 'succeeded').length,
        failed: jobs.filter((j) => j.status === 'failed').length,
      };
    } catch {
      return null;
    }
  }
}

async function getRecentJobs(): Promise<Job[]> {
  try {
    const jobs = await fetchJobs();
    return jobs.slice(0, 10);
  } catch {
    return [];
  }
}

interface StatCardProps {
  label: string;
  value: number;
  accent?: string;
}

function StatCard({ label, value, accent = 'text-gray-100' }: StatCardProps) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${accent}`}>{value}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const [stats, recentJobs] = await Promise.all([getStats(), getRecentJobs()]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-4">Overview</h2>
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Total" value={stats.total} />
            <StatCard label="Running" value={stats.running} accent="text-yellow-300" />
            <StatCard label="Queued" value={stats.queued} accent="text-gray-400" />
            <StatCard label="Succeeded" value={stats.succeeded} accent="text-green-400" />
            <StatCard label="Failed" value={stats.failed} accent="text-red-400" />
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 text-gray-400 text-sm">
            Gateway unavailable — stats cannot be loaded.
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-100">Recent Jobs</h2>
          <Link
            href="/jobs"
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            View all →
          </Link>
        </div>
        {recentJobs.length === 0 ? (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 text-center">
            <p className="text-gray-400 text-sm">No jobs yet — or gateway is offline.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentJobs.map((job) => (
              <Link key={job.id} href={`/jobs?id=${job.id}`} className="block">
                <JobCard job={job} compact />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
