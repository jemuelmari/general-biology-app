# General Biology App — v2.6.0 (Backend Code.gs v5.1.0)

Petsa: November 15, 2026

---

## 1. Deploy steps

Sundin nang sunod-sunod.

### A. Backend (Apps Script)

1. Buksan ang Apps Script project ng General Biology.
2. Palitan ang buong laman ng `Code.gs` ng bagong **Code.gs v5.1.0**.
3. I-save, tapos i-run ang **`SETUP_ALL_SHEETS`** nang isang beses.
4. **Palitan ang teacher password.** Kailangan ito: lumabas sa public repo ang lumang password at ang default secret.
   1. Sa `Code.gs`, hanapin ang `SET_TEACHER_PASSWORD`.
   2. Ilagay ang bagong password sa `const NEW_PASSWORD = '...'`.
   3. I-run ang `SET_TEACHER_PASSWORD`.
   4. Kopyahin ang hash na lalabas sa *Execution log*.
   5. **Burahin ulit** ang password sa `NEW_PASSWORD` (gawing `''`), tapos i-save.
5. Gumawa ng bagong deployment: **Deploy → Manage deployments → Edit → Version: New version → Deploy**. Pareho pa rin ang URL.

### B. Website (GitHub repo)

1. Sa `config.js`, palitan ang `TEACHER_PASSWORD_HASH` ng hash na nakuha mo sa step A4.
2. I-upload lahat ng file na nakalista sa `changed-files-bio.txt`.
3. Burahin sa repo ang mga file na ito (luma, duplicate, o delikado):
   - `student/login-fixed.html`
   - `assets/js/assets/js/teacher-auth.js`
   - `assets/js/lesson-engine.js`
   - `assets/js/activity-gate.js`
   - `backend/google-apps-script/Code.txt` — may lumang secret ito
4. Hintayin matapos ang GitHub Action na **"Bump cache-bust versions"**. Ito ang nag-a-update ng `?v=` para makuha ng mga phone ang bagong files.

### C. Pag-check pagkatapos mag-deploy

- Mag-log in bilang teacher gamit ang **bagong** password.
- Sa **Sync Center** o **Class Record**, pindutin ang ☁️ Sync. Dapat lumabas ang lahat ng estudyante.
- Buksan ang **TOS Generator**. Dapat 70% LOTS : 30% HOTS ang bawat test.

---

## 2. Mga error na naayos

### Security

| Problema | Ayos |
|---|---|
| Nasa public na `config.js` comment ang teacher password ("teacher2026") | Tinanggal. Hash lang ang naka-save, at may `SET_TEACHER_PASSWORD` na pampalit. |
| Default `TEACHER_SECRET` na nakasulat sa Code.gs (at sa Code.txt) | Tinanggal. Ang token ay chine-check na laban sa SHA-256 hash sa Script Properties. |
| Kayang palitan ng kahit sino ang pangalan ng ibang estudyante gamit lang ang LRN | Pangalan, section at grade ng existing na estudyante ay **teacher lang** ang makakapagpalit (Normalize Names → `updateStudentInfo`). |
| Puwedeng maglagay ng HTML/script sa pangalan (XSS) | Nililinis ang pangalan sa device at sa backend. Naka-escape din ang mga teacher page. |
| Pagpaparehistro gamit ang LRN na nagamit na | Chine-check muna sa cloud bago tanggapin. |

### Syncing

| Problema | Ayos |
|---|---|
| Hindi naipapadala sa teacher ang score pagka-submit ng quiz (laging "saved on this device") | Ayos na: `window.Sync` ay hindi pala nakikita ng quiz engine. Nag-sync lang dati kapag nag-auto-sync ang ibang page. |
| Bumabalik ang score na tinanggal (Remove) ng teacher dahil ibinabalik ito ng phone ng estudyante | "Tombstone" na ang removal kaya hindi na bumabalik. |
| Sync Center import ay nasa teacher device lang | Minemerge na at ipinapadala rin sa Google Sheet. |
| Dalawang beses na-load ang SyncMaster sa ilang page (error) | Isang beses na lang. |
| Walang auto-pull sa week/subject list pages | Mayroon na. |
| `bundle.js` ay may sariling lumang kopya ng CONFIG/Store/Sync | Tinanggal. Iisang source na lang. |
| Ang "activity gate" (para ma-unlock ang Activity 2 at Formative) ay nasa sessionStorage lang, kaya nawawala kapag nag-reload | Kinukuha na sa naka-save na activity results. Puwede ring ituloy sa ibang device. |
| Puwedeng paulit-ulitin ang activity para dumami ang points | Ang best run lang kada activity ang binibilang. |

### Quiz / ST / TE (pandaraya at stability)

- **Na-save na ang attempt.** Kapag nag-reload o nag-close, babalik sa parehong tanong, parehong pagkakasunod, at tuloy-tuloy ang timer.
- **"In-progress" marker.** Hindi na puwedeng magsimula ulit ng parehong test sa ibang device. Para sa ganitong kaso, may screen na "Test Already Started → request retake".
- **Tab-switch counter.** Hindi na doble ang bilang. Hindi na rin binibilang ang reload.
- **Score check sa backend.** Ang score ay kinukuwenta ulit mula sa item-by-item breakdown.
- **Bagong schedule ng quizzes.** Dati, bukas na ang Quiz 1 sa Week 1 Day 1, bago pa ang lesson.

  | Test | Coverage | Bukas pagkatapos ng |
  |---|---|---|
  | Quiz 1 | Weeks 1–3 | Week 3 Day 4 |
  | Quiz 2 | Weeks 4–6 | Week 6 Day 4 |
  | Quiz 3 | Weeks 7–9 | Week 9 Day 4 |
  | Summative Test 1 | Weeks 1–4 | Week 4 Day 4 (walang binago) |
  | Summative Test 2 | Weeks 5–8 | Week 8 Day 4 (walang binago) |
  | Term Exam | Weeks 1–10 | Week 10 Day 4 (walang binago) |

### Grading (sundin ang sagot mo)

- **Linear na transmutation**, gaya ng GenSci:
  - Raw 70 → 75.
  - Mula 70 hanggang 100, pantay ang pag-akyat hanggang 100.
  - Below 70 = raw + 5.
- **Weights:** WW 25% / PT 45% / QA 30%.
  - Sa loob ng QA: ST1 30%, ST2 30%, TE 40%.
- **Passing:** 70% sa lahat — quizzes, ST, TE at lesson activities.
- **Pagbilang ng scores:** binibilang lang ang assessment na naibigay na sa klase. Ang hindi kinuha ng estudyante ay 0, hindi "hindi kasama".
- **Intervention:**

  | Level | ST average |
  |---|---|
  | Enrichment | ≥ 90 |
  | On Track | 70–89 |
  | Remediation | 60–69 |
  | Urgent | < 60 |

- Ang "passed" ay kinukuwenta ulit gamit ang 70%. May mga lumang score kasi na naka-tag gamit ang lumang 80%.

### Iba pa

- **Remediation page.** Placeholder lang ito dati. Ngayon, ipinapakita na ang mga competency na namali ang estudyante, kasama ang link sa tamang week.
- **PT2 at PT3.** May sarili na silang page, gaya ng PT1.
- **Profile.** Read-only na para sa estudyante. Ang teacher ang nagtatama ng pangalan.

---

## 3. Mga bagong feature

| Feature | Saan |
|---|---|
| **TOS Generator**: Table of Specifications ng bawat quiz/ST/TE (competency, week, no. of days, % of time, items, Bloom R/U/Ap/An/E/C, item placement), printable na may Prepared/Checked/Approved | Teacher Home → 🧮 TOS Generator |
| **5 Most / 5 Least Learned Competencies** (ST1 + ST2), may buong competency statement; puwedeng i-filter by section | Nasa TOS Generator din |
| **Give a retake code** nang walang request (absent, sira ang phone, o pagkatapos ng remediation) | Teacher Home → 🔒 Retake Codes |
| Pagtatama ng pangalan na nagsi-sync sa Sheet | Normalize Names |
| Item Analysis na kayang basahin ang luma at bagong items | Item Analysis |

---

## 4. Content revision (lahat ng 20 weeks at 12 test banks)

### Daily lessons (80 days)

- **💬 Let's Discuss** sa bawat araw. Nasa 200–300 salita ito: paliwanag, halimbawa na pang-Pilipino, at isang *common mistake*.
- May **paliwanag** ang bawat sagot:
  - 💡 sa matching (review pagkatapos)
  - pagkatapos ng bawat scenario card
  - pagkatapos ng bawat formative question

  Huminto ang timer habang binabasa ang paliwanag.
- **Balanced na choices.** Dati, ang tamang sagot ang pinakamahabang choice sa ~60% ng items. Ngayon nasa 33%, na halos tsamba lang. Tinanggal din ang mga "✓" na nagbibigay ng sagot.

### Question banks

| Test | Items | LOTS : HOTS |
|---|---|---|
| Quiz 1–3 | 20 bawat isa | 14 : 6 |
| Summative Test 1–2 | 30 bawat isa | 21 : 9 |
| Term Exam | 60 | 42 : 18 |

- **Term Exam.** Dati, Weeks 9–10 lang ang sakop. Ngayon **Weeks 1–10** na, at ang dami ng items kada competency ay ayon sa dami ng araw na itinuro ito.
- May `bloomLevel` na ang bawat item. Ang tamang sagot ay pantay ang puwesto sa A/B/C/D.
- Passing score: **70**.

**Lumang items.** Ang mga lumang item na binago o pinalitan ay nasa `archivedItems` sa loob ng bawat bank. Dahil dito, tama pa rin ang **Exam Evidence** at **Item Analysis** ng mga estudyanteng kumuha na ng lumang bersyon. Hindi rin nagbago ang stored scores nila.

---

## 5. Paalala

- Ang mga estudyanteng nakakuha na ng Quiz/ST/TE ay **hindi** kailangang kumuha ulit. Naka-save pa rin ang score nila.
- Kapag gusto mong ipakuha ulit ang bagong Term Exam, gamitin ang **Give a retake code**.
- Ang lumang `TEACHER_SECRET` sa Script Properties ay awtomatikong binubura ng `SET_TEACHER_PASSWORD`.
