// scripts/run-all.mjs
// Runs every example and prints PASS / FAIL / SKIP per example.
//
//   node scripts/run-all.mjs            # live: read-only and persist:false examples hit the API
//                                       # (needs CLEO_API_KEY); batch and human-review run on the mock
//   node scripts/run-all.mjs --mock     # everything on the local mock, no key, no network
//
// Target of each example:
//   live     the Cleo API (CLEO_BASE_URL or https://api.legaldata.cleolabs.co)
//   mock     mock/server.mjs, because the live call would create a job or store a record
//   offline  no network at all
// Exit code 1 if any example fails. A SKIP always prints its reason.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = process.argv.includes('--mock');
const SKIP_EXIT_CODE = 3;
const MOCK_KEY = 'mock-key-for-local-tests';

const python = existsSync(join(ROOT, 'python/.venv/bin/python')) ? join(ROOT, 'python/.venv/bin/python') : 'python3';
const tsx = join(ROOT, 'typescript/node_modules/.bin/tsx');

const EXAMPLES = [
  { name: 'curl/quickstart', target: 'live', cwd: ROOT, cmd: ['bash', 'curl/quickstart.sh'] },
  { name: 'typescript/needs-information', target: 'live', cwd: 'typescript', cmd: [tsx, 'src/needs-information.ts'] },
  { name: 'typescript/full-decision', target: 'live', cwd: 'typescript', cmd: [tsx, 'src/full-decision.ts'] },
  { name: 'typescript/batch', target: 'mock', cwd: 'typescript', cmd: [tsx, 'src/batch.ts'] },
  { name: 'typescript/human-review', target: 'mock', cwd: 'typescript', cmd: [tsx, 'src/human-review.ts'] },
  { name: 'typescript/human-review (endpoints absent)', target: 'mock-no-review', expect: 'skip', cwd: 'typescript', cmd: [tsx, 'src/human-review.ts'] },
  { name: 'typescript/human-review (availability probe)', target: 'live', cwd: 'typescript', cmd: [tsx, 'src/human-review.ts', '--probe-only'] },
  { name: 'typescript/webhook-verify', target: 'offline', cwd: 'typescript', cmd: [tsx, 'src/webhook-verify.ts'] },
  { name: 'python/needs_information', target: 'live', cwd: 'python', cmd: [python, 'needs_information.py'] },
  { name: 'python/full_decision', target: 'live', cwd: 'python', cmd: [python, 'full_decision.py'] },
  { name: 'python/webhook_verify', target: 'offline', cwd: 'python', cmd: [python, 'webhook_verify.py'] },
];

function startMock() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'mock/server.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.once('data', (buf) => resolve({ child, port: Number(String(buf).trim()) }));
    child.once('error', reject);
  });
}

function runOne(example, env) {
  return new Promise((resolve) => {
    const cwd = example.cwd.startsWith('/') ? example.cwd : join(ROOT, example.cwd);
    const child = spawn(example.cmd[0], example.cmd.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => resolve({ code: 1, out: `${out}\n${e.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

if (!existsSync(tsx)) {
  console.error('typescript/node_modules is missing: run `make install` (or `cd typescript && npm install`).');
  process.exit(1);
}
const liveKey = process.env.CLEO_API_KEY?.trim();
if (!MOCK && !liveKey) {
  console.error('CLEO_API_KEY is not set. Export a key for the live run, or run `make test-mock` (no key, no network).');
  process.exit(1);
}

const { child: mock, port } = await startMock();
const mockBase = `http://127.0.0.1:${port}`;
const results = [];
try {
  for (const ex of EXAMPLES) {
    const target = MOCK && ex.target === 'live' ? 'mock' : ex.target;
    const env = { ...process.env, CLEO_POLL_INTERVAL_MS: '50' };
    if (target === 'mock') Object.assign(env, { CLEO_BASE_URL: mockBase, CLEO_API_KEY: MOCK_KEY });
    else if (target === 'mock-no-review') Object.assign(env, { CLEO_BASE_URL: `${mockBase}/no-review`, CLEO_API_KEY: MOCK_KEY });
    else if (target === 'offline') { delete env.CLEO_API_KEY; delete env.CLEO_BASE_URL; }
    else delete env.CLEO_POLL_INTERVAL_MS;

    const { code, out } = await runOne(ex, env);
    let verdict = code === 0 ? 'PASS' : code === SKIP_EXIT_CODE ? 'SKIP' : 'FAIL';
    if (ex.expect === 'skip') verdict = code === SKIP_EXIT_CODE ? 'PASS' : 'FAIL';
    const reason = (out.match(/^(PASS|FAIL|SKIP): .*$/m) ?? [''])[0];
    const evidence = out.split('\n').filter((l) => l.startsWith('[evidence]'));
    results.push({ name: ex.name, target, verdict, reason, evidence });
    console.log(`${verdict.padEnd(4)}  ${ex.name}  [${target}]${reason ? `  ${reason}` : ''}`);
    for (const e of evidence) console.log(`        ${e}`);
    if (verdict === 'FAIL') console.log(out.split('\n').map((l) => `        | ${l}`).join('\n'));
  }
} finally {
  mock.kill();
}

const count = (v) => results.filter((r) => r.verdict === v).length;
console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('SKIP')} skipped (${results.length} examples${MOCK ? ', mock mode' : ''})`);
process.exit(count('FAIL') > 0 ? 1 : 0);
