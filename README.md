# General Biology Online Modular Application

**Version:** 1.1.0
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

## 📱 Install as App

This app can be **installed** on any device (phone, tablet, laptop) for quick access:

- **Android (Chrome):** Menu → *Install app*
- **iOS (Safari):** Share → *Add to Home Screen*
- **Windows/Mac (Chrome/Edge):** Click the install icon in the address bar

Once installed, it appears on your home screen / desktop with a custom icon.

---

## 🔐 Teacher Password

The default teacher password is `teacher2026`. **Change it before deploying.**

To change the password:

1. Open `teacher-login.html` in a browser
2. Press F12 → Console
3. Run: `TeacherAuth.hash('YourNewPassword').then(h => console.log(h))`
4. Copy the output hash
5. Paste it into `config.js` → `TEACHER_PASSWORD_HASH`
6. Commit and push

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

## 📝 Versioning Rules

This project follows semantic versioning:

- **Patch** (`1.1.0` → `1.1.1`) — small bug fixes, typo corrections
- **Minor** (`1.1.0` → `1.2.0`) — new features, new pages, adjustments
- **Major** (`1.1.0` → `2.0.0`) — restructuring, breaking changes

When updating:
1. Edit `CONFIG.VERSION` in `config.js`
2. Commit and push
3. All pages automatically display the new version

---

## 📚 References

- DepEd K to 12 Senior High School STEM Specialized Subject — Biology 1 (August 2016)
- DepEd K to 12 Senior High School STEM Specialized Subject — Biology 2 (August 2016)
- DepEd Order No. 015, s. 2026
- Reece, J. B. et al. (2011). *Campbell Biology* (9th ed.). Pearson.
- Alberts, B. et al. (2007). *Molecular Biology of the Cell* (5th ed.). Garland Publishing.

---

## 📝 License

For educational use. © 2026 Jemuel C. Mari. All rights reserved.
