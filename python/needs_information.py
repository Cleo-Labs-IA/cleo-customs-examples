"""Pain: "I only have a product title. Which facts do I still need before I can classify it?"

A bare "T-shirt" for the United States comes back `needs_information`, with the
questions to ask your supplier, instead of an invented code.

    CLEO_API_KEY=... python needs_information.py

Nothing is stored (persist defaults to false). Cost: 1 unit.
"""

from _shared import check, passed, post

res = post("/v2/customs/classifications", {
    "item_id": "SKU-TSHIRT-9",
    "description": "T-shirt",
    "country": "US",
})
body = res.json()
data = body.get("data", {})

check(res.status_code == 200, f"expected HTTP 200, got {res.status_code}")
check(res.headers.get("X-Request-Id"), "the response carries no X-Request-Id header")
check(data.get("status") == "needs_information", f"expected needs_information, got {data.get('status')}")
check(data.get("missing_attributes"), "needs_information must name at least one missing attribute")
check(data.get("questions"), "needs_information must come with at least one question")
asked = {q["fact"] for q in data["questions"]}
for attr in data["missing_attributes"]:
    check(attr in asked, f'missing attribute "{attr}" has no matching question')
check("classification_id" not in data, "persist was not requested, yet a classification_id came back")
check(body.get("advisory_disclaimer"), "advisory_disclaimer is missing")

print(f"status: {data['status']}")
for q in data["questions"]:
    print(f"- {q['fact']} ({q['discriminates']}): {q['question']}")
print("Next step: ask these questions, then send the answers in `facts` (see full_decision.py).")
passed(f"needs_information with {len(data['questions'])} question(s)")
