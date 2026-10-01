import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadParts, PROMPTS_DIR } from './parts.js';

const parts = loadParts();
const index = parts.map(({ body: _body, ...meta }) => meta);
writeFileSync(join(PROMPTS_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const total = (k: 'lines' | 'tokens', f = (_: (typeof parts)[number]) => true) =>
  parts.filter(f).reduce((s, p) => s + p[k], 0);
console.table(parts.map((p) => ({ id: p.id, kind: p.kind, lines: p.lines, tokens: p.tokens })));
console.log(
  `parts=${parts.length} lines=${total('lines')} tokens=${total('tokens')} ` +
    `(always: ${total('tokens', (p) => p.kind === 'always')} tokens)`
);
