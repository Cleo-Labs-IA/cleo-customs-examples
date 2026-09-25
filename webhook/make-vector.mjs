// webhook/make-vector.mjs
// Writes webhook/test-vector.json: one signed delivery built with node:crypto
// from the server's signing rules, independently of the SDK:
//
//   key                = hex(SHA-256(whsec_ secret))       (used as a UTF-8 string)
//   X-Cleo-Signature    = "sha256=" + hex(HMAC-SHA256(key, raw body))            (V1)
//   X-Cleo-Timestamp    = unix seconds of the attempt
//   X-Cleo-Signature-V2 = "t=<ts>,v1=" + hex(HMAC-SHA256(key, "<ts>.<raw body>")) (V2)
//
// The secret below is a published test value, never a real subscription secret.
//
//   node webhook/make-vector.mjs

import { createHash, createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function signDelivery(body, secret, timestamp) {
  const key = createHash('sha256').update(secret).digest('hex');
  const v1 = createHmac('sha256', key).update(body).digest('hex');
  const v2 = createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex');
  return {
    'X-Cleo-Signature': `sha256=${v1}`,
    'X-Cleo-Timestamp': String(timestamp),
    'X-Cleo-Signature-V2': `t=${timestamp},v1=${v2}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const secret = 'whsec_test_vector_not_a_real_secret';
  const timestamp = 1790000000; // 2026-09-21T14:13:20Z
  const eventId = '00000000-0000-4000-8000-000000000001';
  const body = JSON.stringify({
    id: eventId,
    type: 'classification_batch.completed',
    created_at: '2026-09-21T14:13:20.000Z',
    data: {
      job_id: '00000000-0000-4000-8000-0000000000aa',
      total_items: 3,
      done_items: 3,
      counts_by_status: { needs_information: 1, classified: 1, needs_review: 1 },
      completed_at: '2026-09-21T14:13:19.000Z',
      items_url: '/v2/customs/classification-batches/00000000-0000-4000-8000-0000000000aa/items.csv',
    },
  });
  const vector = {
    note: 'Test vector for webhook signature verification. The secret is public and fake.',
    secret,
    timestamp,
    body,
    headers: {
      'Content-Type': 'application/json',
      ...signDelivery(body, secret, timestamp),
      'X-Cleo-Event-Id': eventId,
      'X-Cleo-Event-Type': 'classification_batch.completed',
    },
  };
  const out = new URL('./test-vector.json', import.meta.url);
  writeFileSync(out, `${JSON.stringify(vector, null, 2)}\n`);
  console.log(`wrote ${fileURLToPath(out)}`);
}
