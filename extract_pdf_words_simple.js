const fs = require('fs');
const zlib = require('zlib');

function unescapePdfString(s) {
  return s
    .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c]))
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

function streams(file) {
  const buf = fs.readFileSync(file);
  const s = buf.toString('latin1');
  const out = [];
  let idx = 0;
  while ((idx = s.indexOf('stream', idx)) >= 0) {
    const dictStart = s.lastIndexOf('obj', idx);
    const dict = s.slice(Math.max(0, dictStart), idx);
    const start = idx + 6 + (s[idx + 6] === '\r' && s[idx + 7] === '\n' ? 2 : s[idx + 6] === '\n' ? 1 : 0);
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const stream = buf.subarray(start, end - (buf[end - 1] === 10 || buf[end - 1] === 13 ? 1 : 0));
    if (/FlateDecode/.test(dict)) {
      try { out.push(zlib.inflateSync(stream).toString('latin1')); } catch {}
    }
    idx = end + 9;
  }
  return out;
}

function extract(content, page) {
  const re = /(?:1 0 0 1\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm)|(?:(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Td)|(?:\((?:\\.|[^\\)])*\)\s*Tj)|(?:\[(.*?)\]\s*TJ)/gs;
  const words = [];
  let x = 0, y = 0, m;
  while ((m = re.exec(content))) {
    if (m[1] != null) { x = Number(m[1]); y = Number(m[2]); continue; }
    if (m[3] != null) { x += Number(m[3]); y += Number(m[4]); continue; }
    if (m[0].endsWith('Tj')) {
      const raw = m[0].match(/\((?:\\.|[^\\)])*\)/)?.[0] || '()';
      const text = unescapePdfString(raw.slice(1, -1)).trim();
      if (text) words.push({ page, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, text });
    } else if (m[5] != null) {
      const parts = [...m[5].matchAll(/\((?:\\.|[^\\)])*\)/g)].map(mm => unescapePdfString(mm[0].slice(1, -1)));
      const text = parts.join('').trim();
      if (text) words.push({ page, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, text });
    }
  }
  return words;
}

for (const file of process.argv.slice(2)) {
  const all = streams(file).flatMap((s, i) => extract(s, i + 1));
  console.log('\n###', file, 'words', all.length);
  all
    .filter(w => /(\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}|pix|ted|boleto|saldo|rende|fornecedor|receb|valor|hist|lanç|lanc|ag[eê]ncia|conta|\d{1,3}(?:\.\d{3})*,\d{2})/i.test(w.text))
    .slice(0, 220)
    .forEach(w => console.log(`${w.page}\tx=${w.x}\ty=${w.y}\t${w.text}`));
}
