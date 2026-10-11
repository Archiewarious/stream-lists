-- Automatic sync driven by Pointauc's answers: when the cron should next ask Pointauc for the channel (NULL — not
-- until the streamer opens the panel or the settings window), and since when Pointauc has not answered (NULL — it did).
ALTER TABLE channels ADD COLUMN pointauc_due_at INTEGER;
ALTER TABLE channels ADD COLUMN pointauc_failing_since INTEGER;
-- Channels that sync already are due at once.
UPDATE channels SET pointauc_due_at = 0 WHERE pointauc_list_id IS NOT NULL AND pointauc_token IS NOT NULL;
CREATE INDEX channels_sync_due ON channels (pointauc_due_at) WHERE pointauc_list_id IS NOT NULL AND pointauc_token IS NOT NULL;
-- When a hidden lot was last in the auction (NULL — when it was hidden, created_at); one gone for 90 days is deleted.
ALTER TABLE pending_lots ADD COLUMN seen_at INTEGER;
CREATE INDEX pending_lots_gone ON pending_lots (COALESCE(seen_at, created_at)) WHERE status = 'dismissed';
