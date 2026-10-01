-- Per-channel settings: the panel theme (JSON, see src/theme.ts) and, later, the Pointauc connection.
CREATE TABLE channels (
  channel_id TEXT PRIMARY KEY,
  theme TEXT
);
