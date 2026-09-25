// Shared helpers for the TypeScript examples.
// - reads CLEO_API_KEY (and optional CLEO_BASE_URL) from the environment,
// - records the HTTP status and X-Request-Id of every call so each example can
//   print evidence you can quote to Cleo support,
// - `check()` fails loudly: it prints the reason and exits with code 1.

import { LegalData } from '@cleo-legal/sdk';

export const BASE_URL = (process.env.CLEO_BASE_URL ?? 'https://api.legaldata.cleolabs.co').replace(/\/$/, '');

/** Exit code the test runner reads as "skipped, with a reason". */
export const SKIP_EXIT_CODE = 3;

export interface CallRecord {
  method: string;
  path: string;
  status: number;
  requestId: string | null;
}

export const calls: CallRecord[] = [];

export function requireApiKey(): string {
  const key = process.env.CLEO_API_KEY?.trim();
  if (!key) {
    fail('CLEO_API_KEY is not set. Create a key at https://cleo-legal-public.vercel.app/signup, then `export CLEO_API_KEY=...`.');
  }
  return key;
}

/** A LegalData client whose fetch records status + X-Request-Id of every call. */
export function makeClient(): LegalData {
  const apiKey = requireApiKey();
  const recordingFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      status: res.status,
      requestId: res.headers.get('x-request-id'),
    });
    return res;
  };
  return new LegalData({ apiKey, baseUrl: BASE_URL, fetch: recordingFetch });
}

export function lastCall(): CallRecord {
  const c = calls.at(-1);
  if (!c) fail('No HTTP call was recorded.');
  return c;
}

/** One line per call, greppable by the test runner: `[evidence] POST /v2/... http=200 request_id=...`. */
export function printEvidence(): void {
  for (const c of calls) {
    console.log(`[evidence] ${c.method} ${c.path} http=${c.status} request_id=${c.requestId ?? 'MISSING'} base=${BASE_URL}`);
  }
}

export function fail(message: string): never {
  printEvidence();
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

export function skip(message: string): never {
  printEvidence();
  console.log(`SKIP: ${message}`);
  process.exit(SKIP_EXIT_CODE);
}

export function pass(message: string): void {
  printEvidence();
  console.log(`PASS: ${message}`);
}

/** Run an example's main(), turning an unexpected error into a loud failure. */
export function run(main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    const e = err as { name?: string; message?: string; status?: number; code?: string; requestId?: string };
    fail(`${e.name ?? 'Error'}: ${e.message ?? String(err)}${e.status ? ` (http=${e.status} code=${e.code} request_id=${e.requestId ?? 'none'})` : ''}`);
  });
}
