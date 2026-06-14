const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.env.VERCEL ? '/tmp/momentum.db' : path.join(__dirname, 'momentum.db');
const db = new DatabaseSync(dbPath);

db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);

db.exec(`
  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Other',
    target_value REAL DEFAULT 100,
    current_value REAL DEFAULT 0,
    unit TEXT DEFAULT '%',
    start_date TEXT,
    target_date TEXT,
    motivation TEXT DEFAULT '',
    frequency TEXT DEFAULT 'Daily Progression',
    status TEXT DEFAULT 'active',
    icon TEXT DEFAULT 'flag',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    target_date TEXT,
    completed INTEGER DEFAULT 0,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    priority TEXT DEFAULT 'normal',
    task_category TEXT DEFAULT 'General',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    value REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
    UNIQUE(goal_id, date)
  );

  CREATE TABLE IF NOT EXISTS wins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER,
    message TEXT NOT NULL,
    icon TEXT DEFAULT 'stars',
    icon_bg TEXT DEFAULT 'bg-secondary-container',
    icon_color TEXT DEFAULT 'text-on-secondary-container',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Helpers to convert null-prototype rows to plain objects
function toObj(row) {
  if (!row) return undefined;
  return Object.assign({}, row);
}

function toArr(rows) {
  return rows ? rows.map(r => Object.assign({}, r)) : [];
}

// Simple prepare wrapper that returns plain objects
const origPrepare = db.prepare.bind(db);
db.q = function(sql) {
  const stmt = origPrepare(sql);
  return {
    get: (...args) => toObj(stmt.get(...args)),
    all: (...args) => toArr(stmt.all(...args)),
    run: (...args) => stmt.run(...args)
  };
};

// Seed sample data if goals table is empty
const goalCount = db.q('SELECT COUNT(*) as c FROM goals').get();
if (goalCount.c === 0) {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 120);

  const insertGoal = db.q(`
    INSERT INTO goals (title, description, category, target_value, current_value, unit, start_date, target_date, motivation, frequency, status, icon)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMilestone = db.q(`INSERT INTO milestones (goal_id, title, target_date, completed, completed_at) VALUES (?, ?, ?, ?, ?)`);
  const insertTask = db.q(`INSERT INTO tasks (goal_id, title, completed, priority, task_category) VALUES (?, ?, ?, ?, ?)`);
  const insertProgress = db.q(`INSERT OR IGNORE INTO daily_progress (goal_id, date, value) VALUES (?, ?, ?)`);
  const insertWin = db.q(`INSERT INTO wins (goal_id, message, icon, icon_bg, icon_color) VALUES (?, ?, ?, ?, ?)`);

  const targetDate1 = new Date(now); targetDate1.setMonth(targetDate1.getMonth() + 2);
  const g1 = insertGoal.run('Read 24 Books', 'Annual Self-Improvement Goal — read 24 books this year', 'Learning', 24, 18, 'Books', startDate.toISOString().split('T')[0], targetDate1.toISOString().split('T')[0], 'Reading expands perspective and fuels creativity. Each book is a new world.', 'Daily Progression', 'active', 'menu_book');

  const targetDate2 = new Date(now); targetDate2.setMonth(targetDate2.getMonth() + 3);
  const g2 = insertGoal.run('Marathon Training', 'Sub 4-hour Marathon preparation', 'Health', 500, 320, 'Miles', startDate.toISOString().split('T')[0], targetDate2.toISOString().split('T')[0], 'Cross the finish line feeling strong. Prove to myself that discipline creates capability.', 'Daily Progression', 'active', 'fitness_center');

  const targetDate3 = new Date(now); targetDate3.setMonth(targetDate3.getMonth() + 1);
  const g3 = insertGoal.run('Emergency Fund', 'Financial Safety Net — $10,000 goal', 'Finance', 10000, 8200, 'USD', startDate.toISOString().split('T')[0], targetDate3.toISOString().split('T')[0], 'Financial security gives mental freedom. This fund is my peace of mind.', 'Weekly Check-in', 'active', 'payments');

  const targetDate4 = new Date(now); targetDate4.setMonth(targetDate4.getMonth() + 4);
  const g4 = insertGoal.run('Mastering Italian', 'Achieving B2 proficiency to connect with family roots', 'Learning', 100, 68, '%', startDate.toISOString().split('T')[0], targetDate4.toISOString().split('T')[0], 'Imagine ordering an espresso in a quiet Roman piazza, speaking fluently with the locals. Every verb conjugation is a step closer to that dream.', 'Daily Progression', 'active', 'translate');

  const g1id = Number(g1.lastInsertRowid);
  const g2id = Number(g2.lastInsertRowid);
  const g3id = Number(g3.lastInsertRowid);
  const g4id = Number(g4.lastInsertRowid);

  // Milestones
  insertMilestone.run(g1id, 'Read first 6 books', null, 1, new Date(now.getTime() - 90*86400000).toISOString());
  insertMilestone.run(g1id, 'Reach 12 books halfway', null, 1, new Date(now.getTime() - 45*86400000).toISOString());
  insertMilestone.run(g1id, 'Finish 18 books', null, 1, new Date(now.getTime() - 5*86400000).toISOString());
  insertMilestone.run(g1id, 'Complete 24 books', targetDate1.toISOString().split('T')[0], 0, null);

  insertMilestone.run(g2id, '100 miles base training', null, 1, new Date(now.getTime() - 80*86400000).toISOString());
  insertMilestone.run(g2id, '20-mile long run', new Date(now.getTime() + 86400000).toISOString().split('T')[0], 0, null);
  insertMilestone.run(g2id, 'Race day', targetDate2.toISOString().split('T')[0], 0, null);

  insertMilestone.run(g4id, 'Basics Mastery', null, 1, new Date(now.getTime() - 90*86400000).toISOString());
  insertMilestone.run(g4id, 'A1 Certification', null, 1, new Date(now.getTime() - 50*86400000).toISOString());
  insertMilestone.run(g4id, 'Conversation Skills', null, 0, null);
  insertMilestone.run(g4id, 'Watch Film Without Subtitles', null, 0, null);
  insertMilestone.run(g4id, 'B2 Exam', targetDate4.toISOString().split('T')[0], 0, null);

  // Tasks
  insertTask.run(g1id, 'Finish current book', 0, 'normal', 'Reading');
  insertTask.run(g1id, 'Write book summary notes', 0, 'high', 'Reading');
  insertTask.run(g1id, 'Pick next book from reading list', 1, 'normal', 'Planning');

  insertTask.run(g4id, 'Master Avere and Essere present tense', 1, 'normal', 'Vocabulary & Grammar');
  insertTask.run(g4id, 'Learn top 100 most common Italian adjectives', 1, 'normal', 'Vocabulary & Grammar');
  insertTask.run(g4id, 'Practice irregular past participles', 0, 'high', 'Vocabulary & Grammar');
  insertTask.run(g4id, '30-min conversation with tutor', 0, 'normal', 'Speaking & Listening');
  insertTask.run(g4id, 'Listen to Coffee Break Italian Podcast', 0, 'normal', 'Speaking & Listening');

  insertTask.run(g2id, 'Morning run - 5 miles', 1, 'normal', 'Training');
  insertTask.run(g2id, 'Long run - 20 miles this weekend', 0, 'high', 'Training');
  insertTask.run(g2id, 'Stretching & recovery session', 0, 'normal', 'Recovery');

  insertTask.run(g3id, 'Auto-transfer $400 to savings', 1, 'normal', 'Savings');
  insertTask.run(g3id, 'Review monthly spending report', 0, 'normal', 'Review');

  // Daily progress
  const goalIds = [g1id, g2id, g3id, g4id];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    if (d.getDay() !== 0) {
      insertProgress.run(g1id, dateStr, Math.random() > 0.3 ? 1 : 0);
      insertProgress.run(g2id, dateStr, Math.random() > 0.2 ? Math.round(3 + Math.random() * 8) : 0);
      insertProgress.run(g3id, dateStr, Math.random() > 0.6 ? Math.round(50 + Math.random() * 200) : 0);
      insertProgress.run(g4id, dateStr, Math.random() > 0.25 ? parseFloat((1 + Math.random() * 2).toFixed(1)) : 0);
    }
  }

  // Wins
  insertWin.run(g1id, "Unlocked 'Early Bird' achievement", 'stars', 'bg-secondary-container', 'text-on-secondary-container');
  insertWin.run(g3id, 'Reached 80% on Finance goal', 'trending_up', 'bg-primary-container', 'text-on-primary-container');
  insertWin.run(null, 'Completed 10-day streak', 'workspace_premium', 'bg-tertiary-fixed', 'text-on-tertiary-fixed');
}

module.exports = db;
