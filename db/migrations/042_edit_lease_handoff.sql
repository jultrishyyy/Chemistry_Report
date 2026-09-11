CREATE TABLE IF NOT EXISTS edit_lease_requests (
  id bigserial PRIMARY KEY,
  resource_type varchar(50) NOT NULL,
  resource_id varchar(100) NOT NULL,
  requester_job_no varchar(100) NOT NULL,
  requester_name varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT NOW(),
  resolved_at timestamptz,
  resolved_by_job_no varchar(100),
  resolved_by_name varchar(200)
);

CREATE INDEX IF NOT EXISTS idx_edit_lease_requests_pending
  ON edit_lease_requests(resource_type, resource_id, status, requested_at);

CREATE TABLE IF NOT EXISTS collaboration_events (
  id bigserial PRIMARY KEY,
  resource_type varchar(50) NOT NULL,
  resource_id varchar(100) NOT NULL,
  action varchar(40) NOT NULL,
  actor_job_no varchar(100) NOT NULL,
  actor_name varchar(200) NOT NULL,
  target_job_no varchar(100),
  target_name varchar(200),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collaboration_events_resource
  ON collaboration_events(resource_type, resource_id, created_at DESC);
