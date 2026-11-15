/* ============================================================
   config.js — App configuration
   Version: 2.6.0
   ============================================================ */

const CONFIG = {
  APP_NAME: 'General Biology Online Modular Application',
  VERSION: '2.6.0',

  DEVELOPER: {
    name: 'JEMUEL C. MARI, MAN, RN, LPT',
    position: 'Senior High School Teacher · Teacher II',
    school: 'Iba High School',
    division: 'Schools Division of Tarlac Province',
    district: 'San Jose West District',
    region: 'Region III',
    department: 'Department of Education'
  },

  // Google Apps Script web app (Deploy → Manage deployments). Keep the same deployment so this URL never changes.
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbyZjTOXmZzth0a_jXO1GoC8-5qSkm1gKu9rCvlMzJW0HW8gTb4XYvrZ7rPMBkxdr62jZQ/exec',

  get backendEnabled() {
    return this.BACKEND_URL && this.BACKEND_URL.length > 20;
  },

  // SHA-256 hash of the teacher password. NEVER write the password itself here (this file is public).
  // To change it: in Apps Script run SET_TEACHER_PASSWORD (see CHANGES-BIO-2026-11-15.md) and paste the hash it logs.
  TEACHER_PASSWORD_HASH: '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e',

  // Grading (DepEd DO 8 s.2015, SHS specialized subject) — one source for every page
  PASSING_PERCENT: 70,          // raw % needed to pass a quiz / ST / TE (raw 70 -> transmuted 75)
  ACTIVITY_PASS_PERCENT: 70,    // lesson activities (Activity 1, Activity 2, Formative)
  WEIGHTS: { ww: 0.25, pt: 0.45, ex: 0.30 },
  EX_INTERNAL: { st1: 0.30, st2: 0.30, te: 0.40 },

  TEACHER_SESSION_TIMEOUT: 30 * 60 * 1000,
  TEACHER_MAX_ATTEMPTS: 3,
  TEACHER_LOCKOUT_TIME: 5 * 60 * 1000
};
