const path = require('path');
const { extractWords } = require('./extract_itau_words');
const { parseItauStandalone } = require('./validate_itau_pdf');

function brMoneyToNumber(text) {
  const neg = /-/.test(text);
  const m = String(text || '').match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, '').replace(',', '.'));
  return neg ? -Math.abs(n) : n;
}

function textFrom(items) {
  return items.slice().sort((a, b) => a.x - b.x).map(i => i.text).join('').replace(/\s+/g, ' ').trim();
}

function dateKey(date) {
  const [d, m, y] = date.split('/').map(Number);
  return y * 10000 + m * 100 + d;
}

function parseBalances(file) {
  const glyphs = extractWords(file);
  const rows = [];
  for (const g of glyphs) {
    let row = rows.find(r => r.page === g.page && Math.abs(r.y - g.y) < 2);
    if (!row) {
      row = { page: g.page, y: g.y, items: [] };
      rows.push(row);
    }
    row.items.push(g);
  }
  rows.sort((a, b) => a.page - b.page || a.y - b.y);

  const balances = [];
  let currentDate = null;
  for (const row of rows) {
    const all = textFrom(row.items);
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(all)) {
      currentDate = all;
      continue;
    }
    const inlineDate = all.match(/^(\d{2}\/\d{2}\/\d{4})/)?.[1];
    const date = inlineDate || currentDate;
    if (!date) continue;
    if (/SALDO ANTERIOR/i.test(all)) {
      balances.push({ date, kind: 'inicial', value: brMoneyToNumber(all), text: all });
    } else if (/saldo (do dia|total dispon[ií]vel dia)/i.test(all)) {
      balances.push({ date, kind: 'dia', value: brMoneyToNumber(all), text: all });
    }
  }
  return balances.filter(b => Number.isFinite(b.value)).sort((a, b) => dateKey(a.date) - dateKey(b.date));
}

for (const file of process.argv.slice(2)) {
  const txns = parseItauStandalone(file);
  const entradas = txns.filter(t => t.value > 0).reduce((s, t) => s + t.value, 0);
  const saidas = txns.filter(t => t.value < 0).reduce((s, t) => s + Math.abs(t.value), 0);
  const mov = entradas - saidas;
  const balances = parseBalances(file);
  const initial = balances.find(b => b.kind === 'inicial') || balances[0];
  const final = [...balances].reverse().find(b => b.kind === 'dia') || balances.at(-1);
  const expected = initial && final ? final.value - initial.value : null;
  const diff = expected == null ? null : mov - expected;
  console.log([
    path.basename(file),
    txns.length,
    entradas.toFixed(2),
    saidas.toFixed(2),
    mov.toFixed(2),
    initial ? `${initial.date} ${initial.value.toFixed(2)}` : '',
    final ? `${final.date} ${final.value.toFixed(2)}` : '',
    diff == null ? '' : diff.toFixed(2),
  ].join('\t'));
}
