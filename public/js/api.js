// Momentum API Client

const API = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async post(url, data) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async put(url, data) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
};

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
  `;
}
