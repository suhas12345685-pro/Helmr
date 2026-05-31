import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp, Spacer } from 'ink';

const API = 'http://localhost:4000';

type JobStatus = 'queued' | 'planning' | 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface Job {
  id: string;
  status: JobStatus;
  lane: string;
  priority: number;
  createdAt: string;
}

interface Approval {
  id: string;
  jobId: string;
  kind: string;
  createdAt: string;
}

type Tab = 'jobs' | 'approvals' | 'status';

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function apiPost(path: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}${path}`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

function statusColor(status: JobStatus): string {
  switch (status) {
    case 'succeeded': return 'green';
    case 'failed': return 'red';
    case 'running': return 'cyan';
    case 'planning': return 'blue';
    case 'awaiting_approval': return 'yellow';
    case 'cancelled': return 'gray';
    default: return 'white';
  }
}

function JobRow({ job, selected }: { job: Job; selected: boolean }): React.ReactElement {
  const short = job.id.slice(0, 16);
  const ts = new Date(job.createdAt).toLocaleTimeString();
  return (
    <Box paddingX={1}>
 codex/complete-end-to-end-implementation
      <Text color={selected ? 'cyan' : 'gray'}>{selected ? '› ' : '  '}</Text>
      <Text color={statusColor(job.status)} bold={selected}>{job.status.padEnd(18)}</Text>
      <Text dimColor>{short}  </Text>
      <Text dimColor>{ts}</Text>

      <Text color={statusColor(job.status)} bold={selected} inverse={selected}>{job.status.padEnd(18)}</Text>
      <Text dimColor={!selected} bold={selected} inverse={selected}>{short}  </Text>
      <Text dimColor={!selected} inverse={selected}>{ts}</Text>
         main
    </Box>
  );
}

function ApprovalRow({ approval, selected }: { approval: Approval; selected: boolean }): React.ReactElement {
  const short = approval.jobId.slice(0, 16);
  return (
    <Box paddingX={1}>
  
 codex/complete-end-to-end-implementation
      <Text color={selected ? 'cyan' : 'gray'}>{selected ? '› ' : '  '}</Text>
      <Text bold={selected} color="yellow">{approval.kind.padEnd(10)}</Text>
      <Text dimColor>{short}  </Text>
      <Text dimColor>{approval.id.slice(0, 12)}</Text>
 
      <Text bold={selected} color="yellow" inverse={selected}>{approval.kind.padEnd(10)}</Text>
      <Text dimColor={!selected} bold={selected} inverse={selected}>{short}  </Text>
      <Text dimColor={!selected} inverse={selected}>{approval.id.slice(0, 12)}</Text>
          main
    </Box>
  );
}

export function App(): React.ReactElement {
  const { exit } = useApp();
  const [tab, setTab] = useState<Tab>('jobs');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [message, setMessage] = useState('');

  const refresh = async (): Promise<void> => {
    const [jobsRes, approvalsRes, statusRes] = await Promise.all([
      apiFetch<{ jobs: Job[] }>('/api/jobs'),
      apiFetch<{ approvals: Approval[] }>('/api/approvals'),
      apiFetch<{ ok: boolean }>('/api/status'),
    ]);
    if (jobsRes) setJobs(jobsRes.jobs);
    if (approvalsRes) setApprovals(approvalsRes.approvals);
    setDaemonOk(statusRes?.ok ?? false);
  };

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 3000);
    return () => clearInterval(interval);
  }, []);

  const currentList = tab === 'jobs' ? jobs : approvals;
  const maxIdx = Math.max(0, currentList.length - 1);

  useInput(async (input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (input === '1') { setTab('jobs'); setSelectedIdx(0); }
    if (input === '2') { setTab('approvals'); setSelectedIdx(0); }
    if (input === '3') { setTab('status'); }
    if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIdx((i) => Math.min(maxIdx, i + 1));
    if (key.return && tab === 'approvals' && approvals[selectedIdx]) {
      const approval = approvals[selectedIdx];
      if (!approval) return;
      const ok = await apiPost(`/api/approvals/${approval.id}/approve`);
      setMessage(ok ? `Approved ${approval.id.slice(0, 8)}` : 'Approval failed');
      void refresh();
    }
    if (input === 'd' && tab === 'approvals' && approvals[selectedIdx]) {
      const approval = approvals[selectedIdx];
      if (!approval) return;
      const ok = await apiPost(`/api/approvals/${approval.id}/deny`);
      setMessage(ok ? `Denied ${approval.id.slice(0, 8)}` : 'Deny failed');
      void refresh();
    }
    if (input === 'r') void refresh();
  });

  const tabLabel = (t: Tab, n: string, key: string): React.ReactElement => (
    <Box marginRight={2}>
      <Text bold={tab === t} color={tab === t ? 'cyan' : 'gray'}>[{key}] {n}</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Helmr Hatchery</Text>
        <Spacer />
        <Text color={daemonOk === null ? 'gray' : daemonOk ? 'green' : 'red'}>
          {daemonOk === null ? '●' : daemonOk ? '● daemon ok' : '● daemon unreachable'}
        </Text>
      </Box>

      {/* Tabs */}
      <Box marginBottom={1}>
        {tabLabel('jobs', `Jobs (${jobs.length})`, '1')}
        {tabLabel('approvals', `Approvals (${approvals.length})`, '2')}
        {tabLabel('status', 'Status', '3')}
      </Box>

      {/* Content */}
      {tab === 'jobs' && (
        <Box flexDirection="column">
          {jobs.length === 0
            ? <Text dimColor>No jobs yet.</Text>
            : jobs.map((j, i) => <JobRow key={j.id} job={j} selected={i === selectedIdx} />)
          }
        </Box>
      )}

      {tab === 'approvals' && (
        <Box flexDirection="column">
          {approvals.length === 0
            ? <Text dimColor>No pending approvals.</Text>
            : approvals.map((a, i) => <ApprovalRow key={a.id} approval={a} selected={i === selectedIdx} />)
          }
          {approvals.length > 0 && (
            <Box marginTop={1}>
              <Text dimColor>[Enter] Approve  [d] Deny  [↑↓] Select</Text>
            </Box>
          )}
        </Box>
      )}

      {tab === 'status' && (
        <Box flexDirection="column">
          <Text>Gateway API:    <Text color="cyan">http://localhost:3999</Text></Text>
          <Text>Hatchery API:   <Text color="cyan">http://localhost:4000</Text></Text>
          <Text>Hatchery Web:   <Text color="cyan">http://localhost:4000</Text></Text>
          <Text>Daemon:         <Text color={daemonOk ? 'green' : 'red'}>{daemonOk ? 'running' : 'unreachable'}</Text></Text>
          <Text>Model:          <Text dimColor>{process.env['HELMR_MODEL'] ?? 'configure during onboarding'}</Text></Text>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        {message
          ? <Text color="green">{message}</Text>
          : <Text dimColor>[r] Refresh  [q] Quit  [1/2/3] Tabs</Text>
        }
      </Box>
    </Box>
  );
}
