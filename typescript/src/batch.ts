// Pain: "I have a catalog, not one product. My import job crashes halfway and
// I retry it: did I just create (and pay for) the same job twice?"
//
// POST /v2/customs/classification-batches takes up to 2,000 items and runs
// asynchronously. Send an Idempotency-Key: the same key and the same body
// within 24h replays the SAME job (`replayed: true`, not charged again); the
// same key with a different body is a 409 `idempotency_conflict`. Poll the job
// (or subscribe to the `classification_batch.completed` webhook, see
// webhook-verify.ts), then read items in submission order.
//
//   CLEO_API_KEY=... npm run batch
//
// Against the live API this creates one job under your account and costs
// 1 unit per item (3 here). `make test` runs it against the local mock.

import { randomUUID } from 'node:crypto';
import { ConflictError } from '@cleo-legal/sdk';
import { calls, check, lastCall, makeClient, pass, run } from './_shared.js';

const items = [
  { item_id: 'A1', description: 'T-shirt', country: 'US' },
  {
    item_id: 'A2',
    description: "Men's knitted cotton T-shirt, 100% cotton",
    country: 'GB',
    facts: { process: 'knitted', composition: [{ material: 'cotton', percent: 100 }], audience: 'men' as const },
  },
  { item_id: 'A3', description: 'Hydraulic gear pump for agricultural tractors, 250 bar, cast iron body', country: 'FR', facts: { material: 'cast iron' } },
];

run(async () => {
  const cleo = makeClient();
  // One key per logical import. Reuse it on every retry of THAT import.
  const idempotencyKey = process.env.CLEO_IDEMPOTENCY_KEY ?? `catalog-import-${randomUUID()}`;

  const first = await cleo.customs.batches.submit(items, { idempotencyKey });
  check(lastCall().status === 202, `first submission: expected 202, got ${lastCall().status}`);
  check(lastCall().requestId, 'first submission carries no X-Request-Id');
  check(first.data.replayed === false, 'first submission should not be a replay');
  check(first.data.total_items === items.length, `total_items ${first.data.total_items} != ${items.length}`);
  const jobId = first.data.job_id;
  console.log(`job ${jobId} ${first.data.status}`);

  // A retry of the same import (same key, same body) returns the same job.
  const replay = await cleo.customs.batches.submit(items, { idempotencyKey });
  check(lastCall().status === 200, `replay: expected 200, got ${lastCall().status}`);
  check(replay.data.replayed === true, 'replay: expected replayed: true');
  check(replay.data.job_id === jobId, `replay returned job ${replay.data.job_id}, expected ${jobId}`);
  console.log(`replay -> same job ${replay.data.job_id}, replayed=${replay.data.replayed}`);

  // The same key with a different body is refused before any quota is charged.
  try {
    await cleo.customs.batches.submit(items.slice(0, 1), { idempotencyKey });
    check(false, 'same key + different body should be a 409 idempotency_conflict');
  } catch (err) {
    check(err instanceof ConflictError, `expected ConflictError, got ${(err as Error).name}: ${(err as Error).message}`);
    check(err.code === 'idempotency_conflict', `expected code idempotency_conflict, got ${err.code}`);
    check(err.requestId, 'the 409 carries no request id');
    console.log(`different body -> 409 ${err.code} (request_id ${err.requestId})`);
  }

  const job = await cleo.customs.waitForBatch(jobId, {
    intervalMs: Number(process.env.CLEO_POLL_INTERVAL_MS ?? 5000),
    timeoutMs: 15 * 60_000,
    onPoll: (j) => console.log(`poll: ${j.status} ${j.done_items}/${j.total_items}`),
  });
  check(job.status === 'completed', `job ended ${job.status}${job.error ? `: ${job.error}` : ''}`);
  check(job.done_items === job.total_items, `done_items ${job.done_items} != total_items ${job.total_items}`);

  const seen: string[] = [];
  for await (const item of cleo.customs.batches.items(jobId)) {
    check(item.position === seen.length, `item out of order: position ${item.position} at index ${seen.length}`);
    check(item.status !== 'pending', `item ${item.position} still pending after completion`);
    seen.push(String(item.item_id));
    console.log(`- ${item.position} ${item.item_id}: ${item.status}`);
  }
  check(seen.join(',') === items.map((i) => i.item_id).join(','), `items came back as ${seen.join(',')}`);
  console.log(`counts_by_status: ${JSON.stringify(job.counts_by_status)}`);
  pass(`batch ${jobId} completed, replay returned the same job, conflict refused, ${calls.length} call(s)`);
});
