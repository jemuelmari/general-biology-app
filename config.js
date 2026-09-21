/* ============================================================
   config.js — App configuration
   Version: 2.3.8
   ============================================================ */

const CONFIG = {
  APP_NAME: 'General Biology Online Modular Application',
  VERSION: '2.3.8',

  DEVELOPER: {
    name: 'JEMUEL C. MARI, MAN, RN, LPT',
    position: 'Senior High School Teacher · Teacher II',
    school: 'Iba High School',
    division: 'Schools Division of Tarlac Province',
    district: 'San Jose West District',
    region: 'Region III',
    department: 'Department of Education'
  },

  // ⚠️ MUST be the URL of the Apps Script project you can actually edit.
  // Verified: this URL returns JSON in Incognito (public access, personal Gmail).
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbyi2fj-Jnmlk7Pp4qhtfuE_lz0zSewtLfRPiAZnPO5A-uA5ICvicE_DPUry_lax69ubuQ/exec',

  get backendEnabled() {
    return this.BACKEND_URL && this.BACKEND_URL.length > 20;
  },

  // SHA-256 hash of "teacher2026"
  TEACHER_PASSWORD_HASH: '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e',

  TEACHER_SESSION_TIMEOUT: 30 * 60 * 1000,
  TEACHER_MAX_ATTEMPTS: 3,
  TEACHER_LOCKOUT_TIME: 5 * 60 * 1000
};
