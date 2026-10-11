# Stream Lists: Games & Movies — архитектура (v2, редизайн)

Twitch-расширение (Panel). Главный сценарий — **список фильмов на 50+ позиций**: что в очереди и что
уже посмотрели. Списки игр и «своё» — тот же механизм. Импорт фильмов из рулетки Pointauc.
Дизайн утверждён: [`docs/design/mockup-v5.html`](design/mockup-v5.html) (скриншоты — `mockup-v5*.png`).

## Решения пользователя (не менять без него)

- Статусы только **Очередь → Просмотрено**. «Смотрим сейчас» убран (фильм короткий, переключать неудобно).
- Дата просмотра ставится автоматически при «Просмотрено».
- Постеры и год — из TMDB, подбираются при добавлении; стримеру ничего не загружать.
- Тема по умолчанию «Лиловая лисичка» + выбор тем и своих цветов. Зрители видят тему стримера.
- Зрителю главное — прочитать длинный список и найти фильм («а это уже смотрели?»).

## Компоненты

| Часть | Что это | Кто видит |
|---|---|---|
| `extension/panel.html` | Поиск, Очередь / Просмотрено (по месяцам), постеры | Зрители |
| `extension/config.html` | Списки, очередь и просмотренное, добавление с TMDB, импорт из Pointauc, оформление | Стример |
| `worker/` | Cloudflare Worker + D1 — источник истины, прокси TMDB и Pointauc | — |
| Twitch Configuration Service + PubSub | Быстрый «снимок» для зрителей + обновления на лету | — |

## Поток данных

```
config.html ──JWT (broadcaster)──► Worker ──► D1 (все данные)
                                     ├──► TMDB (поиск фильмов, ключ только здесь)
                                     ├──► Pointauc API (лоты; токен зашифрован в D1)
                                     └──► Twitch Helix: снимок → config segment + PubSub broadcast
panel.html ◄── снимок из Twitch config (мгновенно) ── очередь + последние просмотренные + тема
           ◄── Worker GET (по запросу) ── вся история просмотренного и поиск
```

- Снимок ≤ 5 КБ: очередь (до ~25) + последние ~15 просмотренных + тема. Полное — с Worker.
- Авторизация: Twitch JWT в `Authorization`. Worker проверяет HS256 секретом расширения
  (base64-decoded). Писать может только `role = broadcaster`, канал берётся из JWT.
- Отправки в PubSub склеиваются (debounce ~1 с).

## Данные (D1)

```
lists:    id, channel_id, title, kind (movies | games | custom), created_at
items:    id, list_id, title, year, poster_path, tmdb_id, status (queue | watched),
          position, added_at, watched_at, source (manual | pointauc)
```

Сопоставление с Pointauc и поиск повторов — по нормализованному названию (trim + lowercase).
```
channels: channel_id, theme (JSON: { preset } | { primary, accent }), pointauc_token (AES-GCM)
```

Миграции: 0001 списки, 0002 channels, 0003 токен Pointauc. Данные фазы 1 не переносятся
(были только тестовые на канале автора).

## Worker API

| Метод | Путь | Кто | Что |
|---|---|---|---|
| GET | `/api/channel` | стример | все списки и элементы |
| POST/PATCH/DELETE | `/api/lists[/:id]` | стример | списки |
| PUT | `/api/lists/:id/order` | стример | порядок очереди (`ids` по порядку) |
| POST/PATCH/DELETE | `/api/items[/:id]` | стример | элементы, статус, порядок |
| POST | `/api/items/bulk` | стример | вставка «Списком» |
| GET | `/api/tmdb/search?q=&lang=` | стример | подсказки: название, год, постер (без ключа — 503, добавление без постера) |
| PUT/DELETE | `/api/pointauc/token` | стример | подключить (токен проверяется запросом к Pointauc, хранится AES-GCM) / отключить |
| GET | `/api/pointauc/lots?list_id=` | стример | лоты + статус: новый / в очереди · N / смотрели <дата>; импорт — `/api/items/bulk` с `source: pointauc` |
| PUT | `/api/theme` | стример | тема и цвета; тема идёт в снимок (`th`) |
| GET | `/api/viewer/channel` | любой JWT | все списки канала из JWT — панель грузит, только когда снимок урезан и нужен поиск или вся история |

Секреты Worker: `EXTENSION_SECRET`, `TMDB_API_KEY`, `TOKEN_ENCRYPTION_KEY`.
Адрес: `https://stream-lists.begidan32.workers.dev` (Cloudflare-аккаунт begidan32, D1 `stream-lists`).
CORS `*`: токен идёт в заголовке, не в cookie. Снимок — формат `v: 2` с короткими ключами (`worker/src/snapshot.ts`).

## Фронтенд

React 19 + Vite + TypeScript, Mantine (поведение: Combobox, Modal, Popover, ScrollArea) + Tailwind
(внешний вид), dnd-kit (порядок очереди), i18next ru/en, шрифты в сборке (@fontsource, latin + cyrillic):
Great Vibes (заголовки, кириллица в нём есть), Nunito 600–800 (текст). Тема — CSS-переменные: у пресета
4 цвета (`--bg`, `--primary-hi`, `--primary-lo`, `--accent`, см. `app/presets.ts`), стекло, чипы и сияние
выводятся из них через `color-mix()` в `app/styles.css`; Mantine перекрашивается через `cssVariablesResolver`.
Пресеты: Лиловая лисичка, Twitch, Закат, Мята, Лёд, Вишня + свои цвета. Всегда тёмная (тема стримера,
а не светлая/тёмная Twitch). Витрина компонентов: `npm run dev` → `/ui.html` (в сборку не входит).
Структура по соглашениям Pointauc (`AGENTS.md`):

```
extension/src/
  app/                       провайдеры, тема (пресеты → CSS-переменные)
  pages/{panel,config}/      композиция экранов
  domains/lists/             списки, элементы, очередь/просмотрено, группировка по месяцам
  domains/movies/            поиск TMDB, постеры
  domains/integrations/pointauc/  импорт лотов
  domains/appearance/        экран «Оформление»
  shared/{twitch,api,ui}/    Twitch.ext + имитация, клиент Worker, стеклянные компоненты
```

## Этапы реализации

Статус (2026-10-02): 1–7 сделаны и проверены локально; 2–7 закоммичены, но не запушены и Worker с ними не выложен.
Материалы ревью — [`docs/review/`](review/README.md).

| # | Что | Проверка | Нужно от пользователя |
|---|---|---|---|
| 1 | Worker + D1: авторизация, списки/элементы, снимок в Twitch | тесты + локально через wrangler | аккаунт Cloudflare, `wrangler login`, секрет расширения |
| 2 | Тема, шрифты, стеклянные компоненты | скриншоты | — |
| 3 | Окно стримера: списки, очередь, просмотренное, «Списком» | скриншоты | — |
| 4 | TMDB: подсказки с постерами, год | скриншоты | ключ TMDB (бесплатно) |
| 5 | Панель зрителя: поиск, вкладки, по месяцам | скриншоты | — |
| 6 | Импорт из Pointauc | на реальном аукционе | токен Pointauc (вводит в окне расширения) |
| 7 | «Оформление»: темы и свои цвета | скриншоты | — |
| 8 | Тест на Twitch → материалы → ревью | на канале | «да» на отправку |

В консоли Twitch перед ревью: адрес Worker — в белый список запросов, `image.tmdb.org` — в белый
список изображений (оба замораживаются после ревью). В описание — атрибуция TMDB.

## Ограничения Twitch

- Сегмент конфигурации — 5 КБ; панель — 318×до 500 px; окно настроек — 700 px высотой.
- Helper Twitch грузится только с их CDN, без SRI (файл обновляется на месте).
- Chrome 142+ (Local Network Access) не пускает `localhost` внутрь twitch.tv — проверка на Twitch
  через «Тест на сервере» (zip в консоль), разработка — в браузере с имитацией Twitch.
- В HTML стоит `<meta name="darkreader-lock">`: Dark Reader иначе перекрашивает iframe.

## Разработка

```
npm run dev          # extension: http://[::1]:5173/config.html, /panel.html, /ui.html — Twitch имитируется,
                     # запросы идут в локальный Worker (worker/: npm run dev:ext) с JWT на тестовом секрете
npm test             # чистая логика
npm run build        # dist → zip (tar.exe -a -cf ... -C dist panel.html config.html assets)

# worker/
npm test             # JWT и снимок
npm run dev:ext      # wrangler dev на 127.0.0.1:8787 с тестовым секретом для имитации; ключ TMDB для подсказок — в .dev.vars; локальные миграции: npx wrangler d1 migrations apply stream-lists --local
npm run deploy       # миграции на удалённую D1 + выкладка
```

## Что добавлено после этапов 1–8 (2026-10-11)

- **Правка прямо в панели на канале:** автор (роль `broadcaster` в JWT) видит в панели добавление, «Просмотрено»,
  оценку 1–10, правку названия и постера, удаление, перетаскивание, «Списком». Зрители — только чтение. Запись
  проверяет Worker. «Как видят зрители» (глаз) — предпросмотр. Окно настроек осталось для списков и оформления.
- **Постеры сами:** Worker ищет в TMDB (`pickMatch`: точное имя / оригинальное имя / год в названии, иначе без постера);
  при импорте, «Списком», одиночном добавлении, переименовании и `POST /api/lists/:id/match-missing`.
- **Баллы Pointauc** (`items.points`, `lot_id`) и **оценка** (`items.rating`), `tmdb_type` — миграция 0004.
- **Автосинхронизация Pointauc** (cron раз в минуту, `PUT /api/pointauc/sync`): новый лот идёт в очередь сам,
  только если TMDB знает название и у записи ≥ 20 голосов (зрители пишут лоты — мусор в TMDB тоже есть), иначе —
  в «На проверку» (`pending_lots`, миграция 0005; `POST /api/pending/:id/accept`, `DELETE /api/pending/:id`).
  Виденный/скрытый/удалённый лот не возвращается. Игры и «Своё» без TMDB — все новые лоты на проверку.
- **Карточка фильма** для зрителя: `GET /api/movie/:id?type=&lang=` (любая роль), клик по названию в панели.
- Ревью Twitch: любое изменение файлов расширения после выпуска = новая версия + новое ревью; Worker и данные — без ревью.
- Сборка zip для консоли — только `/c/Windows/System32/tar.exe -a -cf stream-lists.zip panel.html config.html assets`
  из `extension/dist` (в Git Bash `tar` — GNU и делает не zip).
