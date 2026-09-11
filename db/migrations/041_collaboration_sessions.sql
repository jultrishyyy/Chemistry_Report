CREATE TABLE IF NOT EXISTS collaboration_presence (
  resource_type varchar(50) NOT NULL,
  resource_id varchar(100) NOT NULL,
  user_job_no varchar(100) NOT NULL,
  user_name varchar(200) NOT NULL,
  latest_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_change_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (resource_type, resource_id, user_job_no)
);

CREATE INDEX IF NOT EXISTS idx_collaboration_presence_active
  ON collaboration_presence(resource_type, resource_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS edit_leases (
  resource_type varchar(50) NOT NULL,
  resource_id varchar(100) NOT NULL,
  holder_job_no varchar(100) NOT NULL,
  holder_name varchar(200) NOT NULL,
  lease_token uuid NOT NULL UNIQUE,
  acquired_at timestamptz NOT NULL DEFAULT NOW(),
  heartbeat_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_edit_leases_expiry ON edit_leases(expires_at);
