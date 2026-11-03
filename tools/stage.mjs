#!/usr/bin/env node
// Собрать содержимое сайта для GitHub Pages в _site/: сама страница плюс ассеты
// релиза, которые страница не может взять откуда ей сейчас указывает манифест.
//
//   node tools/stage.mjs
//
// Зачем это вообще существует: GitHub Releases CORS-заголовка не отдают — ни
// сам ответ github.com (302), ни CDN, куда он ведёт (замерено в браузере:
// fetch -> TypeError: Failed to fetch, а у api.github.com ACAO есть, но API-маршрут
// отдаёт тот же 302 на тот же CDN). Поэтому ассеты должны лежать на домене Pages:
// это тот же origin, что и у страницы, и CORS не нужен вовсе.
//
// Роли зафиксированы в манифесте:
//   manifest.source — откуда качать (релиз; качает сервер, CORS не нужен);
//   manifest.base   — откуда читает страница (домен Pages, assets/<version>/).
// Содержимое сверяется по SHA-256 из того же манифеста, так что подмена файла
// на любом из двух путей ловится ещё до публикации.
//
// _site/ в .gitignore: ассеты живут в релизе, а здесь — рабочая раскладка.

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SITE = join(ROOT, '_site');

// Страница по адресам относительно своего корня — копируем ровно то, на что
// ссылаются index.html и app.js, плюс манифест, плюс .nojekyll (безвреден и для
// deploy-pages, и напоминает, зачем он когда-то был нужен).
const STATIC = ['index.html', 'app.js', 'style.css', 'icons', 'lib', 'release'];

async function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function copyIntoSite(rel) {
  const from = join(ROOT, rel);
  const to = join(SITE, rel);
  const info = await stat(from).catch(() => null);
  if (!info) {
    throw new Error(`нет файла сайта: ${rel}`);
  }
  if (info.isDirectory()) {
    await mkdir(to, { recursive: true });
    const { readdir } = await import('node:fs/promises');
    for (const name of await readdir(from)) {
      await copyIntoSite(join(rel, name));
    }
    return;
  }
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function main() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'release', 'manifest.json'), 'utf8'));
  const { version, platforms } = manifest;
  const source = manifest.source || manifest.base;
  // Каталог ассетов называем как тег релиза (v1.0): тег и есть то, откуда
  // качаем, и путаница между "1.0" и "v1.0" здесь ничего не выигрывает.
  const suffix = `assets/v${version}/`;

  // Страница читает manifest.base — если там не то, куда ляжет деплой, сайт
  // опубликуется, но качать будет с чужого места. Ловим здесь, а не после.
  if (!String(manifest.base).endsWith(suffix)) {
    console.error(`manifest.base (${manifest.base}) не заканчивается на ${suffix}`);
    console.error('страница будет качать не оттуда, куда положил этот скрипт');
    process.exit(1);
  }

  await rm(SITE, { recursive: true, force: true });
  await mkdir(SITE, { recursive: true });
  for (const rel of STATIC) {
    await copyIntoSite(rel);
  }
  await writeFile(join(SITE, '.nojekyll'), '', 'utf8');

  const downloads = [];
  for (const [id, files] of Object.entries(platforms)) {
    for (const [name, expected] of Object.entries(files)) {
      downloads.push({ id, name, expected });
    }
  }

  console.log(`version ${version}`);
  console.log(`source  ${source}`);
  console.log(`base    ${manifest.base}`);
  let failed = 0;

  await Promise.all(
    downloads.map(async ({ id, name, expected }) => {
      const url = `${source}${name}`;
      const to = join(SITE, `assets/v${version}`, name);
      await mkdir(dirname(to), { recursive: true });
      let body;
      try {
        const response = await fetch(url, { redirect: 'follow' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        body = Buffer.from(await response.arrayBuffer());
      } catch (error) {
        failed += 1;
        console.log(`${id.padEnd(11)} ${name.padEnd(22)} СБОЙ скачивания: ${error.message}`);
        return;
      }
      const got = await sha256(body);
      if (got !== expected) {
        failed += 1;
        console.log(`${id.padEnd(11)} ${name.padEnd(22)} SHA-256 НЕ СОВПАЛ`);
        console.log(`   ожидалось ${expected}`);
        console.log(`   получено  ${got}`);
        return;
      }
      await writeFile(to, body);
      console.log(`${id.padEnd(11)} ${name.padEnd(22)} ${String(body.length).padStart(9)}  ok`);
    }),
  );

  if (failed) {
    console.error(`\n${failed} файл(ов) не прошли — сайт не собран`);
    await rm(SITE, { recursive: true, force: true });
    process.exit(1);
  }
  console.log(`\nсобрано: ${SITE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
