/** Mechanical leak check: does any eval utterance (or a 6+ char piece of it) appear in a text? */
export const normalize = (s: string) => s.replace(/[\s「」『』、。,.!?!?…・()()"'`]/g, '');

export function findLeaks(utterances: { id: string; utterance: string }[], texts: { name: string; text: string }[], minLen = 6) {
  const hits: { id: string; utterance: string; where: string; piece: string }[] = [];
  const docs = texts.map((t) => ({ name: t.name, n: normalize(t.text) }));
  for (const u of utterances) {
    const s = normalize(u.utterance);
    for (const d of docs) {
      let piece = '';
      for (let len = s.length; len >= minLen && !piece; len--) {
        for (let i = 0; i + len <= s.length; i++) {
          if (d.n.includes(s.slice(i, i + len))) {
            piece = s.slice(i, i + len);
            break;
          }
        }
      }
      if (piece) hits.push({ id: u.id, utterance: u.utterance, where: d.name, piece });
    }
  }
  return hits;
}
