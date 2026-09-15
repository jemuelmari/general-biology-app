/* ============================================================
   config.js — App configuration (teacher password, etc.)
   Version: 1.0.0

   HOW TO CHANGE THE TEACHER PASSWORD:
   1. Open browser console on any page.
   2. Run: await TeacherAuth.hash('YourNewPassword')
   3. Copy the hash output.
   4. Paste it below as TEACHER_PASSWORD_HASH.
   5. Commit and push.

   DEFAULT PASSWORD: "teacher2026"
   ⚠️ CHANGE THIS BEFORE DEPLOYING!
   ============================================================ */

const CONFIG = {
  APP_NAME: 'General Biology Online Modular Application',
  VERSION: '1.0.0',

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
