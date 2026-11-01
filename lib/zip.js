// ZIP без сжатия (method 0). Данные игры уже сжаты LZSS внутри PILOTS.EXE, а готовый
// бинарник порта и AVI сжимаются плохо: deflate только отнимал бы время. Байты файла
// не копируются — Blob-срез образа кладётся в архив как есть, потоком считается лишь
// CRC-32, без которого не собрать ни заголовок, ни центральный каталог.

const encoder = new TextEncoder();
const CHUNK = 8 * 1024 * 1024;

// CRC-32 (полином 0xEDB88320), по восемь байт за шаг: 60 МБ данных проходят за доли секунды.
const TABLE = (() => {
  const table = new Uint32Array(256 * 8);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  for (let i = 0; i < 256; i++) {
    for (let k = 1; k < 8; k++) {
      table[k * 256 + i] = (table[(k - 1) * 256 + i] >>> 8) ^ table[table[(k - 1) * 256 + i] & 0xff];
    }
  }
  return table;
})();

export function crc32Update(crc, data) {
  const t = TABLE;
  const n = data.length;
  let c = ~crc >>> 0;
  let i = 0;
  for (; i + 8 <= n; i += 8) {
    c ^= data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    c =
      t[7 * 256 + (c & 0xff)] ^
      t[6 * 256 + ((c >>> 8) & 0xff)] ^
      t[5 * 256 + ((c >>> 16) & 0xff)] ^
      t[4 * 256 + (c >>> 24)] ^
      t[3 * 256 + data[i + 4]] ^
      t[2 * 256 + data[i + 5]] ^
      t[256 + data[i + 6]] ^
      t[data[i + 7]];
  }
  for (; i < n; i++) {
    c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return ~c >>> 0;
}

export async function crc32OfBlob(blob, onBytes = null) {
  let crc = 0;
  for (let offset = 0; offset < blob.size; offset += CHUNK) {
    const end = Math.min(offset + CHUNK, blob.size);
    const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    crc = crc32Update(crc, bytes);
    if (onBytes) {
      onBytes(bytes.length);
    }
  }
  return crc >>> 0;
}

function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function utf8Flag(name) {
  return name.some((byte) => byte >= 0x80) ? 0x0800 : 0;
}

export const FILE_MODE = 0o100644;
export const EXEC_MODE = 0o100755;
export const DIR_MODE = 0o040755;

export class ZipWriter {
  constructor() {
    this.parts = [];
    this.entries = [];
    this.offset = 0;
    this.stamp = dosDateTime(new Date());
  }

  // path — имя внутри архива (разделитель «/»), blob — содержимое, mode — права Unix
  // в старшем слове внешних атрибутов: их понимают macOS и Linux, Windows их не читает.
  async add(path, blob, { mode = FILE_MODE, onBytes = null } = {}) {
    if (blob.size >= 0xffffffff) {
      throw new Error(`too-large: ${path}`);
    }
    const name = encoder.encode(path);
    const flag = utf8Flag(name);
    const crc = await crc32OfBlob(blob, onBytes);
    const start = this.offset;

    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // локальный заголовок
    view.setUint16(4, 20, true); // нужная версия: 2.0
    view.setUint16(6, flag, true);
    view.setUint16(8, 0, true); // без сжатия
    view.setUint16(10, this.stamp.time, true);
    view.setUint16(12, this.stamp.day, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, blob.size, true);
    view.setUint32(22, blob.size, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true); // дополнительных полей нет
    header.set(name, 30);

    this.push(header);
    this.parts.push(blob);
    this.offset += blob.size;
    this.entries.push({ name, flag, crc, size: blob.size, start, mode });
  }

  // Явные записи каталогов: так распаковщики создают дерево сразу, а не по первому файлу.
  async addDirectory(path) {
    await this.add(path.replace(/\/?$/, '/'), new Blob([]), { mode: DIR_MODE });
  }

  push(bytes) {
    this.parts.push(bytes);
    this.offset += bytes.length;
  }

  finish() {
    const start = this.offset;
    for (const entry of this.entries) {
      const record = new Uint8Array(46 + entry.name.length);
      const view = new DataView(record.buffer);
      view.setUint32(0, 0x02014b50, true); // центральный каталог
      view.setUint16(4, 0x031e, true); // создано на Unix, версия 3.0
      view.setUint16(6, 20, true);
      view.setUint16(8, entry.flag, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, this.stamp.time, true);
      view.setUint16(14, this.stamp.day, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.name.length, true);
      view.setUint16(30, 0, true); // доп. поля
      view.setUint16(32, 0, true); // комментарий
      view.setUint16(34, 0, true); // номер диска
      view.setUint16(36, 0, true); // внутренние атрибуты
      view.setUint32(38, (entry.mode << 16) >>> 0, true);
      view.setUint32(42, entry.start, true);
      record.set(entry.name, 46);
      this.push(record);
    }

    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true); // конец центрального каталога
    view.setUint16(8, this.entries.length, true);
    view.setUint16(10, this.entries.length, true);
    view.setUint32(12, this.offset - start, true);
    view.setUint32(16, start, true);
    this.push(end);

    return new Blob(this.parts, { type: 'application/zip' });
  }
}
