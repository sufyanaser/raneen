import {mkdirSync,copyFileSync,cpSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
const assets=readdirSync('dist/assets').map(name=>'./assets/'+name);
writeFileSync('dist/sw.js',readFileSync('dist/sw.js','utf8').replace('/* BUILD_ASSETS */',assets.map(name=>JSON.stringify(name)).join(',')));
mkdirSync('dist/ooh/field',{recursive:true});
for(const name of ['install.html','install.js','index.html','sw.js','manifest.webmanifest','apple-touch-icon.png','apple-touch-icon-precomposed.png','favicon.ico'])copyFileSync(`dist/${name}`,`dist/ooh/field/${name}`);
cpSync('dist/assets','dist/ooh/field/assets',{recursive:true});

cpSync('dist/brand','dist/ooh/field/brand',{recursive:true});
