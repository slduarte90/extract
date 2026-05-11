const fs = require('fs');
const zlib = require('zlib');

function streams(file) {
  const buf = fs.readFileSync(file);
  const s = buf.toString('latin1');
  const out = [];
  let idx = 0, no = 0;
  while ((idx = s.indexOf('stream', idx)) >= 0) {
    const dictStart = s.lastIndexOf('obj', idx);
    const dict = s.slice(Math.max(0, dictStart), idx);
    const start = idx + 6 + (s[idx + 6] === '\r' && s[idx + 7] === '\n' ? 2 : s[idx + 6] === '\n' ? 1 : 0);
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const stream = buf.subarray(start, end - (buf[end - 1] === 10 || buf[end - 1] === 13 ? 1 : 0));
    if (/FlateDecode/.test(dict)) {
      try { out.push({ no: ++no, dict, text: zlib.inflateSync(stream).toString('latin1') }); } catch {}
    }
    idx = end + 9;
  }
  return out;
}

function showLiteralBytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i).toString(16).padStart(2, '0'));
  return out.join(' ');
}

const file = process.argv[2];
for (const st of streams(file)) {
  const t = st.text;
  const ops = [...t.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj|\[(.*?)\]\s*TJ|<([0-9a-fA-F\s]+)>\s*Tj/gs)];
  if (ops.length || /beginbfchar|beginbfrange|ToUnicode|\/F\d+/.test(t)) {
    console.log('\n--- stream', st.no, 'len', t.length, 'ops', ops.length);
    console.log(t.slice(0, 1200).replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff]/g, '.'));
    for (const op of ops.slice(0, 20)) {
      const raw = op[0].slice(0, 180);
      const lit = raw.match(/\(((?:\\.|[^\\)])*)\)/)?.[1];
      console.log('OP:', raw.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '.'));
      if (lit != null) console.log('BYTES:', showLiteralBytes(lit).slice(0, 300));
    }
  }
}
