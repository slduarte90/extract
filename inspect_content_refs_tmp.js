const fs=require('fs'); const s=fs.readFileSync(process.argv[2],'latin1');
for (const id of [47,55,66,77,88,102,113,121]) { const re=new RegExp('\\n'+id+'\\s+0\\s+obj([\\s\\S]*?)endobj'); const m=s.match(re); console.log('OBJ',id, m&&m[1].slice(0,300).replace(/[^\x20-\x7e\n]/g,'.')); }
