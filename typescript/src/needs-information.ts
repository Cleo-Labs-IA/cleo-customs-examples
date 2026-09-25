// Pain: "I only have a product title. Which facts do I still need before I can classify it?"
//
// A bare "T-shirt" for the United States is not classifiable yet: knitted or
// woven splits the chapter, the fibre splits the subheading, the wearer splits
// the heading. The API answers `needs_information` with the questions to ask
// your supplier, instead of inventing a code.
//
//   CLEO_API_KEY=... npm run needs-information
//
// Nothing is stored (persist defaults to false). Cost: 1 unit.

import { calls, check, lastCall, makeClient, pass, run } from './_shared.js';

run(async () => {
  const cleo = makeClient();

  const res = await cleo.customs.classify({
    item_id: 'SKU-TSHIRT-9',
    description: 'T-shirt',
    country: 'US',
  });
  const call = lastCall();
  const d = res.data;

  check(call.status === 200, `expected HTTP 200, got ${call.status}`);
  check(call.requestId, 'the response carries no X-Request-Id header');
  check(d.status === 'needs_information', `expected status needs_information, got ${d.status}`);
  check(d.missing_attributes.length > 0, 'needs_information must name at least one missing attribute');
  check(d.questions.length > 0, 'needs_information must come with at least one question');
  for (const attr of d.missing_attributes) {
    check(d.questions.some((q) => q.fact === attr), `missing attribute "${attr}" has no matching question`);
  }
  check(!('classification_id' in d), 'persist was not requested, yet the response carries a classification_id');
  check(typeof res.advisory_disclaimer === 'string' && res.advisory_disclaimer.length > 0, 'advisory_disclaimer is missing');

  console.log(`status: ${d.status}`);
  for (const q of d.questions) console.log(`- ${q.fact} (${q.discriminates}): ${q.question}`);
  console.log('Next step: ask these questions, then send the answers in `facts` (see full-decision.ts).');
  pass(`needs_information with ${d.questions.length} question(s), ${calls.length} call(s)`);
});
