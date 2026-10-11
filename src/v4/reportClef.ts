/**
 * v4 appendix report: Clef / Clef-flash (plan: results/v4/appendix-clef/PLAN.md).
 * Reads the latest complete run-test-*.json in results/v4/appendix-clef/raw. 12 candidates only.
 * The v4 rows (2026-10-09) are read from results/v4/metrics.json and its raw run, unchanged.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEval } from '../data.js';
import type { ClassifyResult } from '../v3/classifiers.js';
import { mcnemarExact, percentile, wilson } from '../v3/stats.js';

const DIR = 'results/v4/appendix-clef';
type Call = ClassifyResult & { pos: number; at: string };
interface Run {
  startedAt: string;
  finishedAt: string;
  set: string;
  data: string;
  smoke: boolean;
  seed: number;
  spentUsd: number;
  stoppedByBudget: boolean;
  frozen: { before: { ok: boolean }; after: { ok: boolean } };
  configs: { key: string; label: string; path: string; model: string; priceInput: number }[];
  warmupCases: unknown[];
  cases: { id: string; order: string[]; results: Record<string, Call> }[];
}

const files = readdirSync(`${DIR}/raw`);
const rawFile = files.filter((f) => f.startsWith('run-test-')).sort().at(-1);
if (!rawFile) throw new Error('no run-test-*.json');
const rawPath = `${DIR}/raw/${rawFile}`;
const run = JSON.parse(readFileSync(rawPath, 'utf8')) as Run;
const cases = loadEval(new URL(`../../${run.data}`, import.meta.url));
if (run.smoke || run.set !== 'test') throw new Error('not a test run');
if (run.stoppedByBudget) throw new Error('run stopped by budget');
if (!run.frozen.before.ok || !run.frozen.after.ok) throw new Error('frozen inputs changed');
if (run.cases.length !== cases.length || run.cases.some((r, i) => r.id !== cases[i].id)) throw new Error('run does not cover all test cases in order');
for (const r of run.cases) for (const c of run.configs) if (!r.results[c.key]) throw new Error(`missing ${c.key} for ${r.id}`);
const smokeFile = files.filter((f) => f.startsWith('smoke-')).sort().at(-1);
const smoke = smokeFile ? (JSON.parse(readFileSync(`${DIR}/raw/${smokeFile}`, 'utf8')) as Run) : null;

// v4 (2026-10-09): metrics as published, and the raw run for the per-case choices
const v4 = JSON.parse(readFileSync('results/v4/metrics.json', 'utf8')) as {
  raw: string;
  startedAt: string;
  configs: { key: string; label: string; granularity: string; models: Record<string, number>; correct: number; correctCI: [number, number]; correctLenient: number; failures: number; latencyMs: { p50: number; p95: number }; usdPer1000: number; tokensPerCall: { input: number; output: number } }[];
};
const v4run = JSON.parse(readFileSync(v4.raw, 'utf8')) as { cases: { id: string; results: Record<string, Call> }[] };

const LABEL: Record<string, string> = {
  search_conditions: '検索条件', query_normalization: '地名・職種の言い換え', company_info: '企業情報', reviews: 'クチコミ',
  salary_benefits: '給与・待遇', career_advice: 'キャリア相談', application_docs: '応募書類', interview_prep: '面接対策',
  account_terms: 'ログイン・規約', error_handling: 'エラー時', out_of_scope: '範囲外', base: '基本',
};
const lab = (id: string | null) => (id ? (LABEL[id] ?? id) : '(失敗)');
const N = cases.length;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ciText = (k: number, n = N) => {
  const [lo, hi] = wilson(k, n);
  return `${pct(k / n)} [${Math.round(lo * 100)}–${Math.round(hi * 100)}%]`;
};
const sec = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(2)}s`);
const usd = (x: number) => `$${x.toFixed(3)}`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const jst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

const BINS: [string, number, number][] = [['0.5未満', 0, 0.5], ['0.5〜0.7', 0.5, 0.7], ['0.7〜0.9', 0.7, 0.9], ['0.9以上', 0.9, 1.01]];

const ms = run.configs.map((cfg) => {
  const strict: boolean[] = [];
  const lenient: boolean[] = [];
  const conf: (number | null)[] = [];
  const probChosen: (number | null)[] = [];
  const lat: number[] = [];
  const models = new Map<string, number>();
  let failed = 0;
  let cost = 0;
  const tokIn: number[] = [];
  const tokOut: number[] = [];
  const errors: string[] = [];
  run.cases.forEach((row, i) => {
    const r = row.results[cfg.key];
    const c = cases[i];
    const ch = r.ok ? r.chosen : null;
    strict.push(ch === c.answer);
    lenient.push(ch !== null && (ch === c.answer || c.acceptable.includes(ch)));
    conf.push(r.ok ? r.confidence : null);
    probChosen.push(r.ok && ch && r.probs ? (r.probs[ch] ?? null) : null);
    if (r.ok) lat.push(r.latencyMs);
    else {
      failed++;
      errors.push(`${row.id}: ${r.error}`);
    }
    if (r.model) models.set(r.model, (models.get(r.model) ?? 0) + 1);
    cost += r.costUsd;
    tokIn.push(r.usage.input);
    tokOut.push(r.usage.output);
  });
  const bins = (vals: (number | null)[]) =>
    BINS.map(([label, lo, hi]) => {
      const idx = vals.map((v, i) => [v, i] as const).filter(([v]) => v !== null && v >= lo && v < hi);
      return { label, n: idx.length, correct: idx.filter(([, i]) => strict[i]).length };
    });
  return {
    cfg,
    strict,
    lenient,
    conf,
    failed,
    errors,
    models,
    lat,
    cost,
    tokIn,
    tokOut,
    confBins: bins(conf),
    probBins: bins(probChosen),
    hasConf: conf.some((v) => v !== null),
  };
});
const cnt = (xs: boolean[]) => xs.filter(Boolean).length;
const p50 = (m: (typeof ms)[number]) => percentile(m.lat, 0.5);
const p95 = (m: (typeof ms)[number]) => percentile(m.lat, 0.95);
const modelText = (m: Map<string, number>) => [...m].map(([k, v]) => `\`${k}\`${m.size > 1 ? `×${v}` : ''}`).join(' ');
const [A, B] = ms;
const b = A.strict.filter((x, i) => x && !B.strict[i]).length;
const c = A.strict.filter((x, i) => !x && B.strict[i]).length;
const pClef = mcnemarExact(b, c);

const v4fine = v4.configs.filter((x) => x.granularity === 'fine');
const v4Choice = (key: string, id: string) => {
  const r = v4run.cases.find((x) => x.id === id)?.results[`${key}@fine`];
  return r ? `${lab(r.ok ? r.chosen : null)}${r.confidence != null ? `(${r.confidence.toFixed(2)})` : ''}` : '-';
};

// misclassified: every case where either Clef model is not an exact match
const missIdx = cases.map((_, i) => i).filter((i) => ms.some((m) => !m.strict[i]));
const cell = (m: (typeof ms)[number], i: number) => {
  const r = run.cases[i].results[m.cfg.key];
  const mark = m.strict[i] ? '✓' : m.lenient[i] ? '△' : '✗';
  return `${mark} ${lab(r.ok ? r.chosen : null)}${r.confidence != null ? `(${r.confidence.toFixed(2)})` : ''}`;
};
const missRows = missIdx.map((i) => {
  const cs = cases[i];
  const ctx = cs.context.length ? ` ※直前の会話あり(${cs.context.length}発話)` : '';
  return `| ${cs.id} | ${cs.utterance}${ctx} | ${lab(cs.answer)}${cs.acceptable.length ? `(別解: ${cs.acceptable.map(lab).join('、')})` : ''} | ${ms.map((m) => cell(m, i)).join(' | ')} | ${v4Choice('jev', cs.id)} | ${v4Choice('dec', cs.id)} |`;
});

const jevTok = v4fine.find((x) => x.key === 'jev@fine')?.tokensPerCall.input ?? 0;
const smokeLine = smoke
  ? `動作確認(${smokeFile}): dev 先頭${smoke.cases.length}件 + ウォームアップ3発話、失敗 ${smoke.cases.flatMap((r) => Object.values(r.results)).filter((x) => !x.ok).length} 件、費用 ≈ ${usd(smoke.spentUsd)}。集計には使っていません。`
  : '動作確認の記録なし';

const combinedRows = [
  ...v4fine.map(
    (x) =>
      `| ${x.label} | v4 本編 ${jst(v4.startedAt)} | ${ciText(x.correct)} | ${pct(x.correctLenient / N)} | ${x.failures} | ${sec(x.latencyMs.p50)} / ${sec(x.latencyMs.p95)} | ${Math.round(x.tokensPerCall.input)} | ${usd(x.usdPer1000)} |`
  ),
  ...ms.map(
    (m) =>
      `| **${m.cfg.label}** | **この補足 ${jst(run.startedAt)}** | ${ciText(cnt(m.strict))} | ${pct(cnt(m.lenient) / N)} | ${m.failed} | ${sec(p50(m))} / ${sec(p95(m))} | ${Math.round(mean(m.tokIn))} | ${usd((m.cost / N) * 1000)} |`
  ),
];

const md = `# v4 補足: Cloudflare Clef / Clef-flash(test 100件・12候補)

- 計画: [PLAN.md](PLAN.md)(測定前に保存)、単価: [PRICING.md](PRICING.md)(2026-10-11 確認)
- 生データ: \`${rawPath}\`(呼び出しごとの生レスポンスつき)
- 測定: ${jst(run.startedAt)}〜${jst(run.finishedAt)} JST、1台の端末から1件ずつ、種 ${run.seed} で各件の呼び出し順を並べ替え、再試行なし、タイムアウト30秒、ウォームアップ3発話(採点しない)
- 入力: Jev に送ったのと同じ System One 形式の本文(\`state\`・choice の質問・候補の説明文)。違うのは \`model\` と送り先だけ。凍結ハッシュは実行の前後とも一致
- ${smokeLine}
- **test 100件は、v3 で凍結し、すでに結果を見たことのあるデータの再利用です。**

## 結果(12候補)

| 構成 | 返ってきたモデル名 | 完全一致 [95%CI] | 別解込み [95%CI] | 失敗 | 判定時間 p50 / p95 | 入力トークン / 回 | 1000回あたり |
|---|---|---|---|---:|---|---:|---:|
${ms.map((m) => `| ${m.cfg.label}(\`${m.cfg.path}\`) | ${modelText(m.models)} | ${ciText(cnt(m.strict))} | ${ciText(cnt(m.lenient))} | ${m.failed} | ${sec(p50(m))} / ${sec(p95(m))} | ${Math.round(mean(m.tokIn))} | ${usd((m.cost / N) * 1000)} |`).join('\n')}

- 費用 = API が返した入力トークン × 公式単価(Clef $0.240 / 1M、Clef-flash $0.038 / 1M、出力は課金なし。2026-10-11 確認)。出力トークンは${ms.every((m) => m.tokOut.every((x) => x === 0)) ? 'どちらも全件 0 と返ってきた' : `平均 ${ms.map((m) => `${m.cfg.label} ${mean(m.tokOut).toFixed(1)}`).join('、')}`}。
- Workers AI は1日1万 Neurons まで無料枠があり、この測定の実際の請求はその中に収まる見込みです。表の費用は無料枠を使わない場合の単価での値です。
- この実行の費用(ウォームアップ込み): ≈ ${usd(run.spentUsd)}。動作確認と合わせて ≈ ${usd(run.spentUsd + (smoke?.spentUsd ?? 0))}。
- 返ってきたモデル名は \`clef\` / \`clef-flash\` で、日付やバージョンの入った名前ではありませんでした。
- 参考: 同じ実行の中の Clef 対 Clef-flash(12候補・完全一致、McNemar 正確検定・両側): Clef だけ正解 ${b} 件、Clef-flash だけ正解 ${c} 件、p = ${pClef.toFixed(3)}。${pClef < 0.05 ? '' : 'この100件では差があるとは言えません。'}事前に決めた比較群ではないので、補正なしの参考値です。

## v4 の4構成と並べた表(参考、測定日時が異なる)

**v4 の4構成は 2026-10-09、Clef の2構成は 2026-10-11 に、別々の実行で測りました。** 同じ実行の中での比較ではないので、判定時間は時間帯やネットワークの違いを含みます。v4 との検定はしていません。

| 構成 | 測定 | 完全一致 [95%CI] | 別解込み | 失敗 | 判定時間 p50 / p95 | 入力トークン / 回 | 1000回あたり |
|---|---|---|---|---:|---|---:|---:|
${combinedRows.join('\n')}

- 入力トークンはモデルごとのトークナイザーで数えた値です。Clef と Jev は同じ本文を受け取っていますが、Clef は約 ${Math.round(mean(A.tokIn))}、Jev は約 ${Math.round(jevTok)} と返しました。
- v4 の Chat(luna)の費用はキャッシュが効いた実績です(キャッシュなしの試算は v4 の summary を参照)。

## 確信度(confidence)

${ms
  .map(
    (m) =>
      `### ${m.cfg.label}\n\n${m.hasConf ? '' : 'confidence は返ってきませんでした。\n\n'}| confidence の区間 | 件数 | 答えと一致 | 一致率 |\n|---|---:|---:|---:|\n${m.confBins.map((x) => `| ${x.label} | ${x.n} | ${x.correct} | ${x.n ? pct(x.correct / x.n) : '-'} |`).join('\n')}\n\n参考(confidence とは別の値): 選んだ候補の probability の区間 — ${m.probBins.map((x) => `${x.label} ${x.correct}/${x.n}`).join('、')}`
  )
  .join('\n\n')}

- confidence と probability は、どちらも正解の確率として校正されたものとは扱っていません。区間ごとの件数が少ないので、この test 100件・12候補での観測です。

## 誤答の例(Clef / Clef-flash のどちらかが完全一致しなかった全 ${missIdx.length} 件)

✓ = 完全一致、△ = 別解と一致、✗ = 不一致。括弧内は confidence。右の2列は同じ id の v4(2026-10-09)の結果で、参考です。

| id | 発話 | 正解 | Clef | Clef-flash | v4 Jev | v4 Decisions |
|---|---|---|---|---|---|---|
${missRows.join('\n')}
${ms.some((m) => m.errors.length) ? `\n## 失敗した呼び出し\n\n${ms.flatMap((m) => m.errors.map((e) => `- ${m.cfg.label} ${e}`)).join('\n')}\n` : ''}
## 比較上の注意

- 測定日が v4 本編と違い(2026-10-09 と 2026-10-11)、同じ実行の中の比較ではありません。正解率の差も、判定時間の差も、その前提で読む必要があります。
- 判定時間は、日本の端末から \`api.cloudflare.com\` の REST を呼んだ往復の時間です。Cloudflare が公表している速さ(Clef-flash 約 39ms など)は測り方が違い、この表とは比べられません。Worker から \`env.AI\` で呼ぶ場合の時間も測っていません。
- test 100件は既に結果を見たことのあるデータです。95% 区間は広く、数件の差は区別できません。
- 12候補だけで、6分類は測っていません。

## 再実行

\`\`\`sh
npx tsx src/v4/evalClef.ts --set test --dry-run
CLOUDFLARE_ACCOUNT_ID=<id> npx tsx src/v4/evalClef.ts --set dev --limit 5 --smoke --budget-usd 0.05
CLOUDFLARE_ACCOUNT_ID=<id> npx tsx src/v4/evalClef.ts --set test --budget-usd 0.20
npx tsx src/v4/reportClef.ts
\`\`\`

トークンは \`CLOUDFLARE_API_TOKEN\`(Workers AI の権限)か、ログイン済みの wrangler から読みます。
`;

const metrics = {
  raw: rawPath,
  plan: `${DIR}/PLAN.md`,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  seed: run.seed,
  spentUsd: run.spentUsd,
  smokeSpentUsd: smoke?.spentUsd ?? null,
  configs: ms.map((m) => ({
    key: m.cfg.key,
    label: m.cfg.label,
    path: m.cfg.path,
    models: Object.fromEntries(m.models),
    n: N,
    correct: cnt(m.strict),
    correctCI: wilson(cnt(m.strict), N),
    correctLenient: cnt(m.lenient),
    correctLenientCI: wilson(cnt(m.lenient), N),
    failures: m.failed,
    latencyMs: { p50: p50(m), p95: p95(m), n: m.lat.length },
    usdPer1000: (m.cost / N) * 1000,
    priceInputPerToken: m.cfg.priceInput,
    tokensPerCall: { input: mean(m.tokIn), output: mean(m.tokOut) },
    confidenceBins: m.confBins,
    chosenProbabilityBins: m.probBins,
  })),
  clefVsFlash: { b, c, p: pClef, note: 'reference only, uncorrected; same run' },
  v4Reference: { raw: v4.raw, startedAt: v4.startedAt },
};
writeFileSync(`${DIR}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
writeFileSync(`${DIR}/summary.md`, md);
console.log(md.split('## 確信度')[0]);
