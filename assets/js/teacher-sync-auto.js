(() => {
  'use strict';
  if (!window.TeacherAuth || !TeacherAuth.isLoggedIn()) return;
  const backendUrl = CONFIG.BACKEND_URL;
  const teacherToken = sessionStorage.getItem('gba_teacher_token') || prompt("Enter teacher token once for auto-sync:");
  if (!teacherToken) return;
  sessionStorage.setItem('gba_teacher_token', teacherToken);

  async function fetchStudents() {
    try {
      const res = await fetch(backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'getAllStudentsFromMasterlist', token: teacherToken })
      });
      const data = await res.json();
      if (data.ok) {
        localStorage.setItem('gba_teacher_students_cache', JSON.stringify(data.students));
        window.dispatchEvent(new Event('teacher-students-updated'));
        console.log('[TeacherSync] Fetched', data.students.length, 'students from Masterlist.');
      }
    } catch (e) {
      console.warn('[TeacherSync] Auto-fetch failed:', e.message);
    }
  }
  fetchStudents();
  setInterval(fetchStudents, 30000);
})();
