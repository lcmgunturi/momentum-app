// Momentum API Client — Firestore-backed.
//
// This preserves the original REST-style surface (API.get/post/put/del with
// the same URL patterns) so the page code is unchanged; under the hood every
// call reads/writes the signed-in user's Firestore subcollections at
// users/{uid}/{goals|milestones|tasks|progress|wins}. Requires firebase.js
// (which exposes the global `db`, `auth`, and `currentUid`) to load first.

// ── Firestore helpers ──────────────────────────────────────────────────────────
function _uid() {
  const uid = window.currentUid || (window.auth && auth.currentUser && auth.currentUser.uid);
  if (!uid) throw new Error('Not signed in');
  return uid;
}
function _col(name) {
  return db.collection('users').doc(_uid()).collection(name);
}
// Inline onclick handlers render IDs unquoted (e.g. toggleTask(${id})), so IDs
// must be numeric. We use a time-based monotonic generator and store the number
// both as the document id (stringified) and as an `id` field on the document.
let _idSeq = 0;
function genId() { return Date.now() * 1000 + (_idSeq++ % 1000); }
function nowIso() { return new Date().toISOString(); }
function todayStr() { return nowIso().split('T')[0]; }
function _rows(snap) { return snap.docs.map(d => d.data()); }
function _byCreated(a, b) { return (a.created_at || '').localeCompare(b.created_at || ''); }
function _withProgress(g) {
  g.progress_pct = g.target_value > 0 ? Math.round((g.current_value / g.target_value) * 100) : 0;
  return g;
}

// ── Goals ──────────────────────────────────────────────────────────────────────
async function _listGoals() {
  const [goalsSnap, msSnap, taskSnap] = await Promise.all([
    _col('goals').get(), _col('milestones').get(), _col('tasks').get()
  ]);
  const ms = _rows(msSnap), tasks = _rows(taskSnap);
  return _rows(goalsSnap)
    .map(g => {
      g.pending_milestones = ms.filter(m => m.goal_id === g.id && !m.completed).length;
      g.pending_tasks = tasks.filter(t => t.goal_id === g.id && !t.completed).length;
      return _withProgress(g);
    })
    .sort((a, b) => -_byCreated(a, b)); // created_at DESC
}

async function _getGoal(id) {
  const snap = await _col('goals').doc(String(id)).get();
  if (!snap.exists) throw new Error('Goal not found');
  const g = _withProgress(snap.data());
  const [ms, tasks, prog] = await Promise.all([
    _col('milestones').where('goal_id', '==', id).get(),
    _col('tasks').where('goal_id', '==', id).get(),
    _col('progress').where('goal_id', '==', id).get()
  ]);
  g.milestones = _rows(ms).sort(_byCreated);
  g.tasks = _rows(tasks).sort((a, b) => (a.task_category || '').localeCompare(b.task_category || '') || _byCreated(a, b));
  g.recent_progress = _rows(prog).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  return g;
}

async function _createGoal(d) {
  if (!d.title) throw new Error('Title is required');
  const id = genId();
  const g = {
    id, title: d.title, description: d.description || '', category: d.category || 'Other',
    target_value: d.target_value || 100, current_value: d.current_value || 0, unit: d.unit || '%',
    start_date: d.start_date || todayStr(), target_date: d.target_date || null,
    motivation: d.motivation || '', frequency: d.frequency || 'Daily Progression',
    status: 'active', icon: d.icon || 'flag', created_at: nowIso()
  };
  await _col('goals').doc(String(id)).set(g);
  return _withProgress({ ...g });
}

async function _updateGoal(id, d) {
  const ref = _col('goals').doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Goal not found');
  const cur = snap.data();
  const upd = {};
  ['title', 'description', 'category', 'target_value', 'current_value', 'unit', 'start_date',
   'target_date', 'motivation', 'frequency', 'status', 'icon'].forEach(f => { upd[f] = d[f] ?? cur[f]; });
  await ref.update(upd);
  return _withProgress({ ...cur, ...upd });
}

async function _deleteGoal(id) {
  const batch = db.batch();
  batch.delete(_col('goals').doc(String(id)));
  for (const name of ['milestones', 'tasks', 'progress']) {
    const s = await _col(name).where('goal_id', '==', id).get();
    s.docs.forEach(doc => batch.delete(doc.ref));
  }
  await batch.commit();
  return { success: true };
}

// ── Milestones ──────────────────────────────────────────────────────────────────
async function _listMilestones(goalId) {
  const s = await _col('milestones').where('goal_id', '==', goalId).get();
  return _rows(s).sort(_byCreated);
}
async function _createMilestone(goalId, d) {
  if (!d.title) throw new Error('Title is required');
  const id = genId();
  const m = { id, goal_id: goalId, title: d.title, target_date: d.target_date || null,
    completed: 0, completed_at: null, created_at: nowIso() };
  await _col('milestones').doc(String(id)).set(m);
  return m;
}
async function _updateMilestone(id, d) {
  const ref = _col('milestones').doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Milestone not found');
  const m = snap.data();
  const comp = d.completed !== undefined ? (d.completed ? 1 : 0) : m.completed;
  const completed_at = d.completed && !m.completed ? nowIso() : (d.completed ? m.completed_at : null);
  const upd = { title: d.title ?? m.title, target_date: d.target_date ?? m.target_date, completed: comp, completed_at };
  await ref.update(upd);
  return { ...m, ...upd };
}
async function _deleteMilestone(id) { await _col('milestones').doc(String(id)).delete(); return { success: true }; }

// ── Tasks ───────────────────────────────────────────────────────────────────────
async function _listTasks(goalId) {
  const s = await _col('tasks').where('goal_id', '==', goalId).get();
  return _rows(s).sort((a, b) => (a.task_category || '').localeCompare(b.task_category || '') || _byCreated(a, b));
}
async function _createTask(goalId, d) {
  if (!d.title) throw new Error('Title is required');
  const id = genId();
  const t = { id, goal_id: goalId, title: d.title, completed: 0,
    priority: d.priority || 'normal', task_category: d.task_category || 'General', created_at: nowIso() };
  await _col('tasks').doc(String(id)).set(t);
  return t;
}
async function _updateTask(id, d) {
  const ref = _col('tasks').doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Task not found');
  const t = snap.data();
  const upd = {
    title: d.title ?? t.title,
    completed: d.completed !== undefined ? (d.completed ? 1 : 0) : t.completed,
    priority: d.priority ?? t.priority,
    task_category: d.task_category ?? t.task_category
  };
  await ref.update(upd);
  return { ...t, ...upd };
}
async function _deleteTask(id) { await _col('tasks').doc(String(id)).delete(); return { success: true }; }

// ── Progress ────────────────────────────────────────────────────────────────────
async function _listProgress(goalId, days) {
  const s = await _col('progress').where('goal_id', '==', goalId).get();
  return _rows(s).sort((a, b) => b.date.localeCompare(a.date)).slice(0, days || 30);
}
async function _logProgress(goalId, d) {
  const date = d.date || todayStr();
  const docId = `${goalId}_${date}`; // unique per (goal, date) — mirrors INSERT OR REPLACE
  await _col('progress').doc(docId).set({ id: docId, goal_id: goalId, date, value: d.value || 0, notes: d.notes || '', created_at: nowIso() });

  const gref = _col('goals').doc(String(goalId));
  const gsnap = await gref.get();
  if (gsnap.exists) {
    const goal = gsnap.data();
    if (goal.frequency === 'Daily Progression' && (d.value || 0) > 0) {
      const ps = await _col('progress').where('goal_id', '==', goalId).get();
      const total = _rows(ps).reduce((s, p) => s + (p.value || 0), 0);
      await gref.update({ current_value: Math.min(goal.target_value || 100, total) });
    }
  }
  return { success: true, date };
}

// ── Wins ────────────────────────────────────────────────────────────────────────
async function _createWin(d) {
  if (!d.message) throw new Error('Message required');
  const id = genId();
  const w = { id, goal_id: d.goal_id || null, message: d.message,
    icon: d.icon || 'stars', icon_bg: d.icon_bg || 'bg-secondary-container',
    icon_color: d.icon_color || 'text-on-secondary-container', created_at: nowIso() };
  await _col('wins').doc(String(id)).set(w);
  return w;
}

// ── Analytics ───────────────────────────────────────────────────────────────────
async function _overview() {
  const [goalsSnap, tasksSnap, winsSnap, progSnap] = await Promise.all([
    _col('goals').get(), _col('tasks').get(), _col('wins').get(), _col('progress').get()
  ]);
  const allGoals = _rows(goalsSnap).map(_withProgress);
  const goals = allGoals.filter(g => g.status === 'active');
  const tasks = _rows(tasksSnap);
  const prog = _rows(progSnap);

  const activeDates = new Set(prog.filter(p => (p.value || 0) > 0).map(p => p.date));
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 365; i++) {
    const ds = d.toISOString().split('T')[0];
    if (activeDates.has(ds)) { streak++; d.setDate(d.getDate() - 1); } else break;
  }

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.completed).length;
  const wins = _rows(winsSnap).sort((a, b) => -_byCreated(a, b)).slice(0, 5)
    .map(w => ({ ...w, goal_title: (allGoals.find(g => g.id === w.goal_id) || {}).title || null }));

  const byCat = {};
  allGoals.forEach(g => {
    (byCat[g.category] = byCat[g.category] || []).push(g.target_value > 0 ? (g.current_value / g.target_value) * 100 : 0);
  });
  const byCategory = Object.keys(byCat).map(category => ({
    category, avg_progress: Math.round(byCat[category].reduce((s, v) => s + v, 0) / byCat[category].length)
  }));

  return {
    goals, streak, totalGoals: goals.length,
    onTrack: goals.filter(g => g.progress_pct >= 50).length,
    lagging: goals.filter(g => g.progress_pct < 50).length,
    overallProgress: goals.length ? Math.round(goals.reduce((s, g) => s + g.progress_pct, 0) / goals.length) : 0,
    taskCompletionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    wins, byCategory
  };
}

async function _heatmap(days) {
  const prog = _rows(await _col('progress').get());
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - (days || 182));
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const map = {};
  prog.forEach(p => { if (p.date >= cutoffStr && (p.value || 0) > 0) map[p.date] = (map[p.date] || 0) + 1; });
  return Object.keys(map).sort().map(date => ({ date, active_goals: map[date] }));
}

// ── URL router ──────────────────────────────────────────────────────────────────
// Maps the legacy REST paths the pages still call onto the Firestore helpers.
function _route(method, url) {
  const [path, qs] = url.split('?');
  const p = path.split('/').filter(Boolean); // e.g. ['api','goals','5','tasks']
  const query = new URLSearchParams(qs || '');
  const days = parseInt(query.get('days'), 10) || undefined;
  const id = p[2] !== undefined ? Number(p[2]) : undefined;

  if (p[1] === 'analytics') {
    if (p[2] === 'overview') return _overview();
    if (p[2] === 'heatmap') return _heatmap(days);
  }
  if (p[1] === 'wins' && method === 'POST') return _createWin(_route._body);
  if (p[1] === 'milestones') {
    if (method === 'PUT') return _updateMilestone(id, _route._body);
    if (method === 'DELETE') return _deleteMilestone(id);
  }
  if (p[1] === 'tasks') {
    if (method === 'PUT') return _updateTask(id, _route._body);
    if (method === 'DELETE') return _deleteTask(id);
  }
  if (p[1] === 'goals') {
    const sub = p[3];
    if (sub === undefined) {
      if (method === 'GET') return id === undefined ? _listGoals() : _getGoal(id);
      if (method === 'POST') return _createGoal(_route._body);
      if (method === 'PUT') return _updateGoal(id, _route._body);
      if (method === 'DELETE') return _deleteGoal(id);
    }
    if (sub === 'milestones') return method === 'POST' ? _createMilestone(id, _route._body) : _listMilestones(id);
    if (sub === 'tasks') return method === 'POST' ? _createTask(id, _route._body) : _listTasks(id);
    if (sub === 'progress') return method === 'POST' ? _logProgress(id, _route._body) : _listProgress(id, days);
  }
  return Promise.reject(new Error(`No route: ${method} ${url}`));
}

const API = {
  get(url) { return _route('GET', url); },
  post(url, data) { _route._body = data; return _route('POST', url); },
  put(url, data) { _route._body = data; return _route('PUT', url); },
  del(url) { return _route('DELETE', url); }
};

// Seeds a fresh account with the original demo data so the app isn't empty on
// first sign-in. No-op if the user already has goals. Called from firebase.js.
async function seedIfEmpty() {
  const existing = await _col('goals').limit(1).get();
  if (!existing.empty) return;

  const batch = db.batch();
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 120);
  const sd = start.toISOString().split('T')[0];
  const day = ms => new Date(ms).toISOString().split('T')[0];
  const future = months => { const t = new Date(now); t.setMonth(t.getMonth() + months); return t.toISOString().split('T')[0]; };

  const addGoal = o => { const id = genId(); batch.set(_col('goals').doc(String(id)), { id, status: 'active', current_value: 0, created_at: nowIso(), ...o }); return id; };
  const addMs = (goal_id, title, target_date, completed, completed_at) => { const id = genId(); batch.set(_col('milestones').doc(String(id)), { id, goal_id, title, target_date: target_date || null, completed: completed ? 1 : 0, completed_at: completed_at || null, created_at: nowIso() }); };
  const addTask = (goal_id, title, completed, priority, task_category) => { const id = genId(); batch.set(_col('tasks').doc(String(id)), { id, goal_id, title, completed: completed ? 1 : 0, priority, task_category, created_at: nowIso() }); };
  const addProg = (goal_id, date, value) => { batch.set(_col('progress').doc(`${goal_id}_${date}`), { id: `${goal_id}_${date}`, goal_id, date, value, notes: '', created_at: nowIso() }); };
  const addWin = (goal_id, message, icon, icon_bg, icon_color) => { const id = genId(); batch.set(_col('wins').doc(String(id)), { id, goal_id: goal_id || null, message, icon, icon_bg, icon_color, created_at: nowIso() }); };

  const g1 = addGoal({ title: 'Read 24 Books', description: 'Annual Self-Improvement Goal — read 24 books this year', category: 'Learning', target_value: 24, current_value: 18, unit: 'Books', start_date: sd, target_date: future(2), motivation: 'Reading expands perspective and fuels creativity. Each book is a new world.', frequency: 'Daily Progression', icon: 'menu_book' });
  const g2 = addGoal({ title: 'Marathon Training', description: 'Sub 4-hour Marathon preparation', category: 'Health', target_value: 500, current_value: 320, unit: 'Miles', start_date: sd, target_date: future(3), motivation: 'Cross the finish line feeling strong. Prove to myself that discipline creates capability.', frequency: 'Daily Progression', icon: 'fitness_center' });
  const g3 = addGoal({ title: 'Emergency Fund', description: 'Financial Safety Net — $10,000 goal', category: 'Finance', target_value: 10000, current_value: 8200, unit: 'USD', start_date: sd, target_date: future(1), motivation: 'Financial security gives mental freedom. This fund is my peace of mind.', frequency: 'Weekly Check-in', icon: 'payments' });
  const g4 = addGoal({ title: 'Mastering Italian', description: 'Achieving B2 proficiency to connect with family roots', category: 'Learning', target_value: 100, current_value: 68, unit: '%', start_date: sd, target_date: future(4), motivation: 'Imagine ordering an espresso in a quiet Roman piazza, speaking fluently with the locals. Every verb conjugation is a step closer to that dream.', frequency: 'Daily Progression', icon: 'translate' });

  addMs(g1, 'Read first 6 books', null, 1, day(now - 90 * 86400000));
  addMs(g1, 'Reach 12 books halfway', null, 1, day(now - 45 * 86400000));
  addMs(g1, 'Finish 18 books', null, 1, day(now - 5 * 86400000));
  addMs(g1, 'Complete 24 books', future(2), 0, null);
  addMs(g2, '100 miles base training', null, 1, day(now - 80 * 86400000));
  addMs(g2, '20-mile long run', day(now.getTime() + 86400000), 0, null);
  addMs(g2, 'Race day', future(3), 0, null);
  addMs(g4, 'Basics Mastery', null, 1, day(now - 90 * 86400000));
  addMs(g4, 'A1 Certification', null, 1, day(now - 50 * 86400000));
  addMs(g4, 'Conversation Skills', null, 0, null);
  addMs(g4, 'Watch Film Without Subtitles', null, 0, null);
  addMs(g4, 'B2 Exam', future(4), 0, null);

  addTask(g1, 'Finish current book', 0, 'normal', 'Reading');
  addTask(g1, 'Write book summary notes', 0, 'high', 'Reading');
  addTask(g1, 'Pick next book from reading list', 1, 'normal', 'Planning');
  addTask(g4, 'Master Avere and Essere present tense', 1, 'normal', 'Vocabulary & Grammar');
  addTask(g4, 'Learn top 100 most common Italian adjectives', 1, 'normal', 'Vocabulary & Grammar');
  addTask(g4, 'Practice irregular past participles', 0, 'high', 'Vocabulary & Grammar');
  addTask(g4, '30-min conversation with tutor', 0, 'normal', 'Speaking & Listening');
  addTask(g4, 'Listen to Coffee Break Italian Podcast', 0, 'normal', 'Speaking & Listening');
  addTask(g2, 'Morning run - 5 miles', 1, 'normal', 'Training');
  addTask(g2, 'Long run - 20 miles this weekend', 0, 'high', 'Training');
  addTask(g2, 'Stretching & recovery session', 0, 'normal', 'Recovery');
  addTask(g3, 'Auto-transfer $400 to savings', 1, 'normal', 'Savings');
  addTask(g3, 'Review monthly spending report', 0, 'normal', 'Review');

  for (let i = 29; i >= 0; i--) {
    const dt = new Date(now); dt.setDate(dt.getDate() - i);
    if (dt.getDay() === 0) continue;
    const ds = dt.toISOString().split('T')[0];
    addProg(g1, ds, Math.random() > 0.3 ? 1 : 0);
    addProg(g2, ds, Math.random() > 0.2 ? Math.round(3 + Math.random() * 8) : 0);
    addProg(g3, ds, Math.random() > 0.6 ? Math.round(50 + Math.random() * 200) : 0);
    addProg(g4, ds, Math.random() > 0.25 ? parseFloat((1 + Math.random() * 2).toFixed(1)) : 0);
  }

  addWin(g1, "Unlocked 'Early Bird' achievement", 'stars', 'bg-secondary-container', 'text-on-secondary-container');
  addWin(g3, 'Reached 80% on Finance goal', 'trending_up', 'bg-primary-container', 'text-on-primary-container');
  addWin(null, 'Completed 10-day streak', 'workspace_premium', 'bg-tertiary-fixed', 'text-on-tertiary-fixed');

  await batch.commit();
}

const categoryIcons = {
  Health: 'fitness_center', Tech: 'code', Finance: 'payments',
  Creative: 'palette', Learning: 'menu_book', Other: 'flag'
};

// Left-border accent class per category (replaces full card coloring)
const categoryAccent = {
  Health:   'border-l-[4px] border-l-[#006a61]',
  Tech:     'border-l-[4px] border-l-[#1f108e]',
  Finance:  'border-l-[4px] border-l-[#3d4947]',
  Creative: 'border-l-[4px] border-l-[#544fc0]',
  Learning: 'border-l-[4px] border-l-[#006a61]',
  Other:    'border-l-[4px] border-l-[#777584]',
};

const categoryColors = {
  Health:   { bg: 'bg-secondary-container',   text: 'text-on-secondary-container' },
  Tech:     { bg: 'bg-primary-fixed',          text: 'text-on-primary-fixed-variant' },
  Finance:  { bg: 'bg-tertiary-fixed',         text: 'text-on-tertiary-fixed' },
  Creative: { bg: 'bg-primary-fixed',          text: 'text-on-primary-fixed-variant' },
  Learning: { bg: 'bg-secondary-container',   text: 'text-on-secondary-container' },
  Other:    { bg: 'bg-surface-container-high', text: 'text-on-surface-variant' },
};

function progressColor(pct) {
  if (pct >= 80) return 'bg-secondary';
  if (pct >= 40) return 'bg-primary';
  return 'bg-error';
}

// Returns { label, classes } status badge for a goal
function goalStatus(goal) {
  const pct = goal.progress_pct || 0;
  const daysLeft = goal.target_date
    ? Math.ceil((new Date(goal.target_date) - new Date()) / 86400000)
    : null;

  if (pct >= 100) return { label: 'Completed', classes: 'bg-secondary/15 text-secondary' };
  if (daysLeft !== null && daysLeft <= 0) return { label: 'Overdue', classes: 'bg-error/15 text-error' };
  if (daysLeft !== null && daysLeft <= 14 && pct < 80)
    return { label: 'At Risk', classes: 'bg-[#f97316]/15 text-[#c2410c]' };
  if (pct >= 60) return { label: 'On Track', classes: 'bg-secondary/15 text-secondary' };
  return { label: 'In Progress', classes: 'bg-primary/10 text-primary' };
}

// Quick-log increment presets
function quickIncrements(unit, targetValue) {
  const u = (unit || '').toLowerCase();
  if (u === 'books' || u === 'book') return [1];
  if (u === 'miles' || u === 'mile') return [1, 3, 5];
  if (u === 'usd' || u === '$') return [100, 500];
  if (u === '%') return [5, 10];
  if (targetValue <= 20) return [1];
  if (targetValue <= 100) return [1, 5, 10];
  return [1, 10, 25];
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 172800) return 'Yesterday';
  return `${Math.floor(diff / 86400)} days ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysLeftLabel(dateStr) {
  if (!dateStr) return null;
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days <= 7) return `${days}d left`;
  if (days <= 30) return `${days}d left`;
  return `${Math.ceil(days / 30)}mo left`;
}

function getGoalIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
}

// ── Navigation ───────────────────────────────────────────────────────────────
// Highlights the active nav item with bg + filled icon.
function setActiveNav(page) {
  document.querySelectorAll('[data-nav]').forEach(el => {
    const isActive = el.getAttribute('data-nav') === page;
    el.classList.toggle('bg-secondary-container',  isActive);
    el.classList.toggle('text-on-secondary-container', isActive);
    el.classList.toggle('rounded-xl', isActive);
    el.classList.toggle('text-on-surface-variant', !isActive);
    // Swap icon fill
    const icon = el.querySelector('.material-symbols-outlined');
    if (icon) {
      icon.style.fontVariationSettings = isActive
        ? "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24"
        : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24";
    }
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'toast';
  const bg = type === 'success' ? 'bg-on-surface' : 'bg-error';
  const textColor = type === 'success' ? 'text-inverse-on-surface' : 'text-on-error';
  toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 ${bg} ${textColor} px-6 py-3 rounded-full font-label-md shadow-2xl z-[100] flex items-center gap-2 transition-all duration-300`;
  toast.innerHTML = `<span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1;">${type === 'success' ? 'check_circle' : 'error'}</span>${message}`;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
}

// ── Confirm ───────────────────────────────────────────────────────────────────
function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-on-surface/40 flex items-center justify-center z-[200] backdrop-blur-sm';
    overlay.innerHTML = `
      <div class="bg-surface rounded-2xl p-xl shadow-2xl max-w-sm w-full mx-4 border border-outline-variant">
        <p class="font-body-md text-on-surface mb-xl leading-relaxed">${message}</p>
        <div class="flex gap-md justify-end">
          <button id="cancel-btn" class="px-lg py-sm rounded-xl border border-outline-variant font-label-md text-on-surface-variant hover:bg-surface-container-high transition-colors">Cancel</button>
          <button id="confirm-btn" class="px-lg py-sm rounded-xl bg-error text-on-error font-label-md hover:brightness-110 transition-all">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cancel-btn').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('#confirm-btn').onclick = () => { overlay.remove(); resolve(true); };
    overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
  });
}

// ── Shared sidebar HTML ───────────────────────────────────────────────────────
// Each page injects this via injectSidebar(activePage)
function sidebarHTML(activePage) {
  const links = [
    { key: 'dashboard', href: '/index.html',    icon: 'dashboard',  label: 'Dashboard' },
    { key: 'goals',     href: '/goals.html',     icon: 'target',     label: 'My Goals'  },
    { key: 'analytics', href: '/analytics.html', icon: 'leaderboard',label: 'Analytics' },
  ];
  const navItems = links.map(l => {
    const active = l.key === activePage;
    return `<a data-nav="${l.key}" href="${l.href}"
      class="flex items-center gap-md px-md py-[10px] rounded-xl font-label-md transition-all duration-150 ${active ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'}">
      <span class="material-symbols-outlined" style="font-variation-settings:'FILL' ${active ? 1 : 0},'wght' ${active ? 500 : 400},'GRAD' 0,'opsz' 24;">${l.icon}</span>
      <span>${l.label}</span>
    </a>`;
  }).join('');
  return `
    <div class="px-sm mb-xl">
      <div class="flex items-center gap-sm px-md py-sm">
        <div class="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-white text-[18px]" style="font-variation-settings:'FILL' 1;">bolt</span>
        </div>
        <div>
          <h1 class="font-headline-md text-[17px] font-bold text-primary leading-tight">Momentum</h1>
          <p class="font-label-sm text-[11px] text-on-surface-variant">Stay Focused</p>
        </div>
      </div>
    </div>
    <nav class="flex-1 space-y-[2px] px-sm">${navItems}</nav>
    <div class="px-sm pb-sm mt-lg">
      <a href="/new-goal.html"
        class="flex items-center justify-center gap-xs w-full py-[11px] bg-primary text-on-primary rounded-xl font-label-md text-[13px] shadow-sm hover:brightness-110 active:scale-[0.98] transition-all">
        <span class="material-symbols-outlined text-[18px]">add</span> New Goal
      </a>
    </div>
    <div class="px-sm pt-sm mt-sm border-t border-outline-variant/60 flex items-center gap-sm">
      <div data-user-initial class="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-on-primary font-bold text-sm select-none shrink-0">U</div>
      <span data-user-email class="flex-1 min-w-0 truncate text-[12px] text-on-surface-variant"></span>
      <button data-logout title="Sign out"
        class="p-[6px] rounded-lg text-on-surface-variant hover:bg-error-container hover:text-on-error-container transition-all shrink-0">
        <span class="material-symbols-outlined text-[18px]">logout</span>
      </button>
    </div>
  `;
}
