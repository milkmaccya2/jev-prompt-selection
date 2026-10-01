import { loadEval } from './data.js';
import { loadParts, selectable } from './parts.js';

const ids = new Set(selectable(loadParts()).map((p) => p.id));
const cases = loadEval();
const errors: string[] = [];
const seen = new Set<string>();
const perPart = new Map([...ids].map((id) => [id, 0]));
const perTag = new Map<string, number>();

for (const c of cases) {
  if (seen.has(c.id)) errors.push(`${c.id}: duplicate id`);
  seen.add(c.id);
  for (const g of c.gold) {
    if (!ids.has(g)) errors.push(`${c.id}: unknown part ${g}`);
    else perPart.set(g, (perPart.get(g) ?? 0) + 1);
  }
  if (c.context.length > 4) errors.push(`${c.id}: context longer than 2 exchanges`);
  for (const t of c.tags) perTag.set(t, (perTag.get(t) ?? 0) + 1);
}

console.log(`cases=${cases.length}`);
console.log('gold size:', Object.fromEntries(
  [0, 1, 2, 3, 4].map((n) => [n, cases.filter((c) => c.gold.length === n).length])
));
console.log('per part:', Object.fromEntries([...perPart].sort((a, b) => b[1] - a[1])));
console.log('per tag:', Object.fromEntries([...perTag].sort((a, b) => b[1] - a[1])));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
