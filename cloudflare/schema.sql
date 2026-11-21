CREATE TABLE IF NOT EXISTS trend_snapshots (
  region TEXT NOT NULL,
  day TEXT NOT NULL,
  trends TEXT NOT NULL,
  PRIMARY KEY (region, day)
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  jpeg TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS publications (
  account TEXT NOT NULL,
  day TEXT NOT NULL,
  container_id TEXT NOT NULL,
  media_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'published')),
  PRIMARY KEY (account, day)
);
