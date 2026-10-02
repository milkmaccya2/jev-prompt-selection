import { BASE, baseDescription } from '../jev.js';
import { loadParts, selectable } from '../parts.js';

export type Granularity = 'fine' | 'coarse';

/** 12 candidates: 11 topic prompts + base. Description = the same text every classifier sees. */
export function fineCandidates(): { id: string; description: string }[] {
  const parts = selectable(loadParts());
  return [
    ...parts.map((p) => ({ id: p.id, description: `${p.summary}。${p.use_when}` })),
    { id: BASE, description: baseDescription('ja') },
  ];
}

/** 6 coarse classes (the 5 requested + base). */
export const COARSE: { id: string; name: string; members: string[] }[] = [
  { id: 'consult', name: '相談', members: ['career_advice', 'search_conditions', 'query_normalization'] },
  { id: 'docs', name: '書類作成', members: ['application_docs'] },
  { id: 'info', name: '情報提供', members: ['company_info', 'reviews', 'salary_benefits'] },
  { id: 'howto', name: 'ハウツー', members: ['interview_prep', 'account_terms', 'error_handling'] },
  { id: 'out_of_scope', name: '範囲外', members: ['out_of_scope'] },
  { id: BASE, name: '基本', members: [BASE] },
];

export const toCoarse = (fineId: string): string => {
  const c = COARSE.find((x) => x.members.includes(fineId));
  if (!c) throw new Error(`no coarse class for ${fineId}`);
  return c.id;
};

/** Coarse descriptions are built from the member descriptions, so both granularities say the same things. */
export function coarseCandidates(): { id: string; description: string }[] {
  const fine = new Map(fineCandidates().map((c) => [c.id, c.description]));
  return COARSE.map((c) => ({
    id: c.id,
    description: `${c.name}: ${c.members.map((m) => fine.get(m)).join(' / ')}`,
  }));
}

export const candidatesFor = (g: Granularity) => (g === 'fine' ? fineCandidates() : coarseCandidates());
