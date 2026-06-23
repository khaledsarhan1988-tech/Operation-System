#!/usr/bin/env node
/* Audit runner.
 *   DATA_EXPORT_API_KEY=<key> node scripts/audit/run.js [area] [--from=YYYY-MM-DD --to=YYYY-MM-DD] [--force]
 *   area: smoke | occupancy | all (default all)
 * Read-only. Downloads a live snapshot (reused if recent), boots the real
 * endpoints on it, runs the selected check modules, prints PASS/FAIL.
 */
const { downloadSnapshot, bootServer } = require('./harness');

const MODULES = {
  smoke: require('./checks/smoke'),
  occupancy: require('./checks/occupancy'),
  quality: require('./checks/quality'),
};

function arg(name, def) { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : def; }

(async () => {
  const area = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'all';
  const force = process.argv.includes('--force');
  const today = new Date();
  // Default window = last 30 days (past), so absence/quality reports have real data.
  const toDef = today.toISOString().slice(0, 10);
  const fromDef = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const window = { from: arg('from', process.env.AUDIT_FROM || fromDef), to: arg('to', process.env.AUDIT_TO || toDef) };

  await downloadSnapshot({ force });
  const ctx = await bootServer();
  const { getHolidayDateSet } = require(require('path').join(require('./harness').BACKEND, 'src/utils/holidays'));
  const holidaySet = getHolidayDateSet();

  const toRun = area === 'all' ? Object.keys(MODULES) : [area];
  console.log(`\n══ AUDIT  window ${window.from} → ${window.to}  ══\n`);
  let totalFails = 0;
  for (const key of toRun) {
    const mod = MODULES[key];
    if (!mod) { console.log(`  (unknown area: ${key})`); continue; }
    let res; try { res = await mod({ ...ctx, window, holidaySet }); } catch (e) { console.log(`### ${key}: ERROR ${e.message}`); totalFails++; continue; }
    console.log(`### ${res.area}  (${res.meta})`);
    for (const c of res.checks) {
      console.log(`   ${c.pass ? '✅' : '❌'} ${c.name}${c.pass ? '' : `  — ${c.count} fail(s)`}`);
      if (!c.pass) { c.fails.forEach(f => console.log(`        • ${f}`)); totalFails += c.count; }
    }
    if (res.info && res.info.length) { console.log('   ℹ️  للمراجعة (مش فشل):'); res.info.forEach(f => console.log(`        • ${f}`)); }
    console.log('');
  }
  ctx.close();
  console.log(totalFails === 0 ? '══ RESULT: ✅ ALL PASS ══' : `══ RESULT: ❌ ${totalFails} issue(s) ══`);
  process.exit(totalFails === 0 ? 0 : 1);
})().catch(e => { console.error('audit fatal:', e); process.exit(2); });
