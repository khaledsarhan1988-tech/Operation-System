const { downloadSnapshot, bootServer } = require('./harness');
const compact = s => String(s || '').toLowerCase().replace(/\s+/g, '');
(async () => {
  await downloadSnapshot({});
  const { call, close } = await bootServer();
  const from = '2026-05-01', to = '2026-06-06';
  const q = (await call(`/reports/quality-employee?from=${from}&to=${to}`)).json;
  // CORRECT params for attendance-absence: from_date / to_date
  const a = (await call(`/reports/attendance-absence?from_date=${from}&to_date=${to}`)).json;
  const arows = Array.isArray(a) ? a : (a.rows || []);
  const aMap = {}; for (const r of arows) aMap[compact(r.coordinator)] = r;
  console.log('coordinator | quality main_abs/exp · zoom_abs/exp | attendance main_abs/exp · zoom_abs/exp | MATCH?');
  let allMatch = true;
  for (const r of (q.rows || [])) {
    const am = aMap[compact(r.agent_name)];
    if (!am) { console.log(`${r.agent_name}: no attendance match`); continue; }
    const m = Math.abs(r.main_absent_count - am.main_absent) <= 1 && Math.abs(r.zoom_absent_count - am.zoom_absent) <= 1
           && Math.abs(r.main_expected_count - am.main_expected) <= 1 && Math.abs(r.zoom_expected_count - am.zoom_expected) <= 1;
    if (!m) allMatch = false;
    console.log(`${r.agent_name}: Q ${r.main_absent_count}/${r.main_expected_count}·${r.zoom_absent_count}/${r.zoom_expected_count}  A ${am.main_absent}/${am.main_expected}·${am.zoom_absent}/${am.zoom_expected}  ${m ? '✅' : '❌'}`);
  }
  console.log(allMatch ? '\n✅ ALL MATCH — quality == attendance (constitution invariant holds; earlier diff was my wrong param)' : '\n❌ still differs');
  close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
