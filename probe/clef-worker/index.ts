/**
 * Temporary probe: one env.AI.run call per request, timed inside the Worker.
 * Latency = Date.now() just before env.AI.run until it resolves (Workers clocks advance on I/O).
 * No retries; 30 s timeout. Requests without the PROBE_KEY header are refused.
 */
interface Env {
  AI: Ai;
  PROBE_KEY: string;
}
const MODELS: Record<string, string> = { clef: '@cf/cloudflare/clef', 'clef-flash': '@cf/cloudflare/clef-flash' };
const TIMEOUT_MS = 30_000;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST' || !env.PROBE_KEY || req.headers.get('x-probe-key') !== env.PROBE_KEY) return new Response('not found', { status: 404 });
    const body = (await req.json()) as { model: string; state: unknown; questions: unknown };
    const path = MODELS[body.model];
    if (!path) return Response.json({ error: 'unknown model' }, { status: 400 });
    const colo = (req.cf as { colo?: string } | undefined)?.colo ?? null;
    const t0 = Date.now();
    try {
      const result = await Promise.race([
        // biome-ignore lint: Clef is not in the generated model types yet
        (env.AI as any).run(path, body),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
      ]);
      return Response.json({ ok: true, workerLatencyMs: Date.now() - t0, colo, result });
    } catch (e) {
      return Response.json({ ok: false, workerLatencyMs: Date.now() - t0, colo, error: String(e).slice(0, 300) });
    }
  },
} satisfies ExportedHandler<Env>;
