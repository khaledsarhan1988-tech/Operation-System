'use strict';
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');
const { nameInListInline } = require('../utils/nameMatch');
const { resolveLeaderDepts, leaderDeptList } = require('../utils/leader-scope');

const router = express.Router();
router.use(authenticate, requireRole('agent'));

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Returns the list of departments a leader oversees (primary + extras),
// or null for non-leaders / 'All' scope. SQL-escaped lowercase values ready
// to drop into a quoted IN() list.
function leaderScopedDepts(req) {
  if (req.user?.role !== 'leader') return null;
  const { listDepts } = resolveLeaderDepts(db, req.user.id);
  const list = (listDepts.length ? listDepts : [req.user.department])
    .filter(Boolean)
    .filter(d => d !== 'All')
    .map(d => String(d).toLowerCase().trim().replace(/'/g, "''"));
  return list.length ? list : null;
}

// Build a leader-dept SQL clause that mirrors the existing pattern used in
// 4-5 spots in this file (and in leader.routes.js). Returns a string ready
// to drop into a query (prefixed with ' AND ...') or empty if no scoping.
// Coordinator's registered dept is the source of truth; falls back to
// batches.dept_type only when the coordinator is unregistered.
function leaderDeptClause(req, opts = {}) {
  const { batchAlias = 'b', userAlias = 'u', fallbackUserAlias = 'u_fb' } = opts;
  const depts = leaderScopedDepts(req);
  if (!depts) return '';
  const inList = depts.map(d => `'${d}'`).join(',');
  return ` AND (
    EXISTS (
      SELECT 1 FROM users ${userAlias}
      WHERE LOWER(TRIM(${userAlias}.full_name)) = LOWER(TRIM(${batchAlias}.coordinators))
        AND LOWER(TRIM(${userAlias}.department)) IN (${inList})
    )
    OR (
      LOWER(TRIM(${batchAlias}.dept_type)) IN (${inList})
      AND NOT EXISTS (
        SELECT 1 FROM users ${fallbackUserAlias}
        WHERE LOWER(TRIM(${fallbackUserAlias}.full_name)) = LOWER(TRIM(${batchAlias}.coordinators))
          AND ${fallbackUserAlias}.department IS NOT NULL AND ${fallbackUserAlias}.department != 'All'
      )
    )
  )`;
}

function buildDateFilter(field, from_date, to_date) {
  if (from_date && to_date) return ` AND ${field} BETWEEN '${from_date}' AND '${to_date}'`;
  if (from_date) return ` AND ${field} >= '${from_date}'`;
  if (to_date) return ` AND ${field} <= '${to_date}'`;
  return '';
}

function buildDeptFilter(table, department) {
  if (!department || department === 'All') return '';
  const safe = department.replace(/'/g, "''");
  return ` AND (${table}.dept_type = '${safe}' OR EXISTS (
    SELECT 1 FROM users u
    WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(${table}.coordinators))
    AND u.department = '${safe}'
  ))`;
}

// Dept filter — coordinator's registered department is SOURCE OF TRUTH.
// Rules:
//   1. If coordinator IS registered in users table → use their registered department
//      (Ali Moaatz registered General → his groups count as General even if batch stored Semi)
//   2. If coordinator is NOT registered (or multi-name field doesn't exact-match) →
//      fall back to batch.dept_type
// This prevents cross-dept leakage: groups where batch stored General but coordinator
// is registered Semi will NOT appear for General leader (they belong to coordinator's dept).
function buildStrictDeptFilter(table, department) {
  // Accept either a single department string or an array (for multi-section
  // leaders). Falsy / 'All' / empty array → no filter.
  if (!department) return '';
  const depts = Array.isArray(department) ? department : [department];
  const cleaned = depts
    .filter(Boolean)
    .filter(d => d !== 'All')
    .map(d => String(d).toLowerCase().trim().replace(/'/g, "''"));
  if (cleaned.length === 0) return '';
  const inList = cleaned.map(d => `'${d}'`).join(',');
  return ` AND (
    EXISTS (
      SELECT 1 FROM users u
      WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(${table}.coordinators))
        AND LOWER(TRIM(u.department)) IN (${inList})
    )
    OR (
      LOWER(TRIM(${table}.dept_type)) IN (${inList})
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(${table}.coordinators))
          AND u.department IS NOT NULL AND u.department != 'All'
      )
    )
  )`;
}

function buildCoordFilter(table, value) {
  if (!value) return '';
  // Use exact-token match so "Alaa" never matches "Alaa wael" (and vice versa).
  // The coordinators field can hold a comma-separated list, so this matches
  // each token individually.
  return ` AND ${nameInListInline(`${table}.coordinators`, value)}`;
}

// Expression-based strict dept filter: same logic as buildStrictDeptFilter, but
// the coordinator + dept_type are arbitrary SQL EXPRESSIONS (not just a table
// alias). Lets a query filter on a RESOLVED coordinator — e.g. one recovered
// from coordinator_history when the group has left the `batches` table — so
// ended-group rows aren't silently dropped by a dept filter.
function buildStrictDeptFilterExpr(coordExpr, deptExpr, department) {
  if (!department) return '';
  const depts = Array.isArray(department) ? department : [department];
  const cleaned = depts
    .filter(Boolean)
    .filter(d => d !== 'All')
    .map(d => String(d).toLowerCase().trim().replace(/'/g, "''"));
  if (cleaned.length === 0) return '';
  const inList = cleaned.map(d => `'${d}'`).join(',');
  return ` AND (
    EXISTS (
      SELECT 1 FROM users u
      WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(${coordExpr}))
        AND LOWER(TRIM(u.department)) IN (${inList})
    )
    OR (
      LOWER(TRIM(${deptExpr})) IN (${inList})
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(${coordExpr}))
          AND u.department IS NOT NULL AND u.department != 'All'
      )
    )
  )`;
}

// ── DATE-AWARE COORDINATOR HELPERS ────────────────────────────────────────────
// When an event has a date (absences, lectures, remarks), we attribute it to
// the coordinator who was responsible AT THAT DATE — not the current value
// of batches.coordinators. The coordinator_history table holds (effective_from,
// effective_to) intervals per group/coordinator/line.

/**
 * Filter clause: keep events whose coordinator-at-date matches `value`.
 * Use inside WHERE clauses alongside an event row that has group/line/date.
 */
// Returns SQL that gives the group_name as it was on the event's date,
// honoring renames recorded in `group_renames`. If the event date is BEFORE
// a recorded rename for this group, we fall back to the old group_name —
// so coord_history lookups attribute the event to the OLD coordinator.
//
// ⚠ RENAME-DUP HARDENING (2026-06-06): `group_renames` is polluted — the Drive
// sync RE-RECORDS the same rename on every run, stamping `renamed_on` with the
// run date (e.g. one real NORHAN→Radwa on 2026-06-01 also appears re-stamped on
// 06-04 and 06-06), plus reverse rows (A→B and B→A both present). The old logic
// picked the EARLIEST renamed_on STRICTLY AFTER the event date, so a re-stamped
// duplicate dated AFTER a post-rename event wrongly rewound the name to the OLD
// value → coordinator-at-date matched the OLD coordinator → real absences were
// attributed away from the current coordinator (showed 0). Fix: only rewind when
// the event predates the group's TRUE rename date = MIN(renamed_on) for this
// (new_group_name,line). Later re-stamps are ignored, so a post-rename event
// keeps the current name and attributes correctly. (Non-destructive; logic-only —
// `group_renames` rows are untouched.)
function effectiveGroupNameAtDate(groupExpr, lineExpr, dateExpr) {
  return `COALESCE(
    (SELECT gr.old_group_name FROM group_renames gr
      WHERE gr.new_group_name = ${groupExpr}
        AND gr.line           = ${lineExpr}
        AND DATE(gr.renamed_on) > ${dateExpr}
        AND DATE(gr.renamed_on) = (
          SELECT MIN(DATE(gr2.renamed_on)) FROM group_renames gr2
           WHERE gr2.new_group_name = ${groupExpr}
             AND gr2.line           = ${lineExpr}
        )
      ORDER BY DATE(gr.renamed_on) ASC LIMIT 1),
    ${groupExpr}
  )`;
}

function coordFilterAtDate(groupExpr, lineExpr, dateExpr, value) {
  if (!value) return '';
  const safe = String(value).replace(/'/g, "''").trim();
  if (!safe) return '';
  // DATE() wrapper + rename-aware group resolution: for events whose date
  // is before a recorded rename, look up history under the OLD group_name.
  const effG = effectiveGroupNameAtDate(groupExpr, lineExpr, dateExpr);
  return ` AND EXISTS (
    SELECT 1 FROM coordinator_history ch_f
    WHERE ch_f.group_name = ${effG}
      AND ch_f.line       = ${lineExpr}
      AND DATE(ch_f.effective_from) <= ${dateExpr}
      AND (ch_f.effective_to IS NULL OR DATE(ch_f.effective_to) > ${dateExpr})
      AND ch_f.coordinator = '${safe}' COLLATE NOCASE
  )`;
}

/**
 * Parameterized variant of coordFilterAtDate for use with prepared statements.
 * Emits the EXISTS clause WITHOUT inlining the name — the caller binds the
 * name as a positional `?` parameter. Returns a SQL fragment that always
 * applies (no empty-string shortcut).
 */
function coordFilterAtDatePrepared(groupExpr, lineExpr, dateExpr) {
  const effG = effectiveGroupNameAtDate(groupExpr, lineExpr, dateExpr);
  return ` AND EXISTS (
    SELECT 1 FROM coordinator_history ch_f
    WHERE ch_f.group_name = ${effG}
      AND ch_f.line       = ${lineExpr}
      AND DATE(ch_f.effective_from) <= ${dateExpr}
      AND (ch_f.effective_to IS NULL OR DATE(ch_f.effective_to) > ${dateExpr})
      AND ch_f.coordinator = ? COLLATE NOCASE
  )`;
}

/**
 * Time-aware department filter.
 *
 * Returns events where, at the event's date, the coordinator-of-record was
 * registered in `activeDept`. The coordinator-of-record comes from
 * `coordinator_history`; their section on that date comes from
 * `team_member_dept_history` (managed from the فريق العمل page). Falls back to
 * `batches.dept_type` only when NO coordinator in coordinator_history at that
 * date has a team-history record covering the date (graceful for coordinators
 * without team history).
 *
 * Use this in place of `buildDeptFilter` when the query has a date column,
 * so that historical absences are attributed to the coordinator's
 * department-at-that-time rather than their current department.
 *
 * @param {string} batchAlias   alias of the batches table in the outer query
 * @param {string} dateExpr     SQL expression yielding the event's date
 * @param {string} activeDept   department to filter by ('' or 'All' → no filter)
 */
function coordDeptAtDateFilter(batchAlias, dateExpr, activeDept) {
  // activeDept can be:
  //   • '' / null / 'All' / [] → no filter
  //   • string                  → single-dept filter (legacy callers)
  //   • string[]                → multi-dept filter (multi-section leaders)
  if (!activeDept) return '';
  const depts = Array.isArray(activeDept) ? activeDept : [activeDept];
  const cleaned = depts
    .filter(Boolean)
    .filter(d => d !== 'All')
    .map(d => String(d).toLowerCase().trim().replace(/'/g, "''"));
  if (cleaned.length === 0) return '';
  const inList = cleaned.map(d => `'${d}'`).join(',');
  // ── Team-history attribution ──────────────────────────────────────────────
  // For each coordinator-of-record at the event date, the effective department
  // (section) comes from team_member_dept_history. Falls back to
  // batches.dept_type only when NO coordinator has a team-history record
  // covering the date. (User dept-history is no longer consulted — the team
  // history is the single source of truth, see فريق العمل page.)
  // Section values (general/private/semi) lower-case to the same target list.
  return ` AND (
    EXISTS (
      SELECT 1
        FROM coordinator_history ch_c
       WHERE ch_c.group_name = ${batchAlias}.group_name
         AND ch_c.line       = ${batchAlias}.line
         AND DATE(ch_c.effective_from) <= ${dateExpr}
         AND (ch_c.effective_to IS NULL OR DATE(ch_c.effective_to) > ${dateExpr})
         AND EXISTS (
           SELECT 1 FROM team_member_dept_history tmh
            WHERE LOWER(TRIM(tmh.member_name)) = LOWER(TRIM(ch_c.coordinator))
              AND DATE(tmh.effective_from) <= ${dateExpr}
              AND (tmh.effective_to IS NULL OR DATE(tmh.effective_to) > ${dateExpr})
              AND LOWER(TRIM(tmh.section)) IN (${inList})
         )
    )
    OR (
      LOWER(TRIM(${batchAlias}.dept_type)) IN (${inList})
      AND NOT EXISTS (
        SELECT 1
          FROM coordinator_history ch_c2
         WHERE ch_c2.group_name = ${batchAlias}.group_name
           AND ch_c2.line       = ${batchAlias}.line
           AND DATE(ch_c2.effective_from) <= ${dateExpr}
           AND (ch_c2.effective_to IS NULL OR DATE(ch_c2.effective_to) > ${dateExpr})
           AND EXISTS (
             SELECT 1 FROM team_member_dept_history tmh3
              WHERE LOWER(TRIM(tmh3.member_name)) = LOWER(TRIM(ch_c2.coordinator))
                AND DATE(tmh3.effective_from) <= ${dateExpr}
                AND (tmh3.effective_to IS NULL OR DATE(tmh3.effective_to) > ${dateExpr})
           )
      )
    )
  )`;
}

/**
 * Employment-window filter (opt-in). Keeps an event only when, on its date, the
 * group's coordinator-of-record (coordinator_history) is a فريق العمل member
 * (team_members, customer_services) who was EMPLOYED then
 * (start_date ≤ date ≤ end_date). Used by the attendance-absence drill-down
 * lists so their counts match the per-coordinator table / cards (which apply
 * the same roster + employment-window rule). NOT applied unless the caller
 * passes ?roster_window=1, so other consumers (SystemReports, dashboard) are
 * unaffected.
 *
 * ⚠ ENDED/RENAME FIX (2026-06-06): this used to key the coordinator_history
 * lookup off a BATCHES alias (b/b2) — `ch_ew.group_name = b.group_name`. But
 * ENDED groups are removed from `batches`, and renamed groups keep their OLD
 * name on the absence rows, so the absent-list's `LEFT JOIN batches` produced
 * b.group_name = NULL → the EXISTS matched nothing → EVERY drill-down row for a
 * coordinator whose groups have all ended/renamed was dropped (modal showed 0
 * while the per-coordinator table showed the real count — e.g. yassmen 251 vs
 * 0). Fix: key the lookup off the EVENT's OWN group (a/l), resolved rename-aware
 * via effectiveGroupNameAtDate — exactly like coordFilterAtDate — so it never
 * depends on a batches row existing.
 */
function employmentWindowFilter(groupExpr, lineExpr, dateExpr) {
  const effG = effectiveGroupNameAtDate(groupExpr, lineExpr, dateExpr);
  return ` AND EXISTS (
    SELECT 1 FROM coordinator_history ch_ew
      JOIN team_members tm_ew
        ON LOWER(TRIM(tm_ew.name)) = LOWER(TRIM(ch_ew.coordinator))
       AND tm_ew.department = 'customer_services'
     WHERE ch_ew.group_name = ${effG}
       AND ch_ew.line       = ${lineExpr}
       AND DATE(ch_ew.effective_from) <= ${dateExpr}
       AND (ch_ew.effective_to IS NULL OR DATE(ch_ew.effective_to) > ${dateExpr})
       -- NOTE: deliberately NOT filtering by tm_ew.start_date (hire date). It
       -- defaults to the record-CREATION date when a member is added without an
       -- explicit hire date (team.routes buildEmploymentDates… → _today()), so it
       -- is frequently LATER than the coordinator actually started — which wrongly
       -- dropped real events. coordinator_history.effective_from is the
       -- authoritative "responsible since" date, so it already bounds the start.
       AND (tm_ew.end_date   IS NULL OR TRIM(tm_ew.end_date)   = '' OR DATE(tm_ew.end_date)   >= ${dateExpr})
  )`;
}

/**
 * Display expression: returns the coordinator(s) responsible at the event's
 * date (comma-separated if more than one). NULL if no history record covers
 * that date — caller can COALESCE with the current batches.coordinators.
 */
function coordinatorAtDateExpr(groupExpr, lineExpr, dateExpr) {
  const effG = effectiveGroupNameAtDate(groupExpr, lineExpr, dateExpr);
  // DISTINCT coordinator: coordinator_history can hold redundant duplicate rows
  // for the same group/coordinator/window (559 exact dupes live), which made the
  // name render doubled ("doha, doha"). DISTINCT can't take a custom separator in
  // SQLite, so dedupe in an inner subquery first.
  return `(SELECT GROUP_CONCAT(c, ', ') FROM (
             SELECT DISTINCT ch_d.coordinator AS c
               FROM coordinator_history ch_d
              WHERE ch_d.group_name = ${effG}
                AND ch_d.line       = ${lineExpr}
                AND DATE(ch_d.effective_from) <= ${dateExpr}
                AND (ch_d.effective_to IS NULL OR DATE(ch_d.effective_to) > ${dateExpr})
                AND TRIM(ch_d.coordinator) NOT IN ('--','')
                AND EXISTS (SELECT 1 FROM team_members tm_x
                             WHERE REPLACE(LOWER(TRIM(tm_x.name)),' ','') = REPLACE(LOWER(TRIM(ch_d.coordinator)),' ',''))))`;
} // only coordinators registered in فريق العمل (team_members) are shown; unregistered names (and '--') render blank

/**
 * SQL fragment excluding INTERNAL / placeholder buckets — not real teaching
 * groups. Students are parked in them temporarily (placement tests, free slots,
 * new-teacher hiring) while their real group/coordinator is elsewhere, so they
 * must NOT count as lecture absences nor be attributed to the bucket's
 * coordinator. ~79% of "main absence" rows came from these. Use in absence /
 * expected-lecture WHERE clauses: ` ... ${notInternalGroup('a.group_name')}`.
 */
function notInternalGroup(groupExpr) {
  return ` AND LOWER(TRIM(${groupExpr})) NOT LIKE '%free slot%'
           AND LOWER(TRIM(${groupExpr})) NOT LIKE '%hiring new teacher%'
           AND LOWER(TRIM(${groupExpr})) NOT LIKE '%placem%test%'
           AND ${groupExpr} NOT LIKE '%تحديد مستو%'`;
}

/**
 * Single coordinator-of-record at a date (most recent match).
 *
 * Unlike a `batches` join, this survives the group LEAVING the batches table:
 * ended/removed groups disappear from `batches` (so a LEFT JOIN yields NULL
 * coordinators + NULL dept_type → the section shows "—"), but their rows remain
 * in `coordinator_history`. Use this as a fallback to recover the coordinator
 * (and, via the coordinator's registered department, the section) for absences
 * whose group is no longer in `batches`.
 */
function coordAtDateSingleExpr(groupExpr, lineExpr, dateExpr) {
  const effG = effectiveGroupNameAtDate(groupExpr, lineExpr, dateExpr);
  return `(SELECT ch1.coordinator FROM coordinator_history ch1
            WHERE ch1.group_name = ${effG}
              AND ch1.line       = ${lineExpr}
              AND DATE(ch1.effective_from) <= ${dateExpr}
              AND (ch1.effective_to IS NULL OR DATE(ch1.effective_to) > ${dateExpr})
              AND TRIM(ch1.coordinator) NOT IN ('--','')
              AND EXISTS (SELECT 1 FROM team_members tm_x
                           WHERE REPLACE(LOWER(TRIM(tm_x.name)),' ','') = REPLACE(LOWER(TRIM(ch1.coordinator)),' ',''))
            ORDER BY DATE(ch1.effective_from) DESC LIMIT 1)`;
}

/**
 * Department of a coordinator, matched by a NORMALIZED name key.
 *
 * Coordinator names are stored inconsistently across tables (batches.coordinators
 * 'RadwaGamal', coordinator_history 'RadwaGamal', users.full_name 'Radwa Gamal').
 * An exact full_name match silently fails → section renders "—". Match on the
 * exact name OR a space-stripped, lowercased compact key so 'RadwaGamal' resolves
 * to the user 'Radwa Gamal' (General). Returns NULL if still unmatched.
 */
function userDeptExpr(coordExpr) {
  return `(SELECT u.department FROM users u
            WHERE (LOWER(TRIM(u.full_name)) = LOWER(TRIM(${coordExpr}))
                OR REPLACE(LOWER(TRIM(u.full_name)),' ','') = REPLACE(LOWER(TRIM(${coordExpr})),' ',''))
              AND u.department IS NOT NULL AND u.department != 'All'
            LIMIT 1)`;
}

/**
 * Forward rename resolution: given a group name that may be the OLD (pre-rename)
 * name, return the CURRENT name it was renamed TO (latest hop). When a group is
 * renamed, its `lectures` rows are relabeled to the new name but `absent_students`
 * rows keep the old name — so matching an absence (old name) to its lecture (new
 * name) by `=` fails. COALESCE this so callers can match BOTH names.
 *
 * ⚠ RENAME-DUP HARDENING (2026-06-06): `group_renames` is polluted with BOGUS
 * REVERSE rows — the Drive sync re-records active renames every run and also
 * emits the reverse edge (one real norhan→Radwa on 06-01 also appears re-stamped
 * 06-04/06-06, PLUS spurious Radwa→norhan on 06-04/06-06). The old "latest
 * renamed_on hop" logic then SWAPPED names (Radwa→norhan AND norhan→Radwa both
 * resolved to the other), so the two twin rows a rename leaves in `lectures`
 * (old name + new name, same date/time/trainer) got DIFFERENT canonical keys →
 * COUNT(DISTINCT sessKey) failed to dedup → per-coordinator lecture/zoom counts
 * DOUBLED. Fix: anchor to the authoritative live name. The current name is the
 * one that still exists in `batches` (the old name is dropped on rename). So:
 *   1. if the name itself is a live batch → it's already current, return it;
 *   2. else resolve to the rename target that is a live batch (the true new name);
 *   3. else (ended group, gone from batches) fall back to the latest hop.
 * This yields a STABLE canonical (both twins → the live name) and the correct
 * current name for display/matching. (Non-destructive; logic-only.)
 */
function currentGroupNameExpr(groupExpr, lineExpr) {
  return `CASE
    WHEN EXISTS (SELECT 1 FROM batches b_cur
                  WHERE b_cur.group_name = ${groupExpr} AND b_cur.line = ${lineExpr})
      THEN ${groupExpr}
    ELSE COALESCE(
      (SELECT gr_b.new_group_name FROM group_renames gr_b
        WHERE gr_b.old_group_name = ${groupExpr}
          AND gr_b.line           = ${lineExpr}
          AND EXISTS (SELECT 1 FROM batches b2
                       WHERE b2.group_name = gr_b.new_group_name AND b2.line = ${lineExpr})
        ORDER BY DATE(gr_b.renamed_on) DESC LIMIT 1),
      (SELECT gr_f.new_group_name FROM group_renames gr_f
        WHERE gr_f.old_group_name = ${groupExpr}
          AND gr_f.line           = ${lineExpr}
        ORDER BY DATE(gr_f.renamed_on) DESC LIMIT 1),
      ${groupExpr}
    )
  END`;
}

/**
 * Remarks counterpart — assigned_to history keyed by remark external_id.
 * Use when filtering remark-counting queries by assignee name with a date.
 * `dateExpr` is the date column on the event row (usually the remark itself).
 */
function remarkAssigneeFilterAtDate(externalIdExpr, lineExpr, dateExpr, value) {
  if (!value) return '';
  const safe = String(value).replace(/'/g, "''").trim();
  if (!safe) return '';
  // Same day-level DATE() comparison as coordFilterAtDate — see comment there.
  return ` AND EXISTS (
    SELECT 1 FROM remark_assignment_history rah_f
    WHERE rah_f.remark_external_id = ${externalIdExpr}
      AND rah_f.line               = ${lineExpr}
      AND DATE(rah_f.effective_from) <= ${dateExpr}
      AND (rah_f.effective_to IS NULL OR DATE(rah_f.effective_to) > ${dateExpr})
      AND rah_f.assigned_to = '${safe}' COLLATE NOCASE
  )`;
}

// Department filter for the `remarks` table — coordinator-first rule (Fix 16) + Fix 9 fallback.
// Rules:
//   1. Client HAS a group → match if coordinator registered in this dept,
//      OR (coordinator not registered anywhere AND batch.dept_type matches).
//      Prevents leaks where batch dept_type disagrees with coordinator's registered dept.
//   2. Client has NO group → fall back to team_members.section match on assigned_to (Fix 9).
// `alias` is the remarks table alias in the outer query (e.g. 'remarks', 'r').
function buildDeptRemarkFilter(alias, department) {
  if (!department || department === 'All') return '';
  const safe = department.replace(/'/g, "''");
  const a = alias || 'remarks';
  return ` AND (
    EXISTS (
      SELECT 1 FROM clients c
      INNER JOIN batches b ON c.group_name = b.group_name
      WHERE c.phone = ${a}.client_phone
        AND (
          EXISTS (
            SELECT 1 FROM users u
            WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
              AND u.department = '${safe}'
          )
          OR (
            b.dept_type = '${safe}'
            AND NOT EXISTS (
              SELECT 1 FROM users u
              WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
                AND u.department IS NOT NULL AND u.department != 'All'
            )
          )
        )
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM clients c
        INNER JOIN batches b ON c.group_name = b.group_name
        WHERE c.phone = ${a}.client_phone
      )
      AND EXISTS (
        SELECT 1 FROM team_members tm
        WHERE LOWER(TRIM(tm.name)) LIKE LOWER('%' || TRIM(${a}.assigned_to) || '%')
          AND LOWER(tm.section) = LOWER('${safe}')
      )
    )
  )`;
}

function escapeLike(s) {
  if (!s) return '';
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ─── parseTeamShifts ─────────────────────────────────────────────────────────
// Returns ALL configured shifts for a team_member row, normalized into the
// shape every shift-consuming check expects:
//   { startMin, endMin, days, startDate, endDate, rests, voiceNotes, startStr, endStr }
//
// Sources, in order:
//   1. `t.shifts_json` (canonical, unlimited shifts).
//   2. Fallback to legacy `shift / shift_*` and `shift2 / shift2_*` columns.
//
// Use this in place of `[normalizeShift(t,''), normalizeShift(t,'2')].filter(Boolean)`
// so 3rd+ shifts are counted in code-problems, trainer-utilization, etc.
function parseTeamShifts(t) {
  if (!t) return [];
  const parseHM  = (s) => {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
  };
  const parseEnd = (s) => {
    const v = parseHM(s);
    return v === 0 ? 1440 : v;          // 00:00 means end-of-day
  };
  const parseRests = (raw) => {
    if (!raw) return [];
    let arr = raw;
    if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { return []; } }
    if (!Array.isArray(arr)) return [];
    return arr
      // Expose BOTH key styles: `startMin/endMin` (used by the code-problems
      // schedule check) AND `s/e` (used by shiftMinsForDate / voiceNoteMinsForDate
      // in the trainer-utilization + find-available-trainer endpoints). Before
      // this alias, those endpoints read r.s/r.e which were undefined → NaN →
      // every shift WITH a rest counted as 0 hours (trainer dropped) and voice
      // notes nulled out the utilization. Keep both so all consumers work.
      .map(r => {
        const startMin = parseHM(r && r.start), endMin = parseHM(r && r.end);
        // Optional per-day scoping: a break/voice block can apply to specific
        // work-days only (e.g. break 2–3 on Sun+Wed, 1–2 on Mon+Thu inside ONE
        // shift). Empty `days` = applies to EVERY work-day of the shift.
        const days = Array.isArray(r && r.days)
          ? r.days.map(x => String(x).trim().toLowerCase()).filter(Boolean)
          : String((r && r.days) || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
        return { startMin, endMin, s: startMin, e: endMin, days };
      })
      .filter(r => r.startMin != null && r.endMin != null && r.endMin > r.startMin);
  };
  const normalize = (s) => {
    if (!s || !s.shift) return null;
    const startMin = parseHM(s.start);
    const endMin   = parseEnd(s.end);
    if (startMin == null || endMin == null) return null;
    const days = String(s.work_days || '')
      .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    return {
      startMin, endMin, days,
      label:     s.shift ? String(s.shift).trim().toLowerCase() : null,       // 'morning'/'evening' → SHIFT_AR; was missing → UI showed "undefined"
      section:   s.section ? String(s.section).trim().toLowerCase() : null,  // per-shift section (null = trainer's main section)
      startDate: s.start_date || null,
      endDate:   s.end_date   || null,
      rests:      parseRests(s.rests),
      voiceNotes: parseRests(s.voice_notes),
      startStr:   s.start || '',
      endStr:     s.end   || '',
    };
  };

  // Source 1: canonical JSON column.
  let raw = null;
  if (t.shifts_json) {
    try { raw = JSON.parse(t.shifts_json); } catch { raw = null; }
  }
  // Source 2: legacy columns (only when JSON is absent — keeps un-migrated
  // rows fully functional while the backfill catches up).
  if (!Array.isArray(raw) || raw.length === 0) {
    raw = [];
    if (t.shift) raw.push({
      shift: t.shift, start: t.shift_start, end: t.shift_end,
      rests: t.shift_rests, voice_notes: t.voice_notes,
      employment_type: t.employment_type, work_days: t.work_days,
      start_date: t.shift_start_date, end_date: t.shift_end_date,
    });
    if (t.shift2) raw.push({
      shift: t.shift2, start: t.shift2_start, end: t.shift2_end,
      rests: t.shift2_rests, voice_notes: t.shift2_voice_notes,
      employment_type: t.shift2_employment_type, work_days: t.shift2_work_days,
      start_date: t.shift2_start_date, end_date: t.shift2_end_date,
    });
  }
  return raw.map(normalize).filter(Boolean);
}

// ─── trainerCountStart ───────────────────────────────────────────────────────
// Utilization is only meaningful from when a trainer is BOTH employed AND has a
// registered shift — the LATER of (hire date = team_members.start_date, earliest
// shift start_date). Before that there's no capacity baseline, so pre-period
// lectures would push utilization way past 100% (e.g. lectures exist in April
// but shifts start in May). Returns 'YYYY-MM-DD' or null (= no clamp).
function trainerCountStart(trainer, shifts) {
  let earliest = null, anyOpen = false;
  for (const sh of (shifts || [])) {
    if (!sh.startDate) anyOpen = true;                       // open-start shift = capacity from any date
    else if (!earliest || sh.startDate < earliest) earliest = sh.startDate;
  }
  const shiftClamp = anyOpen ? null : earliest;
  const hire = trainer && trainer.start_date ? String(trainer.start_date).slice(0, 10) : null;
  const cands = [hire, shiftClamp].filter(Boolean);
  if (!cands.length) return null;
  return cands.sort().pop();                                  // max (later) of the two dates
}

// ─── trainerCountEnd ─────────────────────────────────────────────────────────
// The LAST day a trainer was employed (all shifts have an end_date → the latest
// one). Returns null when ANY shift is open-ended (still employed → no clamp).
// Used to drop PHANTOM scheduled rows: when a trainer leaves, their recurring
// `مجدولة` (scheduled) slots are removed from the live sheet, but stale rows
// already imported into the DB persist (the importer only deletes group+date
// keys present in the new file). Those stale rows are dated AFTER the trainer's
// departure and falsely inflate booked/utilization (e.g. Nashwa 265%). We
// exclude ONLY scheduled rows after this date — confirmed (مؤكدة) lectures are
// always kept, so a real last-day lecture just past the shift end still counts.
function trainerCountEnd(trainer, shifts) {
  let latest = null;
  for (const sh of (shifts || [])) {
    if (!sh.endDate) return null;                            // open-ended shift = still employed
    if (!latest || sh.endDate > latest) latest = sh.endDate;
  }
  return latest;                                             // null when no shifts
}

// ─── computeOverallEmployment ────────────────────────────────────────────────
// "Asmaa Saber" pattern: a trainer with multiple shifts whose work_days
// happen to cover all 6 work days when combined is effectively Full Time —
// even though each individual shift is stored as Part Time to allow
// per-shift rest/voice-note customization.
//
// Returns:
//   { type: 'full_time' | 'part_time' | null,
//     split: boolean,     // true when ≥2 shifts contributed days
//     days_covered: 0..6 }
//
// Pass either an array of shift bundles (with `work_days` strings) or the
// raw `shifts_json` rows — both are accepted.
function computeOverallEmployment(shiftsOrBundles) {
  const ALL_DAYS = ['saturday','sunday','monday','tuesday','wednesday','thursday'];
  if (!Array.isArray(shiftsOrBundles) || shiftsOrBundles.length === 0) {
    return { type: null, split: false, days_covered: 0, uniform_times: true };
  }
  const daysUnion = new Set();
  const timeKeys  = new Set();   // distinct (start|end) pairs across shifts
  let contributingShifts = 0;
  for (const sh of shiftsOrBundles) {
    if (!sh) continue;
    // Accept either `work_days` (string) or `days` (array from parseTeamShifts)
    let dayList = [];
    if (Array.isArray(sh.days)) {
      dayList = sh.days;
    } else if (sh.work_days) {
      dayList = String(sh.work_days).split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    }
    if (dayList.length === 0) continue;
    contributingShifts += 1;
    dayList.forEach(d => daysUnion.add(d));
    // Accept raw JSON keys (start/end) AND parseTeamShifts output (startStr/endStr)
    const start = sh.start || sh.startStr || '';
    const end   = sh.end   || sh.endStr   || '';
    if (start && end) timeKeys.add(`${start}|${end}`);
  }
  if (daysUnion.size === 0) {
    return { type: null, split: false, days_covered: 0, uniform_times: true };
  }
  const allCovered   = ALL_DAYS.every(d => daysUnion.has(d));
  const uniformTimes = timeKeys.size <= 1;
  // "Full Time موزّع" requires BOTH a full-week coverage AND uniform shift
  // times — otherwise the trainer works different schedules on different
  // days, which is Part Time (varying), not Full Time.
  return {
    type:           (allCovered && uniformTimes) ? 'full_time' : 'part_time',
    split:          contributingShifts > 1,
    uniform_times:  uniformTimes,
    days_covered: daysUnion.size,
  };
}

// Builds the inner UNION+dedup query used by /remarks-notes-main.
// Returns an SQL string that can be wrapped in `SELECT ... FROM (${innerQ}) t WHERE 1=1 ${havingFilter}`.
// Used by the endpoint AND by the dashboard KPI so both always agree on the count.
function buildRemarksNotesMainInnerQ({ from_date, to_date, department, employee, coordinator = '', search = '', line }) {
  const lineA  = buildLineFilter('a', line);
  const lineL  = buildLineFilter('l', line);
  const lineR3 = buildLineFilter('r3', line);

  // Coordinator → auto-resolve their registered dept (strict) when no explicit dept given
  let resolvedDept = department && department !== 'All' ? department : '';
  if (coordinator && !resolvedDept) {
    const coordUser = db.prepare(
      `SELECT department FROM users WHERE LOWER(TRIM(full_name))=LOWER(TRIM(?)) AND department != 'All'${line ? ` AND line IN ('${line.replace(/'/g, "''")}','All')` : ''} LIMIT 1`
    ).get(coordinator.trim());
    if (coordUser?.department) resolvedDept = coordUser.department;
  }

  // Coordinator-at-date fallback: ended groups disappear from `batches` (so the
  // part1 LEFT JOIN yields NULL coordinators + NULL dept_type → section "—" AND
  // the rows get dropped by the coordinator/dept filters below). They remain in
  // coordinator_history, so resolve the coordinator from there and filter on the
  // RESOLVED value — recovering both the section and the rows themselves.
  const coordAtDate1   = coordAtDateSingleExpr('a.group_name', 'a.line', "COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)");
  const resolvedCoord1 = `COALESCE(b.coordinators, ${coordAtDate1})`;
  const deptFilter1 = buildStrictDeptFilterExpr(resolvedCoord1, 'b.dept_type', resolvedDept);
  const empFilter1  = employee    ? ` AND ${nameInListInline(resolvedCoord1, employee)}`    : '';
  const coord1      = coordinator ? ` AND ${nameInListInline(resolvedCoord1, coordinator)}` : '';
  const search1     = search ? ` AND (a.student_name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR a.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR a.phone LIKE '%${escapeLike(search)}%' ESCAPE '\\')` : '';

  const deptFilter2 = buildStrictDeptFilter('b2', resolvedDept);
  const empFilter2  = buildCoordFilter('b2', employee);
  const coord2      = buildCoordFilter('b2', coordinator);
  const search2     = search ? ` AND (c.name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR l.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR c.phone LIKE '%${escapeLike(search)}%' ESCAPE '\\')` : '';

  const safeCoord3  = coordinator ? coordinator.replace(/'/g, "''") : '';
  const safeDept3   = resolvedDept ? resolvedDept.replace(/'/g, "''") : '';
  const deptFilter3 = safeDept3  ? ` AND (b3.dept_type = '${safeDept3}' OR b3.coordinators IS NULL)` : '';
  const empFilter3  = employee   ? ` AND (${nameInListInline('b3.coordinators', employee)} OR b3.coordinators IS NULL)` : '';
  const coord3      = coordinator ? ` AND (${nameInListInline('b3.coordinators', coordinator)} OR b3.coordinators IS NULL)` : '';
  const search3     = search ? ` AND (COALESCE(c3.name, r3.client_name) LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR c3.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR r3.client_phone LIKE '%${escapeLike(search)}%' ESCAPE '\\')` : '';

  const dateFilter = from_date && to_date
    ? ` AND absence_date BETWEEN '${from_date}' AND '${to_date}'`
    : from_date ? ` AND absence_date >= '${from_date}'`
    : to_date   ? ` AND absence_date <= '${to_date}'` : '';

  const outerCoordFilter = coordinator
    ? ` AND TRIM(LOWER(abs_base.coordinators)) LIKE LOWER('%${coordinator.replace(/'/g,"''")}%')`
    : '';
  const outerEmployeeFilter = employee
    ? ` AND TRIM(LOWER(abs_base.coordinators)) LIKE LOWER('%${employee.replace(/'/g,"''")}%')`
    : '';

  const part1 = `
    SELECT
      COALESCE(c_lu.name, NULLIF(TRIM(a.student_name),'')) AS student_name,
      a.phone AS student_phone, a.group_name,
      COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS absence_date,
      ${resolvedCoord1} AS coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(${resolvedCoord1})) AND u.department != 'All' LIMIT 1),
        b.dept_type
      ) AS dept_type
    FROM absent_students a
    LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
    LEFT JOIN (SELECT phone, MIN(name) AS name FROM clients GROUP BY phone) c_lu
      ON (a.student_name IS NULL OR TRIM(a.student_name)='')
      AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND (c_lu.phone = a.phone OR c_lu.phone = '0' || a.phone OR a.phone = '0' || c_lu.phone)
    LEFT JOIN (
      SELECT group_name, date, line,
        ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
      FROM lectures WHERE session_type = 'main' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
    ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
      AND lec_inf.group_name = a.group_name
      AND a.lecture_no IS NOT NULL AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
    WHERE (
      (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
      OR (a.phone IS NOT NULL AND TRIM(a.phone)!='')
    )
    AND EXISTS (
      SELECT 1 FROM lectures l_chk
       WHERE l_chk.group_name IN (a.group_name, ${currentGroupNameExpr('a.group_name', 'a.line')})
         AND l_chk.session_type = 'main'
         AND l_chk.status != 'غير مؤكدة'
         AND l_chk.date = COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)${line ? ' AND l_chk.line = a.line' : ''}
    )
    ${deptFilter1}${empFilter1}${coord1}${search1}${notInternalGroup('a.group_name')}${lineA}`;

  const part2 = `
    SELECT
      c.name AS student_name, c.phone AS student_phone,
      l.group_name, l.date AS absence_date,
      b2.coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b2.coordinators)) AND u.department != 'All' LIMIT 1),
        b2.dept_type
      ) AS dept_type
    FROM lectures l
    INNER JOIN batches b2 ON l.group_name = b2.group_name${line ? ' AND b2.line = l.line' : ''}
    INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
    WHERE l.session_type = 'main' AND l.status = 'مؤكدة'
      AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
      AND c.name IS NOT NULL AND TRIM(c.name)!=''
      AND c.phone IS NOT NULL AND TRIM(c.phone)!=''
      AND NOT EXISTS (
        SELECT 1 FROM absent_students a2
        WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
      )
    ${deptFilter2}${empFilter2}${coord2}${search2}${notInternalGroup('l.group_name')}${lineL}`;

  const remarksSubQ = `
    SELECT client_phone,
      ${normRemarkDate('added_at')} AS rdate,
      MAX(id) AS id, MAX(details) AS details, MAX(added_at) AS added_at,
      MAX(assigned_to) AS assigned_to, MAX(status) AS status
    FROM remarks WHERE category = 'Attendance Main Session'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
    GROUP BY client_phone, (${normRemarkDate('added_at')})`;

  const rdSQLMain = normRemarkDate('r3.added_at');
  const part3 = `
    SELECT DISTINCT
      COALESCE(c3.name, r3.client_name) AS student_name,
      r3.client_phone                   AS student_phone,
      COALESCE(c3.group_name, '--')     AS group_name,
      ${prevLectureDay(rdSQLMain)}      AS absence_date,
      COALESCE(b3.coordinators, r3.assigned_to) AS coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(COALESCE(b3.coordinators, r3.assigned_to))) AND u.department != 'All' LIMIT 1),
        b3.dept_type
      ) AS dept_type
    FROM remarks r3
    LEFT JOIN clients c3 ON c3.phone = r3.client_phone${line ? ' AND c3.line = r3.line' : ''}
      AND c3.group_name = COALESCE(
        (SELECT cl.group_name FROM clients cl
         INNER JOIN batches bl ON bl.group_name = cl.group_name${line ? ' AND bl.line = cl.line' : ''}
         WHERE cl.phone = r3.client_phone
           AND bl.start_date IS NOT NULL
           AND bl.start_date <= ${rdSQLMain}${line ? ` AND cl.line = '${line.replace(/'/g, "''")}'` : ''}
         ORDER BY bl.start_date DESC LIMIT 1),
        (SELECT cl2.group_name FROM clients cl2
         WHERE cl2.phone = r3.client_phone${line ? ` AND cl2.line = '${line.replace(/'/g, "''")}'` : ''} ORDER BY cl2.group_name ASC LIMIT 1)
      )
    LEFT JOIN batches b3 ON b3.group_name = c3.group_name${line ? ' AND b3.line = c3.line' : ''}
    WHERE r3.category = 'Attendance Main Session'
      AND r3.client_phone IS NOT NULL AND TRIM(r3.client_phone) != ''
      AND NOT EXISTS (
        SELECT 1 FROM absent_students a3
        WHERE TRIM(a3.phone) = TRIM(r3.client_phone)
          AND a3.date = (${prevLectureDay(rdSQLMain)})${line ? ' AND a3.line = r3.line' : ''}
      )
      AND EXISTS (
        SELECT 1 FROM lectures lx
        WHERE lx.group_name = c3.group_name
          AND lx.session_type = 'main'
          AND lx.status != 'غير مؤكدة'
          AND lx.date = (${prevLectureDay(rdSQLMain)})${line ? ' AND lx.line = r3.line' : ''}
      )
    ${deptFilter3}${empFilter3}${coord3}${search3}${lineR3}`;

  return `
    SELECT
      abs_base.student_name, abs_base.student_phone, abs_base.group_name,
      abs_base.absence_date, abs_base.coordinators, abs_base.dept_type,
      ${nextRemarkDay('abs_base.absence_date')} AS expected_remark_date,
      r.id AS remark_id, r.details AS remark_details, r.added_at AS remark_date,
      r.assigned_to, r.status AS remark_status,
      CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END AS has_remark
    FROM (
      SELECT student_name, student_phone, group_name, absence_date, coordinators, dept_type
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY
              COALESCE(NULLIF(TRIM(student_phone),''), LOWER(TRIM(COALESCE(student_name,'')))),
              group_name,
              absence_date
            ORDER BY
              CASE WHEN student_name IS NOT NULL AND TRIM(student_name) != '' THEN 0 ELSE 1 END,
              CASE WHEN dept_type IS NOT NULL AND dept_type != 'All' THEN 0 ELSE 1 END,
              CASE WHEN coordinators IS NOT NULL AND TRIM(coordinators) != '' THEN 0 ELSE 1 END
          ) AS _rn
        FROM (
          SELECT * FROM (${part1}) p1 WHERE absence_date IS NOT NULL
          UNION ALL
          SELECT * FROM (${part2}) p2
          UNION ALL
          SELECT * FROM (${part3}) p3
        ) _u
      ) _ranked
      WHERE _rn = 1
    ) abs_base
    LEFT JOIN (${remarksSubQ}) r
      ON r.client_phone = abs_base.student_phone
      AND r.rdate = (${nextRemarkDay('abs_base.absence_date')})
    WHERE abs_base.absence_date IS NOT NULL ${dateFilter}${outerCoordFilter}${outerEmployeeFilter}`;
}

// Builds the inner UNION+dedup query used by /remarks-notes-zoom.
// Mirrors buildRemarksNotesMainInnerQ's contract — used by both the endpoint
// and the dashboard KPI so counts stay in lock-step.
function buildRemarksNotesZoomInnerQ({ from_date, to_date, department, employee, coordinator = '', search = '', line }) {
  const lineA  = buildLineFilter('a', line);
  const lineR2 = buildLineFilter('r2', line);

  const safeEmp   = employee    ? employee.replace(/'/g, "''")    : '';
  const safeCoord = coordinator ? coordinator.replace(/'/g, "''") : '';

  let resolvedDept = department && department !== 'All' ? department : '';
  if (coordinator && !resolvedDept) {
    const coordUser = db.prepare(
      `SELECT department FROM users WHERE LOWER(TRIM(full_name))=LOWER(TRIM(?)) AND department != 'All'${line ? ` AND line IN ('${line.replace(/'/g, "''")}','All')` : ''} LIMIT 1`
    ).get(coordinator.trim());
    if (coordUser?.department) resolvedDept = coordUser.department;
  }
  const safeDept = resolvedDept ? resolvedDept.replace(/'/g, "''") : '';

  const dept1  = buildStrictDeptFilter('b', resolvedDept);
  const emp1   = buildCoordFilter('b', employee);
  const coord1 = buildCoordFilter('b', coordinator);
  // Resolved coordinator for the absence-sourced parts (partA / partA_zoom):
  // ended groups leave batches (b.coordinators NULL) but remain in
  // coordinator_history — recover the coordinator so ended/renamed-group zoom
  // absences aren't dropped by the dept/coordinator filter. (a.date is present.)
  const resolvedCoordA = `COALESCE(b.coordinators, ${coordAtDateSingleExpr('a.group_name', 'a.line', 'a.date')})`;
  const deptA  = buildStrictDeptFilterExpr(resolvedCoordA, 'b.dept_type', resolvedDept);
  const empA   = employee    ? ` AND ${nameInListInline(resolvedCoordA, employee)}`    : '';
  const coordA = coordinator ? ` AND ${nameInListInline(resolvedCoordA, coordinator)}` : '';
  const srch1  = search ? ` AND (c.name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR c.phone LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR c.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\')` : '';
  const srchA  = search ? ` AND (a.student_name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR a.phone LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR a.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\')` : '';

  const dept2  = safeDept  ? ` AND (b2.dept_type = '${safeDept}' OR EXISTS (SELECT 1 FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(r2.assigned_to)) AND u.department='${safeDept}'))` : '';
  const emp2   = employee   ? ` AND (${nameInListInline('b2.coordinators', employee)}   OR ${nameInListInline('r2.assigned_to', employee)})`   : '';
  const coord2 = coordinator ? ` AND (${nameInListInline('b2.coordinators', coordinator)} OR ${nameInListInline('r2.assigned_to', coordinator)})` : '';
  const srch2  = search ? ` AND (r2.client_name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR r2.client_phone LIKE '%${escapeLike(search)}%' ESCAPE '\\')` : '';

  const dateFilter = from_date && to_date
    ? ` AND abs_union.session_date BETWEEN '${from_date}' AND '${to_date}'`
    : from_date ? ` AND abs_union.session_date >= '${from_date}'`
    : to_date   ? ` AND abs_union.session_date <= '${to_date}'` : '';

  const partA = `
    SELECT DISTINCT
      COALESCE(c_lu.name, NULLIF(TRIM(a.student_name),'')) AS client_name,
      a.phone AS client_phone,
      a.group_name,
      a.date AS session_date,
      ${resolvedCoordA} AS coordinators,
      COALESCE(
        ${userDeptExpr(resolvedCoordA)},
        b.dept_type
      ) AS dept_type
    FROM absent_students a
    LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
    LEFT JOIN (SELECT phone, MIN(name) AS name FROM clients GROUP BY phone) c_lu
      ON (a.student_name IS NULL OR TRIM(a.student_name) = '')
      AND a.phone IS NOT NULL AND TRIM(a.phone) != ''
      AND (c_lu.phone = a.phone OR c_lu.phone = '0' || a.phone OR a.phone = '0' || c_lu.phone)
    WHERE (
      (a.student_name IS NOT NULL AND TRIM(a.student_name) != '')
      OR (a.phone IS NOT NULL AND TRIM(a.phone) != '')
    )
    AND a.date IS NOT NULL AND TRIM(a.date) != ''
    AND EXISTS (
      SELECT 1 FROM lectures l
      WHERE l.group_name IN (a.group_name, ${currentGroupNameExpr('a.group_name', 'a.line')})
        AND l.session_type = 'side'
        AND l.status != 'غير مؤكدة'
        AND l.date = a.date${line ? ' AND l.line = a.line' : ''}
    )
    ${deptA}${empA}${coordA}${srchA}${notInternalGroup('a.group_name')}${lineA}`;

  // partA_zoom — mirrors partA but reads from absent_zoom_students (the new
  // dedicated zoom-absent table). When the user uploads the zoom-absent Excel
  // these rows live HERE, not in absent_students, so the original partA
  // missed them entirely → students appeared under "غياب الزوم كول" but
  // were absent from "ملحوظات الريماركات للزوم كول". Outer ROW_NUMBER dedup
  // handles any overlap between the two tables.
  const partA_zoom = `
    SELECT DISTINCT
      COALESCE(c_lu.name, NULLIF(TRIM(a.student_name),'')) AS client_name,
      a.phone AS client_phone,
      a.group_name,
      a.date AS session_date,
      ${resolvedCoordA} AS coordinators,
      COALESCE(
        ${userDeptExpr(resolvedCoordA)},
        b.dept_type
      ) AS dept_type
    FROM absent_zoom_students a
    LEFT JOIN batches b ON REPLACE(a.group_name,' ','') = REPLACE(b.group_name,' ','')${line ? ' AND b.line = a.line' : ''}
    LEFT JOIN (SELECT phone, MIN(name) AS name FROM clients GROUP BY phone) c_lu
      ON (a.student_name IS NULL OR TRIM(a.student_name) = '')
      AND a.phone IS NOT NULL AND TRIM(a.phone) != ''
      AND (c_lu.phone = a.phone OR c_lu.phone = '0' || a.phone OR a.phone = '0' || c_lu.phone)
    WHERE (
      (a.student_name IS NOT NULL AND TRIM(a.student_name) != '')
      OR (a.phone IS NOT NULL AND TRIM(a.phone) != '')
    )
    AND a.date IS NOT NULL AND TRIM(a.date) != ''
    AND EXISTS (
      SELECT 1 FROM lectures l
       WHERE REPLACE(l.group_name,' ','') IN (
               REPLACE(a.group_name,' ',''),
               REPLACE(${currentGroupNameExpr('a.group_name', 'a.line')},' ','')
             )
         AND l.date       = a.date
         AND l.session_type = 'side'
         AND l.status != 'غير مؤكدة'
         AND (l.side_session_category = 'regular'
              OR (l.duration IS NOT NULL AND LENGTH(l.duration) >= 5
                  AND CAST(SUBSTR(l.duration,1,2) AS INTEGER)*60
                      + CAST(SUBSTR(l.duration,4,2) AS INTEGER) < 20))${line ? ' AND l.line = a.line' : ''}
    )
    ${deptA}${empA}${coordA}${srchA}${notInternalGroup('a.group_name')}${lineA}`;

  const part1 = `
    SELECT DISTINCT c.name AS client_name, c.phone AS client_phone,
      c.group_name, grp.session_date, b.coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b.coordinators)) AND u.department != 'All' LIMIT 1),
        b.dept_type
      ) AS dept_type
    FROM (
      SELECT l.group_name, l.date AS session_date, l.line,
        COUNT(*) AS slot_count_on_date
      FROM lectures l
      WHERE l.session_type = 'side' AND l.status = 'مؤكدة'
        AND (l.duration IS NULL OR l.duration <= '00:30') AND l.side_session_category = 'regular'${line ? ` AND l.line = '${line.replace(/'/g, "''")}'` : ''}
      GROUP BY l.group_name, l.date, l.line
      HAVING SUM(CASE WHEN l.attendance IS NOT NULL AND TRIM(l.attendance) != ''
                 AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END) = 0
        AND COUNT(*) > 0
    ) grp
    INNER JOIN clients c ON c.group_name = grp.group_name${line ? ' AND c.line = grp.line' : ''}
    INNER JOIN batches b ON b.group_name = grp.group_name${line ? ' AND b.line = grp.line' : ''}
    WHERE c.name IS NOT NULL AND TRIM(c.name) != ''
      AND c.phone IS NOT NULL AND TRIM(c.phone) != ''
      AND (
        grp.slot_count_on_date >= (
          SELECT COUNT(*) FROM clients c_cnt
          WHERE c_cnt.group_name = grp.group_name${line ? ' AND c_cnt.line = grp.line' : ''}
            AND c_cnt.name IS NOT NULL AND TRIM(c_cnt.name) != ''
            AND c_cnt.phone IS NOT NULL AND TRIM(c_cnt.phone) != ''
        )
        OR EXISTS (
          SELECT 1 FROM absent_students a_p1
          WHERE a_p1.group_name = grp.group_name
            AND a_p1.date = grp.session_date${line ? ' AND a_p1.line = grp.line' : ''}
            AND (
              (a_p1.phone IS NOT NULL AND TRIM(a_p1.phone) = TRIM(c.phone))
              OR (a_p1.student_name IS NOT NULL AND LOWER(TRIM(a_p1.student_name)) = LOWER(TRIM(c.name)))
            )
        )
      )
    ${dept1}${emp1}${coord1}${srch1}${notInternalGroup('c.group_name')}`;

  const rdSQL = normRemarkDate('r2.added_at');
  const part2 = `
    SELECT DISTINCT
      COALESCE(c2.name, r2.client_name)       AS client_name,
      r2.client_phone,
      c2.group_name,
      CASE WHEN strftime('%w', ${rdSQL}) = '6' THEN date(${rdSQL}, '-2 days') ELSE date(${rdSQL}, '-1 day') END AS session_date,
      COALESCE(r2.assigned_to, b2.coordinators) AS coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(r2.assigned_to)) AND u.department != 'All' LIMIT 1),
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b2.coordinators)) AND u.department != 'All' LIMIT 1),
        b2.dept_type
      ) AS dept_type
    FROM remarks r2
    LEFT JOIN clients c2 ON c2.phone = r2.client_phone${line ? ' AND c2.line = r2.line' : ''}
      AND c2.group_name = COALESCE(
        (SELECT cl.group_name FROM clients cl
         INNER JOIN batches bl ON bl.group_name = cl.group_name${line ? ' AND bl.line = cl.line' : ''}
         WHERE cl.phone = r2.client_phone
           AND bl.start_date IS NOT NULL
           AND bl.start_date <= ${rdSQL}${line ? ` AND cl.line = '${line.replace(/'/g, "''")}'` : ''}
         ORDER BY bl.start_date DESC LIMIT 1),
        (SELECT cl2.group_name FROM clients cl2
         WHERE cl2.phone = r2.client_phone${line ? ` AND cl2.line = '${line.replace(/'/g, "''")}'` : ''} ORDER BY cl2.group_name ASC LIMIT 1)
      )
    LEFT JOIN batches b2 ON b2.group_name = c2.group_name${line ? ' AND b2.line = c2.line' : ''}
    WHERE r2.category = 'Attendance Zoom Call'
      AND EXISTS (
        SELECT 1 FROM lectures lz
         WHERE lz.group_name = c2.group_name
           AND lz.session_type = 'side'
           AND lz.status != 'غير مؤكدة'
           AND lz.date = (CASE WHEN strftime('%w', ${rdSQL}) = '6' THEN date(${rdSQL}, '-2 days') ELSE date(${rdSQL}, '-1 day') END)${line ? ' AND lz.line = r2.line' : ''}
      )
    ${dept2}${emp2}${coord2}${srch2}${lineR2}`;

  const remarksSubQ = `
    SELECT client_phone,
      ${normRemarkDate('added_at')} AS rdate,
      MAX(id) AS id, MAX(details) AS details, MAX(added_at) AS added_at,
      MAX(assigned_to) AS assigned_to, MAX(status) AS status
    FROM remarks WHERE category = 'Attendance Zoom Call'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
    GROUP BY client_phone, (${normRemarkDate('added_at')})`;

  const outerCoordFilter = safeCoord
    ? ` AND TRIM(LOWER(abs_union.coordinators)) LIKE LOWER('%${safeCoord}%')`
    : '';
  const outerEmployeeFilter = safeEmp
    ? ` AND TRIM(LOWER(abs_union.coordinators)) LIKE LOWER('%${safeEmp}%')`
    : '';

  return `
    SELECT
      abs_union.client_name, abs_union.client_phone, abs_union.group_name,
      abs_union.session_date, abs_union.coordinators, abs_union.dept_type,
      ${nextRemarkDay('abs_union.session_date')} AS expected_remark_date,
      r.id AS remark_id, r.details AS remark_details, r.added_at AS remark_date,
      r.assigned_to, r.status AS remark_status,
      CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END AS has_remark
    FROM (
      SELECT client_name, client_phone, group_name, session_date, coordinators, dept_type
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY
              COALESCE(NULLIF(TRIM(client_phone),''), LOWER(TRIM(COALESCE(client_name,'')))),
              group_name,
              session_date
            ORDER BY
              CASE WHEN client_name IS NOT NULL AND TRIM(client_name) != '' THEN 0 ELSE 1 END,
              CASE WHEN dept_type IS NOT NULL AND dept_type != 'All' THEN 0 ELSE 1 END,
              CASE WHEN coordinators IS NOT NULL AND TRIM(coordinators) != '' THEN 0 ELSE 1 END
          ) AS _rn
        FROM (
          SELECT * FROM (${partA}) pA
          UNION ALL
          SELECT * FROM (${partA_zoom}) pAz
          UNION ALL
          SELECT * FROM (${part1}) p1
          UNION ALL
          SELECT * FROM (${part2}) p2
        ) _u
      ) _ranked
      WHERE _rn = 1
    ) abs_union
    LEFT JOIN (${remarksSubQ}) r
      ON r.client_phone = abs_union.client_phone
      AND r.rdate = (${nextRemarkDay('abs_union.session_date')})
    WHERE abs_union.session_date IS NOT NULL ${dateFilter}${outerCoordFilter}${outerEmployeeFilter}`;
}

// Multi-line tenant filter — appends " AND <alias>.line = '<line>'" to a WHERE clause.
// Pass alias for aliased tables (e.g. 'b', 'r', 'l'); pass '' for plain column reference.
// When line is null (admin 'All'), returns '' so no filter is applied.
function buildLineFilter(alias, line) {
  if (!line) return '';
  const col = alias ? `${alias}.line` : 'line';
  const safe = line.replace(/'/g, "''");
  return ` AND ${col} = '${safe}'`;
}

// Friday-skip helpers — Friday is the weekly day off.
//
// nextRemarkDay(col): given a lecture/absence date column or expression,
//   returns the expected remark date:
//   - Thursday (strftime %w = '4') → Saturday (+2 days, skip Friday)
//   - Any other day               → next day (+1 day)
//
// prevLectureDay(rdSQL): given a remark date expression (used in part3 to
//   work backwards from the remark to the lecture date):
//   - Saturday remark (strftime %w = '6') → Thursday (-2 days, skip Friday)
//   - Any other remark day               → previous day (-1 day)
//
// normRemarkDate(col): normalise added_at to YYYY-MM-DD regardless of
//   storage format.  Remarks created via Excel upload are stored as
//   'DD/MM/YYYY' or 'DD/MM/YYYY HH:MM'; remarks created directly inside the
//   app are stored as SQLite datetime strings ('YYYY-MM-DD HH:MM:SS').
//   The original substr(…) approach only handled the Excel format and
//   returned NULL for ISO-format dates, causing those remarks to be
//   invisible to the rdate join.
const normRemarkDate = (col) =>
  `CASE WHEN ${col} GLOB '??/??/????*' ` +
  `THEN date(substr(${col},7,4)||'-'||substr(${col},4,2)||'-'||substr(${col},1,2)) ` +
  `ELSE date(${col}) END`;

// Official-holiday ranges (e.g. Eid). Used to skip multi-day breaks when
// computing the expected remark/lecture day — without this, an absence right
// before a holiday expected its remark INSIDE the holiday (no working day), so
// the date-exact join missed the follow-up the coordinator actually wrote on the
// first day back. Read fresh per build (tiny table); empty/missing → no-op.
function _holidayRanges() {
  try {
    return db.prepare(`SELECT start_date, end_date FROM official_holidays WHERE start_date IS NOT NULL AND end_date IS NOT NULL`)
      .all()
      .map(r => ({ s: String(r.start_date).slice(0, 10), e: String(r.end_date).slice(0, 10) }))
      .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.s) && /^\d{4}-\d{2}-\d{2}$/.test(r.e));
  } catch (_) { return []; }
}
// Jump a date expression to the day AFTER any holiday range it lands in (forward),
// or the day BEFORE the range (backward).
function _holidaySkip(dateExpr, dir) {
  let expr = `(${dateExpr})`;
  for (const r of _holidayRanges()) {
    expr = dir > 0
      ? `CASE WHEN ${expr} BETWEEN '${r.s}' AND '${r.e}' THEN date('${r.e}','+1 day') ELSE ${expr} END`
      : `CASE WHEN ${expr} BETWEEN '${r.s}' AND '${r.e}' THEN date('${r.s}','-1 day') ELSE ${expr} END`;
  }
  return expr;
}

const nextRemarkDay = (col) => {
  const base  = `CASE WHEN strftime('%w', ${col}) = '4' THEN date(${col}, '+2 days') ELSE date(${col}, '+1 day') END`;
  const skip  = _holidaySkip(base, +1);                 // jump past Eid etc.
  return `CASE WHEN strftime('%w', ${skip}) = '5' THEN date(${skip}, '+1 day') ELSE ${skip} END`;  // landing on Friday → Saturday
};

const prevLectureDay = (rdSQL) => {
  const base  = `CASE WHEN strftime('%w', ${rdSQL}) = '6' THEN date(${rdSQL}, '-2 days') ELSE date(${rdSQL}, '-1 day') END`;
  const skip  = _holidaySkip(base, -1);
  return `CASE WHEN strftime('%w', ${skip}) = '5' THEN date(${skip}, '-1 day') ELSE ${skip} END`;
};

// ─── GET /api/reports/dashboard ───────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const { from_date, to_date, department, employee } = req.query;
  const line = lineFilter(req);
  const lineBatches = buildLineFilter('batches', line);
  const lineB       = buildLineFilter('b', line);
  const lineL       = buildLineFilter('lectures', line);
  const lineLA      = buildLineFilter('l', line);
  const lineA       = buildLineFilter('a', line);
  const lineRemarks = buildLineFilter('remarks', line);

  const deptBatches = buildDeptFilter('batches', department);
  const deptB       = buildDeptFilter('b', department);
  const empFilter   = buildCoordFilter('batches', employee);      // current state (groups counts)
  // Date-aware variants for event-based queries (lectures, absences):
  const empFilterLectures = coordFilterAtDate('lectures.group_name', 'lectures.line', 'lectures.date', employee);
  const empFilterAbsentA  = coordFilterAtDate('a.group_name', 'a.line', 'a.date', employee);
  const empFilterAbsentL  = coordFilterAtDate('l.group_name', 'l.line', 'l.date', employee);
  const empBFilter        = buildCoordFilter('b', employee);       // current state (for batch-level filters)
  const empRemark         = employee ? ` AND ${nameInListInline('remarks.assigned_to', employee)}` : '';

  // Remarks dept filter — coordinator-first (Fix 16) + team_members fallback (Fix 9).
  // Centralized helper ensures dashboard KPIs and /remarks-list match exactly.
  const deptRemark  = buildDeptRemarkFilter('remarks', department);

  try {
    // 1. Active groups (3 statuses)
    const activeGroupsList = db.prepare(
      `SELECT * FROM batches WHERE status='نشطة'${deptBatches}${empFilter}${lineBatches} ORDER BY start_date DESC`
    ).all();

    const waitingTraineesList = db.prepare(
      `SELECT * FROM batches WHERE status='بانتظار تسجيل المتدربين'${deptBatches}${empFilter}${lineBatches} ORDER BY start_date DESC`
    ).all();

    const waitingLecturesList = db.prepare(
      `SELECT * FROM batches WHERE status='بانتظار تسجيل المحاضرات'${deptBatches}${empFilter}${lineBatches} ORDER BY start_date DESC`
    ).all();

    // 2. Expired active groups
    const expiredGroupsList = db.prepare(
      `SELECT * FROM batches
       WHERE status='نشطة'
         AND end_date IS NOT NULL
         AND end_date != ''
         AND end_date <= date('now', '+2 hours')
       ${deptBatches}${empFilter}${lineBatches}
       ORDER BY end_date DESC`
    ).all();

    // 3. Main lectures count — session_type='main' (uploaded from "Lecture" Excel sheet)
    // Only confirmed lectures count — status='مؤكدة'
    // Date-aware: attribute by who was coordinator on lectures.date.
    // LEFT JOIN batches (not INNER): ended groups disappear from batches but their
    // lectures remain — an INNER JOIN silently undercounted them. COUNT(DISTINCT
    // <canonical session>) so the lecture rows a rename left duplicated under the
    // OLD name aren't double-counted: the key canonicalizes group_name to its
    // current (renamed-to) name + date + time + trainer. (Non-destructive — no
    // lecture rows are deleted; the count just dedups + includes ended groups.)
    const sessKey = `${currentGroupNameExpr('lectures.group_name', 'lectures.line')} || '|' || lectures.date || '|' || COALESCE(lectures.time,'') || '|' || COALESCE(lectures.trainer,'')`;
    const mainLecturesRow = db.prepare(
      `SELECT COUNT(DISTINCT ${sessKey}) as cnt FROM lectures
       LEFT JOIN batches ON lectures.group_name = batches.group_name${line ? ' AND batches.line = lectures.line' : ''}
       WHERE lectures.session_type = 'main'
         AND lectures.status = 'مؤكدة'
       ${buildDateFilter('lectures.date', from_date, to_date)}
       ${deptBatches}${empFilterLectures}${lineL}`
    ).get();

    // 4. Side sessions count — all confirmed side sessions
    const sideLecturesRow = db.prepare(
      `SELECT COUNT(DISTINCT ${sessKey}) as cnt FROM lectures
       LEFT JOIN batches ON lectures.group_name = batches.group_name${line ? ' AND batches.line = lectures.line' : ''}
       WHERE lectures.session_type = 'side'
         AND lectures.status = 'مؤكدة'
       ${buildDateFilter('lectures.date', from_date, to_date)}
       ${deptBatches}${empFilterLectures}${lineL}`
    ).get();

    // 4b. Zoom calls count — confirmed regular side sessions.
    // Safety net: also count any session < 20 min even if wrongly classified.
    const zoomCallsRow = db.prepare(
      `SELECT COUNT(DISTINCT ${sessKey}) as cnt FROM lectures
       LEFT JOIN batches ON lectures.group_name = batches.group_name${line ? ' AND batches.line = lectures.line' : ''}
       WHERE lectures.session_type = 'side'
         AND lectures.status = 'مؤكدة'
         AND (lectures.side_session_category = 'regular'
              OR (lectures.duration IS NOT NULL AND LENGTH(lectures.duration) >= 5
                  AND CAST(SUBSTR(lectures.duration,1,2) AS INTEGER)*60
                      + CAST(SUBSTR(lectures.duration,4,2) AS INTEGER) < 20))
       ${buildDateFilter('lectures.date', from_date, to_date)}
       ${deptBatches}${empFilterLectures}${lineL}`
    ).get();

    // 5. Absent main — Part1: absent_students with name lookup + date inference from lecture_no
    //                   Part2: main lectures with no absences
    // Date inference: if a.date is NULL but lecture_no is set, infer date from Nth main lecture for group
    const absentDateFP1 = from_date && to_date
      ? ` AND resolved_date BETWEEN '${from_date}' AND '${to_date}'`
      : from_date ? ` AND resolved_date >= '${from_date}'`
      : to_date   ? ` AND resolved_date <= '${to_date}'` : '';
    const absentDateL  = buildDateFilter('l.date', from_date, to_date);
    const absentDeptB  = buildDeptFilter('b', department);
    const absentDeptB2 = buildDeptFilter('b2', department);
    // Date-aware coordinator attribution on the event row (a.date / l.date)
    const absentEmpB   = coordFilterAtDate('a.group_name', 'a.line',  `COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)`, employee);
    const absentEmpB2  = coordFilterAtDate('l.group_name', 'l.line', 'l.date', employee);
    // KPI must match the row count returned by /absent-list exactly.
    // Previous version used `LEFT JOIN clients c_lu` to validate phones,
    // which double-counted absent rows when the same phone appeared more than
    // once in the clients table. Switched to `EXISTS` (correlated subquery)
    // to mirror /absent-list and stay row-stable. (Fix mirrors Fix 4 pattern.)
    const absentMainRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM (
         SELECT group_name FROM (
           SELECT a.group_name,
             COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS resolved_date
           FROM absent_students a
           LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
           LEFT JOIN (
             SELECT group_name, date, line,
               ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
             FROM lectures WHERE session_type = 'main' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
           ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
             AND lec_inf.group_name = a.group_name
             AND a.lecture_no IS NOT NULL
             AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
           WHERE (
             (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
             OR (a.phone IS NOT NULL AND TRIM(a.phone)!='')
           )
           ${absentDeptB}${absentEmpB}${lineA}
         ) p1_inner
         WHERE 1=1${absentDateFP1}
         UNION ALL
         SELECT l.group_name FROM lectures l
         INNER JOIN batches b2 ON l.group_name = b2.group_name${line ? ' AND b2.line = l.line' : ''}
         INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
         WHERE l.session_type = 'main'
           AND l.status = 'مؤكدة'
           AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
           AND c.name IS NOT NULL AND TRIM(c.name)!=''
           AND c.phone IS NOT NULL AND TRIM(c.phone)!=''
           AND NOT EXISTS (
             SELECT 1 FROM absent_students a2
             WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
           )
         ${absentDateL}${absentDeptB2}${absentEmpB2}${lineLA}
       )`
    ).get();

    // 6. Absent zoom call — grouped per group+date.
    // Side sessions are per-student 15-min slots, so the expected count
    // for a specific date is COUNT(*) of side rows on that date (NOT
    // batch.trainee_count which covers the whole group across all dates).
    // Must match the formula in /absent-side-list exactly to avoid
    // KPI-vs-modal mismatches.
    // ⚠ Doubling fix — smart canonical line approach:
    // Batches can have the same group_name in BOTH lines (Ahmed Hassan + Dardasha).
    // Lectures may be uploaded under only ONE line (e.g. Ahmed Hassan).
    // Strategy: for each group, resolve the ACTUAL line where lecture data exists
    // via a correlated subquery. Then JOIN with AND l.line = b.line to ensure each
    // lecture row is counted exactly ONCE regardless of which admin line filter is active.
    //
    // • admin "الكل" (no line) : canonical line = actual lecture line → no doubling ✓
    // • admin "Dardasha"       : canonical line = 'Ahmed Hassan' (where lectures are) → finds data ✓
    // ── Absent Zoom KPI — prefer uploaded file, fall back to lectures-based calc ──
    // If the new absent_zoom_students table has data for the line, use it.
    // Otherwise, fall back to the original lectures-based calculation so the KPI
    // never drops to 0 just because the new file hasn't been uploaded yet.
    const hasZoomAbsentData = db.prepare(
      `SELECT EXISTS(SELECT 1 FROM absent_zoom_students${line ? ` WHERE line = '${line.replace(/'/g, "''")}'` : ''}) as has_data`
    ).get()?.has_data;

    let absentSideRow;
    if (hasZoomAbsentData) {
      // NEW: count rows from absent_zoom_students (mirrors absent_main approach).
      // Match rows that have student_name OR a phone that exists in clients (lookup).
      // COUNT(DISTINCT a.id) prevents row multiplication when the same phone or
      // group_name has multiple rows in clients/batches.
      const lineAZ = buildLineFilter('a', line);
      const azDateF = buildDateFilter('a.date', from_date, to_date);
      absentSideRow = db.prepare(
        `SELECT COUNT(DISTINCT a.id) as cnt FROM absent_zoom_students a
         LEFT JOIN batches b ON REPLACE(a.group_name,' ','') = REPLACE(b.group_name,' ','')${line ? ' AND b.line = a.line' : ''}
         LEFT JOIN clients c_lu ON (a.student_name IS NULL OR TRIM(a.student_name)='')
           AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND (c_lu.phone = a.phone OR c_lu.phone = '0' || a.phone OR a.phone = '0' || c_lu.phone)
         WHERE (
           (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
           OR (a.phone IS NOT NULL AND TRIM(a.phone)!='')
         )
         AND EXISTS (
           SELECT 1 FROM lectures l
            WHERE REPLACE(l.group_name,' ','') = REPLACE(a.group_name,' ','')
              AND l.date       = a.date
              AND l.session_type = 'side'
              AND (l.side_session_category = 'regular'
                   OR (l.duration IS NOT NULL AND LENGTH(l.duration) >= 5
                       AND CAST(SUBSTR(l.duration,1,2) AS INTEGER)*60
                           + CAST(SUBSTR(l.duration,4,2) AS INTEGER) < 20))${line ? ' AND l.line = a.line' : ''}
         )
         ${deptB}${empFilterAbsentA}${lineAZ}${azDateF}`
      ).get();
    } else {
      // FALLBACK: original lectures-based calculation
      const absentSideBatchSubQ = line
        ? `(SELECT b.group_name,
             COALESCE(lc.canonical_line, MIN(b.line)) AS line,
             MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
           FROM batches b
           LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
           WHERE b.line = '${line.replace(/'/g, "''")}'
           GROUP BY b.group_name)`
        : `(SELECT b.group_name,
             COALESCE(lc.canonical_line, MIN(b.line)) AS line,
             MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
           FROM batches b
           LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
           GROUP BY b.group_name)`;
      absentSideRow = db.prepare(
        `SELECT COALESCE(SUM(absent_count), 0) as cnt FROM (
           SELECT
             COUNT(*) -
             SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance != '' AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END) AS absent_count
           FROM lectures l
           INNER JOIN ${absentSideBatchSubQ} b ON l.group_name = b.group_name AND l.line = b.line
           WHERE l.session_type = 'side'
             AND l.status = 'مؤكدة'
             AND (l.duration IS NULL OR l.duration <= '00:30') AND l.side_session_category = 'regular'
           ${buildDateFilter('l.date', from_date, to_date)}
           ${deptB}${empFilterAbsentL}
           GROUP BY l.group_name, l.date
           HAVING absent_count > 0
         )`
      ).get();
    }

    // added_at is stored as "DD/MM/YYYY, HH:MM AM/PM" — convert to ISO date for comparison
    const remarkDateExpr = `date(substr(remarks.added_at,7,4)||'-'||substr(remarks.added_at,4,2)||'-'||substr(remarks.added_at,1,2))`;

    // 7. Open remarks — count only for KPI, limited list for dashboard table
    const openRemarksCount = db.prepare(
      `SELECT COUNT(*) as cnt FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved','إنتهت')
       ${buildDateFilter(remarkDateExpr, from_date, to_date)}
       ${empRemark}${deptRemark}${lineRemarks}`
    ).get();

    const openRemarksList = db.prepare(
      `SELECT id, client_name, client_phone, details, category, status, priority, assigned_to, added_at, last_updated
       FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved','إنتهت')
       ${buildDateFilter(remarkDateExpr, from_date, to_date)}
       ${empRemark}${deptRemark}${lineRemarks}
       ORDER BY added_at DESC
       LIMIT 150`
    ).all();

    // 8a. Remarks errors (open >= 3 hours) — limited to 200 rows
    const remarksErrors = db.prepare(
      `SELECT id, client_name, client_phone, status, assigned_to, added_at, last_updated,
         ROUND((julianday('now') - julianday(added_at)) * 24, 1) as hours_open,
         CASE
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) > 72  THEN 'overdue'
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) > 48  THEN 'normal'
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) > 24  THEN 'important'
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) >= 3  THEN 'urgent'
           ELSE 'ok'
         END as urgency_level
       FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved','إنتهت')
         AND ROUND((julianday('now') - julianday(added_at)) * 24, 1) >= 3
         ${deptRemark}${lineRemarks}
       ORDER BY hours_open DESC
       LIMIT 200`
    ).all();

    // 8b. Lectures errors (completed < scheduled)
    const lecturesErrors = db.prepare(
      `SELECT group_name, scheduled_lectures, completed_lectures,
         (scheduled_lectures - completed_lectures) as missing_lectures,
         dept_type, coordinators, start_date, end_date
       FROM batches
       WHERE status='نشطة' AND scheduled_lectures > completed_lectures
       ${deptBatches}${empFilter}${lineBatches}
       ORDER BY missing_lectures DESC`
    ).all();

    // 8c. Side session errors (count < trainee_count * 7)
    const sideSessionErrors = db.prepare(
      `SELECT b.group_name, b.trainee_count, b.dept_type, b.coordinators,
         COUNT(l.id) as side_count,
         (b.trainee_count * 7) as expected_side_count
       FROM batches b
       LEFT JOIN lectures l ON l.group_name = b.group_name AND l.session_type = 'side' AND l.status != 'غير مؤكدة'${line ? ' AND l.line = b.line' : ''}
       WHERE b.status = 'نشطة'
       ${deptB}${empBFilter}${lineB}
       GROUP BY b.group_name
       HAVING side_count < expected_side_count
       ORDER BY (expected_side_count - side_count) DESC`
    ).all();

    return res.json({
      kpis: {
        active_groups:         activeGroupsList.length,
        waiting_trainees:      waitingTraineesList.length,
        waiting_lectures:      waitingLecturesList.length,
        expired_active_groups: expiredGroupsList.length,
        main_lectures:         mainLecturesRow?.cnt ?? 0,
        side_sessions:         sideLecturesRow?.cnt ?? 0,
        zoom_calls:            zoomCallsRow?.cnt ?? 0,
        absent_main:           absentMainRow?.cnt ?? 0,
        absent_zoom:           absentSideRow?.cnt ?? 0,
        // Tells the frontend which shape /absent-side-list will return so
        // it can pick matching modal columns: 'zoom_table' (student-level)
        // or 'lectures_calc' (group-level legacy).
        absent_zoom_source:    hasZoomAbsentData ? 'zoom_table' : 'lectures_calc',
        open_remarks:          openRemarksCount?.cnt ?? 0,
        remarks_notes:         (() => {
          // KPI = sum of the totals returned by /remarks-notes-main and
          // /remarks-notes-zoom. Uses the SAME builders the endpoints use so
          // the KPI always equals the grand total shown in the drill-down modal.
          try {
            const mainQ = buildRemarksNotesMainInnerQ({
              from_date, to_date, department, employee, line,
            });
            const zoomQ = buildRemarksNotesZoomInnerQ({
              from_date, to_date, department, employee, line,
            });
            const mainCnt = db.prepare(`SELECT COUNT(*) as cnt FROM (${mainQ}) t`).get()?.cnt ?? 0;
            const zoomCnt = db.prepare(`SELECT COUNT(*) as cnt FROM (${zoomQ}) t`).get()?.cnt ?? 0;
            return mainCnt + zoomCnt;
          } catch (e) {
            console.error('[reports] remarks_notes KPI error:', e);
            return 0;
          }
        })(),
      },
      active_groups_list:     activeGroupsList,
      waiting_trainees_list:  waitingTraineesList,
      waiting_lectures_list:  waitingLecturesList,
      expired_groups_list:    expiredGroupsList,
      open_remarks_list:    openRemarksList,
      groups_with_errors: {
        remarks_errors:      remarksErrors,
        lectures_errors:     lecturesErrors,
        side_session_errors: sideSessionErrors,
      },
    });
  } catch (err) {
    console.error('[reports] dashboard error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/lectures-list ──────────────────────────────────────────
router.get('/lectures-list', (req, res) => {
  const {
    from_date, to_date, department, employee,
    session_type = 'main', page = 1, limit = 100,
    search = '', trainer = '', coordinator = '',
    modal_from = '', modal_to = '',
    min_duration = '', max_duration = '',  // optional duration range filters
    group_name = '', category = '',        // for ob_count popup: exact group + category
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);
  const lineL = buildLineFilter('l', line);
  const deptFilter        = buildDeptFilter('b', department);
  // Date-aware: attribute lectures to coordinator who was responsible ON l.date
  // (not current batches.coordinators which is NULL for ended groups)
  const empFilter         = coordFilterAtDate('l.group_name', 'l.line', 'l.date', employee);
  const searchEsc         = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
  const searchFilter      = search      ? ` AND l.group_name LIKE '%${searchEsc}%' ESCAPE '\\'` : '';
  const trainerFilter     = trainer     ? ` AND l.trainer LIKE '%${trainer}%'` : '';
  const coordFilter       = coordFilterAtDate('l.group_name', 'l.line', 'l.date', coordinator);
  const groupFilter       = group_name  ? ` AND l.group_name = '${group_name.replace(/'/g, "''")}'` : '';
  const categoryFilter    = category    ? ` AND l.side_session_category = '${category}'` : '';
  // Duration filters (HH:MM string comparison works correctly for same-format values)
  const minDurFilter      = min_duration ? ` AND l.duration >= '${min_duration}'` : '';
  const maxDurFilter      = max_duration ? ` AND l.duration <= '${max_duration}'` : '';
  // Modal date overrides outer date if provided
  const activFrom  = modal_from || from_date;
  const activTo    = modal_to   || to_date;
  const dateFilter = activFrom && activTo ? ` AND l.date BETWEEN '${activFrom}' AND '${activTo}'`
                   : activFrom ? ` AND l.date >= '${activFrom}'`
                   : activTo   ? ` AND l.date <= '${activTo}'` : '';

  // When min_duration is set (main lectures mode), ignore session_type filter — use duration to identify them
  const sessionTypeFilter = min_duration ? '' : ` AND l.session_type = '${session_type}'`;
  // Only confirmed lectures count in any CS report
  const statusFilter = ` AND l.status != 'غير مؤكدة'`;

  const allFilters = `${sessionTypeFilter}${statusFilter}${minDurFilter}${maxDurFilter}${dateFilter}${deptFilter}${empFilter}${trainerFilter}${coordFilter}${searchFilter}${groupFilter}${categoryFilter}${lineL}`;

  // For side sessions: pre-aggregate onboarding/offboarding/compensatory per group (one JOIN instead of N subqueries)
  // Only confirmed sessions are counted toward category totals
  const sideJoin = (!min_duration && session_type === 'side')
    ? `LEFT JOIN (
         SELECT group_name, line,
           SUM(CASE WHEN side_session_category='onboarding'    THEN 1 ELSE 0 END) AS onboarding_count,
           SUM(CASE WHEN side_session_category='offboarding'   THEN 1 ELSE 0 END) AS offboarding_count,
           SUM(CASE WHEN side_session_category='compensatory'  THEN 1 ELSE 0 END) AS compensatory_count
         FROM lectures WHERE session_type='side' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
         GROUP BY group_name, line
       ) lx_counts ON lx_counts.group_name = l.group_name${line ? ' AND lx_counts.line = l.line' : ''}`
    : '';
  const sideExtraFields = (!min_duration && session_type === 'side')
    ? `, COALESCE(lx_counts.onboarding_count,0) AS onboarding_count, COALESCE(lx_counts.offboarding_count,0) AS offboarding_count, COALESCE(lx_counts.compensatory_count,0) AS compensatory_count`
    : '';

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM lectures l
       LEFT JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
       WHERE 1=1${allFilters}`
    ).get();

    const rows = db.prepare(
      `SELECT l.*,
         COALESCE((SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b.coordinators)) LIMIT 1), b.dept_type) AS dept_type,
         b.coordinators, b.lecture_duration_min${sideExtraFields}
       FROM lectures l
       LEFT JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
       ${sideJoin}
       WHERE 1=1${allFilters}
       ORDER BY l.date DESC LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/absent-list ─────────────────────────────────────────────
router.get('/absent-list', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    coordinator = '', modal_from = '', modal_to = '', modal_dept = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);
  const lineA = buildLineFilter('a', line);
  const lineL = buildLineFilter('l', line);

  // Modal filters override outer filters when provided
  const activeDept  = modal_dept  && modal_dept  !== 'All' ? modal_dept  : (department && department !== 'All' ? department : '');
  const activeFrom  = modal_from  || from_date;
  const activeTo    = modal_to    || to_date;

  // Time-aware dept filter — attribute each absence to the coordinator's
  // section-at-event-date (via coordinator_history + team_member_dept_history),
  // not the current batches.dept_type. Mirrors /attendance-absence so modal
  // counts match the main table.
  // Part1 absence date = COALESCE(a.date, inferred-from-lecture_no). The dept
  // filter is applied INSIDE the inner SELECT where lec_inf is in scope.
  const deptFilter   = coordDeptAtDateFilter('b',  `COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)`, activeDept);
  // Date-aware: attribute each absence to whoever was coordinator at a.date
  const empFilter    = coordFilterAtDate('a.group_name', 'a.line', 'a.date', employee);
  const coordFilter  = coordFilterAtDate('a.group_name', 'a.line', 'a.date', coordinator);
  const searchFilter = search     ? ` AND a.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\'` : '';
  // Part1 date filter uses computed 'date' column (after inference), not raw a.date
  const dateFilterP1 = activeFrom && activeTo ? ` AND date BETWEEN '${activeFrom}' AND '${activeTo}'`
                     : activeFrom ? ` AND date >= '${activeFrom}'`
                     : activeTo   ? ` AND date <= '${activeTo}'` : '';

  // Part2 filters use l/b2 aliases
  const dateFilter2  = activeFrom && activeTo ? ` AND l.date BETWEEN '${activeFrom}' AND '${activeTo}'`
                     : activeFrom ? ` AND l.date >= '${activeFrom}'`
                     : activeTo   ? ` AND l.date <= '${activeTo}'` : '';
  const deptFilter2  = coordDeptAtDateFilter('b2', 'l.date', activeDept);
  const empFilter2   = coordFilterAtDate('l.group_name', 'l.line', 'l.date', employee);
  const coordFilter2 = coordFilterAtDate('l.group_name', 'l.line', 'l.date', coordinator);
  const searchFilter2= search      ? ` AND l.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\'` : '';
  // Opt-in employment-window filter (attendance-absence drill-down only).
  const rosterWin    = req.query.roster_window === '1' || req.query.roster_window === 'true';
  const ewFilterP1   = rosterWin ? employmentWindowFilter('a.group_name', 'a.line', `COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)`) : '';
  const ewFilterP2   = rosterWin ? employmentWindowFilter('l.group_name', 'l.line', 'l.date') : '';

  // Part1: absent_students — with name lookup + date inference from lecture_no when date is missing
  const part1 = `
    SELECT student_name, phone, group_name, date, time, lecture_no, dept_type, coordinators
    FROM (
      SELECT
        COALESCE(
          CASE WHEN a.phone IS NOT NULL AND TRIM(a.phone)!='' THEN
            (SELECT c.name FROM clients c
             WHERE c.phone = a.phone OR c.phone = '0' || a.phone OR a.phone = '0' || c.phone
             LIMIT 1)
          END,
          NULLIF(TRIM(a.student_name),'')
        ) AS student_name,
        a.phone, a.group_name,
        COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS date,
        a.time, a.lecture_no,
        COALESCE(
          ${userDeptExpr('b.coordinators')},
          b.dept_type,
          -- ENDED groups leave the batches table (b.* NULL -> section shows
          -- dash); recover the section from coordinator_history's coordinator.
          ${userDeptExpr(coordAtDateSingleExpr('a.group_name', 'a.line', `COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)`))}
        ) AS dept_type,
        COALESCE(
          ${coordinatorAtDateExpr('a.group_name', 'a.line', `COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)`)},
          NULLIF(TRIM(b.coordinators),'--')
        ) AS coordinators
      FROM absent_students a
      LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
      LEFT JOIN (
        SELECT group_name, date, line,
          ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
        FROM lectures WHERE session_type = 'main' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
      ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
        AND lec_inf.group_name = a.group_name
        AND a.lecture_no IS NOT NULL
        AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
      WHERE (
        (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
        OR (a.phone IS NOT NULL AND TRIM(a.phone)!='')
      )
      ${deptFilter}${empFilter}${coordFilter}${searchFilter}${ewFilterP1}${notInternalGroup('a.group_name')}${lineA}
    ) p1_inner
    WHERE 1=1${dateFilterP1}`;

  // Part2: main lectures with NO absence records → all students in group treated as absent
  const part2 = `
    SELECT
      c.name AS student_name,
      c.phone, l.group_name, l.date, l.time, NULL AS lecture_no,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b2.coordinators)) AND u.department != 'All' LIMIT 1),
        b2.dept_type
      ) AS dept_type,
      COALESCE(
        ${coordinatorAtDateExpr('l.group_name', 'l.line', 'l.date')},
        NULLIF(TRIM(b2.coordinators),'--')
      ) AS coordinators
    FROM lectures l
    INNER JOIN batches b2 ON l.group_name = b2.group_name${line ? ' AND b2.line = l.line' : ''}
    INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
    WHERE l.session_type = 'main'
      AND l.status = 'مؤكدة'
      AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
      AND c.name IS NOT NULL AND TRIM(c.name)!=''
      AND c.phone IS NOT NULL AND TRIM(c.phone)!=''
      AND NOT EXISTS (
        SELECT 1 FROM absent_students a2
        WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
      )
    ${dateFilter2}${deptFilter2}${empFilter2}${coordFilter2}${searchFilter2}${ewFilterP2}${notInternalGroup('l.group_name')}${lineL}`;

  const unionQ = `SELECT * FROM (${part1} UNION ALL ${part2}) t`;

  try {
    const totalRow = db.prepare(`SELECT COUNT(*) as cnt FROM (${part1} UNION ALL ${part2}) t`).get();
    const rows     = db.prepare(`${unionQ} ORDER BY date DESC LIMIT ${Number(limit)} OFFSET ${offset}`).all();
    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[absent-list]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/absent-side-list ────────────────────────────────────────
// Grouped per group_name + date
// present_count  = sessions where attendance > 0
// absent_count   = trainee_count - present_count
// Only valid side sessions: category='regular' AND duration <= '00:30' (excludes Onboarding/Offboarding)
router.get('/absent-side-list', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    trainer = '', coordinator = '', modal_from = '', modal_to = '', modal_dept = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);
  const lineL = buildLineFilter('l', line);
  const lineA = buildLineFilter('a', line);

  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');
  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;

  // Time-aware dept filter — attribute each lecture/absence to the coordinator's
  // department-at-that-date (not current b.dept_type). Mirrors /attendance-absence
  // so modal counts match the main table.
  const deptFilter    = coordDeptAtDateFilter('b', 'l.date', activeDept);
  // Date-aware: attribute each lecture to the coordinator on l.date, not current b.coordinators.
  const empFilter     = coordFilterAtDate('l.group_name', 'l.line', 'l.date', employee);
  const trainerFilter = trainer     ? ` AND l.trainer LIKE '%${escapeLike(trainer)}%' ESCAPE '\\'` : '';
  const coordFilter   = coordFilterAtDate('l.group_name', 'l.line', 'l.date', coordinator);
  const searchFilter  = search      ? ` AND l.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\'` : '';
  const dateFilter    = activeFrom && activeTo
    ? ` AND l.date BETWEEN '${activeFrom}' AND '${activeTo}'`
    : activeFrom ? ` AND l.date >= '${activeFrom}'`
    : activeTo   ? ` AND l.date <= '${activeTo}'` : '';
  // Opt-in employment-window filter (attendance-absence drill-down only).
  const rosterWinS    = req.query.roster_window === '1' || req.query.roster_window === 'true';
  const ewFilterSideB = rosterWinS ? employmentWindowFilter('l.group_name', 'l.line', 'l.date') : '';

  // ── Prefer absent_zoom_students when uploaded (student-level rows) ────────
  // When a group-name search is active, check specifically for that group's data
  // so groups with no absent_zoom_students rows fall through to the lectures-based Path B,
  // matching the same calculation the dashboard (attendance-absence) uses.
  const azExistWhere = search
    ? `WHERE 1=1${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''} AND group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\'`
    : (line ? `WHERE line = '${line.replace(/'/g, "''")}'` : '');
  const hasZoomAbsentData = db.prepare(
    `SELECT EXISTS(SELECT 1 FROM absent_zoom_students ${azExistWhere}) as has_data`
  ).get()?.has_data;

  if (hasZoomAbsentData) {
    // Student-level shape — same columns as /absent-list so the modal can render uniformly
    const azDateFilter = activeFrom && activeTo
      ? ` AND a.date BETWEEN '${activeFrom}' AND '${activeTo}'`
      : activeFrom ? ` AND a.date >= '${activeFrom}'`
      : activeTo   ? ` AND a.date <= '${activeTo}'` : '';
    const azSearchFilter = search ? ` AND (a.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR a.student_name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR a.phone LIKE '%${escapeLike(search)}%' ESCAPE '\\')` : '';
    // Date-aware coordinator/employee filter: attribute each absence to whoever
    // was the coordinator on `a.date` (not the CURRENT batches.coordinators).
    const azCoordFilter  = coordFilterAtDate('a.group_name', 'a.line', 'a.date', coordinator);
    const azEmpFilter    = coordFilterAtDate('a.group_name', 'a.line', 'a.date', employee);
    // Time-aware dept filter — coordinator's dept on a.date (via history),
    // not the current batches.dept_type. Mirrors /attendance-absence.
    const azDeptFilter   = coordDeptAtDateFilter('b', 'a.date', activeDept);
    const azEwFilter     = rosterWinS ? employmentWindowFilter('a.group_name', 'a.line', 'a.date') : '';

    // Restrict zoom-absent rows to absences against REGULAR (≤15-min) zoom
    // sessions only. Onboarding/Offboarding/Compensatory rows live in the
    // same table when uploaded from Excel, but business rule says only the
    // 15-min slot counts as a zoom call.
    const azBaseFrom = `
      FROM absent_zoom_students a
      LEFT JOIN batches b ON REPLACE(a.group_name,' ','') = REPLACE(b.group_name,' ','')${line ? ' AND b.line = a.line' : ''}
      LEFT JOIN clients c_lu ON (a.student_name IS NULL OR TRIM(a.student_name)='')
        AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND (c_lu.phone = a.phone OR c_lu.phone = '0' || a.phone OR a.phone = '0' || c_lu.phone)
      WHERE (
        (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
        OR (a.phone IS NOT NULL AND TRIM(a.phone)!='')
      )
      AND EXISTS (
        SELECT 1 FROM lectures l
         WHERE REPLACE(l.group_name,' ','') IN (
                 REPLACE(a.group_name,' ',''),
                 REPLACE(${currentGroupNameExpr('a.group_name', 'a.line')},' ','')
               )
           AND l.date       = a.date
           AND l.session_type = 'side'
           AND (l.side_session_category = 'regular'
                OR (l.duration IS NOT NULL AND LENGTH(l.duration) >= 5
                    AND CAST(SUBSTR(l.duration,1,2) AS INTEGER)*60
                        + CAST(SUBSTR(l.duration,4,2) AS INTEGER) < 20))${line ? ' AND l.line = a.line' : ''}
      )
      ${azDateFilter}${azDeptFilter}${azEmpFilter}${azCoordFilter}${azSearchFilter}${azEwFilter}${notInternalGroup('a.group_name')}${lineA}`;

    try {
      // COUNT(DISTINCT a.id) + GROUP BY a.id prevent row duplication when
      // the same phone matches multiple clients or the same group has
      // multiple batch rows (LEFT JOIN multiplies otherwise).
      const totalRow = db.prepare(`SELECT COUNT(DISTINCT a.id) as cnt ${azBaseFrom}`).get();
      const rows = db.prepare(
        `SELECT a.id,
           COALESCE(MAX(c_lu.name), NULLIF(TRIM(a.student_name),'')) AS student_name,
           a.phone,
           a.group_name,
           a.date,
           a.time,
           a.lecture_no,
           COALESCE(
             MAX(b.dept_type),
             -- ENDED/renamed groups: b.* is NULL → section "—". Recover it from
             -- the coordinator-of-record (coordinator_history) registered dept
             -- (normalized name match handles 'RadwaGamal' vs 'Radwa Gamal').
             ${userDeptExpr(coordAtDateSingleExpr('a.group_name', 'a.line', 'a.date'))}
           ) AS dept_type,
           COALESCE(
             ${coordinatorAtDateExpr('a.group_name', 'a.line', 'a.date')},
             NULLIF(TRIM(MAX(b.coordinators)),'--')
           ) AS coordinators
         ${azBaseFrom}
         GROUP BY a.id
         ORDER BY a.date DESC, a.group_name
         LIMIT ${Number(limit)} OFFSET ${offset}`
      ).all();

      return res.json({
        total: totalRow.cnt, page: Number(page), limit: Number(limit), rows,
        data_source: 'zoom_table',
      });
    } catch (err) {
      console.error('[reports] absent-side-list (zoom_table) error:', err);
      return res.status(500).json({ error: err.message });
    }
  }
  // ── Fallback: legacy lectures-based group-level calculation ─────────────────

  // Note: line scoping is handled by batchSubQ (groups belonging to the selected line),
  // NOT by filtering l.line directly. This allows Dardasha-line groups to find their
  // lectures even if those lectures are stored under a different line value.
  const baseWhere = `
    WHERE l.session_type = 'side'
      AND l.status = 'مؤكدة'
      AND (l.duration IS NULL OR l.duration <= '00:30') AND l.side_session_category = 'regular'
    ${dateFilter}${deptFilter}${empFilter}${trainerFilter}${coordFilter}${searchFilter}${ewFilterSideB}`;

  // NOTE: Side sessions are per-student 15-min slots — each row in `lectures`
  // represents one student's scheduled session on that date, NOT the whole group.
  // So the "expected" count for a specific date is COUNT(*) of side rows on that
  // date, NOT batch.trainee_count (which covers the entire group).
  // Example: group with 2 trainees → one slot on Apr 19, another on Apr 20 →
  //   COUNT(*) per date = 1, not 2.
  //
  // ⚠ Doubling fix — smart canonical line approach:
  // Batches can have the same group_name in BOTH lines. Lectures may only exist for
  // one line. Resolve the ACTUAL lecture line per group so AND l.line = b.line
  // counts each lecture row exactly once.
  // • admin "الكل" (no line) : canonical = actual lecture line → no doubling ✓
  // • admin "Dardasha"       : canonical = 'Ahmed Hassan' (lectures stored there) → finds data ✓
  const batchSubQ = line
    ? `(SELECT b.group_name,
         COALESCE(lc.canonical_line, MIN(b.line)) AS line,
         MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
       FROM batches b
       LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
       WHERE b.line = '${line.replace(/'/g, "''")}'
       GROUP BY b.group_name)`
    : `(SELECT b.group_name,
         COALESCE(lc.canonical_line, MIN(b.line)) AS line,
         MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
       FROM batches b
       LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
       GROUP BY b.group_name)`;

  const groupedQuery = `
    SELECT
      l.group_name,
      l.date                                                                    AS session_date,
      MAX(l.trainer)                                                            AS trainer,
      COALESCE(${coordinatorAtDateExpr('l.group_name', 'l.line', 'l.date')},
               MAX(b.coordinators))                                             AS coordinators,
      COALESCE(MAX((SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b.coordinators)) AND u.department != 'All' LIMIT 1)), MAX(b.dept_type)) AS dept_type,
      COUNT(*)                                                                  AS trainee_count,
      SUM(CASE WHEN l.attendance IS NOT NULL
               AND l.attendance != ''
               AND CAST(l.attendance AS INTEGER) > 0
               THEN 1 ELSE 0 END)                                               AS present_count,
      COUNT(*) -
      SUM(CASE WHEN l.attendance IS NOT NULL
               AND l.attendance != ''
               AND CAST(l.attendance AS INTEGER) > 0
               THEN 1 ELSE 0 END)                                               AS absent_count
    FROM lectures l
    INNER JOIN ${batchSubQ} b ON l.group_name = b.group_name AND l.line = b.line
    ${baseWhere}
    GROUP BY l.group_name, l.date
    HAVING absent_count > 0`;

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM (${groupedQuery})`
    ).get();

    const rows = db.prepare(
      `${groupedQuery}
       ORDER BY session_date DESC
       LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({
      total: totalRow.cnt, page: Number(page), limit: Number(limit), rows,
      data_source: 'lectures_calc',
    });
  } catch (err) {
    console.error('[reports] absent-side-list error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-list ───────────────────────────────────────────
router.get('/remarks-list', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    assigned_to = '', priority = '',
    modal_from = '', modal_to = '', modal_dept = '',
    category_search = '', status_filter = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);
  const lineR = buildLineFilter('r', line);
  const lineRemarks = buildLineFilter('remarks', line);

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept
                   : department && department !== 'All' ? department : '';

  const remarkDate     = `date(substr(added_at,7,4)||'-'||substr(added_at,4,2)||'-'||substr(added_at,1,2))`;
  const dateFilter     = activeFrom && activeTo ? ` AND ${remarkDate} BETWEEN '${activeFrom}' AND '${activeTo}'`
                       : activeFrom ? ` AND ${remarkDate} >= '${activeFrom}'`
                       : activeTo   ? ` AND ${remarkDate} <= '${activeTo}'` : '';
  const empFilter      = employee        ? ` AND ${nameInListInline('assigned_to', employee)}` : '';
  const assignFilter   = assigned_to     ? ` AND ${nameInListInline('assigned_to', assigned_to)}` : '';
  const priorityFilter = priority        ? ` AND priority = '${priority}'` : '';
  const categoryFilter = category_search ? ` AND category LIKE '%${escapeLike(category_search)}%' ESCAPE '\\'` : '';
  const statusFilter   = status_filter   ? ` AND status = '${status_filter}'` : '';
  const searchFilter   = search          ? ` AND (client_name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR details LIKE '%${escapeLike(search)}%' ESCAPE '\\')` : '';
  // Coordinator-first dept filter (Fix 16) with team_members fallback (Fix 9).
  // Uses alias 'remarks' — baseWhereR swap below converts to 'r' for the joined query.
  const deptFilter     = buildDeptRemarkFilter('remarks', activeDept);

  // added_at is stored as "DD/MM/YYYY, HH:MM AM/PM"
  // Convert to YYYY-MM-DD for date comparison with batches.start_date / end_date
  const dateConvert = `(substr(r.added_at,7,4) || '-' || substr(r.added_at,4,2) || '-' || substr(r.added_at,1,2))`;

  // Production done-status is 'إنتهت' (Arabic) — treat it as closed. Only apply
  // the default "hide closed/done" filter when the user hasn't explicitly asked
  // for a status (otherwise filtering BY 'إنتهت' would contradict it → 0 rows).
  const openDefault = status_filter ? '' : ` AND LOWER(remarks.status) NOT IN ('closed','مغلق','resolved','إنتهت')`;
  const baseWhere = `WHERE 1=1${openDefault}
    ${dateFilter}${empFilter}${assignFilter}${priorityFilter}${categoryFilter}${statusFilter}${deptFilter}${searchFilter}${lineRemarks}`;

  // Use CTE to pre-compute active batches per phone — avoids N+1 correlated subquery
  const withCte = `
    WITH active_batches AS (
      SELECT c.phone, b.group_name, b.start_date, b.end_date
      FROM clients c
      INNER JOIN batches b ON c.group_name = b.group_name${line ? ' AND b.line = c.line' : ''}
      WHERE b.status = 'نشطة'
        AND b.start_date IS NOT NULL AND b.start_date != ''
        AND b.end_date   IS NOT NULL AND b.end_date   != ''${line ? ` AND c.line = '${line.replace(/'/g, "''")}'` : ''}
    )`;

  const baseWhereR = baseWhere.replace(/\bremarks\b/g, 'r');

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM remarks r ${baseWhereR}`
    ).get();

    const rows = db.prepare(
      `${withCte}
       SELECT r.*,
         ROUND((julianday('now') - julianday(r.added_at)) * 24, 1) AS hours_open,
         CASE
           WHEN ROUND((julianday('now') - julianday(r.added_at)) * 24, 1) > 72  THEN 'overdue'
           WHEN ROUND((julianday('now') - julianday(r.added_at)) * 24, 1) > 48  THEN 'normal'
           WHEN ROUND((julianday('now') - julianday(r.added_at)) * 24, 1) > 24  THEN 'important'
           WHEN ROUND((julianday('now') - julianday(r.added_at)) * 24, 1) >= 3  THEN 'urgent'
           ELSE 'ok'
         END AS urgency_level,
         (SELECT ab.group_name FROM active_batches ab
          WHERE ab.phone = r.client_phone
            AND ab.start_date <= ${dateConvert}
            AND ab.end_date   >= ${dateConvert}
          LIMIT 1) AS active_group
       FROM remarks r
       ${baseWhereR}
       ORDER BY r.added_at DESC
       LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[reports] remarks-list error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-notes-main ─────────────────────────────────────
router.get('/remarks-notes-main', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    modal_from = '', modal_to = '', modal_dept = '',
    coordinator = '', has_remark = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');

  const innerQ = buildRemarksNotesMainInnerQ({
    from_date: activeFrom, to_date: activeTo, department: activeDept,
    employee, coordinator, search, line,
  });

  const havingFilter = has_remark === '1' ? ` AND has_remark = 1`
                     : has_remark === '0' ? ` AND has_remark = 0` : '';

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM (${innerQ}) t WHERE 1=1 ${havingFilter}`
    ).get();

    const rows = db.prepare(
      `SELECT * FROM (${innerQ}) t WHERE 1=1 ${havingFilter}
       ORDER BY absence_date DESC
       LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[reports] remarks-notes-main error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-notes-zoom ──────────────────────────────────────
// Two-source UNION approach:
//   Part 1: clients in FULLY-absent sessions (all attendance=0) → all clients in group are absent
//   Part 2: clients confirmed absent via 'Attendance Zoom Call' remarks
//           (covers partial-attendance groups + groups missing from clients table)
router.get('/remarks-notes-zoom', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    modal_from = '', modal_to = '', modal_dept = '',
    coordinator = '', has_remark = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');

  const innerQ = buildRemarksNotesZoomInnerQ({
    from_date: activeFrom, to_date: activeTo, department: activeDept,
    employee, coordinator, search, line,
  });

  const havingFilter = has_remark === '1' ? ` AND has_remark = 1`
                     : has_remark === '0' ? ` AND has_remark = 0` : '';

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM (${innerQ}) t WHERE 1=1 ${havingFilter}`
    ).get();

    const rows = db.prepare(
      `SELECT * FROM (${innerQ}) t WHERE 1=1 ${havingFilter}
       ORDER BY session_date DESC
       LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[reports] remarks-notes-zoom error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-categories ──────────────────────────────────────
router.get('/remarks-categories', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    modal_from = '', modal_to = '', modal_dept = '',
    assigned_to = '', category_filter = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);
  const lineR = buildLineFilter('r', line);

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');

  const remarkDateSQL  = `date(substr(r.added_at,7,4)||'-'||substr(r.added_at,4,2)||'-'||substr(r.added_at,1,2))`;
  const safeDeptCat    = activeDept ? activeDept.replace(/'/g, "''") : '';
  const deptFilter     = activeDept
    ? ` AND EXISTS (SELECT 1 FROM clients cx INNER JOIN batches bx ON cx.group_name=bx.group_name WHERE cx.phone=r.client_phone AND (bx.dept_type='${safeDeptCat}' OR EXISTS (SELECT 1 FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(bx.coordinators)) AND u.department='${safeDeptCat}')))`
    : '';
  const empFilter      = employee       ? ` AND ${nameInListInline('r.assigned_to', employee)}` : '';
  const assignFilter   = assigned_to    ? ` AND ${nameInListInline('r.assigned_to', assigned_to)}` : '';
  const catFilter      = category_filter ? ` AND r.category LIKE '%${escapeLike(category_filter)}%' ESCAPE '\\'` : '';
  const searchFilter   = search         ? ` AND (r.client_name LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR r.category LIKE '%${escapeLike(search)}%' ESCAPE '\\' OR r.client_phone LIKE '%${escapeLike(search)}%' ESCAPE '\\')` : '';
  const dateFilter     = buildDateFilter(remarkDateSQL, activeFrom, activeTo);

  const baseWhere = `WHERE r.category IS NOT NULL AND TRIM(r.category) != ''
    ${dateFilter}${deptFilter}${empFilter}${assignFilter}${catFilter}${searchFilter}${lineR}`;

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM remarks r ${baseWhere}`
    ).get();

    const rows = db.prepare(
      `WITH cat_counts AS (
         SELECT category, COUNT(*) as cnt FROM remarks
         WHERE category IS NOT NULL AND TRIM(category) != ''${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
         GROUP BY category
       ),
       client_groups AS (
         SELECT c.phone, b.group_name, b.coordinators
         FROM clients c INNER JOIN batches b ON c.group_name = b.group_name${line ? ' AND b.line = c.line' : ''}${line ? ` WHERE c.line = '${line.replace(/'/g, "''")}'` : ''}
         GROUP BY c.phone
       )
       SELECT r.id, r.category,
         cc.cnt AS category_count,
         ${remarkDateSQL} AS remark_date_val,
         r.added_at AS remark_date_raw,
         r.client_name, r.client_phone, r.assigned_to,
         cg.group_name, cg.coordinators
       FROM remarks r
       LEFT JOIN cat_counts cc ON cc.category = r.category
       LEFT JOIN client_groups cg ON cg.phone = r.client_phone
       ${baseWhere}
       ORDER BY r.category, r.added_at DESC
       LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[reports] remarks-categories error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── HELPER: compute code problems (extracted) ──────────────────────────────
// Single source of truth used by /code-problems, /team-summary (groups_with_errors
// column), and /team-summary-detail. All three agree on the same numbers.
//
// opts: { department, employee, line, user, showResolved }
// Returns: { mainProblems, zoomProblems }
function computeCodeProblems({ department, employee, line, user, showResolved = false }) {
  const lineB = buildLineFilter('b', line);
  const lineL = buildLineFilter('l', line);
  const lineCps = buildLineFilter('', line);

  // Dept filter:
  // - agent:  NO dept filter — coordinator name LIKE filter already restricts to their own groups.
  //           Applying dept_type filter causes false negatives when a group's stored dept_type
  //           doesn't match the coordinator's registered department (e.g., Ali Moaatz is General
  //           but his group is stored as Semi → group gets incorrectly excluded).
  // - leader: strict dept_type-only filter (no OR EXISTS) to prevent cross-dept leakage
  // - admin:  full buildDeptFilter (includes coordinator-based fallback)
  let deptFilter;
  if (user.role === 'agent' || user.role === 'enrollment') {
    deptFilter = '';
  } else if (user.role === 'leader' || user.role === 'enrollment_leader') {
    // Multi-dept leader support: a leader's primary department + any
    // extra_departments combine into the FULL set of depts they oversee.
    // Include group if (for ANY of the leader's depts):
    //   (1) coordinator registered in that dept, OR
    //   (2) coordinator exists but NOT registered AND batch.dept_type matches, OR
    //   (3) coordinator is NULL/empty/-- AND batch.dept_type matches
    // Path 3 ensures "مجموعة بدون منسق" problems still surface to the
    // leader of the group's dept_type even though there's no coordinator
    // to anchor the dept assignment.
    const allDepts = leaderDeptList(db, user);  // ['General', 'Private'] etc.
    // If a specific `?department=` was requested AND it falls inside the
    // leader's scope, narrow to that one. Otherwise show ALL of them.
    let scopedDepts = allDepts;
    if (department && department !== 'All') {
      const reqDept = String(department).trim().toLowerCase();
      const match = allDepts.find(d => d.toLowerCase() === reqDept);
      if (match) scopedDepts = [match];
    }
    if (scopedDepts.length > 0) {
      const sqlList = scopedDepts.map(d => `'${d.replace(/'/g, "''")}'`).join(', ');
      deptFilter = ` AND (
          EXISTS (
            SELECT 1 FROM users u
            WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
              AND u.department IN (${sqlList})
          )
          OR (
            b.dept_type IN (${sqlList})
            AND b.coordinators IS NOT NULL AND TRIM(b.coordinators) NOT IN ('', '--')
            AND NOT EXISTS (
              SELECT 1 FROM users u
              WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
                AND u.department IS NOT NULL AND u.department != 'All'
            )
          )
          OR (
            b.dept_type IN (${sqlList})
            AND (b.coordinators IS NULL OR TRIM(b.coordinators) IN ('', '--'))
          )
        )`;
    } else {
      deptFilter = '';
    }
  } else {
    deptFilter = buildDeptFilter('b', department);
  }

  // If agent: force filter to their own groups using EXACT TOKEN MATCH.
  // The previous LIKE '%name%' pattern caused cross-agent leakage when one
  // agent's name was a substring of another's: e.g. "Alaa" matched
  // "Alaa wael" because "alaa" appeared inside "alaa wael". The
  // nameInListInline helper wraps the field in commas and matches a
  // bare ",name," — so multi-word names never alias each other.
  let empFilter;
  if (user.role === 'agent' || user.role === 'enrollment') {
    const userRow = db.prepare('SELECT full_name FROM users WHERE id = ?').get(user.id);
    const fullName = (userRow?.full_name || '').trim();
    if (fullName) {
      empFilter = ` AND ${nameInListInline('b.coordinators', fullName)}`;
    } else {
      empFilter = ' AND 1=0';
    }
  } else {
    empFilter = buildCoordFilter('b', employee);
  }

  // ── helpers ──
  const MONTHS  = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  const DAY_NUM = { Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6 };
  const DAY_AR  = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
  const DAY_EN  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Sat(6)+Tue(2) / Sun(0)+Wed(3) / Mon(1)+Thu(4)
  const getMainPair = d => {
    if (d===6||d===2) return [6,2];
    if (d===0||d===3) return [0,3];
    if (d===1||d===4) return [1,4];
    return null;
  };
  const getSidePair = d => {
    if (d===6||d===2) return [1,4]; // Sat+Tue main → Mon+Thu side
    if (d===0||d===3) return [6,2]; // Sun+Wed main → Sat+Tue side
    if (d===1||d===4) return [0,3]; // Mon+Thu main → Sun+Wed side
    return null;
  };
  const getDow = s => { if (!s) return -1; return new Date(s+'T12:00:00').getDay(); };
  const pad    = n => String(n).padStart(2,'0');

  const parseGroupName = name => {
    const m = name.match(/^([A-Za-z]{3})_(\d{1,2})_([A-Za-z]{2,4})_/);
    if (!m) return null;
    const monthNum = MONTHS[m[1]];
    const dayStr   = m[3];
    const dow      = DAY_NUM[dayStr];
    if (!monthNum || dow === undefined) return null;
    return { monthNum, dayNum: parseInt(m[2]), dayStr, dow };
  };

  const batches = db.prepare(
    `SELECT b.group_name, b.trainee_count, b.course,
            COALESCE(
              (SELECT u.department FROM users u
               WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
                 AND u.department IS NOT NULL
                 AND u.department != 'All'
               LIMIT 1),
              b.dept_type
            ) AS dept_type,
            b.coordinators, b.start_date, b.line
     FROM batches b WHERE status='نشطة'${deptFilter}${empFilter}${lineB}`
  ).all();

  // ── Approved client-count baselines (group "receiving") ───────────────────
  // Keyed by `group_name|line`. A group is checked ONLY if it has an approval
  // record — unapproved groups are intentionally never flagged.
  const approvalMap = {};
  try {
    const approvals = db.prepare(
      `SELECT group_name, line, approved_count FROM group_count_approvals`
    ).all();
    for (const a of approvals) {
      approvalMap[`${a.group_name}|${a.line}`] = a.approved_count;
    }
  } catch (_) { /* table may not exist yet on a very old DB — skip the check */ }

    // fetch ALL main sessions (including unconfirmed) for count/date validation
    // Unconfirmed lectures are real lectures — excluding them causes false "missing lectures" errors
    // l.trainer is needed for the "trainer level mismatch" problem type.
    const mainRaw = db.prepare(
      `SELECT l.group_name, l.date, l.time, l.duration, l.trainer FROM lectures l
       INNER JOIN batches b ON l.group_name=b.group_name${line ? ' AND b.line = l.line' : ''}
       WHERE b.status='نشطة' AND l.session_type='main'
       ${deptFilter}${empFilter}${lineL} ORDER BY l.group_name, l.date ASC`
    ).all();

    // ── Trainer capability lookup (Educational Administration only) ────────
    // Built once per request; used by the "كود غير مطابق لمستوى المدرب"
    // and "محاضرة خارج وقت عمل المدرب" checks.
    // CRITICAL: parenthetical suffixes are stripped on BOTH sides of the
    // match. team_members.name often has "(General)" / "(Private)" appended
    // for clarity, while lectures.trainer has "(Group)" / "(Semi)" / "(z.c)"
    // — different parens on each side, so we strip both before keying.
    const teamRows = db.prepare(
      `SELECT * FROM team_members WHERE department='education'`
    ).all();
    // (defined below — declared up here so we can use it for both keys)
    const _stripParens = (s) => String(s || '').replace(/\([^)]*\)/g, '').trim();
    const teamMap = {};
    for (const t of teamRows) {
      const k = _stripParens(t.name).toLowerCase();
      if (k) teamMap[k] = t;
    }
    // Parse course strings from the Batches sheet:
    //   "Private General 4" / "P General 2" / "General 4"  → general
    //   "P STARTER 3" / "Private starter 2"                → starter
    //   "Private conversation 3" / "CON 1" / "CON4"        → conversation
    const COURSE_FAMILY_LABEL = { starter: 'Starter', general: 'General', conversation: 'Conversation' };
    function parseCourseString(s) {
      if (!s) return null;
      const str = String(s).trim();
      let m;
      m = str.match(/(?:conversation|con)\s*0*(\d+)/i);
      if (m) return { family: 'conversation', level: parseInt(m[1], 10) };
      m = str.match(/general\s*0*(\d+)/i);
      if (m) return { family: 'general', level: parseInt(m[1], 10) };
      m = str.match(/starter\s*0*(\d+)/i);
      if (m) return { family: 'starter', level: parseInt(m[1], 10) };
      return null;
    }
    // Strip "(...)" from a trainer name. "Menna Fawzy(Semi)" → "Menna Fawzy".
    function stripTrainerSuffix(name) {
      if (!name) return '';
      return String(name).replace(/\([^)]*\)/g, '').trim();
    }

    // ── Schedule helpers (used by "محاضرة خارج وقت عمل المدرب" check) ─────
    // Lecture times look like "06:00 PM" (12-h with AM/PM); shift times are
    // "16:00" (24-h); rest periods are JSON-encoded [{start, end}, ...].
    const DOW_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const DOW_AR   = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    function parseHHMMToMin(s) {
      if (!s) return null;
      const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      return parseInt(m[1]) * 60 + parseInt(m[2]);
    }
    // Treat shift end "00:00" as midnight at end-of-day (= 24:00 = 1440 min).
    function parseShiftEndMin(s) {
      const v = parseHHMMToMin(s);
      if (v === 0) return 1440;
      return v;
    }
    function parseRestList(raw) {
      if (!raw) return [];
      let arr = raw;
      if (typeof raw === 'string') {
        try { arr = JSON.parse(raw); } catch { return []; }
      }
      if (!Array.isArray(arr)) return [];
      return arr
        .map(r => ({ startMin: parseHHMMToMin(r?.start), endMin: parseHHMMToMin(r?.end) }))
        .filter(r => r.startMin != null && r.endMin != null && r.endMin > r.startMin);
    }
    // Returns null if shift is unconfigured, otherwise a normalized record.
    // Schema asymmetry: shift 1 stores work-days as `work_days` (no prefix)
    // and voice-notes as `voice_notes`; shift 2 uses the `shift2_` prefix
    // for both. Other shift fields keep `shift_` / `shift2_` consistently.
    function normalizeShift(t, suffix) {
      const shift = t['shift' + suffix];
      if (!shift) return null;
      const startMin = parseHHMMToMin(t['shift' + suffix + '_start']);
      const endMin   = parseShiftEndMin(t['shift' + suffix + '_end']);
      if (startMin == null || endMin == null) return null;
      const daysField = suffix === '' ? 'work_days' : 'shift2_work_days';
      const vnField   = suffix === '' ? 'voice_notes' : 'shift2_voice_notes';
      const days = String(t[daysField] || '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      return {
        startMin, endMin,
        days,
        startDate:  t['shift' + suffix + '_start_date'] || null,
        endDate:    t['shift' + suffix + '_end_date']   || null,
        rests:      parseRestList(t['shift' + suffix + '_rests']),
        voiceNotes: parseRestList(t[vnField]),
        startStr:   t['shift' + suffix + '_start'] || '',
        endStr:     t['shift' + suffix + '_end']   || '',
      };
    }
    function isDateInShiftRange(dateStr, shift) {
      if (shift.startDate && dateStr < shift.startDate) return false;
      if (shift.endDate   && dateStr > shift.endDate)   return false;
      return true;
    }
    // Format a "minutes since midnight" value back to "HH:MM AM/PM" for display.
    function fmt12h(mins) {
      if (mins == null) return '';
      const m = mins % 1440;
      const h24 = Math.floor(m / 60), mm = m % 60;
      const ampm = h24 >= 12 ? 'PM' : 'AM';
      let h12 = h24 % 12; if (h12 === 0) h12 = 12;
      return `${String(h12).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${ampm}`;
    }
    // Evaluate one lecture against a trainer. Returns { ok, reason }.
    // reason is short Arabic text describing why the lecture is out of schedule.
    function evaluateLectureSchedule(lec, teamRow) {
      const shifts = parseTeamShifts(teamRow);
      if (shifts.length === 0) return { ok: true, reason: null }; // no shift configured → skip

      // Skip lectures that pre-date the trainer's earliest shift_start_date.
      // The trainer's schedule data only became authoritative starting that
      // date — anything earlier is outside the audit window (the trainer
      // might have worked under an unrecorded arrangement before then).
      // After-end-date lectures ARE still checked → trainer left the job
      // means they shouldn't have lectures after their end date.
      const earliestStart = shifts
        .map(s => s.startDate)
        .filter(Boolean)
        .sort()[0];
      if (earliestStart && lec.date < earliestStart) {
        return { ok: true, reason: null };
      }

      const lecStartMin = parseTimeMins(lec.time);  // existing helper above (12-h aware)
      if (lecStartMin < 0) return { ok: true, reason: null };     // unparseable time → skip
      const lecEndMin = lecStartMin + parseDurMins(lec.duration);
      const dow = getDow(lec.date);
      const dayKey = DOW_KEYS[dow] || '';

      // Grace period (business rule): a lecture may run up to 10 minutes past
      // the shift end OR overlap a rest/voice-note block by up to 10 minutes
      // without being flagged. Fixes false positives like a 60-min lecture that
      // starts 23:08 and ends 00:08 (8 min past a 00:00 shift end).
      const SHIFT_END_TOLERANCE_MIN = 10;
      const REST_OVERLAP_TOLERANCE_MIN = 10;

      // Per-shift pattern check (day + time + no rest/voice-note conflict).
      // Does NOT consider date range. Returns null if the pattern matches.
      function patternConflict(sh) {
        if (!sh.days.includes(dayKey)) {
          return { kind: 'day-mismatch', reason: `يوم ${DOW_AR[dow]} مش في أيام العمل` };
        }
        if (lecStartMin < sh.startMin || lecEndMin > sh.endMin + SHIFT_END_TOLERANCE_MIN) {
          return { kind: 'time-outside', reason: `خارج الشيفت ⁦(${sh.startStr} → ${sh.endStr})⁩` };
        }
        const blocks = [
          ...sh.rests.map(r => ({ startMin: r.startMin, endMin: r.endMin, days: r.days, type: 'rest' })),
          ...(sh.voiceNotes || []).map(v => ({ startMin: v.startMin, endMin: v.endMin, days: v.days, type: 'voice_note' })),
        ];
        const offending = blocks.find(b => {
          // Per-day scoping: a break/voice block applies only to its own days
          // (empty days = every work-day). Skip blocks that don't cover this
          // lecture's day — same rule used by shiftMinsForDate / find-available
          // -trainer. Without this, a Sat/Tue break was wrongly flagged on a
          // Sun/Wed lecture ("داخل وقت راحة" false positive).
          if (b.days && b.days.length && !b.days.includes(dayKey)) return false;
          const overlap = Math.min(lecEndMin, b.endMin) - Math.max(lecStartMin, b.startMin);
          return overlap > REST_OVERLAP_TOLERANCE_MIN;
        });
        if (offending) {
          const label = offending.type === 'voice_note' ? 'Voice Note' : 'راحة';
          return {
            kind: 'block-overlap',
            reason: `داخل وقت ${label} ⁦(${fmt12h(offending.startMin)} → ${fmt12h(offending.endMin)})⁩`,
          };
        }
        return null; // pattern matches
      }

      // Step 1: if ANY shift fully covers (date range + pattern) → PASS.
      // Step 2: if no shift covers, decide the reason:
      //   - If an ENDED shift's pattern matched → "انتهى عمل المدرب في {endDate}"
      //   - Else prefer the reason from an ACTIVE shift (not date-range failure)
      //   - Else if all shifts ended → use latest end_date
      //   - Else generic "خارج فترة عمل المدرب"
      const activeReasons = [];
      let endedPatternMatchDate = null;
      let anyEndedAndAllOutOfRange = true;
      const endedDates = [];

      for (const sh of shifts) {
        const inRange = isDateInShiftRange(lec.date, sh);
        const isEnded = sh.endDate && lec.date > sh.endDate;
        if (isEnded) endedDates.push(sh.endDate);
        if (inRange) anyEndedAndAllOutOfRange = false;

        if (inRange) {
          // Active shift on this date — evaluate pattern
          const pc = patternConflict(sh);
          if (pc === null) {
            return { ok: true, reason: null }; // fully covered
          }
          activeReasons.push(pc.reason);
        } else if (isEnded) {
          // Shift ended — check if its pattern would have matched
          if (patternConflict(sh) === null) {
            // Pattern fits this ended shift → this is the "trainer ended" case
            if (!endedPatternMatchDate || sh.endDate > endedPatternMatchDate) {
              endedPatternMatchDate = sh.endDate;
            }
          }
        }
        // before-start shifts: handled by the earliest-start skip above, but
        // a between-shifts gap could land here — keep generic for those.
      }

      // Decision tree
      if (endedPatternMatchDate) {
        return { ok: false, reason: `انتهى عمل المدرب في ${endedPatternMatchDate}` };
      }
      if (activeReasons.length > 0) {
        return { ok: false, reason: activeReasons[0] };
      }
      if (anyEndedAndAllOutOfRange && endedDates.length > 0) {
        const latestEnd = endedDates.sort().reverse()[0];
        return { ok: false, reason: `انتهى عمل المدرب في ${latestEnd}` };
      }
      return { ok: false, reason: 'خارج فترة عمل المدرب' };
    }

    // fetch ALL zoom call sessions (regular 15-min) including unconfirmed for zoom-call problem checks
    // l.trainer is needed for the trainer level + schedule checks (zoom).
    const sideRaw = db.prepare(
      `SELECT l.group_name, l.date, l.time, l.duration, l.trainer FROM lectures l
       INNER JOIN batches b ON l.group_name=b.group_name${line ? ' AND b.line = l.line' : ''}
       WHERE b.status='نشطة' AND l.session_type='side'
         AND LOWER(COALESCE(l.side_session_category,'regular')) = 'regular'
       ${deptFilter}${empFilter}${lineL} ORDER BY l.group_name, l.date ASC`
    ).all();

    // group by group_name (store full rows)
    const mainByGroup = {}, sideByGroup = {};
    mainRaw.forEach(r => { (mainByGroup[r.group_name] = mainByGroup[r.group_name]||[]).push(r); });
    sideRaw.forEach(r => { (sideByGroup[r.group_name] = sideByGroup[r.group_name]||[]).push(r); });

    // ── midnight rule helpers ──────────────────────────────────────────
    const parseTimeMins = t => {
      if (!t) return -1;
      const m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (!m) return -1;
      let h = parseInt(m[1]), min = parseInt(m[2]);
      if (m[3]?.toUpperCase() === 'PM' && h < 12) h += 12;
      if (m[3]?.toUpperCase() === 'AM' && h === 12) h = 0;
      return h * 60 + min;
    };
    const parseDurMins = d => {
      if (!d) return 0;
      const m = String(d).match(/(\d{1,2}):(\d{2})/);
      return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
    };
    const addDays = (dateStr, n) => {
      const d = new Date(dateStr + 'T12:00:00');
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0,10);
    };
    // Returns effective date (next day if session ends after midnight)
    const effectiveDate = (date, time, duration) => {
      const start = parseTimeMins(time);
      if (start < 0) return date;
      return (start + parseDurMins(duration)) >= 1440 ? addDays(date, 1) : date;
    };

    // Expected last date for MAIN (8 sessions, 2/week)
    // First day of pair (Sat/Sun/Mon) → +24 days; second day (Tue/Wed/Thu) → +25 days
    const FIRST_IN_PAIR = new Set([6, 0, 1]); // Sat, Sun, Mon
    const expectedMainLast = firstDate => {
      const dow = getDow(firstDate);
      return addDays(firstDate, FIRST_IN_PAIR.has(dow) ? 24 : 25);
    };
    // Expected last date for SIDE (7 slot-dates, 2/week) → always +21 days
    const expectedSideLast = firstDate => addDays(firstDate, 21);

    // Load all stored statuses into a map for O(1) lookup
    const storedStatuses = db.prepare(`SELECT * FROM code_problem_status WHERE 1=1${lineCps}`).all();
    const statusMap = {};
    storedStatuses.forEach(s => { statusMap[`${s.group_name}|${s.problem_type}|${s.session_type}`] = s; });

    // Build rename map: new_group_code → { previous_group_name, updated_at }
    // Used to display "Previous code" badge when user searches by the new code name
    const renameMap = {};
    storedStatuses.forEach(s => {
      if (s.new_group_code && s.new_group_code.trim()) {
        const key = s.new_group_code.trim();
        // Keep the most recent rename entry per new code
        if (!renameMap[key] || s.updated_at > renameMap[key].updated_at) {
          renameMap[key] = {
            previous_group_name: s.group_name,
            updated_at: s.updated_at,
          };
        }
      }
    });

    // Helper: add problem respecting wont_repeat/exception rules
    // - If status is wont_repeat/exception AND actual <= actual_at_status → SKIP
    // - If status is wont_repeat/exception AND actual > actual_at_status → show as new with repeated_violation flag
    // - If status is wont_repeat/exception AND no actual (date-based) → SKIP
    const addProblem = (arr, problem, sessionType) => {
      const key = `${problem.group_name}|${problem.problem_type}|${sessionType}`;
      const s = statusMap[key];
      if (s && (s.status === 'wont_repeat' || s.status === 'exception' || s.status === 'resolved')) {
        // Detect "repeated violation": stored status was won't-repeat / exception /
        // resolved, but the actual count has grown since then. Detected ONCE here
        // so both KPI mode (showResolved=false) and modal mode (showResolved=true)
        // agree on which items are still active.
        const isRepeated =
          problem.actual != null &&
          s.actual_at_status != null &&
          problem.actual > s.actual_at_status;
        if (isRepeated) {
          problem.repeated_violation = true;
          problem.previous_status    = s.status;
          problem.previous_actual    = s.actual_at_status;
        }
        if (showResolved) {
          // Include resolved items when explicitly requested (for filter view).
          // We attach the resolved metadata AND keep the repeated_violation flag
          // (set above) so the modal's default-hide-resolved filter still surfaces
          // genuinely-active rows — matching what the KPI count reports.
          problem._resolved_status = s.status;
          problem._status_note     = s.note;
          problem._status_by       = s.updated_by_name;
          problem._status_at       = s.updated_at;
          arr.push(problem);
          return;
        }
        // KPI mode: include only if it's a fresh repeated violation, otherwise skip.
        if (!isRepeated) return;
      }
      arr.push(problem);
    };

    const mainProblems = [], zoomProblems = [];

    for (const batch of batches) {
      const gn        = batch.group_name;
      // Skip internal/placeholder buckets (not real teaching groups): they carry
      // junk schedules (e.g. 9 main lectures on one day, trainee_count 319) and
      // would flood the Code-Repair report with unresolvable false problems.
      if (/free\s*slot|hiring\s*new\s*teacher/i.test(gn)) continue;
      const parsed    = parseGroupName(gn);
      const mainRows  = mainByGroup[gn] || [];
      const sideRows  = sideByGroup[gn] || [];
      const mainDates = mainRows.map(r => r.date);
      const sideDates = sideRows.map(r => r.date);
      // Unique sorted side slot-dates (multiple sessions per day → deduplicate)
      const sideSlotDates = [...new Set(sideDates)].sort();
      const meta = { group_name: gn, dept_type: batch.dept_type, coordinators: batch.coordinators };

      // first dates for display
      const firstMainDate = mainDates[0] || null;
      const firstSideDate = sideSlotDates[0] || null;

      // ── GROUP-LEVEL CHECK: مجموعة بدون منسق ──────────────────────
      // Flag only if:
      //   (1) batch is active (status='نشطة' — enforced at fetch time)
      //   (2) batch.start_date is set AND in the past (group has STARTED)
      //   (3) coordinators is NULL / empty / whitespace / "--"
      // Future-start groups are intentionally skipped (the coordinator might
      // not be assigned yet — no point flagging until the group actually starts).
      {
        const coordVal = String(batch.coordinators || '').trim();
        const noCoord = !coordVal || coordVal === '--';
        const todayISO = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10); // Cairo UTC+2
        const hasStarted = batch.start_date && batch.start_date <= todayISO;
        if (noCoord && hasStarted) {
          const baseProblem = {
            ...meta,
            problem_type: 'مجموعة بدون منسق',
            detail: `المجموعة بدأت ${batch.start_date} ومفيش منسق مسجل`,
          };
          addProblem(mainProblems, { ...baseProblem, first_date: firstMainDate }, 'main');
          addProblem(zoomProblems, { ...baseProblem, trainee_count: batch.trainee_count, first_date: firstSideDate }, 'side');
        }
      }

      // ── GROUP-LEVEL CHECK: عدد العملاء اتغير عن المعتمد ─────────────
      // Only groups that were explicitly "received" (have an approval row)
      // are checked. If the live trainee_count drifted from the approved
      // baseline — up OR down — flag it. Resolution = re-approve the new
      // count from the "استلام المجموعات" page (which clears this flag).
      // Pushed directly (not via addProblem) because re-approval — not the
      // code-problem status mechanism — is the canonical resolution.
      {
        const approvedCount = approvalMap[`${gn}|${batch.line}`];
        const liveCount     = batch.trainee_count || 0;
        if (approvedCount != null && approvedCount !== liveCount) {
          const diff = liveCount - approvedCount;
          mainProblems.push({
            ...meta,
            first_date: firstMainDate,
            problem_type: 'عدد عملاء المجموعة اتغير عن المعتمد',
            detail: `المعتمد: ${approvedCount} | الحالي: ${liveCount} (${diff > 0 ? '+' : ''}${diff}) — اعتمد العدد الجديد من صفحة استلام المجموعات`,
            actual: liveCount,
            expected: approvedCount,
          });
        }
      }

      // ── MAIN CHECKS ──────────────────────────────────────────────
      // 1. Count > 8
      if (mainDates.length > 8) {
        addProblem(mainProblems, { ...meta, first_date: firstMainDate,
          problem_type: 'عدد محاضرات زيادة',
          detail: `الموجود: ${mainDates.length} محاضرة — المفروض: 8`,
          actual: mainDates.length, expected: 8,
        }, 'main');
      }

      // 1b. Count < 8 (missing main lectures)
      if (mainDates.length > 0 && mainDates.length < 8) {
        addProblem(mainProblems, { ...meta, first_date: firstMainDate,
          problem_type: 'عدد المحاضرات ناقصة',
          detail: `الموجود: ${mainDates.length} محاضرة — المفروض: 8`,
          actual: mainDates.length, expected: 8,
        }, 'main');
      }

      if (parsed) {
        // 2. First session date ≠ name date
        if (mainDates.length > 0) {
          const first    = mainDates[0];
          const year     = first.substring(0,4);
          const expected = `${year}-${pad(parsed.monthNum)}-${pad(parsed.dayNum)}`;
          const firstDow = getDow(first);
          if (first !== expected) {
            addProblem(mainProblems, { ...meta, first_date: firstMainDate,
              problem_type: 'تاريخ أول محاضرة غلط',
              detail: `الاسم: ${expected} (${DAY_EN[parsed.dow]}) | الفعلي: ${first} (${DAY_EN[firstDow]||'?'})`,
              expected_date: expected, actual_date: first,
            }, 'main');
          }
        }

        // 3. Sessions on wrong days
        const mainPair = getMainPair(parsed.dow);
        if (mainPair && mainDates.length > 0) {
          const wrong = mainDates.filter(d => !mainPair.includes(getDow(d)));
          if (wrong.length > 0) {
            addProblem(mainProblems, { ...meta, first_date: firstMainDate,
              problem_type: 'محاضرات على أيام غلط',
              detail: `${wrong.length} محاضرة خارج أيام (${mainPair.map(d=>DAY_AR[d]).join(' و')}) | أمثلة: ${wrong.slice(0,3).join(', ')}`,
              wrong_count: wrong.length,
            }, 'main');
          }
        }

        // ── ZOOM CALL CHECKS ──────────────────────────────────────────────
        // 1. Zoom calls on wrong days
        const sidePair = getSidePair(parsed.dow);
        if (sidePair && sideDates.length > 0) {
          const wrong = sideDates.filter(d => !sidePair.includes(getDow(d)));
          if (wrong.length > 0) {
            addProblem(zoomProblems, { ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
              problem_type: 'زووم كول على أيام غلط',
              detail: `${wrong.length} جلسة خارج أيام (${sidePair.map(d=>DAY_AR[d]).join(' و')}) | أمثلة: ${wrong.slice(0,3).join(', ')}`,
              wrong_count: wrong.length,
            }, 'side');
          }
        }
      }

      // Intensive (مكثف) groups pack their sessions into a compressed window
      // (2 day-tokens, e.g. "Sat_Sun"), so the +24/+25/+21-day last-date formulas
      // don't apply — skip checks 3 & 4 for them (they produced false positives).
      const groupIsIntensive = ['sat','sun','mon','tue','wed','thu','fri']
        .filter(d => new RegExp('(^|_)' + d + '(_|$)').test(gn.toLowerCase())).length >= 2;

      // 2. Zoom call count ≠ trainee_count × expected-per-trainee
      // Intensive groups (مكثف): group name contains 2+ day abbreviations
      // (e.g. "Sat_Sun", "Mon_Tue") → 4 zoom calls per trainee.
      // Regular groups (1 day): 7 zoom calls per trainee.
      // GUARD: skip check for groups that have no confirmed main lectures yet
      // (new groups just synced from Drive, or helper/internal groups). This
      // prevents false "زووم كول ناقصة" errors for groups that haven't started.
      {
        const DAY_TOKENS = ['sat','sun','mon','tue','wed','thu','fri'];
        const lowerGn   = gn.toLowerCase();
        const dayCount  = DAY_TOKENS.filter(d => new RegExp('(^|_)' + d + '(_|$)').test(lowerGn)).length;
        const isIntensive      = dayCount >= 2;
        const zoomPerTrainee   = isIntensive ? 4 : 7;
        const expectedSide     = (batch.trainee_count || 0) * zoomPerTrainee;
        const intensiveLabel   = isIntensive ? ' مكثف' : '';
        if (expectedSide > 0 && sideDates.length !== expectedSide && mainRows.length > 0) {
          addProblem(zoomProblems, { ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
            problem_type: sideDates.length < expectedSide ? 'زووم كول ناقصة' : 'زووم كول زيادة',
            detail: `الموجود: ${sideDates.length} | المطلوب: ${expectedSide} (${batch.trainee_count}×${zoomPerTrainee}${intensiveLabel})`,
            actual: sideDates.length, expected: expectedSide,
          }, 'side');
        }
      }

      // 3. MAIN — last session date mismatch
      if (mainDates.length > 0 && firstMainDate && !groupIsIntensive) {
        const lastMainRow   = mainRows[mainRows.length - 1];
        const actualLast    = effectiveDate(lastMainRow.date, lastMainRow.time, lastMainRow.duration);
        const calcLast      = expectedMainLast(firstMainDate);
        if (actualLast !== calcLast) {
          const midnight = effectiveDate(lastMainRow.date, lastMainRow.time, lastMainRow.duration) !== lastMainRow.date;
          addProblem(mainProblems, { ...meta, first_date: firstMainDate,
            problem_type: 'تاريخ آخر محاضرة غلط',
            detail: `المحسوب: ${calcLast} | الفعلي: ${actualLast}${midnight ? ' (تعدى منتصف الليل)' : ''}`,
            expected_date: calcLast, actual_date: actualLast,
          }, 'main');
        }
      }

      // 4. ZOOM CALL — last session date mismatch
      if (sideSlotDates.length > 0 && firstSideDate && !groupIsIntensive) {
        const lastSideRow   = sideRows[sideRows.length - 1];
        const actualSideLast = effectiveDate(lastSideRow.date, lastSideRow.time, lastSideRow.duration);
        const calcSideLast   = expectedSideLast(firstSideDate);
        if (actualSideLast !== calcSideLast) {
          const midnight = effectiveDate(lastSideRow.date, lastSideRow.time, lastSideRow.duration) !== lastSideRow.date;
          addProblem(zoomProblems, { ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
            problem_type: 'تاريخ آخر زووم كول غلط',
            detail: `المحسوب: ${calcSideLast} | الفعلي: ${actualSideLast}${midnight ? ' (تعدى منتصف الليل)' : ''}`,
            expected_date: calcSideLast, actual_date: actualSideLast,
          }, 'side');
        }
      }

      // 5. MAIN — trainer level mismatch
      //    Group's course (e.g. "Private General 4") parsed → {family,level}.
      //    For each unique trainer in this group's main lectures, look up
      //    teachable_<family> in team_members. If the course level exceeds
      //    the trainer's max, flag it. Trainers not registered are skipped
      //    silently (we don't assume they're incapable).
      const parsedCourse = parseCourseString(batch.course);
      if (parsedCourse) {
        const capCol  = `teachable_${parsedCourse.family}`;
        const seenT   = new Set();
        const overcap = [];
        for (const row of mainRows) {
          const cleanT = stripTrainerSuffix(row.trainer);
          if (!cleanT) continue;
          const key = cleanT.toLowerCase();
          if (seenT.has(key)) continue;
          seenT.add(key);
          const teamRow = teamMap[key];
          if (!teamRow) continue;          // unregistered trainer → skip
          const max = Number(teamRow[capCol] ?? 5);
          if (parsedCourse.level > max) {
            const fam = COURSE_FAMILY_LABEL[parsedCourse.family];
            overcap.push(`${cleanT} (قدرته ${fam} ${max})`);
          }
        }
        if (overcap.length > 0) {
          const fam = COURSE_FAMILY_LABEL[parsedCourse.family];
          addProblem(mainProblems, { ...meta, first_date: firstMainDate,
            problem_type: 'كود غير مطابق لمستوى المدرب',
            detail: `الدورة: ${fam} ${parsedCourse.level} — ${overcap.join(' / ')}`,
            actual: parsedCourse.level,
          }, 'main');
        }
      }

      // 6. MAIN — lecture outside trainer's working hours
      //    For each lecture in this batch, evaluate against trainer's shift(s).
      //    Violations: outside shift date range / day not in work_days /
      //    time outside shift window / overlapping a rest period.
      //    Aggregated per (group, trainer): show first 3 violating lectures
      //    in detail, plus a count of any extras.
      {
        const violationsByTrainer = {};  // cleanT → [{date, time, reason}]
        for (const row of mainRows) {
          const cleanT = stripTrainerSuffix(row.trainer);
          if (!cleanT) continue;
          const key = cleanT.toLowerCase();
          const teamRow = teamMap[key];
          if (!teamRow) continue;             // unregistered → skip
          const evalRes = evaluateLectureSchedule(row, teamRow);
          if (!evalRes.ok) {
            (violationsByTrainer[cleanT] = violationsByTrainer[cleanT] || []).push({
              date: row.date, time: row.time, reason: evalRes.reason,
            });
          }
        }
        const trainersWithIssues = Object.keys(violationsByTrainer);
        if (trainersWithIssues.length > 0) {
          const parts = trainersWithIssues.map(name => {
            const list = violationsByTrainer[name];
            const sample = list.slice(0, 3).map(v => `⁦${v.date} ${v.time}⁩ (${v.reason})`).join('، ');
            const extra = list.length > 3 ? ` و${list.length - 3} أخرى` : '';
            return `${name}: ${sample}${extra}`;
          });
          const totalViolations = trainersWithIssues.reduce((s, n) => s + violationsByTrainer[n].length, 0);
          addProblem(mainProblems, { ...meta, first_date: firstMainDate,
            problem_type: 'محاضرة خارج وقت عمل المدرب',
            detail: parts.join(' | '),
            actual: totalViolations,
          }, 'main');
        }
      }

      // 7. ZOOM CALL — trainer level mismatch (mirror of #5 for side sessions)
      if (parsedCourse) {
        const capCol  = `teachable_${parsedCourse.family}`;
        const seenT   = new Set();
        const overcap = [];
        for (const row of sideRows) {
          const cleanT = stripTrainerSuffix(row.trainer);
          if (!cleanT) continue;
          const key = cleanT.toLowerCase();
          if (seenT.has(key)) continue;
          seenT.add(key);
          const teamRow = teamMap[key];
          if (!teamRow) continue;
          const max = Number(teamRow[capCol] ?? 5);
          if (parsedCourse.level > max) {
            const fam = COURSE_FAMILY_LABEL[parsedCourse.family];
            overcap.push(`${cleanT} (قدرته ${fam} ${max})`);
          }
        }
        if (overcap.length > 0) {
          const fam = COURSE_FAMILY_LABEL[parsedCourse.family];
          addProblem(zoomProblems, { ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
            problem_type: 'كود غير مطابق لمستوى المدرب',
            detail: `الدورة: ${fam} ${parsedCourse.level} — ${overcap.join(' / ')}`,
            actual: parsedCourse.level,
          }, 'side');
        }
      }

      // 8. ZOOM CALL — outside trainer's working hours (mirror of #6 for side sessions)
      {
        const violationsByTrainer = {};
        for (const row of sideRows) {
          const cleanT = stripTrainerSuffix(row.trainer);
          if (!cleanT) continue;
          const key = cleanT.toLowerCase();
          const teamRow = teamMap[key];
          if (!teamRow) continue;
          const evalRes = evaluateLectureSchedule(row, teamRow);
          if (!evalRes.ok) {
            (violationsByTrainer[cleanT] = violationsByTrainer[cleanT] || []).push({
              date: row.date, time: row.time, reason: evalRes.reason,
            });
          }
        }
        const trainersWithIssues = Object.keys(violationsByTrainer);
        if (trainersWithIssues.length > 0) {
          const parts = trainersWithIssues.map(name => {
            const list = violationsByTrainer[name];
            const sample = list.slice(0, 3).map(v => `⁦${v.date} ${v.time}⁩ (${v.reason})`).join('، ');
            const extra = list.length > 3 ? ` و${list.length - 3} أخرى` : '';
            return `${name}: ${sample}${extra}`;
          });
          const totalViolations = trainersWithIssues.reduce((s, n) => s + violationsByTrainer[n].length, 0);
          addProblem(zoomProblems, { ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
            problem_type: 'زووم كول خارج وقت عمل المدرب',
            detail: parts.join(' | '),
            actual: totalViolations,
          }, 'side');
        }
      }
    }

    // Attach previous_group_name to problems whose group_name matches a recorded new_group_code
    const attachRename = p => {
      const r = renameMap[p.group_name];
      if (r) {
        p.previous_group_name = r.previous_group_name;
        p.rename_recorded_at  = r.updated_at;
      }
      return p;
    };
    mainProblems.forEach(attachRename);
    zoomProblems.forEach(attachRename);

    // ── GHOST entries ────────────────────────────────────────────────────────
    // For each resolved problem that points to a new_group_code which exists as
    // a current batch, surface a read-only "historical" problem under the new
    // code so users searching by the new code can see what was resolved
    // previously. Without this, searching by the new code hides the resolved
    // record (because the resolved record is keyed to the old group_name).
    const batchMap = {};
    batches.forEach(b => { batchMap[b.group_name] = b; });
    const existingKey = new Set();
    mainProblems.forEach(p => existingKey.add(`${p.group_name}|${p.problem_type}|main`));
    zoomProblems.forEach(p => existingKey.add(`${p.group_name}|${p.problem_type}|side`));

    storedStatuses.forEach(s => {
      if (!s.new_group_code) return;
      const newCode = s.new_group_code.trim();
      if (!newCode) return;
      // Only surface closed statuses (resolved / wont_repeat / exception)
      if (!['resolved', 'wont_repeat', 'exception'].includes(s.status)) return;
      const batch = batchMap[newCode];
      if (!batch) return; // new code must exist in the filtered batches
      const sessionType = s.session_type || 'main';
      const key = `${newCode}|${s.problem_type}|${sessionType}`;
      if (existingKey.has(key)) return; // a live problem already exists — skip
      // When showResolved=false (default), skip — ghost entries are inherently "closed"
      if (!showResolved) return;
      // Look up the "updated_by_name" (join users) — cheap, done once per ghost
      let updatedByName = null;
      if (s.updated_by) {
        const u = db.prepare('SELECT full_name FROM users WHERE id = ?').get(s.updated_by);
        updatedByName = u?.full_name ?? null;
      }
      const ghost = {
        group_name:          newCode,
        problem_type:        s.problem_type,
        dept_type:           batch.dept_type,
        coordinators:        batch.coordinators,
        trainee_count:       batch.trainee_count,
        first_date:          null,
        detail:              `تم حل هذه المشكلة تحت الاسم السابق: ${s.group_name}`,
        // flags that mark this as a ghost/historical entry
        _ghost:              true,
        _ghost_source_group: s.group_name,
        // already-closed status fields (mirrors addProblem's showResolved branch)
        _resolved_status:    s.status,
        _status_note:        s.note,
        _status_by:          updatedByName,
        _status_at:          s.updated_at,
        // rename badge
        previous_group_name: s.group_name,
        rename_recorded_at:  s.updated_at,
      };
      if (sessionType === 'side') zoomProblems.push(ghost);
      else                        mainProblems.push(ghost);
      existingKey.add(key);
    });

  return { mainProblems, zoomProblems };
}

// ─── GET /api/reports/code-problems ──────────────────────────────────────────
// Validates groups against business rules for main & side sessions (thin wrapper).
router.get('/code-problems', (req, res) => {
  const { department, employee, show_resolved } = req.query;
  const line = lineFilter(req);
  try {
    const { mainProblems, zoomProblems } = computeCodeProblems({
      department, employee, line, user: req.user,
      showResolved: show_resolved === 'true',
    });
    return res.json({
      main_problems: mainProblems,
      zoom_problems: zoomProblems,
      total: mainProblems.length + zoomProblems.length,
    });
  } catch (err) {
    console.error('[reports] code-problems error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/trainer-utilization ────────────────────────────────────
// Phase 1 of the "إشغال المدربين" feature: returns per-trainer per-day capacity
// (available minutes from shift) vs booked minutes (from lectures).
//
// Query params:
//   from, to    — YYYY-MM-DD inclusive (default: today through +6 days = 1 week)
//   section     — optional filter by team_members.section (general/private/semi/all/phone_call)
//   search      — optional substring of trainer name
//
// Response:
//   {
//     dates:   ['2026-05-09', '2026-05-10', ...],
//     trainers: [{
//       id, name, section, shift_summary,
//       totals: { available_min, booked_min, utilization_pct, work_days },
//       days:   { 'YYYY-MM-DD': { is_work_day, available_min, booked_min, utilization_pct, lectures: [...] } }
//     }]
//   }
// Merge [startMin,endMin] intervals → total COVERED minutes (union length).
// A trainer's booked time is their ACTUAL occupied wall-clock time: overlapping
// or simultaneous sessions count ONCE, not summed. Without this, a side/zc
// trainer attributed to many groups at the same clock time (or the same session
// logged under several coordinator-name variants) had every duration summed →
// utilization blew past 100% (e.g. 246% on a 7h shift). Non-overlapping work is
// unaffected (union == sum), so a trainer who genuinely worked beyond their shift
// still reads >100%.
function mergeIntervalsMinutes(intervals) {
  const iv = (intervals || [])
    .filter(x => Array.isArray(x) && x.length === 2 && x[0] != null && x[1] != null && x[1] > x[0])
    .sort((a, b) => a[0] - b[0]);
  let total = 0, curS = null, curE = null;
  for (const [s, e] of iv) {
    if (curE === null)      { curS = s; curE = e; }
    else if (s <= curE)     { if (e > curE) curE = e; }
    else                    { total += curE - curS; curS = s; curE = e; }
  }
  if (curE !== null) total += curE - curS;
  return total;
}

router.get('/trainer-utilization', (req, res) => {
  const { from, to, section = '', search = '' } = req.query;
  const line = lineFilter(req);
  const lineL = buildLineFilter('l', line);
  const lineB = buildLineFilter('b', line);

  // Default range: today through +6 days (one week)
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const fmt = d => d.toISOString().slice(0, 10);
  const fromDate = from || fmt(today);
  const toDateRaw = to;
  let toDate = toDateRaw;
  if (!toDate) {
    const end = new Date(today); end.setDate(end.getDate() + 6);
    toDate = fmt(end);
  }
  // Build inclusive list of dates between from and to. Official-holiday days
  // are EXCLUDED — the academy is closed, so they count toward neither a
  // trainer's available nor booked hours (utilization is unaffected by them).
  const { getHolidayDateSet } = require('../utils/holidays');
  const holidaySet = getHolidayDateSet();
  const dates = [];
  const holiday_dates = [];
  {
    let d = new Date(fromDate + 'T12:00:00');
    const stop = new Date(toDate + 'T12:00:00');
    while (d <= stop) {
      const iso = fmt(d);
      if (holidaySet.has(iso)) holiday_dates.push(iso);
      else dates.push(iso);
      d.setDate(d.getDate() + 1);
    }
  }

  // Local helpers (mirror those in computeCodeProblems)
  const DOW_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const HHMM = s => {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
  };
  const HHMM_END = s => { const v = HHMM(s); return v === 0 ? 1440 : v; };
  const parseRests = raw => {
    if (!raw) return [];
    let arr = raw;
    if (typeof raw === 'string') {
      try { arr = JSON.parse(raw); } catch { return []; }
    }
    if (!Array.isArray(arr)) return [];
    return arr
      .map(r => ({ s: HHMM(r?.start), e: HHMM(r?.end) }))
      .filter(r => r.s != null && r.e != null && r.e > r.s);
  };
  const parseTime12 = t => {
    if (!t) return -1;
    const m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return -1;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (m[3]?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (m[3]?.toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  };
  const parseDur = d => {
    if (!d) return 0;
    const m = String(d).match(/(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
  };
  const getDow = s => { if (!s) return -1; return new Date(s + 'T12:00:00').getDay(); };
  const stripParens = name => String(name || '').replace(/\([^)]*\)/g, '').trim();
  // Group identity WITHOUT the trailing coordinator suffix (everything after the
  // last ')'), so rename/coordinator twins like "...(Nada Khaled)hanaa" /
  // "...(Nada Khaled) doha" collapse to the SAME session in the displayed list.
  const baseGroupOf = (g) => {
    const s = String(g || ''); const i = s.lastIndexOf(')');
    return (i >= 0 ? s.slice(0, i + 1) : s).replace(/\s+/g, '').toLowerCase();
  };

  // Normalize one of a trainer's two shifts. Returns {startMin,endMin,days[],rests[],voiceNotes[],...} or null.
  // Voice notes (work-time blocks) use the same shape as rests.
  function normalizeShift(t, sfx) {
    const shift = t['shift' + sfx];
    if (!shift) return null;
    const startMin = HHMM(t['shift' + sfx + '_start']);
    const endMin   = HHMM_END(t['shift' + sfx + '_end']);
    if (startMin == null || endMin == null) return null;
    const daysField = sfx === '' ? 'work_days' : 'shift2_work_days';
    const vnField   = sfx === '' ? 'voice_notes' : 'shift2_voice_notes';
    const days = String(t[daysField] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return {
      startMin, endMin, days,
      rests:      parseRests(t['shift' + sfx + '_rests']),
      voiceNotes: parseRests(t[vnField]),
      startDate:  t['shift' + sfx + '_start_date'] || null,
      endDate:    t['shift' + sfx + '_end_date']   || null,
      label:      t['shift' + sfx],
      startStr:   t['shift' + sfx + '_start'] || '',
      endStr:     t['shift' + sfx + '_end']   || '',
    };
  }
  function shiftActiveOn(sh, dateStr) {
    if (sh.startDate && dateStr < sh.startDate) return false;
    if (sh.endDate   && dateStr > sh.endDate)   return false;
    return true;
  }
  function shiftCoversDay(sh, dateStr) {
    if (!shiftActiveOn(sh, dateStr)) return false;
    const dow = getDow(dateStr);
    const dayKey = DOW_KEYS[dow] || '';
    return sh.days.includes(dayKey);
  }
  // Available minutes for this shift on this date. Rests reduce capacity
  // (breaks are off-work). Voice notes do NOT reduce capacity — they are
  // work hours; they just block lectures from being scheduled there.
  function shiftMinsForDate(sh, dateStr) {
    if (!shiftCoversDay(sh, dateStr)) return 0;
    const dayKey = DOW_KEYS[getDow(dateStr)] || '';
    let mins = sh.endMin - sh.startMin;
    for (const r of sh.rests) {
      if (r.days && r.days.length && !r.days.includes(dayKey)) continue;   // break applies only to its days
      mins -= (r.e - r.s);
    }
    return mins > 0 ? mins : 0;
  }
  // Total voice-note minutes for the trainer across all active shifts on a date.
  // Counted as BOOKED time (productive work) in the utilization calc.
  function voiceNoteMinsForDate(shifts, dateStr) {
    const dayKey = DOW_KEYS[getDow(dateStr)] || '';
    let total = 0;
    for (const sh of shifts) {
      if (!shiftCoversDay(sh, dateStr)) continue;
      for (const v of (sh.voiceNotes || [])) {
        if (v.days && v.days.length && !v.days.includes(dayKey)) continue;
        total += (v.e - v.s);
      }
    }
    return total;
  }
  // Voice-note intervals (for UI display) on a given date.
  function voiceNoteIntervalsForDate(shifts, dateStr) {
    const dayKey = DOW_KEYS[getDow(dateStr)] || '';
    const out = [];
    for (const sh of shifts) {
      if (!shiftCoversDay(sh, dateStr)) continue;
      for (const v of (sh.voiceNotes || [])) {
        // Respect per-day scoping: a voice note with `days` applies only on those
        // days (mirrors shiftMinsForDate / the summary endpoint). Without this the
        // heatmap counted a VN on days the trainer doesn't do it.
        if (v.days && v.days.length && !v.days.includes(dayKey)) continue;
        out.push({ start_min: v.s, end_min: v.e, duration_min: v.e - v.s });
      }
    }
    return out.sort((a, b) => a.start_min - b.start_min);
  }
  // Compute free intervals during a date — shift windows minus rests, voice
  // notes, and lectures. Voice notes count as busy (the trainer is occupied
  // recording voice notes during these blocks).
  function computeFreeSlots(shifts, dateStr, lectures) {
    // 1) Build available intervals from shifts that cover this day
    let segments = [];
    for (const sh of shifts) {
      if (shiftCoversDay(sh, dateStr)) segments.push({ s: sh.startMin, e: sh.endMin });
    }
    if (segments.length === 0) return [];
    // 2) Collect busy intervals (rests + voice notes + lectures)
    const busyDayKey = DOW_KEYS[getDow(dateStr)] || '';
    const onDay = x => !x.days || !x.days.length || x.days.includes(busyDayKey);
    const busy = [];
    for (const sh of shifts) {
      if (!shiftCoversDay(sh, dateStr)) continue;
      for (const r of sh.rests)              { if (onDay(r)) busy.push({ s: r.s, e: r.e }); }
      for (const v of (sh.voiceNotes || [])) { if (onDay(v)) busy.push({ s: v.s, e: v.e }); }
    }
    for (const l of (lectures || [])) {
      const start = parseTime12(l.time);
      if (start < 0) continue;
      const dur = parseDur(l.duration);
      if (dur <= 0) continue;
      busy.push({ s: start, e: start + dur });
    }
    // 3) Subtract each busy from segments
    for (const b of busy) {
      const next = [];
      for (const seg of segments) {
        if (b.e <= seg.s || b.s >= seg.e) { next.push(seg); continue; }
        if (b.s > seg.s) next.push({ s: seg.s, e: b.s });
        if (b.e < seg.e) next.push({ s: b.e, e: seg.e });
      }
      segments = next;
    }
    // 4) Drop tiny slivers (< 5 min) — useless for booking
    return segments
      .filter(s => s.e - s.s >= 5)
      .sort((a, b) => a.s - b.s)
      .map(s => ({ start_min: s.s, end_min: s.e, duration_min: s.e - s.s }));
  }

  try {
    // Trainers — Educational Administration. Status filter is INTENTIONALLY
    // not applied here: a trainer who's currently `inactive` may still have
    // historical lectures/work-days inside the filter window (e.g. resigned
    // last week, but we're reporting on the previous month). The per-date
    // shiftCoversDay() check naturally returns 0 for dates outside the
    // trainer's shift window, and the post-filter at the bottom drops any
    // trainer with no activity in the requested range — so deactivated
    // trainers don't clutter the report unless they actually contributed.
    // Section filter is applied per-shift (date-aware) below, NOT in SQL — a
    // trainer can span sections across the period (per-shift section).
    let trainerWhere = `WHERE department='education'`;
    if (search) {
      const s = escapeLike(search);
      trainerWhere += ` AND name LIKE '%${s}%' ESCAPE '\\'`;
    }
    const trainers = db.prepare(`SELECT * FROM team_members ${trainerWhere}`).all();
    const activeSection = (section && section !== 'all') ? String(section).toLowerCase() : null;
    const shiftSection = (sh, trainer) => (sh && sh.section) || (trainer && trainer.section) || 'all';

    // Keep trainers with ≥1 shift (read shifts_json, not just legacy columns);
    // when a section filter is active, require a shift in that section.
    const trainerRows = trainers.filter(t => {
      const shs = parseTeamShifts(t);
      if (!shs.length) return false;
      if (!activeSection) return true;
      return shs.some(sh => shiftSection(sh, t) === activeSection);
    });

    // Lectures in the date window — main + zoom regular. Dedup zoom by (date,time,trainer)
    // because zoom side rows are per-student (multiple rows per slot).
    const lecRaw = db.prepare(
      // Count EVERY actual session: all groups (incl. ended/removed from
      // batches), all session types & side categories, all per-student zoom
      // rows. Line scoping via lectures.line (no batches join).
      `SELECT DISTINCT l.group_name, l.date, l.time, l.duration, l.trainer, l.session_type, l.status
         FROM lectures l
         WHERE l.date BETWEEN '${fromDate}' AND '${toDate}'
         ${lineL}
         ORDER BY l.date, l.time`
    ).all();

    // Bucket lectures by trainer-key + date. Inside the bucket, dedupe by (time,duration)
    // so per-student zoom rows count once.
    const byTrainerDay = {}; // key='trainer_lc|YYYY-MM-DD' → array
    for (const l of lecRaw) {
      const k = stripParens(l.trainer).toLowerCase();
      if (!k) continue;
      const bucketKey = `${k}|${l.date}`;
      const arr = byTrainerDay[bucketKey] = byTrainerDay[bucketKey] || [];
      // dedupe by (BASE group, time, duration, type) — per-student zoom rows AND
      // rename/coordinator twins of the same session collapse to one. (booked
      // minutes are interval-merged anyway, so this only de-clutters the list.)
      if (!arr.some(x => baseGroupOf(x.group_name) === baseGroupOf(l.group_name) && x.time === l.time && x.duration === l.duration && x.session_type === l.session_type)) {
        arr.push({
          group_name: l.group_name, time: l.time, duration: l.duration,
          session_type: l.session_type, status: l.status,
        });
      }
    }

    // Extra shifts (one-off after-shift-end hour blocks) — pre-fetched for
    // the whole window so we can add them to the trainer's daily capacity
    // without an N+1 query inside the per-trainer loop. Keyed by member_id
    // + date.
    const extraByMemberDay = {};
    try {
      const extraRows = db.prepare(`
        SELECT team_member_id, date, SUM(duration_min) AS mins
          FROM team_member_extra_shifts
         WHERE date BETWEEN ? AND ?
         GROUP BY team_member_id, date
      `).all(fromDate, toDate);
      for (const r of extraRows) {
        extraByMemberDay[`${r.team_member_id}|${r.date}`] = r.mins || 0;
      }
    } catch (_) { /* table might not exist yet on first deploy */ }

    // Build response per trainer
    const out = trainerRows.map(t => {
      const tKey = stripParens(t.name).toLowerCase();
      const shifts = parseTeamShifts(t);

      // Build a one-line shift summary like "مسائي 04:00 PM-12:00 AM"
      const SHIFT_AR = { morning: 'صباحي', evening: 'مسائي' };
      const fmt12 = m => {
        if (m == null) return '';
        const mod = ((m % 1440) + 1440) % 1440;
        const h24 = Math.floor(mod / 60), mm = mod % 60;
        const ampm = h24 >= 12 ? 'PM' : 'AM';
        let h12 = h24 % 12; if (h12 === 0) h12 = 12;
        return `${String(h12).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${ampm}`;
      };
      const shiftSummary = shifts
        .map(sh => `${SHIFT_AR[sh.label] || sh.label} ${fmt12(sh.startMin)}-${fmt12(sh.endMin)}`)
        .join(' + ');

      const days = {};
      let totalAvailable = 0, totalBooked = 0, workDayCount = 0;
      let staleAfterEnd = 0;                              // phantom scheduled rows after departure (flag)
      const clampStart = trainerCountStart(t, shifts);   // count only from hire+shift start
      const clampEnd   = trainerCountEnd(t, shifts);     // drop scheduled phantom rows after departure
      for (const date of dates) {
        if (clampStart && date < clampStart) continue;   // before the trainer was hired / had a shift
        // Section-scoped shifts for this day (all shifts when no filter). When
        // a section filter is active we count ONLY the shifts in that section,
        // so a trainer who moved sections shows the right days/hours per section.
        const sectionShifts = activeSection ? shifts.filter(sh => shiftSection(sh, t) === activeSection) : shifts;
        let availMin = 0;
        for (const sh of sectionShifts) availMin += shiftMinsForDate(sh, date);
        // The section this day belongs to: the covering shift's section, else
        // (worked with no shift) the trainer's main section.
        let daySection = null;
        for (const sh of shifts) { if (shiftMinsForDate(sh, date) > 0) { daySection = shiftSection(sh, t); break; } }
        if (!daySection) daySection = t.section || 'all';
        const dayInSection = !activeSection || daySection === activeSection;
        // Extra one-off hours add to capacity only when the day is in the active section.
        const extraMin = dayInSection ? (extraByMemberDay[`${t.id}|${date}`] || 0) : 0;
        availMin += extraMin;
        const isWorkDay = availMin > 0;
        if (isWorkDay) workDayCount++;
        // Booked counts only when the day belongs to the active section.
        let lectures = dayInSection ? (byTrainerDay[`${tKey}|${date}`] || []) : [];
        // After the trainer has LEFT (all shifts ended) drop stale `مجدولة`
        // (scheduled) phantom rows dated past their departure — they're not in
        // the live sheet and falsely inflate booked. Confirmed lectures (مؤكدة)
        // are always kept, so a genuine last-day session still counts.
        if (clampEnd && date > clampEnd && lectures.length) {
          const before = lectures.length;
          lectures = lectures.filter(l => l.status !== 'مجدولة');
          staleAfterEnd += (before - lectures.length);
        }
        const voiceNotes = isWorkDay ? voiceNoteIntervalsForDate(sectionShifts, date) : [];
        // Booked = ACTUAL occupied wall-clock time (merge overlaps) — NOT the sum
        // of every session duration. Overlapping/simultaneous sessions (one
        // trainer attributed to many groups at the same time, or the same session
        // under several coordinator-name variants) count ONCE.
        const lecIntervals = lectures
          .map(l => { const st = parseTime12(l.time), du = parseDur(l.duration); return (st >= 0 && du > 0) ? [st, st + du] : null; })
          .filter(Boolean);
        const vnIntervals = voiceNotes.map(v => [v.start_min, v.end_min]);
        const bookedMin = mergeIntervalsMinutes(lecIntervals);                       // lecture occupied time
        const totalBookedMin = mergeIntervalsMinutes([...lecIntervals, ...vnIntervals]);
        const vnMin = totalBookedMin - bookedMin;                                    // voice-note time outside lectures
        const utilization = isWorkDay && availMin > 0
          ? Math.round((totalBookedMin / availMin) * 100)
          : null;
        const freeSlots = isWorkDay ? computeFreeSlots(sectionShifts, date, lectures) : [];
        const freeMin = freeSlots.reduce((s, f) => s + f.duration_min, 0);
        days[date] = {
          is_work_day: isWorkDay,
          available_min: availMin,
          booked_min: totalBookedMin,
          lecture_min: bookedMin,
          voice_note_min: vnMin,
          free_min: freeMin,
          utilization_pct: utilization,
          lectures: lectures.map(l => ({
            group_name: l.group_name, time: l.time, duration: l.duration,
            session_type: l.session_type,
          })),
          voice_notes: voiceNotes,
          free_slots: freeSlots,
        };
        totalAvailable += availMin;
        totalBooked   += totalBookedMin;
      }

      // Audit flag — used by the "trainers missing voice notes" banner.
      const hasVoiceNotes = shifts.some(sh => (sh.voiceNotes || []).length > 0);

      return {
        id: t.id,
        name: stripParens(t.name) || t.name,
        full_name: t.name,
        section: activeSection || t.section,
        status: t.status,                  // 'active' | 'inactive' — for the badge
        shift_summary: shiftSummary,
        has_voice_notes: hasVoiceNotes,
        totals: {
          available_min: totalAvailable,
          booked_min: totalBooked,
          utilization_pct: totalAvailable > 0
            ? Math.round((totalBooked / totalAvailable) * 100) : null,
          work_days: workDayCount,
          // Phantom scheduled rows excluded after this trainer's departure.
          // >0 ⇒ the live sheet still has stale rows to clean for this trainer.
          stale_after_shift_end: staleAfterEnd,
        },
        days,
      };
    })
    // Drop trainers with zero activity in the entire window. Without this,
    // deactivated trainers whose shift ended long before the filter range
    // would still appear with empty rows. We keep trainers who had EITHER
    // available capacity OR booked work (covers both: was on shift, and
    // had lectures attributed even after shift technically ended).
    .filter(t => (t.totals.available_min || 0) > 0 || (t.totals.booked_min || 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    return res.json({ dates, holiday_dates, trainers: out });
  } catch (err) {
    console.error('[reports] trainer-utilization error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/trainer-utilization-summary ────────────────────────────
// Phase 3 — aggregated dashboard:
//   • KPI summary (avg utilization, wasted hours, low/normal/high counts, trend vs previous period)
//   • Weekly timeline (12 points by default)
//   • Section averages (one entry per section)
//   • Per-trainer totals + status (low/normal/high)
//   • Smart insights (auto-generated text suggestions)
//
// Query params:
//   weeks    — integer 4..52 (default 12) — period length in weeks ending today
//   from, to — YYYY-MM-DD (optional) — explicit date range overrides `weeks`
//   section  — optional section filter (general/private/semi/phone_call/all)
//   search   — optional substring/exact name filter (matches team_members.name)
router.get('/trainer-utilization-summary', (req, res) => {
  const { weeks = '12', section = 'all', from: customFrom = '', to: customTo = '', search = '' } = req.query;
  const line = lineFilter(req);
  const lineL = buildLineFilter('l', line);
  const lineB = buildLineFilter('b', line);

  const nWeeksRequested = Math.max(4, Math.min(52, parseInt(weeks) || 12));
  // Reuse the same helpers used by trainer-utilization + find-available-trainer
  const DOW_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const HHMM = s => {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
  };
  const HHMM_END = s => { const v = HHMM(s); return v === 0 ? 1440 : v; };
  const parseRests = raw => {
    if (!raw) return [];
    let arr = raw;
    if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { return []; } }
    if (!Array.isArray(arr)) return [];
    return arr.map(r => ({ s: HHMM(r?.start), e: HHMM(r?.end) }))
      .filter(r => r.s != null && r.e != null && r.e > r.s);
  };
  const parseTime12 = t => {
    if (!t) return -1;
    const m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return -1;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (m[3]?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (m[3]?.toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  };
  const parseDur = d => {
    if (!d) return 0;
    const m = String(d).match(/(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
  };
  const getDow = s => { if (!s) return -1; return new Date(s + 'T12:00:00').getDay(); };
  const stripParens = name => String(name || '').replace(/\([^)]*\)/g, '').trim();
  const fmtISO = d => d.toISOString().slice(0, 10);

  function normalizeShift(t, sfx) {
    const shift = t['shift' + sfx];
    if (!shift) return null;
    const startMin = HHMM(t['shift' + sfx + '_start']);
    const endMin   = HHMM_END(t['shift' + sfx + '_end']);
    if (startMin == null || endMin == null) return null;
    const daysField = sfx === '' ? 'work_days' : 'shift2_work_days';
    const vnField   = sfx === '' ? 'voice_notes' : 'shift2_voice_notes';
    return {
      startMin, endMin,
      days: String(t[daysField] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      rests:      parseRests(t['shift' + sfx + '_rests']),
      voiceNotes: parseRests(t[vnField]),
      startDate:  t['shift' + sfx + '_start_date'] || null,
      endDate:    t['shift' + sfx + '_end_date']   || null,
      label:      t['shift' + sfx],
      startStr:   t['shift' + sfx + '_start'] || '',
      endStr:     t['shift' + sfx + '_end']   || '',
    };
  }
  function shiftCoversDay(sh, dateStr) {
    if (sh.startDate && dateStr < sh.startDate) return false;
    if (sh.endDate   && dateStr > sh.endDate)   return false;
    const dow = getDow(dateStr);
    const dayKey = DOW_KEYS[dow] || '';
    return sh.days.includes(dayKey);
  }
  function shiftMinsForDate(sh, dateStr) {
    if (!shiftCoversDay(sh, dateStr)) return 0;
    const dayKey = DOW_KEYS[getDow(dateStr)] || '';
    let mins = sh.endMin - sh.startMin;
    for (const r of sh.rests) {
      if (r.days && r.days.length && !r.days.includes(dayKey)) continue;   // break applies only to its days
      mins -= (r.e - r.s);
    }
    return mins > 0 ? mins : 0;
  }
  function voiceNoteMinsForDate(shifts, dateStr) {
    const dayKey = DOW_KEYS[getDow(dateStr)] || '';
    let total = 0;
    for (const sh of shifts) {
      if (!shiftCoversDay(sh, dateStr)) continue;
      for (const v of (sh.voiceNotes || [])) {
        if (v.days && v.days.length && !v.days.includes(dayKey)) continue;
        total += (v.e - v.s);
      }
    }
    return total;
  }
  // Voice-note work blocks for a date as [start,end] intervals (for merging).
  function voiceNoteIntervalsForDate(shifts, dateStr) {
    const dayKey = DOW_KEYS[getDow(dateStr)] || '';
    const out = [];
    for (const sh of shifts) {
      if (!shiftCoversDay(sh, dateStr)) continue;
      for (const v of (sh.voiceNotes || [])) {
        if (v.days && v.days.length && !v.days.includes(dayKey)) continue;
        out.push([v.s, v.e]);
      }
    }
    return out;
  }
  // Booked = ACTUAL occupied wall-clock minutes that day (lectures + voice notes),
  // overlapping/simultaneous sessions merged so they count ONCE — NOT the sum of
  // every session duration (which inflated utilization past 100%). Mirrors the
  // heatmap's booked. See mergeIntervalsMinutes().
  function bookedOccupiedForDate(lectures, shifts, dateStr) {
    const lecIv = (lectures || [])
      .map(l => { const st = parseTime12(l.time), du = parseDur(l.duration); return (st >= 0 && du > 0) ? [st, st + du] : null; })
      .filter(Boolean);
    const vnIv = voiceNoteIntervalsForDate(shifts, dateStr);
    return mergeIntervalsMinutes([...lecIv, ...vnIv]);
  }
  // Section a shift belongs to (per-shift; falls back to the trainer's main section).
  const shiftSection = (sh, trainer) =>
    (sh && sh.section) || (trainer && trainer.section) || 'all';

  // Date math: by default, current period = last N weeks ending today.
  // If `from` + `to` are provided and valid, they override the weeks preset.
  // Previous period always = same length immediately before current.
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const isValidISODate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  // Accept a custom range whenever BOTH dates are valid — regardless of order.
  // If the user enters them inverted (from > to), swap so the earlier date is
  // the start. Previously an inverted range failed the `customFrom <= customTo`
  // check and silently fell back to the weeks preset, showing a period the
  // user never asked for.
  const useCustomRange =
    customFrom && customTo && isValidISODate(customFrom) && isValidISODate(customTo);
  let currStart, currEnd, totalDays, nWeeks;
  if (useCustomRange) {
    currStart = customFrom <= customTo ? customFrom : customTo;
    currEnd   = customFrom <= customTo ? customTo   : customFrom;
    const startMs = new Date(currStart + 'T12:00:00').getTime();
    const endMs   = new Date(currEnd   + 'T12:00:00').getTime();
    totalDays = Math.round((endMs - startMs) / dayMs) + 1;
    nWeeks    = Math.max(1, Math.ceil(totalDays / 7));
  } else {
    nWeeks    = nWeeksRequested;
    totalDays = nWeeks * 7;
    currEnd   = fmtISO(today);
    currStart = fmtISO(new Date(today.getTime() - (totalDays - 1) * dayMs));
  }
  const currStartMs = new Date(currStart + 'T12:00:00').getTime();
  const prevEnd   = fmtISO(new Date(currStartMs - dayMs));
  const prevStart = fmtISO(new Date(currStartMs - totalDays * dayMs));

  // Official-holiday days are excluded from utilization (academy closed). We
  // keep currDates full so the weekly buckets stay calendar-aligned, and skip
  // holidays INSIDE totalsForRange so they add nothing to available/booked.
  const { getHolidayDateSet } = require('../utils/holidays');
  const holidaySet = getHolidayDateSet();

  // Build complete list of dates in current period (for per-week aggregation)
  const currDates = [];
  for (let i = 0; i < totalDays; i++) {
    currDates.push(fmtISO(new Date(currStartMs + i * dayMs)));
  }
  const holiday_dates = currDates.filter(d => holidaySet.has(d));
  // Build week buckets: week index = Math.floor(i / 7)
  // Week label = the Saturday of that week (compact)
  const SHORT_AR_MONTHS = ['ينا','فبر','مار','أبر','مايو','يون','يول','أغس','سبت','أكت','نوف','ديس'];
  function weekLabel(iso) {
    const [, m, d] = iso.split('-');
    return `${parseInt(d)} ${SHORT_AR_MONTHS[parseInt(m) - 1]}`;
  }

  try {
    // ── Fetch trainers + filter by section + optional name search
    // Status filter intentionally omitted (same reasoning as
    // /trainer-utilization). Deactivated trainers stay visible while they
    // had any activity in the window; they're filtered out at the totals
    // stage if they contributed nothing.
    // Do NOT filter by section in SQL — a trainer can span multiple sections
    // across the period (per-shift section). Fetch all education trainers and
    // split/filter by section at the totals stage below.
    let trainerWhere = `WHERE department='education'`;
    if (search) {
      const s = escapeLike(search);
      trainerWhere += ` AND name LIKE '%${s}%' ESCAPE '\\'`;
    }
    const trainersRaw = db.prepare(`SELECT * FROM team_members ${trainerWhere}`).all();
    // "Has any shift" must read the canonical shifts_json (not just the legacy
    // shift/shift2 columns) so trainers configured purely via shifts_json count.
    const trainers = trainersRaw.filter(t => parseTeamShifts(t).length > 0);

    // ── Fetch all lectures in [prevStart, currEnd] once
    const lecRaw = db.prepare(
      // Count EVERY actual session the trainer ran: all groups (active OR
      // ended/removed from batches), all session types (main + every side
      // category — regular, onboarding, offboarding, compensatory), and all
      // per-student zoom rows. No batches join (ended groups vanish from it);
      // line scoping is applied directly on lectures.line.
      `SELECT DISTINCT l.group_name, l.date, l.time, l.duration, l.trainer, l.session_type, l.status
         FROM lectures l
         WHERE l.date BETWEEN '${prevStart}' AND '${currEnd}'
         ${lineL}`
    ).all();

    // Index by (trainerLower|date) → list (dedup by time+duration+session_type)
    const lectureMap = {};
    for (const l of lecRaw) {
      const k = stripParens(l.trainer).toLowerCase();
      if (!k) continue;
      const key = `${k}|${l.date}`;
      const arr = lectureMap[key] = lectureMap[key] || [];
      if (!arr.some(x => x.group_name === l.group_name && x.time === l.time && x.duration === l.duration && x.session_type === l.session_type)) {
        arr.push(l);
      }
    }

    // One-off extra shifts (trainers who came back for extra hours) add to the
    // trainer's AVAILABLE capacity on that specific day — same as the heatmap
    // endpoint. Lectures taught during those hours are already in booked (no
    // shift-day restriction), so this only tops up available.
    const extraByMemberDay = {};
    try {
      db.prepare(
        `SELECT team_member_id, date, SUM(duration_min) AS mins
           FROM team_member_extra_shifts
          WHERE date BETWEEN ? AND ?
          GROUP BY team_member_id, date`
      ).all(prevStart, currEnd).forEach(r => {
        extraByMemberDay[`${r.team_member_id}|${r.date}`] = r.mins || 0;
      });
    } catch (_) { /* table may not exist on older DBs */ }

    // Helper: compute trainer's totals over a date range.
    // Voice notes count as BOOKED (productive work hours).
    // Drop phantom `مجدولة` (scheduled) rows dated after a departed trainer's
    // last shift end — they linger in the DB but aren't in the live sheet and
    // would falsely inflate booked/salary. Confirmed lectures are always kept.
    const dropPhantom = (lectures, clampEnd, date) =>
      (clampEnd && date > clampEnd)
        ? lectures.filter(l => l.status !== 'مجدولة')
        : lectures;

    function totalsForRange(trainer, shifts, dates) {
      let available = 0, booked = 0;
      const tKey = stripParens(trainer.name).toLowerCase();
      const clampStart = trainerCountStart(trainer, shifts);   // count only from hire+shift start
      const clampEnd   = trainerCountEnd(trainer, shifts);     // drop phantom rows after departure
      for (const date of dates) {
        if (holidaySet.has(date)) continue;   // official holiday → excluded from the calc
        if (clampStart && date < clampStart) continue;   // before the trainer was hired / had a shift
        let avail = 0;
        for (const sh of shifts) avail += shiftMinsForDate(sh, date);
        avail += extraByMemberDay[`${trainer.id}|${date}`] || 0;   // one-off extra hours add to capacity
        // Booked = ALL actual session minutes that day + voice notes, with NO
        // cap and NO requirement that the day be inside the trainer's shift.
        // A trainer who worked beyond their schedule (utilization can exceed
        // 100%) or on an off day is reflected fully. Available still counts
        // shift time only.
        const lectures = dropPhantom(lectureMap[`${tKey}|${date}`] || [], clampEnd, date);
        available += avail;
        booked   += bookedOccupiedForDate(lectures, shifts, date);
      }
      return { available_min: available, booked_min: booked };
    }

    // Per-SECTION totals: split a trainer's available/booked by the section each
    // shift belongs to (per-shift `section`, date-aware). Available for a day
    // goes to each covering shift's section; booked (lectures+voice) goes to
    // that day's section (the one the trainer worked that day), falling back to
    // the trainer's main section when they worked outside any shift.
    function totalsBySectionForRange(trainer, shifts, dates) {
      const map = {};
      const tKey = stripParens(trainer.name).toLowerCase();
      const clampStart = trainerCountStart(trainer, shifts);
      const clampEnd   = trainerCountEnd(trainer, shifts);
      const add = (sec, a, b) => {
        if (!map[sec]) map[sec] = { available_min: 0, booked_min: 0 };
        map[sec].available_min += a; map[sec].booked_min += b;
      };
      for (const date of dates) {
        if (holidaySet.has(date)) continue;
        if (clampStart && date < clampStart) continue;
        let daySection = null;
        for (const sh of shifts) {
          const m = shiftMinsForDate(sh, date);
          if (m > 0) { const sec = shiftSection(sh, trainer); add(sec, m, 0); if (!daySection) daySection = sec; }
        }
        const extra = extraByMemberDay[`${trainer.id}|${date}`] || 0;
        if (extra > 0) { const sec = daySection || (trainer.section || 'all'); add(sec, extra, 0); if (!daySection) daySection = sec; }
        const lectures = dropPhantom(lectureMap[`${tKey}|${date}`] || [], clampEnd, date);
        const bookedDay = bookedOccupiedForDate(lectures, shifts, date);
        if (bookedDay > 0) { const sec = daySection || (trainer.section || 'all'); add(sec, 0, bookedDay); }
      }
      return map;
    }

    // Active section filter ('all' → null = every section).
    const activeSection = (section && section !== 'all') ? String(section).toLowerCase() : null;
    // Aggregate available/booked across ALL trainers for the active section(s)
    // over the given dates — used for the KPIs, trend, and weekly timeline.
    function periodTotals(dates) {
      let A = 0, B = 0;
      for (const t of trainers) {
        const bySec = totalsBySectionForRange(t, parseTeamShifts(t), dates);
        for (const sec of Object.keys(bySec)) {
          if (activeSection && sec !== activeSection) continue;
          A += bySec[sec].available_min; B += bySec[sec].booked_min;
        }
      }
      return { available_min: A, booked_min: B };
    }

    // Build previous-period dates for trend comparison
    const prevDates = [];
    for (let i = 0; i < totalDays; i++) {
      prevDates.push(fmtISO(new Date(today.getTime() - (2 * totalDays - 1 - i) * dayMs)));
    }

    // ── Per-trainer totals over current period
    const SECTION_AR = { general:'عام', private:'خاص', semi:'شبه خاص', phone_call:'فون كول', all:'الكل' };
    const SHIFT_AR = { morning: 'صباحي', evening: 'مسائي' };
    const fmt12 = m => {
      if (m == null) return '';
      const mod = ((m % 1440) + 1440) % 1440;
      const h24 = Math.floor(mod / 60), mm = mod % 60;
      const ampm = h24 >= 12 ? 'PM' : 'AM';
      let h12 = h24 % 12; if (h12 === 0) h12 = 12;
      return `${String(h12).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${ampm}`;
    };
    // One row PER (trainer × section) — a trainer who worked in two sections
    // during the period (e.g. شبه خاص في مايو ثم خاص في يونيو) gets two rows,
    // each with that section's available/booked. Section filter applied here.
    const trainersOut = [];
    for (const t of trainers) {
      const shifts = parseTeamShifts(t);
      const currBySec = totalsBySectionForRange(t, shifts, currDates);
      const prevBySec = totalsBySectionForRange(t, shifts, prevDates);
      const shiftSummary = shifts
        .map(sh => `${SHIFT_AR[sh.label] || sh.label} ${fmt12(sh.startMin)}-${fmt12(sh.endMin)}${sh.section ? ' [' + (SECTION_AR[sh.section] || sh.section) + ']' : ''}`)
        .join(' + ');
      for (const sec of Object.keys(currBySec)) {
        const tot = currBySec[sec];
        if ((tot.available_min || 0) <= 0 && (tot.booked_min || 0) <= 0) continue;   // no activity in this section
        if (activeSection && sec !== activeSection) continue;                        // section filter
        const utilization = tot.available_min > 0
          ? Math.round((tot.booked_min / tot.available_min) * 100) : null;
        const status = utilization == null ? 'inactive'
                     : utilization < 50  ? 'low'
                     : utilization >= 90 ? 'high'
                     : 'normal';
        const pv = prevBySec[sec] || { available_min: 0, booked_min: 0 };
        trainersOut.push({
          id: t.id,
          row_key: `${t.id}-${sec}`,   // unique per trainer×section (React key — a trainer can repeat)
          name: stripParens(t.name) || t.name,
          section: sec,
          member_status: t.status,
          shift_summary: shiftSummary,
          utilization_pct: utilization,
          prev_utilization_pct: pv.available_min > 0 ? Math.round((pv.booked_min / pv.available_min) * 100) : null,
          available_hours: Math.round(tot.available_min / 60),
          booked_hours: Math.round(tot.booked_min / 60),
          free_hours: Math.max(0, Math.round((tot.available_min - tot.booked_min) / 60)),
          status,
          _avail_min: tot.available_min,
          _booked_min: tot.booked_min,
        });
      }
    }

    // ── Summary KPIs (exact minutes from the per-section rows)
    const totalAvail  = trainersOut.reduce((s, t) => s + (t._avail_min || 0), 0);
    const totalBooked = trainersOut.reduce((s, t) => s + (t._booked_min || 0), 0);
    const totalWasted = Math.max(0, totalAvail - totalBooked);
    const avgUtil = totalAvail > 0 ? Math.round((totalBooked / totalAvail) * 100) : 0;
    // Previous period avg — same section scope as the current rows.
    const prevPeriod = periodTotals(prevDates);
    const prevTotalAvail = prevPeriod.available_min, prevTotalBooked = prevPeriod.booked_min;
    // The previous period is only comparable when it had real shift coverage.
    // When shifts didn't exist yet back then (e.g. all shifts start this month),
    // prevAvail≈0 while booked>0 makes utilization explode into the thousands —
    // a meaningless "-2652%" trend. Suppress the comparison in that case
    // (prev_avg_utilization / trend_pct become null).
    const prevComparable =
      prevTotalAvail > 0 &&
      prevTotalAvail >= totalAvail * 0.2 &&
      (prevTotalBooked / prevTotalAvail) <= 1.5;
    const prevAvgUtil = prevComparable
      ? Math.round((prevTotalBooked / prevTotalAvail) * 100) : null;
    const trendPct = prevAvgUtil != null ? avgUtil - prevAvgUtil : null;

    const summary = {
      avg_utilization: avgUtil,
      prev_avg_utilization: prevAvgUtil,
      trend_pct: trendPct,
      wasted_hours: Math.round(totalWasted / 60),
      // courses-equivalent: 1 course ≈ 8 lectures × 90 min = 720 min = 12 h
      wasted_courses_eq: Math.round((totalWasted / 60) / 12),
      trainers_total: trainersOut.length,
      low_count: trainersOut.filter(t => t.status === 'low').length,
      normal_count: trainersOut.filter(t => t.status === 'normal').length,
      high_count: trainersOut.filter(t => t.status === 'high').length,
    };

    // ── Weekly timeline (over current period only).
    // Custom date ranges may not be a multiple of 7 — last bucket can be shorter.
    const weeklyTimeline = [];
    const weekChunks = Math.ceil(totalDays / 7);
    for (let w = 0; w < weekChunks; w++) {
      const wkDates = currDates.slice(w * 7, Math.min(w * 7 + 7, totalDays));
      if (wkDates.length === 0) continue;
      const wk = periodTotals(wkDates);
      const wkAvail = wk.available_min, wkBooked = wk.booked_min;
      weeklyTimeline.push({
        week_start: wkDates[0],
        label: weekLabel(wkDates[0]),
        avg_utilization: wkAvail > 0 ? Math.round((wkBooked / wkAvail) * 100) : 0,
        available_hours: Math.round(wkAvail / 60),
        booked_hours:    Math.round(wkBooked / 60),
        wasted_hours:    Math.round((wkAvail - wkBooked) / 60),
      });
    }

    // ── Section averages
    const sections = ['general','private','semi','phone_call'];
    const sectionAverages = sections.map(sec => {
      const inSec = trainersOut.filter(t => t.section === sec);
      const secAvail  = inSec.reduce((s, t) => s + (t.available_hours * 60), 0);
      const secBooked = inSec.reduce((s, t) => s + (t.booked_hours * 60), 0);
      return {
        section: sec,
        label: SECTION_AR[sec],
        avg_utilization: secAvail > 0 ? Math.round((secBooked / secAvail) * 100) : 0,
        // Raw operational vs. recorded-lecture hours per department so the UI
        // can show نسبة الإشغال = المحجوز ÷ المتاح transparently at dept level.
        available_hours: Math.round(secAvail / 60),
        booked_hours:    Math.round(secBooked / 60),
        trainer_count: inSec.length,
        wasted_hours: Math.max(0, Math.round((secAvail - secBooked) / 60)),
      };
    }).filter(s => s.trainer_count > 0);

    // ── Smart Insights — heuristic, no DB writes
    const insights = [];
    // Low utilization trainers with significant free time
    trainersOut
      .filter(t => t.status === 'low' && t.free_hours >= 10)
      .sort((a, b) => b.free_hours - a.free_hours)
      .slice(0, 5)
      .forEach(t => {
        const coursesEq = Math.floor(t.free_hours / 12); // 1 course ≈ 12 h
        insights.push({
          type: 'low_util',
          severity: 'warning',
          trainer_name: t.name,
          message: coursesEq >= 1
            ? `${t.name} عنده ${t.free_hours} ساعة فراغ — يكفي لـ ${coursesEq} ${coursesEq === 1 ? 'كورس' : 'كورسات'} جديد`
            : `${t.name} عنده ${t.free_hours} ساعة فراغ — استغلها`,
        });
      });
    // Overworked trainers
    trainersOut
      .filter(t => t.status === 'high')
      .sort((a, b) => (b.utilization_pct || 0) - (a.utilization_pct || 0))
      .slice(0, 5)
      .forEach(t => {
        insights.push({
          type: 'high_util',
          severity: 'critical',
          trainer_name: t.name,
          message: `${t.name} مكتمل ${t.utilization_pct}% — احتمال احتراق وظيفي، فكر تخفف عنه`,
        });
      });
    // Trend insight
    if (trendPct != null && Math.abs(trendPct) >= 3) {
      insights.push({
        type: trendPct > 0 ? 'trend_up' : 'trend_down',
        severity: trendPct > 0 ? 'good' : 'warning',
        message: trendPct > 0
          ? `متوسط الإشغال زاد ${Math.abs(trendPct)}% مقارنة بالفترة السابقة — تشغيل أفضل`
          : `متوسط الإشغال انخفض ${Math.abs(trendPct)}% مقارنة بالفترة السابقة — احتمال فقد فرص`,
      });
    }
    // Sort: critical first, then warning, then good
    const sevOrder = { critical: 0, warning: 1, good: 2 };
    insights.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

    // Sort trainers: low first (most free hours desc), then high (most utilized desc), then normal
    const statusOrder = { low: 0, high: 1, normal: 2, inactive: 3 };
    trainersOut.sort((a, b) => {
      const so = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (so !== 0) return so;
      if (a.status === 'low')  return b.free_hours - a.free_hours;
      if (a.status === 'high') return (b.utilization_pct || 0) - (a.utilization_pct || 0);
      return (a.name || '').localeCompare(b.name || '', 'ar');
    });

    return res.json({
      period: { from: currStart, to: currEnd, weeks: nWeeks, prev_from: prevStart, prev_to: prevEnd },
      summary,
      weekly_timeline: weeklyTimeline,
      section_averages: sectionAverages,
      trainers: trainersOut,
      insights,
      holiday_dates,   // official-holiday days excluded from this period's calc
    });
  } catch (err) {
    console.error('[reports] trainer-utilization-summary error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/find-available-trainer ─────────────────────────────────
// Phase 2 — Reverse search: given desired days + time window + course
// requirements, return list of trainers and which slots they're free for.
//
// Query params:
//   section       — 'all' | 'general' | 'private' | 'semi' | 'phone_call'
//   days          — comma-separated DOW keys, e.g. 'saturday,monday'
//   from_time     — HH:MM (24h) start of needed window
//   to_time       — HH:MM (24h) end of needed window
//   weeks_count   — integer (1..12), how many consecutive weeks to check
//   start_date    — YYYY-MM-DD optional anchor (default: this week)
//   course_family — 'starter'|'general'|'conversation' (optional)
//   course_level  — 1..5 (optional, used with course_family)
//
// Returns per-trainer availability across all (day × week) slots.
router.get('/find-available-trainer', (req, res) => {
  const {
    section = 'all',
    days = '',
    from_time = '',
    to_time = '',
    weeks_count = '1',
    start_date = '',
    course_family = '',
    course_level = '',
  } = req.query;
  const line = lineFilter(req);
  const lineL = buildLineFilter('l', line);
  const lineB = buildLineFilter('b', line);

  // Local helpers (mirror computeCodeProblems + trainer-utilization helpers)
  const DOW_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const DOW_AR   = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const DOW_TO_OFFSET = { saturday:0, sunday:1, monday:2, tuesday:3, wednesday:4, thursday:5, friday:6 };
  const HHMM = s => {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
  };
  const HHMM_END = s => { const v = HHMM(s); return v === 0 ? 1440 : v; };
  const parseRests = raw => {
    if (!raw) return [];
    let arr = raw;
    if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { return []; } }
    if (!Array.isArray(arr)) return [];
    return arr.map(r => ({ s: HHMM(r?.start), e: HHMM(r?.end) }))
      .filter(r => r.s != null && r.e != null && r.e > r.s);
  };
  const parseTime12 = t => {
    if (!t) return -1;
    const m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return -1;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (m[3]?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (m[3]?.toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  };
  const parseDur = d => {
    if (!d) return 0;
    const m = String(d).match(/(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
  };
  const getDow = s => { if (!s) return -1; return new Date(s + 'T12:00:00').getDay(); };
  const stripParens = name => String(name || '').replace(/\([^)]*\)/g, '').trim();
  const fmtISO = d => d.toISOString().slice(0, 10);

  // Validate input
  const selectedDays = String(days).split(',').map(s => s.trim().toLowerCase())
    .filter(d => DOW_KEYS.includes(d));
  if (selectedDays.length === 0) {
    return res.status(400).json({ error: 'يجب اختيار يوم واحد على الأقل من أيام الأسبوع' });
  }
  const fromMin = HHMM(from_time);
  const toMin   = HHMM_END(to_time);
  if (fromMin == null || toMin == null) {
    return res.status(400).json({ error: 'الوقت غير صحيح — استخدم HH:MM' });
  }
  if (toMin <= fromMin) {
    return res.status(400).json({ error: 'وقت النهاية يجب أن يكون بعد وقت البداية' });
  }
  const nWeeks = Math.max(1, Math.min(12, parseInt(weeks_count) || 1));
  const courseLevelN = parseInt(course_level);
  const useCourseFilter = ['starter','general','conversation'].includes(course_family)
                          && Number.isFinite(courseLevelN) && courseLevelN > 0;

  // Compute week anchor — Saturday of the week containing start_date (or today)
  const anchorDate = start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)
    ? new Date(start_date + 'T12:00:00')
    : new Date();
  anchorDate.setHours(12, 0, 0, 0);
  const anchorDow = anchorDate.getDay();          // 0=Sun..6=Sat
  const backToSat = (anchorDow + 1) % 7;          // days to go back to most recent Saturday
  const weekAnchor = new Date(anchorDate);
  weekAnchor.setDate(weekAnchor.getDate() - backToSat);

  // Build the list of slots: (date, week, day). Official-holiday days are the
  // academy's days off → excluded entirely (neither available nor unavailable).
  const { getHolidayDateSet } = require('../utils/holidays');
  const holidaySet = getHolidayDateSet();
  const slots = [];
  const excluded_holidays = [];
  for (let w = 0; w < nWeeks; w++) {
    for (const day of selectedDays) {
      const offset = DOW_TO_OFFSET[day];
      const d = new Date(weekAnchor);
      d.setDate(d.getDate() + w * 7 + offset);
      const iso = fmtISO(d);
      if (holidaySet.has(iso)) { excluded_holidays.push({ date: iso, week: w + 1, day }); continue; }
      slots.push({ date: iso, week: w + 1, day });
    }
  }

  // Trainer query
  let trainerWhere = `WHERE department='education' AND status='active'`;
  if (section && section !== 'all') {
    const s = String(section).replace(/'/g, "''");
    trainerWhere += ` AND section='${s}'`;
  }

  function normalizeShift(t, sfx) {
    const shift = t['shift' + sfx];
    if (!shift) return null;
    const startMin = HHMM(t['shift' + sfx + '_start']);
    const endMin   = HHMM_END(t['shift' + sfx + '_end']);
    if (startMin == null || endMin == null) return null;
    const daysField = sfx === '' ? 'work_days' : 'shift2_work_days';
    const vnField   = sfx === '' ? 'voice_notes' : 'shift2_voice_notes';
    const dayList = String(t[daysField] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return {
      startMin, endMin, days: dayList,
      rests:      parseRests(t['shift' + sfx + '_rests']),
      voiceNotes: parseRests(t[vnField]),
      startDate:  t['shift' + sfx + '_start_date'] || null,
      endDate:    t['shift' + sfx + '_end_date']   || null,
      label:      t['shift' + sfx],
      startStr:   t['shift' + sfx + '_start'] || '',
      endStr:     t['shift' + sfx + '_end']   || '',
    };
  }
  function shiftActiveOn(sh, dateStr) {
    if (sh.startDate && dateStr < sh.startDate) return false;
    if (sh.endDate   && dateStr > sh.endDate)   return false;
    return true;
  }
  const fmt12 = m => {
    if (m == null) return '';
    const mod = ((m % 1440) + 1440) % 1440;
    const h24 = Math.floor(mod / 60), mm = mod % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    let h12 = h24 % 12; if (h12 === 0) h12 = 12;
    return `${String(h12).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${ampm}`;
  };
  const SHIFT_AR = { morning: 'صباحي', evening: 'مسائي' };

  try {
    const trainers = db.prepare(`SELECT * FROM team_members ${trainerWhere}`).all();
    let eligible = trainers.filter(t => parseTeamShifts(t).length > 0);  // canonical shifts_json, matches the utilization endpoints
    // Optional: course capability filter
    if (useCourseFilter) {
      const col = 'teachable_' + course_family;
      eligible = eligible.filter(t => {
        const max = t[col];
        return typeof max === 'number' && max >= courseLevelN;
      });
    }

    // Date range for lecture fetch
    const allDates = slots.map(s => s.date);
    const minDate = allDates.reduce((a, b) => a < b ? a : b);
    const maxDate = allDates.reduce((a, b) => a > b ? a : b);

    // Fetch all relevant lectures once
    // Conflict lectures come straight from `lectures` (NO batches join). The old
    // INNER JOIN batches WHERE status='نشطة' silently hid every conflict whose
    // group had ended / been renamed / had a space mismatch → a busy trainer was
    // reported AVAILABLE → double-booking. Mirrors the utilization endpoints.
    const lecRaw = db.prepare(
      `SELECT DISTINCT l.group_name, l.date, l.time, l.duration, l.trainer, l.session_type
         FROM lectures l
         WHERE l.date BETWEEN '${minDate}' AND '${maxDate}'
           AND (l.session_type='main'
             OR (l.session_type='side' AND LOWER(COALESCE(l.side_session_category,'regular'))='regular'))
         ${lineL}`
    ).all();

    // Index by (trainerLower|date) → list of {time, duration, group_name, session_type}
    const lectureMap = {};
    for (const l of lecRaw) {
      const k = stripParens(l.trainer).toLowerCase();
      if (!k) continue;
      const key = `${k}|${l.date}`;
      (lectureMap[key] = lectureMap[key] || []).push(l);
    }

    // For each trainer, evaluate every slot
    const results = eligible.map(t => {
      const shifts = parseTeamShifts(t);
      const tKey = stripParens(t.name).toLowerCase();
      const earliestStart = shifts.map(s => s.startDate).filter(Boolean).sort()[0];

      const slotResults = slots.map(slot => {
        const dow = getDow(slot.date);
        const dayKey = DOW_KEYS[dow] || '';
        // Skip if before trainer's earliest shift start
        if (earliestStart && slot.date < earliestStart) {
          return { ...slot, available: false, reason: 'قبل بداية شيفت المدرب' };
        }
        // Find any shift that covers this date+day AND fits the requested window
        let suitable = null, fallbackReason = null;
        for (const sh of shifts) {
          if (!shiftActiveOn(sh, slot.date)) continue;
          if (!sh.days.includes(dayKey)) continue;
          // shift end gets the same 10-min tolerance used in code-problems
          if (fromMin < sh.startMin || toMin > sh.endMin + 10) {
            fallbackReason = `الوقت خارج الشيفت ⁦(${sh.startStr} → ${sh.endStr})⁩`;
            continue;
          }
          // Rest periods AND voice-note blocks get the same 10-min overlap
          // tolerance as shift end. Voice notes are work time but block
          // teaching slots — they can't host a new lecture.
          // Per-day scoping: a break/voice block only blocks on its own days.
          const onDay = x => !x.days || !x.days.length || x.days.includes(dayKey);
          const blocks = [
            ...sh.rests.filter(onDay).map(r => ({ s: r.s, e: r.e, type: 'rest' })),
            ...(sh.voiceNotes || []).filter(onDay).map(v => ({ s: v.s, e: v.e, type: 'voice_note' })),
          ];
          const offending = blocks.find(b => {
            const overlap = Math.min(toMin, b.e) - Math.max(fromMin, b.s);
            return overlap > 10;
          });
          if (offending) {
            const label = offending.type === 'voice_note' ? 'Voice Note' : 'راحة';
            fallbackReason = `داخل وقت ${label} ⁦(${fmt12(offending.s)} → ${fmt12(offending.e)})⁩`;
            continue;
          }
          suitable = sh;
          break;
        }
        if (!suitable) {
          // None of the trainer's shifts could host this slot
          if (!fallbackReason) fallbackReason = `${DOW_AR[dow]} مش في أيام عمل المدرب`;
          return { ...slot, available: false, reason: fallbackReason };
        }
        // Check overlap with booked lectures on this date
        const lectures = lectureMap[`${tKey}|${slot.date}`] || [];
        for (const l of lectures) {
          const lStart = parseTime12(l.time);
          const lDur   = parseDur(l.duration);
          if (lStart < 0 || lDur <= 0) continue;
          const lEnd = lStart + lDur;
          if (fromMin < lEnd && toMin > lStart) {
            return {
              ...slot,
              available: false,
              reason: `محاضرة محجوزة ${l.time}`,
              conflict: { group_name: l.group_name, time: l.time, duration: l.duration, session_type: l.session_type },
            };
          }
        }
        return { ...slot, available: true, reason: null };
      });

      const availableCount = slotResults.filter(s => s.available).length;
      const shiftSummary = shifts
        .map(sh => `${SHIFT_AR[sh.label] || sh.label} ${fmt12(sh.startMin)}-${fmt12(sh.endMin)}`)
        .join(' + ');

      return {
        id: t.id,
        name: stripParens(t.name) || t.name,
        full_name: t.name,
        section: t.section,
        shift_summary: shiftSummary,
        teachable: {
          starter:      t.teachable_starter,
          general:      t.teachable_general,
          conversation: t.teachable_conversation,
        },
        fully_available: availableCount === slotResults.length,
        partially_available: availableCount > 0 && availableCount < slotResults.length,
        available_count: availableCount,
        total_slots: slotResults.length,
        slots: slotResults,
      };
    });

    // Sort: fully available first → partial (most-to-least) → none → name
    results.sort((a, b) => {
      const aRank = a.fully_available ? 2 : a.partially_available ? 1 : 0;
      const bRank = b.fully_available ? 2 : b.partially_available ? 1 : 0;
      if (aRank !== bRank) return bRank - aRank;
      if (a.available_count !== b.available_count) return b.available_count - a.available_count;
      return a.name.localeCompare(b.name, 'ar');
    });

    return res.json({
      results,
      slots,
      excluded_holidays,   // slots dropped because they fall on an official holiday
      request: {
        section,
        days: selectedDays,
        from_time, to_time,
        weeks_count: nWeeks,
        course_family: useCourseFilter ? course_family : null,
        course_level: useCourseFilter ? courseLevelN : null,
      },
      summary: {
        total_trainers:       results.length,
        fully_available:      results.filter(r => r.fully_available).length,
        partially_available:  results.filter(r => r.partially_available).length,
        not_available:        results.filter(r => r.available_count === 0).length,
        excluded_holiday_days: excluded_holidays.length,
      },
    });
  } catch (err) {
    console.error('[reports] find-available-trainer error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/trainer-work-history ───────────────────────────────────
// Per-shift work history for education trainers within a date window.
//
// Returns ONE ROW PER SHIFT that overlaps [from, to]. A shift overlaps when:
//   shift_start_date <= to  AND  (shift_end_date IS NULL OR shift_end_date >= from)
//
// Extra hours per row = SUM(team_member_extra_shifts.duration_min) for that
// trainer where the entry's date is BOTH inside [from, to] AND inside the
// shift's own [start_date, end_date] range — so loose extras after a shift
// ended don't get attributed to an earlier shift.
//
// Query params:
//   from, to       — YYYY-MM-DD (required; defaults to current month)
//   section        — 'general' | 'private' | 'semi' | 'phone_call' | 'all' (any → no filter)
//   trainer        — exact team_members.name (any → no filter)
router.get('/trainer-work-history', (req, res) => {
  const safeDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000); // Cairo UTC+2
  const yyyy = now.getUTCFullYear();
  const mm   = String(now.getUTCMonth() + 1).padStart(2, '0');
  const monthFirst = `${yyyy}-${mm}-01`;
  const monthLast  = `${yyyy}-${mm}-${String(new Date(Date.UTC(yyyy, now.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, '0')}`;
  const from = safeDate(req.query.from) || monthFirst;
  const to   = safeDate(req.query.to)   || monthLast;
  const section = (req.query.section || '').trim();
  const trainer = (req.query.trainer || '').trim();

  const DAY_LABELS = {
    saturday: 'السبت', sunday: 'الأحد', monday: 'الاثنين',
    tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس', friday: 'الجمعة',
  };

  try {
    // Pull every active+inactive education trainer (status filter NOT applied;
    // the report shows everyone whose shifts overlap the window, including
    // recently-deactivated ones, with their status as a column).
    let where = `WHERE department='education'`;
    const params = [];
    if (section && section !== 'all') { where += ` AND section = ?`; params.push(section); }
    if (trainer)                       { where += ` AND name = ?`;    params.push(trainer); }
    const trainers = db.prepare(
      `SELECT id, name, section, status, shifts_json,
              shift,  shift_start,  shift_end,  shift_rests,  voice_notes,
              employment_type,  work_days,  shift_start_date,  shift_end_date,
              shift2, shift2_start, shift2_end, shift2_rests, shift2_voice_notes,
              shift2_employment_type, shift2_work_days, shift2_start_date, shift2_end_date
         FROM team_members ${where}
         ORDER BY name COLLATE NOCASE`
    ).all(...params);

    // Sum extra-shift minutes per (trainer_id, date) within the window once,
    // then bucket per shift in JS based on the shift's own date range.
    const extrasRows = db.prepare(
      `SELECT team_member_id, date, duration_min
         FROM team_member_extra_shifts
        WHERE date BETWEEN ? AND ?`
    ).all(from, to);
    const extrasByMember = new Map();
    for (const e of extrasRows) {
      if (!extrasByMember.has(e.team_member_id)) extrasByMember.set(e.team_member_id, []);
      extrasByMember.get(e.team_member_id).push(e);
    }

    // Unconfirmed lectures in the window — bucketed per trainer (matched by
    // parenthesis-stripped name, since lectures.trainer often has suffixes
    // like "(Group)" while team_members.name has "(Private)" etc).
    const unconfirmedRows = db.prepare(
      `SELECT trainer, date, duration
         FROM lectures
        WHERE status = 'غير مؤكدة'
          AND date BETWEEN ? AND ?
          AND group_name NOT LIKE '%Voice Note%'
          AND group_name NOT LIKE '%Break%'
          AND group_name NOT LIKE '%Test%'`
    ).all(from, to);
    const stripParens = (s) => String(s || '').replace(/\([^)]*\)/g, '').trim().toLowerCase();
    const parseDurationMin = (s) => {
      if (!s) return 0;
      const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
      return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
    };
    const unconfirmedByTrainer = new Map();
    for (const l of unconfirmedRows) {
      const key = stripParens(l.trainer);
      if (!key) continue;
      if (!unconfirmedByTrainer.has(key)) unconfirmedByTrainer.set(key, []);
      unconfirmedByTrainer.get(key).push({ date: l.date, minutes: parseDurationMin(l.duration) });
    }

    const rows = [];
    let totalExtraMin = 0;
    let totalUnconfirmedMin = 0;
    const trainerIdsSeen = new Set();

    for (const t of trainers) {
      // Read shifts: prefer shifts_json, fall back to legacy columns.
      let shifts = null;
      if (t.shifts_json) {
        try { shifts = JSON.parse(t.shifts_json); } catch { shifts = null; }
      }
      if (!Array.isArray(shifts) || shifts.length === 0) {
        shifts = [];
        if (t.shift) shifts.push({
          shift: t.shift, start: t.shift_start, end: t.shift_end,
          rests: t.shift_rests, voice_notes: t.voice_notes,
          employment_type: t.employment_type, work_days: t.work_days,
          start_date: t.shift_start_date, end_date: t.shift_end_date,
        });
        if (t.shift2) shifts.push({
          shift: t.shift2, start: t.shift2_start, end: t.shift2_end,
          rests: t.shift2_rests, voice_notes: t.shift2_voice_notes,
          employment_type: t.shift2_employment_type, work_days: t.shift2_work_days,
          start_date: t.shift2_start_date, end_date: t.shift2_end_date,
        });
      }

      const memberExtras       = extrasByMember.get(t.id) || [];
      const memberUnconfirmed  = unconfirmedByTrainer.get(stripParens(t.name)) || [];

      // Overall (aggregated) employment type: union of work_days across ALL
      // configured shifts. A trainer with 2 Part-Time shifts whose days union
      // to a full week is reported as Full Time (split=true) so reports
      // surface the real coverage instead of the per-shift label.
      const overall = computeOverallEmployment(shifts);

      // Build rows for shifts that overlap the window. Extra minutes are
      // attributed AFTER the loop so we can correctly route extras that
      // happened AFTER a shift's end_date back to that same shift (the
      // common "trainer ended on 21/5 but came back 24/5 for 4h" case).
      const memberRows = [];
      shifts.forEach((sh, idx) => {
        if (!sh || !sh.shift || !sh.start_date) return;
        const shStart = sh.start_date;
        const shEnd   = sh.end_date || '9999-12-31';
        // Overlap test against the report window.
        if (shStart > to || shEnd < from) return;

        const daysList = String(sh.work_days || '')
          .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
        const daysAr = daysList.map(d => DAY_LABELS[d] || d).join('، ');

        memberRows.push({
          trainer_id:   t.id,
          trainer_name: t.name,
          section:      t.section,
          status:       t.status,
          shift_index:  idx + 1,
          shift_kind:   sh.shift,                    // 'morning' | 'evening'
          shift_start:  sh.start || '',              // HH:MM
          shift_end:    sh.end   || '',              // HH:MM
          start_date:   sh.start_date,
          end_date:     sh.end_date,                 // null = ongoing
          work_days:    daysList.join(','),
          work_days_ar: daysAr,
          employment_type: sh.employment_type || null,
          salary_category: sh.salary_category || null,
          overall_employment_type:    overall.type,
          overall_employment_split:   overall.split,
          overall_days_covered:       overall.days_covered,
          overall_uniform_times:      overall.uniform_times,
          extra_minutes:       0,   // filled below
          unconfirmed_minutes: 0,   // filled below
        });
        trainerIdsSeen.add(t.id);
      });

      // Attribute each extra-shift entry to a row. Rule: the LATEST shift
      // whose start_date <= extra.date wins. If the extra is after that
      // shift's end_date, it still belongs to that shift (use case: "came
      // back for 4h on 24/5 even though shift ended 21/5"). If no shift
      // started on/before the extra's date, fall back to the earliest row
      // so the hours are at least visible somewhere.
      if (memberRows.length > 0) {
        // Window-filtered extras only — extras outside [from,to] are out of
        // scope for this report.
        const inWindow = memberExtras.filter(e => e.date >= from && e.date <= to);
        // Pre-sort rows by start_date asc for the fallback path.
        const sortedRowsAsc = [...memberRows].sort(
          (a, b) => String(a.start_date).localeCompare(String(b.start_date))
        );
        for (const e of inWindow) {
          // Latest shift that started on/before this extra's date
          let owner = null;
          for (const row of sortedRowsAsc) {
            if (row.start_date <= e.date) owner = row;
          }
          // If no shift started on/before this date, attribute to the
          // earliest known shift (the only sensible bucket we have).
          const targetRow = owner || sortedRowsAsc[0];
          targetRow.extra_minutes += (e.duration_min || 0);
          totalExtraMin += (e.duration_min || 0);
        }
        // Same attribution rule for unconfirmed-lecture hours: assign each
        // lecture to the latest shift that started on/before its date.
        const ucInWindow = memberUnconfirmed.filter(l => l.date >= from && l.date <= to);
        for (const l of ucInWindow) {
          let owner = null;
          for (const row of sortedRowsAsc) {
            if (row.start_date <= l.date) owner = row;
          }
          const targetRow = owner || sortedRowsAsc[0];
          targetRow.unconfirmed_minutes += (l.minutes || 0);
          totalUnconfirmedMin += (l.minutes || 0);
        }
      }

      rows.push(...memberRows);
    }

    // Official-holiday days inside the window — surfaced so the UI can mark
    // them and never count them as absence / missing hours against a trainer.
    const { getHolidayDateSet } = require('../utils/holidays');
    const holiday_dates = [...getHolidayDateSet()].filter(d => d >= from && d <= to).sort();

    return res.json({
      rows,
      summary: {
        trainers_count:        trainerIdsSeen.size,
        shifts_count:          rows.length,
        total_extra_min:       totalExtraMin,
        total_unconfirmed_min: totalUnconfirmedMin,
      },
      window: { from, to },
      holiday_dates,
    });
  } catch (err) {
    console.error('[reports] trainer-work-history error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/trainer-work-history/unconfirmed ───────────────────────
// Backs the click-through drill-down on the "ساعات غير مؤكدة" cell.
// Returns the individual unconfirmed lectures making up that cell's total.
//
// Query params:
//   trainer       — full team_members.name (paren suffix is stripped before
//                   matching against lectures.trainer)
//   from, to      — the report's main date window
//   shift_start   — the SHIFT's start_date (optional)
//   shift_end     — the SHIFT's end_date (optional; null = still active)
//
// Returns lectures whose date is within BOTH windows (report ∩ shift).
router.get('/trainer-work-history/unconfirmed', (req, res) => {
  const safeDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  const stripParens = (s) => String(s || '').replace(/\([^)]*\)/g, '').trim().toLowerCase();
  const trainerName = (req.query.trainer || '').trim();
  const from        = safeDate(req.query.from);
  const to          = safeDate(req.query.to);
  if (!trainerName || !from || !to) {
    return res.status(400).json({ error: 'trainer, from, to are required' });
  }
  const shiftStart = safeDate(req.query.shift_start) || from;
  const shiftEnd   = safeDate(req.query.shift_end)   || to;
  const winLo = shiftStart > from ? shiftStart : from;
  const winHi = shiftEnd   < to   ? shiftEnd   : to;

  try {
    const allRows = db.prepare(
      `SELECT group_name, date, time, duration, trainer, session_type
         FROM lectures
        WHERE status = 'غير مؤكدة'
          AND date BETWEEN ? AND ?
          AND group_name NOT LIKE '%Voice Note%'
          AND group_name NOT LIKE '%Break%'
          AND group_name NOT LIKE '%Test%'
        ORDER BY date ASC, time ASC`
    ).all(winLo, winHi);
    const target = stripParens(trainerName);
    const lectures = allRows
      .filter(r => stripParens(r.trainer) === target)
      .map(r => ({
        group_name:   r.group_name,
        date:         r.date,
        time:         r.time,
        duration:     r.duration,
        session_type: r.session_type,
        trainer:      r.trainer,
      }));
    return res.json({ trainer: trainerName, window: { from: winLo, to: winHi }, lectures });
  } catch (err) {
    console.error('[reports] trainer-work-history/unconfirmed error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-notes-options ──────────────────────────────────
// Returns dropdown options for coordinator, category, assigned_to
router.get('/remarks-notes-options', (req, res) => {
  const line = lineFilter(req);
  const lineBatches = buildLineFilter('batches', line);
  const lineRemarks = buildLineFilter('remarks', line);
  try {
    const coordinators = db.prepare(
      `SELECT DISTINCT TRIM(coordinators) as val FROM batches
       WHERE coordinators IS NOT NULL AND TRIM(coordinators) != ''${lineBatches}
       ORDER BY val`
    ).all().map(r => r.val);

    const categories = db.prepare(
      `SELECT DISTINCT TRIM(category) as val FROM remarks
       WHERE category IS NOT NULL AND TRIM(category) != ''${lineRemarks}
       ORDER BY val`
    ).all().map(r => r.val);

    const assignedTo = db.prepare(
      `SELECT DISTINCT TRIM(assigned_to) as val FROM remarks
       WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) != ''${lineRemarks}
       ORDER BY val`
    ).all().map(r => r.val);

    // Active Customer-Services coordinators straight from فريق العمل (team_members).
    // The reports match the `employee`/`coordinator` filter against
    // coordinator_history.coordinator, which stores the TEAM name (e.g. "Malika7",
    // not the user's full_name "Malika Dardasha") — so sourcing the dropdown here
    // guarantees every option matches real data, and excludes inactive staff.
    let teamCoordinators = [];
    try {
      teamCoordinators = db.prepare(
        `SELECT TRIM(tm.name) AS name, tm.line AS line
           FROM team_members tm
          WHERE tm.department = 'customer_services'
            AND tm.status = 'active'
            AND tm.name IS NOT NULL AND TRIM(tm.name) != ''${buildLineFilter('tm', line)}
          ORDER BY tm.name`
      ).all();
    } catch (_) { /* table/columns may differ — fall back to empty */ }

    return res.json({ coordinators, categories, assignedTo, teamCoordinators });
  } catch (err) {
    console.error('[reports] remarks-notes-options error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── TEAM SUMMARY FILTER HELPERS ─────────────────────────────────────────────
function tsFilters(q) {
  const { from_date, to_date, department } = q;
  const deptF  = buildDeptFilter('b', department);
  const dateA  = from_date ? ` AND a.date >= '${from_date}'` : '';
  const dateAe = to_date   ? ` AND a.date <= '${to_date}'`   : '';
  const dateL  = from_date ? ` AND l.date >= '${from_date}'` : '';
  const dateLe = to_date   ? ` AND l.date <= '${to_date}'`   : '';
  const dateR  = from_date ? ` AND r2.added_at >= '${from_date}'` : '';
  const dateRe = to_date   ? ` AND r2.added_at <= '${to_date}'`   : '';
  return { deptF, dateA: dateA+dateAe, dateL: dateL+dateLe, dateR: dateR+dateRe };
}

// ─── GET /api/reports/team-summary-detail ────────────────────────────────────
router.get('/team-summary-detail', (req, res) => {
  const { employee, metric, from_date, to_date, department } = req.query;
  if (!employee || !metric) return res.status(400).json({ error: 'employee and metric required' });
  const line = lineFilter(req);
  const lineBatches = buildLineFilter('batches', line);
  const lineB = buildLineFilter('b', line);
  const lineL = buildLineFilter('l', line);
  const lineA = buildLineFilter('a', line);
  const lineRemarks = buildLineFilter('', line);
  const { deptF, dateA, dateL, dateR } = tsFilters(req.query);
  const empFBatches = buildCoordFilter('batches', employee);    // current state (expired_groups: who owns NOW)
  // Date-aware variants: pick correct event-row aliases per metric below
  const empFB_aDate = coordFilterAtDate('a.group_name', 'a.line', 'a.date', employee);
  const empFB_lDate = coordFilterAtDate('l.group_name', 'l.line', 'l.date', employee);
  const empFRemarks = employee ? ` AND ${nameInListInline('assigned_to', employee)}` : '';

  try {
    let rows = [];

    if (metric === 'expired_groups') {
      rows = db.prepare(
        `SELECT group_name, end_date, dept_type, trainee_count
         FROM batches
         WHERE status='نشطة'
           AND end_date IS NOT NULL AND end_date != ''
           AND end_date <= date('now')
           ${empFBatches}
           ${deptF.replace('b.','').replace('AND b.','AND ')}${lineBatches}
         ORDER BY end_date ASC`
      ).all();

    } else if (metric === 'overdue_remarks') {
      const dateRBase = from_date ? ` AND added_at >= '${from_date}'` : '';
      const dateREnd  = to_date   ? ` AND added_at <= '${to_date}'`   : '';
      // remark added_at / last_updated are "DD/MM/YYYY, HH:MM AM/PM" — convert inline
      const RJD = (col) => `julianday(
        substr(${col},7,4) || '-' || substr(${col},4,2) || '-' || substr(${col},1,2) || ' ' ||
        printf('%02d', CASE
          WHEN UPPER(substr(${col},19,2)) = 'PM' AND CAST(substr(${col},13,2) AS INTEGER) < 12
            THEN CAST(substr(${col},13,2) AS INTEGER) + 12
          WHEN UPPER(substr(${col},19,2)) = 'AM' AND CAST(substr(${col},13,2) AS INTEGER) = 12
            THEN 0
          ELSE CAST(substr(${col},13,2) AS INTEGER)
        END) || ':' || substr(${col},16,2) || ':00'
      )`;
      rows = db.prepare(
        `SELECT id, client_name, client_phone, details, priority, status,
           added_at, last_updated,
           ROUND((julianday('now') - ${RJD('added_at')}) * 24, 1) as hours_open
         FROM remarks
         WHERE status != 'إنتهت'
           ${empFRemarks}
           ${dateRBase}${dateREnd}${lineRemarks}
           AND ROUND((julianday('now') - ${RJD('added_at')}) * 24, 1) >=
               CASE WHEN priority='عاجلة' THEN 3
                    WHEN priority='هامة'  THEN 24
                    ELSE 48 END
           AND (last_updated IS NULL OR last_updated = ''
             OR ROUND((julianday('now') - ${RJD('last_updated')}) * 24, 1) >= 24)
         ORDER BY hours_open DESC`
      ).all();

    } else if (metric === 'main_absence_no_remark') {
      rows = db.prepare(
        `SELECT DISTINCT a.student_name, a.phone, a.group_name, a.date
         FROM absent_students a
         INNER JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
         WHERE 1=1
           ${empFB_aDate}
           ${deptF}${dateA}${lineA}
           AND a.phone IS NOT NULL AND TRIM(a.phone) != ''
           AND NOT EXISTS (
             SELECT 1 FROM remarks r
             WHERE r.client_phone = a.phone
               AND r.category = 'Attendance Main Session'
               AND LOWER(r.status) NOT IN ('closed','مغلق','resolved')${line ? ' AND r.line = a.line' : ''}
           )
         ORDER BY a.group_name, a.date DESC`
      ).all();

    } else if (metric === 'side_absence_no_remark') {
      // Prefer absent_zoom_students (uploaded file); fallback to lectures-based.
      const hasZoomData = db.prepare(
        `SELECT EXISTS(SELECT 1 FROM absent_zoom_students${line ? ` WHERE line = '${line.replace(/'/g, "''")}'` : ''}) as has_data`
      ).get()?.has_data;

      if (hasZoomData) {
        rows = db.prepare(
          `SELECT DISTINCT a.student_name, a.phone, a.group_name, a.date
           FROM absent_zoom_students a
           INNER JOIN batches b ON REPLACE(a.group_name,' ','') = REPLACE(b.group_name,' ','')${line ? ' AND b.line = a.line' : ''}
           WHERE 1=1
             ${empFB_aDate}
             ${deptF}${dateA}${lineA}
             AND a.phone IS NOT NULL AND TRIM(a.phone) != ''
             AND NOT EXISTS (
               SELECT 1 FROM remarks r
               WHERE r.client_phone = a.phone
                 AND r.category = 'Attendance Zoom Call'${line ? ' AND r.line = a.line' : ''}
             )
           ORDER BY a.group_name, a.date DESC`
        ).all();
      } else {
        rows = db.prepare(
          `SELECT DISTINCT l.group_name, l.date, b.trainee_count,
             CAST(l.attendance AS INTEGER) as attendance
           FROM lectures l
           INNER JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
           WHERE 1=1
             ${empFB_lDate}
             ${deptF}${dateL}${lineL}
             AND l.session_type = 'side'
             AND l.side_session_category = 'regular'
             AND l.status != 'غير مؤكدة'
             AND l.attendance IS NOT NULL
             AND CAST(l.attendance AS INTEGER) < b.trainee_count
             AND b.trainee_count > 0
             AND NOT EXISTS (
               SELECT 1 FROM remarks r
               INNER JOIN clients c ON r.client_phone = c.phone${line ? ' AND c.line = r.line' : ''}
               WHERE c.group_name = l.group_name
                 AND r.category = 'Attendance Zoom Call'
                 AND LOWER(r.status) NOT IN ('closed','مغلق','resolved')${line ? ' AND r.line = l.line' : ''}
             )
           ORDER BY l.group_name, l.date DESC`
        ).all();
      }

    } else if (metric === 'groups_with_errors') {
      // Use the SAME logic as Code Repair Reports — return all problem rows
      // for this employee (mirrors what the Code Repair page shows them).
      const cp = computeCodeProblems({
        department, employee, line, user: req.user, showResolved: false,
      });
      const all = [...cp.mainProblems, ...cp.zoomProblems];
      const needle = (employee || '').toLowerCase();
      rows = all
        .filter(p => (p.coordinators || '').toLowerCase().includes(needle))
        .map(p => ({
          group_name: p.group_name,
          dept_type:  p.dept_type,
          problem_type: p.problem_type,
          detail:     p.detail,
          first_date: p.first_date,
        }));
    }

    return res.json({ employee, metric, rows });
  } catch (err) {
    console.error('[reports] team-summary-detail error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/team-summary ──────────────────────────────────────────
// Returns per-employee metrics — supports from_date, to_date, department, employee filters
router.get('/team-summary', (req, res) => {
  const { from_date, to_date, department, employee: empFilter } = req.query;
  const line = lineFilter(req);
  const lineBatches = buildLineFilter('', line);
  const lineRemarks = buildLineFilter('', line);
  const lineB = buildLineFilter('b', line);
  const lineL = buildLineFilter('l', line);
  const lineA = buildLineFilter('a', line);
  const { deptF, dateA, dateL } = tsFilters(req.query);
  const dateRBase = from_date ? ` AND added_at >= '${from_date}'` : '';
  const dateREnd  = to_date   ? ` AND added_at <= '${to_date}'`   : '';
  // deptFNoB: strip ALL "b." prefixes from deptF so the filter can be used
  // in queries that reference `batches` without an alias. Bug fix: the old
  // version only handled one occurrence and missed `b.coordinators` inside
  // the EXISTS subquery → "no such column: b.coordinators" 500 error.
  const deptFNoB  = deptF.replace(/\bb\./g, '');

  try {
    // Filter team members by name if employee filter set
    const empWhere = empFilter ? ` AND LOWER(name) LIKE LOWER('%${empFilter}%')` : '';
    const members = db.prepare(
      `SELECT id, name, department, section, job_title
       FROM team_members
       WHERE department IN ('customer_services', 'appointments')
         AND status = 'active'
         ${empWhere}
       ORDER BY department, section, name`
    ).all();

    const stmtExpired = db.prepare(
      `SELECT COUNT(*) as cnt FROM batches
       WHERE status='نشطة'
         AND end_date IS NOT NULL AND end_date != ''
         AND end_date <= date('now')
         AND coordinators LIKE ?
         ${deptFNoB}${lineBatches}`
    );

    // remark added_at / last_updated are stored as "DD/MM/YYYY, HH:MM AM/PM"
    // (the Arabic Excel format). julianday() needs ISO format — convert inline.
    const RJD = (col) => `julianday(
      substr(${col},7,4) || '-' || substr(${col},4,2) || '-' || substr(${col},1,2) || ' ' ||
      printf('%02d', CASE
        WHEN UPPER(substr(${col},19,2)) = 'PM' AND CAST(substr(${col},13,2) AS INTEGER) < 12
          THEN CAST(substr(${col},13,2) AS INTEGER) + 12
        WHEN UPPER(substr(${col},19,2)) = 'AM' AND CAST(substr(${col},13,2) AS INTEGER) = 12
          THEN 0
        ELSE CAST(substr(${col},13,2) AS INTEGER)
      END) || ':' || substr(${col},16,2) || ':00'
    )`;

    const stmtOverdue = db.prepare(
      `SELECT COUNT(*) as cnt FROM remarks
       WHERE status != 'إنتهت'
         AND assigned_to LIKE ?
         ${dateRBase}${dateREnd}${lineRemarks}
         AND ROUND((julianday('now') - ${RJD('added_at')}) * 24, 1) >=
             CASE WHEN priority='عاجلة' THEN 3
                  WHEN priority='هامة'  THEN 24
                  ELSE 48
             END
         AND (last_updated IS NULL OR last_updated = ''
           OR ROUND((julianday('now') - ${RJD('last_updated')}) * 24, 1) >= 24)`
    );

    // Date-aware: attribute each absence to whoever was coordinator on a.date.
    // The `?` is bound to the exact coordinator name (not LIKE wildcard).
    const stmtMainAbsence = db.prepare(
      `SELECT COUNT(*) as cnt
       FROM absent_students a
       INNER JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
       WHERE 1=1
         ${coordFilterAtDatePrepared('a.group_name', 'a.line', 'a.date')}
         ${deptF}${dateA}${lineA}
         AND a.phone IS NOT NULL AND TRIM(a.phone) != ''
         AND NOT EXISTS (
           SELECT 1 FROM remarks r
           WHERE r.client_phone = a.phone
             AND r.category = 'Attendance Main Session'
             AND LOWER(r.status) NOT IN ('closed','مغلق','resolved')${line ? ' AND r.line = a.line' : ''}
         )`
    );

    // side_absence_no_remark — prefer absent_zoom_students (the new uploaded
    // file), fall back to lectures-based calculation if no data uploaded yet.
    const hasZoomAbsentDataTS = db.prepare(
      `SELECT EXISTS(SELECT 1 FROM absent_zoom_students${line ? ` WHERE line = '${line.replace(/'/g, "''")}'` : ''}) as has_data`
    ).get()?.has_data;

    const stmtSideAbsence = hasZoomAbsentDataTS
      ? db.prepare(
        // NEW: count rows from absent_zoom_students that have NO matching
        // 'Attendance Zoom Call' remark — mirrors stmtMainAbsence semantics.
        // Date-aware: coordinator-on-a.date drives attribution.
        `SELECT COUNT(*) as cnt
         FROM absent_zoom_students a
         INNER JOIN batches b ON REPLACE(a.group_name,' ','') = REPLACE(b.group_name,' ','')${line ? ' AND b.line = a.line' : ''}
         WHERE 1=1
           ${coordFilterAtDatePrepared('a.group_name', 'a.line', 'a.date')}
           ${deptF}${dateA}${lineA}
           AND a.phone IS NOT NULL AND TRIM(a.phone) != ''
           AND NOT EXISTS (
             SELECT 1 FROM remarks r
             WHERE r.client_phone = a.phone
               AND r.category = 'Attendance Zoom Call'${line ? ' AND r.line = a.line' : ''}
           )`
      )
      : db.prepare(
        // FALLBACK: original lectures-based calculation, date-aware on l.date
        `SELECT COUNT(*) as cnt FROM (
           SELECT DISTINCT l.group_name, l.date
           FROM lectures l
           INNER JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
           WHERE 1=1
             ${coordFilterAtDatePrepared('l.group_name', 'l.line', 'l.date')}
             ${deptF}${dateL}${lineL}
             AND l.session_type = 'side'
             AND l.side_session_category = 'regular'
             AND l.status != 'غير مؤكدة'
             AND l.attendance IS NOT NULL
             AND CAST(l.attendance AS INTEGER) < b.trainee_count
             AND b.trainee_count > 0
             AND NOT EXISTS (
               SELECT 1 FROM remarks r
               INNER JOIN clients c ON r.client_phone = c.phone${line ? ' AND c.line = r.line' : ''}
               WHERE c.group_name = l.group_name
                 AND r.category = 'Attendance Zoom Call'
                 AND LOWER(r.status) NOT IN ('closed','مغلق','resolved')${line ? ' AND r.line = l.line' : ''}
             )
         )`
      );

    // groups_with_errors: use the SAME logic as Code Repair Reports (/code-problems)
    // so the per-employee count matches what's shown there. Computed once per request,
    // then matched per member via case-insensitive coordinator substring (mirrors the
    // LIKE '%name%' behavior used by all other metrics in this endpoint).
    let codeProblemsList = [];
    try {
      const cp = computeCodeProblems({
        department, employee: empFilter, line, user: req.user, showResolved: false,
      });
      codeProblemsList = [...cp.mainProblems, ...cp.zoomProblems];
    } catch (e) {
      console.error('[team-summary] computeCodeProblems error:', e.message);
    }
    const countProblemsForName = (name) => {
      if (!name) return 0;
      const needle = name.toLowerCase();
      let cnt = 0;
      for (const p of codeProblemsList) {
        if ((p.coordinators || '').toLowerCase().includes(needle)) cnt++;
      }
      return cnt;
    };

    const result = members.map(m => {
      const like = `%${m.name}%`;
      // Absence statements use the date-aware history (exact match on name);
      // expired/overdue still operate on current state (LIKE substring).
      return {
        id:                    m.id,
        name:                  m.name,
        department:            m.department,
        section:               m.section,
        job_title:             m.job_title,
        expired_groups:        stmtExpired.get(like)?.cnt     ?? 0,
        overdue_remarks:       stmtOverdue.get(like)?.cnt     ?? 0,
        main_absence_no_remark:stmtMainAbsence.get(m.name)?.cnt ?? 0,
        side_absence_no_remark:stmtSideAbsence.get(m.name)?.cnt ?? 0,
        groups_with_errors:    countProblemsForName(m.name),
      };
    });

    return res.json(result);
  } catch (err) {
    console.error('[reports] team-summary error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/problem-statuses ───────────────────────────────────────
router.get('/problem-statuses', (req, res) => {
  const line = lineFilter(req);
  const linePs = buildLineFilter('ps', line);
  try {
    const rows = db.prepare(
      `SELECT ps.*, u.full_name as updated_by_name
       FROM code_problem_status ps
       LEFT JOIN users u ON ps.updated_by = u.id
       WHERE 1=1${linePs}
       ORDER BY ps.updated_at DESC`
    ).all();
    return res.json(rows);
  } catch (err) {
    console.error('[reports] problem-statuses error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/reports/problem-status (upsert) ────────────────────────────────
// Problem types that REQUIRE new_group_code when status is resolved/wont_repeat/exception
const RENAME_REQUIRED_TYPES = new Set([
  'تاريخ أول محاضرة غلط',
  'محاضرات على أيام غلط',
]);
// Statuses that allow (and sometimes require) entering new_group_code
const RENAME_ALLOWED_STATUSES = new Set(['resolved', 'wont_repeat', 'exception']);
// Valid group code regex: Month(3 letters)_Day_Weekday_...(Trainer)[Coordinator]
// Suffix بعد القوس الأخير اختياري — مجموعات Conversation/Dardasha بنمط
// "..._SP_D(Trainer)" ما عندهاش اسم منسق بعد القوس، فاستخدمنا .* بدل .+
const GROUP_CODE_REGEX = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)_\d{1,2}_(Sat|Sun|Mon|Tue|Wed|Thu|Fri)_.+\(.+\).*$/;

router.put('/problem-status', (req, res) => {
  const { group_name, problem_type, session_type = 'main', status, note, actual, new_group_code, line: bodyLine } = req.body;
  if (!group_name || !problem_type || !status)
    return res.status(400).json({ error: 'group_name, problem_type, status required' });
  const validStatuses = ['new', 'reported', 'in_progress', 'exception', 'wont_repeat', 'resolved'];
  if (!validStatuses.includes(status))
    return res.status(400).json({ error: 'Invalid status' });

  // Resolve effective line:
  //  - 'All' admins can target a specific line via body.line (else fallback to existing row's line, else 'Ahmed Hassan')
  //  - Non-'All' users are ALWAYS locked to their own line
  const userLine = req.user?.line || 'Ahmed Hassan';
  let effectiveLine;
  if (userLine === 'All') {
    const validLines = ['Ahmed Hassan', 'Dardasha'];
    if (bodyLine && validLines.includes(bodyLine)) {
      effectiveLine = bodyLine;
    } else {
      // Fallback: look up existing row across lines and keep its line
      const existing = db.prepare(
        `SELECT line FROM code_problem_status WHERE group_name=? AND problem_type=? AND session_type=? LIMIT 1`
      ).get(group_name, problem_type, session_type);
      effectiveLine = existing?.line || 'Ahmed Hassan';
    }
  } else {
    effectiveLine = userLine;
  }

  // new_group_code handling
  let newCodeValue = null;
  if (RENAME_ALLOWED_STATUSES.has(status)) {
    const trimmed = (new_group_code || '').trim();
    // Required for certain problem types
    if (RENAME_REQUIRED_TYPES.has(problem_type) && !trimmed) {
      return res.status(400).json({
        error: 'يجب إدخال الكود الجديد لأن نوع المشكلة من النوع الذي يتطلب تعديل الاسم'
      });
    }
    // Validate format if provided
    if (trimmed) {
      if (!GROUP_CODE_REGEX.test(trimmed)) {
        return res.status(400).json({
          error: 'صيغة الكود الجديد غير صحيحة. مثال: May_23_Sat_6PM_General2_P(nada)mostafa'
        });
      }
      newCodeValue = trimmed;
    }
  }
  // For non-resolution statuses, new_group_code is always null (doesn't apply)

  // Store actual count only when marking as wont_repeat or exception
  const actualAtStatus = (status === 'wont_repeat' || status === 'exception' || status === 'resolved') && actual != null
    ? actual : null;
  try {
    db.prepare(`
      INSERT INTO code_problem_status (group_name, problem_type, session_type, status, note, actual_at_status, new_group_code, updated_by, updated_at, line)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?)
      ON CONFLICT(group_name, problem_type, session_type, line) DO UPDATE SET
        status           = excluded.status,
        note             = excluded.note,
        actual_at_status = excluded.actual_at_status,
        new_group_code   = excluded.new_group_code,
        updated_by       = excluded.updated_by,
        updated_at       = excluded.updated_at
    `).run(group_name, problem_type, session_type, status, note ?? null, actualAtStatus, newCodeValue, req.user?.id ?? null, effectiveLine);

    const row = db.prepare(
      `SELECT ps.*, u.full_name as updated_by_name
       FROM code_problem_status ps LEFT JOIN users u ON ps.updated_by = u.id
       WHERE ps.group_name=? AND ps.problem_type=? AND ps.session_type=? AND ps.line=?`
    ).get(group_name, problem_type, session_type, effectiveLine);
    return res.json(row);
  } catch (err) {
    console.error('[reports] problem-status upsert error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/group-trainees?group_name=xxx ──────────────────────────
router.get('/group-trainees', (req, res) => {
  const { group_name } = req.query;
  if (!group_name) return res.status(400).json({ error: 'group_name required' });
  const line = lineFilter(req);
  const lineClients = buildLineFilter('', line);
  try {
    const trainees = db.prepare(
      `SELECT name, phone FROM clients WHERE group_name = ?${lineClients} ORDER BY name ASC`
    ).all(group_name);
    return res.json(trainees);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/group-lectures?group_name=xxx ───────────────────────────
router.get('/group-lectures', (req, res) => {
  const { group_name } = req.query;
  if (!group_name) return res.status(400).json({ error: 'group_name required' });
  const line = lineFilter(req);
  const lineAny = buildLineFilter('', line);
  try {
    const batch = db.prepare(`SELECT * FROM batches WHERE group_name = ?${lineAny}`).get(group_name);
    const lectures = db.prepare(
      `SELECT * FROM lectures WHERE group_name = ?${lineAny} ORDER BY date ASC`
    ).all(group_name);
    return res.json({ batch, lectures });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/fix-report ─────────────────────────────────────────────
router.get('/fix-report', (req, res) => {
  const { period, date_from, date_to } = req.query;
  const line = lineFilter(req);
  const lineB = buildLineFilter('b', line);
  const lineCps = buildLineFilter('cps', line);
  // No WHERE dept filter — all coordinators always appear.
  // For leaders: dept filter applied inside CASE WHEN so fixed counts only include
  // records from the leader's own department. This prevents fixed > all_count.
  // Multi-dept aware: leader sees rows for ANY of their overseen departments
  // (primary + users.extra_departments). leaderDeptClause() returns '' for
  // admins / no scope.
  const deptCond = leaderDeptClause(req);
  // Build date condition embedded in CASE WHEN (date_from/date_to override period)
  let fixedDateCond = '';
  if (date_from && date_to) {
    const f = date_from.replace(/'/g,"''"); const t = date_to.replace(/'/g,"''");
    fixedDateCond = ` AND date(cps.updated_at) BETWEEN '${f}' AND '${t}'`;
  } else if (date_from) {
    const f = date_from.replace(/'/g,"''");
    fixedDateCond = ` AND date(cps.updated_at) >= '${f}'`;
  } else if (date_to) {
    const t = date_to.replace(/'/g,"''");
    fixedDateCond = ` AND date(cps.updated_at) <= '${t}'`;
  } else if (period === 'today') {
    fixedDateCond = ` AND date(cps.updated_at)=date('now','+2 hours')`;
  } else if (period === 'week') {
    fixedDateCond = ` AND cps.updated_at>=datetime('now','-6 days','+2 hours')`;
  } else if (period === 'month') {
    fixedDateCond = ` AND cps.updated_at>=datetime('now','-29 days','+2 hours')`;
  }
  // Universe of coordinators we want to show:
  //   1. Every active agent (even those with zero issues recorded)
  //   2. Every active leader who appears as a coordinator on at least one batch
  //      ("a leader who is also a group coordinator")
  //   3. Coordinator names already present in batches.coordinators (handles
  //      multi-coord strings like "Mostafa, fouad" + unregistered coordinators)
  //   4. The '--' bucket for code-problem rows whose batch has no coordinator
  const lineUsers = line ? ` AND (line = '${line.replace(/'/g, "''")}' OR line = 'All')` : '';
  const lineBatches = line ? ` AND b.line = '${line.replace(/'/g, "''")}'` : '';

  try {
    const rows = db.prepare(`
      WITH all_coords AS (
        SELECT full_name AS coordinator FROM users
         WHERE role = 'agent' AND is_active = 1${lineUsers}
        UNION
        SELECT u.full_name AS coordinator FROM users u
         WHERE u.role = 'leader' AND u.is_active = 1${line ? ` AND (u.line = '${line.replace(/'/g, "''")}' OR u.line = 'All')` : ''}
           AND EXISTS (
             SELECT 1 FROM batches b
             WHERE LOWER(TRIM(b.coordinators)) LIKE '%' || LOWER(TRIM(u.full_name)) || '%'${lineBatches}
           )
        UNION
        SELECT DISTINCT TRIM(b.coordinators) AS coordinator FROM batches b
         WHERE b.coordinators IS NOT NULL AND TRIM(b.coordinators) != ''${lineBatches}
        UNION
        SELECT '--' AS coordinator
      ),
      counts AS (
        SELECT
          COALESCE(b.coordinators, '--') AS coordinator,
          COUNT(*) AS all_count,
          SUM(CASE WHEN cps.status NOT IN ('wont_repeat','exception','resolved') THEN 1 ELSE 0 END) AS remaining,
          SUM(CASE WHEN cps.status IN ('wont_repeat','exception','resolved')${deptCond} THEN 1 ELSE 0 END) AS fixed,
          SUM(CASE WHEN cps.status IN ('wont_repeat','exception','resolved')${deptCond}${fixedDateCond} THEN 1 ELSE 0 END) AS fixed_period,
          SUM(CASE WHEN cps.status IN ('wont_repeat','exception','resolved')${deptCond}
                AND date(cps.updated_at)=date('now','+2 hours') THEN 1 ELSE 0 END) AS fixed_today
        FROM code_problem_status cps
        LEFT JOIN batches b ON TRIM(LOWER(b.group_name))=TRIM(LOWER(cps.group_name))${line ? ' AND b.line = cps.line' : ''}
        WHERE 1=1${lineCps}
        GROUP BY COALESCE(b.coordinators, '--')
      )
      SELECT
        ac.coordinator,
        COALESCE(c.all_count, 0) AS all_count,
        COALESCE(c.remaining, 0) AS remaining,
        COALESCE(c.fixed, 0) AS fixed,
        COALESCE(c.fixed_period, 0) AS fixed_period,
        COALESCE(c.fixed_today, 0) AS fixed_today
      FROM all_coords ac
      LEFT JOIN counts c ON ac.coordinator = c.coordinator
      ORDER BY remaining DESC, fixed DESC, ac.coordinator ASC
    `).all();
    return res.json(rows);
  } catch (err) {
    console.error('[reports] fix-report:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/fix-report/detail ──────────────────────────────────────
router.get('/fix-report/detail', (req, res) => {
  const { coordinator, period, date_from, date_to } = req.query;
  if (!coordinator) return res.status(400).json({ error: 'coordinator required' });
  const line = lineFilter(req);
  const lineCps = buildLineFilter('cps', line);
  // Multi-dept aware (supervisor-follow-up): leader sees all overseen depts.
  const deptClause = leaderDeptClause(req);
  let periodClause = '';
  if (date_from && date_to) {
    const f = date_from.replace(/'/g,"''"); const t = date_to.replace(/'/g,"''");
    periodClause = ` AND date(cps.updated_at) BETWEEN '${f}' AND '${t}'`;
  } else if (date_from) {
    const f = date_from.replace(/'/g,"''");
    periodClause = ` AND date(cps.updated_at) >= '${f}'`;
  } else if (date_to) {
    const t = date_to.replace(/'/g,"''");
    periodClause = ` AND date(cps.updated_at) <= '${t}'`;
  } else if (period === 'today') {
    periodClause = ` AND date(cps.updated_at)=date('now','+2 hours')`;
  } else if (period === 'week') {
    periodClause = ` AND cps.updated_at>=datetime('now','-6 days','+2 hours')`;
  } else if (period === 'month') {
    periodClause = ` AND cps.updated_at>=datetime('now','-29 days','+2 hours')`;
  }
  const safe = coordinator.replace(/'/g,"''");
  try {
    const rows = db.prepare(`
      SELECT cps.group_name, cps.problem_type, cps.session_type, cps.status, cps.note,
             cps.updated_at, b.dept_type, COALESCE(b.coordinators,'--') AS coordinators,
             u.full_name AS updated_by_name
      FROM code_problem_status cps
      LEFT JOIN batches b ON TRIM(LOWER(b.group_name))=TRIM(LOWER(cps.group_name))${line ? ' AND b.line = cps.line' : ''}
      LEFT JOIN users u ON u.id=cps.updated_by
      WHERE cps.status IN ('wont_repeat','exception','resolved')
        AND COALESCE(b.coordinators,'--') LIKE '%${safe}%'${deptClause}${periodClause}${lineCps}
      ORDER BY cps.updated_at DESC
    `).all();
    return res.json(rows);
  } catch (err) {
    console.error('[reports] fix-report/detail:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/attendance-absence ─────────────────────────────────────
// Per-coordinator attendance & absence stats for Main sessions + Zoom/Side sessions.
// Uses the SAME formulas as the Customer Services Reports dashboard so numbers
// line up perfectly (e.g. dashboard `absent_main=45` → this page `main_absent=45`).
//
// Main sessions:
//   - Expected = COUNT of main lectures for the coordinator in the filter window.
//   - Absent   = Part1 (absent_students with resolved name + resolved date via
//                lecture_no when date is missing)
//              + Part2 (main lectures with empty attendance where a client
//                exists in the group AND no matching absent_students record).
//
// Zoom / side sessions:
//   - Expected = COUNT of regular 15-min confirmed side sessions for coord.
//   - Absent   = per (group,date), MAX(trainee_count) - COUNT(sessions with
//                attendance>0). Only groups with absent_count>0 are counted.
//
// Role-based:
//   - admin  → sees all, honors ?department= filter (OR EXISTS)
//   - leader → scoped to req.user.department (coordinator-first)
//   - agent  → scoped to their own groups (coordinator = their name)
router.get('/attendance-absence', (req, res) => {
  const { from_date, to_date, coordinator } = req.query;
  const line = lineFilter(req);
  const lineB = buildLineFilter('b', line);
  const lineB2 = buildLineFilter('b2', line);
  const lineL = buildLineFilter('l', line);
  const lineA = buildLineFilter('a', line);

  // Role-based dept filter. For /attendance-absence the dept is matched
  // against the COORDINATOR's section AT THE TIME OF THE EVENT, looked
  // up via team_member_dept_history. This means: filter=Private → include
  // any absence where the coordinator-at-the-time was in Private section at
  // that moment, regardless of the group's current dept_type or the
  // coordinator's current section. Falls back to b.dept_type when no team
  // record covers the event date (graceful degradation for coordinators without
  // dept history yet).
  const coordName = req.user?.role === 'agent' ? req.user.full_name : (coordinator || '');
  let activeDept = '';
  if (req.user?.role === 'leader') {
    activeDept = leaderScopedDepts(req) || '';
  } else if (req.user?.role === 'admin') {
    activeDept = req.query.department || '';
  }
  if (activeDept === 'All') activeDept = '';

  // ── ENDED-GROUP RESILIENT FILTERS ─────────────────────────────────────────
  // Groups that have ended are REMOVED from `batches`, but their lectures stay
  // in `lectures` and their attribution stays in `coordinator_history`. So we
  // resolve coordinator + section from the EVENT's OWN group (l/a) via
  // coordinator_history + team_member_dept_history — NEVER via a batches join
  // (which would silently drop every ended group → inactive coordinators = 0).
  const RES_DATE_P1 = `COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)`;
  // Department filter by the coordinator's SECTION-at-date (team history), keyed
  // on the event's group. Team-section only (no batches.dept_type fallback) —
  // every counted coordinator is a roster member, so a section always exists.
  const sectionDeptFilter = (groupExpr, lineExpr, dateExpr) => {
    if (!activeDept) return '';
    const depts = (Array.isArray(activeDept) ? activeDept : [activeDept])
      .filter(Boolean).filter(d => d !== 'All')
      .map(d => String(d).toLowerCase().trim().replace(/'/g, "''"));
    if (!depts.length) return '';
    const inList = depts.map(d => `'${d}'`).join(',');
    return ` AND EXISTS (
      SELECT 1 FROM coordinator_history ch_d
       WHERE ch_d.group_name = ${groupExpr} AND ch_d.line = ${lineExpr}
         AND DATE(ch_d.effective_from) <= ${dateExpr}
         AND (ch_d.effective_to IS NULL OR DATE(ch_d.effective_to) > ${dateExpr})
         AND (
           EXISTS (
             SELECT 1 FROM team_member_dept_history tmh_d
              WHERE LOWER(TRIM(tmh_d.member_name)) = LOWER(TRIM(ch_d.coordinator))
                AND DATE(tmh_d.effective_from) <= ${dateExpr}
                AND (tmh_d.effective_to IS NULL OR DATE(tmh_d.effective_to) > ${dateExpr})
                AND LOWER(TRIM(tmh_d.section)) IN (${inList})
           )
           OR (
             -- Fallback: a coordinator with NO covering dept_history record (e.g.
             -- members who predate section-history tracking) was silently dropped
             -- from section-filtered reports. Use their current team_members
             -- section so they aren't zeroed out.
             NOT EXISTS (
               SELECT 1 FROM team_member_dept_history tmh_x
                WHERE LOWER(TRIM(tmh_x.member_name)) = LOWER(TRIM(ch_d.coordinator))
                  AND DATE(tmh_x.effective_from) <= ${dateExpr}
                  AND (tmh_x.effective_to IS NULL OR DATE(tmh_x.effective_to) > ${dateExpr})
             )
             AND EXISTS (
               SELECT 1 FROM team_members tm_x
                WHERE LOWER(TRIM(tm_x.name)) = LOWER(TRIM(ch_d.coordinator))
                  AND tm_x.department = 'customer_services'
                  AND LOWER(TRIM(tm_x.section)) IN (${inList})
             )
           )
         )
    )`;
  };
  const deptFilterMainL    = sectionDeptFilter('l.group_name', 'l.line', 'l.date');
  const deptFilterAbsentP1 = sectionDeptFilter('a.group_name', 'a.line', RES_DATE_P1);
  const coordFilterMainL   = coordFilterAtDate('l.group_name', 'l.line', 'l.date', coordName);
  const coordFilterP1      = coordFilterAtDate('a.group_name', 'a.line', RES_DATE_P1, coordName);
  // trainee_count fallback for ENDED groups (not in batches): count the group's
  // clients. Per-lecture group size → SUM gives student-slots (denominator).
  const traineeCountExpr = `COALESCE(b.trainee_count, (SELECT COUNT(*) FROM clients cc WHERE cc.group_name = l.group_name${line ? ' AND cc.line = l.line' : ''}))`;

  // ─── EXPECTED SLOTS (denominator) ──────────────────────────────────────────
  // trainee_count alone is an unreliable denominator: it is frequently UNDER the
  // real group size (defaults to a small/stale Batches value), AND lines record
  // attendance two different ways — some write the PRESENT-count in
  // lectures.attendance, others leave it empty and only list absentees in
  // absent_students. Using SUM(trainee_count) produced rates that made no sense
  // (e.g. present-count alone exceeded "expected", giving >100% / negative rates).
  // So the per-lecture group size = MAX(enrolled, observed), where observed =
  //   present (numeric lectures.attendance, else 0) + listed-absent (absent_students
  //   rows for that group+date). This guarantees expected >= the students we
  //   actually accounted for, so absence rate can never exceed 100% from a
  //   too-small denominator. Where attendance is empty (Private/Semi), it falls
  //   back to MAX(enrolled, listed-absent) = enrolled.
  const presentNumExpr = `(CASE WHEN l.attendance GLOB '[0-9]*' THEN CAST(l.attendance AS INTEGER) ELSE 0 END)`;
  const absentOnLectureExpr = `(SELECT COUNT(*) FROM absent_students asx WHERE asx.group_name = l.group_name AND asx.date = l.date${line ? ' AND asx.line = l.line' : ''})`;
  const expectedSlotsExpr = `MAX(${traineeCountExpr}, ${presentNumExpr} + ${absentOnLectureExpr})`;

  const dateFilterL = buildDateFilter('l.date', from_date, to_date);
  const dateFilterResolved = from_date && to_date
    ? ` AND resolved_date BETWEEN '${from_date}' AND '${to_date}'`
    : from_date ? ` AND resolved_date >= '${from_date}'`
    : to_date   ? ` AND resolved_date <= '${to_date}'` : '';

  try {
    // Date-aware coordinator expression — resolves the coordinator(s) of record
    // from coordinator_history for the event's date, RESTRICTED to فريق العمل
    // members (team_members CS) who were EMPLOYED on that date (start_date ≤ date
    // ≤ end_date). This enforces the agreed rules in one place:
    //   • only roster coordinators are attributed (drops the '--' / unregistered
    //     bucket — those events become NULL and are skipped on merge),
    //   • events before a coordinator's hire date or after their leave date are
    //     not credited to them (the date falls outside their window → NULL).
    // Returns NULL when no employed roster coordinator covers the date.
    // GROUP_CONCAT(DISTINCT …) dedups overlapping coordinator_history rows so a
    // group co-credited to the same person twice (e.g. "Name, Name" from an
    // overlap) collapses to one — the frontend splits on ',' and trims, so the
    // default comma separator is fine. This keeps each coordinator's total equal
    // to the sum of their movement-segments (segment-first source of truth).
    // Attribute each event to ONE coordinator-of-record (the earliest-assigned
    // among those active at the event date), NOT a GROUP_CONCAT of all of them.
    // The old "A,B" combined key was split by the frontend and the FULL counts
    // added to BOTH coordinators (and again into dept cards) → co-coordinated
    // groups were double-counted. A single deterministic coordinator credits each
    // event exactly once and also resolves section/status (which keyed on the
    // combined string and came back null).
    const dateAwareCoord = (batchAlias, dateExpr) => `(
      SELECT ch.coordinator
        FROM coordinator_history ch
        JOIN team_members tm
          ON LOWER(TRIM(tm.name)) = LOWER(TRIM(ch.coordinator))
         AND tm.department = 'customer_services'
       WHERE ch.group_name = ${effectiveGroupNameAtDate(`${batchAlias}.group_name`, `${batchAlias}.line`, dateExpr)}
         AND ch.line       = ${batchAlias}.line
         AND DATE(ch.effective_from) <= ${dateExpr}
         AND (ch.effective_to IS NULL OR DATE(ch.effective_to) > ${dateExpr})
         -- Hire-date (tm.start_date) lower-bound deliberately removed: it defaults
         -- to the record-creation date for members added without an explicit hire
         -- date, so it wrongly dropped real events that predate the roster record.
         -- coordinator_history.effective_from already bounds "responsible since".
         AND (tm.end_date   IS NULL OR TRIM(tm.end_date)   = '' OR DATE(tm.end_date)   >= ${dateExpr})
       ORDER BY DATE(ch.effective_from) ASC, ch.coordinator ASC
       LIMIT 1
    )`;

    // ─── MAIN EXPECTED per coordinator ─────────────────────────────────────
    // Student-slot denominator: SUM of per-lecture group size = MAX(enrolled,
    // present + listed-absent). See expectedSlotsExpr above for why trainee_count
    // alone is wrong.
    // De-duplicated batches join: a group with >1 row in `batches` (e.g. an
    // active row + an `إنتهت` row, or repeated placement entries) would multiply
    // the LEFT JOIN and inflate SUM(expectedSlots). Collapse to ONE row per
    // (group, line) taking the largest trainee_count so the denominator is
    // counted once. (b is used ONLY for b.trainee_count here.)
    const mainExpectedRows = db.prepare(`
      SELECT ${dateAwareCoord('l', 'l.date')} AS coordinator,
        COALESCE(SUM(${expectedSlotsExpr}), 0) AS cnt
      FROM lectures l
      LEFT JOIN (SELECT group_name, line, MAX(trainee_count) AS trainee_count FROM batches GROUP BY group_name, line) b
             ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
      WHERE l.session_type = 'main' AND l.status != 'غير مؤكدة'
      ${dateFilterL}${deptFilterMainL}${coordFilterMainL}${notInternalGroup('l.group_name')}${lineL}
      GROUP BY coordinator
    `).all();

    // ─── MAIN ABSENT per coordinator (dashboard Part1 + Part2) ─────────────
    // Part1: absent_students records with resolved name & date.
    const mainAbsentPart1 = db.prepare(`
      SELECT coordinator, COUNT(*) AS cnt FROM (
        SELECT ${dateAwareCoord('a', `COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)`)} AS coordinator,
          COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS resolved_date
        FROM absent_students a
        LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
        LEFT JOIN clients c_lu ON (a.student_name IS NULL OR TRIM(a.student_name)='')
          AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND (c_lu.phone = a.phone OR c_lu.phone = '0' || a.phone OR a.phone = '0' || c_lu.phone)
        LEFT JOIN (
          SELECT group_name, date, line,
            ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
          FROM lectures WHERE session_type='main' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
        ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
          AND lec_inf.group_name = a.group_name
          AND a.lecture_no IS NOT NULL
          AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
        WHERE (
          (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
          OR (a.phone IS NOT NULL AND TRIM(a.phone)!='')
        )
        ${deptFilterAbsentP1}${coordFilterP1}${notInternalGroup('a.group_name')}${lineA}
      ) p1
      WHERE 1=1${dateFilterResolved}
      GROUP BY coordinator
    `).all();

    // Part2: main lectures with empty attendance + client exists + no absent record.
    const mainAbsentPart2 = db.prepare(`
      SELECT ${dateAwareCoord('l', 'l.date')} AS coordinator, COUNT(*) AS cnt
      FROM lectures l
      INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
      WHERE l.session_type = 'main'
        AND l.status = 'مؤكدة'
        AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
        AND c.name IS NOT NULL AND TRIM(c.name)!=''
        AND c.phone IS NOT NULL AND TRIM(c.phone)!=''
        AND NOT EXISTS (
          SELECT 1 FROM absent_students a2
          WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
        )
      ${dateFilterL}${deptFilterMainL}${coordFilterMainL}${notInternalGroup('l.group_name')}${lineL}
      GROUP BY coordinator
    `).all();

    // ─── ZOOM EXPECTED per coordinator ─────────────────────────────────────
    // Side sessions are per-student 15-min slots — each lecture row is ONE
    // student's scheduled slot, so expected slots per (group,date) = COUNT(*)
    // of side lecture rows. Resolved straight off `lectures` (no batches join),
    // so ENDED groups (removed from batches) are still counted.
    const zoomExpectedRows = db.prepare(`
      SELECT coordinator, COALESCE(SUM(expected_slots), 0) AS cnt FROM (
        SELECT ${dateAwareCoord('l', 'l.date')} AS coordinator,
          COUNT(*) AS expected_slots
        FROM lectures l
        WHERE l.session_type = 'side'
          AND l.status = 'مؤكدة'
          AND (l.duration IS NULL OR l.duration <= '00:30') AND l.side_session_category = 'regular'
        ${dateFilterL}${deptFilterMainL}${coordFilterMainL}${notInternalGroup('l.group_name')}${lineL}
        GROUP BY coordinator, l.group_name, l.date
      ) sub
      GROUP BY coordinator
    `).all();

    // ─── ZOOM ABSENT per coordinator ───────────────────────────────────────
    // SOURCE FIX (2026-06-06): prefer the uploaded absent_zoom_students file —
    // the SAME source as the dashboard, /absent-side-list, and the 2026-06-06
    // Owner decision ("zoom absence count + details both come from the uploaded
    // file so they match"). The OLD lectures-based formula (side slots minus
    // present) MASSIVELY over-counts because zoom attendance is NOT recorded in
    // lectures.attendance (it lives only in the uploaded file) — so nearly every
    // empty-attendance slot was wrongly counted as an absence (e.g. yassmen
    // 1631 vs the real 296). This report's drill-down already counts from the
    // file, so the per-coordinator number was inconsistent with its own modal.
    // Fall back to the legacy lectures formula only when no file rows exist for
    // the line (so a line that hasn't uploaded the file still shows something).
    const hasZoomFile = db.prepare(
      `SELECT EXISTS(SELECT 1 FROM absent_zoom_students${line ? ` WHERE line = '${line.replace(/'/g, "''")}'` : ''}) AS h`
    ).get()?.h;

    const zoomAbsentDeptA  = sectionDeptFilter('a.group_name', 'a.line', 'a.date');
    const zoomAbsentCoordA = coordFilterAtDate('a.group_name', 'a.line', 'a.date', coordName);
    const zoomAbsentDateA  = buildDateFilter('a.date', from_date, to_date);

    const zoomAbsentRows = hasZoomFile
      ? db.prepare(`
          SELECT coordinator, COUNT(*) AS cnt FROM (
            SELECT a.id, ${dateAwareCoord('a', 'a.date')} AS coordinator
            FROM absent_zoom_students a
            WHERE (
              (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
              OR (a.phone IS NOT NULL AND TRIM(a.phone)!='')
            )
            AND EXISTS (
              SELECT 1 FROM lectures l
               WHERE REPLACE(l.group_name,' ','') IN (
                       REPLACE(a.group_name,' ',''),
                       REPLACE(${currentGroupNameExpr('a.group_name', 'a.line')},' ','')
                     )
                 AND l.date = a.date
                 AND l.session_type = 'side'
                 AND (l.side_session_category = 'regular'
                      OR (l.duration IS NOT NULL AND LENGTH(l.duration) >= 5
                          AND CAST(SUBSTR(l.duration,1,2) AS INTEGER)*60
                              + CAST(SUBSTR(l.duration,4,2) AS INTEGER) < 20))${line ? ' AND l.line = a.line' : ''}
            )
            ${zoomAbsentDateA}${zoomAbsentDeptA}${zoomAbsentCoordA}${lineA}
            GROUP BY a.id
          ) sub
          WHERE coordinator IS NOT NULL
          GROUP BY coordinator
        `).all()
      : db.prepare(`
          SELECT coordinator, COALESCE(SUM(absent_count), 0) AS cnt FROM (
            SELECT ${dateAwareCoord('l', 'l.date')} AS coordinator,
              COUNT(*) -
                SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance != ''
                         AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END)
                AS absent_count
            FROM lectures l
            WHERE l.session_type = 'side'
              AND l.status = 'مؤكدة'
              AND (l.duration IS NULL OR l.duration <= '00:30') AND l.side_session_category = 'regular'
            ${dateFilterL}${deptFilterMainL}${coordFilterMainL}${notInternalGroup('l.group_name')}${lineL}
            GROUP BY coordinator, l.group_name, l.date
            HAVING absent_count > 0
          ) sub
          GROUP BY coordinator
        `).all();

    // Merge per coordinator
    const map = new Map();
    // Unattributed events (NULL coordinator = no employed roster coordinator at
    // the event date) and any '--' placeholder are skipped — they don't belong
    // to any roster coordinator and must not appear as a row.
    const ensure = (raw) => {
      const key = (raw == null) ? '' : String(raw).trim();
      if (!key || key === '--') return null;
      if (!map.has(key)) {
        map.set(key, {
          coordinator: key,
          main_expected: 0, main_absent: 0,
          zoom_expected: 0, zoom_absent: 0,
        });
      }
      return map.get(key);
    };

    // Seed the روستر so every relevant coordinator appears even with 0 sessions
    // in the window (active AND inactive). Scope mirrors the dept filter:
    //   • admin → all CS members (or only the chosen department's section),
    //   • leader → only their overseen section(s),
    //   • agent → none (they only ever see their own row via coordFilter).
    const statusByName = {};
    const sectionByName = {};
    try {
      const allRoster = db.prepare(
        `SELECT name, section, status FROM team_members WHERE department='customer_services'`
      ).all();
      allRoster.forEach(tm => {
        statusByName[String(tm.name).trim().toLowerCase()] = tm.status;
        sectionByName[String(tm.name).trim().toLowerCase()] = tm.section;
      });

      if (req.user?.role !== 'agent') {
        let seedSecs = null;
        if (req.user?.role === 'leader') seedSecs = leaderScopedDepts(req);
        else if (activeDept) seedSecs = Array.isArray(activeDept) ? activeDept : [activeDept];
        const secSet = (seedSecs || [])
          .map(d => String(d).toLowerCase().trim())
          .filter(d => d && d !== 'all');
        allRoster.forEach(tm => {
          if (secSet.length && !secSet.includes(String(tm.section).toLowerCase().trim())) return;
          ensure(tm.name);
        });
      }
    } catch (_) { /* roster seed is best-effort */ }

    mainExpectedRows.forEach(r => { const e = ensure(r.coordinator); if (e) e.main_expected += r.cnt || 0; });
    mainAbsentPart1.forEach(r => { const e = ensure(r.coordinator); if (e) e.main_absent += r.cnt || 0; });
    mainAbsentPart2.forEach(r => { const e = ensure(r.coordinator); if (e) e.main_absent += r.cnt || 0; });
    zoomExpectedRows.forEach(r => { const e = ensure(r.coordinator); if (e) e.zoom_expected += r.cnt || 0; });
    zoomAbsentRows.forEach(r => { const e = ensure(r.coordinator); if (e) e.zoom_absent += r.cnt || 0; });

    const result = Array.from(map.values())
      .map(r => {
        const st = statusByName[r.coordinator.toLowerCase()];
        return {
          ...r,
          status: st || null,
          is_active: st ? (st === 'active') : null,
          section: sectionByName[r.coordinator.toLowerCase()] || null,
          main_absence_rate: r.main_expected > 0
            ? Math.round((r.main_absent / r.main_expected) * 100)
            : 0,
          zoom_absence_rate: r.zoom_expected > 0
            ? Math.round((r.zoom_absent / r.zoom_expected) * 100)
            : 0,
        };
      })
      .sort((a, b) =>
        (b.main_absent + b.zoom_absent) - (a.main_absent + a.zoom_absent)
      );

    // ─── Current-department lookup ─────────────────────────────────────────
    // For each coordinator name (split on commas to handle multi-coord rows),
    // look up their CURRENT users.department. The frontend uses this to show
    // a "moved to X" badge when the coordinator no longer belongs to the
    // filtered dept. Names not found in users (e.g. external/unregistered
    // coordinators) get null.
    const allCoordNames = new Set();
    result.forEach(r => {
      String(r.coordinator || '').split(',').forEach(c => {
        const t = c.trim();
        if (t && t !== '--') allCoordNames.add(t.toLowerCase());
      });
    });
    const deptByName = {};
    if (allCoordNames.size > 0) {
      const arr = Array.from(allCoordNames);
      const placeholders = arr.map(() => '?').join(',');
      try {
        const userRows = db.prepare(
          `SELECT LOWER(TRIM(full_name)) AS lname, department
             FROM users
            WHERE department IS NOT NULL AND department != 'All'
              AND LOWER(TRIM(full_name)) IN (${placeholders})`
        ).all(...arr);
        userRows.forEach(u => { if (u.lname) deptByName[u.lname] = u.department; });
      } catch (_) { /* lookup failure is non-fatal */ }
    }
    // Add a parallel current_department string (comma-separated, same order as
    // coordinator field). Empty slot = unknown/unregistered.
    result.forEach(r => {
      const depts = String(r.coordinator || '').split(',').map(c => {
        const k = c.trim().toLowerCase();
        return deptByName[k] || '';
      });
      r.current_department = depts.join(',');
    });

    return res.json(result);
  } catch (err) {
    console.error('[reports] attendance-absence error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/attendance-absence/segments ─────────────────────────────
// Per-MOVEMENT breakdown for ONE coordinator: splits their attendance numbers by
// the SECTION-periods they held (team_member_dept_history), within [from,to] and
// capped by their employment dates. Each segment carries its period + a note
// (transition / left work / ongoing). Segment numbers SUM to the coordinator's
// row in /attendance-absence (segment-first source of truth). Same per-event
// formulas as the main endpoint, just coordinator-scoped and grouped by section.
router.get('/attendance-absence/segments', (req, res) => {
  const { from_date, to_date, coordinator } = req.query;
  if (!coordinator || !String(coordinator).trim()) return res.json({ coordinator: coordinator || null, segments: [] });
  const line  = lineFilter(req);
  const lineL = buildLineFilter('l', line);
  const lineA = buildLineFilter('a', line);
  const safe  = String(coordinator).replace(/'/g, "''").trim();
  const d10   = v => (v ? String(v).slice(0, 10) : null);

  // Coordinator employment dates (for the [hire, leave] cap).
  const tmRow = db.prepare(
    `SELECT start_date, end_date, section FROM team_members WHERE department='customer_services' AND LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1`
  ).get(coordinator) || {};
  const empStart = d10(tmRow.start_date);
  const empEnd   = d10(tmRow.end_date);
  const tmSection = tmRow.section || null;   // fallback section when no dept_history exists

  // Coordinator-scoped membership test that MIRRORS dateAwareCoord in
  // /attendance-absence EXACTLY (same TRIM match + team_members employment JOIN)
  // so the segment numbers SUM to the coordinator's row. `aliasGroup` is the
  // alias whose group_name/line to use — the EVENT's own (l / a), NOT batches,
  // so ENDED groups (removed from batches) are still counted.
  // Count an event for this coordinator ONLY if they are the SINGLE coordinator-
  // of-record the row endpoint attributes it to (dateAwareCoord = earliest
  // effective_from, tie-break coordinator ASC). Previously this was an "EXISTS
  // ANY coordinator at the date == me" check, which re-counted shared-group events
  // for BOTH co-coordinators → segments over-counted vs the row. Now segment sums
  // reconcile to the row exactly even for co-coordinated groups.
  const cf = (aliasGroup, dateExpr) => ` AND LOWER(TRIM('${safe}')) = LOWER(TRIM((
    SELECT ch_w.coordinator FROM coordinator_history ch_w
      JOIN team_members tm_w
        ON LOWER(TRIM(tm_w.name)) = LOWER(TRIM(ch_w.coordinator))
       AND tm_w.department = 'customer_services'
     WHERE ch_w.group_name = ${aliasGroup}.group_name
       AND ch_w.line       = ${aliasGroup}.line
       AND DATE(ch_w.effective_from) <= ${dateExpr}
       AND (ch_w.effective_to IS NULL OR DATE(ch_w.effective_to) > ${dateExpr})
       AND (tm_w.end_date   IS NULL OR TRIM(tm_w.end_date)   = '' OR DATE(tm_w.end_date)   >= ${dateExpr})
     ORDER BY DATE(ch_w.effective_from) ASC, ch_w.coordinator ASC LIMIT 1
  )))`;

  // Bucket key = the section-history record applicable on the event date
  // (prefers a covering record; falls back to the nearest by start date so a
  // gap never drops an event — keeps segment sums == the coordinator total).
  // Returns the applicable dept_history record id, or -1 as a fallback bucket when
  // the coordinator has NO dept_history rows at all (e.g. RadwaGamal/Malika7 who
  // predate section-history tracking) — without this they returned NULL and bump()
  // dropped every event → /segments showed {0,0,0,0} while the row had real
  // numbers. The -1 bucket is labelled with the member's current team_members
  // section in the segment build below.
  const segId = (d) => `COALESCE((
    SELECT tmh.id FROM team_member_dept_history tmh
     WHERE LOWER(TRIM(tmh.member_name)) = LOWER('${safe}')
     ORDER BY
       CASE WHEN DATE(tmh.effective_from) <= ${d}
             AND (tmh.effective_to IS NULL OR DATE(tmh.effective_to) > ${d}) THEN 0 ELSE 1 END,
       ABS(julianday(${d}) - julianday(tmh.effective_from))
     LIMIT 1
  ), -1)`;
  const dateFilterL = buildDateFilter('l.date', from_date, to_date);
  const dateFilterResolved = from_date && to_date
    ? ` AND resolved_date BETWEEN '${from_date}' AND '${to_date}'`
    : from_date ? ` AND resolved_date >= '${from_date}'`
    : to_date   ? ` AND resolved_date <= '${to_date}'` : '';

  try {
    // Expected-slots denominator MUST mirror /attendance-absence exactly
    // (MAX(enrolled, present + listed-absent)) so segment sums == the row.
    const traineeCountExpr = `COALESCE(b.trainee_count, (SELECT COUNT(*) FROM clients cc WHERE cc.group_name = l.group_name${line ? ' AND cc.line = l.line' : ''}))`;
    const presentNumExpr = `(CASE WHEN l.attendance GLOB '[0-9]*' THEN CAST(l.attendance AS INTEGER) ELSE 0 END)`;
    const absentOnLectureExpr = `(SELECT COUNT(*) FROM absent_students asx WHERE asx.group_name = l.group_name AND asx.date = l.date${line ? ' AND asx.line = l.line' : ''})`;
    const expectedSlotsExpr = `MAX(${traineeCountExpr}, ${presentNumExpr} + ${absentOnLectureExpr})`;
    const me = db.prepare(`
      SELECT ${segId('l.date')} AS seg, COALESCE(SUM(${expectedSlotsExpr}),0) AS cnt
      FROM lectures l LEFT JOIN batches b ON l.group_name=b.group_name${line ? ' AND b.line=l.line' : ''}
      WHERE l.session_type='main' AND l.status!='غير مؤكدة'
      ${dateFilterL}${cf('l','l.date')}${lineL}
      GROUP BY seg`).all();

    const RES_DATE = `COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)`;
    const ma1 = db.prepare(`
      SELECT seg, COUNT(*) AS cnt FROM (
        SELECT ${segId(RES_DATE)} AS seg, ${RES_DATE} AS resolved_date
        FROM absent_students a
        LEFT JOIN batches b ON a.group_name=b.group_name${line ? ' AND b.line=a.line' : ''}
        LEFT JOIN clients c_lu ON (a.student_name IS NULL OR TRIM(a.student_name)='')
          AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND (c_lu.phone=a.phone OR c_lu.phone='0'||a.phone OR a.phone='0'||c_lu.phone)
        LEFT JOIN (SELECT group_name,date,line,ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num FROM lectures WHERE session_type='main' AND status!='غير مؤكدة'${line ? ` AND line='${line.replace(/'/g,"''")}'` : ''}) lec_inf
          ON (a.date IS NULL OR TRIM(a.date)='') AND lec_inf.group_name=a.group_name AND a.lecture_no IS NOT NULL AND lec_inf.lec_num=a.lecture_no${line ? ' AND lec_inf.line=a.line' : ''}
        WHERE ((a.student_name IS NOT NULL AND TRIM(a.student_name)!='') OR (a.phone IS NOT NULL AND TRIM(a.phone)!=''))
        ${cf('a',RES_DATE)}${lineA}
      ) p WHERE 1=1${dateFilterResolved} GROUP BY seg`).all();

    const ma2 = db.prepare(`
      SELECT ${segId('l.date')} AS seg, COUNT(*) AS cnt
      FROM lectures l
      INNER JOIN clients c ON c.group_name=l.group_name${line ? ' AND c.line=l.line' : ''}
      WHERE l.session_type='main' AND l.status='مؤكدة' AND (l.attendance IS NULL OR TRIM(l.attendance)='')
        AND c.name IS NOT NULL AND TRIM(c.name)!='' AND c.phone IS NOT NULL AND TRIM(c.phone)!=''
        AND NOT EXISTS (SELECT 1 FROM absent_students a2 WHERE a2.group_name=l.group_name AND a2.date=l.date${line ? ' AND a2.line=l.line' : ''})
      ${dateFilterL}${cf('l','l.date')}${lineL}
      GROUP BY seg`).all();

    const ze = db.prepare(`
      SELECT seg, COALESCE(SUM(expected_slots),0) AS cnt FROM (
        SELECT ${segId('l.date')} AS seg, COUNT(*) AS expected_slots
        FROM lectures l
        WHERE l.session_type='side' AND l.status='مؤكدة' AND (l.duration IS NULL OR l.duration<='00:30') AND l.side_session_category='regular'
        ${dateFilterL}${cf('l','l.date')}${lineL}
        GROUP BY seg, l.group_name, l.date
      ) sub GROUP BY seg`).all();

    const za = db.prepare(`
      SELECT seg, COALESCE(SUM(absent_count),0) AS cnt FROM (
        SELECT ${segId('l.date')} AS seg,
          COUNT(*) - SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance!='' AND CAST(l.attendance AS INTEGER)>0 THEN 1 ELSE 0 END) AS absent_count
        FROM lectures l
        WHERE l.session_type='side' AND l.status='مؤكدة' AND (l.duration IS NULL OR l.duration<='00:30') AND l.side_session_category='regular'
        ${dateFilterL}${cf('l','l.date')}${lineL}
        GROUP BY seg, l.group_name, l.date
        HAVING absent_count>0
      ) sub GROUP BY seg`).all();

    const segMap = new Map();
    const bump = (rows, field) => rows.forEach(r => {
      if (r.seg == null) return;
      if (!segMap.has(r.seg)) segMap.set(r.seg, { main_expected: 0, main_absent: 0, zoom_expected: 0, zoom_absent: 0 });
      segMap.get(r.seg)[field] += r.cnt || 0;
    });
    bump(me, 'main_expected'); bump(ma1, 'main_absent'); bump(ma2, 'main_absent');
    bump(ze, 'zoom_expected'); bump(za, 'zoom_absent');

    const hist = db.prepare(
      `SELECT id, section, effective_from, effective_to FROM team_member_dept_history WHERE LOWER(TRIM(member_name))=LOWER(TRIM(?)) ORDER BY DATE(effective_from)`
    ).all(coordinator);
    const histById = new Map(hist.map(h => [h.id, h]));
    const maxStr = (a, b) => (!a ? b : (!b ? a : (a > b ? a : b)));
    const minStr = (a, b) => (!a ? b : (!b ? a : (a < b ? a : b)));

    const segments = [...segMap.entries()].map(([id, n]) => {
      // id === -1 → the no-dept_history fallback bucket: label it with the
      // member's current team_members section (ongoing window).
      const h = histById.get(id) || (id === -1 ? { section: tmSection } : {});
      const hFrom = d10(h.effective_from), hTo = d10(h.effective_to);
      // period = section window ∩ filter ∩ (leave date). Start is NOT clamped by
      // empStart (hire date) — it is unreliable (record-creation default) and the
      // counts above ignore it, so clamping the displayed period by it would make
      // the shown range disagree with the numbers.
      let from = maxStr(hFrom, from_date || null);
      let to   = minStr(minStr(hTo, to_date || null), empEnd);
      let ended_by = 'ongoing', next_section = null;
      if (hTo) {
        ended_by = 'transition';
        const nx = hist.find(x => d10(x.effective_from) === hTo);
        next_section = nx ? nx.section : null;
      } else if (empEnd) {
        ended_by = 'left_work';
      }
      return {
        section: h.section || null,
        from, to, ended_by, next_section,
        ...n,
        main_absence_rate: n.main_expected > 0 ? Math.round((n.main_absent / n.main_expected) * 100) : 0,
        zoom_absence_rate: n.zoom_expected > 0 ? Math.round((n.zoom_absent / n.zoom_expected) * 100) : 0,
      };
    }).sort((a, b) => String(a.from || '').localeCompare(String(b.from || '')));

    return res.json({ coordinator, employment: { start_date: empStart, end_date: empEnd }, segments });
  } catch (err) {
    console.error('[reports] attendance-absence/segments error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/attendance-absence-by-department ────────────────────────
// Aggregated attendance & absence stats grouped by department (Semi/Private/General).
// Same filters and same formulas as /attendance-absence, just grouped differently.
router.get('/attendance-absence-by-department', (req, res) => {
  const { from_date, to_date, coordinator } = req.query;
  const line = lineFilter(req);
  const lineL = buildLineFilter('l', line);
  const lineA = buildLineFilter('a', line);

  let deptFilterB = '', deptFilterB2 = '';
  let coordFilterB = buildCoordFilter('b', coordinator);
  let coordFilterB2 = buildCoordFilter('b2', coordinator);
  if (req.user?.role === 'leader') {
    // Multi-dept aware: pass the array of overseen depts.
    const depts = leaderScopedDepts(req);
    deptFilterB  = buildStrictDeptFilter('b',  depts);
    deptFilterB2 = buildStrictDeptFilter('b2', depts);
  } else if (req.user?.role === 'admin') {
    deptFilterB  = buildDeptFilter('b',  req.query.department);
    deptFilterB2 = buildDeptFilter('b2', req.query.department);
  } else if (req.user?.role === 'agent') {
    coordFilterB  = buildCoordFilter('b',  req.user.full_name);
    coordFilterB2 = buildCoordFilter('b2', req.user.full_name);
  }

  const dateFilterL = buildDateFilter('l.date', from_date, to_date);
  const dateFilterResolved = from_date && to_date
    ? ` AND resolved_date BETWEEN '${from_date}' AND '${to_date}'`
    : from_date ? ` AND resolved_date >= '${from_date}'`
    : to_date   ? ` AND resolved_date <= '${to_date}'` : '';

  try {
    // MAIN EXPECTED per department
    const mainExpectedRows = db.prepare(`
      SELECT COALESCE(b.dept_type, '—') AS department,
        COALESCE(SUM(b.trainee_count), 0) AS cnt,
        COUNT(DISTINCT b.coordinators) AS coords
      FROM lectures l
      INNER JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
      WHERE l.session_type = 'main' AND l.status != 'غير مؤكدة'
      ${dateFilterL}${deptFilterB}${coordFilterB}${lineL}
      GROUP BY b.dept_type
    `).all();

    // MAIN ABSENT — Part 1 per department
    const mainAbsentPart1 = db.prepare(`
      SELECT department, COUNT(*) AS cnt FROM (
        SELECT COALESCE(b.dept_type, '—') AS department,
          COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS resolved_date
        FROM absent_students a
        LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
        LEFT JOIN clients c_lu ON (a.student_name IS NULL OR TRIM(a.student_name)='')
          AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND (c_lu.phone = a.phone OR c_lu.phone = '0' || a.phone OR a.phone = '0' || c_lu.phone)
        LEFT JOIN (
          SELECT group_name, date, line,
            ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
          FROM lectures WHERE session_type='main' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
        ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
          AND lec_inf.group_name = a.group_name
          AND a.lecture_no IS NOT NULL
          AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
        WHERE (
          (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
          OR (a.phone IS NOT NULL AND TRIM(a.phone)!='')
        )
        ${deptFilterB}${coordFilterB}${lineA}
      ) p1
      WHERE 1=1${dateFilterResolved}
      GROUP BY department
    `).all();

    // MAIN ABSENT — Part 2 per department
    const mainAbsentPart2 = db.prepare(`
      SELECT COALESCE(b2.dept_type, '—') AS department, COUNT(*) AS cnt
      FROM lectures l
      INNER JOIN batches b2 ON l.group_name = b2.group_name${line ? ' AND b2.line = l.line' : ''}
      INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
      LEFT JOIN absent_students a ON a.group_name = l.group_name AND a.lecture_no IS NOT NULL${line ? ' AND a.line = l.line' : ''}
      WHERE l.session_type = 'main' AND l.status != 'غير مؤكدة'
        AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
        AND a.id IS NULL
      ${dateFilterL}${deptFilterB2}${coordFilterB2}${lineL}
      GROUP BY b2.dept_type
    `).all();

    // ZOOM EXPECTED per department
    const zoomBatchSubQ = line
      ? `(SELECT b.group_name,
           COALESCE(lc.canonical_line, MIN(b.line)) AS line,
           MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
         FROM batches b
         LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
         WHERE b.line = '${line.replace(/'/g, "''")}'
         GROUP BY b.group_name)`
      : `(SELECT b.group_name,
           COALESCE(lc.canonical_line, MIN(b.line)) AS line,
           MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
         FROM batches b
         LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
         GROUP BY b.group_name)`;

    const zoomExpectedRows = db.prepare(`
      SELECT department, COALESCE(SUM(expected_slots), 0) AS cnt FROM (
        SELECT COALESCE(b.dept_type, '—') AS department,
          COUNT(*) AS expected_slots
        FROM lectures l
        INNER JOIN ${zoomBatchSubQ} b ON l.group_name = b.group_name AND l.line = b.line
        WHERE l.session_type = 'side'
          AND l.status = 'مؤكدة'
          AND (l.duration IS NULL OR l.duration <= '00:30') AND l.side_session_category = 'regular'
        ${dateFilterL}${deptFilterB}${coordFilterB}
        GROUP BY b.dept_type, l.group_name, l.date
      ) sub
      GROUP BY department
    `).all();

    const zoomAbsentRows = db.prepare(`
      SELECT department, COALESCE(SUM(absent_count), 0) AS cnt FROM (
        SELECT COALESCE(b.dept_type, '—') AS department,
          COUNT(*) -
            SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance != ''
                     AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END)
            AS absent_count
        FROM lectures l
        INNER JOIN ${zoomBatchSubQ} b ON l.group_name = b.group_name AND l.line = b.line
        WHERE l.session_type = 'side'
          AND l.status = 'مؤكدة'
          AND (l.duration IS NULL OR l.duration <= '00:30') AND l.side_session_category = 'regular'
        ${dateFilterL}${deptFilterB}${coordFilterB}
        GROUP BY b.dept_type, l.group_name, l.date
        HAVING absent_count > 0
      ) sub
      GROUP BY department
    `).all();

    // Merge per department
    const map = new Map();
    const ensure = (raw) => {
      const key = raw || '—';
      if (!map.has(key)) {
        map.set(key, {
          department: key,
          coordinators: 0,
          main_expected: 0, main_absent: 0,
          zoom_expected: 0, zoom_absent: 0,
        });
      }
      return map.get(key);
    };

    mainExpectedRows.forEach(r => {
      const bucket = ensure(r.department);
      bucket.main_expected += r.cnt || 0;
      bucket.coordinators = Math.max(bucket.coordinators, r.coords || 0);
    });
    mainAbsentPart1.forEach(r => { ensure(r.department).main_absent += r.cnt || 0; });
    mainAbsentPart2.forEach(r => { ensure(r.department).main_absent += r.cnt || 0; });
    zoomExpectedRows.forEach(r => { ensure(r.department).zoom_expected += r.cnt || 0; });
    zoomAbsentRows.forEach(r => { ensure(r.department).zoom_absent += r.cnt || 0; });

    const result = Array.from(map.values())
      .filter(r => r.main_expected + r.zoom_expected > 0)
      .map(r => ({
        ...r,
        main_absence_rate: r.main_expected > 0
          ? Math.round((r.main_absent / r.main_expected) * 100) : 0,
        zoom_absence_rate: r.zoom_expected > 0
          ? Math.round((r.zoom_absent / r.zoom_expected) * 100) : 0,
      }))
      .sort((a, b) => (b.main_absent + b.zoom_absent) - (a.main_absent + a.zoom_absent));

    return res.json(result);
  } catch (err) {
    console.error('[reports] attendance-absence-by-department error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/quality-employee ────────────────────────────────────────
// Per-employee Quality summary:
//   - code_problems_fixed   = problems on agent's groups whose status moved to
//                              resolved/wont_repeat/exception within [from..to]
//   - attendance_main_count = remarks count where category = 'Attendance Main Session'
//                              assigned to the agent within [from..to]
//   - attendance_side_count = remarks count where category in
//                              ('Attendance Zoom Call','Attendance Side Session')
//   - attendance_task_count = remarks count where category = 'Attendance Task'
//   - open_remarks_count    = open remarks (status not in completed/closed set)
//                              assigned to the agent in the date range
// Filters: from, to (YYYY-MM-DD), department (All|General|Private|Semi)
// Strict ISO date validator — rejects "2026-04-31", "Feb 30", "13/45/2026" etc.
// Returns true for empty (caller decides if empty is OK).
function isValidISODate(s) {
  if (!s) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, day] = s.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day;
}

router.get('/quality-employee', (req, res) => {
  const { from, to, department } = req.query;
  const line = lineFilter(req);

  // Reject impossible dates (April 31, Feb 30, etc.) before they hit the SQL
  // and silently include data outside the requested range.
  if (!isValidISODate(from)) {
    return res.status(400).json({ error: `Invalid 'from' date: ${from}` });
  }
  if (!isValidISODate(to)) {
    return res.status(400).json({ error: `Invalid 'to' date: ${to}` });
  }

  // Build user (agent) list — admin sees all; leader scoped to all of
  // their overseen departments (primary + extras).
  const userConds = ["u.role = 'agent'", 'u.is_active = 1'];
  const userParams = [];
  let activeDepts = null;  // array form for multi-dept support

  if (req.user?.role === 'leader') {
    activeDepts = leaderScopedDepts(req);
  } else if (department && department !== 'All') {
    activeDepts = [department];
  }

  if (activeDepts && activeDepts.length > 0) {
    const ph = activeDepts.map(() => '?').join(',');
    userConds.push(`LOWER(TRIM(u.department)) IN (${ph})`);
    userParams.push(...activeDepts.map(d => String(d).toLowerCase().trim()));
  }
  if (line) {
    userConds.push('u.line = ?');
    userParams.push(line);
  }

  const agents = db.prepare(
    `SELECT u.id, u.full_name, u.department FROM users u WHERE ${userConds.join(' AND ')} ORDER BY u.full_name COLLATE NOCASE`
  ).all(...userParams);

  if (agents.length === 0) return res.json([]);

  // Date filter for remarks.added_at — handles both DD/MM/YYYY and ISO formats
  const remarksDateExpr = `CASE
    WHEN substr(added_at, 5, 1) = '-' THEN substr(added_at, 1, 10)
    WHEN substr(added_at, 3, 1) = '/' THEN substr(added_at, 7, 4) || '-' || substr(added_at, 4, 2) || '-' || substr(added_at, 1, 2)
    ELSE NULL
  END`;

  // ─── Calculate metrics for all agents at once (efficient) ─────────────────

  // Build line filter clauses
  const lineRemarks = line ? ` AND r.line = ?` : '';
  const lineCps    = line ? ` AND cps.line = ?` : '';
  const lineB      = line ? ` AND b.line = cps.line` : '';

  // ─── ABSENCE per coordinator — mirrors /attendance-absence EXACTLY ─────────
  // Previously quality attributed absence via current `batches.coordinators`,
  // which (a) used a different model than /attendance-absence and (b) dropped
  // ENDED groups (removed from batches), zeroing coordinators whose groups
  // finished (e.g. shrouk gamal: 0 here vs 437 there). We now reuse the SAME
  // date-aware coordinator-of-record attribution (coordinator_history + employed
  // roster member, single earliest coordinator) so both pages reconcile. Built
  // once for all coordinators, then looked up per agent by compact name.
  const qLineLit = line ? `'${line.replace(/'/g, "''")}'` : null;
  const qLineL = qLineLit ? ` AND l.line = ${qLineLit}` : '';
  const qLineA = qLineLit ? ` AND a.line = ${qLineLit}` : '';
  const qDateL = buildDateFilter('l.date', from, to);
  const qDateA = buildDateFilter('a.date', from, to);
  const qDateResolved = (from && to) ? ` AND resolved_date BETWEEN '${from}' AND '${to}'`
    : from ? ` AND resolved_date >= '${from}'` : to ? ` AND resolved_date <= '${to}'` : '';
  const _compactQ = v => String(v == null ? '' : v).toLowerCase().replace(/\s/g, '');
  const _dateAwareCoordQ = (alias, dateExpr) => `(
    SELECT ch.coordinator FROM coordinator_history ch
      JOIN team_members tm ON LOWER(TRIM(tm.name)) = LOWER(TRIM(ch.coordinator)) AND tm.department='customer_services'
     WHERE ch.group_name = ${effectiveGroupNameAtDate(`${alias}.group_name`, `${alias}.line`, dateExpr)}
       AND ch.line = ${alias}.line
       AND DATE(ch.effective_from) <= ${dateExpr}
       AND (ch.effective_to IS NULL OR DATE(ch.effective_to) > ${dateExpr})
       AND (tm.end_date IS NULL OR TRIM(tm.end_date)='' OR DATE(tm.end_date) >= ${dateExpr})
     ORDER BY DATE(ch.effective_from) ASC, ch.coordinator ASC LIMIT 1)`;
  const _presentNumQ = `(CASE WHEN l.attendance GLOB '[0-9]*' THEN CAST(l.attendance AS INTEGER) ELSE 0 END)`;
  const _absentOnLecQ = `(SELECT COUNT(*) FROM absent_students asx WHERE asx.group_name = l.group_name AND asx.date = l.date${qLineLit ? ` AND asx.line = ${qLineLit}` : ''})`;
  const _traineeCountQ = `COALESCE(b.trainee_count, (SELECT COUNT(*) FROM clients cc WHERE cc.group_name = l.group_name${qLineLit ? ` AND cc.line = ${qLineLit}` : ''}))`;
  const _expectedSlotsQ = `MAX(${_traineeCountQ}, ${_presentNumQ} + ${_absentOnLecQ})`;
  const _toMap = (rows) => { const m = new Map(); for (const r of rows) { if (r.coordinator == null) continue; const k = _compactQ(r.coordinator); if (!k || k === '--') continue; m.set(k, (m.get(k) || 0) + (r.cnt || 0)); } return m; };

  const mainAbsentByCoord = _toMap([
    ...db.prepare(`
      SELECT coordinator, COUNT(*) AS cnt FROM (
        SELECT ${_dateAwareCoordQ('a', `COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date)`)} AS coordinator,
          COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS resolved_date
        FROM absent_students a
        LEFT JOIN (
          SELECT group_name, date, line, ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
          FROM lectures WHERE session_type='main' AND status != 'غير مؤكدة'${qLineLit ? ` AND line=${qLineLit}` : ''}
        ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='') AND lec_inf.group_name=a.group_name
          AND a.lecture_no IS NOT NULL AND lec_inf.lec_num=a.lecture_no${qLineLit ? ' AND lec_inf.line=a.line' : ''}
        WHERE ((a.student_name IS NOT NULL AND TRIM(a.student_name)!='') OR (a.phone IS NOT NULL AND TRIM(a.phone)!=''))
        ${notInternalGroup('a.group_name')}${qLineA}
      ) p1 WHERE 1=1${qDateResolved} GROUP BY coordinator
    `).all(),
    ...db.prepare(`
      SELECT ${_dateAwareCoordQ('l', 'l.date')} AS coordinator, COUNT(*) AS cnt
      FROM lectures l INNER JOIN clients c ON c.group_name=l.group_name${qLineLit ? ' AND c.line=l.line' : ''}
      WHERE l.session_type='main' AND l.status='مؤكدة' AND (l.attendance IS NULL OR TRIM(l.attendance)='')
        AND c.name IS NOT NULL AND TRIM(c.name)!='' AND c.phone IS NOT NULL AND TRIM(c.phone)!=''
        AND NOT EXISTS (SELECT 1 FROM absent_students a2 WHERE a2.group_name=l.group_name AND a2.date=l.date${qLineLit ? ' AND a2.line=l.line' : ''})
      ${qDateL}${notInternalGroup('l.group_name')}${qLineL} GROUP BY coordinator
    `).all(),
  ]);
  const mainExpectedByCoord = _toMap(db.prepare(`
    SELECT ${_dateAwareCoordQ('l', 'l.date')} AS coordinator, COALESCE(SUM(${_expectedSlotsQ}), 0) AS cnt
    FROM lectures l LEFT JOIN (SELECT group_name, line, MAX(trainee_count) AS trainee_count FROM batches GROUP BY group_name, line) b
           ON l.group_name=b.group_name${qLineLit ? ' AND b.line=l.line' : ''}
    WHERE l.session_type='main' AND l.status != 'غير مؤكدة'
    ${qDateL}${notInternalGroup('l.group_name')}${qLineL} GROUP BY coordinator
  `).all());
  const zoomExpectedByCoord = _toMap(db.prepare(`
    SELECT coordinator, COALESCE(SUM(expected_slots),0) AS cnt FROM (
      SELECT ${_dateAwareCoordQ('l', 'l.date')} AS coordinator, COUNT(*) AS expected_slots
      FROM lectures l
      WHERE l.session_type='side' AND l.status='مؤكدة'
        AND (l.duration IS NULL OR l.duration <= '00:30') AND l.side_session_category='regular'
      ${qDateL}${notInternalGroup('l.group_name')}${qLineL}
      GROUP BY coordinator, l.group_name, l.date
    ) sub GROUP BY coordinator
  `).all());
  const _hasZoomFileQ = db.prepare(`SELECT EXISTS(SELECT 1 FROM absent_zoom_students${qLineLit ? ` WHERE line=${qLineLit}` : ''}) AS h`).get()?.h;
  const zoomAbsentByCoord = _toMap(_hasZoomFileQ
    ? db.prepare(`
        SELECT coordinator, COUNT(*) AS cnt FROM (
          SELECT a.id, ${_dateAwareCoordQ('a', 'a.date')} AS coordinator
          FROM absent_zoom_students a
          WHERE ((a.student_name IS NOT NULL AND TRIM(a.student_name)!='') OR (a.phone IS NOT NULL AND TRIM(a.phone)!=''))
            AND EXISTS (
              SELECT 1 FROM lectures l WHERE REPLACE(l.group_name,' ','') IN (
                REPLACE(a.group_name,' ',''), REPLACE(${currentGroupNameExpr('a.group_name', 'a.line')},' ',''))
                AND l.date=a.date AND l.session_type='side'
                AND (l.side_session_category='regular' OR (l.duration IS NOT NULL AND LENGTH(l.duration)>=5
                     AND CAST(SUBSTR(l.duration,1,2) AS INTEGER)*60 + CAST(SUBSTR(l.duration,4,2) AS INTEGER) < 20))${qLineLit ? ' AND l.line=a.line' : ''}
            )
          ${qDateA}${notInternalGroup('a.group_name')}${qLineA}
          GROUP BY a.id
        ) sub WHERE coordinator IS NOT NULL GROUP BY coordinator
      `).all()
    : db.prepare(`
        SELECT coordinator, COALESCE(SUM(absent_count),0) AS cnt FROM (
          SELECT ${_dateAwareCoordQ('l', 'l.date')} AS coordinator,
            COUNT(*) - SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance!='' AND CAST(l.attendance AS INTEGER)>0 THEN 1 ELSE 0 END) AS absent_count
          FROM lectures l
          WHERE l.session_type='side' AND l.status='مؤكدة'
            AND (l.duration IS NULL OR l.duration <= '00:30') AND l.side_session_category='regular'
          ${qDateL}${notInternalGroup('l.group_name')}${qLineL}
          GROUP BY coordinator, l.group_name, l.date HAVING absent_count > 0
        ) sub GROUP BY coordinator
      `).all());

  // Query template parameters: ?, ?, ? = agent_name, from, to, [line]
  const result = agents.map(agent => {
    const agentName = agent.full_name;

    // 1. Open remarks (date filter optional)
    let openWhere = `WHERE LOWER(TRIM(r.assigned_to)) = LOWER(TRIM(?))
                     AND LOWER(r.status) NOT IN ('closed','مغلق','resolved','إنتهت')${lineRemarks}`;
    const openParams = [agentName];
    if (line) openParams.push(line);
    if (from) { openWhere += ` AND ${remarksDateExpr.replaceAll('added_at','r.added_at')} >= ?`; openParams.push(from); }
    if (to)   { openWhere += ` AND ${remarksDateExpr.replaceAll('added_at','r.added_at')} <= ?`; openParams.push(to); }
    const open_remarks_count = db.prepare(
      `SELECT COUNT(*) AS c FROM remarks r ${openWhere}`
    ).get(...openParams)?.c || 0;

    // 2. Attendance Main category remarks
    let mainWhere = `WHERE LOWER(TRIM(r.assigned_to)) = LOWER(TRIM(?))
                     AND r.category = 'Attendance Main Session'${lineRemarks}`;
    const mainParams = [agentName];
    if (line) mainParams.push(line);
    if (from) { mainWhere += ` AND ${remarksDateExpr.replaceAll('added_at','r.added_at')} >= ?`; mainParams.push(from); }
    if (to)   { mainWhere += ` AND ${remarksDateExpr.replaceAll('added_at','r.added_at')} <= ?`; mainParams.push(to); }
    const attendance_main_count = db.prepare(
      `SELECT COUNT(*) AS c FROM remarks r ${mainWhere}`
    ).get(...mainParams)?.c || 0;

    // 3. Attendance Side / Zoom Call remarks
    let sideWhere = `WHERE LOWER(TRIM(r.assigned_to)) = LOWER(TRIM(?))
                     AND r.category IN ('Attendance Zoom Call','Attendance Side Session')${lineRemarks}`;
    const sideParams = [agentName];
    if (line) sideParams.push(line);
    if (from) { sideWhere += ` AND ${remarksDateExpr.replaceAll('added_at','r.added_at')} >= ?`; sideParams.push(from); }
    if (to)   { sideWhere += ` AND ${remarksDateExpr.replaceAll('added_at','r.added_at')} <= ?`; sideParams.push(to); }
    const attendance_side_count = db.prepare(
      `SELECT COUNT(*) AS c FROM remarks r ${sideWhere}`
    ).get(...sideParams)?.c || 0;

    // 4. Attendance Task remarks (for completeness)
    let taskWhere = `WHERE LOWER(TRIM(r.assigned_to)) = LOWER(TRIM(?))
                     AND r.category = 'Attendance Task'${lineRemarks}`;
    const taskParams = [agentName];
    if (line) taskParams.push(line);
    if (from) { taskWhere += ` AND ${remarksDateExpr.replaceAll('added_at','r.added_at')} >= ?`; taskParams.push(from); }
    if (to)   { taskWhere += ` AND ${remarksDateExpr.replaceAll('added_at','r.added_at')} <= ?`; taskParams.push(to); }
    const attendance_task_count = db.prepare(
      `SELECT COUNT(*) AS c FROM remarks r ${taskWhere}`
    ).get(...taskParams)?.c || 0;

    // 5. Code problems fixed (status changed to resolved/wont_repeat/exception)
    //    Attribution: the agent who actually clicked "resolve" via the UI gets
    //    credit (cps.updated_by), NOT the current coordinator of the group.
    //    This way an agent who fixed a problem on their group keeps credit
    //    even if the coordinator later changes or the group ends.
    //    Records with NULL updated_by (legacy/import) don't count for anyone.
    let cpsWhere = `WHERE cps.status IN ('resolved','wont_repeat','exception')${lineCps}
                    AND cps.updated_by = ?`;
    const cpsParams = [];
    if (line) cpsParams.push(line);
    cpsParams.push(agent.id);
    if (from) { cpsWhere += ` AND date(cps.updated_at) >= ?`; cpsParams.push(from); }
    if (to)   { cpsWhere += ` AND date(cps.updated_at) <= ?`; cpsParams.push(to); }
    const code_problems_fixed = db.prepare(
      `SELECT COUNT(*) AS c FROM code_problem_status cps ${cpsWhere}`
    ).get(...cpsParams)?.c || 0;

    // 6+7. Main & Zoom absence — looked up from the per-coordinator maps built
    //    above, which reuse /attendance-absence's EXACT date-aware attribution
    //    (coordinator_history + employed roster member, single earliest
    //    coordinator, ended-group resilient). This guarantees the Quality page
    //    and /attendance-absence show the SAME number for every coordinator —
    //    including those whose groups have ended (e.g. shrouk gamal). Lookup by
    //    compact name (lowercase, spaces removed) tolerates spelling drift.
    const _ak = agentName.toLowerCase().replace(/\s/g, '');
    const main_absent_count   = mainAbsentByCoord.get(_ak)   || 0;
    const main_expected_count = mainExpectedByCoord.get(_ak) || 0;
    const main_absent_rate = main_expected_count > 0
      ? Math.round((main_absent_count / main_expected_count) * 100) : 0;
    const zoom_expected_count = zoomExpectedByCoord.get(_ak) || 0;
    const zoom_absent_count   = zoomAbsentByCoord.get(_ak)   || 0;
    const zoom_absent_rate = zoom_expected_count > 0
      ? Math.round((zoom_absent_count / zoom_expected_count) * 100) : 0;

    return {
      agent_id: agent.id,
      agent_name: agentName,
      department: agent.department,
      code_problems_fixed,
      attendance_main_count,
      attendance_side_count,
      attendance_task_count,
      open_remarks_count,
      total_remarks: attendance_main_count + attendance_side_count + attendance_task_count,
      main_absent_count,
      main_expected_count,
      main_absent_rate,
      zoom_absent_count,
      zoom_expected_count,
      zoom_absent_rate,
    };
  });

  // Summary across the filtered set
  const summary = {
    total_agents: result.length,
    total_code_fixed:  result.reduce((s, r) => s + r.code_problems_fixed, 0),
    total_main:        result.reduce((s, r) => s + r.attendance_main_count, 0),
    total_side:        result.reduce((s, r) => s + r.attendance_side_count, 0),
    total_task:        result.reduce((s, r) => s + r.attendance_task_count, 0),
    total_open:        result.reduce((s, r) => s + r.open_remarks_count, 0),
    total_main_absent: result.reduce((s, r) => s + r.main_absent_count, 0),
    total_zoom_absent: result.reduce((s, r) => s + r.zoom_absent_count, 0),
  };

  return res.json({ summary, rows: result, filters: { from, to, department: (activeDepts && activeDepts[0]) || 'All' } });
});

// ─── GET /api/reports/quality-employee/details ────────────────────────────────
// Drill-down: returns the actual records (clients/students/groups) for a given
// agent + metric type. Used by the Quality Reports modal.
//   agent      — required (full name)
//   type       — main | side | task | open | fixed | main_absent | zoom_absent
//   from, to   — date range (YYYY-MM-DD)
router.get('/quality-employee/details', (req, res) => {
  const { agent, type, from, to } = req.query;
  if (!agent || !type) return res.status(400).json({ error: 'agent and type required' });

  const line = lineFilter(req);
  const coordMatch = nameInListInline('b.coordinators', agent);

  // remarks date filter — handles both DD/MM/YYYY and ISO formats
  const remarksDateExpr = `CASE
    WHEN substr(r.added_at, 5, 1) = '-' THEN substr(r.added_at, 1, 10)
    WHEN substr(r.added_at, 3, 1) = '/' THEN substr(r.added_at, 7, 4) || '-' || substr(r.added_at, 4, 2) || '-' || substr(r.added_at, 1, 2)
    ELSE NULL
  END`;
  const lineRemarks = line ? ` AND r.line = ?` : '';

  function remarksByCategory(categories) {
    const params = [agent];
    if (line) params.push(line);
    let where = `WHERE LOWER(TRIM(r.assigned_to)) = LOWER(TRIM(?))${lineRemarks}
                 AND r.category IN (${categories.map(() => '?').join(',')})`;
    params.push(...categories);
    if (from) { where += ` AND ${remarksDateExpr} >= ?`; params.push(from); }
    if (to)   { where += ` AND ${remarksDateExpr} <= ?`; params.push(to); }
    return db.prepare(`
      SELECT r.id, r.client_name, r.client_phone, r.task_type, r.category, r.status,
             r.priority, r.added_at, r.last_updated, r.details
      FROM remarks r ${where}
      ORDER BY r.id DESC LIMIT 500
    `).all(...params);
  }

  if (type === 'main')  return res.json(remarksByCategory(['Attendance Main Session']));
  if (type === 'side')  return res.json(remarksByCategory(['Attendance Zoom Call', 'Attendance Side Session']));
  if (type === 'task')  return res.json(remarksByCategory(['Attendance Task']));

  if (type === 'open') {
    const params = [agent];
    if (line) params.push(line);
    let where = `WHERE LOWER(TRIM(r.assigned_to)) = LOWER(TRIM(?))${lineRemarks}
                 AND LOWER(r.status) NOT IN ('closed','مغلق','resolved','إنتهت')`;
    if (from) { where += ` AND ${remarksDateExpr} >= ?`; params.push(from); }
    if (to)   { where += ` AND ${remarksDateExpr} <= ?`; params.push(to); }
    const rows = db.prepare(`
      SELECT r.id, r.client_name, r.client_phone, r.task_type, r.category, r.status,
             r.priority, r.added_at, r.last_updated, r.details
      FROM remarks r ${where}
      ORDER BY r.id DESC LIMIT 500
    `).all(...params);
    return res.json(rows);
  }

  if (type === 'fixed') {
    // Drill-down list of records solved by this agent — uses cps.updated_by
    // (who actually clicked resolve), NOT current coordinator. Stays in sync
    // with the count shown in the main report.
    const userRow = db.prepare(
      `SELECT id FROM users WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(?)) LIMIT 1`
    ).get(agent);
    const agentId = userRow?.id;
    if (!agentId) return res.json([]);

    let where = `WHERE cps.status IN ('resolved','wont_repeat','exception') AND cps.updated_by = ?`;
    const params = [agentId];
    if (line) { where += ` AND cps.line = ?`; params.push(line); }
    if (from) { where += ` AND date(cps.updated_at) >= ?`; params.push(from); }
    if (to)   { where += ` AND date(cps.updated_at) <= ?`; params.push(to); }
    const rows = db.prepare(`
      SELECT cps.id, cps.group_name, cps.problem_type, cps.session_type, cps.status,
             cps.note, cps.new_group_code, cps.updated_at,
             u.full_name AS updated_by_name
      FROM code_problem_status cps
      LEFT JOIN users u ON u.id = cps.updated_by
      ${where}
      ORDER BY cps.updated_at DESC LIMIT 500
    `).all(...params);
    return res.json(rows);
  }

  if (type === 'main_absent') {
    // Part 1: rows from absent_students table — mirrors /attendance-absence Part 1:
    //   • resolves missing a.date via lecture_no → ROW_NUMBER over main lectures
    //   • only includes rows with student_name OR a phone that maps to a real client
    //   • filters by RESOLVED date so rows with empty date land in the right window
    const lineLecD = line ? ` AND line = '${line.replace(/'/g, "''")}'` : '';
    const dateResolvedFilterD = (from && to)
      ? ` AND resolved_date BETWEEN '${from}' AND '${to}'`
      : from ? ` AND resolved_date >= '${from}'`
      : to   ? ` AND resolved_date <= '${to}'`
      : '';
    const part1Rows = db.prepare(`
      SELECT id, source, student_name, phone, group_name, date, time, lecture_no,
             follow_up_status, follow_up_note
      FROM (
        SELECT a.id, 'manual' AS source,
               COALESCE(c_lu.name, NULLIF(TRIM(a.student_name),'')) AS student_name,
               a.phone, a.group_name,
               COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS date,
               COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS resolved_date,
               a.time, a.lecture_no,
               a.follow_up_status, a.follow_up_note
        FROM absent_students a
        INNER JOIN batches b ON b.group_name = a.group_name${line ? ' AND b.line = a.line' : ''}
        LEFT JOIN clients c_lu ON (a.student_name IS NULL OR TRIM(a.student_name)='')
          AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND (c_lu.phone = a.phone OR c_lu.phone = '0' || a.phone OR a.phone = '0' || c_lu.phone)
        LEFT JOIN (
          SELECT group_name, date, line,
            ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
          FROM lectures WHERE session_type='main' AND status != 'غير مؤكدة'${lineLecD}
        ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
          AND lec_inf.group_name = a.group_name
          AND a.lecture_no IS NOT NULL
          AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
        WHERE (
          (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
          OR (a.phone IS NOT NULL AND TRIM(a.phone)!='')
        )
        AND ${coordMatch}${notInternalGroup('a.group_name')}
      ) p1
      WHERE 1=1${dateResolvedFilterD}
      ORDER BY date DESC LIMIT 250
    `).all();

    // Part 2: clients in groups whose main lecture had empty attendance
    //         (treated as everyone-absent), and not already in absent_students
    const part2Params = [];
    if (line) part2Params.push(line);
    let part2Where = `WHERE l.session_type = 'main' AND l.status = 'مؤكدة'
                      AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
                      AND c.name IS NOT NULL AND TRIM(c.name) != ''
                      AND c.phone IS NOT NULL AND TRIM(c.phone) != ''
                      AND NOT EXISTS (
                        SELECT 1 FROM absent_students a2
                        WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
                      )
                      AND ${coordMatch}${notInternalGroup('l.group_name')}`;
    if (line) part2Where += ` AND l.line = ?`;
    if (from) { part2Where += ` AND l.date >= ?`; part2Params.push(from); }
    if (to)   { part2Where += ` AND l.date <= ?`; part2Params.push(to); }
    const part2Rows = db.prepare(`
      SELECT NULL AS id, 'auto' AS source,
             c.name AS student_name, c.phone, l.group_name, l.date, l.time,
             NULL AS lecture_no, 'pending' AS follow_up_status, NULL AS follow_up_note
      FROM lectures l
      INNER JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
      INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
      ${part2Where}
      ORDER BY l.date DESC LIMIT 250
    `).all(...part2Params);

    return res.json([...part1Rows, ...part2Rows]);
  }

  if (type === 'zoom_absent') {
    // Show absent_zoom_students rows (manual upload) PLUS clients in side
    // sessions with attendance < expected slots.
    const part1Params = [];
    if (line) part1Params.push(line);
    let part1Where = `WHERE 1=1 AND ${coordMatch}${notInternalGroup('a.group_name')}`;
    if (line) part1Where += ` AND a.line = ?`;
    if (from) { part1Where += ` AND a.date >= ?`; part1Params.push(from); }
    if (to)   { part1Where += ` AND a.date <= ?`; part1Params.push(to); }
    const rows = db.prepare(`
      SELECT a.id, 'manual' AS source,
             COALESCE((SELECT c.name FROM clients c WHERE c.phone = a.phone LIMIT 1),
                      NULLIF(TRIM(a.student_name),'')) AS student_name,
             a.phone, a.group_name, a.date, a.time, a.lecture_no,
             a.follow_up_status, a.follow_up_note
      FROM absent_zoom_students a
      INNER JOIN batches b ON REPLACE(b.group_name,' ','') = REPLACE(a.group_name,' ','')${line ? ' AND b.line = a.line' : ''}
      ${part1Where}
      ORDER BY a.date DESC LIMIT 500
    `).all(...part1Params);
    return res.json(rows);
  }

  return res.status(400).json({ error: 'Invalid type' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUALITY REPORT SNAPSHOTS — frozen, immutable copies of the report
// ═══════════════════════════════════════════════════════════════════════════════
// Once saved, a snapshot's numbers do NOT change even when Excel files are
// re-uploaded. Useful for end-of-month reviews, audits, sharing with managers.

// POST /api/reports/quality-snapshot — freeze the report data the user is
// currently viewing. Frontend sends the already-computed summary/rows/dept
// averages so the snapshot is exactly what the user saw on screen.
//   body: { label, from, to, department, notes, summary, rows, dept_averages }
router.post('/quality-snapshot', (req, res) => {
  if (!['admin', 'leader'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Admin or leader role required' });
  }

  const { label, from, to, department, notes,
          summary, rows, dept_averages, is_official } = req.body || {};

  if (!label || !label.trim()) {
    return res.status(400).json({ error: 'label is required' });
  }
  if (from && !isValidISODate(from)) {
    return res.status(400).json({ error: `Invalid 'from' date: ${from}` });
  }
  if (to && !isValidISODate(to)) {
    return res.status(400).json({ error: `Invalid 'to' date: ${to}` });
  }
  if (!summary || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'summary + rows are required' });
  }

  const line = lineFilter(req);

  try {
    const officialFlag = is_official ? 1 : 0;

    const result = db.prepare(`
      INSERT INTO quality_report_snapshots
        (snapshot_label, from_date, to_date, department_filter, line,
         summary_json, rows_json, dept_averages_json, notes,
         frozen_by, frozen_by_name, is_official)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      label.trim(),
      from || null, to || null,
      department || 'All',
      line || 'Ahmed Hassan',
      JSON.stringify(summary),
      JSON.stringify(rows),
      JSON.stringify(dept_averages || []),
      (notes && notes.trim()) || null,
      req.user?.id || null,
      req.user?.full_name || req.user?.username || null,
      officialFlag,
    );

    // If marked official, demote any other "official" snapshot covering the
    // same period+line+dept_filter so we never have two official truths.
    if (officialFlag && from && to) {
      db.prepare(`
        UPDATE quality_report_snapshots
        SET is_official = 0
        WHERE id != ? AND is_official = 1
          AND from_date = ? AND to_date = ?
          AND line = ? AND department_filter = ?
      `).run(
        result.lastInsertRowid,
        from, to,
        line || 'Ahmed Hassan',
        department || 'All',
      );
    }

    if (typeof saveNow === 'function') saveNow();

    return res.json({
      success: true,
      id: result.lastInsertRowid,
      rows_count: rows.length,
    });
  } catch (err) {
    console.error('[reports] quality-snapshot freeze error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/quality-snapshots — list all snapshots (header info only)
router.get('/quality-snapshots', (req, res) => {
  if (!['admin', 'leader'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Admin or leader role required' });
  }
  const line = lineFilter(req);
  const lineFilt = line ? ' WHERE line = ?' : '';
  const params = line ? [line] : [];

  const rows = db.prepare(`
    SELECT id, snapshot_label, from_date, to_date, department_filter, line,
           notes, frozen_by, frozen_by_name, frozen_at, is_official
    FROM quality_report_snapshots${lineFilt}
    ORDER BY is_official DESC, frozen_at DESC LIMIT 500
  `).all(...params);

  return res.json(rows);
});

// PATCH /api/reports/quality-snapshot/:id/official — admin only, toggle the
// "Official End-of-Period" flag. When turning ON, demotes any other official
// snapshot for the same period+line+dept_filter.
router.patch('/quality-snapshot/:id/official', (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const { is_official } = req.body || {};
  const flag = is_official ? 1 : 0;

  const snap = db.prepare(`SELECT * FROM quality_report_snapshots WHERE id = ?`).get(id);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });

  db.prepare(`UPDATE quality_report_snapshots SET is_official = ? WHERE id = ?`).run(flag, id);

  if (flag && snap.from_date && snap.to_date) {
    // Demote others
    db.prepare(`
      UPDATE quality_report_snapshots
      SET is_official = 0
      WHERE id != ? AND is_official = 1
        AND from_date = ? AND to_date = ?
        AND line = ? AND department_filter = ?
    `).run(id, snap.from_date, snap.to_date, snap.line, snap.department_filter);
  }

  if (typeof saveNow === 'function') saveNow();
  return res.json({ success: true, is_official: flag });
});

// GET /api/reports/quality-snapshot/:id — full data for one snapshot
router.get('/quality-snapshot/:id', (req, res) => {
  if (!['admin', 'leader'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Admin or leader role required' });
  }
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const row = db.prepare(`SELECT * FROM quality_report_snapshots WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Snapshot not found' });

  return res.json({
    id: row.id,
    snapshot_label: row.snapshot_label,
    from_date: row.from_date,
    to_date: row.to_date,
    department_filter: row.department_filter,
    line: row.line,
    notes: row.notes,
    frozen_by: row.frozen_by,
    frozen_by_name: row.frozen_by_name,
    frozen_at: row.frozen_at,
    is_official: row.is_official || 0,
    summary: JSON.parse(row.summary_json || '{}'),
    rows: JSON.parse(row.rows_json || '[]'),
    dept_averages: JSON.parse(row.dept_averages_json || '[]'),
  });
});

// DELETE /api/reports/quality-snapshot/:id — admin only
router.delete('/quality-snapshot/:id', (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const result = db.prepare(`DELETE FROM quality_report_snapshots WHERE id = ?`).run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Snapshot not found' });
  saveNow && saveNow();

  return res.json({ success: true });
});

// ─── GET /api/reports/quality-diagnostic ──────────────────────────────────────
// Forensic breakdown of how Solve Mistakes + Main Absent are being computed RIGHT
// NOW. Use this when totals drift after re-uploading lectures/batches/remarks
// — it shows WHICH records contribute and WHICH coordinators they're attributed
// to, so you can pinpoint exactly what changed in the data.
//
// Query params:
//   from, to        — required (YYYY-MM-DD)
//   department      — optional (General/Private/Semi)
router.get('/quality-diagnostic', (req, res) => {
  const { from, to, department } = req.query;
  const line = lineFilter(req);

  if (!isValidISODate(from) || !isValidISODate(to) || !from || !to) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
  }

  const lineL  = line ? ` AND l.line = '${line.replace(/'/g, "''")}'` : '';
  const lineB  = line ? ` AND b.line = '${line.replace(/'/g, "''")}'` : '';
  const lineC  = line ? ` AND c.line = '${line.replace(/'/g, "''")}'` : '';
  const lineA  = line ? ` AND a.line = '${line.replace(/'/g, "''")}'` : '';
  const lineCps= line ? ` AND cps.line = '${line.replace(/'/g, "''")}'` : '';
  const lineLec= line ? ` AND line = '${line.replace(/'/g, "''")}'` : '';

  const deptFilterB = department && department !== 'All'
    ? ` AND b.dept_type = '${department.replace(/'/g, "''")}'`
    : '';

  try {
    // ═══════════════════════════════════════════════════════════════
    // SOLVE MISTAKES — every CPS record in the date range, attributed
    // to the SOLVER (cps.updated_by), with the current coordinator + the
    // solver's dept also surfaced for context. Orphans = records with
    // NULL updated_by (legacy/import without a known solver).
    // ═══════════════════════════════════════════════════════════════
    const deptFilterSolver = department && department !== 'All'
      ? ` AND u.department = '${department.replace(/'/g, "''")}'`
      : '';

    const solveMistakesAll = db.prepare(`
      SELECT cps.id, cps.group_name, cps.problem_type, cps.status,
             cps.updated_at, cps.updated_by,
             u.full_name AS solver_name,
             u.department AS solver_dept,
             b.coordinators AS current_coordinator,
             b.dept_type AS current_batch_dept
      FROM code_problem_status cps
      LEFT JOIN users u ON u.id = cps.updated_by
      LEFT JOIN batches b ON b.group_name = cps.group_name${lineB}
      WHERE cps.status IN ('resolved','wont_repeat','exception')
        AND date(cps.updated_at) BETWEEN '${from}' AND '${to}'${lineCps}${deptFilterSolver}
      ORDER BY cps.updated_at DESC
    `).all();

    // Orphans = NULL updated_by (no known solver)
    const solveMistakesOrphans = solveMistakesAll.filter(r => !r.updated_by);

    // CPS records grouped by SOLVER (the agent who actually clicked resolve)
    const solveMistakesBySolver = {};
    solveMistakesAll.forEach(r => {
      const k = r.solver_name || '(NULL updated_by — unattributed)';
      solveMistakesBySolver[k] = (solveMistakesBySolver[k] || 0) + 1;
    });

    // ═══════════════════════════════════════════════════════════════
    // MAIN ABSENT — Part 1 + Part 2 broken down by coordinator
    // ═══════════════════════════════════════════════════════════════

    // Part 1: absent_students records (manual upload of الغيابات)
    const part1All = db.prepare(`
      SELECT * FROM (
        SELECT a.id,
               COALESCE(c_lu.name, NULLIF(TRIM(a.student_name),'')) AS student_name,
               a.phone, a.group_name,
               COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS resolved_date,
               a.date AS raw_date, a.lecture_no,
               b.coordinators AS current_coordinator, b.dept_type
        FROM absent_students a
        LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
        LEFT JOIN clients c_lu ON (a.student_name IS NULL OR TRIM(a.student_name)='')
          AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND (c_lu.phone = a.phone OR c_lu.phone = '0' || a.phone OR a.phone = '0' || c_lu.phone)
        LEFT JOIN (
          SELECT group_name, date, line,
            ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
          FROM lectures WHERE session_type='main' AND status != 'غير مؤكدة'${lineLec}
        ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
          AND lec_inf.group_name = a.group_name
          AND a.lecture_no IS NOT NULL
          AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
        WHERE (
          (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
          OR (a.phone IS NOT NULL AND TRIM(a.phone)!='')
        )${lineA}${deptFilterB}
      ) p1
      WHERE resolved_date BETWEEN '${from}' AND '${to}'
      ORDER BY resolved_date DESC
    `).all();

    const part1ByCoord = {};
    part1All.forEach(r => {
      const k = r.current_coordinator || '(NO COORDINATOR — orphan)';
      part1ByCoord[k] = (part1ByCoord[k] || 0) + 1;
    });

    // Part 2: confirmed main lectures with empty attendance, × clients in group
    const part2All = db.prepare(`
      SELECT l.group_name, l.date, l.line, l.status, l.attendance,
             c.name AS client_name, c.phone AS client_phone,
             b.coordinators AS current_coordinator, b.dept_type
      FROM lectures l
      INNER JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}${deptFilterB}
      INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
      WHERE l.session_type = 'main' AND l.status = 'مؤكدة'
        AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
        AND c.name IS NOT NULL AND TRIM(c.name) != ''
        AND c.phone IS NOT NULL AND TRIM(c.phone) != ''
        AND NOT EXISTS (
          SELECT 1 FROM absent_students a2
          WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
        )
        AND l.date BETWEEN '${from}' AND '${to}'${lineL}
      ORDER BY l.date DESC
    `).all();

    const part2ByCoord = {};
    part2All.forEach(r => {
      const k = r.current_coordinator || '(NO COORDINATOR — orphan)';
      part2ByCoord[k] = (part2ByCoord[k] || 0) + 1;
    });

    // Aggregated dept-level totals — for Solve Mistakes, dept comes from the
    // SOLVER's registered department (not the batch dept_type), since solver
    // is now the source of truth for attribution.
    const deptTotals = {};
    [...solveMistakesAll].forEach(r => {
      const d = r.solver_dept || '(NULL DEPT — orphan)';
      if (!deptTotals[d]) deptTotals[d] = { solve_mistakes: 0, main_absent_p1: 0, main_absent_p2: 0 };
      deptTotals[d].solve_mistakes++;
    });
    part1All.forEach(r => {
      const d = r.dept_type || '(NULL DEPT)';
      if (!deptTotals[d]) deptTotals[d] = { solve_mistakes: 0, main_absent_p1: 0, main_absent_p2: 0 };
      deptTotals[d].main_absent_p1++;
    });
    part2All.forEach(r => {
      const d = r.dept_type || '(NULL DEPT)';
      if (!deptTotals[d]) deptTotals[d] = { solve_mistakes: 0, main_absent_p1: 0, main_absent_p2: 0 };
      deptTotals[d].main_absent_p2++;
    });

    // ═══════════════════════════════════════════════════════════════
    // FILE FRESHNESS — when was each table last touched?
    // ═══════════════════════════════════════════════════════════════
    const fileFreshness = db.prepare(`
      SELECT file_type, last_synced_at, records_imported
      FROM excel_sync_log
      WHERE id IN (SELECT MAX(id) FROM excel_sync_log GROUP BY file_type)
      ORDER BY last_synced_at DESC
    `).all();

    return res.json({
      filters: { from, to, department: department || 'All', line: line || 'All' },

      solve_mistakes: {
        total: solveMistakesAll.length,
        orphans_count: solveMistakesOrphans.length,
        by_solver: solveMistakesBySolver,         // ← new: attribution by solver
        by_coordinator: solveMistakesBySolver,    // ← keep alias for backward-compat with old UI
        records: solveMistakesAll,
        orphan_records: solveMistakesOrphans,     // CPS with NULL updated_by
      },

      main_absent: {
        total: part1All.length + part2All.length,
        part1_count: part1All.length,
        part2_count: part2All.length,
        part1_by_coordinator: part1ByCoord,
        part2_by_coordinator: part2ByCoord,
        part1_records: part1All,
        part2_records: part2All.slice(0, 500), // cap at 500 for response size
        part2_truncated: part2All.length > 500,
      },

      dept_totals: deptTotals,
      file_freshness: fileFreshness,
    });
  } catch (err) {
    console.error('[reports] quality-diagnostic:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
