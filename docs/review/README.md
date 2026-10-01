# Материалы для ревью Twitch

Требования Twitch (dev.twitch.tv/docs/extensions/life-cycle): логотип 100×100 PNG, картинка каталога 300×200 PNG,
скриншоты от 1024×768 (4:3), PNG/JPG до 10 МБ. Иконка 24×24 нужна только видео-расширениям — у нас панель.

| Файл | Куда в консоли |
|---|---|
| `logo-100.png` | Logo Image |
| `discovery-300x200.png` | Discovery Image |
| `screenshot-1-panel.png` … `screenshot-4-appearance.png` | Screenshots (1280×960, 4:3) |

Перерисовать: `src/compose.html#panels | #logo | #discovery` в браузере нужного размера, скриншот окна.
Данные на скриншотах демонстрационные; лоты Pointauc на скриншоте 3 — подставленные.

## Тексты для каталога (только английский — так решили)

**Name:** Stream Lists: Games & Movies

**Summary:**
Show viewers what you'll watch or play next and what you've already finished — a searchable list with posters, right under your stream.

**Description:**
Stream Lists keeps your movie night and game backlog in one panel.

- Queue and history: what's next in order, and everything you've already watched or played, grouped by month with dates.
- Search for viewers: "have you watched this already?" — type a title and see the date it was watched or its place in the queue.
- Posters and years are filled in automatically from TMDB when you add a movie.
- Paste a whole list at once; repeats are skipped.
- Optional: import lots from your Pointauc auction (pointauc.com) — new titles are preselected, ones already queued or watched are marked.
- Themes: Lilac Fox (default), Twitch, Sunset, Mint, Ice, Cherry, or your own colors. Viewers see your theme.

Languages: English, Russian.
This product uses the TMDB API but is not endorsed or certified by TMDB.

## Walkthrough Guide (для проверяющих)

1. Install the extension and activate it as a Panel.
2. Open **Configure**. Create a list (type "Movies", any name).
3. In "Find a movie", type e.g. `Dune` — suggestions with posters and years appear (TMDB). Press Enter to add the first one.
   Titles without a suggestion can be added as plain text ("Add … without a poster").
4. "Paste a list" adds many titles at once — one per line.
5. Hover a queued title → **Watched** moves it to the history with today's date; in the history, **Back to queue** returns it.
   Drag the handle to reorder the queue.
6. Open the channel page: the panel shows the queue; the second tab shows the history by month; the search field finds titles in both.
7. **Appearance** (left sidebar) changes the panel colors for viewers.
8. **From Pointauc** is optional and needs a pointauc.com account with an open auction tab — it can be skipped during review.

Backend: `https://stream-lists.begidan32.workers.dev` (Cloudflare Worker). The streamer's requests are authorized by the
Twitch extension JWT (broadcaster role); viewers only read. Images: `https://image.tmdb.org`.

**Changelog:** Initial release.

## Консоль Twitch перед отправкой

- Allowlist для запросов (connect-src): `https://stream-lists.begidan32.workers.dev`
- Allowlist для картинок (img-src): `https://image.tmdb.org`
- Оба списка замораживаются после отправки на ревью.
- Zip: `cd extension && npm run build`, затем `tar.exe -a -cf stream-lists.zip -C dist panel.html config.html assets`.
