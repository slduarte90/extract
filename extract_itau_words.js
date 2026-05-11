const fs = require('fs');
const zlib = require('zlib');

function readPdf(file) {
  const buf = fs.readFileSync(file);
  const latin = buf.toString('latin1');
  const objects = new Map();
  for (const m of latin.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) {
    objects.set(Number(m[1]), { id: Number(m[1]), raw: m[2], start: m.index });
  }
  return { buf, latin, objects };
}

function decodeStream(obj) {
  const raw = obj.raw;
  const st = raw.indexOf('stream');
  const en = raw.indexOf('endstream');
  if (st < 0 || en < 0) return '';
  let start = st + 6;
  if (raw[start] === '\r' && raw[start + 1] === '\n') start += 2;
  else if (raw[start] === '\n') start += 1;
  let end = en;
  if (raw[end - 1] === '\n') end -= 1;
  if (raw[end - 1] === '\r') end -= 1;
  const bytes = Buffer.from(raw, 'latin1').subarray(start, end);
  if (/\/FlateDecode/.test(raw.slice(0, st))) {
    return zlib.inflateSync(bytes).toString('latin1');
  }
  return bytes.toString('latin1');
}

function hexToUnicode(hex) {
  const clean = hex.replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const cp = parseInt(clean.slice(i, i + 4), 16);
    if (Number.isFinite(cp)) out.push(String.fromCodePoint(cp));
  }
  return out.join('');
}

function parseCMap(text) {
  const map = new Map();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(m[1], 16), hexToUnicode(m[2]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)) {
      const first = parseInt(m[1], 16);
      const last = parseInt(m[2], 16);
      const dst = parseInt(m[3], 16);
      for (let c = first; c <= last; c++) map.set(c, String.fromCodePoint(dst + c - first));
    }
  }
  return map;
}

function fontMaps(pdf) {
  const out = new Map();
  for (const obj of pdf.objects.values()) {
    const m = obj.raw.match(/\/Type\s+\/Font[\s\S]*?\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!m) continue;
    const cmapObj = pdf.objects.get(Number(m[1]));
    if (!cmapObj) continue;
    out.set(obj.id, parseCMap(decodeStream(cmapObj)));
  }
  return out;
}

function parsePageList(pdf) {
  const pages = [];
  for (const obj of pdf.objects.values()) {
    if (!/\/Type\s+\/Page\b/.test(obj.raw)) continue;
    const contents = [];
    const single = obj.raw.match(/\/Contents\s+(\d+)\s+0\s+R/);
    if (single) contents.push(Number(single[1]));
    const array = obj.raw.match(/\/Contents\s+\[([^\]]+)\]/);
    if (array) {
      for (const r of array[1].matchAll(/(\d+)\s+0\s+R/g)) contents.push(Number(r[1]));
    }
    const fonts = new Map();
    let resourceRaw = obj.raw;
    const resourceRef = obj.raw.match(/\/Resources\s+(\d+)\s+0\s+R/);
    if (resourceRef && pdf.objects.has(Number(resourceRef[1]))) {
      resourceRaw = pdf.objects.get(Number(resourceRef[1])).raw;
      const fontRef = resourceRaw.match(/\/Font\s+(\d+)\s+0\s+R/);
      if (fontRef && pdf.objects.has(Number(fontRef[1]))) {
        resourceRaw += '\n' + pdf.objects.get(Number(fontRef[1])).raw;
      }
    }
    const fontBlock = resourceRaw.match(/\/Font\s*<<(.*?)>>/s);
    const fontText = fontBlock ? fontBlock[1] : resourceRaw;
    if (fontText) {
      for (const f of fontText.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
        fonts.set(f[1], Number(f[2]));
      }
    }
    pages.push({ id: obj.id, contents, fonts, order: obj.start });
  }
  return pages.sort((a, b) => a.order - b.order);
}

function decodeHexText(hex, cmap) {
  const clean = hex.replace(/\s+/g, '');
  let s = '';
  const useTwoBytes = clean.length % 4 === 0 && cmap && cmap.has(parseInt(clean.slice(0, 4), 16));
  const step = useTwoBytes ? 4 : 2;
  for (let i = 0; i < clean.length; i += step) {
    const code = parseInt(clean.slice(i, i + step), 16);
    s += cmap?.get(code) ?? '';
  }
  return s;
}

function literalToHex(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (ch === '\\') {
      i += 1;
      ch = raw[i] || '';
      if (/[0-7]/.test(ch)) {
        let oct = ch;
        while (i + 1 < raw.length && oct.length < 3 && /[0-7]/.test(raw[i + 1])) oct += raw[++i];
        out += Number.parseInt(oct, 8).toString(16).padStart(2, '0');
        continue;
      }
      const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      const code = escapes[ch] ?? ch.charCodeAt(0);
      out += code.toString(16).padStart(2, '0');
      continue;
    }
    out += ch.charCodeAt(0).toString(16).padStart(2, '0');
  }
  return out;
}

function extractWords(file) {
  const pdf = readPdf(file);
  const cmaps = fontMaps(pdf);
  const pages = parsePageList(pdf);
  const all = [];

  pages.forEach((page, pageIdx) => {
    const content = page.contents.map(id => decodeStream(pdf.objects.get(id))).join('\n');
    for (const bt of content.matchAll(/BT([\s\S]*?)ET/g)) {
      const block = bt[1];
      let font = null;
      let x = 0;
      let y = 0;
      let size = 10;
      const re = /\/(F\d+)\s+([-\d.]+)\s+Tf|([-\d.]+)\s+([-\d.]+)\s+Td|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm|<([0-9A-Fa-f\s]+)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:.|\n)*?)\]\s*TJ/g;
      let m;
      while ((m = re.exec(block))) {
        if (m[1]) {
          font = m[1];
          size = Number(m[2]) || size;
          continue;
        }
        if (m[3]) {
          x += Number(m[3]) || 0;
          y += Number(m[4]) || 0;
          continue;
        }
        if (m[5]) {
          x = Number(m[5]) || 0;
          y = Number(m[6]) || 0;
          continue;
        }
        const fontObj = page.fonts.get(font);
        const cmap = cmaps.get(fontObj);
        if (m[7]) {
          const text = decodeHexText(m[7], cmap);
          if (text) all.push({ page: pageIdx + 1, x, y, size, text });
          continue;
        }
        if (m[8]) {
          const text = decodeHexText(literalToHex(m[8]), cmap);
          if (text) all.push({ page: pageIdx + 1, x, y, size, text });
          continue;
        }
        if (m[9]) {
          let text = '';
          for (const h of m[9].matchAll(/<([0-9A-Fa-f\s]+)>|\(((?:\\.|[^\\)])*)\)/g)) {
            text += h[1] ? decodeHexText(h[1], cmap) : decodeHexText(literalToHex(h[2]), cmap);
          }
          if (text) all.push({ page: pageIdx + 1, x, y, size, text });
        }
      }
    }
  });
  return all;
}

if (require.main === module) {
  const words = extractWords(process.argv[2]);
  console.log(JSON.stringify(words, null, 2));
}

module.exports = { extractWords };
