# أداة فحص الأرقام (Audit Harness)

فحص **قراءة-فقط** للأرقام عبر السيستم على نسخة حية — بنفس صرامة فحص «الإشغال والمدربين».

## التشغيل
```bash
cd academy-system/backend
export DATA_EXPORT_API_KEY=<المفتاح>     # المفتاح من الذاكرة/Railway — لا يُكتب في الكود
node scripts/audit/run.js                 # كل الفحوصات
node scripts/audit/run.js smoke           # الفحص العام بس
node scripts/audit/run.js occupancy       # الإشغال بس
node scripts/audit/run.js --from=2026-06-23 --to=2026-07-23
node scripts/audit/run.js --force         # ينزّل snapshot جديد (يتجاهل الكاش)
```
كل check بيطبع ✅/❌ + أمثلة على أي اختلاف. الخروج 0 = الكل سليم.

## الطريقة
- `harness.js` — ينزّل snapshot (VACUUM INTO، قراءة فقط)، يعمل auth-stub (أدمن line='All')،
  ويركّب نفس routers `app.js` فيشغّل أي endpoint حقيقي على النسخة. المفتاح من `DATA_EXPORT_API_KEY`.
- `helpers.js` — parsers/merge/تواريخ مشتركة.
- `checks/smoke.js` — فحص عام لكل التقارير: 200، مفيش NaN/سالب، pagination سليم.
- `checks/occupancy.js` — فحص عميق للإشغال (5 invariants: مجموع الأيام=الإجمالي، الإجمالي=الخام،
  heatmap=dashboard، البلوكات مطابقة، المعادلات).

## إضافة فحص عميق لقسم جديد
اعمل `checks/<area>.js` بيصدّر `async function({call, db, window, holidaySet})` ويرجّع
`{ area, meta, checks:[{name, pass, fails, count}] }`، وسجّله في `MODULES` بـ `run.js`.
المبدأ: قارن مخرجات الـ endpoint بإعادة اشتقاق مستقلة من البيانات الخام + ثوابت (conservation/cross-endpoint)
— مش مرآة لنفس الكود.

> الملفات `.snapshot.db` / `.run.db` مؤقتة و git-ignored. لا تعمل لها commit.
