const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── GOALS ───────────────────────────────────────────────────────────────────

app.get('/api/goals', (req, res) => {
  const goals = db.q(`
    SELECT g.*,
      (SELECT COUNT(*) FROM milestones WHERE goal_id = g.id AND completed = 0) as pending_milestones,
      (SELECT COUNT(*) FROM tasks WHERE goal_id = g.id AND completed = 0) as pending_tasks,
      CASE WHEN g.target_value > 0 THEN ROUND((g.current_value / g.target_value) * 100) ELSE 0 END as progress_pct
    FROM goals g ORDER BY g.created_at DESC
  `).all();
  res.json(goals);
});

app.post('/api/goals', (req, res) => {
  const { title, description, category, target_value, current_value, unit, start_date, target_date, motivation, frequency, icon } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const result = db.q(`
    INSERT INTO goals (title, description, category, target_value, current_value, unit, start_date, target_date, motivation, frequency, icon)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title, description || '', category || 'Other',
    target_value || 100, current_value || 0, unit || '%',
    start_date || new Date().toISOString().split('T')[0],
    target_date || null, motivation || '', frequency || 'Daily Progression',
    icon || 'flag'
  );
  const goal = db.q('SELECT * FROM goals WHERE id = ?').get(Number(result.lastInsertRowid));
  res.status(201).json(goal);
});

app.get('/api/goals/:id', (req, res) => {
  const goal = db.q(`
    SELECT g.*, CASE WHEN g.target_value > 0 THEN ROUND((g.current_value / g.target_value) * 100) ELSE 0 END as progress_pct
    FROM goals g WHERE g.id = ?
  `).get(Number(req.params.id));
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  goal.milestones = db.q('SELECT * FROM milestones WHERE goal_id = ? ORDER BY created_at').all(Number(req.params.id));
  goal.tasks = db.q('SELECT * FROM tasks WHERE goal_id = ? ORDER BY task_category, created_at').all(Number(req.params.id));
  goal.recent_progress = db.q('SELECT * FROM daily_progress WHERE goal_id = ? ORDER BY date DESC LIMIT 7').all(Number(req.params.id));
  res.json(goal);
});

app.put('/api/goals/:id', (req, res) => {
  const id = Number(req.params.id);
  const { title, description, category, target_value, current_value, unit, start_date, target_date, motivation, frequency, status, icon } = req.body;
  const goal = db.q('SELECT * FROM goals WHERE id = ?').get(id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  db.q(`UPDATE goals SET title=?, description=?, category=?, target_value=?, current_value=?, unit=?, start_date=?, target_date=?, motivation=?, frequency=?, status=?, icon=? WHERE id=?`)
    .run(title ?? goal.title, description ?? goal.description, category ?? goal.category,
      target_value ?? goal.target_value, current_value ?? goal.current_value,
      unit ?? goal.unit, start_date ?? goal.start_date, target_date ?? goal.target_date,
      motivation ?? goal.motivation, frequency ?? goal.frequency,
      status ?? goal.status, icon ?? goal.icon, id);
  const updated = db.q(`SELECT *, CASE WHEN target_value > 0 THEN ROUND((current_value / target_value) * 100) ELSE 0 END as progress_pct FROM goals WHERE id = ?`).get(id);
  res.json(updated);
});

app.delete('/api/goals/:id', (req, res) => {
  const result = db.q('DELETE FROM goals WHERE id = ?').run(Number(req.params.id));
  if (result.changes === 0) return res.status(404).json({ error: 'Goal not found' });
  res.json({ success: true });
});

// ─── MILESTONES ──────────────────────────────────────────────────────────────

app.get('/api/goals/:id/milestones', (req, res) => {
  res.json(db.q('SELECT * FROM milestones WHERE goal_id = ? ORDER BY created_at').all(Number(req.params.id)));
});

app.post('/api/goals/:id/milestones', (req, res) => {
  const { title, target_date } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const result = db.q('INSERT INTO milestones (goal_id, title, target_date) VALUES (?, ?, ?)').run(Number(req.params.id), title, target_date || null);
  res.status(201).json(db.q('SELECT * FROM milestones WHERE id = ?').get(Number(result.lastInsertRowid)));
});

app.put('/api/milestones/:id', (req, res) => {
  const id = Number(req.params.id);
  const m = db.q('SELECT * FROM milestones WHERE id = ?').get(id);
  if (!m) return res.status(404).json({ error: 'Milestone not found' });
  const { title, target_date, completed } = req.body;
  const comp = completed !== undefined ? (completed ? 1 : 0) : m.completed;
  const completedAt = completed && !m.completed ? new Date().toISOString() : (completed ? m.completed_at : null);
  db.q('UPDATE milestones SET title=?, target_date=?, completed=?, completed_at=? WHERE id=?')
    .run(title ?? m.title, target_date ?? m.target_date, comp, completedAt, id);
  res.json(db.q('SELECT * FROM milestones WHERE id = ?').get(id));
});

app.delete('/api/milestones/:id', (req, res) => {
  db.q('DELETE FROM milestones WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

// ─── TASKS ───────────────────────────────────────────────────────────────────

app.get('/api/goals/:id/tasks', (req, res) => {
  res.json(db.q('SELECT * FROM tasks WHERE goal_id = ? ORDER BY task_category, created_at').all(Number(req.params.id)));
});

app.post('/api/goals/:id/tasks', (req, res) => {
  const { title, priority, task_category } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const result = db.q('INSERT INTO tasks (goal_id, title, priority, task_category) VALUES (?, ?, ?, ?)').run(Number(req.params.id), title, priority || 'normal', task_category || 'General');
  res.status(201).json(db.q('SELECT * FROM tasks WHERE id = ?').get(Number(result.lastInsertRowid)));
});

app.put('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const task = db.q('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { title, completed, priority, task_category } = req.body;
  db.q('UPDATE tasks SET title=?, completed=?, priority=?, task_category=? WHERE id=?')
    .run(title ?? task.title, completed !== undefined ? (completed ? 1 : 0) : task.completed, priority ?? task.priority, task_category ?? task.task_category, id);
  res.json(db.q('SELECT * FROM tasks WHERE id = ?').get(id));
});

app.delete('/api/tasks/:id', (req, res) => {
  db.q('DELETE FROM tasks WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

// ─── PROGRESS ────────────────────────────────────────────────────────────────

app.get('/api/goals/:id/progress', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  res.json(db.q('SELECT * FROM daily_progress WHERE goal_id = ? ORDER BY date DESC LIMIT ?').all(Number(req.params.id), days));
});

app.post('/api/goals/:id/progress', (req, res) => {
  const id = Number(req.params.id);
  const { date, value, notes } = req.body;
  const d = date || new Date().toISOString().split('T')[0];
  db.q('INSERT OR REPLACE INTO daily_progress (goal_id, date, value, notes) VALUES (?, ?, ?, ?)').run(id, d, value || 0, notes || '');

  const goal = db.q('SELECT * FROM goals WHERE id = ?').get(id);
  if (goal && goal.frequency === 'Daily Progression' && value > 0) {
    const total = db.q('SELECT SUM(value) as total FROM daily_progress WHERE goal_id = ?').get(id);
    const newValue = Math.min(goal.target_value || 100, total.total || 0);
    db.q('UPDATE goals SET current_value = ? WHERE id = ?').run(newValue, id);
  }
  res.status(201).json({ success: true, date: d });
});

// ─── ANALYTICS ───────────────────────────────────────────────────────────────

app.get('/api/analytics/overview', (req, res) => {
  const goals = db.q(`
    SELECT *, CASE WHEN target_value > 0 THEN ROUND((current_value / target_value) * 100) ELSE 0 END as progress_pct
    FROM goals WHERE status = 'active'
  `).all();

  let streak = 0;
  const checkDate = new Date();
  for (let i = 0; i < 365; i++) {
    const dateStr = checkDate.toISOString().split('T')[0];
    const hasActivity = db.q('SELECT COUNT(*) as c FROM daily_progress WHERE date = ? AND value > 0').get(dateStr);
    if (hasActivity && hasActivity.c > 0) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  const totalTasks = db.q('SELECT COUNT(*) as c FROM tasks').get().c;
  const completedTasks = db.q('SELECT COUNT(*) as c FROM tasks WHERE completed = 1').get().c;
  const wins = db.q('SELECT w.*, g.title as goal_title FROM wins w LEFT JOIN goals g ON w.goal_id = g.id ORDER BY w.created_at DESC LIMIT 5').all();
  const byCategory = db.q(`SELECT category, ROUND(AVG(CASE WHEN target_value > 0 THEN (current_value / target_value) * 100 ELSE 0 END)) as avg_progress FROM goals GROUP BY category`).all();

  res.json({
    goals,
    streak,
    totalGoals: goals.length,
    onTrack: goals.filter(g => g.progress_pct >= 50).length,
    lagging: goals.filter(g => g.progress_pct < 50).length,
    overallProgress: goals.length ? Math.round(goals.reduce((s, g) => s + g.progress_pct, 0) / goals.length) : 0,
    taskCompletionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    wins,
    byCategory
  });
});

app.get('/api/analytics/heatmap', (req, res) => {
  const days = parseInt(req.query.days) || 182;
  const rows = db.q(`
    SELECT date, SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END) as active_goals
    FROM daily_progress
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY date ORDER BY date
  `).all(days);
  res.json(rows);
});

// ─── WINS ─────────────────────────────────────────────────────────────────────

app.post('/api/wins', (req, res) => {
  const { goal_id, message, icon, icon_bg, icon_color } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const result = db.q('INSERT INTO wins (goal_id, message, icon, icon_bg, icon_color) VALUES (?, ?, ?, ?, ?)')
    .run(goal_id || null, message, icon || 'stars', icon_bg || 'bg-secondary-container', icon_color || 'text-on-secondary-container');
  res.status(201).json(db.q('SELECT * FROM wins WHERE id = ?').get(Number(result.lastInsertRowid)));
});

// ─── FALLBACK ─────────────────────────────────────────────────────────────────

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Momentum Goal Tracker`);
    console.log(`  Running at: http://localhost:${PORT}\n`);
  });
}

module.exports = app;
