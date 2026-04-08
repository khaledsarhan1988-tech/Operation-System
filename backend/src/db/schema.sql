PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- =============================================
-- USERS
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('agent','leader','admin')),
  department    TEXT NOT NULL DEFAULT 'General',
  management    TEXT NOT NULL DEFAULT 'Customer Services',
  language      TEXT NOT NULL DEFAULT 'ar' CHECK(language IN ('ar','en')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================
-- EMPLOYEES (from Data.xlsx)
-- =============================================
CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  department  TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  synced_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name COLLATE NOCASE);

-- =============================================
-- TEAM MEMBERS (Academy Staff Directory)
-- =============================================
CREATE TABLE IF NOT EXISTS team_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  department  TEXT NOT NULL CHECK(department IN ('customer_services','education')),
  section     TEXT NOT NULL CHECK(section IN ('all','general','private','semi','phone_call')),
  shift       TEXT CHECK(shift IN ('morning','evening') OR shift IS NULL),
  job_title   TEXT,
  phone       TEXT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_team_dept_section ON team_members(department, section);

-- =============================================
-- CLIENTS (from Active Batches Trainees.xlsx)
-- =============================================
CREATE TABLE IF NOT EXISTS clients (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  group_name        TEXT,
  via_company       TEXT,
  registration_time TEXT,
  synced_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_clients_name  ON clients(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_group ON clients(group_name);

-- =============================================
-- BATCHES (from Batches.xlsx)
-- =============================================
CREATE TABLE IF NOT EXISTS batches (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id          INTEGER,
  group_name           TEXT NOT NULL,
  course               TEXT,
  status               TEXT,
  trainers             TEXT,
  trainee_count        INTEGER DEFAULT 0,
  max_trainees         INTEGER DEFAULT 0,
  scheduled_lectures   INTEGER DEFAULT 0,
  completed_lectures   INTEGER DEFAULT 0,
  start_date           TEXT,
  end_date             TEXT,
  training_schedule    TEXT,
  coordinators         TEXT,
  added_at             TEXT,
  added_by             TEXT,
  closed_by            TEXT,
  -- Parsed from group_name code
  dept_type            TEXT,     -- 'General' | 'Private' | 'Semi'
  level_code           TEXT,     -- e.g. 'Con_4', 'General_3'
  main_days            TEXT,     -- e.g. 'Mon,Thu'
  side_days            TEXT,     -- computed opposite pair
  lecture_duration_min INTEGER,  -- 90=General, 60=Private/Semi
  synced_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_batches_group          ON batches(group_name);
CREATE INDEX IF NOT EXISTS idx_batches_status         ON batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_coordinators   ON batches(coordinators);
CREATE INDEX IF NOT EXISTS idx_batches_external       ON batches(external_id);
-- Composite: expired groups query (status + end_date)
CREATE INDEX IF NOT EXISTS idx_batches_status_end     ON batches(status, end_date);
-- Composite: lecture errors query (status + scheduled vs completed)
CREATE INDEX IF NOT EXISTS idx_batches_status_sched   ON batches(status, scheduled_lectures, completed_lectures);

-- =============================================
-- REMARKS (from Remarks.xlsx)
-- =============================================
CREATE TABLE IF NOT EXISTS remarks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id   INTEGER UNIQUE,
  task_type     TEXT,
  assigned_to   TEXT,
  details       TEXT,
  category      TEXT,
  status        TEXT,
  client_name   TEXT,
  client_phone  TEXT,
  priority      TEXT,
  assigned_by   TEXT,
  notes         TEXT,
  added_at      TEXT,
  last_updated  TEXT,
  sla_deadline  TEXT,   -- computed at import: added_at + SLA hours
  -- Agent-preserved fields (never overwritten by re-import)
  agent_notes   TEXT,
  resolved_at   TEXT,
  synced_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_remarks_external    ON remarks(external_id);
CREATE INDEX IF NOT EXISTS idx_remarks_assigned    ON remarks(assigned_to COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_remarks_status      ON remarks(status);
CREATE INDEX IF NOT EXISTS idx_remarks_client      ON remarks(client_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_remarks_phone       ON remarks(client_phone);
CREATE INDEX IF NOT EXISTS idx_remarks_priority    ON remarks(priority);
CREATE INDEX IF NOT EXISTS idx_remarks_added_at    ON remarks(added_at);
-- Composite: open remarks filter (status + added_at for date range)
CREATE INDEX IF NOT EXISTS idx_remarks_status_date ON remarks(status, added_at);

-- =============================================
-- LECTURES (from Lectures.xlsx + Side Session.xlsx combined)
-- =============================================
CREATE TABLE IF NOT EXISTS lectures (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name            TEXT,
  date                  TEXT,
  time                  TEXT,
  duration              TEXT,
  trainer               TEXT,
  status                TEXT,
  location              TEXT,
  attendance            TEXT,
  session_type          TEXT NOT NULL DEFAULT 'main' CHECK(session_type IN ('main','side')),
  side_session_category TEXT,  -- 'onboarding'|'regular'|'offboarding'|'compensatory'|NULL
  synced_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_lectures_group      ON lectures(group_name);
CREATE INDEX IF NOT EXISTS idx_lectures_date       ON lectures(date);
CREATE INDEX IF NOT EXISTS idx_lectures_type       ON lectures(session_type);
CREATE INDEX IF NOT EXISTS idx_lectures_status     ON lectures(status);
-- Composite indexes for common multi-column queries
CREATE INDEX IF NOT EXISTS idx_lectures_type_date  ON lectures(session_type, date);
CREATE INDEX IF NOT EXISTS idx_lectures_type_group ON lectures(session_type, group_name);
CREATE INDEX IF NOT EXISTS idx_lectures_group_cat  ON lectures(group_name, session_type, side_session_category);

-- =============================================
-- ABSENT STUDENTS (from Absent Student.xlsx)
-- =============================================
CREATE TABLE IF NOT EXISTS absent_students (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name        TEXT,
  student_name      TEXT,
  phone             TEXT,
  date              TEXT,
  time              TEXT,
  lecture_no        INTEGER,
  -- Agent follow-up (preserved across re-imports)
  follow_up_status  TEXT NOT NULL DEFAULT 'pending' CHECK(follow_up_status IN ('pending','contacted','resolved')),
  follow_up_note    TEXT,
  follow_up_by      TEXT,
  follow_up_at      TEXT,
  synced_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_absent_group   ON absent_students(group_name);
CREATE INDEX IF NOT EXISTS idx_absent_student ON absent_students(student_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_absent_phone   ON absent_students(phone);
CREATE INDEX IF NOT EXISTS idx_absent_status  ON absent_students(follow_up_status);

-- =============================================
-- SIDE SESSION CHECKS (agent daily task — PERMANENT, never deleted by re-import)
-- =============================================
CREATE TABLE IF NOT EXISTS side_session_checks (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  lecture_id           INTEGER REFERENCES lectures(id) ON DELETE SET NULL,
  group_name           TEXT NOT NULL,
  session_date         TEXT NOT NULL,
  trainer_present      INTEGER,   -- 1=yes, 0=no, NULL=not checked
  student_present      INTEGER,   -- 1=yes, 0=no, NULL=not checked
  lecture_start_time   TEXT,      -- actual HH:MM
  recording_start_time TEXT,      -- actual HH:MM
  actual_duration_min  INTEGER,
  notes                TEXT,
  checked_by           INTEGER REFERENCES users(id),
  checked_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by           INTEGER REFERENCES users(id),
  updated_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_ssc_group   ON side_session_checks(group_name);
CREATE INDEX IF NOT EXISTS idx_ssc_date    ON side_session_checks(session_date);
CREATE INDEX IF NOT EXISTS idx_ssc_checked ON side_session_checks(checked_by);

-- =============================================
-- EXCEL SYNC AUDIT LOG
-- =============================================
CREATE TABLE IF NOT EXISTS excel_syncs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_type     TEXT NOT NULL,
  filename      TEXT NOT NULL,
  rows_imported INTEGER DEFAULT 0,
  status        TEXT NOT NULL CHECK(status IN ('success','error')),
  error_msg     TEXT,
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================
-- CODE PROBLEM STATUS (persistent tracking)
-- =============================================
CREATE TABLE IF NOT EXISTS code_problem_status (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name   TEXT NOT NULL,
  problem_type TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'main',
  status       TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reported','in_progress','exception')),
  note         TEXT,
  updated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(group_name, problem_type, session_type)
);
CREATE INDEX IF NOT EXISTS idx_cps_group  ON code_problem_status(group_name);
CREATE INDEX IF NOT EXISTS idx_cps_status ON code_problem_status(status);

-- =============================================
-- JWT REFRESH TOKENS
-- =============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_user    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens(expires_at);
