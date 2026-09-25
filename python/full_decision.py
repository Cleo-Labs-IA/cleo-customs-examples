"""Pain: "Product + origin + destination + date. I need the local code, the
obligations, the duty and the landed cost, and what is still missing before I
show it to my broker."

POST /v2/compliance/check returns `data.decision`: one tariff code carried
through every step, a readiness (`ready_for_review` at best, never "cleared"),
the blockers, the state of each step and the limitations.

    CLEO_API_KEY=... python full_decision.py

persist:false, so nothing is stored. Cost: 5 units.
"""

import json
import re

from _shared import check, passed, post

READINESS = {"ready_for_review", "needs_information", "needs_review", "blocked"}
STEP_STATES = {"ok", "unavailable", "skipped", "not_requested"}

res = post("/v2/compliance/check", {
    "product": {
        "item_id": "SKU-TS-GB-1",
        "description": "Men's knitted cotton T-shirt, 100% cotton",
        "facts": {
            "process": "knitted",
            "composition": [{"material": "cotton", "percent": 100}],
            "audience": "men",
        },
    },
    "origin_country": "BD",
    "destination_country": "GB",
    "transaction": {"fob_usd": 12000, "freight_usd": 900, "quantity": 2000, "unit": "pcs", "transport_mode": "ocean"},
    "options": {"persist": False, "include_parallel_import": False},
})
body = res.json()
decision = (body.get("data") or {}).get("decision")

check(res.status_code == 200, f"expected HTTP 200, got {res.status_code}")
check(res.headers.get("X-Request-Id"), "the response carries no X-Request-Id header")
check(decision, "data.decision is missing: this deployment predates the composite decision")
check(decision["readiness"] in READINESS, f"unknown readiness {decision['readiness']}")
for step, state in decision["steps"].items():
    check(state in STEP_STATES, f"step {step} has unknown state {state}")
if decision["readiness"] == "ready_for_review":
    check(not decision["blockers"], "ready_for_review with blockers")
else:
    check(decision["blockers"], f"readiness {decision['readiness']} without any blocker")

persistence = decision["persistence"]
check(persistence["requested"] is False, "persistence.requested should be false")
check(persistence["status"] == "not_requested", f"persistence.status should be not_requested, got {persistence['status']}")
check(persistence["classification_id"] is None, "persist:false returned a classification_id")

code = decision["inputs"]["code"]
check(code, f"decision.inputs.code is null (code_status={decision['inputs']['code_status']})")
top = ((decision.get("classification") or {}).get("candidates") or [{}])[0].get("code")
check(top == code, f"classification top candidate {top} != inputs.code {code}")
if decision.get("duties"):
    check(decision["duties"]["code"] == code, f"duties ran on {decision['duties']['code']}, not {code}")
lc = decision.get("landed_cost")
if lc:
    def hs6(c):
        return re.sub(r"\D", "", c)[:6]
    check(hs6(lc["code"]) == hs6(code), f"landed cost ran on {lc['code']}, not {code}")
    gaps = lc["data_completeness"]["components_missing"] + lc["total_excludes"]
    check(not gaps or lc["total_is_partial"] is True, f"landed cost misses {gaps} but total_is_partial is false")
    check(not lc["total_is_partial"] or any(b["code"] == "landed_cost_partial" for b in decision["blockers"]),
          "landed cost is partial but no landed_cost_partial blocker was raised")
check(body.get("advisory_disclaimer"), "advisory_disclaimer is missing")

print(f"code: {code}, code_status: {decision['inputs']['code_status']}")
print(f"readiness: {decision['readiness']}")
for b in decision["blockers"]:
    print(f"- blocker {b['code']} [{b['step']} -> {b['readiness']}]: {b['message']}")
print(f"steps: {json.dumps(decision['steps'])}")
for limitation in decision["limitations"]:
    print(f"- limitation: {limitation}")
passed(f"decision readiness={decision['readiness']}, code {code} propagated to every step")
