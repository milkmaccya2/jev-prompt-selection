import data from './data.json';

interface Env {
  TYPESAFE_API_KEY?: string;
  ASSETS: Fetcher;
}

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** Same shape as src/jev.ts buildState (Japanese speaker labels). */
const buildState = (context: Turn[], utterance: string) => ({
  recent_turns: context.map((t) => ({ speaker: t.role === 'user' ? 'ユーザー' : 'アシスタント', text: t.text })),
  user_utterance: utterance,
});

async function select(req: Request, env: Env): Promise<Response> {
  if (!env.TYPESAFE_API_KEY) return json({ error: 'TYPESAFE_API_KEY が未設定です' }, 400);
  const body = (await req.json().catch(() => ({}))) as { context?: Turn[]; utterance?: string; granularity?: string };
  const questions = data.questions[body.granularity === 'coarse' ? 'coarse' : 'fine'];
  const utterance = (body.utterance ?? '').trim();
  if (!utterance || utterance.length > 300) return json({ error: '発話を1〜300文字で入力してください' }, 400);
  const context = (body.context ?? [])
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string' && t.text.trim())
    .slice(-4)
    .map((t) => ({ role: t.role, text: t.text.slice(0, 500) }));

  const t0 = Date.now();
  try {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: data.model, state: buildState(context, utterance), questions }),
      signal: AbortSignal.timeout(15_000),
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      // never echo request headers; status + short body only
      const detail = (await res.text()).slice(0, 200);
      return json({ result: { ok: false, chosen: null, probs: {}, latencyMs, inputTokens: 0, error: `HTTP ${res.status}: ${detail}` } });
    }
    const r = (await res.json()) as {
      model: string;
      answers: { main: { choice: string; confidence: number; probabilities: Record<string, number> } };
      usage: { input_tokens: number };
    };
    const a = r.answers.main;
    return json({
      result: {
        ok: true,
        model: r.model,
        probs: a.probabilities,
        chosen: a.choice,
        confidence: a.confidence,
        latencyMs,
        inputTokens: r.usage.input_tokens,
        costUsd: r.usage.input_tokens * 0.042e-6,
      },
    });
  } catch (e) {
    return json({ result: { ok: false, chosen: null, probs: {}, latencyMs: Date.now() - t0, inputTokens: 0, error: String(e).slice(0, 200) } });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/data' && req.method === 'GET') {
      const { questions: _q, ...rest } = data;
      return json({ ...rest, live: Boolean(env.TYPESAFE_API_KEY), budget: null });
    }
    if (pathname === '/api/select' && req.method === 'POST') return select(req, env);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
