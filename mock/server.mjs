// mock/server.mjs
// A small local stand-in for the Cleo Customs API, used by `make test-mock`
// and by the batch and human-review examples. It follows the public OpenAPI
// contract (https://api.legaldata.cleolabs.co/v2/openapi.json) for the fields
// the examples read. The data it returns is illustrative, not a real
// classification: never quote a mock response as a Cleo answer.
//
//   node mock/server.mjs            # prints the port on stdout, then serves
//
// Prefix `/no-review` on any path to simulate a deployment where the human
// review endpoints are not live yet (they vanish from the OpenAPI and 404).

import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

const DISCLAIMER = 'Mock response for local tests. Not a customs decision.';
let requestCounter = 0;
const classifications = new Map(); // id -> record
const jobs = new Map(); // id -> job
const idempotency = new Map(); // key -> { hash, jobId }

const REVIEW_PATHS = [
  '/v2/customs/classifications/{id}/review',
  '/v2/customs/classifications/{id}/reviews',
  '/v2/customs/classification-batches/{job_id}/items/{position}/review',
  '/v2/customs/classification-batches/{job_id}/items/{position}/reviews',
];

function send(res, status, body, requestId) {
  const headers = { 'Content-Type': 'application/json', 'X-Request-Id': requestId };
  if (status >= 400 && body && typeof body === 'object') body = { ...body, request_id: requestId };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function err(res, status, code, message, requestId) {
  send(res, status, { error: { code, message } }, requestId);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return { raw, json: undefined };
  try { return { raw, json: JSON.parse(raw) }; } catch { return { raw, json: null }; }
}

function hasAllFacts(facts) {
  return Boolean(facts && facts.process && Array.isArray(facts.composition) && facts.composition.length && facts.audience);
}

function classify(body) {
  const withFacts = hasAllFacts(body.facts);
  const system = body.system ?? (body.country === 'US' ? 'hts' : body.country === 'GB' ? 'uk10' : 'hs6');
  if (!withFacts) {
    return {
      item_id: body.item_id,
      status: 'needs_information',
      query_facts: body.facts ?? {},
      missing_attributes: ['process', 'composition', 'audience'].filter((f) => !body.facts?.[f]),
      questions: ['process', 'composition', 'audience'].filter((f) => !body.facts?.[f]).map((fact) => ({
        fact,
        question: `Mock question about ${fact}?`,
        why: `Mock: ${fact} splits the contending candidates.`,
        discriminates: fact === 'process' ? 'chapter' : fact === 'audience' ? 'heading' : 'subheading',
      })),
      candidates: [{ code: '610910', system: 'hs6', title: { en: 'Mock candidate' }, confidence: 0.8 }],
      dataset_version: null,
      coverage: null,
      gate_hint: null,
      provenance: { question_config_version: 'mock', families: [], reranker: 'mock', acceptance_policy: 'mock', evidence_source: 'unavailable', evidence_rejected: [] },
      advisory_disclaimer: DISCLAIMER,
    };
  }
  return {
    item_id: body.item_id,
    status: 'classified',
    query_facts: body.facts,
    missing_attributes: [],
    questions: [],
    candidates: [
      { code: '6109100012', system, title: { en: 'Mock top candidate' }, confidence: 0.91, evidence: [{ kind: 'chapter_note', ref: 'mock' }] },
      { code: '6109901090', system, title: { en: 'Mock alternative' }, confidence: 0.4, evidence: [] },
    ],
    dataset_version: { system, edition: 'mock' },
    coverage: { level: 'national', national_systems: [system], via_bloc: null, hint: null },
    gate_hint: null,
    provenance: { question_config_version: 'mock', families: [], reranker: 'mock', acceptance_policy: 'mock', evidence_source: 'index', evidence_rejected: [] },
    advisory_disclaimer: DISCLAIMER,
  };
}

function complianceCheck(body) {
  const p = body.product ?? {};
  const c = classify({ item_id: p.item_id ?? 'compliance-check', description: p.description, country: body.destination_country, facts: p.facts, system: body.system });
  delete c.advisory_disclaimer;
  const code = c.candidates[0]?.code ?? null;
  const landed = body.transaction?.fob_usd && body.origin_country
    ? {
      code, system: c.candidates[0]?.system, origin: body.origin_country, destination: body.destination_country,
      input: body.transaction, rates: {}, breakdown: {}, total_landed_usd: body.transaction.fob_usd * 1.3,
      taxes: [], total_is_partial: true, total_excludes: ['anti_dumping'], resolution: null,
      data_completeness: { duty: 'found', preferential: 'not_checked', import_taxes: 'found', excise: 'not_applicable', anti_dumping: 'not_seeded', fx_vintage: 'mock', components_missing: ['anti_dumping'] },
    }
    : null;
  const blockers = [];
  if (c.status === 'needs_information') blockers.push({ code: 'missing_facts', step: 'classification', readiness: 'needs_information', message: 'Mock: facts missing.' });
  if (landed?.total_is_partial) blockers.push({ code: 'landed_cost_partial', step: 'landed_cost', readiness: 'needs_review', message: 'Mock: landed cost is partial.' });
  const order = { blocked: 3, needs_information: 2, needs_review: 1 };
  const readiness = blockers.reduce((acc, b) => (order[b.readiness] > (order[acc] ?? 0) ? b.readiness : acc), 'ready_for_review');
  return {
    data: {
      product_classification: { primary_code: c.candidates[0] },
      obligations: { legally_required: [], contractually_expected: [] },
      estimated_lead_time_days: null,
      decision: {
        inputs: { item_id: c.item_id, description: p.description, origin_country: body.origin_country ?? null, destination_country: body.destination_country, as_of: body.as_of ?? null, system: body.system ?? null, code, code_status: c.status },
        classification: c,
        obligations: { legally_required: [], contractually_expected: [], source: 'table', dual_use_flag: { applicable: false, checked: true, tier: 'clear', confidence: 0 } },
        dual_use: { applicable: false, tier: 'clear' },
        duties: code ? { status: 'found', code, country: body.destination_country, origin_preference: body.origin_country ? 'origin_not_listed' : 'origin_not_given', valid_on_as_of: null, duty_pct: 12 } : null,
        landed_cost: landed,
        readiness,
        blockers,
        steps: { classification: 'ok', obligations: 'ok', dual_use: 'ok', duties: code ? 'ok' : 'skipped', landed_cost: landed ? 'ok' : 'not_requested', alternatives: 'not_requested', parallel_import: 'not_requested' },
        persistence: { requested: Boolean(body.options?.persist), status: body.options?.persist ? 'stored' : 'not_requested', classification_id: null },
        limitations: ['Mock limitation.'],
      },
    },
    advisory_disclaimer: DISCLAIMER,
  };
}

function reviewRecordState(rec) {
  return { review_status: rec.review_status, approved_code: rec.approved_code, approved_at: rec.approved_at, review_version: rec.review_version };
}

function applyReview(rec, body, res, rid) {
  const allowed = new Set(['decision', 'reviewer', 'comment', 'approved_code', 'expected_version']);
  if (!body || typeof body !== 'object' || Object.keys(body).some((k) => !allowed.has(k))) return err(res, 400, 'bad_input', 'Unknown or missing field.', rid);
  if (!['approved', 'rejected', 'changes_requested'].includes(body.decision) || !body.reviewer) return err(res, 400, 'bad_input', 'decision and reviewer are required.', rid);
  if (body.approved_code && body.decision !== 'approved') return err(res, 400, 'bad_input', 'approved_code only with approved.', rid);
  if (body.expected_version != null && body.expected_version !== rec.review_version) return err(res, 409, 'version_conflict', 'expected_version does not match review_version.', rid);
  if (rec.review_status === 'approved' && body.decision !== 'changes_requested') return err(res, 409, 'review_locked', 'An approved record only accepts changes_requested.', rid);
  let approved = null;
  if (body.decision === 'approved') {
    if (rec.status === 'needs_information') return err(res, 409, 'needs_information', 'Answer the questions and classify again.', rid);
    approved = body.approved_code ?? (rec.status === 'classified' ? rec.candidates[0]?.code : null);
    if (!approved) return err(res, 400, 'approved_code_required', 'No retained candidate: send approved_code.', rid);
    if (!rec.candidates.some((c) => c.code === approved)) return err(res, 400, 'approved_code_invalid', 'Mock: approved_code must be one of the candidates.', rid);
  }
  rec.review_version += 1;
  rec.review_status = body.decision;
  rec.approved_code = approved;
  rec.approved_at = approved ? new Date().toISOString() : null;
  const review = { id: randomUUID(), decision: body.decision, reviewer: body.reviewer, comment: body.comment ?? null, approved_code: approved, version: rec.review_version, created_at: new Date().toISOString() };
  rec.history.push(review);
  return review;
}

function batchJobView(job) {
  return {
    id: job.id, idempotency_key: job.key, status: job.status, total_items: job.items.length,
    done_items: job.status === 'completed' ? job.items.length : 0,
    counts_by_status: job.status === 'completed' ? job.items.reduce((acc, it) => { const s = classify(it).status; acc[s] = (acc[s] ?? 0) + 1; return acc; }, {}) : {},
    created_at: job.createdAt, started_at: job.status === 'queued' ? null : job.createdAt,
    completed_at: job.status === 'completed' ? new Date().toISOString() : null, error: null,
  };
}

const server = createServer(async (req, res) => {
  const rid = `req_mock_${String(++requestCounter).padStart(6, '0')}`;
  let url = new URL(req.url, 'http://mock');
  let path = url.pathname;
  let reviewLive = true;
  if (path.startsWith('/no-review/')) { reviewLive = false; path = path.slice('/no-review'.length); }

  if (req.method === 'GET' && path === '/v2/openapi.json') {
    const paths = { '/v2/customs/classifications': {}, '/v2/compliance/check': {}, '/v2/customs/classification-batches': {} };
    if (reviewLive) for (const p of REVIEW_PATHS) paths[p] = {};
    return send(res, 200, { openapi: '3.1.0', info: { title: 'Cleo mock', version: 'mock' }, paths }, rid);
  }
  const auth = req.headers.authorization ?? '';
  if (!/^Bearer \S+$/.test(auth)) return err(res, 401, 'unauthorized', 'Missing API key.', rid);

  const { raw, json } = await readBody(req);
  if (json === null) return err(res, 400, 'bad_input', 'Body is not JSON.', rid);

  let m;
  if (req.method === 'POST' && path === '/v2/customs/classifications') {
    const b = json ?? {};
    if (!b.item_id || !b.description || !b.country) return err(res, 400, 'bad_input', 'item_id, description and country are required.', rid);
    const data = classify(b);
    if (b.persist) {
      const id = randomUUID();
      classifications.set(id, { id, status: data.status, candidates: data.candidates, review_status: 'unreviewed', review_version: 0, approved_code: null, approved_at: null, history: [] });
      data.classification_id = id;
    }
    const { advisory_disclaimer, ...rest } = data;
    return send(res, 200, { data: { ...rest, advisory_disclaimer }, advisory_disclaimer }, rid);
  }
  if (req.method === 'POST' && path === '/v2/compliance/check') {
    const b = json ?? {};
    if (!b.product?.description || !b.destination_country) return err(res, 400, 'bad_input', 'product.description and destination_country are required.', rid);
    return send(res, 200, complianceCheck(b), rid);
  }
  if ((m = path.match(/^\/v2\/customs\/classifications\/([^/]+)\/(review|reviews)$/))) {
    if (!reviewLive) return err(res, 404, 'not_found', 'Route not found.', rid);
    const rec = classifications.get(m[1]);
    if (!rec) return err(res, 404, 'not_found', 'Classification not found for this account.', rid);
    if (req.method === 'POST' && m[2] === 'review') {
      const review = applyReview(rec, json, res, rid);
      if (!review) return undefined;
      return send(res, 201, { data: { classification_id: rec.id, review, ...reviewRecordState(rec) }, advisory_disclaimer: DISCLAIMER }, rid);
    }
    if (req.method === 'GET' && m[2] === 'reviews') {
      return send(res, 200, { data: { classification_id: rec.id, reviews: rec.history, next_cursor: null }, advisory_disclaimer: DISCLAIMER }, rid);
    }
  }
  if (req.method === 'POST' && path === '/v2/customs/classification-batches') {
    const b = json ?? {};
    if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 2000 || Object.keys(b).some((k) => k !== 'items')) return err(res, 400, 'bad_input', 'items must be an array of 1-2000.', rid);
    if (b.items.some((it) => !it || typeof it.item_id !== 'string' || !it.item_id)) return err(res, 400, 'bad_input', 'Every item needs an item_id.', rid);
    const key = (req.headers['idempotency-key'] ?? '').toString().trim();
    if (key.length > 128) return err(res, 400, 'bad_input', 'Idempotency-Key over 128 characters.', rid);
    const hash = createHash('sha256').update(raw).digest('hex');
    if (key && idempotency.has(key)) {
      const prior = idempotency.get(key);
      if (prior.hash !== hash) return err(res, 409, 'idempotency_conflict', 'Same Idempotency-Key, different body.', rid);
      const job = jobs.get(prior.jobId);
      return send(res, 200, { data: { job_id: job.id, status: job.status, total_items: job.items.length, replayed: true, links: { self: `/v2/customs/classification-batches/${job.id}` }, ignored_columns: [] } }, rid);
    }
    const job = { id: randomUUID(), key: key || null, items: b.items, status: 'queued', polls: 0, createdAt: new Date().toISOString() };
    jobs.set(job.id, job);
    if (key) idempotency.set(key, { hash, jobId: job.id });
    return send(res, 202, { data: { job_id: job.id, status: job.status, total_items: job.items.length, replayed: false, links: { self: `/v2/customs/classification-batches/${job.id}` }, ignored_columns: [] } }, rid);
  }
  if (req.method === 'GET' && (m = path.match(/^\/v2\/customs\/classification-batches\/([^/]+)$/))) {
    const job = jobs.get(m[1]);
    if (!job) return err(res, 404, 'not_found', 'Job not found.', rid);
    job.polls += 1; // queued -> running -> completed across polls
    job.status = job.polls >= 3 ? 'completed' : job.polls >= 2 ? 'running' : 'queued';
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
    const cursor = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')) : -1;
    const done = job.status === 'completed';
    const all = job.items.map((it, position) => ({ position, item_id: it.item_id, status: done ? classify(it).status : 'pending', outcome: done ? classify(it) : null }));
    const page = all.filter((i) => i.position > cursor).slice(0, limit);
    const last = page.at(-1);
    return send(res, 200, { data: { job: batchJobView(job), items: page, next_cursor: last && last.position < all.length - 1 ? last.position : null } }, rid);
  }
  return err(res, 404, 'not_found', `No mock route for ${req.method} ${path}.`, rid);
});

server.listen(Number(process.env.MOCK_PORT ?? 0), '127.0.0.1', () => {
  process.stdout.write(`${server.address().port}\n`);
});
