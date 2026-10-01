CREATE TABLE lists (
  id INTEGER PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('movies', 'games', 'custom')),
  created_at INTEGER NOT NULL
);
CREATE INDEX lists_channel ON lists (channel_id);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  year INTEGER,
  poster_path TEXT,
  tmdb_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('queue', 'watched')),
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  watched_at INTEGER,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'pointauc'))
);
CREATE INDEX items_list ON items (list_id, status);
