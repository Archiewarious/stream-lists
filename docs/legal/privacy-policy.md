# Privacy Policy

Stream Lists: Games & Movies (the "extension") is a Twitch panel extension made by Archiewarious. This policy says
what data the extension and its backend store, where that data goes, and how to have it deleted.

Effective date: 2026-10-12. Contact: archiewarious@gmail.com.

## What the extension is

A streamer keeps lists of movies and games (a queue and a history). Viewers of the channel see those lists in a panel
under the stream and can search them. The streamer can also connect a Pointauc account to import auction lots.

## Who is who

The streamer who installs the extension decides what goes into the lists. The developer (Archiewarious) runs the
backend, a Cloudflare Worker with a Cloudflare D1 database, and is the data controller for the data described here.

## Data the backend stores

For each streamer channel:

- The Twitch channel ID, taken from the token Twitch gives the extension.
- The lists: title, type (movies, games or custom) and creation time.
- The items in each list: title, release year, poster path and TMDB ID and type (when found), queue or watched
  status, position, the dates it was added and watched, the streamer's rating (1 to 10), where it came from (typed or
  Pointauc), the Pointauc points and lot ID, and the time of the last attempt to find a poster.
- The panel theme: a preset name or two colors.
- If the streamer connects Pointauc: the Pointauc token, encrypted with AES-GCM, which list the automatic sync feeds,
  and bookkeeping for that sync (when it last ran, a fingerprint of the lots it handled, since when Pointauc has not
  answered).
- Auction lots the sync saw but did not add to the queue: the lot's name, its points, and when it was last seen. The
  names are written by the people taking part in the auction.
- The time of the last snapshot sent to Twitch and whether Twitch accepted it.

## Data about viewers

The backend does not store anything about viewers. A request from a viewer carries a Twitch token. The backend reads
the channel ID and the role (viewer or broadcaster) from it and nothing else, and it does not save the token, the
viewer's Twitch user ID or the opaque user ID. The extension sets no cookies and contains no analytics, advertising
or tracking code.

The panel keeps the last theme colors in the browser's local storage of the extension frame, so the panel opens in
the right colors. That value holds no personal data.

## Where data goes

- Twitch. After a change, the backend sends the streamer's lists (list titles, the first items of each list with
  poster paths, years, dates, ratings and points, and the theme) to Twitch's Configuration Service and PubSub, so
  viewers receive them in the panel. Anyone who opens the channel with the extension active can read this data. It
  never contains the Pointauc token or the lots waiting for review.
- TMDB (themoviedb.org). When the streamer adds a movie, the backend sends the title to the TMDB API to find the
  year and poster. When a viewer opens a movie card, the backend requests that title's details from TMDB. The
  viewer's browser loads poster images from image.tmdb.org, so TMDB sees the viewer's IP address and browser
  details, as it does for any image request.
- Pointauc (pointauc.com). If the streamer connects it, the backend sends the streamer's token to Pointauc to read
  the auction lots. Pointauc passes the request to the streamer's open pointauc.com tab.
- Cloudflare. The backend runs on Cloudflare Workers and D1, which process requests and keep operational logs under
  Cloudflare's own terms. The backend writes error messages to those logs and does not put list contents or tokens
  in them. An error line can include the streamer's channel ID.

The data is not sold, rented or shared with anyone else, and it is not used for advertising.

## How long data is kept

- Lists and items stay until the streamer deletes them. Deleting a list deletes its items.
- The Pointauc token stays until the streamer disconnects Pointauc in the settings window, which also stops the sync.
- A lot that the streamer hid or deleted is remembered, so the sync does not bring it back, and is removed 90 days
  after it was last seen in the auction.
- The automatic sync stops by itself after 30 days without an answer from Pointauc.
- TMDB data (the TMDB ID, year and poster path) stays with the item until the item is deleted.
- Uninstalling the extension does not delete the stored data automatically. Ask for deletion by email (below).

## Your choices and rights

Streamers can edit or delete any list or item and can disconnect Pointauc in the extension. To get a copy of the
data stored for your channel, to correct it, or to have everything stored for your channel deleted, write to
archiewarious@gmail.com from an address you can show is yours and include the channel name. The developer will reply and carry out the request.

Viewers have no stored data to access or delete, because none is kept.

## Children

The extension is not directed at children and collects no personal data from viewers.

## Changes

Changes to this policy are published in this file; the repository history shows what changed and when. The date at
the top is the date of the latest change.

## Contact

archiewarious@gmail.com
