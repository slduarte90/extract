const path = require('path');
const { extractWords } = require('./extract_itau_words');

function moneyToNumber(text) {
  const negative = /-/.test(text);
  const clean = text.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.').replace(/(?!^)-/g, '');
  const value = Math.abs(Number(clean));
  return negative ? -value : value;
}

function textFrom(items) {
  return items
    .slice()
    .sort((a, b) => a.x - b.x)
    .map(i => i.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseItauStandalone(file) {
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

  const txns = [];
  let currentDate = null;
  for (const row of rows) {
    const allText = textFrom(row.items);
    const inlineDate = row.items.find(i => i.x < 80 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.text));
    const inlineValueText = textFrom(row.items.filter(i => i.x >= 460));
    const inlineValueMatch = inlineValueText.match(/-?\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|-?\s*(?:R\$\s*)?\d+,\d{2}/);
    if (inlineDate && inlineValueMatch) {
      let desc = textFrom(row.items.filter(i => i.x >= 80 && i.x < 460));
      desc = desc.replace(/\s+/g, ' ').trim();
      if (desc && !/saldo (do dia|total dispon[ií]vel)|saldo total|saldo anterior/i.test(desc)) {
        const value = moneyToNumber(inlineValueMatch[0]);
        if (Number.isFinite(value) && value !== 0) txns.push({ date: inlineDate.text, desc, value });
      }
      continue;
    }

    const dateMatch = allText.match(/^\d{2}\/\d{2}\/\d{4}$/);
    if (dateMatch) {
      currentDate = dateMatch[0];
      continue;
    }
    if (!currentDate) continue;
    const valueText = textFrom(row.items.filter(i => i.x >= 500));
    const valueMatch = valueText.match(/-?\s*R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}|-?\s*R\$\s*\d+,\d{2}/);
    if (!valueMatch) continue;
    let desc = textFrom(row.items.filter(i => i.x >= 90 && i.x < 500));
    desc = desc
      .replace(/\s*\d{2}\/\d{2}\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!desc || /saldo (do dia|total dispon[ií]vel)|saldo total|saldo anterior/i.test(desc)) continue;
    const value = moneyToNumber(valueMatch[0]);
    if (!Number.isFinite(value) || value === 0) continue;
    txns.push({ date: currentDate, desc, value });
  }
  return txns;
}

if (require.main === module) {
  for (const file of process.argv.slice(2)) {
    const txns = parseItauStandalone(file);
    const entradas = txns.filter(t => t.value > 0).reduce((s, t) => s + t.value, 0);
    const saidas = txns.filter(t => t.value < 0).reduce((s, t) => s + Math.abs(t.value), 0);
    const saldo = entradas - saidas;
    console.log(path.basename(file), txns.length, entradas.toFixed(2), saidas.toFixed(2), saldo.toFixed(2));
  }
}

module.exports = { parseItauStandalone };
