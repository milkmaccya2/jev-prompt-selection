import data from './data.json';

interface Env {
  TYPESAFE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  RATE_LIMITER?: RateLimit;
  ASSETS: Fetcher;
}

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

interface LiveResult {
  ok: boolean;
  model?: string;
  chosen: string | null;
  probs: Record<string, number>;
  confidence?: number;
  latencyMs: number;
  inputTokens: number;
  costUsd?: number;
  error?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** Same shape as src/jev.ts buildState (Japanese speaker labels). */
const buildState = (context: Turn[], utterance: string) => ({
  recent_turns: context.map((t) => ({ speaker: t.role === 'user' ? 'ユーザー' : 'アシスタント', text: t.text })),
  user_utterance: utterance,
});

const failed = (t0: number, error: string): LiveResult => ({ ok: false, chosen: null, probs: {}, latencyMs: Date.now() - t0, inputTokens: 0, error: error.slice(0, 200) });

async function callJev(env: Env, g: 'fine' | 'coarse', state: unknown): Promise<LiveResult> {
  const t0 = Date.now();
  if (!env.TYPESAFE_API_KEY) return failed(t0, 'TYPESAFE_API_KEY が未設定です');
  try {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: data.model, state, questions: data.questions[g] }),
      signal: AbortSignal.timeout(15_000),
    });
    const latencyMs = Date.now() - t0;
    // never echo request headers; status + short body only
    if (!res.ok) return { ...failed(t0, `HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`), latencyMs };
    const r = (await res.json()) as { model: string; answers: { main: { choice: string; confidence: number; probabilities: Record<string, number> } }; usage: { input_tokens: number } };
    const a = r.answers.main;
    return { ok: true, model: r.model, chosen: a.choice, probs: a.probabilities, confidence: a.confidence, latencyMs, inputTokens: r.usage.input_tokens, costUsd: r.usage.input_tokens * 0.042e-6 };
  } catch (e) {
    return failed(t0, String(e));
  }
}

/** OpenAI Decisions API (public beta): same instruction, descriptions and state as Jev (src/v3/decisions.ts). */
async function callDecisions(env: Env, g: 'fine' | 'coarse', state: unknown): Promise<LiveResult> {
  const t0 = Date.now();
  if (!env.OPENAI_API_KEY) return failed(t0, 'OPENAI_API_KEY が未設定です');
  try {
    const q = data.decisions[g];
    const res = await fetch('https://api.openai.com/v1/decisions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-6-luna', input: JSON.stringify(state), questions: [{ type: 'choice', name: 'main', instructions: q.instructions, choices: q.choices }] }),
      signal: AbortSignal.timeout(15_000),
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { ...failed(t0, `HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`), latencyMs };
    const r = (await res.json()) as {
      model: string;
      answers: { type: string; choice?: string; confidence?: number; probabilities?: { value: string; probability: number }[] }[];
      usage: { input_tokens: number };
    };
    const a = r.answers[0];
    if (!a || a.type !== 'choice') return { ...failed(t0, `choice の答えがありません(${a?.type ?? 'なし'})`), latencyMs };
    return {
      ok: true,
      model: r.model,
      chosen: String(a.choice),
      probs: Object.fromEntries((a.probabilities ?? []).map((p) => [String(p.value), p.probability])),
      confidence: a.confidence,
      latencyMs,
      inputTokens: r.usage.input_tokens,
      costUsd: r.usage.input_tokens * 0.1e-6,
    };
  } catch (e) {
    return failed(t0, String(e));
  }
}

async function select(req: Request, env: Env): Promise<Response> {
  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return json({ error: '呼び出しが多すぎます。1分ほど待ってからもう一度試してください' }, 429);
  }
  const body = (await req.json().catch(() => ({}))) as { context?: Turn[]; utterance?: string; granularity?: string };
  const g = body.granularity === 'coarse' ? 'coarse' : 'fine';
  const utterance = (body.utterance ?? '').trim();
  if (!utterance || utterance.length > 300) return json({ error: '発話を1〜300文字で入力してください' }, 400);
  const context = (body.context ?? [])
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string' && t.text.trim())
    .slice(-4)
    .map((t) => ({ role: t.role, text: t.text.slice(0, 500) }));
  const state = buildState(context, utterance);
  // both are called at the same time; each latency is measured from its own request
  const [jev, dec] = await Promise.all([callJev(env, g, state), callDecisions(env, g, state)]);
  return json({ result: jev, jev, dec });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/data' && req.method === 'GET') {
      const { questions: _q, decisions: _d, ...rest } = data;
      return json({ ...rest, live: Boolean(env.TYPESAFE_API_KEY), liveDecisions: Boolean(env.OPENAI_API_KEY), budget: null });
    }
    if (pathname === '/api/select' && req.method === 'POST') return select(req, env);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
