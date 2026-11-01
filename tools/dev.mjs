#!/usr/bin/env node
// Локальная проверка страницы до публикации релиза: собирает dev/manifest.json из
// готовых сборок порта, раскладывает их в dev/assets и поднимает статический сервер.
//
//   node tools/dev.mjs [--port 8000]
//       [--win-x64 ../pilots_re/SRC/out/x64] [--win-x86 ../pilots_re/SRC/out/x86]
//       [--switch ../pilots_re/build-switch-dbg] [--macos-i386 ../pilots_re/build-mac32]
//
// Каталоги по умолчанию — раскладка соседнего репозитория pilots_re. Платформа без
// каталога (или без нужных файлов в нём) просто не попадает в манифест, и страница
// честно покажет её как отсутствующую в релизе.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS } from '../lib/installer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PARENT = resolve(ROOT, '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
  '.iso': 'application/x-iso9660-image',
};

const DEFAULTS = {
  'win-x64': join(PARENT, 'pilots_re', 'SRC', 'out', 'x64'),
  'win-x86': join(PARENT, 'pilots_re', 'SRC', 'out', 'x86'),
  switch: join(PARENT, 'pilots_re', 'build-switch-dbg'),
  'macos-i386': join(PARENT, 'pilots_re', 'build-mac32'),
};

function parseArgs(argv) {
  const options = {
    port: 8000,
    dirs: new Map(Object.entries(DEFAULTS)),
    // образ нужен только для локальной проверки: страница читает его через fetch('/PILOTS.iso')
    iso: join(PARENT, 'pilots_re', 'PILOTS.iso'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--port' && value) {
      options.port = Number(value);
      i += 1;
    } else if (arg === '--iso' && value) {
      options.iso = resolve(value);
      i += 1;
    } else if (arg.startsWith('--') && PLATFORMS.some((platform) => platform.id === arg.slice(2)) && value) {
      options.dirs.set(arg.slice(2), resolve(value));
      i += 1;
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

// Копирует файлы платформ под именами релиза и возвращает их хеши.
async function buildDevManifest(options) {
  const assetsDir = join(ROOT, 'dev', 'assets');
  await mkdir(assetsDir, { recursive: true });
  const platforms = {};

  for (const platform of PLATFORMS) {
    const dir = options.dirs.get(platform.id);
    if (!dir) {
      continue;
    }
    const files = {};
    const present = [];
    for (const asset of platform.assets) {
      const source = join(dir, asset.local || asset.asset);
      const info = await stat(source).catch(() => null);
      if (!info || !info.isFile()) {
        present.length = 0;
        break;
      }
      await copyFile(source, join(assetsDir, asset.asset));
      files[asset.asset] = await sha256(source);
      present.push(`${asset.asset} (${info.size} B)`);
    }
    if (present.length) {
      platforms[platform.id] = files;
      console.log(`${platform.id}: ${present.join(', ')}`);
    } else {
      console.log(`${platform.id}: нет сборки в ${dir} — платформа останется недоступной`);
    }
  }

  const manifest = { version: 'dev', base: 'dev/assets/', platforms };
  await writeFile(join(ROOT, 'dev', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function serve(options) {
  const send = async (path, response) => {
    const info = await stat(path).catch(() => null);
    if (!info || !info.isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(response);
  };

  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/PILOTS.iso') {
      await send(options.iso, response);
      return;
    }
    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const path = resolve(ROOT, `.${relative}`);
    if (path !== ROOT && !path.startsWith(ROOT + sep)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    await send(path, response);
  });
  server.listen(options.port, () => {
    console.log(`\nhttp://localhost:${options.port}/?manifest=dev/manifest.json`);
  });
  return server;
}

const options = parseArgs(process.argv.slice(2));
await buildDevManifest(options);
serve(options);
