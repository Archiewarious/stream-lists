-- Automatic sync pacing: when the last pass started (one pass per channel per 10 s, however many panels ask) and a
-- fingerprint of the Pointauc lots the last complete pass handled (the same lots again: nothing to read or write).
ALTER TABLE channels ADD COLUMN pointauc_synced_at INTEGER;
ALTER TABLE channels ADD COLUMN pointauc_lots_hash TEXT;
-- Snapshot publishing: the time of the latest (or next) publish, so publishes of a channel are spaced out for
-- Twitch's rate limit; and whether the last one failed, so the cron sends it again.
ALTER TABLE channels ADD COLUMN snapshot_at INTEGER;
ALTER TABLE channels ADD COLUMN snapshot_stale INTEGER NOT NULL DEFAULT 0;
-- The cron reads only the channels that sync, or that have a snapshot to send again.
CREATE INDEX channels_auto_sync ON channels (channel_id) WHERE pointauc_list_id IS NOT NULL AND pointauc_token IS NOT NULL;
CREATE INDEX channels_stale ON channels (channel_id) WHERE snapshot_stale = 1;
