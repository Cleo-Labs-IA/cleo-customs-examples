# Contributing and reporting bugs

## Report a bug

Open a GitHub issue in this repository ("Bug report" template). Include:

1. the example (for example `typescript/full-decision`) and the command you ran;
2. the full output, including the `[evidence]` line with `http=` and `request_id=`;
3. your OS, and `node -v` or `python3 --version`.

The `request_id` (also in the `X-Request-Id` response header and in every JSON error) lets Cleo find the exact call. Never paste your API key, a webhook `whsec_` secret or private product data: the examples never print them, so the output is safe to share as is.

If the problem is in the API answer rather than in an example (a wrong status, a missing field), say so in the issue title; you can also write to hello@cleolabs.co.

## Change an example

- Keep each example runnable on its own with `CLEO_API_KEY` from the environment.
- Keep a loud assertion: an example that prints a result without checking it is not accepted.
- An example that creates or stores anything on the live API runs on the mock in `make test`; add the route to `mock/server.mjs`, following the public OpenAPI (`https://api.legaldata.cleolabs.co/v2/openapi.json`).
- Run `make test-mock` and `make typecheck` before opening a pull request, and `make test` if you have a key.
