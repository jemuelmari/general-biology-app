# General Biology Online Modular Application

**Version:** 2.3.7
**Subjects:** General Biology 1 & General Biology 2
**Grade Level:** Grade 12 — GAS
**Term:** Term 2 (3-Term School Calendar)
**School Year:** 2026–2027

---

## 👨‍🏫 Developer

**JEMUEL C. MARI, MAN, RN, LPT**
Senior High School Teacher · Teacher II
Iba High School
San Jose West District
Schools Division of Tarlac Province
Region III
Department of Education

---

## 📖 Overview

A web-based modular learning application for Senior High School General Biology 1 and General Biology 2, aligned with the DepEd K to 12 Curriculum Guide (August 2016) and DepEd Order No. 015, s. 2026.

Contains **three platforms**:

| Platform | File | Purpose |
|---|---|---|
| Student Application | `index.html` | Lessons, gamified activities, assessments, remediation |
| Teacher Application | `instructor.html` | Item analysis, intervention, sync center (password-protected) |
| Gradebook Application | `classrecord.html` | Class record, transmutation, reports (password-protected) |

---

## 🖨️ Print Exam Copies (Teacher Dashboard)

For students who cannot access the internet. Teacher Dashboard → **Print Exam Copies** (`teacher/print-exam.html` + `teacher/print-exam.js`).

- Pick subject (Gen Bio 1 / 2) and assessment (Quiz 1–3, ST 1–2, Term Exam); questions are read live from `data/{subject}-{assessment}.json`
- Versions: Set A, Set B (different question order), both, or master copy (original order)
- Output: student copy, student copy + answer key (own page), or answer key only
- **Randomize choices** (default on): the banks mostly place the correct answer in A/B, so printed copies spread it evenly across A–D (no 3-in-a-row); the printed key always matches
- Paper: short bond / A4 / long bond; 10–12 pt; 1 or 2 columns; editable directions
- **Print** (browser print dialog) or **Save as Word (.docx)** via `docx@8.5.0` (falls back to `.doc` if the library cannot load)

---

## ✏️ Offline Scores / Score Override (Class Record)

For students who took an exam on paper (see **Print Exam Copies**) or whose score needs correcting.

- **Class Record → ✏️ Offline Scores** (`classrecord/offline-scores.html`): pick subject + assessment + section, type each student's raw score, **Save & sync**. Blank rows are skipped.
- **Per student:** click ✏️ beside a name in the gradebook → **Grading Sheet** → *Add score* / *Override* on any Quiz, ST, Term Exam or PT. Manual scores show **✎ Manual** with the reason; **↩ Revert** restores the previous online result.
- Scores are written to the same local store the class record reads, so **WW / PT / EX / Final grade recompute immediately**.
- **Backend sync:** pushed to the Google Sheet via `overrideScoresBatch` (teacher token required; logged in the `SyncLog` sheet). If you are offline or the token is wrong, the override is kept on this device and queued — use **Send now** later. A backend pull never overwrites a newer manual score, and a late/stale student upload cannot replace it.
- ⚠️ **Redeploy `Code.gs` (v2.2.0)** to enable the batch action and the override-aware aggregation. Until then the app falls back to the old `saveScore` action (it still syncs, but the “Manual” mark is not stored in the sheet).

---

## 📱 Install as App

This app can be **installed** on any device (phone, tablet, laptop) for quick access:

- **Android (Chrome):** Menu → *Install app*
- **iOS (Safari):** Share → *Add to Home Screen*
- **Windows/Mac (Chrome/Edge):** Click the install icon in the address bar

Once installed, it appears on your home screen / desktop with a custom icon.

---

## 🗂️ Repository Structure
