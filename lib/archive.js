// Чтение архивов релиза: zip без сжатия и tar.gz.
//
// Релизные zip создаются с -mx=0 (Stored, method 0) — см.
// scripts/make_release_archives.ps1 в pilots_re: это позволяет прочитать их,
// не имея inflate. Дефлейт от .exe/.dll почти не выигрывает, а вот читатель
// становится тривиальным — обычным срезом байтов по заголовкам.
//
// tar.gz распаковывается через DecompressionStream('gzip'): он есть во всех
// браузерах, которые вообще умеют crypto.subtle, а без него установщик и так
// не работает — он проверяет SHA-256 скачанного архива.
//
// Права на файл берутся по имени, а не из архива: 7-Zip на Windows не знает
// unix-прав и пишет в tar 0777, так что по ним различить бинарник и README
// нельзя — а бинарник обязан получить бит запуска, а README нет.

import { EXEC_MODE, FILE_MODE } from './zip.js';

const decoder = new TextDecoder();

// PILOTS_RE, PILOTS_RE_x64, PILOTS_RE.EXE, PILOTS_RE.nro — всё, что должно
// быть исполняемым. SDL2.dll и документы остаются обычными файлами.
const EXECUTABLE = /(^|\/)PILOTS_RE/i;

function modeFor(name) {
  return EXECUTABLE.test(name) ? EXEC_MODE : FILE_MODE;
}

function cstr(bytes, offset, length) {
  let end = offset;
  const stop = offset + length;
  while (end < stop && bytes[end] !== 0) {
    end += 1;
  }
  return decoder.decode(bytes.subarray(offset, end));
}

// Возвращает [{ path, blob, mode }] — те же поля, что и у файлов игры, чтобы
// сборка пакета не различала, откуда запись пришла.
export async function readArchive(blob, name) {
  if (/\.zip$/i.test(name)) {
    return readZip(blob);
  }
  if (/\.tar\.gz$/i.test(name)) {
    return readTarGz(blob);
  }
  throw new Error(`unsupported-archive:${name}`);
}

async function readZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);

  // Конец центрального каталога (EOCD) ищется с конца: позади него может лежать
  // только комментарий, длина которого ограничена 64 КБ.
  let eocd = -1;
  const newest = bytes.length - 22;
  const oldest = Math.max(0, bytes.length - 22 - 65535);
  for (let i = newest; i >= oldest; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('zip-broken: конец центрального каталога не найден');
  }

  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('zip-broken: центральный каталог повреждён');
    }
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) {
      continue; // каталоги: файлы создаются сами, дерево собирает ZipWriter
    }
    if (method !== 0) {
      // Наш релиз обязан быть Stored; если он вдруг дефлейтнут — это не тот
      // архив, и честная ошибка лучше попытки читать неведомый формат.
      throw new Error(`zip-deflate:${name}`);
    }
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) {
      throw new Error('zip-broken: локальный заголовок повреждён');
    }
    const localNameLen = view.getUint16(local + 26, true);
    const localExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLen + localExtraLen;
    if (start + size > bytes.length) {
      throw new Error(`zip-broken: данные ${name} обрезаны`);
    }
    entries.push({
      path: name,
      blob: new Blob([bytes.subarray(start, start + size)]),
      mode: modeFor(name),
    });
  }

  if (!entries.length) {
    throw new Error('zip-broken: в архиве нет файлов');
  }
  return entries;
}

async function readTarGz(blob) {
  if (typeof DecompressionStream === 'undefined') {
    // Браузер старше, чем нужен: без crypto.subtle установщик не работает и
    // так, но эта проверка даёт внятное сообщение вместо «undefined function».
    throw new Error('no-compression-stream');
  }
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());

  const entries = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const head = bytes.subarray(offset, offset + 512);
    if (head.every((byte) => byte === 0)) {
      break; // конец архива: два блока нулей
    }
    // ustar: имя лежит целиком в первых 100 байтах, длинное — кусками
    // name + prefix (байты 345..500) через косую черту.
    let name = cstr(head, 0, 100);
    const prefix = cstr(head, 345, 155);
    if (prefix) {
      name = `${prefix}/${name}`;
    }
    const size = parseInt(cstr(head, 124, 12).trim(), 8) || 0;
    const type = String.fromCharCode(head[156]) || '0';
    offset += 512;

    if (type === '0' || type === '\0') {
      if (offset + size > bytes.length) {
        throw new Error(`tar-broken: данные ${name} обрезаны`);
      }
      entries.push({
        path: name,
        blob: new Blob([bytes.subarray(offset, offset + size)]),
        mode: modeFor(name),
      });
    }
    // '5' — каталог, 'x'/'g' — pax-метаданные, 'L'/'K' — длинные имена GNU:
    // всё это пропускаем: имена и размеры настоящих файлов лежат в обычных
    // заголовках, а pax-записи для наших коротких имён ничего не меняют.
    offset += Math.ceil(size / 512) * 512;
  }

  if (!entries.length) {
    throw new Error('tar-broken: в архиве нет файлов');
  }
  return entries;
}
