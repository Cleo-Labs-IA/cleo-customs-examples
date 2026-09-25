// Pain: "The API is a copilot, not my broker. Someone on my team (or my broker)
// has to approve the code before it goes into the ERP, and I need to show who
// approved what, and when."
//
// Requires the review endpoints (live after PR #434). Until they appear in
// the live OpenAPI, this example SKIPS with an explicit message.
//
// Flow: classify with persist:true (stored under your account) -> approve the
// code as a named reviewer -> read the review history -> a second approval is
// refused (an approved record is locked; only changes_requested reopens it).
// Only approved codes are exported by `items.csv?approved_only=true` and
// written back by the Shopify / CSV connectors.
//
//   CLEO_API_KEY=... npm run human-review
//   CLEO_API_KEY=... npm run human-review -- --probe-only   # availability check, no write
//
// Against the live API this stores one classification (1 unit) and records
// one review (1 unit). `make test` runs it against the local mock.

import { ConflictError, NotFoundError } from '@cleo-legal/sdk';
import { BASE_URL, calls, check, lastCall, makeClient, pass, run, skip } from './_shared.js';

const REVIEW_PATH = '/v2/customs/classifications/{id}/review';
const UNAVAILABLE = 'requires review endpoints (live after PR #434): not found on this deployment yet';

run(async () => {
  // Read-only probe of the public OpenAPI before writing anything.
  const spec = await fetch(`${BASE_URL}/v2/openapi.json`);
  console.log(`[evidence] GET /v2/openapi.json http=${spec.status} request_id=${spec.headers.get('x-request-id') ?? 'MISSING'} base=${BASE_URL}`);
  check(spec.ok, `could not read the OpenAPI (HTTP ${spec.status})`);
  const paths = ((await spec.json()) as { paths?: Record<string, unknown> }).paths ?? {};
  if (!(REVIEW_PATH in paths)) skip(UNAVAILABLE);
  if (process.argv.includes('--probe-only')) {
    pass('review endpoints are listed in the OpenAPI (probe only, nothing written)');
    return;
  }

  const cleo = makeClient();
  const classified = await cleo.customs.classify({
    item_id: 'SKU-TS-US',
    description: "Men's knitted cotton T-shirt, 100% cotton",
    country: 'US',
    facts: { process: 'knitted', composition: [{ material: 'cotton', percent: 100 }], audience: 'men' },
    persist: true,
  });
  const id = classified.data.classification_id;
  check(id, 'persist:true returned no classification_id');
  check(classified.data.status !== 'needs_information', 'needs_information cannot be approved: answer the questions first');
  const proposed = classified.data.candidates[0]?.code;
  check(proposed, 'no candidate to approve');
  console.log(`classification ${id}: ${classified.data.status}, top candidate ${proposed}`);

  let review;
  try {
    review = await cleo.customs.classifications.review(id, {
      decision: 'approved',
      reviewer: 'reviewer@example.com',
      comment: 'Checked against the chapter 61 notes with our broker.',
      approved_code: proposed,
      expected_version: 0,
    });
  } catch (err) {
    if (err instanceof NotFoundError) skip(`${UNAVAILABLE} (review returned 404, request_id ${err.requestId})`);
    throw err;
  }
  check(lastCall().status === 201, `review: expected 201, got ${lastCall().status}`);
  check(review.data.review_status === 'approved', `review_status ${review.data.review_status}`);
  check(review.data.approved_code === proposed, `approved_code ${review.data.approved_code} != ${proposed}`);
  check(review.data.review_version === 1, `review_version ${review.data.review_version}, expected 1`);
  console.log(`approved ${review.data.approved_code} by ${review.data.review.reviewer} (version ${review.data.review_version})`);

  const history = await cleo.customs.classifications.reviews(id);
  const latest = history.data.reviews.at(-1);
  check(latest && latest.decision === 'approved' && latest.version === review.data.review_version, 'the history does not end with the approval');

  try {
    await cleo.customs.classifications.review(id, { decision: 'rejected', reviewer: 'someone-else@example.com' });
    check(false, 'a decision on an approved record should be refused');
  } catch (err) {
    check(err instanceof ConflictError && err.code === 'review_locked', `expected 409 review_locked, got ${(err as Error).message}`);
    console.log(`second decision -> 409 ${err.code}: only changes_requested reopens an approved record`);
  }
  pass(`approved, history recorded, lock enforced, ${calls.length} call(s)`);
});
