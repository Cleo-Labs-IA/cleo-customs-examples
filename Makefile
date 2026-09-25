# make install                      install TypeScript + Python dependencies
# make install SDK_TARBALL=path.tgz  same, with a local @cleo-legal/sdk tarball
# make test                         run every example (needs CLEO_API_KEY), PASS/FAIL/SKIP per example
# make test-mock                    run every example on the local mock (no key, no network)

.PHONY: install test test-mock typecheck vector

install: python/.venv
ifdef SDK_TARBALL
	sh scripts/use-local-sdk.sh $(SDK_TARBALL)
else
	cd typescript && npm install
endif

python/.venv: python/requirements.txt
	python3 -m venv python/.venv
	python/.venv/bin/pip install -q -r python/requirements.txt
	touch python/.venv

test:
	node scripts/run-all.mjs

test-mock:
	node scripts/run-all.mjs --mock

typecheck:
	cd typescript && npx tsc --noEmit

vector:
	node webhook/make-vector.mjs
