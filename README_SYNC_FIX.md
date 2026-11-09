# SYNC FIX — General Biology App (v5.0.0 backend + frontend)

## ⚠️ GAWIN MUNA ITO SA GOOGLE (3 hakbang, ~5 minuto)

1. Buksan ang Apps Script project → palitan ang BUONG laman ng `Code.gs` ng `backend/google-apps-script/Code.gs` sa zip na ito → **Save**.
2. Sa function dropdown piliin **`SETUP_ALL_SHEETS`** → **Run** (i-authorize kung hihingi). Gagawa ito ng lahat ng kulang na sheet at headers:
   `StudentsMasterlist` (dagdag na column `PointsJSON`), `Records`, `SyncCodes`, `SyncLog`, `UnlockRequests`, `ActivityLog` (bago), `ScoreOverrides` (bago). Tingnan ang View → Logs para sa ulat.
3. **Deploy → Manage deployments → ✏️ (Edit) → Version: "New version" → Deploy.**
   Huwag "New deployment" — mananatili ang parehong URL kaya hindi mo na kailangang baguhin ang `config.js`.
   (Sa comment ng config.js nakasulat na ang deployed ay "Version 1.6.0". Kapag hindi ka nag-"New version", lumang code pa rin ang tumatakbo kahit nag-paste ka na.)

Opsyonal (isang beses): run `CLEAN_DUPLICATES` (nagme-merge ng dobleng LRN rows) at `RUN_MIGRATION`.

Pagkatapos: i-upload sa GitHub ang mga files sa zip (parehong folder paths) at i-hard refresh ang app sa mga device.

## Test
Buksan sa browser: `<BACKEND_URL>?action=ping` → dapat `"version":"5.0.0"`.
Sa teacher: mag-login → lalabas ang data ng mga estudyante sa lahat ng teacher page (ang unang load ay isang beses na magre-refresh).

## MGA NAKITANG ERROR AT FIX
| # | Problema | Saan | Fix |
|---|----------|------|-----|
| 1 | **Term Exam hindi lumalabas sa teacher**: backend ay flat (`te:{score..}`), frontend ay nested (`te['biol1-te']`) | Code.gs, sync-master.js, classrecord import | Laging nested; inaayos ang lumang flat data |
| 2 | Teacher pages (class record, trackers, item analysis…) binabasa lang ang localStorage ng teacher; ang `teacher-sync-auto.js` ay hindi nilo-load ng kahit anong page | teacher pages | Bagong `teacher-sync-auto.js` na kusang nilo-load ng `teacher-auth.js`; auto-merge ng lahat ng estudyante bawat 60s |
| 3 | Assessment Tracker: maling token key, hindi-umiiral na action `pullTeacherDashboard`, maling storage key | assessment-tracker.html | Inayos; may alias din sa backend |
| 4 | Teacher token hindi sine-save kaya laging prompt / walang sync | teacher-login.html | Sine-save ang password bilang token (sessionStorage) |
| 5 | **Teacher offline/override scores ay hindi umaabot sa sheet**: ang regex `/unknown action/` ay hindi tumutugma sa `ERR_UNKNOWN_ACTION`, at wala ang `overrideScoresBatch` | score-override.js, Code.gs | Regex fix + bagong `overrideScoresBatch` (may ScoreOverrides audit log) |
| 6 | Lesson pages (`day.html`) bundle.js lang → points, badges, activity scores ay hindi na-sync; formative lang na pasado ang nagpa-push | bundle.js | Full snapshot push; bawat activity ay sine-save + pino-push (`ActivityLog`) |
| 7 | Performance Task (pt1) lokal lang | pt1.html | Pino-push na sa backend |
| 8 | `saveScore` nagbabalik ng OK kahit pumalya ang pag-save (lock timeout) → nawawalang score | Code.gs | Isang atomic lock; error ang ibinabalik → naka-queue at inuulit |
| 9 | Timestamp ng push ≠ timestamp ng lokal na score → hindi nagtutugma sa merge/duplicates | sync.js, quiz-engine.js | Parehong timestamp |
| 10 | Pumalyang push: itinatapon ang BAGONG score kapag may lumang naka-queue; binubura ang queue pagkatapos ng 5 try | sync.js, sync-master.js | Pinapalitan ng mas bago; hindi na binubura |
| 11 | `TextFinder` sa paghahanap ng LRN → "not found" → duplicate rows | Code.gs | Scan ng column A gamit normalized LRN |
| 12 | `LastUpdated` hindi na-uupdate; PROGRESS rows sa Records lumalaki bawat save | Code.gs | Inayos |
| 13 | Walang auto pull: ang ibang device ay hindi nakikita ang bagong progress maliban kung mag-re-login | sync-master.js, app.js | Auto push (30s) + auto pull (90s, sa pagbalik sa tab); listing pages auto-refresh |
| 14 | Quiz lock ay lokal lang → pwedeng mag-retake sa ibang device | sync-master.js | Locks ay kinukuha mula sa scores (maliban kung may na-redeem na retake code) |
| 15 | Force Sync / Sync before logout ay progress lang ang pino-push | dashboard.js, sync.js | Full two-way sync |
| 16 | Points (`PointsJSON`) hindi umiiral sa sheet | Code.gs | Bagong column |

## Hindi ko nagawa
Hindi ko nabuksan ang Google Sheet at Apps Script links mo (private at walang network access ang environment ko), kaya hindi ko nakita kung aling sheets ang aktuwal na kulang. Sa halip, ang `Code.gs` ay *kusang gumagawa ng lahat ng kulang na sheet at header* (hakbang 2). Nasubukan ko ang backend at ang sync flow sa simulation (2 device + teacher), hindi sa totoong Google environment.

## Mga file na hindi ko ginalaw (pero puwedeng linisin)
`assets/js/assets/js/teacher-auth.js` (lumang duplicate), `assets/js/lesson-engine.js` & `activity-gate.js` (hindi nilo-load ng kahit anong page), `student/login-fixed.html`.
