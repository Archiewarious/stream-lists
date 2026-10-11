-- When "match-missing" last looked a title up in TMDB without a match: it then tries the others first.
ALTER TABLE items ADD COLUMN match_tried_at INTEGER;
