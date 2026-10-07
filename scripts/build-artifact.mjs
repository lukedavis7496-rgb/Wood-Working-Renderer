// Builds a single self-contained HTML fragment (dist-artifact/woodworking-planner.html)
// with the app's JS and CSS inlined and three.js loaded from a CDN via an import map.
import { build } from 'vite';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const THREE_VERSION = JSON.parse(readFileSync('node_modules/three/package.json', 'utf8')).version;
const outDir = 'dist-artifact/tmp';

await build({
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    rolldownOptions: { external: ['three', /^three\/addons\//] },
  },
});

const assets = join(outDir, 'assets');
const files = readdirSync(assets);
const js = readFileSync(join(assets, files.find((f) => f.endsWith('.js'))), 'utf8');
const css = readFileSync(join(assets, files.find((f) => f.endsWith('.css'))), 'utf8');
const html = readFileSync('index.html', 'utf8');
const head = html.match(/<title>.*<\/title>/)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script type="module"[^>]*><\/script>/, '');
const cdn = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

const page = `${head}
<style>${css}</style>
<script type="importmap">${JSON.stringify({ imports: { three: `${cdn}/build/three.module.js`, 'three/addons/': `${cdn}/examples/jsm/` } })}</script>
${body.trim()}
<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>
`;
mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/woodworking-planner.html', page);
console.log(`dist-artifact/woodworking-planner.html ${(page.length / 1024).toFixed(0)} KB (three@${THREE_VERSION} from CDN)`);
