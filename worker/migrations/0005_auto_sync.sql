-- Automatic Pointauc sync: the list it feeds, and the lots that were seen but not put into the queue.
-- A lot is "pending" while the streamer has to look at it (TMDB did not know the title), "dismissed" once it was
-- hidden or its item was deleted — either way the sync never brings the same lot back.
ALTER TABLE channels ADD COLUMN pointauc_list_id INTEGER;

CREATE TABLE pending_lots (
  id INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  lot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  points INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed')),
  created_at INTEGER NOT NULL,
  UNIQUE (list_id, lot_id)
);
