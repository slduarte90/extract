const fs=require('fs'); const file=process.argv[2]; const s=fs.readFileSync(file,'latin1');
for (const m of s.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) {
 const obj=m[2]; if (/\/ToUnicode|\/FontDescriptor|\/BaseFont|\/Subtype\s*\/Type0|\/Subtype\s*\/TrueType/.test(obj) && !/stream/.test(obj)) {
  console.log('OBJ',m[1]); console.log(obj.slice(0,1000).replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff]/g,'.'));
 }
}
