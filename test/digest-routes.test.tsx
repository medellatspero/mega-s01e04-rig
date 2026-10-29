import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestNight } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T01:00:00+05:30';
const lastAt = '2026-10-28T02:00:00+05:30';

describe('digest routes', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    });
  }

  function writeEvents(events: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map((event) => JSON.stringify(event)).join('\n'));
  }

  function writeSuccessfulNight() {
    writeEvents([
      { at: firstAt, job: 'zulu', owner: 'Zoe', status: 'fail', error: 'connection lost' },
      { at: firstAt, job: 'middle', owner: 'Mira', status: 'retry' },
      { at: '2026-10-28T01:10:00+05:30', job: 'middle', owner: 'Mira', status: 'retry' },
      { at: '2026-10-28T01:20:00+05:30', job: 'middle', owner: 'Mira', status: 'retry' },
      { at: firstAt, job: 'alpha', owner: null, status: 'ok' },
      { at: lastAt, job: 'zulu', owner: 'Zoe', status: 'ok' },
      { at: lastAt, job: 'middle', owner: 'Mira', status: 'ok' },
    ]);
  }

  function htmlRows(html: string) {
    return [...html.matchAll(/<tr\b[^>]*\bdata-job="([^"]*)"[^>]*>[\s\S]*?<\/tr>/g)];
  }

  it('returns the exact JSON contract and the same sorted jobs in server-rendered HTML', async () => {
    writeSuccessfulNight();
    const server = app();
    const jsonResponse = await server.request(`/api/digest/${night}`);
    const htmlResponse = await server.request(`/digest/${night}`);

    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');

    const expected: DigestNight = {
      night,
      rows: [
        { job: 'alpha', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt, lastAt: firstAt, hasFailure: false },
        { job: 'middle', owner: 'Mira', runs: 4, retries: 3, lastStatus: 'ok', lastError: null, firstAt, lastAt, hasFailure: false },
        { job: 'zulu', owner: 'Zoe', runs: 2, retries: 0, lastStatus: 'ok', lastError: 'connection lost', firstAt, lastAt, hasFailure: true },
      ],
      counts: { ok: 3, retry: 3, fail: 1 },
      badLines: 0,
    };
    const json: unknown = await jsonResponse.json();
    expect(json).toEqual(expected);

    const html = await htmlResponse.text();
    expect(htmlRows(html).map((row) => row[1])).toEqual(expected.rows.map((row) => row.job));
    expect(html.match(/<table\b/g)).toHaveLength(1);
    expect(html).toContain(firstAt);
    expect(html).toContain(lastAt);
    expect(html).not.toMatch(/<script\b/i);
  });

  it('keeps null owners and marks three retries or any failure, even after recovery', async () => {
    writeSuccessfulNight();
    const response = await app().request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const rows = new Map(htmlRows(await response.text()).map((row) => [row[1], row[0]]));

    expect(rows.get('alpha')).toContain('—');
    expect(rows.get('alpha')).not.toMatch(/class="[^"]*\bwarn\b/);
    expect(rows.get('middle')).toMatch(/class="[^"]*\bwarn\b/);
    expect(rows.get('zulu')).toMatch(/class="[^"]*\bwarn\b/);
  });

  it.each(['/digest/', '/api/digest/'])('returns 404 for a missing night through %s', async (route) => {
    const response = await app().request(`${route}${night}`);
    expect(response.status).toBe(404);
  });

  it('renders an empty night and returns zero counts and rows', async () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    const server = app();
    const htmlResponse = await server.request(`/digest/${night}`);
    const jsonResponse = await server.request(`/api/digest/${night}`);

    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain('nothing ran');
    expect(htmlRows(html)).toEqual([]);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      night, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0,
    });
  });

  it('counts malformed lines without losing good rows or counting blank lines', async () => {
    const good = { at: firstAt, job: 'survivor', owner: null, status: 'ok' };
    writeFileSync(join(runsDir, `${night}.jsonl`), `${JSON.stringify(good)}\nnot JSON\n\n   \n`);
    const server = app();
    const htmlResponse = await server.request(`/digest/${night}`);
    const jsonResponse = await server.request(`/api/digest/${night}`);

    expect(htmlResponse.status).toBe(200);
    expect(htmlRows(await htmlResponse.text()).map((row) => row[1])).toEqual(['survivor']);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      night,
      rows: [{ job: 'survivor', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt, lastAt: firstAt, hasFailure: false }],
      counts: { ok: 1, retry: 0, fail: 0 },
      badLines: 1,
    });
  });

  it('escapes log text in HTML while preserving its literal value in JSON', async () => {
    const job = '<script>alert("job")</script>';
    const owner = '<img src=x onerror="alert(1)">';
    const error = '<b>broken & unsafe</b>';
    writeEvents([{ at: firstAt, job, owner, status: 'fail', error }]);
    const server = app();
    const htmlResponse = await server.request(`/digest/${night}`);
    const jsonResponse = await server.request(`/api/digest/${night}`);

    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).not.toMatch(/<(?:script|img|b)\b/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;b&gt;broken &amp; unsafe&lt;/b&gt;');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      night,
      rows: [{ job, owner, runs: 1, retries: 0, lastStatus: 'fail', lastError: error, firstAt, lastAt: firstAt, hasFailure: true }],
      counts: { ok: 0, retry: 0, fail: 1 },
      badLines: 0,
    });
  });
});
