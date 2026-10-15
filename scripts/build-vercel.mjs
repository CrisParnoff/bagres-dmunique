import '../build.mjs';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
rmSync('public',{recursive:true,force:true});
mkdirSync('public',{recursive:true});
cpSync('assets','public/assets',{recursive:true});
cpSync('manifest.webmanifest','public/manifest.webmanifest');
const css=readFileSync('styles.css','utf8');
const app=['artwork.js','app.js','ui.js'].map(path=>readFileSync(path,'utf8')).join('\n');
const version=createHash('sha256').update(css+app).digest('hex').slice(0,12);
const html=readFileSync('index.html','utf8')
 .replace('__FCBAGRES_LOGO_DATA_URI__','/assets/fcbagres-logo.webp')
 .replace('__FCBAGRES_MASCOT_DATA_URI__','/assets/fcbagres-mascot-cutout.webp')
 .replace('href="styles.css"',`href="/styles.css?v=${version}"`)
 .replace('src="app.js"',`src="/app.js?v=${version}"`);
writeFileSync('public/index.html',html);
writeFileSync('public/styles.css',css);
writeFileSync('public/app.js',app);
console.log('Vercel build ready: public/ + Node.js API');
