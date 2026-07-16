// Per-page grant helpers (users.extra_pages).
//
// `occupancy-trainers` is an UMBRELLA key that grants ALL individual trainer
// pages at once. It is kept for backward-compatibility with grants issued
// before the "الإشغال والمدربين" group was split into per-page keys, and as a
// convenience "grant them all" option. Admins always pass every gate.

export const TRAINER_PAGE_KEYS = [
  'trainer-utilization',
  'trainer-dashboard',
  'find-available-trainer',
  'trainer-work-history',
  'phone-call-gap',
  'trainer-details',
  'trainer-recruitment',
  'trainer-org-chart',
];

// Expand a user's raw extra_pages CSV into an effective Set of page keys,
// resolving the `occupancy-trainers` umbrella into every trainer page.
export function expandGrants(extraPages) {
  const set = new Set(
    String(extraPages || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (set.has('occupancy-trainers')) {
    TRAINER_PAGE_KEYS.forEach((k) => set.add(k));
  }
  return set;
}

// True if the user may access the given page key. Admins always pass; a user
// holding the `occupancy-trainers` umbrella passes any trainer page.
export function hasPageGrant(user, pageKey) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return expandGrants(user.extra_pages).has(pageKey);
}
