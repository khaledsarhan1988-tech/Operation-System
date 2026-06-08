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
- **نهاية العدّ + صفوف الشبح (تحديث 2026-06-08):** `trainerCountEnd(t,shifts)` = آخر `end_date` عبر كل الشيفتات، أو `null` لو أي شيفت مفتوح (المدرّب لسه شغّال). بعد هذا التاريخ تُستبعد **فقط** المحاضرات `مجدولة` (scheduled) من الـ booked في `/trainer-utilization` + `/trainer-utilization-summary` — لأنها **rows شبح**: لمّا المدرّب يسيب الشغل تُزال سلوتاته المتكررة من الشيت الحيّ، لكن الصفوف المستوردة سابقًا تبقى في الـ DB (الـ importer يحذف فقط مفاتيح group+date الموجودة في الملف الجديد) وتضخّم النسبة (Nashwa 265%، واتأكد من Drive أن آخر محاضرة لها 14/5 و الـ133 صف غير موجودة بالملف). **المحاضرات `مؤكدة` لا تُستبعد أبدًا** (مدفوع عليها فعلًا)، فآخر محاضرة حقيقية بعد الشيفت بيوم تظل محسوبة، ولا يتأثر أي مدرّب نشط. عدد المستبعَد يظهر كعلامة `stale_after_shift_end` (شارة «⚠ صف شبح» بجوار الاسم) لتنبيه الـ Owner لتنظيف الشيت.
- **ابحث عن مدرب:** كشف التعارض يقرأ من `lectures` مباشرة (**بلا INNER JOIN batches**) وإلا تُخفى تعارضات المجموعات المنتهية/المعاد تسميتها ويظهر المدرب «متاح» وهو مشغول.
- **(2026-06-06) نافذة الوقت اختيارية في `/find-available-trainer`:** لو `from_time`/`to_time` فاضيين الاتنين → **وضع «كل الأوقات المتاحة»**: لكل يوم مختار يُحسب اتحاد الفجوات الفاضية = الشيفت − (الراحات + الـ voice notes + المحاضرات المحجوزة) عبر `freeIntervals`، والمدرّب «متاح» لو عنده أي فجوة ≥ 15 دقيقة (`MIN_GAP`)، وتُرجَّع الفجوات في `slot.free_slots`. لو الاتنين محدّدين → السلوك الأصلي (نافذة محددة). وقت واحد بس بدون التاني = خطأ. (الفرونت: خانة اختيار صريحة «ابحث بدون تحديد وقت» تعطّل حقلي الوقت وترسل وقت فاضي — لأن إفراغ `input type=time` يدويًا صعب؛ + عرض الفجوات في النتيجة.)
- **مصدر اسم المدرّب (مهم):** كل التقارير (أساسي + جانبي) تنسب المحاضرة للمدرّب من **عمود «المدرّب» المخصّص في شيت المحاضرات = العمود E / `r[4]`** (`excel.service.js:324` للأساسي و `:391` للجانبي) — **وليس** من الاسم المكتوب داخل أقواس اسم المجموعة. ترتيب الأعمدة: A=group_name, B=date, C=time, D=duration, **E=trainer**, F=status, G=location, H=attendance. المطابقة بفريق العمل = `stripParens(lectures.trainer)` (يشيل لاحقة `(Semi)`) ↔ `stripParens(team_members.name)`. ⇒ لإعادة نسب محاضرات مدرّب (مثل مدرّب ترك العمل) يجب تغيير **العمود E** في الشيت، لا اسم المجموعة. والاسم داخل أقواس المجموعة يُستخدم فقط لتحديد المنسق (اللاحقة بعد الأقواس).
- **حالة `غير مؤكدة`:** المحجوز يَعُدّ المحاضرات حتى لو `status='غير مؤكدة'` (لا فلتر حالة عام). أما `مجدولة` بعد مغادرة المدرّب فتُستبعد (انظر «نهاية العدّ + صفوف الشبح» أعلاه).

### حالة المحاضرة (Arabic STATUS) + عدّ المحاضرات
- قيم `lectures.status`: **`مؤكدة`** (اتعملت فعلًا/delivered)، **`مجدولة`** (محجوزة/scheduled، لسه ماتعملتش)، **`غير مؤكدة`** (unconfirmed)، **`ملغية`** (cancelled).
- **عدّ المحاضرات المُسلّمة (KPIs الداشبورد: main_lectures/side_sessions/zoom_calls) = `status='مؤكدة'` فقط** (تحديث 2026-06-08). كان الكود يفلتر `!= 'غير مؤكدة'` فيشمل `مجدولة` → الرقم متضخّم ~2× (نصّه محاضرات مجدولة مش مُسلّمة، ومنها صفوف شبح مش في الشيت). القرار: المُسلّم = `مؤكدة`. (الدمج: `COUNT(DISTINCT <canonical session>)` لمنع توائم إعادة التسمية.)
- **البيانات تتراكم + الحل الجذري (تحديث 2026-06-08):** الـ importer يحذف فقط مفاتيح group+date الموجودة في الملف، فكانت تتراكم صفوف قديمة (~50% من lectures مش في الشيت). نوعان: (أ) `مؤكدة` قديمة = **تاريخ حقيقي محفوظ عمدًا** (مجموعات منتهية/معاد تسميتها) — **تفضل وتُعدّ**؛ (ب) `مجدولة` قديمة = **شبح**. **الحل الجذري:** `syncLectures`/`syncSideSessions` دلوقتي بعد كل استيراد بينادوا `archivePhantomScheduled(line,type,fileRows)` اللي بينقل أي صف **`مجدولة`** مش في الملف الكامل إلى **`lectures_history`** (أرشفة قابلة للتراجع، **لا تلمس `مؤكدة` أبدًا**). محميّ بحارس `detectAnomaly` (يرفض الملفات الناقصة) + مطابقة group بدون مسافات/حالة. التنظيف يحدث في أول مزامنة بعد النشر (تستخدم أحدث ملف). ⇒ الشبح لا يتراكم. مع ذلك تظل القاعدة العامة: أي عدّ من `lectures` = `مؤكدة` فقط (للمُسلّم) **أو** `COUNT(DISTINCT canonical)` rename-aware. التقارير من `remarks`/`absent_students`/أعمدة `batches` غير متأثرة أصلًا.

### حالة الريمارك (Arabic STATUS)
- القيم الفعلية فقط: **`إنتهت`** (منتهية/done) و **`غير منتهية`** (مفتوحة). عداد «الريماركات المفتوحة» = `غير منتهية` فقط (يجب استبعاد `إنتهت`). أي قائمة closed تشمل `إنتهت`. Remarks Monitor يعتبر `إنتهت` = resolved.

### المنسقون (NAME-KEY)
- مفتاح المطابقة = **اسم الفريق/الـ username** (مثل `Malika7`, `yassmen`, `RadwaGamal`) كما في `coordinator_history.coordinator` / `batches.coordinators` / `team_members.name` — **وليس** `users.full_name` («Malika Dardasha» ≠ «Malika7»).
- المطابقة تتم بمفتاح **مضغوط** (إزالة المسافات + lowercase): «RadwaGamal» = «Radwa Gamal» (`userDeptExpr`, `coordStrHasName`).
- قوائم/أعمدة المنسقين تعرض **فقط** المنسقين المسجّلين في **فريق العمل** (`team_members`). الأسماء غير المسجّلة و الـ placeholder **`--`** تُعرض **فارغة**.
- منسق فريق خدمة العملاء النشطين = `team_members WHERE department='customer_services' AND status='active'`. dropdown تقارير خدمة العملاء يأتي من هؤلاء (لا من `users`).
- **النسب المنتهية (المجموعة بمنسقين):** كل حدث يُنسب لـ **منسق واحد** = الأقدم (`ORDER BY effective_from ASC, coordinator ASC LIMIT 1`) — لا GROUP_CONCAT ولا حساب مزدوج. `/attendance-absence/segments` يطابق نفس المنطق فيتساوى مجموع المقاطع مع صف المنسق.
- **المتوقع (denominator) + تكرار batches (تحديث 2026-06-08):** «متوقع» الجلسات الأساسية = `SUM(MAX(عدد المتدربين, الحاضر+الغايب))` لكل محاضرة. مصدر عدد المتدربين = `batches.trainee_count` (المجموعات المنتهية «إنتهت» مستورَدة بالفعل في batches، 9020 صف، فتؤخذ منها مباشرة)، وإلا عدد العملaء، وإلا (للمجموعات غير الموجودة في الشيت) الحاضر+الغايب. لإضافة دقة لمجموعة منتهية: ضِفها في شيت Batches بحالة **«إنتهت»** + عدد متدربين (لا تُحسب نشطة لأن العدّادات تفلتر `status='نشطة'`). **مهم — تكرار batches:** أي JOIN على `batches` على `group_name` يُضاعف الصفوف لو المجموعة لها أكثر من صف (نشط+«إنتهت» أو تكرار placement — 32 مجموعة اليوم). الحل: helper موحَّد **`DEDUP_BATCHES`** (`SELECT group_name,line,MAX(coordinators),MAX(dept_type),MAX(trainee_count),MAX(lecture_duration_min) FROM batches GROUP BY group_name,line`) بدل `batches` المباشر. مطبَّق على: المتوقع (attendance-absence + quality)، `lectures-list`، `attendance-absence-by-department`، و absent_main في الداشبورد. تحقّق فرقي (as-is مقابل batches موحَّد) = صفر فرق في تلك التقارير. (عدّادات المجموعات في الداشبورد — نشطة/منتظرة/منتهية الصلاحية — تستبعد المجموعات الداخلية `notInternalGroup` مثل باقي التقارير: active_groups 689→685، waiting 34→32 و20→17، بعد استبعاد placement test / free slots. تكرار صف نشط حقيقي نادر (مثل مجموعة مكتوبة «بانتظار» + «نشطة» معًا) = تنظيف بيانات من جهة الـ Owner.)
- **غياب موظفي الجودة = غياب الحضور/الغياب (تحديث 2026-06-08):** `quality-employee` كان ينسب الغياب عبر `batches.coordinators` الحالية (نموذج مختلف + يُسقط المجموعات المنتهية) → أرقام لا تطابق `/attendance-absence` (مثال: shrouk gamal 0 مقابل 129، doha 123 مقابل 196). الآن يبني نفس خرائط الغياب per-coordinator بنفس منطق `dateAwareCoord` (coordinator_history + عضو روستر مُوظَّف + منسق واحد أقدم + ended-group resilient) ويبحث بالاسم المضغوط ⇒ الرقمان متطابقان لكل منسق. أي تعديل في حساب غياب أحد التقريرين يجب أن ينعكس في الآخر.

### المجموعات المعاد تسميتها (RENAME)
- عند إعادة التسمية: **`lectures`/`batches` بالاسم الجديد**، لكن **`absent_students`/`absent_zoom_students` بالاسم القديم**، و**`group_renames`** يخزّن (old→new). أي مطابقة غياب↔محاضرة/batch بالاسم بالضبط هشّة.
- **القاعدة:** كل مطابقة لازم تكون **rename-aware**: طابق بالاسمين عبر `currentGroupNameExpr(group,line)` (old→new) أو `effectiveGroupNameAtDate` (new→old، للأحداث قبل التسمية). مع تطبيع المسافات `REPLACE(...,' ','')`.
- **⚠ تلوّث `group_renames` بسجلات مكررة/معكوسة (تشخيص 2026-06-06):** الـ Drive sync **يعيد تسجيل** نفس التسمية في كل تشغيلة بختم `renamed_on` = تاريخ التشغيلة (تسمية واحدة حقيقية NORHAN→Radwa يوم 06-01 تظهر مكرَّرة 06-04/06-06)، **ويصدّر الحافة المعكوسة** أيضًا (Radwa→NORHAN وهمية). الجدول: 1888 صف / 794 مميَّز / 717 بأكثر من تاريخ / 324 زوج معكوس / 594 اسم canonical غير مستقر. هذا كسر الدالتين فطلعت أصفار غياب وهمية + تضاعف عدّ المحاضرات لكل منسق. **الإصلاح (logic-only، بلا لمس بيانات):** (1) `effectiveGroupNameAtDate` لا يرجّع الاسم القديم إلا إذا كان تاريخ الحدث **أقدم من `MIN(renamed_on)`** للاسم الجديد (يتجاهل التكرارات المتأخرة)؛ (2) `currentGroupNameExpr` **يرسو على `batches`**: الاسم الموجود حاليًا في `batches` هو الحالي (القديم يُحذف عند التسمية) → canonical مستقر وصحيح. غياب RadwaGamal: 0/0 → **18/19** (مطابق للمودالز). **بند معلّق (جذر):** إصلاح `driveSync` ليتوقف عن توليد السجلات المعكوسة/المكررة + تنظيف الجدول.
- **تكرار المحاضرات (~40%):** الـ importer يحذف `WHERE group_name=? AND date=?` فقط، فصفوف الاسم القديم تتراكم (~26k صف توأم). **القرار: لا تُحذف** (الحذف أثبت أنه يفقد ~11k جلسة فريدة). بدلًا منها: التقارير تتعامل معها — الإشغال يدمج الفترات، والعدّ يستخدم `COUNT(DISTINCT <canonical session>)`.

### المجموعات المنتهية (ENDED → تختفي من `batches`)
- المجموعة لمّا تخلص **تُحذف من `batches`** لكن تبقى في `lectures` + `coordinator_history`. أي `INNER JOIN batches` يُسقطها (عدّ ناقص / قسم «—»).
- **القاعدة:** استخدم **`LEFT JOIN batches`** واسترجع المنسق/القسم من `coordinator_history` (`coordAtDateSingleExpr` → `users.department`/قسم الفريق) عند غياب الـ batch. للعدّ: `LEFT JOIN` + `COUNT(DISTINCT canonical)`.
- فلتر القسم في تقرير الحضور: إن لم يوجد سجل `team_member_dept_history` يغطّي التاريخ → fallback إلى `team_members.section` (وإلا يظهر المنسق بأصفار).

### المجموعات الداخلية / placeholder (INTERNAL) — تُستبعد من تقارير الغياب (قرار الـ Owner 2026-06-06)
- مجموعات **مش تدريس حقيقي**: اختبار تحديد المستوى (`Placement Test`/`Placemnent Test`/`تحديد مستوى` بكل الإملاءات)، `Free Slots(DONOT CLOSED)`، `Hiring New Teacher`. العميل يُوضع فيها مؤقتًا ومجموعته/منسقه الحقيقي مختلف (مثال: zain tamer في «Placemnent Test»/doha بينما مجموعته الفعلية مع magdy).
- كانت **~79% من «غياب المحاضرات الأساسية»** تأتي منها وتُنسب لمنسق غلط.
- **القاعدة:** استبعدها من **كل** تقارير الغياب/العدّ عبر helper `notInternalGroup(groupExpr)` (LIKE `%free slot%` / `%hiring new teacher%` / `%placem%test%` / `%تحديد مستو%`). مطبَّق في: `/absent-list` (part1+2)، `/absent-side-list`، `/remarks-notes-main`، `/remarks-notes-zoom`، `/attendance-absence`، `/quality-employee` (العدّ + التفاصيل). (code-problems كان يستبعد Free Slots/Hiring بالفعل.) النتيجة: absent-list 13,696 → 2,892.

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
| INTERNAL | مجموعات placeholder (Placement Test/Free Slots/Hiring) | استبعدها عبر `notInternalGroup(groupExpr)` من كل تقارير الغياب |

---

## 5) سجل الإصلاحات المنفّذة (audit 2026-06-05/06) — ~27 إصلاح، كلها على main

> راجع `git log` و `Quality_System_Data/system_audit_2026-06-05.md` للتفاصيل الكاملة بالأرقام.

- **إشغال المدربين:** المحجوز = الوقت المشغول (دمج المتداخل) في الـ heatmap والملخص (المرتبات) — كان يصل 246%/350% وهمي.
- **تقارير الجودة:** كانت واقعة 500 (متغير `activeDept`) → 200؛ غياب الأساسية rename-aware (740→1186)؛ zoom_absent من الملف المرفوع (الشارة=التفاصيل).
- **عداد الريماركات المفتوحة:** 24,295 → 147 (`إنتهت` = مغلق)؛ Remarks Monitor «resolved» = `إنتهت`.
- **الغياب/الريماركات:** غياب الزووم المعاد تسميته/المنتهي رجع (كان يسقط 2207)؛ القسم «—» يُسترجع من coordinator_history بمطابقة اسم مرنة؛ اسم منسق مكرر «doha, doha» → DISTINCT؛ استبعاد «--» وغير المسجّلين.
- **الحضور/الغياب:** المنسق المشترك يُحسب مرة (الأقدم)؛ `/segments` يطابق الصف؛ fallback لقسم الفريق عند غياب dept_history.
- **(2026-06-06) `employmentWindowFilter` صار rename/ended-aware:** كان يربط lookup الـ coordinator_history بـ `b.group_name` (alias batches)، فالمجموعات المنتهية/المعاد تسميتها (b=NULL في LEFT JOIN) كانت تُسقَط كلها → مودال «تفاصيل الغياب» في تقرير الحضور/الغياب يظهر **عرض 0** للمنسق رغم وجود عدّ (مثال yassmen: 251 مقابل 0). الإصلاح: يفتاح على مجموعة الحدث نفسها (`a/l`) عبر `effectiveGroupNameAtDate` — زي `coordFilterAtDate`. أُصلحت الدالة + 4 استدعاءات (absent-list ج1/ج2، absent-side-list، absent-zoom). متحقَّق: المودال 0 → 246/296.
- **(2026-06-06) توحيد مصدر غياب الزووم في `/attendance-absence`:** الجدول كان يحسب `zoom_absent` من جدول `lectures` (خانات الجلسات الجانبية بلا حضور) — وده يضخّم بشدة لأن حضور الزووم لا يُسجَّل في `lectures.attendance` بل في الملف المرفوع. بقى يستخدم **`absent_zoom_students` (الملف المرفوع)** لمّا تتاح — نفس مصدر الداشبورد و`/absent-side-list` وقرار 2026-06-06 — مع fallback لصيغة lectures القديمة لو لا ملف للّاين. الأثر: yassmen zoom_absent 1631→**334**، إجمالي الزووم ~10277→**3611**.
- **(2026-06-06) `dateAwareCoord` في `/attendance-absence` صار rename-aware:** كان ينسب الأحداث للمنسق باستخدام الاسم الخام (`${alias}.group_name`) في lookup الـ `coordinator_history`، بينما القوائم drill-down (`coordFilterAtDate`) rename-aware — فاختلفت الأرقام (yassmen: جدول 334/251 مقابل مودال 296/246). أُصلح بلفّ الاسم في `effectiveGroupNameAtDate` (نفس قاعدة بقية المطابقات). النتيجة: **العدّ = التفاصيل بالظبط** (yassmen 246/296، shrouk gamal 128/309، doha 177/246 — كلها جدول=مودال). يطبّق على كل أرقام الجدول (main_expected/absent + zoom_expected/absent).
- **(2026-06-06) شارة «⚠ موظف آخر» في ريماركات المحاضرات الأساسية:** كانت تظهر في جدول الجلسات الجانبية فقط (`SystemReports.jsx` عمود المسؤول) — لمّا يكون منفّذ الريمارك ≠ منسق المجموعة. أُضيف نفس الشرط بالظبط لجدول المحاضرات الأساسية للاتساق (frontend فقط؛ `/remarks-notes-main` يرجّع `coordinators/dept_type/has_remark/assigned_to` أصلًا). نشر Vercel — commit d9bb863.
- **عدّ الداشبورد:** main/side/zoom = LEFT JOIN + COUNT(DISTINCT canonical) (يضمّ المنتهية، يمنع ازدواج التكرار) — main مايو 1748→5077.
- **(2026-06-06) تصليب RENAME ضد تلوّث `group_renames`** (تفاصيل في القسم 3): `effectiveGroupNameAtDate` بقاعدة `MIN(renamed_on)` + `currentGroupNameExpr` يرسو على `batches`. أثره: غياب المنسقين المعاد تسمية مجموعاتهم رجع (RadwaGamal 0/0→18/19)، وعدّ المحاضرات لكل منسق بطّل يتضاعف. **تأثير على رقم معاير:** الـ COUNT(DISTINCT) العام يقلّ (main 2026-05-01..06-06: ~5567→4643، side ~9746→7992) لأنه كان يضخّم بسبب فشل دمج التوائم — تم التحقّق أن التقليل دمج توائم حقيقية فقط (عينة 8/10 rename-linked، بلا over-dedup). [نُشر — commit 1f759dd.]
- **(2026-06-06) إصلاح جذر تلوّث `group_renames` (WRITE-side):** في `sync.service.js` (كشف التسمية) أُضيف حارسان قبل `INSERT`: (1) **idempotent** — تخطّي لو نفس `(old,new,line)` مسجّل (يحافظ على أقدم `renamed_on`)؛ (2) **منع العكس** — تخطّي لو الحافة العكسية `(new→old)` مسجّلة (أول اتجاه/التسمية الحقيقية يكسب، لا دورات A↔B). السبب: `UNIQUE(new_group_name,line,renamed_on)` يشمل التاريخ فكل سينك يعيد ختم صف جديد، و `DELETE FROM batches WHERE line=?` ثم إعادة الإدخال من ملف Drive قديم يقلب الاسم ويسجّل العكس. **+ migration لمرة واحدة (idempotent) في `app.js`** ينظّف الموجود: يبقي أقدم `renamed_on` لكل `(old,new,line)`، ثم يحذف الجانب الخطأ من كل زوج معكوس (الذي `new_group_name` بتاعه ليس الاسم الحيّ في `batches`؛ وإن تعذّر يبقي الأقدم). نسخة احتياطية لمرة واحدة في `group_renames_backup_20260606`. **متحقَّق على اللايف:** 1930→674 صف، صفر تكرارات/عكوسات، idempotent؛ الغياب ثابت (18/19)، وعدّ main العام يقلّ (4923→4736 على نفس الـ snapshot = ازدواج أقل). **حدّ معروف:** مجموعة رجعت فعلًا لاسمها القديم لن تُسجَّل (مقايضة ضد التلوّث)؛ وملف Drive قديم قد يقلب اسم batches (مصدره محتوى الملفات).
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
- **توائم محاضرات باسم مدرّب مختلف:** صفّان لنفس (group+date+time) لكن `trainer` مختلف (مثال May_17: «Esraa Hani» مقابل «Manar Abdulhameed») يظلّان جلستين لأن `sessKey` يشمل المدرّب عمدًا — مشكلة جودة بيانات منفصلة، لا تُدمج تلقائيًا (تغيير `sessKey` يتعارض مع قرار 2026-06-06).
- ~~**جذر تلوّث `group_renames`:** إصلاح `driveSync`~~ → **تم (2026-06-06)** — انظر سجل الإصلاحات أدناه.

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
