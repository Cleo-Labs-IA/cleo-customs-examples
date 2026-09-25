# Changelog

All notable changes to these examples. Dates are UTC.

## 0.1.0 (2026-09-25)

First version.

- `curl/quickstart.sh`: one classification, `needs_information` with its questions.
- TypeScript (`@cleo-legal/sdk` pinned to `0.9.0`): needs-information, full decision (`POST /v2/compliance/check`, `persist:false`, one code carried through every step), batch (`Idempotency-Key`, replay, conflict, polling), human review (skips until the review endpoints are live), webhook V1 + V2 verification.
- Python (`requests` only): needs-information, full decision, webhook V1 + V2 verification.
- `webhook/test-vector.json`: a signed `classification_batch.completed` delivery with a public, fake secret.
- `make test` (live where the call writes nothing) and `make test-mock` (local mock, no key, no network), PASS / FAIL / SKIP per example.

Known limits of this version:

- `@cleo-legal/sdk@0.9.0` is not on npm yet (npm serves `0.7.0` on 2026-09-25): `npm install` in `typescript/` fails until it is published. Use `make install SDK_TARBALL=...` with a packed SDK meanwhile.
- The review endpoints are not live yet; `human-review.ts` skips with a message on the live API.
- No lockfile is committed for `typescript/` while the SDK version is unpublished.
