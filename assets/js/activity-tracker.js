/* ============================================================
   activity-tracker.js — Aggregates activity engagement data
   Version: 2.1.0
   ============================================================ */

const ActivityTracker = (() => {
  'use strict';

  const NS = 'gba_v1_';

  function getStudentActivity(lrn) {
    const user = Store.getUser(lrn);
    if (!user) return null;

    const progress = Store.getProgress(lrn);
    const badges = Store.getBadges(lrn);
    const scores = Store.getScores(lrn);

    const summary = {};

    ['biol1', 'biol2'].forEach((subject) => {
      const completedDays = progress[subject]?.completed || [];
      const subjectBadges = badges[subject] || [];

      const activitiesDone = completedDays.length * 3;
      const totalDays = 40;
      const totalActivities = totalDays * 3;

      const quizzesTaken = Object.keys(scores[subject]?.quizzes || {}).length;
      const stsTaken = Object.keys(scores[subject]?.st || {}).length;
      const ptsTaken = Object.keys(scores[subject]?.pt || {}).length;
      const teTaken = Object.keys(scores[subject]?.te || {}).length;

      const points = computeSubjectPoints(lrn, subject);

      summary[subject] = {
        completedDays: completedDays.length,
        totalDays,
        completionPct: Math.round((completedDays.length / totalDays) * 100),
        activitiesDone,
        totalActivities,
        badgesEarned: subjectBadges.length,
        points,
        quizzesTaken,
        stsTaken,
        ptsTaken,
        teTaken
      };
    });

    return {
      user,
      summary,
      rawCompleted: {
        biol1: progress.biol1?.completed || [],
        biol2: progress.biol2?.completed || []
      },
      rawBadges: {
        biol1: badges.biol1 || [],
        biol2: badges.biol2 || []
      }
    };
  }

  function computeSubjectPoints(lrn, subject) {
    let total = 0;
    const prefix = `${NS}points_${lrn}_${subject}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        try {
          const v = JSON.parse(localStorage.getItem(key)) || 0;
          total += Number(v) || 0;
        } catch (e) { /* ignore */ }
      }
    }
    return total;
  }

  /**
   * Get all students with activity data, sorted alphabetically by last name.
   */
  function getAllActivity() {
    const all = Store.getAllUsers().map((u) => getStudentActivity(u.lrn)).filter(Boolean);
    // Alphabetical default sort
    if (window.APP && APP.sortStudents) {
      return APP.sortStudents(all, 'last', 'asc');
    }
    return all.sort((a, b) =>
      (a.user.lastName || '').localeCompare(b.user.lastName || '')
    );
  }

  function getDayDetails(lrn, subject) {
    const progress = Store.getProgress(lrn);
    const days = {};
    for (let w = 1; w <= 10; w++) {
      for (let d = 1; d <= 4; d++) {
        const key = `${subject}-w${w}-d${d}`;
        days[key] = (progress[subject]?.completed || []).includes(key);
      }
    }
    return days;
  }

  return { getStudentActivity, getAllActivity, getDayDetails };
})();
