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

function money(text) {
  const s = String(text || '').replace(/\s+/g, '');
  const m = s.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\(([+-])\)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return { value: n, sign: m[2], signed: m[2] === '-' ? -n : n, text: m[0] };
}

function textFromWords(words) {
  return words.slice().sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
}

function parseBB(words) {
  const DATE_PAT = /^\d{2}\/\d{2}\/\d{3,4}$/;
  const IGNORE_HIST = /saldo (anterior|do dia|bloq|bloqueado)|saldo anterior|saldo bloqueado|dep[oó]sito bloquead|deposito bloquead|ordem interna|ordens internas|lan[çc]amento futuro|pre[- ]?lan[çc]amento/i;
  const txns = [], ignored = [], saldoRows = [];
  const pages = [...new Set(words.map(w => w.page))].sort((a, b) => a - b);
  for (const p of pages) {
    const pageWords = words.filter(w => w.page === p);
    const rows = [];
    for (const item of pageWords) {
      let row = rows.find(r => Math.abs(r.y - item.y) < 3);
      if (!row) rows.push(row = { page: p, y: item.y, items: [] });
      row.items.push(item);
    }
    rows.sort((a, b) => b.y - a.y);
    const anchors = rows.map((row, idx) => {
      const dateItem = row.items.find(t => t.x < 80 && DATE_PAT.test(t.text));
      if (!dateItem) return null;
      const vals = pageWords.filter(v => Math.abs(v.y - dateItem.y) <= 7 && v.x > 500 && v.x < 585);
      const val = money(vals.sort((a,b)=>a.x-b.x).map(v => v.text).join(''));
      return val ? { page: p, idx, y: dateItem.y, date: dateItem.text, val } : null;
    }).filter(Boolean);
    for (let i = 0; i < anchors.length; i++) {
      const anc = anchors[i];
      const nextY = anchors[i + 1]?.y ?? -9999;
      const histItems = [];
      for (const row of rows) {
        histItems.push(...row.items.filter(t =>
          t.x >= 250 && t.x < 500 &&
          t.y <= anc.y + 8 &&
          t.y > nextY + 7 &&
          !DATE_PAT.test(t.text) &&
          !money(t.text)
        ));
      }
      const hist = textFromWords(histItems);
      const item = { page: anc.page, date: anc.date, hist, value: anc.val.value, signed: anc.val.signed, valText: anc.val.text };
      if (/saldo/i.test(hist)) saldoRows.push(item);
      if (!hist || (IGNORE_HIST.test(hist) && !/bb rende|rende facil|rende f[aá]cil|cdb/i.test(hist)) || anc.date === '00/00/0000') ignored.push(item);
      else txns.push(item);
    }
  }
  return { txns, ignored, saldoRows };
}

const file = process.argv[2];
const words = streams(file).flatMap((s, i) => extract(s, i + 1));
const { txns, ignored, saldoRows } = parseBB(words);
const ent = txns.filter(t => t.signed > 0).reduce((a, t) => a + t.value, 0);
const sai = txns.filter(t => t.signed < 0).reduce((a, t) => a + t.value, 0);
console.log(JSON.stringify({
  file,
  words: words.length,
  txns: txns.length,
  ignored: ignored.length,
  entradas: +ent.toFixed(2),
  saidas: +sai.toFixed(2),
  saldoMov: +(ent - sai).toFixed(2),
  saldoRows: saldoRows.map(x => ({ page: x.page, date: x.date, hist: x.hist, signed: x.signed })).slice(-12)
}, null, 2));
console.log('\nAMOSTRA TED/CREDITO:');
txns.filter(t => /ted|cr[eé]dito|credito|fundo|municip/i.test(t.hist)).slice(0, 30).forEach(t => console.log(`${t.page} ${t.date} ${t.valText} ${t.hist}`));
console.log('\nBB RENDE:');
txns.filter(t => /rende|cdb/i.test(t.hist)).slice(0, 40).forEach(t => console.log(`${t.page} ${t.date} ${t.valText} ${t.hist}`));
console.log('\nIGNORADOS SUSPEITOS:');
ignored.filter(t => /dep|cheque|saldo|bloq|rende/i.test(t.hist)).slice(0, 40).forEach(t => console.log(`${t.page} ${t.date} ${t.valText} ${t.hist}`));
