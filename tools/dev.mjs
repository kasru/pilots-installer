#!/usr/bin/env node
// Локальная проверка страницы до публикации релиза: собирает dev/manifest.json из
// архивов релиза, кладёт их в dev/assets и поднимает статический сервер.
//
//   node tools/dev.mjs [--port 8000] [--iso ../pilots_re/PILOTS.iso]
//       [--archives <каталог с архивами>]
//       [--win-x64 <файл>] [--win-x86 <файл>] [--linux-x64 <файл>]
//       [--linux-386 <файл>] [--switch <файл>] [--macos-i386 <файл>]
//
// По умолчанию архивы ищутся в release-archives/ рядом с этой страницей —
// положите туда то, что собрал scripts/make_release_archives.ps1 из pilots_re.
// Каталога нет или в нём нет архива какой-то платформы — она просто не
// попадёт в манифест, и страница честно покажет её отсутствующей.
// Флаг --<платформа> <файл> переопределяет путь для одной платформы.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
  '.gz': 'application/gzip',
  '.iso': 'application/iso9660-image',
};

// Чем заканчивается имя архива платформы: pilots-re_<версия>_<суффикс>.
// Суффикса достаточно, чтобы найти файл в каталоге, не зная версию.
const ARCHIVE_SUFFIX = {
  'win-x64': 'windows_amd64.zip',
  'win-x86': 'windows_386.zip',
  'linux-x64': 'linux_amd64.tar.gz',
  'linux-386': 'linux_386.tar.gz',
  'macos-i386': 'macos_i386.tar.gz',
  switch: 'nintendo_switch.zip',
};

function parseArgs(argv) {
  const options = {
    port: 8000,
    archives: join(ROOT, 'release-archives'),
    files: new Map(),
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
    } else if (arg === '--archives' && value) {
      options.archives = resolve(value);
      i += 1;
    } else if (arg.startsWith('--') && PLATFORMS.some((platform) => platform.id === arg.slice(2)) && value) {
      options.files.set(arg.slice(2), resolve(value));
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

// Ищет архив платформы: явный путь из аргументов, иначе файл с нужным суффиксом
// в каталоге --archives.
async function findArchive(options, platform) {
  const explicit = options.files.get(platform.id);
  if (explicit) {
    const info = await stat(explicit).catch(() => null);
    return info && info.isFile() ? explicit : null;
  }
  const suffix = ARCHIVE_SUFFIX[platform.id];
  if (!suffix) {
    return null;
  }
  const names = await readdir(options.archives).catch(() => []);
  const hit = names.find((name) => name.endsWith(suffix));
  return hit ? join(options.archives, hit) : null;
}

// Копирует архивы в dev/assets и пишет dev/manifest.json: имя файла — имя в
// релизе, поэтому локально страница видит ровно то, что увидит на боевой.
async function buildDevManifest(options) {
  const assetsDir = join(ROOT, 'dev', 'assets');
  // Скатываем старое: в dev/assets могли лежать файлы прошлого запуска (раньше
  // это были отдельные бинарники, теперь — архивы), и страница подхватила бы их
  // вместе с новыми.
  await rm(assetsDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });
  const platforms = {};

  for (const platform of PLATFORMS) {
    const source = await findArchive(options, platform);
    if (!source) {
      console.log(`${platform.id}: архив не найден — платформа останется недоступной`);
      continue;
    }
    const info = await stat(source);
    const name = source.split(/[\\/]/).pop();
    await copyFile(source, join(assetsDir, name));
    platforms[platform.id] = { [name]: await sha256(source) };
    console.log(`${platform.id}: ${name} (${info.size} B)`);
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
