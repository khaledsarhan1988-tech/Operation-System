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
  line          TEXT NOT NULL DEFAULT 'Ahmed Hassan',
  language      TEXT NOT NULL DEFAULT 'ar' CHECK(language IN ('ar','en')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

-- =============================================
-- EMPLOYEES (from Data.xlsx)
-- =============================================
CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  department  TEXT NOT NULL,
  line        TEXT NOT NULL DEFAULT 'Ahmed Hassan',
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  synced_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_employees_line ON employees(line);

-- =============================================
-- TEAM MEMBERS (Academy Staff Directory)
-- =============================================
CREATE TABLE IF NOT EXISTS team_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  department  TEXT NOT NULL CHECK(department IN ('customer_services','education')),
  section     TEXT NOT NULL CHECK(section IN ('all','general','private','semi','phone_call')),
  shift       TEXT CHECK(shift IN ('morning','evening') OR shift IS NULL),
  shift_start TEXT,  -- HH:MM, only meaningful when shift is set
  shift_end   TEXT,  -- HH:MM, only meaningful when shift is set
  shift_rests TEXT,  -- JSON array of {"start":"HH:MM","end":"HH:MM"} for breaks
  -- Voice Note blocks: dedicated WORK time inside the shift (NOT a break).
  -- Same JSON shape as shift_rests. Lectures can't overlap these (>5 min);
  -- they count as "booked" in utilization calculations.
  voice_notes TEXT,
  shift_start_date TEXT,  -- YYYY-MM-DD: when this shift began (required when shift is set)
  shift_end_date   TEXT,  -- YYYY-MM-DD: when this shift ended; NULL = still on the job
  employment_type TEXT CHECK(employment_type IN ('full_time','part_time') OR employment_type IS NULL),
  work_days       TEXT,  -- comma-separated day codes: saturday,sunday,monday,tuesday,wednesday,thursday
  -- Optional second shift (independent days/hours/employment/rests from the first)
  shift2                  TEXT CHECK(shift2 IN ('morning','evening') OR shift2 IS NULL),
  shift2_start            TEXT,
  shift2_end              TEXT,
  shift2_rests            TEXT,
  shift2_voice_notes      TEXT,
  shift2_start_date       TEXT,
  shift2_end_date         TEXT,
  shift2_employment_type  TEXT CHECK(shift2_employment_type IN ('full_time','part_time') OR shift2_employment_type IS NULL),
  shift2_work_days        TEXT,
  job_title   TEXT,
  phone       TEXT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  notes       TEXT,
  -- Teachable courses (max level per track). Default = max → all trainers
  -- are capable of every course unless explicitly limited via the UI.
  teachable_starter      INTEGER NOT NULL DEFAULT 3,  -- 0..3
  teachable_general      INTEGER NOT NULL DEFAULT 5,  -- 0..5
  teachable_conversation INTEGER NOT NULL DEFAULT 5,  -- 0..5
  created_at  TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
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
  line              TEXT NOT NULL DEFAULT 'Ahmed Hassan',
  synced_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_clients_name  ON clients(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_group ON clients(group_name);
CREATE INDEX IF NOT EXISTS idx_clients_line  ON clients(line);

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
  line                 TEXT NOT NULL DEFAULT 'Ahmed Hassan',
  synced_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_batches_line           ON batches(line);
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
  external_id   INTEGER,
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
  line          TEXT NOT NULL DEFAULT 'Ahmed Hassan',
  synced_at     TEXT,
  UNIQUE(external_id, line)
);
CREATE INDEX IF NOT EXISTS idx_remarks_external    ON remarks(external_id);
CREATE INDEX IF NOT EXISTS idx_remarks_line        ON remarks(line);
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
  line                  TEXT NOT NULL DEFAULT 'Ahmed Hassan',
  synced_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_lectures_line       ON lectures(line);
CREATE INDEX IF NOT EXISTS idx_lectures_group      ON lectures(group_name);
CREATE INDEX IF NOT EXISTS idx_lectures_date       ON lectures(date);
CREATE INDEX IF NOT EXISTS idx_lectures_type       ON lectures(session_type);
CREATE INDEX IF NOT EXISTS idx_lectures_status     ON lectures(status);
-- Composite indexes for common multi-column queries
CREATE INDEX IF NOT EXISTS idx_lectures_type_date  ON lectures(session_type, date);
CREATE INDEX IF NOT EXISTS idx_lectures_type_group ON lectures(session_type, group_name);
CREATE INDEX IF NOT EXISTS idx_lectures_type_group_line ON lectures(session_type, group_name, line);
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
  line              TEXT NOT NULL DEFAULT 'Ahmed Hassan',
  -- 1 if generated automatically from a lecture with empty attendance + confirmed status
  auto_generated    INTEGER NOT NULL DEFAULT 0,
  synced_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_absent_line    ON absent_students(line);
CREATE INDEX IF NOT EXISTS idx_absent_group   ON absent_students(group_name);
CREATE INDEX IF NOT EXISTS idx_absent_student ON absent_students(student_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_absent_phone   ON absent_students(phone);
CREATE INDEX IF NOT EXISTS idx_absent_status  ON absent_students(follow_up_status);

-- =============================================
-- ABSENT ZOOM STUDENTS (from absent_fixed Side Session.xlsx)
-- Mirrors absent_students but holds Zoom Call (side session) absences only.
-- =============================================
CREATE TABLE IF NOT EXISTS absent_zoom_students (
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
  line              TEXT NOT NULL DEFAULT 'Ahmed Hassan',
  -- 1 if generated automatically from a zoom call with empty attendance + confirmed status
  auto_generated    INTEGER NOT NULL DEFAULT 0,
  synced_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_absent_zoom_line       ON absent_zoom_students(line);
CREATE INDEX IF NOT EXISTS idx_absent_zoom_group      ON absent_zoom_students(group_name);
CREATE INDEX IF NOT EXISTS idx_absent_zoom_student    ON absent_zoom_students(student_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_absent_zoom_phone      ON absent_zoom_students(phone);
CREATE INDEX IF NOT EXISTS idx_absent_zoom_status     ON absent_zoom_students(follow_up_status);
CREATE INDEX IF NOT EXISTS idx_absent_zoom_group_date ON absent_zoom_students(group_name, date);
CREATE INDEX IF NOT EXISTS idx_absent_zoom_phone_date ON absent_zoom_students(phone, date);

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
  checked_at           TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  updated_by           INTEGER REFERENCES users(id),
  updated_at           TEXT,
  line                 TEXT NOT NULL DEFAULT 'Ahmed Hassan'
);
CREATE INDEX IF NOT EXISTS idx_ssc_line    ON side_session_checks(line);
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
  created_at    TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  line          TEXT NOT NULL DEFAULT 'Ahmed Hassan'
);
CREATE INDEX IF NOT EXISTS idx_excel_syncs_line ON excel_syncs(line);

-- =============================================
-- CODE PROBLEM STATUS (persistent tracking)
-- =============================================
CREATE TABLE IF NOT EXISTS code_problem_status (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name        TEXT NOT NULL,
  problem_type      TEXT NOT NULL,
  session_type      TEXT NOT NULL DEFAULT 'main',
  status            TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reported','in_progress','exception','wont_repeat','resolved')),
  note              TEXT,
  actual_at_status  INTEGER,
  new_group_code    TEXT,
  updated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  line              TEXT NOT NULL DEFAULT 'Ahmed Hassan',
  UNIQUE(group_name, problem_type, session_type, line)
);
CREATE INDEX IF NOT EXISTS idx_cps_group  ON code_problem_status(group_name);
CREATE INDEX IF NOT EXISTS idx_cps_status ON code_problem_status(status);
CREATE INDEX IF NOT EXISTS idx_cps_line   ON code_problem_status(line);

-- =============================================
-- PERFORMANCE COMPOSITE INDEXES
-- Added 2026-04-27 — speeds up reports/dashboard, remarks-notes, code-problems.
-- All additive, no behavior change.
-- =============================================
CREATE INDEX IF NOT EXISTS idx_remarks_category_line   ON remarks(category, line);
CREATE INDEX IF NOT EXISTS idx_remarks_cat_phone       ON remarks(category, client_phone);
CREATE INDEX IF NOT EXISTS idx_absent_group_date       ON absent_students(group_name, date);
CREATE INDEX IF NOT EXISTS idx_absent_phone_date       ON absent_students(phone, date);
CREATE INDEX IF NOT EXISTS idx_lectures_group_date     ON lectures(group_name, date);
CREATE INDEX IF NOT EXISTS idx_lectures_status_type    ON lectures(status, session_type);
CREATE INDEX IF NOT EXISTS idx_clients_phone_line      ON clients(phone, line);
CREATE INDEX IF NOT EXISTS idx_clients_group_line      ON clients(group_name, line);
CREATE INDEX IF NOT EXISTS idx_batches_group_line      ON batches(group_name, line);

-- =============================================
-- MONTHLY SNAPSHOTS — frozen KPIs per agent per month (Level 2)
-- =============================================
CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name      TEXT NOT NULL,
  agent_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department      TEXT NOT NULL,
  line            TEXT NOT NULL DEFAULT 'Ahmed Hassan',

  -- Period
  year            INTEGER NOT NULL,
  month           INTEGER NOT NULL,
  period_label    TEXT NOT NULL,        -- '2026-04'

  -- Tasks / Remarks
  tasks_total     INTEGER DEFAULT 0,
  tasks_done      INTEGER DEFAULT 0,
  tasks_overdue   INTEGER DEFAULT 0,
  tasks_urgent    INTEGER DEFAULT 0,
  completion_rate INTEGER DEFAULT 0,
  sla_rate        INTEGER DEFAULT 0,

  -- Absent follow-up
  absents_total       INTEGER DEFAULT 0,
  absents_followed_up INTEGER DEFAULT 0,
  followup_rate       INTEGER DEFAULT 0,

  -- Code problems
  code_problems_total    INTEGER DEFAULT 0,
  code_problems_resolved INTEGER DEFAULT 0,
  fix_rate               INTEGER DEFAULT 0,

  overall_score   INTEGER DEFAULT 0,

  -- Targets snapshot (frozen at the time of freezing)
  target_completion INTEGER,
  target_followup   INTEGER,
  target_fix        INTEGER,
  target_overall    INTEGER,
  met_target        INTEGER NOT NULL DEFAULT 0,

  -- Department benchmarking
  dept_avg_completion INTEGER,
  dept_avg_followup   INTEGER,
  dept_avg_fix        INTEGER,
  dept_avg_overall    INTEGER,
  rank_in_dept        INTEGER,
  total_in_dept       INTEGER,

  -- Achievements (JSON array of badge keys)
  achievements    TEXT,

  -- Metadata
  frozen_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  frozen_at       TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  notes           TEXT,
  UNIQUE(agent_name, year, month, line)
);
CREATE INDEX IF NOT EXISTS idx_ms_agent      ON monthly_snapshots(agent_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_ms_period     ON monthly_snapshots(year, month);
CREATE INDEX IF NOT EXISTS idx_ms_line       ON monthly_snapshots(line);
CREATE INDEX IF NOT EXISTS idx_ms_dept       ON monthly_snapshots(department);
CREATE INDEX IF NOT EXISTS idx_ms_dept_period ON monthly_snapshots(department, year, month);

-- =============================================
-- EMPLOYEE TARGETS — KPI goals (per-agent / per-dept / global)
-- =============================================
CREATE TABLE IF NOT EXISTS employee_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT,                 -- NULL = applies to all (in dept or globally)
  department TEXT,                 -- NULL = applies globally
  line       TEXT NOT NULL DEFAULT 'Ahmed Hassan',

  target_completion INTEGER NOT NULL DEFAULT 85,
  target_followup   INTEGER NOT NULL DEFAULT 80,
  target_fix        INTEGER NOT NULL DEFAULT 90,
  target_overall    INTEGER NOT NULL DEFAULT 80,

  effective_from TEXT NOT NULL,    -- 'YYYY-MM-DD' — first month this target applies
  set_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  set_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  notes  TEXT
);
CREATE INDEX IF NOT EXISTS idx_targets_agent      ON employee_targets(agent_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_targets_department ON employee_targets(department);
CREATE INDEX IF NOT EXISTS idx_targets_line       ON employee_targets(line);
CREATE INDEX IF NOT EXISTS idx_targets_effective  ON employee_targets(effective_from);

-- =============================================
-- SNAPSHOT NOTES — admin annotations on a frozen snapshot
-- =============================================
CREATE TABLE IF NOT EXISTS snapshot_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES monthly_snapshots(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshot_notes_sid ON snapshot_notes(snapshot_id);

-- =============================================
-- SNAPSHOT AUDIT LOG — tracks every freeze/unfreeze/edit for accountability
-- =============================================
CREATE TABLE IF NOT EXISTS snapshot_audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL CHECK(action IN ('freeze','freeze_bulk','overwrite','delete','note_add','note_edit','note_delete','target_change','weights_change')),
  year       INTEGER,
  month      INTEGER,
  agent_name TEXT,
  details    TEXT,                                -- JSON freeform
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT,
  line       TEXT NOT NULL DEFAULT 'Ahmed Hassan',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON snapshot_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_period ON snapshot_audit_log(year, month);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON snapshot_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_line   ON snapshot_audit_log(line);
CREATE INDEX IF NOT EXISTS idx_audit_at     ON snapshot_audit_log(created_at);

-- =============================================
-- KPI WEIGHTS — admin-configurable formula for overall_score
-- =============================================
CREATE TABLE IF NOT EXISTS kpi_weights (
  id INTEGER PRIMARY KEY CHECK(id = 1),           -- single-row table
  weight_completion INTEGER NOT NULL DEFAULT 50,
  weight_followup   INTEGER NOT NULL DEFAULT 25,
  weight_fix        INTEGER NOT NULL DEFAULT 25,
  weight_sla        INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

-- =============================================
-- PERSONAL GOALS — agent-defined motivational goals (NOT used for met_target)
-- =============================================
CREATE TABLE IF NOT EXISTS personal_goals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  goal_completion INTEGER NOT NULL DEFAULT 90,
  goal_followup   INTEGER NOT NULL DEFAULT 85,
  goal_fix        INTEGER NOT NULL DEFAULT 95,
  goal_overall    INTEGER NOT NULL DEFAULT 90,
  notes           TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);
CREATE INDEX IF NOT EXISTS idx_personal_goals_user ON personal_goals(user_id);

-- =============================================
-- CUSTOM GOALS — extra agent-defined goals (Retention, side projects, etc.)
-- evaluated by the leader. Optional period (year/month).
-- =============================================
CREATE TABLE IF NOT EXISTS custom_goals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- agent or leader
  title           TEXT NOT NULL,
  description     TEXT,
  target_value    INTEGER,                                          -- numeric target (e.g. 80)
  unit            TEXT NOT NULL DEFAULT '%' CHECK(unit IN ('%','عميل','تاسك','جلسة','نقطة','مجموعة','custom')),
  unit_custom     TEXT,                                              -- when unit='custom'
  year            INTEGER,
  month           INTEGER,

  -- Leader evaluation (filled by leader, NULL while pending)
  achieved_value     INTEGER,
  result_status      TEXT NOT NULL DEFAULT 'pending'
                     CHECK(result_status IN ('pending','achieved','partially','not_achieved')),
  evaluation_reason  TEXT,                                          -- لماذا تم تقييمها بهذا الشكل
  strengths          TEXT,                                          -- نقاط القوة
  weaknesses         TEXT,                                          -- نقاط الضعف
  leader_note        TEXT,                                          -- ملاحظة عامة للموظف (اختياري)
  evaluated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  evaluated_at       TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_custom_goals_user   ON custom_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_goals_status ON custom_goals(result_status);
CREATE INDEX IF NOT EXISTS idx_custom_goals_period ON custom_goals(year, month);

-- =============================================
-- NOTIFICATIONS — in-app notifications for users
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK(type IN ('snapshot_frozen','target_changed','achievement_earned','system','custom')),
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,                                -- optional deep link (e.g. /agent/my-progression)
  meta       TEXT,                                -- JSON
  is_read    INTEGER NOT NULL DEFAULT 0,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read    ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- =============================================
-- JWT REFRESH TOKENS
-- =============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_user    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens(expires_at);
