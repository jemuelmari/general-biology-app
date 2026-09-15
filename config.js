/* ============================================================
   config.js — App configuration (teacher password, dev info)
   Version: 1.1.0
   ============================================================ */

const CONFIG = {
  APP_NAME: 'General Biology Online Modular Application',
  VERSION: '1.1.0',

  // ---------- Developer Info ----------
  DEVELOPER: {
    name: 'JEMUEL C. MARI, MAN, RN, LPT',
    position: 'Senior High School Teacher · Teacher II',
    school: 'Iba High School',
    division: 'Schools Division of Tarlac Province',
    district: 'San Jose West District',
    region: 'Region III',
    department: 'Department of Education'
  },

  // ---------- Teacher Password ----------
  // SHA-256 hash of the teacher password.
  // Default password: "teacher2026"
  TEACHER_PASSWORD_HASH: '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e',

  // Session duration (ms). 30 minutes.
  TEACHER_SESSION_TIMEOUT: 30 * 60 * 1000,

  // Max wrong attempts before lockout
  TEACHER_MAX_ATTEMPTS: 3,

  // Lockout duration (ms). 5 minutes.
  TEACHER_LOCKOUT_TIME: 5 * 60 * 1000
};
