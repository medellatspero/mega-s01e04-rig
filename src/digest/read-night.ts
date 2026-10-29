import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, DigestStatus, ReadNight } from './types.js';

type Event = {
  at: string;
  instant: number;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const instant = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date;
}

// Validate at the input boundary, rather than trusting JSON or Date.parse's
// permissive handling of missing offsets and impossible calendar dates.
function parseEvent(line: string): Event | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string'
    || !('job' in value) || typeof value.job !== 'string' || value.job.trim() === ''
    || !('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')
    || !('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')
    || ('error' in value && typeof value.error !== 'string')) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at)
    || !validDate(value.at.slice(0, 10))) return null;
  const instant = Date.parse(value.at);
  if (!Number.isFinite(instant) || Number(value.at.slice(11, 13)) > 23) return null;
  return {
    at: value.at, instant, job: value.job, status: value.status, owner: value.owner,
    ...('error' in value && typeof value.error === 'string' ? { error: value.error } : {}),
  };
}

function parseNight(text: string, night: string): DigestNight {
  const result: DigestNight = { night, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0 };
  const jobs = new Map<string, { row: DigestRow; first: number; last: number; errorAt: number }>();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (!event) {
      result.badLines++;
      continue;
    }
    result.counts[event.status]++;
    const existing = jobs.get(event.job);
    if (!existing) {
      jobs.set(event.job, {
        row: {
          job: event.job, owner: event.owner, runs: 1, retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status, lastError: event.error ?? null,
          firstAt: event.at, lastAt: event.at, hasFailure: event.status === 'fail',
        },
        first: event.instant, last: event.instant,
        errorAt: event.error === undefined ? -Infinity : event.instant,
      });
      continue;
    }
    const { row } = existing;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.hasFailure = true;
    if (event.instant < existing.first) {
      existing.first = event.instant;
      row.firstAt = event.at;
    }
    if (event.instant >= existing.last) {
      existing.last = event.instant;
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && event.instant >= existing.errorAt) {
      existing.errorAt = event.instant;
      row.lastError = event.error;
    }
  }
  result.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return result;
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!validDate(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  return parseNight(text, night);
};
