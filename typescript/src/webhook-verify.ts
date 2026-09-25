// Pain: "My ERP should react when the catalog job is done, without polling,
// and without trusting any POST that hits my endpoint."
//
// Every delivery carries two signatures, both keyed by hex(SHA-256(your whsec_
// secret)):
//   X-Cleo-Signature:    sha256=<HMAC of the raw body>                 (V1)
//   X-Cleo-Timestamp +
//   X-Cleo-Signature-V2: t=<unix seconds>,v1=<HMAC of "<t>.<raw body>"> (V2, rejects replays)
// Verify V2 when you can (5-minute tolerance), keep V1 for older receivers,
// always on the RAW body, and deduplicate on X-Cleo-Event-Id: a delivery can
// be retried. Polling the job stays available if a webhook never arrives.
//
//   npm run webhook-verify        # local only: no API key, no network
//
// It checks (1) the committed test vector in ../webhook/test-vector.json and
// (2) a vector it generates now with a random secret, then five negative
// controls that MUST be rejected.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  verifyWebhookSignature, verifyWebhookSignatureV2, verifyWebhookV2, WebhookVerificationError,
} from '@cleo-legal/sdk';
import { check, pass, run } from './_shared.js';

interface Vector { secret: string; timestamp: number; body: string; headers: Record<string, string> }

// Independent signer (node:crypto), following the server's rules.
function sign(body: string, secret: string, t: number): Record<string, string> {
  const key = createHash('sha256').update(secret).digest('hex');
  return {
    'X-Cleo-Signature': `sha256=${createHmac('sha256', key).update(body).digest('hex')}`,
    'X-Cleo-Timestamp': String(t),
    'X-Cleo-Signature-V2': `t=${t},v1=${createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`,
  };
}

async function verifyBoth(label: string, v: Vector): Promise<void> {
  const now = v.timestamp + 10; // the receiver's clock, 10 s after signing
  check(await verifyWebhookSignature(v.body, v.headers['X-Cleo-Signature'], v.secret), `${label}: V1 signature rejected`);
  check(await verifyWebhookSignatureV2(v.body, v.headers['X-Cleo-Signature-V2'], v.secret, { now }), `${label}: V2 signature rejected`);
  const event = await verifyWebhookV2(v.body, v.headers, v.secret, { now });
  check(event.id === JSON.parse(v.body).id, `${label}: parsed event id does not match the body`);
  console.log(`${label}: V1 ok, V2 ok, event ${event.type} ${event.id}`);
}

run(async () => {
  const committed = JSON.parse(readFileSync(new URL('../../webhook/test-vector.json', import.meta.url), 'utf8')) as Vector;
  // The committed vector must match the independent signer (catches a stale file).
  const expected = sign(committed.body, committed.secret, committed.timestamp);
  for (const h of ['X-Cleo-Signature', 'X-Cleo-Signature-V2']) {
    check(committed.headers[h] === expected[h], `test-vector.json ${h} does not match the signing rules`);
  }
  await verifyBoth('committed vector', committed);

  // Self-generated vector with a fresh random secret (never written anywhere).
  const secret = `whsec_${randomBytes(32).toString('hex')}`;
  const t = Math.floor(Date.now() / 1000);
  const body = committed.body.replace('"total_items":3', '"total_items":4');
  await verifyBoth('fresh vector', { secret, timestamp: t, body, headers: { ...sign(body, secret, t), 'X-Cleo-Event-Id': 'evt-fresh' } });

  // Negative controls: each one MUST be rejected.
  const v = committed;
  const now = v.timestamp + 10;
  const tampered = v.body.replace('"done_items":3', '"done_items":2');
  check(!(await verifyWebhookSignature(tampered, v.headers['X-Cleo-Signature'], v.secret)), 'tampered body accepted by V1');
  check(!(await verifyWebhookSignatureV2(tampered, v.headers['X-Cleo-Signature-V2'], v.secret, { now })), 'tampered body accepted by V2');
  check(!(await verifyWebhookSignature(v.body, v.headers['X-Cleo-Signature'], `${v.secret}x`)), 'wrong secret accepted');
  const rawKeySig = `sha256=${createHmac('sha256', v.secret).update(v.body).digest('hex')}`;
  check(!(await verifyWebhookSignature(v.body, rawKeySig, v.secret)), 'a signature keyed by the raw secret was accepted (the key is hex(SHA-256(secret)))');
  try {
    await verifyWebhookV2(v.body, v.headers, v.secret, { now: v.timestamp + 301 });
    check(false, 'a delivery 301 s old was accepted by V2 (tolerance is 300 s)');
  } catch (err) {
    check(err instanceof WebhookVerificationError, `expected WebhookVerificationError, got ${(err as Error).name}`);
    console.log(`replayed delivery (301 s old) -> rejected: ${(err as WebhookVerificationError).message}`);
  }
  console.log('negative controls: tampered body (V1, V2), wrong secret, raw-secret key, stale timestamp -> all rejected');
  pass('webhook V1 + V2 verified on the committed and a fresh vector; 5 negative controls rejected');
});
