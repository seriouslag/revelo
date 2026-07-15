import { build, watch } from 'rolldown';

const production = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

/** Extension host bundle (Node.js). */
const extensionOptions = {
  input: 'src/extension.ts',
  output: {
    file: 'dist/extension.js',
    format: 'cjs',
    sourcemap: !production,
    minify: production,
  },
  platform: 'node',
  external: ['vscode'],
};

/** Webview bundle (browser sandbox). No vscode module; IIFE so it runs inline. */
const webviewOptions = {
  input: 'media/panel.ts',
  output: {
    file: 'media/panel.js',
    format: 'iife',
    sourcemap: !production,
    minify: production,
  },
  platform: 'browser',
};

if (isWatch) {
  const watcher = watch([extensionOptions, webviewOptions]);
  watcher.on('event', (event) => {
    if (event.code === 'START') {
      console.log('[watch] build started');
    } else if (event.code === 'END') {
      console.log('[watch] build finished');
    } else if (event.code === 'ERROR') {
      console.error('[watch] build error:', event.error);
    }
  });
} else {
  await build(extensionOptions);
  await build(webviewOptions);
}
