import * as esbuild from 'esbuild';
import { copyFile } from 'node:fs/promises';

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
    entryPoints: ['settings/main.ts'],
    outfile: 'dist/settings.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
  },
];

const copyStyles = () =>
  Promise.all([
    copyFile('webview/styles.css', 'dist/webview.css'),
    copyFile('settings/styles.css', 'dist/settings.css'),
    copyFile('history/styles.css', 'dist/history.css'),
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
