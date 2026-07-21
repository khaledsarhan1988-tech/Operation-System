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
  /co[nm]p[ae]ns/i,            // "..._Compensation" — makeup sessions; also the live typo "conpensation" (owner 2026-07-21)
  /تعويض/,                     // Arabic compensation/makeup session (owner decision 2026-06-18)
  /placem/i,                   // "placement test" / "Placemnent Test" — level-placement, not a real level (owner 2026-07-14)
  /تحديد مستو/,                 // Arabic "تحديد مستوى/مستوي" placement session (owner 2026-07-14)
  /(^|[^a-z])test(?:[^a-z]|$)/i, // "Test_General_5" — QA/test groups are not real groups (owner 2026-07-15).
                               //  Standalone token only, so real words containing "test" don't match.
  // Placeholder rows sitting in batches with active/waiting status — not client
  // level-groups; owner asked to clean them from the CS pages (2026-07-21):
  /hiring\s*new\s*teacher/i,   // "Hiring New Teacher" (already excluded on the reports side)
  /manag\w*\s*training/i,      // "Managment Training" / "Management Training" — internal training
  /voice\s*note/i,             // "Voice Note (Private)" — note rows, not groups
  /(^|[^a-z])break(?:[^a-z]|$)/i, // "Break Private" — standalone token like `test`
  /تأجيل/,                     // "تأجيل برسوم" — postponed-for-fees note rows
];

const isIgnoredGroup = (name) => {
  const s = String(name == null ? '' : name);
  if (IGNORED_GROUP_PATTERNS.some(re => re.test(s))) return true;
  // Space/underscore/typo-insensitive catch (owner 2026-07-14, emphatic): a
  // placement test or a compensation/تعويض session must NEVER count as a group,
  // however it's written — "place ment test", "placment", "comp ensation",
  // "تعويض سيشن", "تحديد مستوي", etc. Strip every non-letter, then match.
  // (2026-07-21: + the placeholder families the owner asked to clean — hiring/
  // training/voice-note/تأجيل; "break" stays array-only since it needs word
  // boundaries the compact form can't provide.)
  const compact = s.toLowerCase().replace(/[^a-z؀-ۿ]/g, '');
  return /plac.{0,3}ment|placem|co[nm]p[ae]ns|تعويض|تحديدمستو|hiringnewteacher|manag[a-z]*training|voicenote|تأجيل/.test(compact);
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
