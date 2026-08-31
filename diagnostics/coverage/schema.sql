-- Local SQLite cache for Dodge/Ram coverage bundle (synced from cloud)
CREATE TABLE IF NOT EXISTS coverage_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coverage_records (
  id TEXT PRIMARY KEY,
  coverage_version TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year_start INTEGER NOT NULL,
  year_end INTEGER NOT NULL,
  platform TEXT NOT NULL,
  ignition_type TEXT,
  rf_hub_gen TEXT,
  bcm_gen TEXT,
  gateway_arch TEXT,
  region TEXT DEFAULT 'NA',
  procedures_json TEXT NOT NULL,
  preconditions_json TEXT NOT NULL,
  authorization_required TEXT,
  supported TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coverage_platform ON coverage_records(platform, year_start, year_end);

CREATE TABLE IF NOT EXISTS audit_queue (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  uploaded_at TEXT
);
