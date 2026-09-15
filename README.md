# General Biology Online Modular Application

**Version:** 1.0.0
**Subject:** General Biology 1 & General Biology 2
**Grade Level:** Grade 12 — GAS
**Term:** Term 2 (3-Term School Calendar)
**School Year:** 2026–2027

---

## 📖 Overview

A web-based modular learning application for Senior High School General Biology 1 and General Biology 2, aligned with the DepEd K to 12 Curriculum Guide (August 2016) and DepEd Order No. 015, s. 2026.

The application contains **three platforms**:

| Platform | File | Purpose |
|---|---|---|
| **Student Application** | `index.html` | Lessons, gamified activities, assessments, remediation |
| **Teacher Application** | `instructor.html` | Item analysis, intervention, sync center |
| **Gradebook Application** | `classrecord.html` | Class record, transmutation, reports |

---

## 🏗️ Architecture

- **Frontend:** Plain HTML / CSS / JavaScript (no build step)
- **Hosting:** GitHub Pages
- **Data Persistence:** localStorage + Google Sheets sync
- **Sync Methods:** Sync Code (primary) + JSON File (fallback)
- **Security:** HMAC-SHA256 signature for tamper detection

---

## 📊 Assessment Structure (Per Subject, Per Term)

| Component | Count | Items | Coverage |
|---|---|---|---|
| Quizzes | 3 | 20 each | Weeks 1–10 |
| Summative Test 1 | 1 | 30 | Weeks 1–4 |
| Summative Test 2 | 1 | 30 | Weeks 5–8 |
| Performance Tasks | 3 | — | PT1 (W1–4), PT2 (W5–8), PT3 (W9–10) |
| Term Exam | 1 | 60 | Weeks 9–10 |

### Weighting (DO 015, s. 2026)

| Subject | WW | PT | EX |
|---|---|---|---|
| General Biology 1 & 2 | 25% | 50% | 25% |
| General Science | 20% | 50% | 30% |

### EX Internal Breakdown

| Assessment | Weight of EX |
|---|---|
| Summative Test 1 | 30% |
| Summative Test 2 | 30% |
| Term Exam | 40% |

---

## 🔄 Transmutation (SY 2026–2027)

**Adjusted Transmutation Table applies.** Raw 70 → transmuted 75.

SY 2027–2028 onward: No transmutation for Grades 4–12.

---

## 📁 Folder Structure
