// Independent re-computation of results/v4/metrics.json from the raw run (no shared code with src/v4/report.ts).
// Writes results/v4/verify.txt and exits 1 on any mismatch.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'results/v4';
const metrics = JSON.parse(readFileSync(`${DIR}/metrics.json`, 'utf8'));
const run = JSON.parse(readFileSync(metrics.raw, 'utf8'));
const cases = readFileSync('data/eval.v3.test.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const cand = JSON.parse(readFileSync('data/candidates.v3.json', 'utf8'));
const coarseOf = (id) => cand.coarse.find((c) => c.members.includes(id)).id;
const pctl = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
const mcn = (b, c) => { const n = b + c; if (!n) return 1; let t = 0; for (let i = 0; i <= Math.min(b, c); i++) t += choose(n, i); return Math.min(1, (2 * t) / 2 ** n); };

const lines = [];
let bad = 0;
const check = (name, a, b, tol = 1e-9) => {
  const ok = typeof a === 'number' ? Math.abs(a - b) <= tol : JSON.stringify(a) === JSON.stringify(b);
  if (!ok) bad++;
  lines.push(`${ok ? 'OK ' : 'NG '} ${name}: raw=${JSON.stringify(a)} metrics=${JSON.stringify(b)}`);
};

check('run complete (100 cases, not stopped, hashes ok)', run.cases.length === 100 && !run.stoppedByBudget && run.frozen.before.ok && run.frozen.after.ok, true);
check('case ids match test order', run.cases.map((c) => c.id), cases.map((c) => c.id));
const scored = {};
for (const cfg of run.configs) {
  const g = cfg.granularity;
  const m = metrics.configs.find((x) => x.key === cfg.key);
  let k = 0, kl = 0, fail = 0, cost = 0;
  const lat = [];
  const s = [];
  run.cases.forEach((row, i) => {
    const r = row.results[cfg.key];
    const c = cases[i];
    const ans = g === 'fine' ? c.answer : coarseOf(c.answer);
    const okset = new Set([ans, ...c.acceptable.map((x) => (g === 'fine' ? x : coarseOf(x)))]);
    const ch = r.ok ? r.chosen : null;
    s.push(ch === ans);
    if (ch === ans) k++;
    if (ch && okset.has(ch)) kl++;
    if (!r.ok) fail++; else lat.push(r.latencyMs);
    cost += r.costUsd;
  });
  scored[cfg.key] = s;
  check(`${cfg.key} correct`, k, m.correct);
  check(`${cfg.key} correctLenient`, kl, m.correctLenient);
  check(`${cfg.key} failures`, fail, m.failures);
  check(`${cfg.key} p50`, pctl(lat, 0.5), m.latencyMs.p50);
  check(`${cfg.key} p95`, pctl(lat, 0.95), m.latencyMs.p95);
  check(`${cfg.key} usdPer1000`, (cost / 100) * 1000, m.usdPer1000, 1e-12);
  // cost from tokens x official price (re-derived, not from costUsd)
  const P = { jev: [0.042, 0, 0, 0], dec: [0.1, 0, 0, 0], luna: [0.1, 0.01, 0.125, 0.5], nano: [0.2, 0.02, 0.2, 1.25] }[cfg.classifier];
  const cost2 = run.cases.reduce((t, row) => {
    const u = row.results[cfg.key].usage;
    return t + ((u.input - u.cachedInput - u.cacheWrite) * P[0] + u.cachedInput * P[1] + u.cacheWrite * P[2] + u.output * P[3]) / 1e6;
  }, 0);
  check(`${cfg.key} usdPer1000 from tokens x price`, (cost2 / 100) * 1000, m.usdPer1000, 1e-9);
}
for (const g of ['fine', 'coarse']) {
  const fam = metrics.mcnemar[g];
  const ps = [];
  for (const r of fam) {
    const A = scored[`${r.a}@${g}`];
    const B = scored[`${r.b}@${g}`];
    const b = A.filter((x, i) => x && !B[i]).length;
    const c = A.filter((x, i) => !x && B[i]).length;
    check(`mcnemar ${g} ${r.a}-${r.b} b,c`, [b, c], [r.b_, r.c_]);
    check(`mcnemar ${g} ${r.a}-${r.b} p`, mcn(b, c), r.p, 1e-12);
    ps.push(mcn(b, c));
  }
  const order = ps.map((p, i) => [p, i]).sort((x, y) => x[0] - y[0]);
  let run_ = 0;
  const adj = [];
  order.forEach(([p, i], rank) => { run_ = Math.max(run_, Math.min(1, (ps.length - rank) * p)); adj[i] = run_; });
  fam.forEach((r, i) => check(`holm ${g} ${r.a}-${r.b}`, adj[i], r.holm, 1e-12));
}
// summary/slide table numbers come from metrics: check the slide table rows
const slide = readFileSync(`${DIR}/slide-table.md`, 'utf8');
for (const m of metrics.configs.filter((x) => x.granularity === 'fine')) {
  const row = slide.split('\n').find((l) => l.startsWith(`| ${m.label} |`)) ?? '';
  check(`slide-table ${m.key} accuracy`, row.includes(`| ${m.correct}% [`), true);
  check(`slide-table ${m.key} cost`, row.includes(`$${m.usdPer1000.toFixed(3)}`), true);
}
const summary = readFileSync(`${DIR}/summary.md`, 'utf8');
check('summary contains slide table', summary.includes(slide.split('\n').slice(1).join('\n').trim()), true);

lines.unshift(`verify: ${new Date().toISOString()} raw=${metrics.raw} checks=${lines.length} mismatches=${bad}`);
writeFileSync(`${DIR}/verify.txt`, `${lines.join('\n')}\n`);
console.log(lines[0]);
process.exit(bad ? 1 : 0);
