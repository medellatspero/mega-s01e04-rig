export type DigestStatus = 'ok' | 'retry' | 'fail';

// Counts valid log events, not jobs; malformed lines contribute to none of these.
export type DigestStatusCounts = {
  ok: number;
  retry: number;
  fail: number;
};

export type DigestRow = {
  job: string;
  // Owner on the chronologically latest event, including an explicit null.
  owner: string | null;
  // All valid events for this job, including retries and failures.
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  // Latest reported error in chronological order, or null if none was reported.
  lastError: string | null;
  // Chronological bounds, compared as instants but kept verbatim with log offsets.
  // For equal instants, the later line wins for latest-event fields above.
  firstAt: string;
  lastAt: string;
  // True if any event failed, even when the latest status is ok.
  hasFailure: boolean;
};

export type DigestNight = {
  night: string;
  // One row per job, sorted by job using ascending string comparison.
  // Both HTML and JSON consumers use this order without regrouping.
  rows: DigestRow[];
  counts: DigestStatusCounts;
  // Nonblank lines that are invalid JSON or invalid log events; blanks are ignored.
  badLines: number;
};

// Implemented as readNight in src/digest/read-night.ts. Reads runsDir/<night>.jsonl
// synchronously. A missing file returns null; an empty file returns a DigestNight
// with no rows, zero counts and zero badLines. Other I/O errors are not hidden.
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
