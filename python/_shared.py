"""Shared helpers for the Python examples (REST with `requests` only).

- reads CLEO_API_KEY (and optional CLEO_BASE_URL) from the environment,
- records the HTTP status and X-Request-Id of every call,
- `check()` fails loudly: prints the reason and exits with code 1.
"""

import os
import sys

import requests

BASE_URL = os.environ.get("CLEO_BASE_URL", "https://api.legaldata.cleolabs.co").rstrip("/")
SKIP_EXIT_CODE = 3
CALLS = []


def print_evidence():
    for c in CALLS:
        print(f"[evidence] {c['method']} {c['path']} http={c['status']} "
              f"request_id={c['request_id'] or 'MISSING'} base={BASE_URL}")


def fail(message):
    print_evidence()
    print(f"FAIL: {message}", file=sys.stderr)
    sys.exit(1)


def check(condition, message):
    if not condition:
        fail(message)


def passed(message):
    print_evidence()
    print(f"PASS: {message}")


def api_key():
    key = os.environ.get("CLEO_API_KEY", "").strip()
    if not key:
        fail("CLEO_API_KEY is not set. Create a key at https://cleo-legal-public.vercel.app/signup, "
             "then `export CLEO_API_KEY=...`.")
    return key


def post(path, body, headers=None):
    """POST JSON with the API key; returns the `requests.Response` (never raises on 4xx/5xx)."""
    h = {"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json", "Accept": "application/json"}
    h.update(headers or {})
    try:
        res = requests.post(f"{BASE_URL}{path}", json=body, headers=h, timeout=120)
    except requests.RequestException as exc:
        fail(f"POST {path} failed before any response: {exc}")
    CALLS.append({"method": "POST", "path": path, "status": res.status_code,
                  "request_id": res.headers.get("X-Request-Id")})
    if res.status_code >= 400:
        try:
            err = res.json()
        except ValueError:
            err = {"raw": res.text[:300]}
        fail(f"POST {path} returned HTTP {res.status_code}: {err}")
    return res
