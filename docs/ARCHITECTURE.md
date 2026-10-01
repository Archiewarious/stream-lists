# Stream Lists: Games & Movies — архитектура

Twitch-расширение (Panel): стример ведёт списки (игры, фильмы и сериалы, своё), зрители видят,
что сейчас, что в очереди и что уже готово. Подключение к Pointauc — дополнительная функция.

## Компоненты

| Часть | Что это | Кто видит |
|---|---|---|
| `extension/panel.html` | Панель под стримом: вкладки списков, «Сейчас / Очередь / Готово» | Зрители |
| `extension/config.html` | Управление списками и элементами | Только стример |
| `worker/` (фаза 2) | Cloudflare Worker + D1 — источник истины | — |
| Twitch Configuration Service + PubSub | Доставка списка зрителям | — |

## Поток данных

Зрители никогда не ходят на наш сервер: публичный «снимок» хранит и раздаёт Twitch.

```
Фаза 1:   config.html ──configuration.set + PubSub──► Twitch ──► panel.html

Фаза 2+:  config.html ──JWT──► Worker ──► D1 (все данные)
                                  └──► Twitch: снимок (config) + PubSub ──► panel.html
          Pointauc ◄── cron 1 мин ── Worker   (фаза 3)
```

- Снимок ≤ 5 КБ (лимит сегмента Twitch). В фазе 2 при переполнении обрезается старое «Готово».
- Авторизация встроенная: Twitch выдаёт окну расширения JWT (channel_id, role). Worker проверяет
  подпись секретом расширения; писать может только `broadcaster`.
- PubSub-отправки склеиваются (debounce ~1 с) — у Twitch лимит частоты.

## Модель данных

```
List:  id, title, kind (games | movies | custom), items[]
Item:  id, title, status (queue | now | done)
```

Фаза 2 (D1): `lists(id, channel_id, title, kind, position, created_at)`,
`items(id, list_id, title, status, source, position, created_at, status_changed_at)`.
Фаза 3 добавляет `status = missing` и `source = pointauc`. Автоматически ничего не удаляется.

## Фронтенд

React 19 + Vite + TypeScript, Mantine + Tailwind, i18next (ru/en по `?language=` от Twitch),
Tabler Icons. Структура по соглашениям Pointauc (`AGENTS.md`):

```
extension/src/
  app/                  провайдеры, тема (светлая/тёмная — как у зрителя на Twitch)
  pages/{panel,config}/ только композиция экранов
  domains/lists/        model (типы, хуки), lib (чистая логика + тесты), ui (компоненты)
  shared/twitch/        обёртка над Twitch.ext + имитация для разработки вне Twitch
  assets/i18n/          en.json, ru.json
```

## Фазы

1. Фронтенд, данные в Twitch config (≈100 элементов). Без аккаунтов и секретов.
2. Worker + D1: данные не теряются, объём не ограничен. Панель зрителя не меняется.
3. Pointauc: токен (зашифрован), синхронизация раз в минуту, статус «пропал из аукциона».
4. Live config (отметки во время стрима), мобильная версия, материалы и отправка на ревью.

## Ограничения Twitch

- Сегмент конфигурации — 5 КБ; панель — до 500 px высотой; окно настроек — 700 px.
- Белый список доменов для запросов (адрес Worker) замораживается после ревью.
- Helper Twitch грузится только с их CDN (`extension-files.twitch.tv`), без SRI — файл обновляется на месте.

## Разработка

```
npm run dev          # http://localhost:5173/config.html и /panel.html — Twitch имитируется
npm run dev:twitch   # https://localhost:8080 — Testing Base URI для локального теста на Twitch
npm test             # чистая логика списков
```
