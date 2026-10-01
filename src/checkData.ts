import { loadEval } from './data.js';
import { BASE } from './jev.js';
import { loadParts, selectable } from './parts.js';

const ids = new Set([...selectable(loadParts()).map((p) => p.id), BASE]);
const cases = loadEval();
const errors: string[] = [];
const seen = new Set<string>();
const perAnswer = new Map([...ids].map((id) => [id, 0]));
const perTag = new Map<string, number>();

for (const c of cases) {
  if (seen.has(c.id)) errors.push(`${c.id}: duplicate id`);
  seen.add(c.id);
  if (!ids.has(c.answer)) errors.push(`${c.id}: unknown answer ${c.answer}`);
  else perAnswer.set(c.answer, (perAnswer.get(c.answer) ?? 0) + 1);
  for (const a of c.acceptable) {
    if (!ids.has(a)) errors.push(`${c.id}: unknown acceptable ${a}`);
    if (a === c.answer) errors.push(`${c.id}: acceptable repeats answer`);
  }
  if (c.context.length > 4) errors.push(`${c.id}: context longer than 2 exchanges`);
  for (const t of c.tags) perTag.set(t, (perTag.get(t) ?? 0) + 1);
}

console.log(`cases=${cases.length}  with acceptable alternatives=${cases.filter((c) => c.acceptable.length).length}`);
console.log('per answer:', Object.fromEntries([...perAnswer].sort((a, b) => b[1] - a[1])));
console.log('per tag:', Object.fromEntries([...perTag].sort((a, b) => b[1] - a[1])));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
