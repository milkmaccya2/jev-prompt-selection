/**
 * v3 candidate descriptions. Single source: data/candidates.v3.json (frozen after review).
 * Unlike v2, these are NOT read from the prompt parts' frontmatter, so v2 stays reproducible.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type Granularity = 'fine' | 'coarse';
interface FineDef { id: string; scope: string; boundary: string }
interface CoarseDef { id: string; name: string; members: string[]; boundary: string }
interface File { instruction: string; fine: FineDef[]; coarse: CoarseDef[] }

const PATH = new URL('../../data/candidates.v3.json', import.meta.url);
const file = (): File => JSON.parse(readFileSync(PATH, 'utf8'));

export const instruction = () => file().instruction;

const join = (scope: string, boundary: string) => (boundary ? `${scope}。${boundary}` : scope);

export function fineCandidates(): { id: string; description: string }[] {
  return file().fine.map((c) => ({ id: c.id, description: join(c.scope, c.boundary) }));
}

/** Coarse descriptions are rebuilt from the members' scopes (fine-level boundaries refer to fine ids, so they are left out). */
export function coarseCandidates(): { id: string; description: string }[] {
  const f = file();
  const scope = new Map(f.fine.map((c) => [c.id, c.scope]));
  return f.coarse.map((c) => ({ id: c.id, description: join(`${c.name}: ${c.members.map((m) => scope.get(m)).join(' / ')}`, c.boundary) }));
}

export const candidatesFor = (g: Granularity) => (g === 'fine' ? fineCandidates() : coarseCandidates());
export const coarseDefs = () => file().coarse;
export const toCoarse = (fineId: string) => {
  const c = file().coarse.find((x) => x.members.includes(fineId));
  if (!c) throw new Error(`no coarse class for ${fineId}`);
  return c.id;
};

/** Hash of exactly what classifiers see (instruction + both candidate lists), for FROZEN.md. */
export function descriptionsHash(): string {
  const payload = JSON.stringify({ instruction: instruction(), fine: fineCandidates(), coarse: coarseCandidates() });
  return createHash('sha256').update(payload).digest('hex');
}
