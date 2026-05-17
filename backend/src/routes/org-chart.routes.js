'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { nameInListInline } = require('../utils/nameMatch');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

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
router.get('/customer-services', (req, res) => {
  try {
    const sections = [
      { key: 'general',      label: 'عام',     dept_users: 'General',     tm_dept: 'customer_services', tm_section: 'general' },
      { key: 'private',      label: 'خاص',     dept_users: 'Private',     tm_dept: 'customer_services', tm_section: 'private' },
      { key: 'semi',         label: 'شبه خاص', dept_users: 'Semi',        tm_dept: 'customer_services', tm_section: 'semi'    },
      { key: 'appointments', label: 'مواعيد',  dept_users: 'Appointments',tm_dept: 'appointments',      tm_section: null      },
    ];

    const leaderStmt = db.prepare(
      `SELECT id, full_name AS name FROM users
        WHERE role='leader' AND is_active=1 AND department = ? COLLATE NOCASE
        ORDER BY id LIMIT 1`
    );
    const membersWithSection = db.prepare(
      `SELECT id, name, job_title FROM team_members
        WHERE status='active' AND department = ? AND section = ?
        ORDER BY name COLLATE NOCASE`
    );
    const membersNoSection = db.prepare(
      `SELECT id, name, job_title FROM team_members
        WHERE status='active' AND department = ?
        ORDER BY name COLLATE NOCASE`
    );

    const result = sections.map((s) => {
      const leader = leaderStmt.get(s.dept_users) || null;
      const members = s.tm_section
        ? membersWithSection.all(s.tm_dept, s.tm_section)
        : membersNoSection.all(s.tm_dept);

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
        return {
          id: m.id,
          name: m.name,
          job_title: m.job_title,
          customer_count,
          group_count,
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

    return res.json({ sections: result });
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

// Active customer-services team members in a given section, excluding the moving coordinator.
function getSectionMembers(section, excludeName) {
  return db.prepare(
    `SELECT id, name FROM team_members
      WHERE status='active' AND department='customer_services' AND section = ?
        AND LOWER(TRIM(name)) != LOWER(TRIM(?))
      ORDER BY name COLLATE NOCASE`
  ).all(section, excludeName);
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
  const { coordinator = '', fromSection = '', toSection = '' } = req.query;
  const aliName = String(coordinator).trim();
  if (!aliName) return res.status(400).json({ error: 'coordinator is required' });
  if (!SECTION_TO_USERS_DEPT[fromSection]) return res.status(400).json({ error: 'invalid fromSection' });
  if (!SECTION_TO_USERS_DEPT[toSection])   return res.status(400).json({ error: 'invalid toSection' });
  if (fromSection === toSection) return res.status(400).json({ error: 'fromSection and toSection must differ' });

  try {
    const aliGroups = getMemberBatches(aliName);
    const remaining = getSectionMembers(fromSection, aliName);
    const targetMembers = getSectionMembers(toSection, aliName);

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

module.exports = router;
