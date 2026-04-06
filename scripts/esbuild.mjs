import * as esbuild from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isWatch = process.argv.includes('--watch');
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'out');
const outfile = path.join(outDir, 'extension.js');

const buildOptions = {
  entryPoints: [path.join(rootDir, 'src', 'extension.ts')],
  outfile,
  bundle: true,
  // eslint-disable-next-line spellcheck/spell-checker
  external: ['vscode', 'cpu-features', '*.node'],
  format: 'cjs',
  legalComments: 'none',
  logLevel: 'info',
  platform: 'node',
  sourcemap: true,
  sourcesContent: false,
  target: 'node20',
};

async function prepareOutputDirectory() {
  await rm(outDir, { force: true, recursive: true });
  await mkdir(outDir, { recursive: true });
}

async function main() {
  await prepareOutputDirectory();

  if (!isWatch) {
    await esbuild.build(buildOptions);
    return;
  }

  const context = await esbuild.context(buildOptions);
  await context.watch();
  console.log('Watching bundled extension host build...');

  const dispose = async () => {
    await context.dispose();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void dispose();
  });
  process.on('SIGTERM', () => {
    void dispose();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
