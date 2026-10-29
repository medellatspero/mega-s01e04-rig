import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

// Deliberately do not load .env or start the heartbeat. Only the sample night is exported.
async function exportPreview() {
  const [output, ...extra] = process.argv.slice(2);
  if (!output || extra.length > 0) {
    throw new Error('Usage: node --import tsx scripts/export-preview.ts <output path>');
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = { ...loadConfig(resolve(root, 'rig.json')), runsDir: resolve(root, 'runs') };
  const server = serve({ fetch: createApp(config).fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No local HTTP address');
    const response = await fetch(`http://127.0.0.1:${address.port}/digest/2026-10-28`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200 || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
      throw new Error('Sample digest must return HTTP 200 HTML');
    }
    const html = await response.text();
    if (!/^<!doctype html>/i.test(html)) throw new Error('Sample digest must be an HTML document');
    const destination = resolve(output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, html, { encoding: 'utf8', mode: 0o600 });
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    });
  }
}

try {
  await exportPreview();
} catch {
  // Never print a response body, environment values, or marker-bearing error details.
  console.error('Preview export failed. Check the output path and sample digest configuration.');
  process.exitCode = 1;
}
