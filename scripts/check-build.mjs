// Static frontend: no bundler. Validate sources/import paths before Vercel packages /api.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const sources=['api/firebase-init.js','api/health.js','api/sync.js','api/upload.js','lib/session.js','lib/cloudinary.js','sync-core.js','sw.js'];
for(const relative of sources){
  const file=path.join(root,relative),source=fs.readFileSync(file,'utf8');
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
  for(const [,specifier] of source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)){
    if(!fs.existsSync(path.resolve(path.dirname(file),specifier)))throw new Error(`Missing import ${relative}: ${specifier}`);
  }
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const [,script] of html.matchAll(/<script>\s*([\s\S]*?)<\/script>/g))new vm.Script(script,{filename:'index.html'});
for(const file of ['vercel.json','manifest.webmanifest','firebase.json','package.json'])JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
for(const [,src] of html.matchAll(/<script[^>]+src="(\.\/[^"?]+)"/g))if(!fs.existsSync(path.join(root,src)))throw new Error(`Missing browser script: ${src}`);
console.log('Static build checks passed: JavaScript syntax, local imports, JSON and browser scripts.');
console.log('No Cloudinary/Firebase credentials or live services used. Vercel function packaging runs on deployment.');
