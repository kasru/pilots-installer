#!/usr/bin/env node
// Собирает release/manifest.json из готовых сборок: берёт файлы каждой платформы,
// считает SHA-256 и записывает манифест, который читает страница.
//
//   node tools/manifest.mjs --version 0.1.0 \
//        --base https://github.com/kasru/pilots_re/releases/download/v0.1.0/ \
//        --win-x64 dist/x64 --win-x86 dist/x86 --switch dist/switch --macos-i386 dist/mac
//
// Каталог платформы — тот, куда выполнила сборка: в нём лежат файлы под локальными
// именами из PLATFORMS (у SDL2 это просто SDL2.dll), а в релиз они попадают под
// именами asset — поэтому в манифесте оказываются имена релиза.

import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS } from '../lib/installer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    'usage: node tools/manifest.mjs --version <version> --base <release url> ' +
      '[--out release/manifest.json] [--<platform> <dir> ...]\n' +
      `platforms: ${PLATFORMS.map((platform) => platform.id).join(', ')}`,
  );
  process.exit(2);
}

function parseArgs(argv) {
  const options = { version: '', base: '', out: join(ROOT, 'release', 'manifest.json'), dirs: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--version' && value) {
      options.version = value;
      i += 1;
    } else if (arg === '--base' && value) {
      options.base = value;
      i += 1;
    } else if (arg === '--out' && value) {
      options.out = resolve(value);
      i += 1;
    } else if (arg.startsWith('--')) {
      const platform = PLATFORMS.find((candidate) => candidate.id === arg.slice(2));
      if (!platform || !value) {
        usage(`unknown option: ${arg}`);
      }
      options.dirs.set(platform.id, resolve(value));
      i += 1;
    } else {
      usage(`unknown argument: ${arg}`);
    }
  }
  if (!options.version) {
    usage('--version is required');
  }
  if (!options.base) {
    usage('--base is required');
  }
  return options;
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const platforms = {};

  for (const [id, dir] of options.dirs) {
    const platform = PLATFORMS.find((candidate) => candidate.id === id);
    const files = {};
    for (const asset of platform.assets) {
      const local = join(dir, asset.local || asset.asset);
      const info = await stat(local).catch(() => null);
      if (!info || !info.isFile()) {
        console.error(`${id}: ${local} not found`);
        process.exit(1);
      }
      files[asset.asset] = await sha256(local);
      console.log(`${id.padEnd(11)} ${asset.asset.padEnd(20)} ${String(info.size).padStart(9)}  ${files[asset.asset]}`);
    }
    platforms[id] = files;
  }

  const manifest = {
    version: options.version,
    base: options.base.replace(/\/?$/, '/'),
    platforms,
  };
  await writeFile(options.out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`\n${options.out}`);
}

main();
