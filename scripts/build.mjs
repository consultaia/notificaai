// Gera dist/ com o app pre-compilado: o JSX vira JavaScript comum aqui (esbuild), e o navegador nao
// precisa mais baixar o Babel (~3 MB) nem compilar 650 KB de codigo a cada acesso.
// Uso: node scripts/build.mjs   (o GitHub Actions roda isto a cada push na main)
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { transform } from 'esbuild';

const OUT = 'dist';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Arquivos publicos copiados como estao
for (const f of ['index.html', '404.html', 'landing.html', 'manifest.webmanifest', 'CNAME', 'index-1.html']) {
  if (existsSync(f)) cpSync(f, `${OUT}/${f}`);
}
for (const d of ['assets', 'supabase', 'worker']) if (existsSync(d)) cpSync(d, `${OUT}/${d}`, { recursive: true });

const html = readFileSync('app.html', 'utf8');
const ABRE = '<script type="text/babel">';
const i = html.indexOf(ABRE);
const j = html.indexOf('</script>', i);
if (i < 0 || j < 0) throw new Error('Script text/babel nao encontrado em app.html');
const jsx = html.slice(i + ABRE.length, j);

const { code } = await transform(jsx, {
  loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
  target: 'es2018', minify: true, charset: 'utf8', legalComments: 'none',
});
if (/<\/script/i.test(code)) throw new Error('Codigo compilado contem </script> literal');

let saida = html.slice(0, i) + '<script>' + code + html.slice(j);
// Babel deixa de ser baixado
saida = saida.replace(/<script src="[^"]*babel-standalone[^"]*"[^>]*><\/script>\s*/, '');
if (saida.includes('babel.min.js')) throw new Error('Tag do Babel nao removida');
writeFileSync(`${OUT}/app.html`, saida);
console.log(`app.html: ${(html.length / 1024).toFixed(0)} KB (JSX) -> ${(saida.length / 1024).toFixed(0)} KB (compilado), sem Babel`);
