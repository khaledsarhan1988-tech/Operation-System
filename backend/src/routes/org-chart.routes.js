'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { nameInListInline } = require('../utils/nameMatch');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// ─── COORDINATOR TYPES + CAPACITY RULES ───────────────────────────────────────
// Source of truth for the two coordinator categories the business defines:
//
//   • standard   → منسق (طلاب فقط)              — capacity 80..120
//   • multi_task → منسق متعدد المهام (طلاب + تاسكات) — capacity 70..85
//
// Capacity status is computed from a member's current customer_count:
//   • under → below the type's min
//   • ok    → within [min, max]
//   • over  → above the type's max
//
// We deliberately classify *only on customer_count* (not group_count) because
// the business sets the limits in terms of trainees.
const COORDINATOR_TYPES = {
  standard: {
    code:     'standard',
    label_ar: 'منسق',
    label_en: 'Coordinator',
    capacity_min: 80,
    capacity_max: 120,
  },
  multi_task: {
    code:     'multi_task',
    label_ar: 'منسق متعدد المهام',
    label_en: 'Multi-task Coordinator',
    capacity_min: 70,
    capacity_max: 85,
  },
  // Marker type: coordinator is on temporary leave. Their batches stay in
  // the DB (admin reassigns them via the simulation feature) but in every
  // org-chart view their effective counts are forced to 0 so the cards
  // accurately reflect "not currently working".
  on_leave: {
    code:     'on_leave',
    label_ar: 'منسق خارج العمل حالياً (إجازة)',
    label_en: 'On Leave',
    capacity_min: 0,
    capacity_max: 0,
  },
};
const VALID_TYPES = Object.keys(COORDINATOR_TYPES);

function classifyCapacity(type, customerCount) {
  const cfg = COORDINATOR_TYPES[type];
  if (!cfg) return { status: 'unknown', min: null, max: null };
  // On-leave coordinators get their own status — they're not "under" capacity,
  // they're just off the schedule. Frontend renders them differently.
  if (type === 'on_leave') return { status: 'on_leave', min: 0, max: 0 };
  const n = customerCount || 0;
  let status = 'ok';
  if (n < cfg.capacity_min) status = 'under';
  else if (n > cfg.capacity_max) status = 'over';
  return { status, min: cfg.capacity_min, max: cfg.capacity_max };
}

// ─── GET /api/org-chart/customer-services ─────────────────────────────────────
// Returns the 4-column org chart for إدارة خدمة العملاء:
//   عام (General) / خاص (Private) / شبه خاص (Semi) / مواعيد (Appointments)
//
// Per column:
//   • Leader: users.role='leader' matched on users.department.
//   • Members: team_members. Columns 1-3 are sections within
//     department='customer_services'. Column 4 is the separate
//     department='appointments' (any section).
//
// Per member:
//   • customer_count → trainees in active batches the member coordinates
//     (clients table = current Active Batches Trainees roster, intersected
//     with batches.status='نشطة' to guarantee active-only attribution).
//   • group_count    → active batches the member coordinates.
//   • Both are NULL for the 'appointments' column — count logic not yet
//     defined for that dept by the business.
//
// Role scoping:
//   • admin → full 4-column view.
//   • leader → only the section matching their users.department.
router.get('/customer-services', (req, res) => {
  try {
    // tm_line filter (when set) restricts the members query to a specific
    // operational line — used to split "خاص" into main + Dardasha columns.
    // The leader (Mostafa for Private) appears at the top of BOTH columns
    // since one leader oversees the whole Private dept regardless of line.
    const sections = [
      { key: 'general',          label: 'عام',         dept_users: 'General',     tm_dept: 'customer_services', tm_section: 'general', tm_line: 'Ahmed Hassan' },
      { key: 'private',          label: 'خاص',         dept_users: 'Private',     tm_dept: 'customer_services', tm_section: 'private', tm_line: 'Ahmed Hassan' },
      { key: 'private_dardasha', label: 'خاص دردشة',   dept_users: 'Private',     tm_dept: 'customer_services', tm_section: 'private', tm_line: 'Dardasha' },
      { key: 'semi',             label: 'شبه خاص',     dept_users: 'Semi',        tm_dept: 'customer_services', tm_section: 'semi',    tm_line: 'Ahmed Hassan' },
      { key: 'appointments',     label: 'مواعيد',      dept_users: 'Appointments',tm_dept: 'appointments',      tm_section: null,      tm_line: null           },
    ];

    // Filter to the leader's own section(s) so each team-leader sees only
    // the columns they actually own. Admins get all. A leader can oversee
    // multiple sections via users.extra_departments (comma-separated).
    let visibleSections = sections;
    if (req.user?.role === 'leader') {
      // Read extra_departments from DB — JWT only carries `department`.
      const u = db.prepare(
        `SELECT department, extra_departments FROM users WHERE id = ?`
      ).get(req.user.id) || {};
      const primary = String(u.department || req.user.department || '').trim().toLowerCase();
      const extras = String(u.extra_departments || '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const allDepts = new Set([primary, ...extras].filter(Boolean));
      visibleSections = sections.filter(s => allDepts.has(s.dept_users.toLowerCase()));
      if (!visibleSections.length) {
        return res.json({
          sections: [],
          viewer_role: 'leader',
          warning: `لا يوجد قسم يطابق صلاحيتك (primary='${u.department}', extra='${u.extra_departments || ''}')`,
        });
      }
    }

    // Match a leader to a section using EITHER their primary `department`
    // OR a token-exact match in `extra_departments` (a comma-separated list
    // of additional sections they oversee). The token-match wraps the column
    // in commas on both sides so a search for 'General' never matches
    // 'GeneralSomething'. Case-insensitive, whitespace-tolerant.
    const leaderStmt = db.prepare(
      `SELECT id, full_name AS name FROM users
        WHERE role='leader' AND is_active=1
          AND (
            department = ? COLLATE NOCASE
            OR (',' || REPLACE(REPLACE(IFNULL(extra_departments, ''), ', ', ','), ' ,', ',') || ',')
                 LIKE ('%,' || ? || ',%') COLLATE NOCASE
          )
        ORDER BY
          CASE WHEN department = ? COLLATE NOCASE THEN 0 ELSE 1 END,
          id
        LIMIT 1`
    );
    // Section + line variants: callers pick the right prepared statement
    // based on whether a section / line filter applies.
    // `line='All'` rows are line-agnostic (typically education trainers) —
    // they must appear in every line's view, so we match either the requested
    // line OR 'All'.
    const membersWithSectionAndLine = db.prepare(
      `SELECT id, name, job_title, coordinator_type FROM team_members
        WHERE status='active' AND department = ? AND section = ?
          AND (line = ? OR line = 'All')
        ORDER BY name COLLATE NOCASE`
    );
    const membersWithSection = db.prepare(
      `SELECT id, name, job_title, coordinator_type FROM team_members
        WHERE status='active' AND department = ? AND section = ?
        ORDER BY name COLLATE NOCASE`
    );
    const membersNoSection = db.prepare(
      `SELECT id, name, job_title, coordinator_type FROM team_members
        WHERE status='active' AND department = ?
        ORDER BY name COLLATE NOCASE`
    );

    const result = visibleSections.map((s) => {
      // Pass dept 3 times: primary match, extra_departments token match,
      // and ORDER BY tiebreaker (prefers primary over extra).
      const leader = leaderStmt.get(s.dept_users, s.dept_users, s.dept_users) || null;
      const rawMembers = s.tm_section
        ? (s.tm_line
            ? membersWithSectionAndLine.all(s.tm_dept, s.tm_section, s.tm_line)
            : membersWithSection.all(s.tm_dept, s.tm_section))
        : membersNoSection.all(s.tm_dept);

      // If the section's leader is ALSO listed in team_members (registered in
      // both users + directory), hide them from the members list — they
      // already appear at the top as "القائد". Case-insensitive + trimmed
      // match so minor formatting differences don't cause a duplicate.
      const leaderKey = leader?.name ? String(leader.name).trim().toLowerCase() : null;
      const members = leaderKey
        ? rawMembers.filter((m) => String(m.name).trim().toLowerCase() !== leaderKey)
        : rawMembers;

      const enriched = members.map((m) => {
        let customer_count = null;
        let group_count = null;
        if (s.key !== 'appointments') {
          // Customer count: trainees in ACTIVE batches coordinated by this person.
          const cRow = db.prepare(
            `SELECT COUNT(DISTINCT c.id) AS cnt
               FROM clients c
               INNER JOIN batches b ON c.group_name = b.group_name AND c.line = b.line
              WHERE b.status = 'نشطة'
                AND ${nameInListInline('b.coordinators', m.name)}`
          ).get();
          customer_count = cRow?.cnt ?? 0;

          // Group count: distinct ACTIVE batches coordinated by this person.
          const gRow = db.prepare(
            `SELECT COUNT(DISTINCT b.group_name || '|' || b.line) AS cnt
               FROM batches b
              WHERE b.status = 'نشطة'
                AND ${nameInListInline('b.coordinators', m.name)}`
          ).get();
          group_count = gRow?.cnt ?? 0;
        }

        // Resolve coordinator_type (fall back to standard for legacy rows
        // where the column might be NULL after restore from old snapshots).
        const type = VALID_TYPES.includes(m.coordinator_type)
          ? m.coordinator_type
          : 'standard';

        // On-leave override: force displayed counts to 0 regardless of any
        // batches still tagged with this coordinator's name. They've stepped
        // away — the admin should run the Leave/Transfer simulation to
        // actually reassign the batches; meanwhile the card tells the truth.
        // We expose the original numbers as `pending_*` so the UI can hint
        // "X groups still need reassignment".
        let displayed_customer_count = customer_count;
        let displayed_group_count    = group_count;
        let pending_customer_count   = null;
        let pending_group_count      = null;
        if (type === 'on_leave' && s.key !== 'appointments') {
          pending_customer_count   = customer_count;
          pending_group_count      = group_count;
          displayed_customer_count = 0;
          displayed_group_count    = 0;
        }

        const typeCfg = COORDINATOR_TYPES[type];
        const capacity = (s.key !== 'appointments')
          ? classifyCapacity(type, displayed_customer_count)
          : { status: null, min: null, max: null };

        return {
          id: m.id,
          name: m.name,
          job_title: m.job_title,
          coordinator_type: type,
          coordinator_label: typeCfg.label_ar,
          capacity_min: capacity.min,
          capacity_max: capacity.max,
          capacity_status: capacity.status,  // 'under'|'ok'|'over'|'on_leave'|null
          customer_count: displayed_customer_count,
          group_count:    displayed_group_count,
          // Only non-null when on_leave with batches still tagged to them
          pending_customer_count,
          pending_group_count,
        };
      });

      return {
        key: s.key,
        label: s.label,
        leader,                          // { id, name } | null
        members: enriched,
        total_customers: s.key === 'appointments'
          ? null
          : enriched.reduce((sum, m) => sum + (m.customer_count || 0), 0),
        total_groups: s.key === 'appointments'
          ? null
          : enriched.reduce((sum, m) => sum + (m.group_count || 0), 0),
      };
    });

    return res.json({ sections: result, viewer_role: req.user?.role || null });
  } catch (err) {
    console.error('[org-chart] customer-services error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── HELPERS for transfer simulation ──────────────────────────────────────────

const SECTION_TO_USERS_DEPT = {
  general: 'General',
  private: 'Private',
  semi:    'Semi',
};

// Get a member's batches with per-batch customer count, restricted to ACTIVE batches.
function getMemberBatches(memberName) {
  return db.prepare(
    `SELECT b.group_name,
            b.line,
            COALESCE(
              (SELECT COUNT(DISTINCT c.id)
                 FROM clients c
                WHERE c.group_name = b.group_name AND c.line = b.line),
              0
            ) AS customer_count
       FROM batches b
      WHERE b.status = 'نشطة'
        AND ${nameInListInline('b.coordinators', memberName)}
      ORDER BY customer_count DESC, b.group_name`
  ).all();
}

// Sum of customers across a member's active batches.
function getMemberCustomerCount(memberName) {
  const row = db.prepare(
    `SELECT COUNT(DISTINCT c.id) AS cnt
       FROM clients c
       INNER JOIN batches b ON c.group_name = b.group_name AND c.line = b.line
      WHERE b.status = 'نشطة'
        AND ${nameInListInline('b.coordinators', memberName)}`
  ).get();
  return row?.cnt ?? 0;
}

// Collect EVERY name in the system that represents a leadership role. A
// leader/manager/supervisor is never a valid coordinator-transfer recipient
// or donor, even if they also appear in team_members. We collect from two
// sources, normalized to lowercase trimmed for stable matching:
//
//   1. users with role IN ('leader','admin') and is_active=1 — covers both
//      "team leader" (role='leader') and "department manager" (role='admin'
//      with management-scoped department). Department comparison is dropped
//      entirely so we don't depend on case/whitespace agreement.
//
//   2. team_members whose job_title indicates leadership (Arabic + English
//      keywords). Catches leaders that exist only in the directory and were
//      never given a system login.
function getLeaderAndManagerNames() {
  const set = new Set();
  const norm = (s) => String(s || '').trim().toLowerCase();

  try {
    const userRows = db.prepare(
      `SELECT DISTINCT full_name FROM users
        WHERE is_active=1 AND role IN ('leader','admin')`
    ).all();
    userRows.forEach((r) => r.full_name && set.add(norm(r.full_name)));
  } catch (_) { /* table might not exist on first boot */ }

  try {
    const tmRows = db.prepare(
      `SELECT DISTINCT name FROM team_members
        WHERE status='active' AND job_title IS NOT NULL
          AND (
               LOWER(job_title) LIKE '%leader%'
            OR LOWER(job_title) LIKE '%lead'
            OR LOWER(job_title) LIKE 'lead %'
            OR LOWER(job_title) LIKE '%manager%'
            OR LOWER(job_title) LIKE '%supervisor%'
            OR job_title LIKE '%قائد%'
            OR job_title LIKE '%مدير%'
            OR job_title LIKE '%مشرف%'
            OR job_title LIKE '%رئيس%'
          )`
    ).all();
    tmRows.forEach((r) => r.name && set.add(norm(r.name)));
  } catch (_) { /* schema might not have job_title yet */ }

  return set;
}

// Fetch the team leader's name for a section using the SAME query pattern as
// the org-chart column header — guarantees both views agree on who's the
// leader (regardless of case/whitespace in users.department).
function getSectionLeaderName(section) {
  const usersDept = SECTION_TO_USERS_DEPT[section];
  if (!usersDept) return null;
  // Same dual-match as the org-chart leaderStmt: primary department OR
  // a token in extra_departments. Stays consistent with the column view.
  const row = db.prepare(
    `SELECT full_name FROM users
      WHERE role='leader' AND is_active=1
        AND (
          department = ? COLLATE NOCASE
          OR (',' || REPLACE(REPLACE(IFNULL(extra_departments, ''), ', ', ','), ' ,', ',') || ',')
               LIKE ('%,' || ? || ',%') COLLATE NOCASE
        )
      ORDER BY
        CASE WHEN department = ? COLLATE NOCASE THEN 0 ELSE 1 END,
        id
      LIMIT 1`
  ).get(usersDept, usersDept, usersDept);
  return row?.full_name || null;
}

// Active customer-services team members in a given section, with optional
// per-call exclusions on top of the system-wide leader/manager set.
function getSectionMembers(section, excludeNames = []) {
  const excludeSet = getLeaderAndManagerNames();
  excludeNames
    .filter(Boolean)
    .forEach((n) => excludeSet.add(String(n).trim().toLowerCase()));
  const rows = db.prepare(
    `SELECT id, name FROM team_members
      WHERE status='active' AND department='customer_services' AND section = ?
      ORDER BY name COLLATE NOCASE`
  ).all(section);
  return rows.filter((m) => !excludeSet.has(String(m.name).trim().toLowerCase()));
}

// Source-side: redistribute Ali's groups among remaining section members so
// projected customer totals stay as balanced as possible (Longest Processing
// Time heuristic — assign each group to the member with the lowest projected
// load). Returns annotated groups + per-member before/after snapshot.
function planSourceRedistribution(aliGroups, remainingMembers) {
  // Initial projected counts = each member's current customer count
  const state = remainingMembers.map((m) => ({
    id: m.id,
    name: m.name,
    before_count: getMemberCustomerCount(m.name),
    before_groups: getMemberBatches(m.name).length,
    after_count: 0,
    after_groups: 0,
    received: [],
  }));
  state.forEach((s) => { s.after_count = s.before_count; s.after_groups = s.before_groups; });

  const assignments = [];
  if (state.length === 0) {
    // No-one to absorb — surface every group as "unassigned"
    aliGroups.forEach((g) => {
      assignments.push({ group_name: g.group_name, line: g.line, customer_count: g.customer_count, recipient_name: null });
    });
    return { assignments, member_summary: state };
  }

  // Sort Ali's groups by customer count DESC — assigning largest first
  // gives the best balance under LPT.
  const sorted = [...aliGroups].sort((a, b) => b.customer_count - a.customer_count);
  for (const g of sorted) {
    state.sort((a, b) => a.after_count - b.after_count);
    const recipient = state[0];
    recipient.after_count += g.customer_count;
    recipient.after_groups += 1;
    recipient.received.push({ group_name: g.group_name, line: g.line, customer_count: g.customer_count });
    assignments.push({ group_name: g.group_name, line: g.line, customer_count: g.customer_count, recipient_name: recipient.name });
  }

  return { assignments, member_summary: state };
}

// Target-side: simulate Ali joining a new section. Each existing member donates
// some of their batches (smallest first to minimize disruption) until they
// reach the fair-share threshold OR Ali reaches it. Returns groups Ali receives
// + per-member before/after snapshot.
function planTargetRedistribution(aliName, targetMembers) {
  const state = targetMembers.map((m) => {
    const groups = getMemberBatches(m.name).sort((a, b) => a.customer_count - b.customer_count);
    const before_count = groups.reduce((s, g) => s + g.customer_count, 0);
    return { id: m.id, name: m.name, groups, before_count, before_groups: groups.length, after_count: before_count, after_groups: groups.length, donated: [] };
  });

  const totalCustomers = state.reduce((s, m) => s + m.before_count, 0);
  const target = state.length > 0 ? Math.floor(totalCustomers / (state.length + 1)) : 0;
  const aliReceives = [];
  let aliCount = 0;

  if (state.length === 0) {
    return { ali_after_count: 0, target_per_person: 0, ali_receives: [], member_summary: [] };
  }

  // Donate from heaviest first so the balance moves fastest.
  const sortedMembers = [...state].sort((a, b) => b.after_count - a.after_count);
  for (const member of sortedMembers) {
    if (aliCount >= target) break;
    while (member.groups.length && member.after_count > target && aliCount < target) {
      const g = member.groups.shift();
      member.after_count -= g.customer_count;
      member.after_groups -= 1;
      member.donated.push(g);
      aliReceives.push({ group_name: g.group_name, line: g.line, customer_count: g.customer_count, donor_name: member.name });
      aliCount += g.customer_count;
    }
  }

  // Reorder back to alphabetical for stable display
  state.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return {
    ali_after_count: aliCount,
    target_per_person: target,
    ali_receives: aliReceives,
    member_summary: state.map(({ groups, ...rest }) => rest),  // drop internal field
  };
}

// ─── GET /api/org-chart/transfer-simulation ───────────────────────────────────
// Query: ?coordinator=Ali Hashem&fromSection=general&toSection=private
//
// Returns a "what-if" view of moving a coordinator between sections within
// customer_services. Pure preview — never writes to the DB. Both sides honor
// the user's balancing preference: distribute by CUSTOMER count, not group
// count.
router.get('/transfer-simulation', (req, res) => {
  // Simulator is an admin operation — moving members between sections is
  // outside a single leader's scope. Block leaders with a clear 403.
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'صلاحية المحاكاة للمدير فقط' });
  }
  const { coordinator = '', fromSection = '', toSection = '' } = req.query;
  const aliName = String(coordinator).trim();
  if (!aliName) return res.status(400).json({ error: 'coordinator is required' });
  if (!SECTION_TO_USERS_DEPT[fromSection]) return res.status(400).json({ error: 'invalid fromSection' });
  if (!SECTION_TO_USERS_DEPT[toSection])   return res.status(400).json({ error: 'invalid toSection' });
  if (fromSection === toSection) return res.status(400).json({ error: 'fromSection and toSection must differ' });

  try {
    const aliGroups = getMemberBatches(aliName);
    // Exclude the section's leader on both sides — leaders are never valid
    // transfer recipients or donors. Each side's leader is fetched via the
    // same query the org-chart column uses, so both views stay consistent.
    const sourceLeader = getSectionLeaderName(fromSection);
    const targetLeader = getSectionLeaderName(toSection);
    const remaining     = getSectionMembers(fromSection, [aliName, sourceLeader]);
    const targetMembers = getSectionMembers(toSection,   [aliName, targetLeader]);

    const source = planSourceRedistribution(aliGroups, remaining);
    const target = planTargetRedistribution(aliName, targetMembers);

    return res.json({
      coordinator_name: aliName,
      from_section: { key: fromSection, label: { general:'عام', private:'خاص', semi:'شبه خاص' }[fromSection] },
      to_section:   { key: toSection,   label: { general:'عام', private:'خاص', semi:'شبه خاص' }[toSection] },
      ali_current: {
        customer_count: aliGroups.reduce((s, g) => s + g.customer_count, 0),
        group_count: aliGroups.length,
        groups: aliGroups,
      },
      source,   // { assignments, member_summary }
      target,   // { ali_after_count, target_per_person, ali_receives, member_summary }
    });
  } catch (err) {
    console.error('[org-chart] transfer-simulation error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── FLEXIBLE HELPERS for the new simulation modes ───────────────────────────

// Find the section ('general'|'private'|'semi') a coordinator currently belongs
// to inside customer_services. Returns null if the name isn't an active
// customer_services team member or if their section isn't transferable.
function findCoordinatorSection(name) {
  if (!name) return null;
  const row = db.prepare(
    `SELECT section FROM team_members
      WHERE status='active'
        AND department='customer_services'
        AND LOWER(TRIM(name)) = LOWER(TRIM(?))
      LIMIT 1`
  ).get(name);
  const sec = row?.section || null;
  return SECTION_TO_USERS_DEPT[sec] ? sec : null;
}

const SECTION_LABELS = { general: 'عام', private: 'خاص', semi: 'شبه خاص' };

// Map a user's `department` (e.g. 'General') to the team_members section key
// (e.g. 'general'). Used to verify a leader is acting on their OWN section.
function userDeptToSection(dept) {
  const norm = String(dept || '').trim().toLowerCase();
  for (const [section, usersDept] of Object.entries(SECTION_TO_USERS_DEPT)) {
    if (usersDept.toLowerCase() === norm) return section;
  }
  return null;
}

// Allow:
//   • admin    → any section
//   • leader   → only their own section (matched via users.department)
// Returns null if allowed, OR { status, error } if denied.
function checkSimAccess(user, options = {}) {
  if (user?.role === 'admin') return null;
  if (user?.role !== 'leader') {
    return { status: 403, error: 'صلاحية المحاكاة للمدير أو القائد فقط' };
  }
  const leaderSection = userDeptToSection(user.department);
  if (!leaderSection) {
    return { status: 403, error: `لا يوجد قسم يطابق صلاحية القائد (${user.department})` };
  }
  // If a specific coordinator is named, they MUST be in the leader's section.
  for (const name of (options.coordinatorNames || [])) {
    const coordSection = findCoordinatorSection(name);
    if (coordSection !== leaderSection) {
      return { status: 403, error: `المنسق "${name}" ليس في قسمك (${SECTION_LABELS[leaderSection] || leaderSection})` };
    }
  }
  // If a target section is named, it MUST equal the leader's section.
  if (options.targetSection && options.targetSection !== leaderSection) {
    return { status: 403, error: `يمكنك فقط الإضافة لقسمك (${SECTION_LABELS[leaderSection] || leaderSection})` };
  }
  return null;
}

// Variant of planSourceRedistribution that accepts explicit starting loads.
// Used by Swap mode where one of the recipients is the incoming counterpart
// (who arrives WITHOUT their old section's groups → startCount/startGroups = 0).
//
// recipients: [{ id, name, startCount?, startGroups? }]
//   If startCount/startGroups are undefined, the helper fetches the member's
//   actual current load from the DB (same behavior as the legacy function).
function planRedistributionFlexible(groups, recipients) {
  const state = recipients.map((m) => {
    const before_count  = (m.startCount  !== undefined) ? m.startCount  : getMemberCustomerCount(m.name);
    const before_groups = (m.startGroups !== undefined) ? m.startGroups : getMemberBatches(m.name).length;
    return {
      id: m.id, name: m.name,
      before_count, before_groups,
      after_count: before_count, after_groups: before_groups,
      received: [],
      is_newcomer: m.startCount === 0 && m.startGroups === 0,
    };
  });

  const assignments = [];
  if (state.length === 0) {
    groups.forEach((g) => {
      assignments.push({ group_name: g.group_name, line: g.line, customer_count: g.customer_count, recipient_name: null });
    });
    return { assignments, member_summary: state };
  }

  const sorted = [...groups].sort((a, b) => b.customer_count - a.customer_count);
  for (const g of sorted) {
    state.sort((a, b) => a.after_count - b.after_count);
    const recipient = state[0];
    recipient.after_count  += g.customer_count;
    recipient.after_groups += 1;
    recipient.received.push({ group_name: g.group_name, line: g.line, customer_count: g.customer_count });
    assignments.push({ group_name: g.group_name, line: g.line, customer_count: g.customer_count, recipient_name: recipient.name });
  }

  state.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return { assignments, member_summary: state };
}

// ─── GET /api/org-chart/simulate/leave ───────────────────────────────────────
// Mode 1: Coordinator exits their section. Groups are redistributed to the
// REMAINING members of the SAME section (LPT balancing). Pure preview.
//
// Query: ?coordinator=Ali Hashem
router.get('/simulate/leave', (req, res) => {
  const aliName = String(req.query.coordinator || '').trim();
  if (!aliName) return res.status(400).json({ error: 'coordinator is required' });
  const access = checkSimAccess(req.user, { coordinatorNames: [aliName] });
  if (access) return res.status(access.status).json({ error: access.error });

  try {
    const section = findCoordinatorSection(aliName);
    if (!section) {
      return res.status(404).json({ error: `لم يتم العثور على "${aliName}" في الأقسام (عام/خاص/شبه خاص)` });
    }
    const aliGroups = getMemberBatches(aliName);
    const sourceLeader = getSectionLeaderName(section);
    const remaining = getSectionMembers(section, [aliName, sourceLeader]);
    const source = planSourceRedistribution(aliGroups, remaining);

    return res.json({
      mode: 'leave',
      coordinator_name: aliName,
      from_section: { key: section, label: SECTION_LABELS[section] },
      ali_current: {
        customer_count: aliGroups.reduce((s, g) => s + g.customer_count, 0),
        group_count: aliGroups.length,
        groups: aliGroups,
      },
      source,  // { assignments, member_summary }
    });
  } catch (err) {
    console.error('[org-chart] simulate/leave error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/org-chart/simulate/swap ────────────────────────────────────────
// Mode 2: Two coordinators swap sections. Each one's groups are redistributed
// in their CURRENT section, with the incoming counterpart as a new recipient
// starting at zero load.
//
// Query: ?coordinatorA=...&coordinatorB=...
router.get('/simulate/swap', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية المحاكاة للمدير فقط' });
  const aName = String(req.query.coordinatorA || '').trim();
  const bName = String(req.query.coordinatorB || '').trim();
  if (!aName || !bName) return res.status(400).json({ error: 'coordinatorA & coordinatorB required' });
  if (aName.toLowerCase() === bName.toLowerCase()) return res.status(400).json({ error: 'يجب أن يكون المنسقَين مختلفَين' });

  try {
    const aSection = findCoordinatorSection(aName);
    const bSection = findCoordinatorSection(bName);
    if (!aSection) return res.status(404).json({ error: `لم يتم العثور على "${aName}"` });
    if (!bSection) return res.status(404).json({ error: `لم يتم العثور على "${bName}"` });
    if (aSection === bSection) return res.status(400).json({ error: 'المنسقان في نفس القسم — استخدم وضع آخر' });

    const aGroups = getMemberBatches(aName);
    const bGroups = getMemberBatches(bName);

    const aLeader = getSectionLeaderName(aSection);
    const bLeader = getSectionLeaderName(bSection);

    // section A: remaining members + B as newcomer (zero load)
    const aRemaining = getSectionMembers(aSection, [aName, bName, aLeader]);
    const aMember    = db.prepare(`SELECT id, name FROM team_members
                                    WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`).get(bName);
    const aRecipients = [
      ...aRemaining,
      ...(aMember ? [{ id: aMember.id, name: aMember.name, startCount: 0, startGroups: 0 }] : []),
    ];

    // section B: remaining members + A as newcomer (zero load)
    const bRemaining = getSectionMembers(bSection, [aName, bName, bLeader]);
    const bMember    = db.prepare(`SELECT id, name FROM team_members
                                    WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`).get(aName);
    const bRecipients = [
      ...bRemaining,
      ...(bMember ? [{ id: bMember.id, name: bMember.name, startCount: 0, startGroups: 0 }] : []),
    ];

    const sectionA_plan = planRedistributionFlexible(aGroups, aRecipients);
    const sectionB_plan = planRedistributionFlexible(bGroups, bRecipients);

    return res.json({
      mode: 'swap',
      coordinator_a: {
        name: aName, section: { key: aSection, label: SECTION_LABELS[aSection] },
        customer_count: aGroups.reduce((s, g) => s + g.customer_count, 0),
        group_count: aGroups.length, groups: aGroups,
      },
      coordinator_b: {
        name: bName, section: { key: bSection, label: SECTION_LABELS[bSection] },
        customer_count: bGroups.reduce((s, g) => s + g.customer_count, 0),
        group_count: bGroups.length, groups: bGroups,
      },
      section_a_plan: sectionA_plan,  // A leaves + B arrives, distribute A's groups
      section_b_plan: sectionB_plan,  // B leaves + A arrives, distribute B's groups
    });
  } catch (err) {
    console.error('[org-chart] simulate/swap error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/org-chart/simulate/add-new ─────────────────────────────────────
// Mode 3: New coordinator joins a section (could be a brand-new hire OR an
// existing employee being reassigned). Existing members donate groups until
// fair-share threshold reached. Pure preview.
//
// Query: ?name=Khaled&toSection=general&type=standard
router.get('/simulate/add-new', (req, res) => {
  const name = String(req.query.name || '').trim();
  const toSection = String(req.query.toSection || '').trim();
  const coordinatorType = String(req.query.type || 'standard').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!SECTION_TO_USERS_DEPT[toSection]) return res.status(400).json({ error: 'invalid toSection' });
  if (!VALID_TYPES.includes(coordinatorType)) {
    return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
  }
  const access = checkSimAccess(req.user, { targetSection: toSection });
  if (access) return res.status(access.status).json({ error: access.error });

  try {
    const targetLeader = getSectionLeaderName(toSection);
    const targetMembers = getSectionMembers(toSection, [name, targetLeader]);
    const target = planTargetRedistribution(name, targetMembers);
    const typeCfg = COORDINATOR_TYPES[coordinatorType];

    return res.json({
      mode: 'add_new',
      newcomer: {
        name,
        coordinator_type: coordinatorType,
        coordinator_label: typeCfg.label_ar,
        capacity_min: typeCfg.capacity_min,
        capacity_max: typeCfg.capacity_max,
      },
      to_section: { key: toSection, label: SECTION_LABELS[toSection] },
      target,  // { ali_after_count, target_per_person, ali_receives, member_summary }
    });
  } catch (err) {
    console.error('[org-chart] simulate/add-new error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/org-chart/simulate/temporary ───────────────────────────────────
// Mode 4: Temporary absence. Same redistribution logic as `/simulate/leave`
// but echoes back the date range so the UI can show "during 16/5 → 25/5".
// No DB writes — the dates are purely descriptive metadata for the preview.
//
// Query: ?coordinator=...&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
router.get('/simulate/temporary', (req, res) => {
  const aliName  = String(req.query.coordinator || '').trim();
  const dateFrom = String(req.query.dateFrom || '').trim() || null;
  const dateTo   = String(req.query.dateTo   || '').trim() || null;
  if (!aliName) return res.status(400).json({ error: 'coordinator is required' });
  const access = checkSimAccess(req.user, { coordinatorNames: [aliName] });
  if (access) return res.status(access.status).json({ error: access.error });

  try {
    const section = findCoordinatorSection(aliName);
    if (!section) {
      return res.status(404).json({ error: `لم يتم العثور على "${aliName}" في الأقسام (عام/خاص/شبه خاص)` });
    }
    const aliGroups = getMemberBatches(aliName);
    const sourceLeader = getSectionLeaderName(section);
    const remaining = getSectionMembers(section, [aliName, sourceLeader]);
    const source = planSourceRedistribution(aliGroups, remaining);

    return res.json({
      mode: 'temporary',
      coordinator_name: aliName,
      from_section: { key: section, label: SECTION_LABELS[section] },
      date_from: dateFrom,
      date_to:   dateTo,
      ali_current: {
        customer_count: aliGroups.reduce((s, g) => s + g.customer_count, 0),
        group_count: aliGroups.length,
        groups: aliGroups,
      },
      source,
    });
  } catch (err) {
    console.error('[org-chart] simulate/temporary error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/org-chart/simulate/groups ─────────────────────────────────────
// Mode 5: Move a SPECIFIC SET OF GROUPS from one coordinator to another. No
// auto-distribution — admin explicitly picks both sides.
//
// Body: {
//   fromCoordinator: 'Ali Hashem',
//   toCoordinator:   'Mostafa',
//   groups: [ { group_name: '...', line: 'Ahmed Hassan' }, ... ]
// }
router.post('/simulate/groups', express.json(), (req, res) => {
  const fromName = String(req.body?.fromCoordinator || '').trim();
  const toName   = String(req.body?.toCoordinator   || '').trim();
  const selected = Array.isArray(req.body?.groups) ? req.body.groups : [];
  if (!fromName) return res.status(400).json({ error: 'fromCoordinator is required' });
  if (!toName)   return res.status(400).json({ error: 'toCoordinator is required' });
  if (fromName.toLowerCase() === toName.toLowerCase()) {
    return res.status(400).json({ error: 'fromCoordinator and toCoordinator must differ' });
  }
  if (selected.length === 0) return res.status(400).json({ error: 'يجب اختيار مجموعة واحدة على الأقل' });
  // Leaders can only act within their own team. Both endpoints of the move
  // must belong to their section.
  const access = checkSimAccess(req.user, { coordinatorNames: [fromName, toName] });
  if (access) return res.status(access.status).json({ error: access.error });

  try {
    const fromGroups = getMemberBatches(fromName);
    const toGroups   = getMemberBatches(toName);

    // Match each selected (group_name + line) to the source's actual batches.
    const norm = (g) => `${String(g.group_name || '').trim().toLowerCase()}|${String(g.line || '').trim().toLowerCase()}`;
    const fromMap = new Map(fromGroups.map((g) => [norm(g), g]));
    const moving = [];
    const missing = [];
    for (const sel of selected) {
      const found = fromMap.get(norm(sel));
      if (found) moving.push(found);
      else       missing.push(sel);
    }
    if (moving.length === 0) {
      return res.status(400).json({ error: 'لم يتم العثور على أي من المجموعات المختارة عند المنسق المصدر' });
    }

    const movingCustomers = moving.reduce((s, g) => s + g.customer_count, 0);
    const fromBefore = fromGroups.reduce((s, g) => s + g.customer_count, 0);
    const toBefore   = toGroups.reduce((s, g) => s + g.customer_count, 0);

    const fromAfter = {
      customer_count: fromBefore - movingCustomers,
      group_count:    fromGroups.length - moving.length,
    };
    const toAfter = {
      customer_count: toBefore + movingCustomers,
      group_count:    toGroups.length + moving.length,
    };

    // Try to figure out each coordinator's section just for display.
    const fromSection = findCoordinatorSection(fromName);
    const toSection   = findCoordinatorSection(toName);

    return res.json({
      mode: 'specific_groups',
      from: {
        name: fromName,
        section: fromSection ? { key: fromSection, label: SECTION_LABELS[fromSection] } : null,
        before: { customer_count: fromBefore, group_count: fromGroups.length },
        after:  fromAfter,
      },
      to: {
        name: toName,
        section: toSection ? { key: toSection, label: SECTION_LABELS[toSection] } : null,
        before: { customer_count: toBefore, group_count: toGroups.length },
        after:  toAfter,
      },
      moved_groups: moving,        // ones actually transferred
      missing_groups: missing,     // selected but not currently owned by source
    });
  } catch (err) {
    console.error('[org-chart] simulate/groups error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/org-chart/coordinator-types ─────────────────────────────────────
// Returns the catalog of coordinator types + their capacity rules.
// Used by the frontend dropdown so the labels/limits are sourced from one
// place (no copy-paste between BE/FE).
router.get('/coordinator-types', (req, res) => {
  return res.json({
    types: Object.values(COORDINATOR_TYPES).map((t) => ({
      code:         t.code,
      label_ar:     t.label_ar,
      label_en:     t.label_en,
      capacity_min: t.capacity_min,
      capacity_max: t.capacity_max,
    })),
  });
});

// ─── PATCH /api/org-chart/members/:id/type ────────────────────────────────────
// Admin-only. Updates a team_member's coordinator_type.
// Body: { coordinator_type: 'standard' | 'multi_task' }
router.patch('/members/:id/type', express.json(), (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'صلاحية التعديل للمدير فقط' });
    }
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid member id' });

    const type = String(req.body?.coordinator_type || '').trim();
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({
        error: `coordinator_type must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }

    const existing = db.prepare(
      `SELECT id, name, coordinator_type FROM team_members WHERE id = ?`
    ).get(id);
    if (!existing) return res.status(404).json({ error: 'member not found' });

    db.prepare(
      `UPDATE team_members SET coordinator_type = ? WHERE id = ?`
    ).run(type, id);

    const updated = db.prepare(
      `SELECT id, name, coordinator_type FROM team_members WHERE id = ?`
    ).get(id);

    return res.json({
      member: updated,
      previous_type: existing.coordinator_type,
      type_info: COORDINATOR_TYPES[type],
    });
  } catch (err) {
    console.error('[org-chart] update coordinator_type error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
