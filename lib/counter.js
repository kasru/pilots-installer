// Счётчик запусков: сколько раз открыли страницу и под какую платформу
// собирали архив. Нужен, чтобы понимать, какую сборку вообще качают.
//
// Два свойства обязательны:
//   1. Ничего не уходит, пока ENDPOINT пустой. Страница до этого момента была
//      полностью офлайн-честной («образ никуда не отправляется»), и пустой
//      ENDPOINT сохраняет это поведение: ни запроса, ни скрипта, ни 404.
//   2. Ошибки гасятся. Счётчик — не часть сборки: если сервис недоступен,
//      заблокирован или пользователь его режет в блокировщике, сборка архива
//      обязана пройти точно так же. Поэтому каждый вызов обёрнут в catch,
//      а сам скрипт подключается асинхронно и без ожидания.
//
// GoatCounter выбран потому, что он не ставит cookie и не сохраняет IP
// (отсюда и строка в подвале про «без cookie и без IP»): измерение не требует
// согласия и не спорит с тем, что страница ничего не выгружает.
//
// Как включить: вставьте сюда адрес своего счётчика
// (регистрация на goatcounter.com даёт https://<код>.goatcounter.com/count).
const ENDPOINT = '';

let ready = null;

function injectScript() {
  if (ENDPOINT === '') {
    return Promise.resolve(false);
  }
  if (window.goatcounter) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://gc.zgo.at/count.js';
    script.async = true;
    script.dataset.goatcounter = ENDPOINT;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

// Готовность счётчика: скрипт подключается один раз и без ожидания сборки.
export function initCounter() {
  if (!ready) {
    ready = injectScript().catch(() => false);
  }
  return ready;
}

// Событие вида /build/win-x64. path намеренно похож на адрес страницы:
// GoatCounter показывает их в одном списке, и по ним же считается лимит бесплатного
// тарифа, так что события должны быть немногословными.
export async function track(path) {
  try {
    await initCounter();
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      window.goatcounter.count({ path, event: true, title: path });
    }
  } catch {
    // счётчик — не часть сборки: его отказ не должен быть виден пользователю
  }
}
