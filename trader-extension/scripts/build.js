// Build script
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = __dirname + '/..';
const DIST = ROOT + '/dist';

// Files to copy as-is
const STATIC_FILES = [
  'manifest.json',
  'background.js',
  'icon16.png',
  'icon48.png',
  'icon128.png',
  'src/trader.html',
  'src/settings.html'
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function build() {
  console.log('Building...\n');

  // Clean dist
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  ensureDir(DIST);
  ensureDir(DIST + '/src');

  // Bundle trader.js
  console.log('Bundling trader.js...');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/trader.js')],
    bundle: true,
    outfile: path.join(DIST, 'src/trader.js'),
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: false,
    write: true,
  });

  // Bundle settings.js
  console.log('Bundling settings.js...');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/settings.js')],
    bundle: true,
    outfile: path.join(DIST, 'src/settings.js'),
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: false,
    write: true,
  });

  // Copy static files
  for (const file of STATIC_FILES) {
    const srcPath = path.join(ROOT, file);
    const destPath = path.join(DIST, file);
    if (fs.existsSync(srcPath)) {
      console.log(`Copying: ${file}`);
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // Update HTML files
  updateHtmlFiles();

  console.log('\n✓ Done! Load dist/ in Chrome.');
}

function updateHtmlFiles() {
  // Update trader.html - remove type="module" and fix inline handlers
  let html = fs.readFileSync(path.join(DIST, 'src/trader.html'), 'utf8');
  html = html.replace(/type="module"\s+/g, '');
  html = html.replace(/\s+type="module"/g, '');
  // Remove any remaining inline onclick handlers
  html = html.replace(/\s*onclick="[^"]*"/gi, '');
  fs.writeFileSync(path.join(DIST, 'src/trader.html'), html);

  // Update settings.html
  html = fs.readFileSync(path.join(DIST, 'src/settings.html'), 'utf8');
  html = html.replace(/type="module"\s+/g, '');
  html = html.replace(/\s+type="module"/g, '');
  fs.writeFileSync(path.join(DIST, 'src/settings.html'), html);
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
