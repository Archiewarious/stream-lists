-- Pointauc bids ("points") and the lot they come from, the streamer's 1–10 rating, and whether the TMDB id is a movie or a show.
ALTER TABLE items ADD COLUMN points INTEGER;
ALTER TABLE items ADD COLUMN lot_id TEXT;
ALTER TABLE items ADD COLUMN rating INTEGER CHECK (rating BETWEEN 1 AND 10);
ALTER TABLE items ADD COLUMN tmdb_type TEXT CHECK (tmdb_type IN ('movie', 'tv'));
