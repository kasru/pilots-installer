#!/usr/bin/env node
// Проверка конвейера без браузера: читает настоящий образ диска, собирает пакеты для
// всех платформ и разбирает получившийся архив обратно — имена, размеры, CRC-32.
//
//   node tools/test.mjs [--iso ../pilots_re/PILOTS.iso] [--out dev/test]

import { openAsBlob } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFolder, openIso } from '../lib/iso.js';import { buildPackage, canBuild, inspectGame, PLATFORMS } from '../lib/installer.js';
import { crc32Update } from '../lib/zip.js';
import { filesWord, formatSize } from '../lib/i18n.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const EXPECTED = ['PILOTS.EXE', 'MOVIES/INTRO.AVI', 'MOVIES/START.AVI', 'MOVIES/FINAL.AVI'];

function args(argv) {
  const options = { iso: join(ROOT, '..', 'pilots_re', 'PILOTS.iso'), out: join(ROOT, 'dev', 'test') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--iso' && argv[i + 1]) {
      options.iso = resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--out' && argv[i + 1]) {
      options.out = resolve(argv[i + 1]);
      i += 1;
    }
  }
  return options;
}

// Разбор архива «с другого конца»: конец центрального каталога, сам каталог, локальные
// заголовки и CRC данных. Не тот код, что писал архив, поэтому опечатка в смещениях видна.
function readArchive(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) {
    throw new Error('no end of central directory');
  }
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  const entries = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) {
      throw new Error(`bad central record at ${at}`);
    }
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const uncompressed = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (view.getUint32(offset, true) !== 0x04034b50) {
      throw new Error(`${name}: bad local header`);
    }
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    const data = bytes.subarray(offset + 30 + localName + localExtra, offset + 30 + localName + localExtra + compressed);
    const actual = crc32Update(0, data);
    entries.push({ name, size: uncompressed, crc, ok: actual === crc && compressed === uncompressed });
  }
  return { entries, size, start };
}

function fakeBinaries(platform) {
  const binaries = new Map();
  for (const asset of platform.assets) {
    binaries.set(asset.asset, new Blob([new TextEncoder().encode(`test ${asset.asset}\n${'.'.repeat(1024)}`)]));
  }
  return binaries;
}

async function main() {
  const options = args(process.argv.slice(2));
  console.log(`образ: ${options.iso}`);
  const image = await openAsBlob(options.iso);
  console.log(`размер: ${formatSize(image.size, 'ru')}`);

  const started = Date.now();
  const iso = await openIso(image);
  console.log(`файлов в образе: ${iso.files.length}, разбор за ${Date.now() - started} мс`);

  for (const path of EXPECTED) {
    const file = iso.find(path);
    if (!file) {
      throw new Error(`в образе нет ${path}`);
    }
    if (file.size === 0) {
      throw new Error(`${path} пуст`);
    }
  }

  const game = await inspectGame(iso);
  if (game.problems.length) {
    throw new Error(`проверка игры: ${game.problems.join(', ')}`);
  }
  if (!canBuild(game)) {
    throw new Error('canBuild отверг настоящий образ');
  }
  console.log(
    `игра: PILOTS.EXE ${formatSize(game.pilots.size, 'ru')}, ` +
      `MOVIES — ${game.movies.length} ${filesWord('ru', game.movies.length)} на ` +
      `${formatSize(game.moviesBytes, 'ru')}`,
  );

  // Выбор папки: общая верхняя папка, которую дописывает сам выбор, должна отрезаться.
  const folder = openFolder([
    { name: 'PILOTS.EXE', webkitRelativePath: 'pilots/PILOTS.EXE', size: 1 },
    { name: 'INTRO.AVI', webkitRelativePath: 'pilots/MOVIES/INTRO.AVI', size: 1 },
  ]);
  const folderPaths = folder.files.map((file) => file.path).join(',');
  if (folderPaths !== 'MOVIES/INTRO.AVI,PILOTS.EXE') {
    throw new Error(`openFolder: неожиданные пути ${folderPaths}`);
  }
  console.log(`папка: ${folderPaths}`);

  await mkdir(options.out, { recursive: true });
  let saved = null;
  for (const platform of PLATFORMS) {
    const built = await buildPackage({
      platform,
      game,
      binaries: fakeBinaries(platform),
    });
    const bytes = new Uint8Array(await built.blob.arrayBuffer());
    const archive = readArchive(bytes);
    const broken = archive.entries.filter((entry) => !entry.ok);
    if (broken.length) {
      throw new Error(`${platform.id}: повреждены ${broken.map((entry) => entry.name).join(', ')}`);
    }
    const names = archive.entries.map((entry) => entry.name);
    const root = `${platform.folder}/`;
    const data = names.filter((name) => name.startsWith(`${root}MOVIES/`) && !name.endsWith('/'));
    if (!names.includes(`${root}PILOTS.EXE`)) {
      throw new Error(`${platform.id}: в архиве нет PILOTS.EXE`);
    }
    if (data.length !== game.movies.length) {
      throw new Error(`${platform.id}: фильмов ${data.length}, ожидалось ${game.movies.length}`);
    }
    if (names.some((name) => /^(DEMO|WIN32S)\//i.test(name.replace(root, '')))) {
      throw new Error(`${platform.id}: в архив попал лишний каталог диска`);
    }
    console.log(
      `${platform.id.padEnd(11)} ${built.name}: ${archive.entries.length} записей, ` +
        `${formatSize(bytes.length, 'ru')}, всё сходится`,
    );
    saved ||= { name: built.name, bytes };
  }

  const path = join(options.out, saved.name);
  await writeFile(path, saved.bytes);
  console.log(`\nархив для внешней проверки: ${path}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
