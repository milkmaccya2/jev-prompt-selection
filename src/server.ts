import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { buildWebData } from './buildWebData.js';
import type { Turn } from './data.js';
import { Budget, BudgetExceeded, buildState, estimateTokens, USD_PER_INPUT_TOKEN } from './jev.js';

const PORT = Number(process.env.PORT ?? 4319);
// Live calls from the UI share this cap for the lifetime of the server process.
const budget = new Budget(Number(process.env.WEB_BUDGET_USD ?? '0.05'));
const data = buildWebData();
const client = process.env.TYPESAFE_API_KEY ? new TypeSafeClient({ timeout: 30_000 }) : null;

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
      const { questions: _q, ...rest } = data;
      json(res, 200, { ...rest, live: Boolean(client), budget: { limitUsd: budget.limitUsd, spentUsd: budget.spentUsd } });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/select') {
      if (!client) return json(res, 400, { error: 'TYPESAFE_API_KEY が未設定です' });
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const { context = [], utterance = '', granularity = 'fine' } = JSON.parse(raw) as { context?: Turn[]; utterance?: string; granularity?: 'fine' | 'coarse' };
      if (!utterance.trim() || utterance.length > 300) return json(res, 400, { error: '発話を1〜300文字で入力してください' });
      const questions = data.questions[granularity === 'coarse' ? 'coarse' : 'fine'];
      const state = buildState(context.filter((t) => t.text?.trim()).slice(-4), utterance, 'ja');
      budget.reserve(estimateTokens(state, questions));
      const t0 = performance.now();
      const r = await client.systemOne({ model: data.model, state, questions });
      budget.record(r.usage.input_tokens);
      const a = r.answers.main as { choice: string; confidence: number; probabilities: Record<string, number> };
      json(res, 200, {
        result: { ok: true, model: r.model, chosen: a.choice, confidence: a.confidence, probs: a.probabilities, latencyMs: performance.now() - t0, inputTokens: r.usage.input_tokens, costUsd: r.usage.input_tokens * USD_PER_INPUT_TOKEN },
        budget: { limitUsd: budget.limitUsd, spentUsd: budget.spentUsd },
      });
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
