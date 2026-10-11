# Материалы для ревью Twitch

Требования Twitch (dev.twitch.tv/docs/extensions/life-cycle): логотип 100×100 PNG, картинка каталога 300×200 PNG,
скриншоты от 1024×768 (4:3), PNG/JPG до 10 МБ. Иконка 24×24 нужна только видео-расширениям, у нас панель.
Тексты ниже копируются в консоль вручную: после правки этого файла нужно обновить поля в консоли.

| Файл | Куда в консоли |
|---|---|
| `logo-100.png` | Logo Image |
| `discovery-300x200.png` | Discovery Image |
| `screenshot-1-panel.png` … `screenshot-5-appearance.png` | Screenshots (1280×960, 4:3) |

Что на скриншотах (данные демонстрационные):

1. `screenshot-1-panel.png`: панель зрителя. Очередь с баллами, просмотренное по месяцам, поиск.
2. `screenshot-2-editing.png`: панель стримера на канале. Действия в строках, оценка 1–10, карточка фильма зрителя.
3. `screenshot-3-settings.png`: окно настроек. Списки, очередь, просмотренное, чип «На проверке», логотип TMDB.
4. `screenshot-4-pointauc.png`: импорт из Pointauc и автосинхронизация (лоты подставлены).
5. `screenshot-5-appearance.png`: оформление, пресеты и свои цвета.

Перерисовать: `npm run dev` в `extension/` и `npm run dev:ext` в `worker/`. Кадры панели снять в окне 318×500
и положить в `src/raw-*.png`, собрать `src/compose.html#panels` и `#editing` в окне 1280×960. Окно настроек,
диалог Pointauc и оформление снимаются с `http://[::1]:5173/config.html` в окне 1280×960. В локальной базе
разработчика лежат настоящие названия лотов, поэтому ответы `/api/channel`, `/api/viewer/*` и
`/api/pointauc/lots` перед съёмкой подменяют демо-набором прямо в странице: в публичные файлы настоящие
названия не попадают.

## Тексты для каталога (только английский)

Name:

```
Stream Lists: Games & Movies
```

Summary:

```
Show viewers what you'll watch or play next and what you've finished: a searchable list with posters, right under your stream.
```

Description:

```
Stream Lists keeps your movie night and game backlog in one panel under the stream.

- Queue and history: what is next in order, and everything already watched or played, grouped by month with dates.
- Search for viewers: type a title to see when it was watched or its place in the queue.
- Movie card: click a title to see its poster, genres, length, TMDB score and description.
- Posters and years are filled in from TMDB when you add a movie. Rate watched titles from 1 to 10.
- The streamer edits right in the panel on the channel. Viewers only read.
- Paste a whole list at once in the settings window. Repeats are skipped.
- Optional: connect Pointauc (pointauc.com) to import auction lots, or to add new lots automatically. Titles TMDB does not know wait in "To review" for you to accept, fix or hide. With Pointauc the queue is ordered by the auction points set there, and viewers see the points next to each title. The extension sells nothing and takes no payments. Points are only read from your Pointauc account.
- Themes: Lilac Fox (default), Violet, Sunset, Mint, Ice, Cherry, or your own colors. Viewers see your theme.

Panel extension for desktop web. No chat features. Languages: English, Russian.
This product uses the TMDB API but is not endorsed or certified by TMDB.
```

## Walkthrough Guide

```
Test setup: install the extension and activate it in a panel slot of the review channel. You are the broadcaster
there, so the panel is editable. Viewers see the same panel read-only. Nothing else is needed: Pointauc is optional
(see step 9) and every other feature works without it.

1. Open the channel page. The panel says there are no lists. Open the extension's settings (Configure), create a
   list of type "Movies" with any name, and go back to the channel page.
2. In the panel, type a title in the add field, for example "Dune". Suggestions with posters and years come from TMDB.
   Pick one or press Enter. A title without a suggestion is added as plain text.
3. Hover a queued title. The check mark ("Watched") moves it to the history with today's date, and a rating prompt
   (1 to 10, or skip) appears. The pencil fixes the title or poster, the trash deletes, and the handle on the left
   reorders the queue by dragging. In the history, "Back to queue" returns a title to the queue.
4. The eye button, "What viewers see", shows the viewer's panel: the queue, the history grouped by month in the
   second tab, and a search field that finds titles in both. Viewers cannot edit anything. "Back to editing" returns.
5. In the viewer's panel click a title: a movie card opens with the poster, genres, length, TMDB score and
   description, with the TMDB logo and attribution at the bottom.
6. The numbers with a bolt are auction points read from Pointauc. For imported titles the queue follows the points.
   Titles without points keep the streamer's order and can be dragged.
7. "Paste a list" in the settings window adds many titles at once, one per line.
8. "Appearance" in the settings window changes the panel colors that viewers see.
9. Optional, needs a pointauc.com account: sign in at pointauc.com with Twitch, open Settings, API, Show Token and
   copy the token, add a lot to the auction, then click the gear in the panel and paste the token. The lots appear
   in the dialog. "Add new lots automatically" adds new lots to the queue and sends titles TMDB does not know to
   "To review" (the chip next to the tabs). The pointauc.com tab with the auction has to stay open. The token stays
   with the reviewer: it is stored encrypted and "Disconnect Pointauc" removes it.
10. "By Archiewarious ↗" at the bottom of the panel opens the developer's Twitch channel in a new tab.

Backend: https://stream-lists.begidan32.workers.dev (Cloudflare Worker with a D1 database). Requests are authorized
by the Twitch extension token: only the broadcaster role can change data, viewers read. Posters load from
https://image.tmdb.org. The extension uses no chat, no Bits and no identity link.

Source code: https://github.com/Archiewarious/stream-lists. The JavaScript in the zip is not minified. Libraries
(React, Mantine, dnd-kit, i18next, Tabler icons) are in the vendor-*.js file, the extension's own code in panel-*.js,
config-*.js, AuthorSide-*.js and ItemLists-*.js. There is no eval and no obfuscation. Build: cd extension, npm ci,
npm run build.

Terms of Use: https://github.com/Archiewarious/stream-lists/blob/main/docs/legal/terms-of-use.md
Privacy Policy: https://github.com/Archiewarious/stream-lists/blob/main/docs/legal/privacy-policy.md
```

Changelog:

```
0.0.1 Initial release.
```

## Консоль Twitch перед отправкой

| Поле | Значение |
|---|---|
| Name, Summary, Description | тексты выше |
| Views | Panel (`panel.html`), Config (`config.html`); Mobile и Video overlay не включаем |
| Panel Height | 500 (по умолчанию 300, допустимо 100 до 500); ширина панели 318 px фиксирована |
| Has Chat, Bits | выключено: чат и Bits не используются |
| Allowlist для запросов (URL fetching) | `https://stream-lists.begidan32.workers.dev` |
| Allowlist для картинок (images) | `https://image.tmdb.org` |
| Allowlist для ссылок панели (Panel Links), если поле есть | `https://www.twitch.tv/archiewarious` |
| Author Email | `archiewarious@gmail.com` |
| Support Email | не заполняем (поле необязательное) |
| EULA or Terms of Service URL | `https://github.com/Archiewarious/stream-lists/blob/main/docs/legal/terms-of-use.md` |
| Privacy Policy URL | `https://github.com/Archiewarious/stream-lists/blob/main/docs/legal/privacy-policy.md` |
| Walkthrough Guide, Change Log | блоки выше |
| Скриншоты, логотип, картинка каталога | файлы этой папки |

- Allowlists замораживаются после отправки на ревью. URL юридических страниц входит в версию, поэтому файлы
  `docs/legal/*.md` должны лежать в `main`, а их путь не менять; текст по ссылке править можно.
- Ссылка «By Archiewarious ↗» ведёт на канал автора и открывается в новой вкладке. Правило Twitch 4.6.2 требует
  видимого индикатора ухода (стрелка «↗» и подпись для скринридеров). Если ревью возразит, ссылку заменить текстом.
- Пресет, который раньше назывался «Twitch», называется «Фиалка» / «Violet»: правила запрещают имя и брендинг
  Twitch. Внутренний `id` пресета в данных остался `twitch`.
- Zip: `cd extension && npm run build`, затем `cd dist && /c/Windows/System32/tar.exe -a -cf stream-lists.zip
  panel.html config.html assets` (в Git Bash `tar` по умолчанию GNU и делает не zip; первые байты файла должны быть `PK`).
- Тестовый канал и время, когда он live во время ревью, указывает владелец перед отправкой.
