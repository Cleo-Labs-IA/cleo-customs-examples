# Cleo Customs Classification API: runnable examples

Product + origin + destination + date in. Local tariff code, the questions still open, obligations, duty, landed cost, sources and a review status out. Every example here runs against the real API with your key and fails loudly when the answer does not hold.

## The problems these examples answer

We read importers, merchants, brokers and developers on Reddit and trade forums in September 2026. They rarely ask for "description in, HS code out". They ask for this:

| What people told us | What to run |
|---|---|
| "I only have a product title." The facts that split the code (knitted or woven, fibre, wearer, material) are missing, and a tool that guesses anyway creates catalog debt. | [`curl/quickstart.sh`](curl/quickstart.sh), [`needs-information.ts`](typescript/src/needs-information.ts), [`needs_information.py`](python/needs_information.py): the API answers `needs_information` with the questions to ask your supplier. |
| "One code with a confidence score is useless. I need the local line, the import requirements and the real landed cost, and I need to see what is missing." ([r/CustomsBroker](https://www.reddit.com/r/CustomsBroker/comments/1peey6w/trade_compliance_software_research/), [r/woocommerce](https://www.reddit.com/r/woocommerce/comments/17a82ri/let_customers_prepay_customsduties_at_checkout/)) | [`full-decision.ts`](typescript/src/full-decision.ts), [`full_decision.py`](python/full_decision.py): `POST /v2/compliance/check` carries one code through classification, obligations, dual-use, duties and landed cost, and returns `readiness`, `blockers`, `steps` and `limitations`. A partial landed cost says it is partial. |
| "I have thousands of SKUs, and my import job gets retried." ([r/CustomsBroker](https://www.reddit.com/r/CustomsBroker/comments/13wu8wi/questions_about_software/)) | [`batch.ts`](typescript/src/batch.ts): up to 2,000 items per job, `Idempotency-Key` so a retry returns the same job, polling in submission order. |
| "The tool is a copilot. A person, often our broker, signs off on the code." ([r/CustomsBroker](https://www.reddit.com/r/CustomsBroker/comments/1m9vdpx/are_custom_brokers_in_danger_of_being_replaced_by/)) | [`human-review.ts`](typescript/src/human-review.ts): approve a code as a named reviewer, read the history, and see the approval lock. Live in production since 2026-09-26. |
| "My ERP should react when the job is done, and only trust signed calls." | [`webhook-verify.ts`](typescript/src/webhook-verify.ts), [`webhook_verify.py`](python/webhook_verify.py): verify `X-Cleo-Signature` (V1) and the replay-protected `X-Cleo-Signature-V2`, offline, against a published test vector. |

Every answer is advisory. `ready_for_review` is the best status the API gives, never "cleared": a licensed customs broker or the competent authority validates the outcome.

Coverage differs by destination: some countries resolve to a national tariff line, others to HS6 only. Check `GET /v2/customs/coverage/countries` with your key (for example `?country=KE`) before you promise a result for a market.

## Quickstart (curl, 1 minute)

1. Create a Sandbox key at <https://cleo-legal-public.vercel.app/signup> (the signup page states 200 units, no card).
2. Run one classification:

```bash
export CLEO_API_KEY=...        # never commit it; see .env.example
bash curl/quickstart.sh        # needs curl and jq
```

Expected: `status: needs_information` with three questions (process, composition, audience), the `X-Request-Id` of the call, then `PASS`. Quote the request id to support if anything looks wrong.

## Run everything

```bash
make install                   # TypeScript deps + a Python venv with requests
export CLEO_API_KEY=...
make test                      # PASS / FAIL / SKIP per example
make test-mock                 # same examples on a local mock: no key, no network
```

`make test` sends only read-only or `persist:false` calls to the live API (curl quickstart, needs-information and full-decision in TypeScript and Python, and a public OpenAPI read). The batch and human-review examples create a job or store a record under your account, so `make test` runs them on the local mock (`mock/server.mjs`); run them live one at a time with `npm run batch` or `npm run human-review` in `typescript/`. The webhook examples never touch the network.

| Example | Endpoint | Live cost |
|---|---|---|
| `curl/quickstart.sh` | `POST /v2/customs/classifications` | 1 unit |
| `typescript/src/needs-information.ts`, `python/needs_information.py` | `POST /v2/customs/classifications` | 1 unit |
| `typescript/src/full-decision.ts`, `python/full_decision.py` | `POST /v2/compliance/check` with `persist:false` | 5 units |
| `typescript/src/batch.ts` | `POST /v2/customs/classification-batches`, `GET .../{job_id}` | 1 unit per item (3), one job created |
| `typescript/src/human-review.ts` | `POST /v2/customs/classifications/{id}/review`, `GET .../reviews` | 2 units, one record stored |
| `typescript/src/webhook-verify.ts`, `python/webhook_verify.py` | none (offline) | 0 |

One live `make test` run costs 13 units (1 + 1 + 5 + 1 + 5). Check your remaining quota with `GET /v2/me/quota`.

## TypeScript SDK version

The TypeScript examples use `@cleo-legal/sdk` `0.9.0`, the first version with `compliance.check`, the review methods and webhook V2 verification. Until `0.9.0` reaches the npm registry (it still serves `0.7.0`), it is published as a [GitHub release of this repository](https://github.com/Cleo-Labs-IA/cleo-customs-examples/releases/tag/sdk-v0.9.0), and `typescript/package.json` installs it from there, so `npm install` works today. In your own project:

```bash
npm install https://github.com/Cleo-Labs-IA/cleo-customs-examples/releases/download/sdk-v0.9.0/cleo-legal-sdk-0.9.0.tgz
```

## Webhooks in one paragraph

Each delivery carries `X-Cleo-Signature: sha256=<hex>` (HMAC-SHA256 of the raw body), plus `X-Cleo-Timestamp` and `X-Cleo-Signature-V2: t=<unix seconds>,v1=<hex>` (HMAC-SHA256 of `"<t>.<raw body>"`). Both use the same key: the lowercase hex SHA-256 of your `whsec_` secret, as a UTF-8 string, not the secret itself. Verify V2 with a 300-second tolerance, verify on the raw body before any JSON parsing, and deduplicate on `X-Cleo-Event-Id` because a delivery can be retried. Polling stays available if a webhook never arrives. [`webhook/test-vector.json`](webhook/test-vector.json) is a signed `classification_batch.completed` delivery with a public, fake secret; `node webhook/make-vector.mjs` rebuilds it.

## Links

- Sign up and get a key: <https://cleo-legal-public.vercel.app/signup>
- Playground, no install: <https://cleo-legal-public.vercel.app/playground?tab=classify>
- Customs guide: <https://cleo-legal-public.vercel.app/docs/customs>
- API reference: <https://cleo-legal-public.vercel.app/docs>
- OpenAPI (live): <https://api.legaldata.cleolabs.co/v2/openapi.json>
- MCP server for agents: <https://github.com/Cleo-Labs-IA/legal-mcp>

## Report a bug

Open a GitHub issue with the example name, the command, the output and the `request_id` printed on the `[evidence]` line. Never paste your API key or a webhook secret. See [CONTRIBUTING.md](CONTRIBUTING.md). You can also write to hello@cleolabs.co.

## License

MIT, see [LICENSE](LICENSE).
