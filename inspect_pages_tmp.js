const fs=require('fs'); const s=fs.readFileSync(process.argv[2],'latin1');
for (const m of s.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) {
 const obj=m[2]; if (/\/Type\s*\/Page\b|\/Font\s*<</.test(obj)) { console.log('\nOBJ',m[1]); console.log(obj.slice(0,1800).replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff]/g,'.')); }
}
