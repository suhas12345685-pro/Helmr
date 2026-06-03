import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { httpRequest, messageSend, gitPush } from './outward-tools.js';
import { runProcess } from './process-runner.js';

async function startServer(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('httpRequest performs a GET and returns status + body', async () => {
  const srv = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('hello');
  });
  try {
    const result = await httpRequest({ url: srv.url });
    assert.equal(result.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.body, 'hello');
  } finally {
    await srv.close();
  }
});

test('httpRequest sends a POST body', async () => {
  let received = '';
  const srv = await startServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      received = Buffer.concat(chunks).toString();
      res.writeHead(201);
      res.end('created');
    });
  });
  try {
    const result = await httpRequest({ url: srv.url, method: 'POST', body: '{"x":1}' });
    assert.equal(result.status, 201);
    assert.equal(received, '{"x":1}');
  } finally {
    await srv.close();
  }
});

test('httpRequest rejects non-http protocols', async () => {
  await assert.rejects(() => httpRequest({ url: 'file:///etc/passwd' }), /unsupported protocol/);
});

test('messageSend posts text and reports delivery', async () => {
  let body = '';
  const srv = await startServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      body = Buffer.concat(chunks).toString();
      res.writeHead(200);
      res.end('ok');
    });
  });
  try {
    const result = await messageSend({ channel: 'test', text: 'ahoy', webhookUrl: srv.url });
    assert.equal(result.delivered, true);
    assert.equal(JSON.parse(body).text, 'ahoy');
  } finally {
    await srv.close();
  }
});

test('messageSend rejects empty text', async () => {
  await assert.rejects(() => messageSend({ channel: 'c', text: '   ', webhookUrl: 'http://x' }), /must not be empty/);
});

test('messageSend surfaces a delivery failure', async () => {
  const srv = await startServer((_req, res) => {
    res.writeHead(500);
    res.end('boom');
  });
  try {
    await assert.rejects(() => messageSend({ channel: 'c', text: 'hi', webhookUrl: srv.url }), /delivery failed/);
  } finally {
    await srv.close();
  }
});

test('gitPush rejects unsafe branch and remote names', async () => {
  await assert.rejects(() => gitPush('/tmp', { branch: 'a b; rm -rf' }), /unsafe branch/);
  await assert.rejects(() => gitPush('/tmp', { branch: 'ok', remote: '--upload-pack=evil' }), /unsafe remote/);
});

test('gitPush pushes a branch to a local bare remote', async () => {
  const base = await mkdtemp(join(tmpdir(), 'helmr-push-'));
  const bare = join(base, 'remote.git');
  const work = join(base, 'work');
  const env = { ...process.env } as Record<string, string>;
  const run = (cwd: string, argv: string[]) => runProcess(cwd, argv, { timeoutMs: 30_000, maxBufferBytes: 1 << 20, env });
  try {
    await run(base, ['git', 'init', '--bare', bare]);
    await run(base, ['git', 'init', work]);
    await run(work, ['git', 'checkout', '-b', 'claude/test']);
    await run(work, ['git', '-c', 'user.name=T', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'init']);
    await run(work, ['git', 'remote', 'add', 'origin', bare]);

    const result = await gitPush(work, { branch: 'claude/test', setUpstream: true }, env);
    assert.equal(result.pushed, true);
    assert.equal(result.branch, 'claude/test');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
