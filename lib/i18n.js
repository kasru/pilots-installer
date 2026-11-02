// Тексты интерфейса на русском и английском. Статичный текст в index.html помечен
// data-i18n (простой текст) или data-i18n-html (текст с разметкой), динамический
// собирается вызовами t() из app.js.

export const LANGS = [
  { code: 'ru', name: 'Русский' },
  { code: 'en', name: 'English' },
];

const TEXT = {
  ru: {
    title: 'Братья Пилоты: По следам полосатого слона',
    lead:
      'Собирает готовый пакет порта из вашей копии игры. Всё происходит в браузере: ' +
      'образ диска никуда не отправляется.',

    step1: '1. Выберите диск',
    step1Hint:
      'Образ диска <code>.iso</code> или папка с игрой — в ней должны быть <code>PILOTS.EXE</code> ' +
      'и <code>MOVIES</code>.',
    chooseIso: 'Образ диска (.iso)',
    chooseFolder: 'Папка с игрой',
    sourceHint:
      'Из образа читаются только <code>PILOTS.EXE</code> и папка <code>MOVIES</code>: ' +
      'остальное содержимое диска пропускается.',

    step2: '2. Выберите платформу',
    platformHint:
      'Архив собирается под одну платформу; для другой выберите её и создайте архив ещё раз.',

    'platform.win-x64': 'Windows x64',
    'platform.win-x86': 'Windows x86',
    'platform.linux-x64': 'Linux x86_64',
    'platform.switch': 'Nintendo Switch',
    'platform.macos-i386': 'macOS i386',
    'note.win-x64': 'PILOTS_RE_x64.EXE + SDL2.dll',
    'note.win-x86': 'PILOTS_RE.EXE + SDL2.dll',
    'note.linux-x64': 'самодостаточный PILOTS_RE_x64 (SDL2 и ffmpeg внутри)',
    'note.switch': 'PILOTS_RE.nro, данные в sdmc:/switch/pilots',
    'note.macos-i386': 'статический PILOTS_RE, macOS 10.13–10.14',
    'platform.missing': 'нет в релизе',

    step3: '3. Создайте архив',
    create: 'Создать архив',
    busy: 'Собираю…',
    download: 'Скачать {name}',
    again: 'Собрать ещё раз',

    'status.loading': 'Читаю манифест релиза…',
    'status.manifest': 'Бинарники порта: версия {version}',
    'status.manifestMissing':
      'Манифест релиза не загружен, собрать архив нельзя. Проверьте, что релиз опубликован и ' +
      'release/manifest.json лежит рядом со страницей.',
    'status.noRelease':
      'В манифесте нет ни одной платформы: релиз с бинарниками ещё не опубликован.',
    'status.fileProtocol':
      'Страница открыта как файл (file://), а браузер не разрешает ей читать ISO. Запустите ' +
      'локальный сервер, например «python -m http.server», и откройте http://localhost:8000.',
    'status.noGame': 'Сначала выберите образ диска или папку с игрой.',
    'status.ready': 'Можно собирать: выберите платформу и нажмите кнопку.',

    'source.iso': 'Образ: {name}',
    'source.folder': 'Папка: {name}',
    'source.pilots': 'PILOTS.EXE — {size}',
    'source.movies': 'MOVIES — {count} {files}, {size}',

    'problem.no-pilots': 'В этом источнике нет PILOTS.EXE.',
    'problem.bad-pilots':
      'PILOTS.EXE не похож на файл данных игры: ожидается около 48 МБ, с данными в хвосте файла.',
    'problem.no-movies': 'Папки MOVIES нет: игра запустится, но без фильмов.',

    'build.download': 'Скачиваю {name}…',
    'build.entry': '{path} — {size}',
    'build.done': 'Готово: {name}, {size}',

    'instr.windows': 'Распакуйте архив в любую папку и запустите {exe}.',
    'instr.linux':
      'Распакуйте архив и запустите ./PILOTS_RE_x64. Если файл не запускается, верните ему право ' +
      'на запуск: chmod +x PILOTS_RE_x64.',
    'instr.switch':
      'Распакуйте архив в корень карты памяти (sdmc:), получится sdmc:/switch/pilots. ' +
      'Запускайте PILOTS_RE.nro из hbmenu.',
    'instr.macos':
      'Распакуйте архив и запустите PILOTS_RE. Если macOS ругается на неизвестного разработчика, ' +
      'снимите карантин: xattr -d com.apple.quarantine PILOTS_RE.',

    legal:
      'Игра и её данные принадлежат правообладателям. Страница не хранит и не раздаёт файлы игры: ' +
      'ваш образ читается только в браузере и никуда не отправляется, а файлы из него попадают ' +
      'прямо в архив на вашем компьютере. Нужна своя легальная копия игры.',
    sourceLink: 'Исходный код порта',

    'error.iso-too-small': 'Файл слишком мал для образа диска.',
    'error.iso-not-iso9660': 'Файл не похож на образ ISO 9660.',
    'error.iso-no-root': 'В образе не найден корневой каталог.',
    'error.folder-empty': 'Папка пуста.',
    'error.no-release': 'Для платформы {platform} нет файлов в релизе.',
    'error.no-asset': 'В релизе нет файла {asset}.',
    'error.download-failed': 'Не удалось скачать {asset} (код {status}).',
    'error.bad-hash': 'Файл {asset} скачался повреждённым: SHA-256 не совпал.',
    'error.no-subtle-crypto': 'Браузер не даёт проверить SHA-256: нужен https или localhost.',
    'error.too-large': 'Файл {path} слишком велик для этого архива.',
    'error.generic': 'Ошибка: {message}',
  },

  en: {
    title: 'Pilots: In the Footsteps of the Striped Elephant',
    lead:
      'Builds a ready-to-run package of the port from your own copy of the game. Everything happens ' +
      'in your browser: the disc image is never uploaded.',

    step1: '1. Choose your disc',
    step1Hint:
      'The disc image (.iso) or a game folder containing <code>PILOTS.EXE</code> and <code>MOVIES</code>.',
    chooseIso: 'Disc image (.iso)',
    chooseFolder: 'Game folder',
    sourceHint:
      'Only <code>PILOTS.EXE</code> and the <code>MOVIES</code> folder are read from the image; ' +
      'the rest of the disc is skipped.',

    step2: '2. Choose a platform',
    platformHint: 'One archive per platform: pick another one and build again for it.',

    'platform.win-x64': 'Windows x64',
    'platform.win-x86': 'Windows x86',
    'platform.linux-x64': 'Linux x86_64',
    'platform.switch': 'Nintendo Switch',
    'platform.macos-i386': 'macOS i386',
    'note.win-x64': 'PILOTS_RE_x64.EXE + SDL2.dll',
    'note.win-x86': 'PILOTS_RE.EXE + SDL2.dll',
    'note.linux-x64': 'self-contained PILOTS_RE_x64 (SDL2 and ffmpeg inside)',
    'note.switch': 'PILOTS_RE.nro, data in sdmc:/switch/pilots',
    'note.macos-i386': 'static PILOTS_RE, macOS 10.13–10.14',
    'platform.missing': 'not in the release',

    step3: '3. Create the archive',
    create: 'Create the archive',
    busy: 'Building…',
    download: 'Download {name}',
    again: 'Build another',

    'status.loading': 'Reading the release manifest…',
    'status.manifest': 'Port binaries: version {version}',
    'status.manifestMissing':
      'The release manifest could not be loaded, so nothing can be built. Check that the release ' +
      'is published and release/manifest.json sits next to this page.',
    'status.noRelease':
      'The manifest lists no platforms: the release with the binaries is not published yet.',
    'status.fileProtocol':
      'The page was opened as a file (file://) and the browser will not let it read the ISO. Start a ' +
      'local server, for example "python -m http.server", and open http://localhost:8000.',
    'status.noGame': 'Choose a disc image or a game folder first.',
    'status.ready': 'Ready: choose a platform and press the button.',

    'source.iso': 'Image: {name}',
    'source.folder': 'Folder: {name}',
    'source.pilots': 'PILOTS.EXE — {size}',
    'source.movies': 'MOVIES — {count} {files}, {size}',

    'problem.no-pilots': 'There is no PILOTS.EXE in this source.',
    'problem.bad-pilots':
      'This PILOTS.EXE does not look like the game data file: about 48 MB is expected, with the ' +
      'data appended to the end of the file.',
    'problem.no-movies': 'There is no MOVIES folder: the game will start, but without cutscenes.',

    'build.download': 'Downloading {name}…',
    'build.entry': '{path} — {size}',
    'build.done': 'Done: {name}, {size}',

    'instr.windows': 'Extract the archive anywhere and run {exe}.',
    'instr.linux':
      'Extract the archive and run ./PILOTS_RE_x64. If it refuses to start, restore the executable ' +
      'bit: chmod +x PILOTS_RE_x64.',
    'instr.switch':
      'Extract the archive to the root of the SD card (sdmc:), which gives sdmc:/switch/pilots. ' +
      'Start PILOTS_RE.nro from hbmenu.',
    'instr.macos':
      'Extract the archive and run PILOTS_RE. If macOS complains about an unidentified developer, ' +
      'clear the quarantine flag: xattr -d com.apple.quarantine PILOTS_RE.',

    legal:
      'The game and its data belong to their rights holders. This page neither stores nor ' +
      'distributes game files: your image is read inside the browser only and is never uploaded, ' +
      'and its files go straight into the archive on your computer. You need your own legally ' +
      'obtained copy of the game.',
    sourceLink: 'Port source code',

    'error.iso-too-small': 'The file is too small to be a disc image.',
    'error.iso-not-iso9660': 'The file does not look like an ISO 9660 image.',
    'error.iso-no-root': 'The image has no root directory.',
    'error.folder-empty': 'The folder is empty.',
    'error.no-release': 'The release has no files for {platform}.',
    'error.no-asset': 'The release has no {asset}.',
    'error.download-failed': 'Could not download {asset} (code {status}).',
    'error.bad-hash': '{asset} arrived corrupted: SHA-256 does not match.',
    'error.no-subtle-crypto': 'The browser will not verify SHA-256 here: https or localhost is needed.',
    'error.too-large': '{path} is too large for this archive.',
    'error.generic': 'Error: {message}',
  },
};

export function t(lang, key, params = {}) {
  const table = TEXT[lang] || TEXT.ru;
  let text = Object.hasOwn(table, key) ? table[key] : TEXT.ru[key];
  if (text === undefined) {
    return key;
  }
  for (const [name, value] of Object.entries(params)) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

// Ошибки из lib/ собираются как «код:аргумент:аргумент» и здесь превращаются в текст.
export function errorText(lang, error, params = {}) {
  const message = error && error.message ? error.message : String(error);
  const [code, ...rest] = message.split(':');
  const values = { ...params };
  if (rest.length) {
    values.message = rest.join(':');
  }
  if (code === 'no-release') {
    values.platform = rest[0] || '';
  } else if (code === 'no-asset' || code === 'bad-hash') {
    values.asset = rest[0] || '';
  } else if (code === 'download-failed') {
    values.asset = rest[0] || '';
    values.status = rest[1] || '';
  } else if (code === 'too-large') {
    values.path = rest[0] || '';
  }
  const known = TEXT[lang] && Object.hasOwn(TEXT[lang], `error.${code}`);
  return t(lang, known ? `error.${code}` : 'error.generic', values);
}

export function formatSize(bytes, lang) {
  const units = lang === 'en' ? ['B', 'KB', 'MB', 'GB'] : ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  const number = new Intl.NumberFormat(lang, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${number} ${units[unit]}`;
}

// «1 файл», «2 файла», «6 файлов» — в английском форма всего две.
export function filesWord(lang, count) {
  if (lang === 'en') {
    return count === 1 ? 'file' : 'files';
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return 'файл';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'файла';
  }
  return 'файлов';
}
