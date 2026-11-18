CREATE TABLE IF NOT EXISTS teacher_requests (
  user_sub TEXT PRIMARY KEY,
  requester_email TEXT NOT NULL,
  requester_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  notification_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS teacher_requests_status_created
  ON teacher_requests (status, created_at);

CREATE TABLE IF NOT EXISTS teacher_roles (
  user_sub TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  approved_at TEXT NOT NULL
);
