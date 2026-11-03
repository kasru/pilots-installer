// Сборка пакета: описание платформ, проверка найденных файлов игры, скачивание
// архива релиза и упаковка его содержимого вместе с игрой в один zip.
//
// Раньше страница качала по файлу на бинарник; теперь релиз отдаёт готовые
// архивы (pilots-re_<версия>_<платформа>.zip/.tar.gz) и установщик делает
// ровно то, что написано на банке: скачивает архив, распаковывает его и
// добавляет туда свои файлы игры. На выходе — тот же архив с постфиксом -full.

import { readArchive } from './archive.js';
import { FILE_MODE, ZipWriter } from './zip.js';

// layout: куда распаковывать архив. Switch — в корень карты памяти, чтобы получился
// sdmc:/switch/pilots, откуда движок и берёт данные, когда командной строки нет.
//
// Имена файлов релиза здесь не нужны: архив приходит из манифеста
// (manifest.platforms[id] — единственный файл платформы и его SHA-256), а
// имя итогового пакета вычисляется из него же (fullArchiveName).
export const PLATFORMS = [
  { id: 'win-x64', folder: 'pilots-windows-x64', instructions: 'windows' },
  { id: 'win-x86', folder: 'pilots-windows-x86', instructions: 'windows' },
  { id: 'linux-x64', folder: 'pilots-linux-x64', instructions: 'linux' },
  { id: 'linux-386', folder: 'pilots-linux-386', instructions: 'linux386' },
  { id: 'switch', folder: 'switch/pilots', instructions: 'switch' },
  { id: 'macos-i386', folder: 'pilots-macos-i386', instructions: 'macos' },
];

export function platformById(id) {
  return PLATFORMS.find((platform) => platform.id === id) || null;
}

// Имя архива платформы в манифесте: ровно один файл на платформу, и это имя
// же подставляется в статус «Скачиваю …» до того, как файл скачан.
export function archiveNameOf(platform, manifest) {
  const files = manifest && manifest.platforms ? manifest.platforms[platform.id] : null;
  const names = files ? Object.keys(files) : [];
  return names.length === 1 ? names[0] : '';
}

// Оригинальный PILOTS.EXE — 48 МБ: в хвост файла дописаны данные игры. Собранный
// заново движок без хвоста весит около мегабайта, и по размеру это видно сразу.
const GAME_MIN = 32 * 1024 * 1024;
const GAME_MAX = 96 * 1024 * 1024;

// Возвращает { pilots, movies, moviesBytes, problems }.
// problems: 'no-pilots' | 'bad-pilots' | 'no-movies'; первые два не дают собрать пакет.
export async function inspectGame(source) {
  const pilots = source.find('PILOTS.EXE');
  const movies = source.files.filter((file) => /^MOVIES\//i.test(file.path));
  const problems = [];
  if (!pilots) {
    problems.push('no-pilots');
  } else {
    const head = new Uint8Array(await pilots.blob.slice(0, 2).arrayBuffer());
    const executable = head.length === 2 && head[0] === 0x4d && head[1] === 0x5a;
    if (!executable || pilots.size < GAME_MIN || pilots.size > GAME_MAX) {
      problems.push('bad-pilots');
    }
  }
  if (!movies.length) {
    problems.push('no-movies');
  }
  return {
    pilots: pilots || null,
    movies,
    moviesBytes: movies.reduce((sum, file) => sum + file.size, 0),
    problems,
  };
}

export function canBuild(game) {
  return Boolean(game) && !game.problems.includes('no-pilots') && !game.problems.includes('bad-pilots');
}

async function sha256(blob) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('no-subtle-crypto');
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Скачивает файлы платформы по манифесту релиза и сверяет каждый с его SHA-256.
// manifest.base — каталог релиза, manifest.platforms[id] — { имя файла: sha256 }.
// Скачивает архив платформы из релиза, сверяет SHA-256 с манифестом и
// распаковывает его. Возвращает { name, entries }, где entries —
// [{ path, blob, mode }]: те же поля, что у файлов игры, чтобы сборка пакета
// не различала, откуда запись пришла.
//
// manifest.platforms[id] у манифеста с архивами — ровно один файл: его имя и
// его хеш. Больше файлов на платформу не бывает, поэтому лишние считаются
// ошибкой манифеста, а не «какой-то из них».
export async function downloadArchive(platform, manifest, { onAsset = null, onBytes = null } = {}) {
  const files = manifest && manifest.platforms ? manifest.platforms[platform.id] : null;
  if (!files) {
    throw new Error(`no-release:${platform.id}`);
  }
  const names = Object.keys(files);
  if (names.length !== 1) {
    throw new Error(`no-archive:${platform.id}`);
  }
  const name = names[0];
  const expected = files[name];
  const base = String(manifest.base || '').replace(/\/?$/, '/');

  if (onAsset) {
    onAsset(name);
  }
  const response = await fetch(`${base}${encodeURIComponent(name)}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`download-failed:${name}:${response.status}`);
  }

  const parts = [];
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parts.push(value);
      if (onBytes) {
        onBytes(value.length);
      }
    }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer());
    parts.push(buffer);
    if (onBytes) {
      onBytes(buffer.length);
    }
  }

  const blob = new Blob(parts);
  const actual = await sha256(blob);
  if (expected.toLowerCase() !== actual) {
    throw new Error(`bad-hash:${name}`);
  }
  const entries = await readArchive(blob, name);
  return { name, entries };
}

// Имя итогового пакета: к архиву релиза добавляется постфикс -full, потому что
// внутри него теперь лежит не только то, что скачали, но и файлы игры.
//   pilots-re_1.0_windows_amd64.zip -> pilots-re_1.0_windows-full_amd64.zip
//   pilots-re_1.0_linux_amd64.tar.gz -> pilots-re_1.0_linux-full_amd64.zip
//   pilots-re_1.0_nintendo_switch.zip -> pilots-re_1.0_nintendo_switch-full.zip
// Расширение на выходе всегда zip — такую страницу собирает ZipWriter, и zip
// умеет распаковать любой проводник, в отличие от tar.gz.
export function fullArchiveName(archive) {
  let base = archive;
  if (/\.tar\.gz$/i.test(base)) {
    base = base.slice(0, -'.tar.gz'.length);
  } else if (/\.[^./]+$/i.test(base)) {
    base = base.replace(/\.[^./]+$/, '');
  }
  const arch = base.match(/^(.+)_(amd64|386|i386|arm64)$/);
  return arch ? `${arch[1]}-full_${arch[2]}.zip` : `${base}-full.zip`;
}

function directoriesOf(paths) {
  const directories = new Set();
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      directories.add(parts.slice(0, i).join('/'));
    }
  }
  return [...directories].sort();
}

// Собирает пакет: содержимое скачанного архива (бинарники, README, LICENSE),
// затем PILOTS.EXE и папка MOVIES из образа — то есть итоговый архив равен
// скачанному плюс файлы игры, ровно как обещает подпись на странице.
// Возвращает { name, blob }.
export async function buildPackage({ platform, game, archive, entries, onEntry = null, onProgress = null }) {
  const packaged = entries.map((entry) => ({
    path: `${platform.folder}/${entry.path}`,
    blob: entry.blob,
    mode: entry.mode,
  }));
  packaged.push({ path: `${platform.folder}/PILOTS.EXE`, blob: game.pilots.blob, mode: FILE_MODE });
  for (const movie of game.movies) {
    packaged.push({ path: `${platform.folder}/${movie.path}`, blob: movie.blob, mode: FILE_MODE });
  }

  const total = packaged.reduce((sum, entry) => sum + entry.blob.size, 0);
  const zip = new ZipWriter();
  for (const directory of directoriesOf(packaged.map((entry) => entry.path))) {
    await zip.addDirectory(directory);
  }

  let done = 0;
  for (const entry of packaged) {
    if (onEntry) {
      onEntry(entry.path, entry.blob.size);
    }
    await zip.add(entry.path, entry.blob, {
      mode: entry.mode,
      onBytes: (bytes) => {
        done += bytes;
        if (onProgress) {
          onProgress(done, total);
        }
      },
    });
  }
  return { name: fullArchiveName(archive), blob: zip.finish() };
}
