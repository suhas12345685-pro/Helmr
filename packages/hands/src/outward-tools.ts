import { runProcess, type ProcessResult } from './process-runner.js';

/**
 * Outward tools — actions that leave the deployment box and therefore execute
 * only after clearing the outward-action gate (see cortex/gate.ts). The gate is
 * enforced in the executor before any of these run; here we just perform the
 * action safely once authority is established.
 *
 * All three map to the `network` capability so a single declarative policy
 * (branch globs for pushes, host allow-lists for HTTP) governs them.
 */

export interface GitPushResult {
  remote: string;
  branch: string;
  pushed: boolean;
  stdout: string;
  stderr: string;
}

const SAFE_REF = /^[A-Za-z0-9._\-/]+$/;

/** Push a branch to a remote. The gate has already vetted the branch. */
export async function gitPush(
  workspacePath: string,
  options: { remote?: string; branch: string; setUpstream?: boolean; force?: boolean },
  env?: Record<string, string>,
): Promise<GitPushResult> {
  const remote = options.remote ?? 'origin';
  const { branch } = options;
  if (!branch || !SAFE_REF.test(branch)) throw new Error(`unsafe branch ref: ${JSON.stringify(branch)}`);
  if (!SAFE_REF.test(remote)) throw new Error(`unsafe remote name: ${JSON.stringify(remote)}`);

  const argv = ['git', 'push'];
  if (options.setUpstream) argv.push('-u');
  // Force-with-lease never plain --force: refuse to clobber unseen remote work.
  if (options.force) argv.push('--force-with-lease');
  argv.push(remote, branch);

  const result: ProcessResult = await runProcess(workspacePath, argv, {
    timeoutMs: 120_000,
    maxBufferBytes: 1024 * 1024,
    env,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git push failed (${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  return { remote, branch, pushed: true, stdout: result.stdout, stderr: result.stderr };
}

export interface HttpRequestResult {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Perform an HTTP request. The gate has already vetted the host. */
export async function httpRequest(
  options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
): Promise<HttpRequestResult> {
  const parsed = new URL(options.url);
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  const method = (options.method ?? 'GET').toUpperCase();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await fetch(parsed, {
      method,
      headers: options.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : options.body,
      signal: controller.signal,
      redirect: 'follow',
    });

    // Bound the response so a hostile endpoint can't exhaust memory.
    const reader = response.body?.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error(`response exceeded ${MAX_RESPONSE_BYTES} byte cap`);
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');

    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });

    return {
      url: parsed.toString(),
      method,
      status: response.status,
      ok: response.ok,
      headers,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface MessageSendResult {
  channel: string;
  delivered: boolean;
  status: number;
}

/**
 * Send a message to an outbound channel via its webhook URL. This is the
 * transport primitive the channel adapters build on; the gate vets the webhook
 * host just like any other HTTP call.
 */
export async function messageSend(
  options: { channel: string; text: string; webhookUrl: string; extra?: Record<string, unknown> },
): Promise<MessageSendResult> {
  if (!options.text?.trim()) throw new Error('message text must not be empty');
  const result = await httpRequest({
    url: options.webhookUrl,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: options.text, ...options.extra }),
  });
  if (!result.ok) {
    throw new Error(`message delivery failed (${result.status}) to ${options.channel}`);
  }
  return { channel: options.channel, delivered: true, status: result.status };
}
