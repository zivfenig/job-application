// ============================================================
//  JOBTRACK — app.js
//  Job Application Tracker with Firebase sync
// ============================================================

// ─── FIREBASE CONFIG ─────────────────────────────────────────
// Replace with your Firebase project config:
// Firebase console → Project Settings → Your Apps → Web App
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ─── CONSTANTS ───────────────────────────────────────────────
const STATUSES = {
  open:      { label: 'Open',      icon: '◉' },
  interview: { label: 'Interview', icon: '◈' },
  offer:     { label: 'Offer',     icon: '◆' },
  rejected:  { label: 'Rejected',  icon: '✕' },
  ghosted:   { label: 'Ghosted',   icon: '○' },
};

const PLATFORMS = ['LinkedIn', 'Glassdoor', 'Indeed', 'Company Website', 'Via Relative', 'Other'];

// ─── AUTH ─────────────────────────────────────────────────────
// Passwords are stored as SHA-256 hashes — the real password is never in the code.
// To change password: compute sha256(newPassword) and replace the hash below.
const USERS = {
  'Ziv': 'a81e2862321c26b778d78e7cc65638cfc38f6d45f32d323dde94682ecc82a4e1',
};

let _authed = false;

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errEl    = document.getElementById('loginErr');

  if (!username || !password) {
    errEl.textContent = 'Please enter username and password.';
    return;
  }

  const expected = USERS[username];
  if (!expected) {
    errEl.textContent = 'Invalid username or password.';
    return;
  }

  const hash = await sha256(password);
  if (hash !== expected) {
    errEl.textContent = 'Invalid username or password.';
    // Small delay to slow brute force
    await new Promise(r => setTimeout(r, 600));
    return;
  }

  // Success
  _authed = true;
  sessionStorage.setItem('jt_session', '1'); // survives page refresh, clears on tab close
  sessionStorage.setItem('jt_user', username);
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display    = 'block';
  document.getElementById('loggedUser').textContent    = username;
  await initFirebase();
}

function doLogout() {
  sessionStorage.removeItem('jt_session');
  location.reload();
}

function checkSession() {
  return sessionStorage.getItem('jt_session') === '1';
}

// ─── STATE ───────────────────────────────────────────────────
let apps       = [];   // array of application objects
let _db        = null;
let _fbReady   = false;
let _editingId = null;
let _filter    = 'all';

// ─── FIREBASE INIT ───────────────────────────────────────────
async function initFirebase() {
  const hasConfig = FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';

  if (!hasConfig) {
    // Load from localStorage
    const raw = localStorage.getItem('jobtrack_apps');
    apps = raw ? JSON.parse(raw) : [];
    renderAll();
    return;
  }

  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getFirestore, doc, getDoc, setDoc, onSnapshot } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    const fbApp = initializeApp(FIREBASE_CONFIG);
    _db = getFirestore(fbApp);
    _fbReady = true;

    // Load existing data
    const snap = await getDoc(doc(_db, 'jobtrack', 'apps'));
    if (snap.exists()) {
      apps = snap.data().value || [];
    } else {
      // First time — check localStorage for existing data
      const raw = localStorage.getItem('jobtrack_apps');
      apps = raw ? JSON.parse(raw) : [];
      if (apps.length > 0) {
        await setDoc(doc(_db, 'jobtrack', 'apps'), { value: apps });
      }
    }

    // Live sync
    onSnapshot(doc(_db, 'jobtrack', 'apps'), snap => {
      if (snap.exists()) {
        apps = snap.data().value || [];
        renderAll();
      }
    });

    showToast('🔥 Connected — syncing across devices');
  } catch (e) {
    console.error('Firebase error:', e);
    const raw = localStorage.getItem('jobtrack_apps');
    apps = raw ? JSON.parse(raw) : [];
    showToast('⚠️ Offline mode — local storage only');
  }

  renderAll();
}

async function persistApps() {
  // Always save to localStorage as backup
  localStorage.setItem('jobtrack_apps', JSON.stringify(apps));

  // Save to Firebase if connected
  if (_fbReady && _db) {
    try {
      const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await setDoc(doc(_db, 'jobtrack', 'apps'), { value: apps });
    } catch (e) {
      console.error('Firebase save error:', e);
    }
  }
}

// ─── RENDER ──────────────────────────────────────────────────
function renderAll() {
  renderStats();
  renderList();
}

function renderStats() {
  const counts = { open: 0, interview: 0, offer: 0, rejected: 0, ghosted: 0 };
  apps.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; });

  const colors = {
    open: '#38bdf8', interview: '#a78bfa', offer: '#4ade80',
    rejected: '#f87171', ghosted: '#7a8394'
  };

  document.getElementById('statsBar').innerHTML = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `
      <div class="stat-pill s-${k}" style="border-color:${colors[k]}33;color:${colors[k]};background:${colors[k]}12">
        ${v} ${STATUSES[k].label}
      </div>`)
    .join('');
}

function renderList() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const sort   = document.getElementById('sortSelect').value;

  let filtered = apps.filter(a => {
    const matchStatus = _filter === 'all' || a.status === _filter;
    const matchSearch = !search ||
      a.company.toLowerCase().includes(search) ||
      a.role.toLowerCase().includes(search);
    return matchStatus && matchSearch;
  });

  // Sort
  const statusOrder = { open: 0, interview: 1, offer: 2, ghosted: 3, rejected: 4 };
  filtered.sort((a, b) => {
    if (sort === 'date-desc') return b.date.localeCompare(a.date);
    if (sort === 'date-asc')  return a.date.localeCompare(b.date);
    if (sort === 'company')   return a.company.localeCompare(b.company);
    if (sort === 'status')    return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    return 0;
  });

  const list = document.getElementById('appList');
  const empty = document.getElementById('emptyState');

  if (!filtered.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('.empty-title').textContent =
      apps.length === 0 ? 'No applications yet' : 'No results found';
    empty.querySelector('.empty-sub').textContent =
      apps.length === 0 ? 'Click "+ New Application" to start tracking' : 'Try adjusting your filter or search';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = filtered.map(renderCard).join('');
}

function renderCard(app) {
  const platformLabel = app.platform === 'Via Relative' && app.relative
    ? `Via ${app.relative}`
    : app.platform || '—';

  const linkHtml = app.url
    ? `<a class="card-link" href="${escHtml(app.url)}" target="_blank" rel="noopener">↗ Job link</a>`
    : '';

  const notesHtml = app.notes
    ? `<div class="card-notes">${escHtml(app.notes)}</div>`
    : '';

  const statusOptions = Object.entries(STATUSES)
    .map(([k, v]) => `<option value="${k}" ${app.status === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`)
    .join('');

  const dateFormatted = app.date
    ? new Date(app.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return `
    <div class="app-card" id="card-${app.id}">
      <div class="card-status-bar bar-${app.status}"></div>
      <div class="card-main">
        <div class="card-company">${escHtml(app.company)}</div>
        <div class="card-role">${escHtml(app.role)}</div>
        <div class="card-meta">
          <span class="card-platform">${escHtml(platformLabel)}</span>
          <span class="card-date">${dateFormatted}</span>
          ${linkHtml}
        </div>
        ${notesHtml}
      </div>
      <div class="card-status-wrap">
        <select class="status-select s-${app.status}" onchange="changeStatus('${app.id}', this.value)">
          ${statusOptions}
        </select>
      </div>
      <div class="card-actions">
        <button class="btn-icon" onclick="openEditModal('${app.id}')" title="Edit">✏️</button>
        <button class="btn-icon danger" onclick="deleteApp('${app.id}')" title="Delete">🗑</button>
      </div>
    </div>`;
}

// ─── FILTER ──────────────────────────────────────────────────
function setFilter(filter, btn) {
  _filter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderList();
}

// ─── STATUS CHANGE (inline) ──────────────────────────────────
async function changeStatus(id, newStatus) {
  const app = apps.find(a => a.id === id);
  if (!app) return;
  app.status = newStatus;
  await persistApps();
  renderAll(); // re-render to update bar color and stats
  showToast(`Status updated → ${STATUSES[newStatus]?.label}`);
}

// ─── DELETE ──────────────────────────────────────────────────
async function deleteApp(id) {
  if (!confirm('Delete this application?')) return;
  apps = apps.filter(a => a.id !== id);
  await persistApps();
  renderAll();
  showToast('🗑 Application deleted');
}

// ─── URL PARSER ──────────────────────────────────────────────
// Try to extract company name and job title from a job posting URL
// Uses page title via a CORS proxy — works for most job boards
async function parseJobUrl(url) {
  if (!url) return null;

  // Pattern-based extraction from URL itself
  const result = { company: '', role: '' };

  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');

    // LinkedIn: linkedin.com/jobs/view/TITLE-at-COMPANY-123456
    if (host.includes('linkedin.com')) {
      const match = u.pathname.match(/\/jobs\/view\/([^/]+)/);
      if (match) {
        const slug = decodeURIComponent(match[1]).replace(/-\d+$/, '');
        const atIdx = slug.lastIndexOf('-at-');
        if (atIdx > 0) {
          result.role    = titleCase(slug.slice(0, atIdx).replace(/-/g, ' '));
          result.company = titleCase(slug.slice(atIdx + 4).replace(/-/g, ' '));
          return result;
        }
        result.role = titleCase(slug.replace(/-/g, ' '));
      }
      result.company = 'LinkedIn';
      return result;
    }

    // Glassdoor: glassdoor.com/job-listing/TITLE-COMPANY-...
    if (host.includes('glassdoor.com')) {
      const match = u.pathname.match(/\/job-listing\/([^/]+)/);
      if (match) {
        const parts = decodeURIComponent(match[1]).split('-');
        // heuristic: last few words tend to be the company
        if (parts.length > 3) {
          result.role    = titleCase(parts.slice(0, -2).join(' '));
          result.company = titleCase(parts.slice(-2).join(' '));
          return result;
        }
        result.role = titleCase(parts.join(' '));
      }
      result.company = 'Glassdoor';
      return result;
    }

    // Indeed: indeed.com/viewjob?title=...&company=...
    if (host.includes('indeed.com')) {
      result.role    = titleCase(u.searchParams.get('title') || '');
      result.company = titleCase(u.searchParams.get('company') || 'Indeed');
      return result;
    }

    // Generic: use the domain as company name
    result.company = titleCase(host.split('.')[0]);
    return result;

  } catch (e) {
    return null;
  }
}

function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase()).trim();
}

// ─── MODAL ───────────────────────────────────────────────────
function openAddModal() {
  _editingId = null;
  document.getElementById('modalTitle').textContent = 'New Application';
  document.getElementById('modalBody').innerHTML = buildForm({});
  document.getElementById('modalOverlay').classList.add('open');
  initFormListeners();
}

function openEditModal(id) {
  _editingId = id;
  const app = apps.find(a => a.id === id);
  if (!app) return;
  document.getElementById('modalTitle').textContent = 'Edit Application';
  document.getElementById('modalBody').innerHTML = buildForm(app);
  document.getElementById('modalOverlay').classList.add('open');
  initFormListeners();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  _editingId = null;
}

function onOverlayClick(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

function buildForm(app) {
  const statusOptions = Object.entries(STATUSES)
    .map(([k, v]) => `<option value="${k}" ${(app.status || 'open') === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`)
    .join('');

  const platformOptions = PLATFORMS
    .map(p => `<option value="${p}" ${(app.platform || '') === p ? 'selected' : ''}>${p}</option>`)
    .join('');

  const showRelative = app.platform === 'Via Relative';

  return `
    <div class="form-group">
      <label class="form-label">Job Posting URL</label>
      <input class="form-input" id="f_url" type="url"
        placeholder="https://linkedin.com/jobs/view/…"
        value="${escHtml(app.url || '')}">
      <div class="url-status" id="urlStatus"></div>
    </div>

    <hr class="form-divider">

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Company Name *</label>
        <input class="form-input" id="f_company" placeholder="Acme Corp"
          value="${escHtml(app.company || '')}" required>
      </div>
      <div class="form-group">
        <label class="form-label">Job Title *</label>
        <input class="form-input" id="f_role" placeholder="Software Engineer"
          value="${escHtml(app.role || '')}" required>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Platform</label>
        <select class="form-select" id="f_platform">
          <option value="">— Select —</option>
          ${platformOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" id="f_status">
          ${statusOptions}
        </select>
      </div>
    </div>

    <div class="form-group relative-field ${showRelative ? 'visible' : ''}" id="relativeField">
      <label class="form-label">Relative / Contact Name</label>
      <input class="form-input" id="f_relative" placeholder="e.g. David Cohen"
        value="${escHtml(app.relative || '')}">
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Date Applied</label>
        <input class="form-input" id="f_date" type="date"
          value="${app.date || new Date().toISOString().slice(0, 10)}">
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="f_notes"
        placeholder="Recruiter name, salary range, impressions…">${escHtml(app.notes || '')}</textarea>
    </div>

    <div class="form-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-save" onclick="saveApp()">
        ${_editingId ? '💾 Save Changes' : '➕ Add Application'}
      </button>
    </div>`;
}

function initFormListeners() {
  // Platform → show/hide relative field
  document.getElementById('f_platform')?.addEventListener('change', function() {
    const rf = document.getElementById('relativeField');
    if (rf) {
      rf.classList.toggle('visible', this.value === 'Via Relative');
    }
  });

  // URL → auto-fill company and role
  let urlTimer;
  document.getElementById('f_url')?.addEventListener('input', function() {
    clearTimeout(urlTimer);
    const url = this.value.trim();
    if (!url) { document.getElementById('urlStatus').textContent = ''; return; }
    document.getElementById('urlStatus').innerHTML =
      '<span style="color:var(--text-dimmer)">⏳ Parsing URL…</span>';
    urlTimer = setTimeout(async () => {
      const result = await parseJobUrl(url);
      if (result) {
        const companyEl = document.getElementById('f_company');
        const roleEl    = document.getElementById('f_role');
        if (companyEl && !companyEl.value && result.company) companyEl.value = result.company;
        if (roleEl    && !roleEl.value    && result.role)    roleEl.value    = result.role;
        const filled = [];
        if (result.company) filled.push('company');
        if (result.role)    filled.push('role');
        document.getElementById('urlStatus').innerHTML = filled.length
          ? `<span style="color:var(--accent)">✓ Auto-filled: ${filled.join(', ')}</span>`
          : `<span style="color:var(--text-dimmer)">URL detected — fill fields manually</span>`;
      } else {
        document.getElementById('urlStatus').innerHTML =
          '<span style="color:var(--text-dimmer)">Could not parse — fill fields manually</span>';
      }
    }, 600);
  });

  // Also try on paste
  document.getElementById('f_url')?.addEventListener('paste', function() {
    setTimeout(() => this.dispatchEvent(new Event('input')), 50);
  });
}

// ─── SAVE ────────────────────────────────────────────────────
async function saveApp() {
  const company  = document.getElementById('f_company').value.trim();
  const role     = document.getElementById('f_role').value.trim();
  const url      = document.getElementById('f_url').value.trim();
  const platform = document.getElementById('f_platform').value;
  const relative = document.getElementById('f_relative')?.value.trim() || '';
  const status   = document.getElementById('f_status').value;
  const date     = document.getElementById('f_date').value;
  const notes    = document.getElementById('f_notes').value.trim();

  if (!company) { showToast('⚠️ Company name is required'); return; }
  if (!role)    { showToast('⚠️ Job title is required');    return; }

  if (_editingId) {
    const idx = apps.findIndex(a => a.id === _editingId);
    if (idx >= 0) {
      apps[idx] = { ...apps[idx], company, role, url, platform, relative, status, date, notes };
    }
    showToast('✅ Application updated');
  } else {
    apps.unshift({
      id:       'app_' + Date.now(),
      company, role, url, platform, relative,
      status:   status || 'open',
      date:     date || new Date().toISOString().slice(0, 10),
      notes,
      createdAt: new Date().toISOString(),
    });
    showToast('✅ Application added');
  }

  closeModal();
  await persistApps();
  renderAll();
}

// ─── TOAST ───────────────────────────────────────────────────
let _toastTimer;
function showToast(msg) {
  clearTimeout(_toastTimer);
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.opacity = '1';
  _toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2800);
}

// ─── UTILS ───────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── KEYBOARD ────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ─── BOOT ────────────────────────────────────────────────────
// Check if already logged in (session survives refresh)
if (checkSession()) {
  _authed = true;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display    = 'block';
  // Set username display — we store it in sessionStorage too
  const uname = sessionStorage.getItem('jt_user') || 'Ziv';
  document.getElementById('loggedUser').textContent = uname;
  initFirebase();
} else {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appShell').style.display    = 'none';
}

// Allow Enter key on login form
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('loginScreen').style.display !== 'none') {
    doLogin();
  }
});
