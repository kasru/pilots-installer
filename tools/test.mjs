#!/usr/bin/env node
// Проверка конвейера без браузера: читает настоящий образ диска, собирает пакеты для
// всех платформ и разбирает получившийся архив обратно — имена, размеры, CRC-32.
//
//   node tools/test.mjs [--iso ../pilots_re/PILOTS.iso] [--out dev/test]

import { openAsBlob } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFolder, openIso } from '../lib/iso.js';
import { buildPackage, canBuild, fullArchiveName, inspectGame, PLATFORMS } from '../lib/installer.js';
import { readArchive } from '../lib/archive.js';
import { crc32Update, EXEC_MODE, FILE_MODE, ZipWriter } from '../lib/zip.js';
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
// Имя другое, чем у читателя из lib/archive.js: здесь проверка свойств собранного
// zip, а там — превращение архива в записи.
function checkZip(bytes) {
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

// Содержимое архива релиза в тесте подделывается: страница его скачивает сама,
// а проверяется здесь сборка пакета. Имя бинарника — то, что лежит в настоящем
// архиве этой платформы (см. scripts/make_release_archives.ps1 в pilots_re).
const BINARIES = {
  'win-x64': 'PILOTS_RE_x64.EXE',
  'win-x86': 'PILOTS_RE.EXE',
  'linux-x64': 'PILOTS_RE_x64',
  'linux-386': 'PILOTS_RE',
  switch: 'PILOTS_RE.nro',
  'macos-i386': 'PILOTS_RE',
};

function fakeEntries(platform) {
  const binary = BINARIES[platform.id];
  if (!binary) {
    throw new Error(`нет бинарника для ${platform.id}`);
  }
  const blob = new Blob([new TextEncoder().encode(`test ${binary}\n${'.'.repeat(1024)}`)]);
  return { name: `pilots-re_1.0_${platform.id}.zip`, entries: [{ path: binary, blob, mode: EXEC_MODE }] };
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

  // Имя итогового пакета: архив релиза + постфикс -full, расширение всегда zip.
  const NAME_RULES = [
    ['pilots-re_1.0_windows_amd64.zip', 'pilots-re_1.0_windows-full_amd64.zip'],
    ['pilots-re_1.0_linux_amd64.tar.gz', 'pilots-re_1.0_linux-full_amd64.zip'],
    ['pilots-re_1.0_macos_i386.tar.gz', 'pilots-re_1.0_macos-full_i386.zip'],
    ['pilots-re_1.0_nintendo_switch.zip', 'pilots-re_1.0_nintendo_switch-full.zip'],
  ];
  for (const [from, to] of NAME_RULES) {
    if (fullArchiveName(from) !== to) {
      throw new Error(`fullArchiveName(${from}) = ${fullArchiveName(from)}, ожидалось ${to}`);
    }
  }
  console.log(`имена пакетов: ${NAME_RULES.length} правил`);

  // Читатель архивов: zip, собранный нашим же ZipWriter, обязан прочитаться
  // обратно — с теми же байтами и с правами, которые мы в него положили.
  // Это проверка lib/archive.js на том формате, который реально отдаёт релиз
  // (Stored, method 0).
  {
    const writer = new ZipWriter();
    await writer.add('PILOTS_RE', new Blob([new TextEncoder().encode('binary\n')]), { mode: EXEC_MODE });
    await writer.add('README.md', new Blob([new TextEncoder().encode('# readme\n')]), { mode: FILE_MODE });
    const read = await readArchive(writer.finish(), 'pilots-re_1.0_linux_amd64.zip');
    const byName = Object.fromEntries(read.map((entry) => [entry.path, entry]));
    if ((await byName['README.md'].blob.text()) !== '# readme\n') {
      throw new Error('readZip: содержимое не совпало');
    }
    if (byName['PILOTS_RE'].mode !== EXEC_MODE) {
      throw new Error('readZip: у бинарника пропал бит запуска');
    }
    if (byName['README.md'].mode !== FILE_MODE) {
      throw new Error('readZip: README стал исполняемым');
    }
    console.log(`читатель zip: ${read.length} записи, права на месте`);
  }

  await mkdir(options.out, { recursive: true });
  let saved = null;
  for (const platform of PLATFORMS) {
    const fake = fakeEntries(platform);
    const built = await buildPackage({
      platform,
      game,
      archive: fake.name,
      entries: fake.entries,
    });

    // Имя итогового пакета: к архиву релиза добавляется постфикс -full, и
    // расширение становится zip — независимо от того, .zip был или .tar.gz.
    const wanted = fullArchiveName(fake.name);
    if (built.name !== wanted) {
      throw new Error(`${platform.id}: имя пакета ${built.name}, ожидалось ${wanted}`);
    }

    const bytes = new Uint8Array(await built.blob.arrayBuffer());
    const archive = checkZip(bytes);
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
