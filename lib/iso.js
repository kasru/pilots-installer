// Читает файловую систему игрового диска 1997 года (ISO 9660, без Joliet) через Blob.
// Сам образ в память не загружается: читаются только каталоги, а файл отдаётся
// срезом образа (Blob), поэтому его байты попадают в архив без промежуточной копии.

const SECTOR = 2048;
const MAX_DIRECTORY = 4 * 1024 * 1024; // каталог такого размера — уже не каталог этой игры
const MAX_DEPTH = 8;

function ascii(bytes, at, length) {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(bytes[at + i]);
  }
  return s;
}

function le32(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

async function read(blob, offset, length) {
  return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}

// Запись каталога: 33 байта полей и имя переменной длины. Оба поля «и туда, и обратно»
// (LE и BE) читаются как LE — они дублируют друг друга, и BE-половина не нужна.
function recordAt(bytes, at) {
  const length = bytes[at];
  if (length < 34 || at + length > bytes.length) {
    return null;
  }
  return {
    extent: le32(bytes, at + 2),
    size: le32(bytes, at + 10),
    directory: (bytes[at + 25] & 0x02) !== 0,
    nameLength: bytes[at + 32],
    name: ascii(bytes, at + 33, bytes[at + 32]),
  };
}

// "INTRO.AVI;1" -> "INTRO.AVI"; у каталогов номера версии нет.
function entryName(name) {
  return name.replace(/;[0-9]+$/, '').replace(/\.$/, '');
}

// Записи не пересекают границу сектора: нулевой байт длины означает «до конца сектора пусто».
async function listDirectory(blob, extent, size) {
  const bytes = await read(blob, extent * SECTOR, size);
  const records = [];
  let at = 0;
  while (at < bytes.length) {
    if (bytes[at] === 0) {
      at = (Math.floor(at / SECTOR) + 1) * SECTOR;
      continue;
    }
    const length = bytes[at];
    const record = recordAt(bytes, at);
    if (!record) {
      break;
    }
    at += length;
    if (record.nameLength === 1 && (record.name === '\0' || record.name === '\x01')) {
      continue; // «.» и «..» — сам каталог и родительский
    }
    records.push(record);
  }
  return records;
}

function index(files) {
  const byPath = new Map();
  for (const file of files) {
    byPath.set(file.path.toUpperCase(), file);
  }
  return {
    files,
    // Игра ищет файлы без учёта регистра; сравнение путей — так же.
    find(path) {
      return byPath.get(path.toUpperCase()) || null;
    },
  };
}

function comparePath(a, b) {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

// Возвращает { files: [{ path, size, blob }], find(path) } для образа диска.
export async function openIso(blob) {
  if (blob.size < 17 * SECTOR) {
    throw new Error('iso-too-small');
  }
  const descriptor = await read(blob, 16 * SECTOR, SECTOR);
  if (descriptor[0] !== 1 || ascii(descriptor, 1, 5) !== 'CD001') {
    throw new Error('iso-not-iso9660');
  }
  const root = recordAt(descriptor, 156);
  if (!root || !root.directory) {
    throw new Error('iso-no-root');
  }

  const files = [];
  const walk = async (extent, size, prefix, depth) => {
    if (depth > MAX_DEPTH || !size || size > MAX_DIRECTORY) {
      return;
    }
    for (const record of await listDirectory(blob, extent, size)) {
      const path = prefix ? `${prefix}/${entryName(record.name)}` : entryName(record.name);
      if (record.directory) {
        await walk(record.extent, record.size, path, depth + 1);
      } else {
        const start = record.extent * SECTOR;
        files.push({ path, size: record.size, blob: blob.slice(start, start + record.size) });
      }
    }
  };
  await walk(root.extent, root.size, '', 0);
  files.sort(comparePath);
  return index(files);
}

// Тот же вид списка для папки, выбранной в браузере: пути начинаются с PILOTS.EXE и MOVIES,
// общая верхняя папка (её дописывает сам выбор папки) отрезается.
export function openFolder(fileList) {
  const all = [...fileList];
  if (!all.length) {
    throw new Error('folder-empty');
  }
  const first = (all[0].webkitRelativePath || all[0].name).split('/');
  const strip = first.length > 1 ? `${first[0]}/` : '';
  const files = all.map((file) => {
    const relative = file.webkitRelativePath || file.name;
    const path = strip && relative.startsWith(strip) ? relative.slice(strip.length) : relative;
    return { path, size: file.size, blob: file };
  });
  files.sort(comparePath);
  return index(files);
}
