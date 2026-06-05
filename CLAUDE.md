# CLAUDE.md — دستور نظام «أكاديمية أحمد حسن» (نظام إدارة التشغيل)

> **اقرأ هذا الملف بالكامل قبل أي إضافة أو تعديل أو إجابة عن أي تقرير.**
> هذا هو **مصدر الحقيقة** للقرارات وطرق الحساب والعرض المتفق عليها حتى **2026-06-06**.

---

## ⚠️ 0) قواعد إلزامية (اقرأها أولًا)

1. **ممنوع أي تعديل كود من غير موافقة صريحة من صاحب النظام (Owner) أولًا.**
2. **التحقّق من البيانات الحية فقط — ممنوع نهائيًا الاعتماد على ملفات النسخ الاحتياطية** (`Quality_System_Data/backub/*.db`) لاتخاذ أي قرار أو إثبات أي رقم. النسخ قديمة وضلّلت التشخيص أكثر من مرة. استخدم دائمًا snapshot حيّ (القسم 1).
3. **التحقّق بالـ endpoint الحقيقي، لا بأي «نسخة يدوية» (hand-mirror) من المنطق.** المرايا اليدوية تنحرف وتخفي الأخطاء. شغّل الكود الفعلي (القسم 1).
4. **كشف التعارض (مهم):** قبل تنفيذ أي تعديل، طابقه على «**القرارات المتفق عليها**» (القسم 3). لو التعديل المطلوب يخالف قرارًا/طريقة حساب موثّقة هنا، **قف وقُل للمستخدم:**
   > «التعديل ده بيتعارض مع السيستم المتفق عليه بتاريخ 2026-06-06 — البند: [اذكره]. عايز تأكّد إنك عايز تغيّره؟»
   ولا تنفّذ إلا بعد تأكيد صريح، ثم **حدّث هذا الملف** بالقرار الجديد وتاريخه.
5. الأرقام في تقارير المدربين تُستخدم لحساب **المرتبات** → لازم تكون دقيقة 100%.
6. النشر: `git push origin main` يعمل deploy تلقائي (Railway للباك-إند، Vercel للفرونت). اعمل commit/push فقط لمّا الـ Owner يطلب، وبعد التحقّق.

---

## 1) الوصول للبيانات الحية + التحقّق (إلزامي)

**API قراءة-فقط مخصّص (gated):** `https://operation-system-production.up.railway.app/api/data-export`
- المصادقة: هيدر `X-Export-Key: <DATA_EXPORT_API_KEY>`. **المفتاح في ذاكرتك (auto-memory) أو اطلبه من الـ Owner** — لا يُكتب في الريبو.
- `GET /db` → **يحمّل snapshot كامل ومتسق للبيانات الحية** (كل الجداول، `VACUUM INTO`). ده الأهم.
- `GET /trainers` (team_members + extra_shifts + holidays) · `GET /lectures?from=&to=`
- `GET /remarks?q=` · `/absent?q=` · `/batches?q=` · `/users?q=` (بحث تشخيصي بالاسم/الهاتف/المجموعة).

**تشغيل تقرير حقيقي على البيانات الحية (الطريقة الذهبية):**
```bash
cd academy-system/backend
KEY=<DATA_EXPORT_API_KEY>
curl -s -H "X-Export-Key: $KEY" -o _live.db "https://operation-system-production.up.railway.app/api/data-export/db"
# ثم استبدل auth middleware عبر require-cache وشغّل الـ endpoint الحقيقي على نسخة من _live.db:
cp _live.db _run.db
node -e "
  process.env.DB_PATH=require('path').join(process.cwd(),'_run.db');
  const ap=require.resolve('./src/middleware/auth');
  require.cache[ap]={id:ap,filename:ap,loaded:true,exports:{authenticate:(q,_,n)=>{q.user={id:1,role:'admin',line:'All'};n();},requireRole:()=>(_q,_s,n)=>n()}};
  const rp=require.resolve('./src/middleware/roles');
  require.cache[rp]={id:rp,filename:rp,loaded:true,exports:{requireRole:()=>(_q,_s,n)=>n(),requireAdminWrite:(_q,_s,n)=>n()}};
  require('./src/config/database').initDb();
  const app=require('express')(); app.use('/api',require('./src/routes/reports.routes')); app.use('/api/team',require('./src/routes/team.routes'));
  app.listen(0,async function(){const p=this.address().port; const j=await (await fetch('http://127.0.0.1:'+p+'/api/<route>?<params>')).json(); console.log(JSON.stringify(j).slice(0,4000)); process.exit(0);});
" ; rm -f _run.db _live.db
```
- قراءة مباشرة (للعدّ/التحقّق السريع): `node -e "const db=require('better-sqlite3')('_live.db',{readonly:true}); ..."`
- Node 24 + better-sqlite3 مثبّتين في `backend/`. أدمن line='All' → `lineFilter` يرجّع null (بلا فلتر لاين).
- **نظّف ملفات `_*.db*` المؤقتة بعد الانتهاء.** لا تعمل لها commit أبدًا.

---

## 2) نظرة عامة على النظام

- **الباك-إند:** Node/Express + **better-sqlite3** (disk-backed، القرص لا الذاكرة — حلّ مشكلة OOM 503). `backend/src/`.
- **الفرونت:** React (Vite) على Vercel. `frontend/src/pages/`.
- **مصدر البيانات:** ملفات Excel/تقارير من **Google Drive** + Center App (مالية). تتزامن عبر `sync.service.js` / `driveSync.service.js`.
- **خطوط (Lines / Tenants):** `Ahmed Hassan` و `Dardasha`. أدمن line='All' يشوف الكل.
- **ملف التقرير الرئيسي:** `backend/src/routes/reports.routes.js` (~6500 سطر) — معظم التقارير هنا.

### ملاحظة عن مجلدات Drive (مهم للتواريخ)
الفولدر في Drive بتاريخ **اليوم**، وجواه فولدرات «غياب زووم كول» و«غياب محاضرات أساسية» بتقارير **تاريخ اليوم الذي قبله بيوم** (فولدر 19 مايو = تقارير 18 مايو). النظام يخزّن **تاريخ المحتوى الصحيح** (وليس تاريخ الفولدر) — تم التحقّق: عدم تطابق غياب-الزووم سببه نقص بيانات وليس هذه الإزاحة.

---

## 3) القرارات وطرق الحساب المتفق عليها (baseline 2026-06-06) — أي مخالفة = تعارض

### إشغال المدربين والمرتبات (`/trainer-utilization`, `/trainer-utilization-summary`, `/find-available-trainer`)
- **المتاح (available)** = دقائق الشيفت (`end-start` − البريكات) عبر `[start_date,end_date] ∩ أيام العمل`، **+** ساعات `team_member_extra_shifts` لليوم. **الإجازات الرسمية** (`official_holidays`) مستبعدة. الفويس نوت **لا** يقلّل المتاح (وقت عمل لكنه ليس سعة).
- **المحجوز (booked) = الوقت الفعلي المشغول = اتحاد فترات المحاضرات + الفويس نوت (دمج المتداخلات `mergeIntervalsMinutes`)، وليس مجموع المدد.** الجلسات المتداخلة/المتزامنة (مدرّب زووم منسوب لكذا مجموعة في نفس اللحظة، أو نفس الجلسة بأكثر من لاحقة منسق) **تُحسب مرة واحدة**. الشغل المتتابع فوق الشيفت يظل >100% (مشروع). **(عُدِّل عمدًا عن قاعدة «عُدّ كل دقيقة بلا سقف» القديمة.)**
- **شيفتات متعددة:** `team_members.shifts_json` يحمل عددًا غير محدود من الشيفتات، لكل شيفت: مواعيد/أيام/قسم/بريكات/فويس نوت خاصة. `parseTeamShifts(t)` هو القارئ المعتمد (يصدّر `startMin/endMin` **و** `s/e` معًا — **لا تَحذف الـ s/e**). البريك/الفويس نوت قد يكون له `days` (يُطبَّق على تلك الأيام فقط).
- **بداية العدّ:** من `max(تاريخ التعيين, أقدم بداية شيفت)` (`trainerCountStart`) — منعًا لتضخّم النسبة قبل وجود شيفت.
- **ابحث عن مدرب:** كشف التعارض يقرأ من `lectures` مباشرة (**بلا INNER JOIN batches**) وإلا تُخفى تعارضات المجموعات المنتهية/المعاد تسميتها ويظهر المدرب «متاح» وهو مشغول.

### حالة الريمارك (Arabic STATUS)
- القيم الفعلية فقط: **`إنتهت`** (منتهية/done) و **`غير منتهية`** (مفتوحة). عداد «الريماركات المفتوحة» = `غير منتهية` فقط (يجب استبعاد `إنتهت`). أي قائمة closed تشمل `إنتهت`. Remarks Monitor يعتبر `إنتهت` = resolved.

### المنسقون (NAME-KEY)
- مفتاح المطابقة = **اسم الفريق/الـ username** (مثل `Malika7`, `yassmen`, `RadwaGamal`) كما في `coordinator_history.coordinator` / `batches.coordinators` / `team_members.name` — **وليس** `users.full_name` («Malika Dardasha» ≠ «Malika7»).
- المطابقة تتم بمفتاح **مضغوط** (إزالة المسافات + lowercase): «RadwaGamal» = «Radwa Gamal» (`userDeptExpr`, `coordStrHasName`).
- قوائم/أعمدة المنسقين تعرض **فقط** المنسقين المسجّلين في **فريق العمل** (`team_members`). الأسماء غير المسجّلة و الـ placeholder **`--`** تُعرض **فارغة**.
- منسق فريق خدمة العملاء النشطين = `team_members WHERE department='customer_services' AND status='active'`. dropdown تقارير خدمة العملاء يأتي من هؤلاء (لا من `users`).
- **النسب المنتهية (المجموعة بمنسقين):** كل حدث يُنسب لـ **منسق واحد** = الأقدم (`ORDER BY effective_from ASC, coordinator ASC LIMIT 1`) — لا GROUP_CONCAT ولا حساب مزدوج. `/attendance-absence/segments` يطابق نفس المنطق فيتساوى مجموع المقاطع مع صف المنسق.

### المجموعات المعاد تسميتها (RENAME)
- عند إعادة التسمية: **`lectures`/`batches` بالاسم الجديد**، لكن **`absent_students`/`absent_zoom_students` بالاسم القديم**، و**`group_renames`** يخزّن (old→new). أي مطابقة غياب↔محاضرة/batch بالاسم بالضبط هشّة.
- **القاعدة:** كل مطابقة لازم تكون **rename-aware**: طابق بالاسمين عبر `currentGroupNameExpr(group,line)` (old→new) أو `effectiveGroupNameAtDate` (new→old، للأحداث قبل التسمية). مع تطبيع المسافات `REPLACE(...,' ','')`.
- **تكرار المحاضرات (~40%):** الـ importer يحذف `WHERE group_name=? AND date=?` فقط، فصفوف الاسم القديم تتراكم (~26k صف توأم). **القرار: لا تُحذف** (الحذف أثبت أنه يفقد ~11k جلسة فريدة). بدلًا منها: التقارير تتعامل معها — الإشغال يدمج الفترات، والعدّ يستخدم `COUNT(DISTINCT <canonical session>)`.

### المجموعات المنتهية (ENDED → تختفي من `batches`)
- المجموعة لمّا تخلص **تُحذف من `batches`** لكن تبقى في `lectures` + `coordinator_history`. أي `INNER JOIN batches` يُسقطها (عدّ ناقص / قسم «—»).
- **القاعدة:** استخدم **`LEFT JOIN batches`** واسترجع المنسق/القسم من `coordinator_history` (`coordAtDateSingleExpr` → `users.department`/قسم الفريق) عند غياب الـ batch. للعدّ: `LEFT JOIN` + `COUNT(DISTINCT canonical)`.
- فلتر القسم في تقرير الحضور: إن لم يوجد سجل `team_member_dept_history` يغطّي التاريخ → fallback إلى `team_members.section` (وإلا يظهر المنسق بأصفار).

### مطابقة تواريخ الريمارك بالغياب (DATE + HOLIDAY)
- المتوقع: ريمارك `Attendance Main Session/Zoom Call` بتاريخ = **اليوم الذي بعد الغياب** (`nextRemarkDay`: +1، أو +2 لو خميس [الجمعة عطلة])، **ويتخطّى نطاقات `official_holidays`** (إجازة العيد). `prevLectureDay` هو العكس. تطبيع تاريخ الريمارك من `DD/MM/YYYY, ...` عبر `normRemarkDate`.

### تقارير الجودة (`/quality-employee`)
- غياب الزووم (zoom_absent): **العدّ والتفاصيل** كلاهما من **`absent_zoom_students`** (الملف المرفوع) — ليتطابقا. (قرار الـ Owner.)
- غياب الأساسية: rename-aware (يطابق الـ batch بالاسم القديم أو الجديد).

### تسليمات الأقسام (`csDeliveries.service.js`)
- شهور/مستويات العميل في صفحة قسم = **لقسم تلك الصفحة فقط** (per-dept)، وليس إجمالي رحلته عبر الأقسام. (قرار الـ Owner.) `remaining_levels = max(0, paid_months_per_dept - groups_taken)`.
- scoping المنسق (role=agent): يطابق `batches.coordinators` بمفتاح مضغوط (مسافات).
- شرط «Start» في Enrollment = العدد الفعلي من `enrollment_students` (لو في روستر) ≥ 7، لا `num_students` القابل للكتابة.

### أمان
- أي endpoint يأخذ قيمًا من `req.query`/`req.body` في SQL لازم **parameterized** (`?` + bind). (مثال: ثغرة `GET /api/team` التي أُصلحت.)

---

## 4) الأخطاء المتكررة في البيانات (فئات الجذور) — افحصها في أي تقرير

| الفئة | الوصف | الحل المعتمد |
|---|---|---|
| RENAME | قديم في الغياب / جديد في المحاضرات+batches | `currentGroupNameExpr` / `effectiveGroupNameAtDate` + REPLACE مسافات |
| ENDED | تختفي من batches | `LEFT JOIN` + `coordinator_history` + COUNT(DISTINCT) |
| NAME-KEY | اسم مختلف عبر الجداول | مفتاح مضغوط؛ اعرض المسجّلين في الفريق فقط؛ استبعد `--` |
| STATUS | `إنتهت`/`غير منتهية` عربي | لا تفترض إنجليزي؛ `إنتهت` = مغلق |
| PHONE | فرق الصفر البادئ | `c.phone=a.phone OR '0'\|\|a.phone OR a.phone='0'\|\|c.phone` |
| SPACES | مسافات في أسماء المجموعات | `REPLACE(group_name,' ','')` الطرفين |
| OVERLAP | جمع جلسات متداخلة | `mergeIntervalsMinutes` / COUNT(DISTINCT canonical) |
| HOLIDAY | فجوة العيد في مطابقة التواريخ | `nextRemarkDay`/`prevLectureDay` تتخطّى `official_holidays` |

---

## 5) سجل الإصلاحات المنفّذة (audit 2026-06-05/06) — ~27 إصلاح، كلها على main

> راجع `git log` و `Quality_System_Data/system_audit_2026-06-05.md` للتفاصيل الكاملة بالأرقام.

- **إشغال المدربين:** المحجوز = الوقت المشغول (دمج المتداخل) في الـ heatmap والملخص (المرتبات) — كان يصل 246%/350% وهمي.
- **تقارير الجودة:** كانت واقعة 500 (متغير `activeDept`) → 200؛ غياب الأساسية rename-aware (740→1186)؛ zoom_absent من الملف المرفوع (الشارة=التفاصيل).
- **عداد الريماركات المفتوحة:** 24,295 → 147 (`إنتهت` = مغلق)؛ Remarks Monitor «resolved» = `إنتهت`.
- **الغياب/الريماركات:** غياب الزووم المعاد تسميته/المنتهي رجع (كان يسقط 2207)؛ القسم «—» يُسترجع من coordinator_history بمطابقة اسم مرنة؛ اسم منسق مكرر «doha, doha» → DISTINCT؛ استبعاد «--» وغير المسجّلين.
- **الحضور/الغياب:** المنسق المشترك يُحسب مرة (الأقدم)؛ `/segments` يطابق الصف؛ fallback لقسم الفريق عند غياب dept_history.
- **عدّ الداشبورد:** main/side/zoom = LEFT JOIN + COUNT(DISTINCT canonical) (يضمّ المنتهية، يمنع ازدواج التكرار) — main مايو 1748→5077.
- **ابحث عن مدرب:** بلا INNER JOIN batches (منع الحجز المزدوج).
- **code-problems:** تخطّي فحص آخر-تاريخ للمجموعات المكثفة؛ استبعاد «Free Slots»/«Hiring New Teacher».
- **الفريق:** `coordinator_type` صار قابلًا للتعديل؛ مزامنة `member_name` عند تغيير الاسم؛ **إصلاح ثغرة SQL injection** في `GET /api/team`.
- **التسليمات/Enrollment:** مطابقة اسم المنسق بمسافات؛ اقتراح المدرّس بلا batches + استبعاد تواريخ مستقبلية؛ شرط Start على الروستر الفعلي؛ شهور per-dept.
- **التواريخ:** مطابقة الريمارك تتخطّى إجازة العيد.
- **data-export:** أضيف `/db` (snapshot حيّ) + استعلامات تشخيص — قراءة-فقط، gated.

**بنود مؤجَّلة (ليست أخطاء كود — قرار/تنظيف بيانات من الـ Owner):**
- حذف صفوف المحاضرات المكررة فعليًا (مرفوض — خطر فقد بيانات؛ التقارير تتعامل معها).
- أسماء منسقين غير موجودة في الفريق (Ahmed Abdelal/Asmaa/Samah/MohamedDardasha) — تُتجاهَل حتى يضيفها الـ Owner.
- 286 غياب زووم بلا جلسة مطابقة (نقص بيانات في ملفات Drive — قائمة في `Quality_System_Data/غياب_زووم_بلا_جلسة.xlsx`).
- backfill أحداث resolved التاريخية (الكود متصلّح للجديد فقط — بقرار الـ Owner).

---

## 6) خريطة التقارير الرئيسية (endpoint ↔ شاشة)

| الشاشة (frontend) | الـ endpoint(s) |
|---|---|
| تقارير خدمة العملاء `SystemReports.jsx` | `/reports/dashboard`, `/absent-list`, `/absent-side-list`, `/remarks-notes-main`, `/remarks-notes-zoom`, `/remarks-notes-options`, `/remarks-list`, `/remarks-categories`, `/code-problems` |
| الحضور والغياب `AttendanceAbsenceReport.jsx` | `/attendance-absence`, `/attendance-absence/segments` |
| تقارير الجودة `QualityReports.jsx` | `/quality-employee`, `/quality-employee/details`, `/quality-snapshot*` |
| إشغال المدربين `TrainerUtilizationDashboard.jsx` / `TrainerUtilization.jsx` | `/trainer-utilization`, `/trainer-utilization-summary` |
| ابحث عن مدرب `TrainerAvailabilityFinder.jsx` | `/find-available-trainer` |
| سجل عمل المدربين `TrainerWorkHistory.jsx` | `/trainer-work-history` |
| الفريق والهيكل `TeamPage.jsx`/`OrgChart.jsx` | `/api/team*`, `/api/org-chart*` |
| Remarks Monitor `RemarksMonitor.jsx` | `/api/remarks-monitor*` (service: `remarksMonitor.service.js`) |
| تسليمات الأقسام / Enrollment / التوزيع | `/api/cs*`, `/api/enrollment*`, `/api/distribution*` (services: `csDeliveries`, `csEnrollment`, `csClientPlan`...) |
| المرتبات / المالية | `/api/trainer-salaries*`, `/api/finance*`, `/api/clients-finance*` |

---

## 7) ملاحظات تشغيل
- التحقّق من syntax: باك `node --check <file>`؛ فرونت `npx --no-install esbuild <file.jsx> --loader:.jsx=jsx --bundle=false --format=esm --outfile=NUL`.
- النشر يستغرق 1-3 دقائق (Railway native rebuild). افحص الصحة: `GET /api/health` (200).
- رسائل commit تنتهي بـ `Co-Authored-By: Claude ...`.

> **تذكير أخير:** عند أي طلب تعديل، طابقه على القسم 3 أولًا. لو فيه تعارض → نبّه الـ Owner واطلب تأكيدًا، ثم حدّث هذا الملف بالتاريخ.
