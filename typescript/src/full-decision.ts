// Pain: "Product + origin + destination + date. I need the local code, the
// import obligations, the duty and the landed cost, and I need to know what is
// still missing before I show it to my broker."
//
// POST /v2/compliance/check runs classification, obligations, dual-use, duties
// and landed cost on ONE tariff code, and returns `data.decision`: a readiness
// (`ready_for_review` at best, never "cleared"), the blockers, the status of
// every step and what the inputs could not reach.
//
//   CLEO_API_KEY=... npm run full-decision
//
// persist:false, so nothing is stored under your account. Cost: 5 units.

import { calls, check, lastCall, makeClient, pass, run } from './_shared.js';

const READINESS = ['ready_for_review', 'needs_information', 'needs_review', 'blocked'];
const STEP_STATES = ['ok', 'unavailable', 'skipped', 'not_requested'];

run(async () => {
  const cleo = makeClient();

  const res = await cleo.compliance.check({
    product: {
      item_id: 'SKU-TS-GB-1',
      description: "Men's knitted cotton T-shirt, 100% cotton",
      facts: {
        process: 'knitted',
        composition: [{ material: 'cotton', percent: 100 }],
        audience: 'men',
      },
    },
    origin_country: 'BD',
    destination_country: 'GB',
    transaction: { fob_usd: 12000, freight_usd: 900, quantity: 2000, unit: 'pcs', transport_mode: 'ocean' },
    options: { persist: false, include_parallel_import: false },
  });
  const call = lastCall();
  const decision = res.data.decision;

  check(call.status === 200, `expected HTTP 200, got ${call.status}`);
  check(call.requestId, 'the response carries no X-Request-Id header');
  check(decision, 'data.decision is missing: this deployment predates the composite decision');
  check(READINESS.includes(decision.readiness), `unknown readiness "${decision.readiness}"`);
  for (const [step, state] of Object.entries(decision.steps)) {
    check(STEP_STATES.includes(state as string), `step ${step} has unknown state "${state}"`);
  }
  check(decision.readiness === 'ready_for_review' ? decision.blockers.length === 0 : decision.blockers.length > 0,
    `readiness ${decision.readiness} is inconsistent with ${decision.blockers.length} blocker(s)`);

  // persist:false means nothing stored and no id.
  check(decision.persistence.requested === false, 'persistence.requested should be false');
  check(decision.persistence.status === 'not_requested', `persistence.status should be not_requested, got ${decision.persistence.status}`);
  check(decision.persistence.classification_id === null, 'persist:false returned a classification_id');

  // Every downstream step ran on the same tariff code.
  const code = decision.inputs.code;
  check(code, `decision.inputs.code is null (code_status=${decision.inputs.code_status}); nothing was propagated`);
  check(decision.classification?.candidates[0]?.code === code,
    `classification top candidate ${decision.classification?.candidates[0]?.code} != inputs.code ${code}`);
  if (decision.duties) {
    check(decision.duties.code === code, `duties ran on ${decision.duties.code}, not on inputs.code ${code}`);
  }
  if (decision.landed_cost) {
    const hs6 = (c: string) => c.replace(/\D/g, '').slice(0, 6);
    check(hs6(decision.landed_cost.code) === hs6(code), `landed cost ran on ${decision.landed_cost.code}, not on ${code}`);
    // A partial total must say so, and must show up as a blocker.
    const partial = decision.landed_cost.total_is_partial;
    const missing = decision.landed_cost.data_completeness.components_missing;
    const excluded = decision.landed_cost.total_excludes;
    check((missing.length === 0 && excluded.length === 0) || partial === true,
      `landed cost misses [${[...missing, ...excluded].join(', ')}] but total_is_partial is false`);
    check(!partial || decision.blockers.some((b) => b.code === 'landed_cost_partial'),
      'landed cost is partial but no landed_cost_partial blocker was raised');
  }
  check(typeof res.advisory_disclaimer === 'string' && res.advisory_disclaimer.length > 0, 'advisory_disclaimer is missing');

  console.log(`code: ${code} (${decision.inputs.system ?? decision.classification?.candidates[0]?.system}), code_status: ${decision.inputs.code_status}`);
  console.log(`readiness: ${decision.readiness}`);
  for (const b of decision.blockers) console.log(`- blocker ${b.code} [${b.step} -> ${b.readiness}]: ${b.message}`);
  console.log(`steps: ${JSON.stringify(decision.steps)}`);
  if (decision.landed_cost) {
    const lc = decision.landed_cost as unknown as { total_landed_usd?: number | null; breakdown?: { total_landed_usd?: number | null } };
    const total = lc.total_landed_usd ?? lc.breakdown?.total_landed_usd ?? null;
    console.log(`landed cost: ${total ?? 'not computable'} USD, partial=${decision.landed_cost.total_is_partial}`);
  }
  for (const l of decision.limitations) console.log(`- limitation: ${l}`);
  pass(`decision readiness=${decision.readiness}, code ${code} propagated to every step, ${calls.length} call(s)`);
});
