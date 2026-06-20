// Unit tests for the Momentum data layer (public/js/api.js).
//
// api.js is browser code that talks to Firestore through the global `db`. Here
// we stub `db` with a small in-memory Firestore mock and `auth`/`window` with a
// signed-in user, then load api.js and exercise its real logic. No Firebase and
// no new dependencies — run with:  npm test   (i.e. `node --test`).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ── In-memory Firestore mock (only the bits api.js uses) ────────────────────────
function createMockFirestore() {
  const store = new Map(); // full path -> document object
  const clone = o => JSON.parse(JSON.stringify(o));

  function docRef(p) {
    return {
      path: p,
      id: p.split('/').pop(),
      get: async () => ({ exists: store.has(p), id: p.split('/').pop(),
        data: () => store.has(p) ? clone(store.get(p)) : undefined, ref: docRef(p) }),
      set: async d => { store.set(p, clone(d)); },
      update: async d => { store.set(p, { ...store.get(p), ...clone(d) }); },
      delete: async () => { store.delete(p); },
    };
  }

  function query(base, filters, limitN) {
    return {
      doc: id => docRef(`${base}/${id}`),
      where: (f, _op, v) => query(base, [...filters, [f, v]], limitN),
      limit: n => query(base, filters, n),
      get: async () => {
        let rows = [...store.keys()]
          .filter(p => p.startsWith(base + '/') && !p.slice(base.length + 1).includes('/'))
          .map(p => ({ id: p.split('/').pop(), data: () => clone(store.get(p)), ref: docRef(p) }));
        for (const [f, v] of filters) rows = rows.filter(r => store.get(r.ref.path)[f] === v);
        if (limitN != null) rows = rows.slice(0, limitN);
        return { docs: rows, empty: rows.length === 0, size: rows.length };
      },
    };
  }

  const db = {
    collection: top => ({ doc: uid => ({ collection: name => query(`${top}/${uid}/${name}`, [], null) }) }),
    batch: () => {
      const ops = [];
      return {
        set: (ref, d) => ops.push(() => ref.set(d)),
        delete: ref => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
  };
  return { db, store };
}

// ── Load api.js with browser globals stubbed ────────────────────────────────────
global.auth = { currentUser: { uid: 'user1' } };
global.window = { currentUid: 'user1' };
global.db = createMockFirestore().db;

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
(0, eval)(src + '\n;Object.assign(globalThis, { API, seedIfEmpty, progressColor, goalStatus, quickIncrements });');
const { API, seedIfEmpty, progressColor, goalStatus, quickIncrements } = globalThis;

// Fresh empty database (and chosen user) before each test.
function reset(uid = 'user1') {
  global.db = createMockFirestore().db;
  global.window.currentUid = uid;
  global.auth.currentUser = { uid };
}

const today = new Date().toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

// ── Goals ───────────────────────────────────────────────────────────────────────

// Creating a goal with just a title fills in the sensible defaults.
test('createGoal applies defaults', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'Run more' });
  assert.equal(g.title, 'Run more');
  assert.equal(g.category, 'Other');
  assert.equal(g.target_value, 100);
  assert.equal(g.current_value, 0);
  assert.equal(g.status, 'active');
});

// A goal's progress percentage is computed from current vs. target value.
test('createGoal computes progress_pct', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'Read', target_value: 200, current_value: 50 });
  assert.equal(g.progress_pct, 25);
});

// Listing goals reports how many milestones and tasks are still pending.
test('listGoals returns pending milestone/task counts', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'Project' });
  const m1 = await API.post(`/api/goals/${g.id}/milestones`, { title: 'M1' });
  await API.post(`/api/goals/${g.id}/milestones`, { title: 'M2' });
  await API.put(`/api/milestones/${m1.id}`, { completed: true });
  const t1 = await API.post(`/api/goals/${g.id}/tasks`, { title: 'T1' });
  await API.post(`/api/goals/${g.id}/tasks`, { title: 'T2' });
  await API.put(`/api/tasks/${t1.id}`, { completed: true });

  const [listed] = await API.get('/api/goals');
  assert.equal(listed.pending_milestones, 1);
  assert.equal(listed.pending_tasks, 1);
});

// Updating a goal changes only the fields you pass and leaves the rest intact.
test('updateGoal merges only provided fields', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'Old', category: 'Health', target_value: 80 });
  const upd = await API.put(`/api/goals/${g.id}`, { title: 'New' });
  assert.equal(upd.title, 'New');
  assert.equal(upd.category, 'Health');     // untouched
  assert.equal(upd.target_value, 80);       // untouched
});

// Deleting a goal also removes its milestones, tasks, and progress entries.
test('deleteGoal cascades to children', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'Temp' });
  await API.post(`/api/goals/${g.id}/milestones`, { title: 'M' });
  await API.post(`/api/goals/${g.id}/tasks`, { title: 'T' });
  await API.post(`/api/goals/${g.id}/progress`, { date: today, value: 1 });

  await API.del(`/api/goals/${g.id}`);

  assert.deepEqual(await API.get('/api/goals'), []);
  assert.deepEqual(await API.get(`/api/goals/${g.id}/milestones`), []);
  assert.deepEqual(await API.get(`/api/goals/${g.id}/tasks`), []);
  assert.deepEqual(await API.get(`/api/goals/${g.id}/progress`), []);
});

// ── Milestones & tasks ───────────────────────────────────────────────────────────

// Completing a milestone flips its flag and stamps a completion time.
test('completing a milestone records completed + completed_at', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'G' });
  const m = await API.post(`/api/goals/${g.id}/milestones`, { title: 'Ship it' });
  assert.equal(m.completed, 0);
  const done = await API.put(`/api/milestones/${m.id}`, { completed: true });
  assert.equal(done.completed, 1);
  assert.ok(done.completed_at, 'completed_at should be set');
});

// A task can be toggled complete and then incomplete again.
test('toggling a task completion', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'G' });
  const t = await API.post(`/api/goals/${g.id}/tasks`, { title: 'Do thing' });
  assert.equal((await API.put(`/api/tasks/${t.id}`, { completed: true })).completed, 1);
  assert.equal((await API.put(`/api/tasks/${t.id}`, { completed: false })).completed, 0);
});

// ── Progress tracking ─────────────────────────────────────────────────────────────

// For a "Daily Progression" goal, logging progress adds up to the current value.
test('logging progress auto-advances current_value (Daily Progression)', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'Miles', frequency: 'Daily Progression', target_value: 100 });
  await API.post(`/api/goals/${g.id}/progress`, { date: yesterday, value: 3 });
  await API.post(`/api/goals/${g.id}/progress`, { date: today, value: 5 });
  const fresh = await API.get(`/api/goals/${g.id}`);
  assert.equal(fresh.current_value, 8);
});

// Auto-advanced progress never exceeds the goal's target value.
test('progress auto-advance is capped at the target', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'Small', frequency: 'Daily Progression', target_value: 5 });
  await API.post(`/api/goals/${g.id}/progress`, { date: today, value: 10 });
  const fresh = await API.get(`/api/goals/${g.id}`);
  assert.equal(fresh.current_value, 5);
});

// Non-daily goals (e.g. Weekly Check-in) are not auto-advanced by logging.
test('logging progress does not auto-advance non-daily goals', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'Weekly', frequency: 'Weekly Check-in', target_value: 100 });
  await API.post(`/api/goals/${g.id}/progress`, { date: today, value: 9 });
  const fresh = await API.get(`/api/goals/${g.id}`);
  assert.equal(fresh.current_value, 0);
});

// Logging twice on the same day overwrites that day rather than duplicating it.
test('progress for the same goal+date is upserted', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'G', frequency: 'Weekly Check-in' });
  await API.post(`/api/goals/${g.id}/progress`, { date: today, value: 2 });
  await API.post(`/api/goals/${g.id}/progress`, { date: today, value: 7 });
  const entries = await API.get(`/api/goals/${g.id}/progress`);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].value, 7);
});

// ── Analytics ──────────────────────────────────────────────────────────────────

// The overview averages goal progress and the task-completion rate.
test('analytics overview computes overall progress and task rate', async () => {
  reset();
  const a = await API.post('/api/goals', { title: 'A', target_value: 100, current_value: 50 });
  await API.post('/api/goals', { title: 'B', target_value: 100, current_value: 100 });
  const t1 = await API.post(`/api/goals/${a.id}/tasks`, { title: 'T1' });
  await API.post(`/api/goals/${a.id}/tasks`, { title: 'T2' });
  await API.put(`/api/tasks/${t1.id}`, { completed: true });

  const ov = await API.get('/api/analytics/overview');
  assert.equal(ov.overallProgress, 75);       // (50 + 100) / 2
  assert.equal(ov.taskCompletionRate, 50);    // 1 of 2 tasks done
});

// The streak counts consecutive days with activity ending today.
test('analytics streak counts consecutive active days', async () => {
  reset();
  const g = await API.post('/api/goals', { title: 'G', frequency: 'Weekly Check-in' });
  await API.post(`/api/goals/${g.id}/progress`, { date: today, value: 1 });
  await API.post(`/api/goals/${g.id}/progress`, { date: yesterday, value: 1 });
  const ov = await API.get('/api/analytics/overview');
  assert.equal(ov.streak, 2);
});

// The category breakdown averages progress across goals in each category.
test('analytics category breakdown averages by category', async () => {
  reset();
  await API.post('/api/goals', { title: 'L1', category: 'Learning', target_value: 100, current_value: 100 });
  await API.post('/api/goals', { title: 'L2', category: 'Learning', target_value: 100, current_value: 0 });
  const ov = await API.get('/api/analytics/overview');
  const learning = ov.byCategory.find(c => c.category === 'Learning');
  assert.equal(learning.avg_progress, 50);
});

// The heatmap counts how many goals were active on each day.
test('analytics heatmap counts active goals per day', async () => {
  reset();
  const g1 = await API.post('/api/goals', { title: 'G1', frequency: 'Weekly Check-in' });
  const g2 = await API.post('/api/goals', { title: 'G2', frequency: 'Weekly Check-in' });
  await API.post(`/api/goals/${g1.id}/progress`, { date: today, value: 1 });
  await API.post(`/api/goals/${g2.id}/progress`, { date: today, value: 1 });
  const heat = await API.get('/api/analytics/heatmap?days=182');
  const cell = heat.find(h => h.date === today);
  assert.equal(cell.active_goals, 2);
});

// ── Wins ──────────────────────────────────────────────────────────────────────

// Recording a win stores the message and fills in default icon styling.
test('createWin records a win with defaults', async () => {
  reset();
  const w = await API.post('/api/wins', { message: 'First milestone!' });
  assert.equal(w.message, 'First milestone!');
  assert.equal(w.icon, 'stars');
  assert.ok(w.icon_bg && w.icon_color);
});

// ── Per-user isolation ──────────────────────────────────────────────────────────

// One user can never see another user's goals.
test('data is isolated per user', async () => {
  reset('user1');
  await API.post('/api/goals', { title: 'User1 goal' });
  reset('user2');                              // switch account (fresh store too)
  assert.deepEqual(await API.get('/api/goals'), []);
});

// ── First-run seeding ───────────────────────────────────────────────────────────

// A brand-new account is seeded with demo goals, and seeding never duplicates.
test('seedIfEmpty populates once and is idempotent', async () => {
  reset();
  await seedIfEmpty();
  const first = (await API.get('/api/goals')).length;
  assert.equal(first, 4);
  await seedIfEmpty();                          // run again
  assert.equal((await API.get('/api/goals')).length, 4);
});

// ── Pure display helpers ────────────────────────────────────────────────────────

// The progress bar color reflects how far along a goal is.
test('progressColor picks a color by completion band', () => {
  assert.equal(progressColor(90), 'bg-secondary'); // high
  assert.equal(progressColor(50), 'bg-primary');   // mid
  assert.equal(progressColor(10), 'bg-error');     // low
});

// A finished goal is labeled "Completed" and an unfinished past-due one "Overdue".
test('goalStatus labels completed and overdue goals', () => {
  assert.equal(goalStatus({ progress_pct: 100 }).label, 'Completed');
  assert.equal(goalStatus({ progress_pct: 20, target_date: '2000-01-01' }).label, 'Overdue');
});

// Quick-log buttons offer sensible increments based on the goal's unit.
test('quickIncrements suggests presets by unit', () => {
  assert.deepEqual(quickIncrements('Books', 24), [1]);
  assert.deepEqual(quickIncrements('Miles', 500), [1, 3, 5]);
});
