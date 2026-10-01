import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Turn } from './data.js';
import { loadEval } from './data.js';
import { Budget, BudgetExceeded, CONFIGS, makeClient, runConfig } from './jev.js';
import { loadParts, selectable } from './parts.js';
import { FALLBACK, THRESHOLDS } from './select.js';

const PORT = Number(process.env.PORT ?? 4319);
// Live calls from the UI share this cap for the lifetime of the server process.
const budget = new Budget(Number(process.env.WEB_BUDGET_USD ?? '0.05'));
const parts = loadParts();
const sel = selectable(parts);
const client = process.env.TYPESAFE_API_KEY ? makeClient() : null;

function latestRun() {
  const files = readdirSync('results/raw').filter((f) => f.startsWith('run-')).sort();
  return files.length ? JSON.parse(readFileSync(`results/raw/${files.at(-1)}`, 'utf8')) : null;
}

const json = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync('web/index.html'));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/data') {
      json(res, 200, {
        parts: parts.map(({ body: _b, ...p }) => p),
        cases: loadEval(),
        run: latestRun(),
        thresholds: THRESHOLDS,
        fallback: FALLBACK,
        live: Boolean(client),
        budget: { limitUsd: budget.limitUsd, spentUsd: budget.spentUsd },
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/select') {
      if (!client) return json(res, 400, { error: 'TYPESAFE_API_KEY が未設定です' });
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const { context = [], utterance = '' } = JSON.parse(raw) as { context?: Turn[]; utterance?: string };
      if (!utterance.trim() || utterance.length > 1000) return json(res, 400, { error: '発話を1〜1000文字で入力してください' });
      const ctx = context.filter((t) => t.text?.trim()).slice(-4);
      const entries = await Promise.all(
        CONFIGS.map(async (cfg) => [cfg, await runConfig(client, budget, cfg, sel, ctx, utterance)] as const)
      );
      json(res, 200, { results: Object.fromEntries(entries), budget: { limitUsd: budget.limitUsd, spentUsd: budget.spentUsd } });
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (e instanceof BudgetExceeded) return json(res, 402, { error: `費用の上限に達しました: ${e.message}` });
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`http://localhost:${PORT}  (live Jev: ${client ? 'on' : 'off'}, budget $${budget.limitUsd})`);
});
