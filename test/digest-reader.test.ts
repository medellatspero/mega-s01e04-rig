import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const night = '2026-10-28';
const at = '2026-10-28T23:00:00+01:00';
const event = (overrides: Record<string, unknown> = {}) => ({ at, job: 'job', status: 'ok', owner: 'rook', ...overrides });

describe('readNight', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const encode = (values: unknown[]) => values.map(value => JSON.stringify(value)).join('\n');
  function read(text: string) {
    writeFileSync(join(dir, `${night}.jsonl`), text);
    return readNight(dir, night);
  }

  it('reads the supplied fixture without modifying it', () => {
    const result = readNight(new URL('../runs/', import.meta.url).pathname, night);
    expect(result?.badLines).toBe(1);
    expect(result?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(result?.rows[0].owner).toBeNull();
    expect(result?.rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(result?.rows[2].runs).toBe(8);
    expect(result?.rows[3].hasFailure).toBe(true);
  });

  it('returns null for a missing file', () => {
    expect(readNight(dir, night)).toBeNull();
  });

  it.each(['', ' \n\t\r\n  \n'])('returns an empty digest for empty or blank input %j', text => {
    expect(read(text)).toEqual({ night, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0 });
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28/../x', '2026-10-28.jsonl',
    '2026-1-28', '2026-02-29', '2026-13-01', '2026-10-00', '2026-10-28\n', ''])('rejects unsafe or invalid nights: %j', invalid => {
    expect(readNight(dir, invalid)).toBeNull();
  });

  it('accepts a real leap day', () => {
    writeFileSync(join(dir, '2024-02-29.jsonl'), '');
    expect(readNight(dir, '2024-02-29')?.night).toBe('2024-02-29');
  });

  it('propagates non-missing I/O errors', () => {
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });

  it('counts malformed JSON and schema errors, ignores blanks, and continues', () => {
    const invalid: unknown[] = [null, [], 1, 'text', {},
      event({ at: null }), event({ at: 'not a time' }), event({ at: '2026-02-30T01:00:00Z' }),
      event({ at: '2026-10-28T01:00:00' }), event({ at: '2026-10-28T24:00:00Z' }),
      event({ job: 1 }), event({ job: ' ' }), event({ status: 'unknown' }), event({ owner: 3 }),
      event({ error: null }), event({ error: {} }),
      { at, job: 'job', status: 'ok' }, { at, job: 'job', owner: null },
    ];
    const result = read(`\n{broken\r\n${encode(invalid)}\n \n${encode([event({ owner: null })])}\n`);
    expect(result?.badLines).toBe(invalid.length + 1);
    expect(result?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]).toEqual({ job: 'job', owner: null, runs: 1, retries: 0,
      lastStatus: 'ok', lastError: null, firstAt: at, lastAt: at, hasFailure: false });
  });

  it('orders by instants rather than log order or timestamp text, preserving offsets', () => {
    const first = '2026-10-29T00:00:00+03:00';
    const last = '2026-10-28T23:30:00+01:00';
    const result = read(encode([
      event({ at: last, owner: null }),
      event({ at: first, status: 'fail', error: 'old', owner: 'old owner' }),
      event({ at: '2026-10-28T22:00:00Z', status: 'retry', error: 'latest error' }),
      event({ at: '2026-10-28T21:30:00Z', status: 'retry', error: 'older error' }),
    ]));
    expect(result?.rows[0]).toEqual({ job: 'job', owner: null, runs: 4, retries: 2,
      lastStatus: 'ok', lastError: 'latest error', firstAt: first, lastAt: last, hasFailure: true });
    expect(result?.counts).toEqual({ ok: 1, retry: 2, fail: 1 });
  });

  it('uses later lines for latest fields at equal instants, including reported errors', () => {
    const equal = '2026-10-28T22:00:00Z';
    const result = read(encode([
      event({ status: 'fail', error: 'first' }),
      event({ at: equal, status: 'retry', error: 'second', owner: 'second' }),
      event({ owner: null }),
    ]));
    expect(result?.rows[0]).toMatchObject({ firstAt: at, lastAt: at, owner: null,
      lastStatus: 'ok', lastError: 'second', hasFailure: true });
  });

  it('retains an explicitly reported empty error and accepts extra metadata', () => {
    expect(read(encode([event({ error: '', extra: true }), event()]))?.rows[0].lastError).toBe('');
  });

  it('sorts by ascending string comparison and safely handles object-like job names', () => {
    const names = ['z', '__proto__', 'a', 'Z', 'constructor', 'A'];
    expect(read(encode(names.map(job => event({ job }))))?.rows.map(row => row.job))
      .toEqual(['A', 'Z', '__proto__', 'a', 'constructor', 'z']);
  });

  it('accepts fractional timestamps and Windows line endings', () => {
    const first = '2026-10-28T22:00:00.001Z';
    const last = '2026-10-28T22:00:00.002Z';
    expect(read(`${JSON.stringify(event({ at: last }))}\r\n${JSON.stringify(event({ at: first }))}\r\n`)
      ?.rows[0]).toMatchObject({ firstAt: first, lastAt: last, runs: 2 });
  });

  it('keeps independent calls isolated', () => {
    const previous = read(encode([event({ status: 'fail' })]));
    expect(read('')?.rows).toEqual([]);
    expect(previous?.rows[0].hasFailure).toBe(true);
  });
});
