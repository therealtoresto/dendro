import * as esbuild from 'esbuild';
import { access, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const builds = [
  {
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    sourcemap: true,
  },
  {
    entryPoints: ['webview/main.ts'],
    outfile: 'dist/webview.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
  },
  {
    entryPoints: ['history/main.ts'],
    outfile: 'dist/history.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
  },
  {
    entryPoints: ['compare/main.ts'],
    outfile: 'dist/compare.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
  },
  {
    entryPoints: ['insights/main.ts'],
    outfile: 'dist/insights.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
  },
  {
    entryPoints: ['rebase/main.ts'],
    outfile: 'dist/rebase.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
  },
  {
    entryPoints: ['overview/main.ts'],
    outfile: 'dist/overview.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
  },
  {
    entryPoints: ['settings/main.ts'],
    outfile: 'dist/settings.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
  },
];

// Each page's stylesheet: the shared glass tokens, the page's own rules in the "base" layer, then the page's
// glass rules on top of them (cascade layers, so a glass rule wins without fighting specificity).
const buildPageStyles = async (page, bundle) => {
  const glass = await readFile('src/shared/glass.css', 'utf8');
  const base = await readFile(`${page}/styles.css`, 'utf8');
  const pageGlass = await access(`${page}/glass.css`).then(
    () => readFile(`${page}/glass.css`, 'utf8'),
    () => '',
  );
  await writeFile(`dist/${bundle}.css`, `${glass}\n@layer base {\n${base}\n}\n${pageGlass}`);
};

const copyStyles = () =>
  Promise.all([
    buildPageStyles('webview', 'webview'),
    buildPageStyles('settings', 'settings'),
    buildPageStyles('history', 'history'),
    buildPageStyles('compare', 'compare'),
    buildPageStyles('rebase', 'rebase'),
    buildPageStyles('insights', 'insights'),
    buildPageStyles('overview', 'overview'),
  ]);

if (watch) {
  for (const options of builds) {
    const context = await esbuild.context(options);
    await context.watch();
  }
  await copyStyles();
  console.log('watching…');
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  await copyStyles();
}
