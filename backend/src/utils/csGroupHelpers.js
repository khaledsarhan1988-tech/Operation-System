'use strict';
// Shared helpers for the Customer-Services group/coordinator services
// (csDeliveries, csEnrGroups, csEnrTransition). These were copy-pasted
// identically in all three; consolidating here keeps the ignore-group business
// rule and coordinator normalization in ONE place. Behaviour is unchanged.

// Placeholder / non-real groups excluded entirely from the CS views — they are
// not real client level-groups (free-slot fillers, grammar sessions, makeup /
// "تعويض" compensation sessions). Add patterns here as the owner decides.
const IGNORED_GROUP_PATTERNS = [
  /free\s*slots/i,
  /do\s*-?\s*not\s*closed/i,
  /donot\s*closed/i,
  /grammer/i,                  // "Grammer_Con_G(...)" — grammar sessions, not a level group
  /grammar/i,                  // correct spelling, just in case
  /comp[ae]ns/i,               // "..._Compensation" / "compensation _ s1_g2" — makeup sessions
  /تعويض/,                     // Arabic compensation/makeup session (owner decision 2026-06-18)
];

const isIgnoredGroup = (name) => {
  const s = String(name == null ? '' : name);
  return IGNORED_GROUP_PATTERNS.some(re => re.test(s));
};

// Normalize a coordinator/user name for comparison: drop any "(...)" suffix,
// trim, lowercase, collapse spaces. Matches users.full_name against
// batches.coordinators / team_members.name.
const normName = (s) =>
  String(s == null ? '' : s).replace(/\(.*?\)/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

// First REAL coordinator in a (possibly comma-separated) coordinators string —
// skip the '--' placeholder (a "تعويض سيشن" comp-session group often sits with
// coordinators='--', which would otherwise hide the real coordinator).
function realCoordinator(coordStr) {
  for (const c of String(coordStr || '').split(',')) {
    const t = c.trim();
    if (t && normName(t) !== '--') return t;
  }
  return null;
}

module.exports = { IGNORED_GROUP_PATTERNS, isIgnoredGroup, normName, realCoordinator };
