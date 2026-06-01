export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';
const API_TOKEN = process.env.NEXT_PUBLIC_HELMR_API_TOKEN;

export interface Job {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  planSummary: string;
  risk: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt?: string;
  auditTrail?: AuditEvent[];
  planSteps?: string[];
  toolReceipts?: ToolReceipt[];
  result?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  text: string;
  level: 'info' | 'warn' | 'error';
}

export interface ToolReceipt {
  tool: string;
  input: string;
  output: string;
  timestamp: string;
}

export interface JobStats {
  total: number;
  running: number;
  queued: number;
  succeeded: number;
  failed: number;
}

export interface Approval {
  id: string;
  jobId: string;
  planSummary: string;
  capabilityRequired: string;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: string;
}

export interface Provider {
  name: string;
  status: 'not_configured' | 'connected' | 'failed';
  label: string;
  description: string;
}

export interface Channel {
  name: string;
  label: string;
  status: 'active' | 'inactive' | 'not_configured';
  endpoint?: string;
  pairingState?: 'paired' | 'unpaired' | 'pending';
}

export interface SystemStatus {
  healthy: boolean;
  uptime: number;
}

interface ApiFetchOptions extends RequestInit {
  allowErrorStatus?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrap<T>(value: unknown, key: string): T {
  if (isRecord(value) && key in value) {
    return value[key] as T;
  }
  return value as T;
}

function normalizeJobStatus(status: unknown): Job['status'] {
  if (status === 'running' || status === 'planning') return 'running';
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'queued';
}

function normalizeRisk(risk: unknown): Job['risk'] {
  return risk === 'medium' || risk === 'high' ? risk : 'low';
}

function normalizeJob(value: unknown): Job {
  const job = isRecord(value) ? value : {};
  const plan = isRecord(job['plan']) ? job['plan'] : undefined;
  const rawSteps = Array.isArray(job['planSteps'])
    ? job['planSteps']
    : Array.isArray(plan?.['steps'])
      ? plan?.['steps']
      : undefined;

  return {
    id: String(job['id'] ?? ''),
    status: normalizeJobStatus(job['status']),
    planSummary: String(job['planSummary'] ?? plan?.['summary'] ?? job['payloadText'] ?? job['lastError'] ?? 'Untitled job'),
    risk: normalizeRisk(job['risk'] ?? plan?.['risk']),
    createdAt: String(job['createdAt'] ?? new Date(0).toISOString()),
    updatedAt: job['updatedAt'] === undefined ? undefined : String(job['updatedAt']),
    auditTrail: Array.isArray(job['auditTrail']) ? (job['auditTrail'] as AuditEvent[]) : undefined,
    planSteps: rawSteps?.map((step) => {
      if (typeof step === 'string') return step;
      if (isRecord(step)) return String(step['title'] ?? step['id'] ?? '');
      return String(step);
    }),
    toolReceipts: Array.isArray(job['toolReceipts']) ? (job['toolReceipts'] as ToolReceipt[]) : undefined,
    result: job['result'] === undefined ? undefined : String(job['result']),
  };
}

function normalizeApproval(value: unknown): Approval {
  const approval = isRecord(value) ? value : {};
  return {
    id: String(approval['id'] ?? ''),
    jobId: String(approval['jobId'] ?? ''),
    planSummary: String(approval['planSummary'] ?? approval['kind'] ?? 'Approval required'),
    capabilityRequired: String(approval['capabilityRequired'] ?? approval['kind'] ?? 'approval'),
    riskLevel: normalizeRisk(approval['riskLevel']),
    createdAt: String(approval['createdAt'] ?? new Date(0).toISOString()),
  };
}

function normalizeProvider(value: unknown): Provider {
  const provider = isRecord(value) ? value : {};
  const configured = provider['configured'] === true || provider['status'] === 'connected';
  return {
    name: String(provider['name'] ?? ''),
    status: configured ? 'connected' : provider['status'] === 'failed' ? 'failed' : 'not_configured',
    label: String(provider['label'] ?? provider['name'] ?? ''),
    description: String(provider['description'] ?? (Array.isArray(provider['models']) ? provider['models'].join(', ') : '')),
  };
}

function normalizeChannel(value: unknown): Channel {
  const channel = isRecord(value) ? value : {};
  const name = String(channel['name'] ?? channel['id'] ?? channel['kind'] ?? '');
  return {
    name,
    label: String(channel['label'] ?? name),
    status: channel['status'] === 'active' || channel['status'] === 'inactive' ? channel['status'] : 'not_configured',
    endpoint: channel['endpoint'] === undefined ? undefined : String(channel['endpoint']),
    pairingState: channel['pairingState'] === 'paired' || channel['pairingState'] === 'pending' ? channel['pairingState'] : 'unpaired',
  };
}

async function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const { allowErrorStatus, ...requestOptions } = options ?? {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...requestOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
      ...(requestOptions.headers ?? {}),
    },
  });
  if (!res.ok && !allowErrorStatus) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export async function fetchJobs(): Promise<Job[]> {
  const data = await apiFetch<unknown>('/api/jobs');
  return unwrap<unknown[]>(data, 'jobs').map(normalizeJob);
}

export async function fetchJob(id: string): Promise<Job> {
  const data = await apiFetch<unknown>(`/api/jobs/${id}`);
  const job = unwrap<unknown>(data, 'job');
  if (isRecord(job) && isRecord(data) && isRecord(data['plan'])) {
    return normalizeJob({ ...job, plan: data['plan'] });
  }
  return normalizeJob(job);
}

export async function fetchJobStats(): Promise<JobStats> {
  return apiFetch<JobStats>('/api/jobs/stats');
}

export async function fetchApprovals(): Promise<Approval[]> {
  const data = await apiFetch<unknown>('/api/approvals');
  return unwrap<unknown[]>(data, 'approvals').map(normalizeApproval);
}

export async function approveJob(id: string): Promise<void> {
  await apiFetch<void>(`/api/approvals/${id}/approve`, { method: 'POST' });
}

export async function denyJob(id: string): Promise<void> {
  await apiFetch<void>(`/api/approvals/${id}/deny`, { method: 'POST' });
}

export async function fetchProviders(): Promise<Provider[]> {
  const data = await apiFetch<unknown>('/api/providers');
  return unwrap<unknown[]>(data, 'providers').map(normalizeProvider);
}

export async function configureProvider(
  name: string,
  apiKey: string
): Promise<void> {
  await apiFetch<void>(`/api/providers/${name}/configure`, {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

export async function fetchChannels(): Promise<Channel[]> {
  const data = await apiFetch<unknown>('/api/channels');
  return unwrap<unknown[]>(data, 'channels').map(normalizeChannel);
}

export async function configureChannel(
  name: string,
  credentials: Record<string, string>
): Promise<void> {
  await apiFetch<void>(`/api/channels/${name}/configure`, {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const data = await apiFetch<unknown>('/api/status');
  if (isRecord(data)) {
    return {
      healthy: Boolean(data['healthy'] ?? data['ok']),
      uptime: Number(data['uptime'] ?? 0),
    };
  }
  return { healthy: false, uptime: 0 };
}

export async function runSelfTest(): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>('/api/self-test', { allowErrorStatus: true });
}

export async function fetchSettings(): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>('/api/settings');
}

export async function restartDaemon(): Promise<void> {
  await apiFetch<void>('/api/daemon/restart', { method: 'POST' });
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  kind: 'skill' | 'plugin';
  triggers: string[];
  instructions: string;
  source: 'builtin' | 'generated' | 'user';
  enabled: boolean;
  version: string;
  createdAt?: string;
  updatedAt?: string;
}

export async function fetchSkills(): Promise<Skill[]> {
  const data = await apiFetch<unknown>('/api/skills', { allowErrorStatus: true });
  const list = unwrap<unknown>(data, 'skills');
  return Array.isArray(list) ? (list as Skill[]) : [];
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<void> {
  await apiFetch<void>(`/api/skills/${id}/enabled`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

export async function deleteSkill(id: string): Promise<void> {
  await apiFetch<void>(`/api/skills/${id}`, { method: 'DELETE' });
}

export async function createSkill(skill: Partial<Skill> & { id: string; name: string; description: string }): Promise<void> {
  await apiFetch<void>('/api/skills', {
    method: 'POST',
    body: JSON.stringify(skill),
  });
}

export async function fetchConfigFile(file: string): Promise<string> {
  const data = await apiFetch<unknown>(`/api/config/${file}`, { allowErrorStatus: true });
  return isRecord(data) && typeof data['content'] === 'string' ? data['content'] : '';
}

export async function saveConfigFile(file: string, content: string): Promise<void> {
  await apiFetch<void>(`/api/config/${file}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}
