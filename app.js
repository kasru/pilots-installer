// Склейка страницы: выбор источника, платформы, сборка архива и скачивание.

import { openFolder, openIso } from './lib/iso.js';
import { buildPackage, canBuild, downloadAssets, inspectGame, PLATFORMS, platformById } from './lib/installer.js';
import { errorText, filesWord, formatSize, LANGS, t } from './lib/i18n.js';

const LANG_KEY = 'pilots.lang';
const el = {
  iso: document.getElementById('iso'),
  folder: document.getElementById('folder'),
  source: document.getElementById('source'),
  platforms: document.getElementById('platforms'),
  create: document.getElementById('create'),
  download: document.getElementById('download'),
  again: document.getElementById('again'),
  progress: document.getElementById('progress'),
  bar: document.getElementById('bar'),
  status: document.getElementById('status'),
  log: document.getElementById('log'),
  langs: document.getElementById('langs'),
};

const state = {
  lang: 'ru',
  source: null, // { kind: 'iso' | 'folder', name, files }
  game: null, // результат inspectGame
  platform: PLATFORMS[0].id,
  manifest: null,
  manifestError: null,
  busy: false,
  error: null, // последняя ошибка: держится, пока пользователь не начнёт заново
  result: null, // { name, blob, url, platform }
};

let downloadUrl = null;

// ---- язык ----

function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (LANGS.some((lang) => lang.code === saved)) {
      return saved;
    }
  } catch {
    /* приватный режим: localStorage может быть недоступен */
  }
  return (navigator.language || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function setLang(code) {
  if (!LANGS.some((lang) => lang.code === code)) {
    return;
  }
  state.lang = code;
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* нечего сохранять — не ошибка */
  }
  document.documentElement.lang = code;
  document.title = t(code, 'title');
  for (const button of el.langs.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', button.dataset.lang === code ? 'true' : 'false');
  }
  translateStatic();
  renderPlatforms();
  renderSource();
  renderResult();
  paintCreate();
  refreshStatus();
}

// Статичные тексты: data-i18n — простой текст, data-i18n-html — текст с разметкой.
function translateStatic() {
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(state.lang, node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-html]')) {
    node.innerHTML = t(state.lang, node.dataset.i18nHtml);
  }
}

// ---- источник игры ----

function folderName(files) {
  const first = files[0] ? files[0].webkitRelativePath || '' : '';
  return first.split('/')[0] || 'MOVIES';
}

async function chooseSource(kind, files) {
  if (state.busy) {
    return;
  }
  state.error = null;
  try {
    const source = kind === 'iso' ? await openIso(files) : openFolder(files);
    const game = await inspectGame(source);
    state.source = {
      kind,
      name: kind === 'iso' ? files.name : folderName(files),
      files: source.files.length,
    };
    state.game = game;
    clearResult();
    el.log.replaceChildren();
    el.log.hidden = true;
    el.progress.hidden = true;
    renderSource();
    paintCreate();
    refreshStatus();
  } catch (error) {
    state.source = null;
    state.game = null;
    state.error = error;
    renderSource();
    paintCreate();
    refreshStatus();
  }
}

function renderSource() {
  el.source.replaceChildren();
  if (!state.source) {
    el.source.hidden = true;
    return;
  }
  el.source.hidden = false;
  const rows = [];
  rows.push([t(state.lang, state.source.kind === 'iso' ? 'source.iso' : 'source.folder', { name: state.source.name })]);
  if (state.game && state.game.pilots) {
    rows.push([t(state.lang, 'source.pilots', { size: formatSize(state.game.pilots.size, state.lang) })]);
  }
  if (state.game && state.game.movies.length) {
    rows.push([
      t(state.lang, 'source.movies', {
        count: state.game.movies.length,
        files: filesWord(state.lang, state.game.movies.length),
        size: formatSize(state.game.moviesBytes, state.lang),
      }),
    ]);
  }
  for (const problem of state.game ? state.game.problems : []) {
    rows.push([t(state.lang, `problem.${problem}`), 'problem']);
  }
  for (const [text, kind] of rows) {
    const row = document.createElement('div');
    row.className = kind ? `row ${kind}` : 'row';
    const value = document.createElement('span');
    value.textContent = text;
    row.append(value);
    el.source.append(row);
  }
}

// ---- платформы ----

function platformAvailable(id) {
  return Boolean(state.manifest && state.manifest.platforms && state.manifest.platforms[id]);
}

function renderPlatforms() {
  el.platforms.replaceChildren();
  for (const platform of PLATFORMS) {
    const available = platformAvailable(platform.id);
    const label = document.createElement('label');
    label.className = ['platform', platform.id === state.platform ? 'is-checked' : '', available ? '' : 'is-disabled']
      .filter(Boolean)
      .join(' ');

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'platform';
    input.value = platform.id;
    input.checked = platform.id === state.platform;
    input.disabled = state.busy || !available;
    input.addEventListener('change', () => {
      state.platform = platform.id;
      state.error = null;
      clearResult();
      renderPlatforms();
      paintCreate();
      refreshStatus();
    });

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = t(state.lang, `platform.${platform.id}`);

    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = t(state.lang, `note.${platform.id}`);

    label.append(input, name, note);
    if (state.manifest && !platformAvailable(platform.id)) {
      const missing = document.createElement('span');
      missing.className = 'unavailable';
      missing.textContent = t(state.lang, 'platform.missing');
      label.append(missing);
    }
    el.platforms.append(label);
  }
}

// ---- статус, прогресс, журнал ----

function setStatus(text, kind = '') {
  state.status = { text, kind };
  paintStatus();
}

function paintStatus() {
  el.status.textContent = state.status ? state.status.text : '';
  el.status.className = state.status && state.status.kind ? `status ${state.status.kind}` : 'status';
}

function refreshStatus() {
  if (state.busy) {
    return;
  }
  if (state.result) {
    setStatus(instructionText(state.result.platform), 'ok');
    return;
  }
  if (state.error) {
    setStatus(errorText(state.lang, state.error), 'error');
    return;
  }
  if (location.protocol === 'file:') {
    setStatus(t(state.lang, 'status.fileProtocol'), 'error');
    return;
  }
  if (!state.manifest) {
    setStatus(t(state.lang, 'status.manifestMissing'), 'error');
    return;
  }
  if (!PLATFORMS.some((platform) => platformAvailable(platform.id))) {
    setStatus(t(state.lang, 'status.noRelease'), 'error');
    return;
  }
  if (!state.game) {
    setStatus(t(state.lang, 'status.noGame'));
    return;
  }
  const version = t(state.lang, 'status.manifest', { version: state.manifest.version || '' });
  setStatus(`${t(state.lang, 'status.ready')} ${version}`);
}

function instructionText(platform) {
  const executable = platform.assets.find((asset) => /\.exe$/i.test(asset.name));
  if (platform.instructions === 'windows') {
    return t(state.lang, 'instr.windows', { exe: executable ? executable.name : platform.assets[0].name });
  }
  return t(state.lang, `instr.${platform.instructions}`);
}

function setProgress(fraction) {
  el.progress.hidden = false;
  el.progress.classList.remove('indeterminate');
  el.bar.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
}

function setIndeterminate(active) {
  el.progress.hidden = !active;
  el.progress.classList.toggle('indeterminate', active);
  if (active) {
    el.bar.style.width = '';
  }
}

function logLine(text, done = false) {
  el.log.hidden = false;
  const item = document.createElement('li');
  item.textContent = text;
  if (done) {
    item.className = 'done';
  }
  el.log.append(item);
  el.log.scrollTop = el.log.scrollHeight;
}

// ---- кнопки и результат ----

function paintCreate() {
  const ready = canBuild(state.game) && Boolean(state.manifest) && platformAvailable(state.platform);
  el.create.hidden = Boolean(state.result);
  el.create.disabled = state.busy || !ready;
  el.create.textContent = t(state.lang, state.busy ? 'busy' : 'create');
}

function renderResult() {
  if (!state.result) {
    el.download.hidden = true;
    el.again.hidden = true;
    return;
  }
  el.download.hidden = false;
  el.download.href = state.result.url;
  el.download.download = state.result.name;
  el.download.textContent = t(state.lang, 'download', { name: state.result.name });
  el.again.hidden = false;
}

function clearResult() {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }
  state.result = null;
  renderResult();
  paintCreate();
}

async function create() {
  if (state.busy || !state.manifest || !canBuild(state.game)) {
    return;
  }
  const platform = platformById(state.platform);
  state.busy = true;
  state.error = null;
  clearResult();
  el.log.replaceChildren();
  el.log.hidden = true;
  el.bar.style.width = '0%';
  paintCreate();
  renderPlatforms();

  try {
    setStatus(t(state.lang, 'build.download', { name: platform.assets[0].asset }));
    setIndeterminate(true);
    const binaries = await downloadAssets(platform, state.manifest, {
      onAsset: (asset) => setStatus(t(state.lang, 'build.download', { name: asset })),
    });

    setIndeterminate(false);
    setProgress(0);
    const result = await buildPackage({
      platform,
      game: state.game,
      binaries,
      onEntry: (path, size) => {
        logLine(t(state.lang, 'build.entry', { path, size: formatSize(size, state.lang) }));
      },
      onProgress: (done, total) => setProgress(total ? done / total : 1),
    });

    setProgress(1);
    downloadUrl = URL.createObjectURL(result.blob);
    state.result = { ...result, url: downloadUrl, platform };
    el.progress.hidden = true; // сборка закончена: строка «Готово» в журнале и есть индикатор
    logLine(
      t(state.lang, 'build.done', { name: result.name, size: formatSize(result.blob.size, state.lang) }),
      true,
    );
    renderResult();
    setStatus(instructionText(platform), 'ok');
  } catch (error) {
    setIndeterminate(false);
    el.progress.hidden = true;
    state.error = error;
    logLine(errorText(state.lang, error));
  } finally {
    state.busy = false;
    paintCreate();
    renderPlatforms();
    refreshStatus();
  }
}

// ---- запуск ----

async function loadManifest() {
  if (location.protocol === 'file:') {
    state.manifestError = new Error('file-protocol');
    return;
  }
  const override = new URLSearchParams(location.search).get('manifest');
  const url = new URL(override || 'release/manifest.json', location.href);
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`manifest-http:${response.status}`);
    }
    const manifest = await response.json();
    if (!manifest || !manifest.platforms) {
      throw new Error('manifest-empty');
    }
    state.manifest = manifest;
  } catch (error) {
    state.manifestError = error;
  }
}

async function init() {
  setLang(detectLang());
  el.iso.addEventListener('change', () => {
    const file = el.iso.files && el.iso.files[0];
    if (file) {
      chooseSource('iso', file);
    }
  });
  el.folder.addEventListener('change', () => {
    if (el.folder.files && el.folder.files.length) {
      chooseSource('folder', el.folder.files);
    }
  });
  el.create.addEventListener('click', create);
  el.again.addEventListener('click', () => {
    state.error = null;
    clearResult();
    el.log.replaceChildren();
    el.log.hidden = true;
    el.progress.hidden = true;
    refreshStatus();
  });
  for (const button of el.langs.querySelectorAll('button')) {
    button.addEventListener('click', () => setLang(button.dataset.lang));
  }
  refreshStatus();

  await loadManifest();
  if (!platformAvailable(state.platform)) {
    const first = PLATFORMS.find((platform) => platformAvailable(platform.id));
    if (first) {
      state.platform = first.id;
    }
  }
  renderPlatforms();
  paintCreate();
  refreshStatus();
}

init();
