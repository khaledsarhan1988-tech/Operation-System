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

module.exports = router;
