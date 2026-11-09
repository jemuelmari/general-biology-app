# Exam Evidence — General Biology (v1.0.0)

## Mga file (parehong folder paths sa repo)
- `teacher/evidence.html`  — bagong page
- `teacher/evidence.js`    — generator (HTML/print at Word)
- `assets/js/teacher.js`   — dinagdagan ng "📄 Exam Evidence" card sa Teacher Home

## Paano gamitin
1. Teacher Home → **📄 Exam Evidence**.
2. Piliin ang Subject, Assessment (Quiz 1–3, Summative 1–2, Term Exam), Section, at Student.
   - **"All students in the selected section"** = isang evidence bawat estudyante sa isang print/file.
3. **Preview** → **Print / Save as PDF** o **Save as Word (.docx)**.
   Ipapirma sa magulang/guardian; may lines din para sa student at teacher.

## Ano ang nasa evidence
Header ng school, pangalan/LRN/section, subject at assessment, petsa/oras, score, percent, passed/not yet,
proficiency, oras na ginamit, tab-switch warnings, performance per competency, at **bawat tanong** kasama ang
lahat ng choices, ang sagot ng estudyante, at ang tamang sagot. May **Evidence ID** (GB-XXXXXXXX) sa baba.

## Dapat malaman
- Ang makikita ay ang **pinakahuling attempt** na naka-save sa Google Sheet (kung retake, ang retake).
- Random ang pagkakasunod ng tanong at ng choices sa bawat estudyante, kaya sumusunod ang evidence sa order ng
  tanong na nakita niya at isinusulat ang sagot sa buong text (hindi letra).
- Kung score na na-encode ng teacher (paper exam/override), summary lang ang lalabas (walang item-level), may paliwanag na note.
- Data: kung naka-apply ang sync fix (`teacher-sync-auto.js`), gagamitin iyon; kung wala, kukuha ito direkta sa backend gamit
  ang teacher password; kung pumalya, gagamitin ang data sa device.
- School Year: i-edit ang `DEFAULT_SCHOOL_YEAR` sa itaas ng `teacher/evidence.js`. Ang school/teacher info ay galing sa `CONFIG.DEVELOPER` ng config.js.
- Nangangailangan ng internet (docx library mula sa jsDelivr, question bank, at Google Sheet).
