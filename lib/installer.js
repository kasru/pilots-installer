// Сборка пакета: описание платформ, проверка найденных файлов игры, скачивание
// бинарника порта из релиза и упаковка всего в один архив.

import { EXEC_MODE, FILE_MODE, ZipWriter } from './zip.js';

// layout: куда распаковывать архив. Switch — в корень карты памяти, чтобы получился
// sdmc:/switch/pilots, откуда движок и берёт данные, когда командной строки нет.
//
// asset — имя файла в релизе, name — имя внутри архива. Они расходятся только у SDL2:
// x86 и x64 кладут рядом одноимённые DLL, поэтому в релизе они различаются суффиксом.
export const PLATFORMS = [
  {
    id: 'win-x64',
    zip: 'pilots-windows-x64.zip',
    folder: 'pilots-windows-x64',
    instructions: 'windows',
    assets: [
      { asset: 'PILOTS_RE_x64.EXE', name: 'PILOTS_RE_x64.EXE', mode: EXEC_MODE },
      { asset: 'SDL2-x64.dll', name: 'SDL2.dll', local: 'SDL2.dll' },
    ],
  },
  {
    id: 'win-x86',
    zip: 'pilots-windows-x86.zip',
    folder: 'pilots-windows-x86',
    instructions: 'windows',
    assets: [
      { asset: 'PILOTS_RE.EXE', name: 'PILOTS_RE.EXE', mode: EXEC_MODE },
      { asset: 'SDL2-x86.dll', name: 'SDL2.dll', local: 'SDL2.dll' },
    ],
  },
  {
    id: 'switch',
    zip: 'pilots-switch.zip',
    folder: 'switch/pilots',
    instructions: 'switch',
    assets: [{ asset: 'PILOTS_RE.nro', name: 'PILOTS_RE.nro', mode: EXEC_MODE }],
  },
  {
    id: 'macos-i386',
    zip: 'pilots-macos-i386.zip',
    folder: 'pilots-macos-i386',
    instructions: 'macos',
    assets: [{ asset: 'PILOTS_RE', name: 'PILOTS_RE', mode: EXEC_MODE }],
  },
];

export function platformById(id) {
  return PLATFORMS.find((platform) => platform.id === id) || null;
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
export async function downloadAssets(platform, manifest, { onAsset = null, onBytes = null } = {}) {
  const files = manifest && manifest.platforms ? manifest.platforms[platform.id] : null;
  if (!files) {
    throw new Error(`no-release:${platform.id}`);
  }
  const base = String(manifest.base || '').replace(/\/?$/, '/');
  const assets = new Map();
  for (const asset of platform.assets) {
    const expected = files[asset.asset];
    if (!expected) {
      throw new Error(`no-asset:${asset.asset}`);
    }
    const url = `${base}${encodeURIComponent(asset.asset)}`;
    if (onAsset) {
      onAsset(asset.asset);
    }
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`download-failed:${asset.asset}:${response.status}`);
    }
    const parts = [];
    let received = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        parts.push(value);
        received += value.length;
        if (onBytes) {
          onBytes(value.length);
        }
      }
    } else {
      const buffer = new Uint8Array(await response.arrayBuffer());
      parts.push(buffer);
      received = buffer.length;
      if (onBytes) {
        onBytes(received);
      }
    }
    const blob = new Blob(parts);
    const actual = await sha256(blob);
    if (expected.toLowerCase() !== actual) {
      throw new Error(`bad-hash:${asset.asset}`);
    }
    assets.set(asset.asset, blob);
  }
  return assets;
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

// Собирает архив: бинарник порта, затем PILOTS.EXE и папка MOVIES из образа.
// Возвращает { name, blob }.
export async function buildPackage({ platform, game, binaries, onEntry = null, onProgress = null }) {
  const entries = [];
  for (const asset of platform.assets) {
    const blob = binaries.get(asset.asset);
    if (!blob) {
      throw new Error(`no-asset:${asset.asset}`);
    }
    entries.push({ path: `${platform.folder}/${asset.name}`, blob, mode: asset.mode });
  }
  entries.push({ path: `${platform.folder}/PILOTS.EXE`, blob: game.pilots.blob, mode: FILE_MODE });
  for (const movie of game.movies) {
    entries.push({ path: `${platform.folder}/${movie.path}`, blob: movie.blob, mode: FILE_MODE });
  }

  const total = entries.reduce((sum, entry) => sum + entry.blob.size, 0);
  const zip = new ZipWriter();
  for (const directory of directoriesOf(entries.map((entry) => entry.path))) {
    await zip.addDirectory(directory);
  }

  let done = 0;
  for (const entry of entries) {
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
  return { name: platform.zip, blob: zip.finish() };
}
