"""Verify Cleo webhook signatures (V1 and V2) with the standard library.

    key                 = hex(SHA-256(whsec_ secret)), used as a UTF-8 string
    X-Cleo-Signature    = "sha256=" + hex(HMAC-SHA256(key, raw body))              (V1)
    X-Cleo-Signature-V2 = "t=<ts>,v1=" + hex(HMAC-SHA256(key, "<ts>.<raw body>"))  (V2)

Verify V2 when you can (reject a timestamp more than 300 s away from your
clock), always on the RAW body bytes, and deduplicate on X-Cleo-Event-Id.

    python webhook_verify.py      # local only: no API key, no network
"""

import hashlib
import hmac
import json
import os
import secrets
import time

from _shared import check, passed

TOLERANCE_SECONDS = 300


def signing_key(secret):
    return hashlib.sha256(secret.encode("utf-8")).hexdigest().encode("utf-8")


def verify_v1(raw_body, header, secret):
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(signing_key(secret), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[len("sha256="):].lower())


def verify_v2(raw_body, header, secret, now=None, tolerance=TOLERANCE_SECONDS):
    try:
        parts = dict(p.split("=", 1) for p in (header or "").split(","))
        ts = int(parts["t"])
        received = parts["v1"].lower()
    except (ValueError, KeyError):
        return False
    now = int(time.time()) if now is None else now
    if abs(now - ts) > tolerance:
        return False
    expected = hmac.new(signing_key(secret), f"{ts}.".encode("utf-8") + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received)


def sign(raw_body, secret, ts):
    key = signing_key(secret)
    return {
        "X-Cleo-Signature": "sha256=" + hmac.new(key, raw_body, hashlib.sha256).hexdigest(),
        "X-Cleo-Timestamp": str(ts),
        "X-Cleo-Signature-V2": f"t={ts},v1=" + hmac.new(key, f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest(),
    }


here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "..", "webhook", "test-vector.json"), encoding="utf-8") as f:
    vector = json.load(f)

body = vector["body"].encode("utf-8")
headers = vector["headers"]
secret = vector["secret"]
now = vector["timestamp"] + 10

check(verify_v1(body, headers["X-Cleo-Signature"], secret), "committed vector: V1 rejected")
check(verify_v2(body, headers["X-Cleo-Signature-V2"], secret, now=now), "committed vector: V2 rejected")
check(json.loads(body)["id"] == headers["X-Cleo-Event-Id"], "event id in body != X-Cleo-Event-Id")
print("committed vector: V1 ok, V2 ok")

fresh_secret = "whsec_" + secrets.token_hex(32)
fresh_ts = int(time.time())
fresh_headers = sign(body, fresh_secret, fresh_ts)
check(verify_v1(body, fresh_headers["X-Cleo-Signature"], fresh_secret), "fresh vector: V1 rejected")
check(verify_v2(body, fresh_headers["X-Cleo-Signature-V2"], fresh_secret), "fresh vector: V2 rejected")
print("fresh vector: V1 ok, V2 ok")

tampered = body.replace(b'"done_items":3', b'"done_items":2')
check(not verify_v1(tampered, headers["X-Cleo-Signature"], secret), "tampered body accepted by V1")
check(not verify_v2(tampered, headers["X-Cleo-Signature-V2"], secret, now=now), "tampered body accepted by V2")
check(not verify_v1(body, headers["X-Cleo-Signature"], secret + "x"), "wrong secret accepted")
raw_key_sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
check(not verify_v1(body, raw_key_sig, secret), "a signature keyed by the raw secret was accepted")
check(not verify_v2(body, headers["X-Cleo-Signature-V2"], secret, now=vector["timestamp"] + 301),
      "a delivery 301 s old was accepted by V2")
print("negative controls: tampered body (V1, V2), wrong secret, raw-secret key, stale timestamp -> all rejected")
passed("webhook V1 + V2 verified on the committed and a fresh vector; 5 negative controls rejected")
