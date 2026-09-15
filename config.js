/* ============================================================
   config.js — App configuration (teacher password, etc.)
   Version: 1.0.1
   ============================================================ */

const CONFIG = {
  APP_NAME: 'General Biology Online Modular Application',
  VERSION: '1.0.1',

  // SHA-256 hash of the teacher password.
  // Default password: "teacher2026"
  TEACHER_PASSWORD_HASH: 'e2f8fa8d3a8a8f8b4c2c4c6e1a0f9e8d7c6b5a4938271605142332415069789a',

  // Session duration (ms). 30 minutes.
  TEACHER_SESSION_TIMEOUT: 30 * 60 * 1000,

  // Max wrong attempts before lockout
  TEACHER_MAX_ATTEMPTS: 3,

  // Lockout duration (ms). 5 minutes.
  TEACHER_LOCKOUT_TIME: 5 * 60 * 1000
};
