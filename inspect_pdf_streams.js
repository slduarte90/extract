const fs = require('fs');
const zlib = require('zlib');

const files = process.argv.slice(2);
for (const file of files) {
  const buf = fs.readFileSync(file);
  const s = buf.toString('latin1');
  console.log('\n###', file);
  let idx = 0, n = 0;
  while ((idx = s.indexOf('stream', idx)) >= 0) {
    const dictStart = s.lastIndexOf('obj', idx);
    const dict = s.slice(Math.max(0, dictStart), idx);
    const start = idx + 6 + (s[idx + 6] === '\r' && s[idx + 7] === '\n' ? 2 : s[idx + 6] === '\n' ? 1 : 0);
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const stream = buf.subarray(start, end - (buf[end - 1] === 10 || buf[end - 1] === 13 ? 1 : 0));
    if (/FlateDecode/.test(dict)) {
      try {
        const out = zlib.inflateSync(stream).toString('latin1');
        const readable = out.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff]/g, '.');
        console.log(`\n-- stream ${++n} len=${out.length}`);
        console.log(readable.slice(0, 2500));
      } catch (e) {
        console.log('inflate failed', e.message);
      }
    }
    idx = end + 9;
  }
}
