/* ============================================================
   PHÂN CÔNG TRỰC – APP.JS
   Auto-increment date, round-robin with reset
   ============================================================ */

// Multi-tenant Room Logic
const urlParams = new URLSearchParams(window.location.search);
let currentRoom = urlParams.get('r');
const hash = window.location.hash;

if (!currentRoom) {
  const hasLegacyHash = hash && (hash.startsWith('#cloud-') || hash.startsWith('#view='));
  const hasOldData = !!localStorage.getItem('duty_roster_v2');

  if (hasLegacyHash || hasOldData) {
    currentRoom = 'default';
  } else {
    currentRoom = Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  window.history.replaceState(null, '', '?r=' + currentRoom + hash);
}

const STORAGE_KEY = currentRoom === 'default' ? 'duty_roster_v2' : 'duty_roster_v2_' + currentRoom;

function getApiUrlWithRoom() {
  if (!API_URL) return '';
  const sep = API_URL.includes('?') ? '&' : '?';
  return `${API_URL}${sep}r=${currentRoom}`;
}

// ── Cloud Sync (Google Apps Script) ──────────────────────────
let API_URL = localStorage.getItem('duty_api_url') || 'https://script.google.com/macros/s/AKfycbwe-odyE-4nUEPCg1dVN-_-MtGr4nYm6zpkFOipEVohbNF3-V_WFk48xkTAIrB5k1qO/exec';
const SYNC_INTERVAL = 5000; // Auto-refresh every 5 seconds if connected

// ── State ────────────────────────────────────────────────────
let state = loadState();
let isViewOnly = false;
let syncIntervalId = null;
let lastLocalSave = 0;           // timestamp of last local save
const PULL_COOLDOWN = 4000;      // skip cloud pull within 4s of local save

function defaultState() {
  return {
    employees: [],      // master list of names
    assigned: [],       // current round: [{name, date}]
    nextDate: '',       // ISO string: the next date to assign
    round: 1,
    perDay: 1,          // số người trực mỗi ngày (1 hoặc 2)
    history: []         // [{round, items:[{name,date}], completedAt}]
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (!s.perDay) s.perDay = 1; // backward compat
      return s;
    }
  } catch (_) { /* ignore */ }
  return defaultState();
}

function saveState() {
  lastLocalSave = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  pushToCloud(); // sync to cloud
}

// ── Cloud Sync Functions ─────────────────────────────────────
async function pushToCloud() {
  if (!API_URL) return;
  
  // Update timestamp when saving
  state.updatedAt = new Date().toISOString();
  
  try {
    const payload = {
      employees: state.employees,
      assigned: state.assigned,
      nextDate: state.nextDate,
      round: state.round,
      perDay: state.perDay || 1,
      history: state.history,
      updatedAt: state.updatedAt
    };
    await fetch(getApiUrlWithRoom(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn('Cloud sync failed:', e);
  }
}

async function pullFromCloud() {
  if (!API_URL) return false;
  // Skip pull if we just saved locally (avoid overwriting with stale cloud data)
  if (Date.now() - lastLocalSave < PULL_COOLDOWN) return true;
  try {
    const res = await fetch(getApiUrlWithRoom() + '&t=' + Date.now());
    const data = await res.json();
      if (data && data.updatedAt) {
        // Prevent unnecessary re-renders if no changes
        if (state.updatedAt === data.updatedAt) return true;
        
        state.employees = data.employees || [];
        state.assigned = data.assigned || [];
        state.nextDate = data.nextDate || '';
        state.round = data.round || 1;
        state.perDay = data.perDay || 1;
        state.history = data.history || [];
        state.updatedAt = data.updatedAt;

        if (!isViewOnly) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        }
        renderAll();
        updatePerDayUI();
        return true;
      } else {
        // If cloud is empty but we are an admin with data, initialize the cloud
        if (!isViewOnly && state.employees && state.employees.length > 0) {
          pushToCloud();
          return true;
        }
      }
  } catch (e) {
    console.warn('Cloud pull failed:', e);
  }
  return false;
}

// ── Helpers ──────────────────────────────────────────────────
function formatDateVN(isoStr) {
  if (!isoStr) return '--';
  const d = new Date(isoStr + 'T00:00:00');
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dayOfWeek = dayNames[d.getDay()];
  return `${dayOfWeek} - ${day}/${month}/${year}`;
}

function addDays(isoStr, n) {
  const d = new Date(isoStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ── DOM refs ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const dutyInput      = $('duty-input');
const startDateInput = $('start-date');
const btnImport      = $('btn-import');
const btnClearAll    = $('btn-clear-all');
const btnExport      = $('btn-export');
const kpiStrip       = $('kpi-strip');
const kpiTotal       = $('kpi-total');
const kpiDone        = $('kpi-done');
const kpiPending     = $('kpi-pending');
const kpiNextDate    = $('kpi-next-date');
const progressSection= $('progress-section');
const progressFill   = $('progress-fill');
const progressText   = $('progress-text');
const dutyColumns    = $('duty-columns');
const listPending    = $('list-pending');
const listDone       = $('list-done');
const badgePending   = $('badge-pending');
const badgeDone      = $('badge-done');
const roundBadge     = $('round-badge');
const historySection = $('history-section');
const historyList    = $('history-list');
const headerDate     = $('header-date');
const toastContainer = $('toast-container');
const btnHelp        = $('btn-help');
const helpOverlay    = $('help-overlay');
const helpClose      = $('help-close');
const btnShare       = $('btn-share');
const viewOnlyBanner = $('view-only-banner');

// Modals
const cloudOverlay   = $('cloud-overlay');
const cloudClose     = $('cloud-close');
const btnCloud       = $('btn-cloud');
const cloudUrlInput  = $('cloud-url-input');
const btnSaveCloud   = $('btn-save-cloud');
const cloudStatus    = $('cloud-status');

const shareOverlay   = $('share-overlay');
const shareClose     = $('share-close');
const btnCopyViewer  = $('btn-copy-viewer');
const btnCopyAdmin   = $('btn-copy-admin');

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Set header date
  headerDate.textContent = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
  });

  // Check for hash routes
  const hash = window.location.hash;
  if (hash) {
    try {
      if (hash.startsWith('#cloud-view=')) {
        API_URL = decodeURIComponent(atob(hash.slice(12)));
        isViewOnly = true;
        enterViewOnlyMode();
        startCloudSync();
      } else if (hash.startsWith('#cloud-admin=')) {
        API_URL = decodeURIComponent(atob(hash.slice(13)));
        localStorage.setItem('duty_api_url', API_URL);
        history.replaceState(null, '', window.location.pathname + '?r=' + currentRoom);
        toast('☁️', 'Đã kết nối Cloud với quyền Quản lý');
        startCloudSync();
      } else if (hash.startsWith('#view=')) {
        const encoded = hash.slice(6);
        const json = decodeURIComponent(atob(encoded));
        state = { ...defaultState(), ...JSON.parse(json) };
        isViewOnly = true;
        enterViewOnlyMode();
      }
    } catch (e) {
      toast('⚠️', 'Link không hợp lệ');
    }
  } else {
    // Normal start, start sync if API config exists
    if (API_URL) startCloudSync();
  }

  // Default start date = today
  startDateInput.value = state.nextDate || todayISO();

  // If we have employees from a previous session, restore them
  if (state.employees.length > 0) {
    renderAll();
  }

  btnImport.addEventListener('click', handleImport);
  btnClearAll.addEventListener('click', handleClearAll);
  btnExport.addEventListener('click', handleExport);

  // Đổi date picker → cập nhật ngày kế tiếp ngay
  startDateInput.addEventListener('change', () => {
    if (isViewOnly) return;
    const newDate = startDateInput.value;
    if (!newDate || newDate === state.nextDate) return;
    state.nextDate = newDate;
    if (state.employees.length > 0) saveState();
    renderAll();
    toast('📅', `Ngày kế tiếp: ${formatDateVN(newDate)}`);
  });

  // Per-day toggle
  document.querySelectorAll('.perday-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (isViewOnly) return;
      setPerDay(btn.dataset.perday);
    });
  });
  updatePerDayUI();
  // Cloud Modal
  btnCloud.addEventListener('click', () => {
    cloudUrlInput.value = API_URL;
    cloudStatus.textContent = '';
    cloudOverlay.classList.add('open');
  });
  cloudClose.addEventListener('click', () => cloudOverlay.classList.remove('open'));
  cloudOverlay.addEventListener('click', (e) => {
    if (e.target === cloudOverlay) cloudOverlay.classList.remove('open');
  });

  btnSaveCloud.addEventListener('click', async () => {
    const url = cloudUrlInput.value.trim();
    if (url) {
      API_URL = url;
      localStorage.setItem('duty_api_url', API_URL);
      cloudStatus.style.color = 'var(--text)';
      cloudStatus.textContent = 'Đang kiểm tra kết nối...';
      const ok = await pullFromCloud();
      if (ok) {
        cloudStatus.style.color = 'var(--green)';
        cloudStatus.textContent = 'Kết nối thành công! Đã đồng bộ.';
        startCloudSync();
        toast('☁️', 'Kết nối Cloud thành công');
      } else {
        cloudStatus.style.color = 'var(--red)';
        cloudStatus.textContent = 'Lỗi kết nối. Vui lòng kiểm tra lại URL Apps Script.';
      }
    } else {
      API_URL = '';
      localStorage.removeItem('duty_api_url');
      if (syncIntervalId) clearInterval(syncIntervalId);
      toast('☁️', 'Đã ngắt kết nối Cloud');
      cloudOverlay.classList.remove('open');
    }
  });

  // Share Modal
  btnShare.addEventListener('click', () => {
    if (!API_URL && state.assigned.length === 0) {
      toast('⚠️', 'Chưa có ai được phân công để chia sẻ');
      return;
    }
    shareOverlay.classList.add('open');
  });
  shareClose.addEventListener('click', () => shareOverlay.classList.remove('open'));
  shareOverlay.addEventListener('click', (e) => {
    if (e.target === shareOverlay) shareOverlay.classList.remove('open');
  });

  btnCopyViewer.addEventListener('click', () => handleAdvancedShare('view'));
  btnCopyAdmin.addEventListener('click', () => handleAdvancedShare('admin'));
});

// ── Cloud Polling ───────────────────────────────────────────
function startCloudSync() {
  pullFromCloud(); // initial pull
  if (syncIntervalId) clearInterval(syncIntervalId);
  syncIntervalId = setInterval(pullFromCloud, SYNC_INTERVAL);
}

// ── View-Only Mode ───────────────────────────────────────────
function enterViewOnlyMode() {
  viewOnlyBanner.style.display = 'flex';
  const sectionInput = $('section-input');
  if (sectionInput) sectionInput.style.display = 'none';
  document.body.classList.add('view-only');

  // Hide the left column (Chưa trực) and expand right column to full width
  const colPending = document.querySelector('.col-pending');
  if (colPending) colPending.style.display = 'none';
  const dutyCols = $('duty-columns');
  if (dutyCols) dutyCols.style.gridTemplateColumns = '1fr';

  // Hide action buttons in col-done
  const btnExp = $('btn-export');
  if (btnExp) btnExp.style.display = 'none';
  const btnShr = $('btn-share');
  if (btnShr) btnShr.style.display = 'none';
}


// ── Share ─────────────────────────────────────────────────────
function handleAdvancedShare(role) {
  let url = window.location.origin + window.location.pathname + '?r=' + currentRoom;
  
  if (API_URL) {
    // Cloud Share
    const encoded = btoa(encodeURIComponent(API_URL));
    url += (role === 'view') ? '#cloud-view=' + encoded : '#cloud-admin=' + encoded;
  } else {
    // Snapshot Share (Fallback)
    if (role === 'admin') {
      toast('⚠️', 'Cần kết nối Cloud để chia sẻ quyền Quản lý');
      return;
    }
    const shareData = {
      employees: state.employees,
      assigned: state.assigned,
      nextDate: state.nextDate,
      round: state.round,
      perDay: state.perDay || 1,
      history: state.history
    };
    const json = JSON.stringify(shareData);
    const encoded = btoa(encodeURIComponent(json));
    url += '#view=' + encoded;
  }

  navigator.clipboard.writeText(url).then(() => {
    const roleText = role === 'view' ? 'Chỉ xem' : 'Quản lý';
    toast('🔗', `Đã copy link (${roleText})!`);
    shareOverlay.classList.remove('open');
  }).catch(() => {
    prompt('Sao chép link này:', url);
  });
}

// ── Import ───────────────────────────────────────────────────
function handleImport() {
  const raw = dutyInput.value.trim();
  if (!raw) { toast('⚠️', 'Vui lòng nhập danh sách nhân viên.'); return; }

  const names = raw
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  if (names.length === 0) { toast('⚠️', 'Danh sách trống.'); return; }

  const dateVal = startDateInput.value;
  if (!dateVal) { toast('⚠️', 'Vui lòng chọn ngày bắt đầu.'); return; }

  if (state.employees.length === 0) {
    // First import – set up fresh
    state.employees = names;
    state.assigned = [];
    state.nextDate = dateVal;
    state.round = 1;
    state.history = [];
    saveState();

    dutyInput.value = '';
    toast('✅', `Đã nhập ${names.length} nhân viên. Ngày bắt đầu: ${formatDateVN(dateVal)}`);
  } else {
    // Add new names to existing list (skip duplicates)
    const existing = new Set(state.employees);
    const added = [];
    for (const name of names) {
      if (!existing.has(name)) {
        state.employees.push(name);
        existing.add(name);
        added.push(name);
      }
    }
    saveState();

    dutyInput.value = '';
    if (added.length > 0) {
      toast('✅', `Đã thêm ${added.length} nhân viên: ${added.join(', ')}`);
    } else {
      toast('ℹ️', 'Tất cả đã có trong danh sách.');
    }
  }

  renderAll();
}

// ── Clear All ────────────────────────────────────────────────
function handleClearAll() {
  if (state.employees.length === 0) return;
  state = defaultState();
  saveState();
  startDateInput.value = todayISO();
  toast('🗑️', 'Đã xóa toàn bộ dữ liệu.');
  renderAll();
}

// ── Mark Done (assign) ───────────────────────────────────────
function markDone(name) {
  const perDay = state.perDay || 1;
  const assignDate = state.nextDate;
  state.assigned.push({ name, date: assignDate });

  // Count how many slots filled on this date — only advance when fully booked
  const countOnDate = state.assigned.filter(a => a.date === assignDate).length;
  if (countOnDate >= perDay) {
    state.nextDate = addDays(assignDate, 1);
  }

  // Check if a full cycle just completed (all employees assigned in this cycle)
  const total = state.employees.length;
  if (total > 0 && state.assigned.length % total === 0) {
    const completedRound = state.round;
    state.round += 1;
    saveState();
    renderAll();
    toast('🔄', `Hết vòng ${completedRound}! Danh sách chưa trực đã nạp lại – tiếp tục phân công.`);
  } else {
    saveState();
    renderAll();
    toast('✅', `${name} → trực ngày ${formatDateVN(assignDate)}`);
  }
}

// ── Undo Assign ──────────────────────────────────────────────
function undoAssign(idx) {
  if (idx < 0 || idx >= state.assigned.length) return;

  const perDay = state.perDay || 1;
  const removedName = state.assigned[idx].name;
  const removedDate = state.assigned[idx].date;
  state.assigned.splice(idx, 1);

  // Chỉ dồn dates từ idx trở đi. Items trước idx (kể cả vòng cũ) giữ nguyên.
  // Slot trống do removedDate để lại được lấp bằng items kế tiếp theo perDay-pack.
  if (state.assigned.length > 0) {
    let slotsBefore = 0;
    for (let j = idx - 1; j >= 0; j--) {
      if (state.assigned[j].date === removedDate) slotsBefore++;
      else break;
    }
    let curDate = removedDate;
    let curSlot = slotsBefore;
    for (let i = idx; i < state.assigned.length; i++) {
      if (curSlot >= perDay) {
        curDate = addDays(curDate, 1);
        curSlot = 0;
      }
      state.assigned[i].date = curDate;
      curSlot++;
    }
    const lastDate = state.assigned[state.assigned.length - 1].date;
    let lastDayCount = 0;
    for (let j = state.assigned.length - 1; j >= 0; j--) {
      if (state.assigned[j].date === lastDate) lastDayCount++;
      else break;
    }
    state.nextDate = lastDayCount >= perDay ? addDays(lastDate, 1) : lastDate;
  } else {
    state.nextDate = removedDate;
  }

  // Recalculate round based on current assignments
  const total = state.employees.length;
  if (total > 0) {
    state.round = Math.floor(state.assigned.length / total) + 1;
  }

  saveState();
  renderAll();
  toast('↩️', `Đã hủy phân công: ${removedName} – ngày đã cập nhật lại`);
}

// ── Toggle Per-Day Mode ──────────────────────────────────────
function setPerDay(n) {
  const newPerDay = parseInt(n, 10) === 2 ? 2 : 1;
  const current = state.perDay || 1;
  if (current === newPerDay) return;

  state.perDay = newPerDay;

  // Chỉ re-pack vòng đang dở dang. Vòng đã hoàn tất giữ nguyên ngày,
  // và nextDate tiếp tục từ điểm hiện tại bằng setting mới.
  const total = state.employees.length;
  if (total > 0) {
    const currentCycleCount = state.assigned.length % total;
    if (currentCycleCount > 0) {
      const startIdx = state.assigned.length - currentCycleCount;
      const baseDate = state.assigned[startIdx].date;
      for (let i = 0; i < currentCycleCount; i++) {
        state.assigned[startIdx + i].date = addDays(baseDate, Math.floor(i / newPerDay));
      }
      const lastDate = state.assigned[state.assigned.length - 1].date;
      const lastCount = state.assigned
        .slice(startIdx)
        .filter(a => a.date === lastDate).length;
      state.nextDate = lastCount >= newPerDay ? addDays(lastDate, 1) : lastDate;
    }
    // currentCycleCount === 0: giữa các vòng, nextDate đã đúng — giữ nguyên.
  }

  saveState();
  updatePerDayUI();
  renderAll();
  toast('⚙️', `Đã chuyển sang ${newPerDay} người/ngày`);
}

function updatePerDayUI() {
  const cur = state.perDay || 1;
  document.querySelectorAll('.perday-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.perday, 10) === cur);
  });
}

// ── Remove Employee ──────────────────────────────────────────
function removeEmployee(name) {
  if (confirm(`Bạn có chắc chắn muốn xóa nhân viên "${name}" khỏi danh sách?`)) {
    state.employees = state.employees.filter(n => n !== name);
    state.assigned = state.assigned.filter(a => a.name !== name);
    saveState();
    renderAll();
    toast('🗑️', `Đã xóa nhân viên: ${name}`);
  }
}

// ── Computed ─────────────────────────────────────────────────
function getPending() {
  const total = state.employees.length;
  if (total === 0) return [];

  // Only look at the CURRENT cycle (not all assignments)
  // When assigned.length % total === 0, all employees are available again
  const currentCycleCount = state.assigned.length % total;
  const currentCycleAssigned = state.assigned.slice(state.assigned.length - currentCycleCount);
  const assignedNames = new Set(currentCycleAssigned.map(a => a.name));
  return state.employees.filter(n => !assignedNames.has(n));
}

// ── Export ────────────────────────────────────────────────────
function handleExport() {
  if (state.assigned.length === 0) {
    toast('⚠️', 'Chưa có phân công nào để copy.');
    return;
  }
  const lines = state.assigned.map((a, i) =>
    `${i + 1}. ${a.name} – ${formatDateVN(a.date)}`
  );
  const text = `📋 Phân công trực – Vòng ${state.round}\n` + lines.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    toast('📋', 'Đã copy danh sách phân công!');
  }).catch(() => {
    toast('⚠️', 'Không thể copy.');
  });
}

// ── Render ────────────────────────────────────────────────────
function renderAll() {
  const hasData = state.employees.length > 0;

  kpiStrip.style.display       = hasData ? 'grid' : 'none';
  progressSection.style.display = hasData ? 'block' : 'none';
  dutyColumns.style.display    = hasData ? 'grid' : 'none';

  if (!hasData) {
    historySection.style.display = 'none';
    roundBadge.style.display = 'none';
    return;
  }

  roundBadge.style.display = 'inline-flex';
  roundBadge.textContent = `Vòng ${state.round}`;

  const total = state.employees.length;
  const totalAssigned = state.assigned.length;
  const pendingList = getPending();
  const pendingCount = pendingList.length;
  const doneInCycle = total - pendingCount;
  const pct = total > 0 ? Math.round((doneInCycle / total) * 100) : 0;

  // KPI
  kpiTotal.textContent = total;
  kpiDone.textContent = totalAssigned;
  kpiPending.textContent = pendingCount;
  kpiNextDate.textContent = formatDateVN(state.nextDate);

  // Progress (shows current cycle progress)
  progressFill.style.width = Math.min(pct, 100) + '%';
  progressText.textContent = `${totalAssigned} ngày đã phân công | Vòng hiện tại: ${doneInCycle}/${total} (${pct}%)`;

  // Badges
  badgePending.textContent = pendingCount;
  badgeDone.textContent = totalAssigned;

  // Sync start-date input
  startDateInput.value = state.nextDate;

  renderPending();
  renderDone();
  renderHistory();
}

function renderPending() {
  const pending = getPending();
  if (pending.length === 0) {
    listPending.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🎉</span>
        <p>Tất cả đã được phân công!</p>
      </div>`;
    return;
  }

  const doneBtn = isViewOnly ? '' : `<button class="btn-done" onclick="markDone('\${name}')" title="Phân công trực">✅</button>`;

  listPending.innerHTML = pending.map((name, i) => `
    <div class="duty-row" style="animation-delay:${i * .04}s">
      <span class="duty-row-num">${i + 1}</span>
      <span class="duty-row-name">${escHtml(name)}</span>
      <span class="duty-row-date">${formatDateVN(state.nextDate)}</span>
      ${isViewOnly ? '' : `
        <button class="btn-delete" onclick="removeEmployee('${escAttr(name)}')" title="Xóa nhân viên">🗑️</button>
        <button class="btn-done" onclick="markDone('${escAttr(name)}')" title="Phân công trực">✅</button>
      `}
    </div>
  `).join('');
}

function renderDone() {
  if (state.assigned.length === 0) {
    listDone.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📭</span>
        <p>Chưa phân công ai</p>
      </div>`;
    return;
  }

  // Gộp các phân công liên tiếp cùng ngày thành 1 dòng
  const groups = [];
  for (let i = 0; i < state.assigned.length; i++) {
    const a = state.assigned[i];
    const last = groups[groups.length - 1];
    if (last && last.date === a.date) {
      last.items.push({ name: a.name, idx: i });
    } else {
      groups.push({ date: a.date, items: [{ name: a.name, idx: i }] });
    }
  }

  // Chỉ hiển thị đủ groups cuối để cover 14 phân công gần nhất
  const MAX_DISPLAY = 14;
  let cum = 0;
  let startGroupIdx = groups.length;
  for (let i = groups.length - 1; i >= 0; i--) {
    cum += groups[i].items.length;
    startGroupIdx = i;
    if (cum >= MAX_DISPLAY) break;
  }
  const visibleGroups = groups.slice(startGroupIdx);
  const hiddenCount = state.assigned.length - visibleGroups.reduce((s, g) => s + g.items.length, 0);

  let html = '';
  if (hiddenCount > 0) {
    html += `<div class="duty-row-hidden">... và ${hiddenCount} phân công trước đó</div>`;
  }
  html += visibleGroups.map((g, gi) => {
    const firstIdx = g.items[0].idx;
    const numLabel = `${firstIdx + 1}`;
    const names = g.items
      .map(it => `<span class="duty-name-part">${escHtml(it.name)}</span>`)
      .join('<span class="duty-name-sep">+</span>');
    const undoBtns = isViewOnly ? '' : g.items.map(it =>
      `<button class="btn-undo" onclick="undoAssign(${it.idx})" title="Hủy: ${escAttr(it.name)}">↩️</button>`
    ).join('');
    return `
    <div class="duty-row" style="animation-delay:${gi * .04}s">
      <span class="duty-row-num">${numLabel}</span>
      <span class="duty-row-name">${names}</span>
      <span class="duty-row-date">${formatDateVN(g.date)}</span>
      ${undoBtns}
    </div>`;
  }).join('');

  listDone.innerHTML = html;
}

// Derive history từ assigned[]: mỗi chunk `total` entries = 1 vòng đã hoàn tất.
// Cách này tự đồng bộ với undo/remove/cloud-pull, không cần lưu trữ riêng.
function getHistory() {
  const total = state.employees.length;
  if (total <= 0) return [];
  const out = [];
  const numCompleteRounds = Math.floor(state.assigned.length / total);
  for (let r = 0; r < numCompleteRounds; r++) {
    const items = state.assigned.slice(r * total, (r + 1) * total);
    out.push({
      round: r + 1,
      items: items,
      completedAt: items[items.length - 1].date
    });
  }
  return out;
}

function renderHistory() {
  const history = getHistory();
  if (history.length === 0) {
    historySection.style.display = 'none';
    return;
  }
  historySection.style.display = 'block';

  historyList.innerHTML = history.slice().reverse().map((h) => {
    const firstDate = h.items.length > 0 ? formatDateVN(h.items[0].date) : '';
    const lastDate = h.items.length > 0 ? formatDateVN(h.items[h.items.length - 1].date) : '';
    const dateRange = firstDate && lastDate ? `${firstDate} → ${lastDate}` : '';

    const rows = h.items.map((it, i) => `
      <div class="history-row">
        <span class="history-row-num">${i + 1}</span>
        <span class="history-row-name">${escHtml(it.name)}</span>
        <span class="history-row-date">${formatDateVN(it.date)}</span>
      </div>
    `).join('');

    return `
      <div class="history-round">
        <div class="history-round-header" onclick="toggleHistory(this)">
          <div class="history-round-title">
            🔄 Vòng ${h.round}
            <span style="font-weight:400;font-size:.75rem;color:var(--text-muted)">(${h.items.length} NV)</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="history-round-meta">${dateRange}</span>
            <span class="history-toggle">▼</span>
          </div>
        </div>
        <div class="history-round-body collapsed">${rows}</div>
      </div>
    `;
  }).join('');
}

// ── Toggle history ───────────────────────────────────────────
function toggleHistory(headerEl) {
  const body = headerEl.nextElementSibling;
  const arrow = headerEl.querySelector('.history-toggle');
  body.classList.toggle('collapsed');
  arrow.classList.toggle('open');
}

// ── Celebration ──────────────────────────────────────────────
function showCelebration() {
  const overlay = document.createElement('div');
  overlay.className = 'celebration-overlay';
  overlay.innerHTML = `
    <div class="celebration-modal">
      <div class="celebration-emoji">🎊</div>
      <div class="celebration-title">Hoàn thành vòng ${state.round - 1}!</div>
      <div class="celebration-desc">
        Tất cả nhân viên đã được phân công trực.<br>
        Danh sách đã được lưu vào lịch sử.<br>
        <strong>Ngày bắt đầu vòng mới: ${formatDateVN(state.nextDate)}</strong>
      </div>
      <button class="celebration-btn" onclick="closeCelebration()">
        🚀 Tiếp tục vòng ${state.round}
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function closeCelebration() {
  const overlay = document.querySelector('.celebration-overlay');
  if (overlay) overlay.remove();
}

// ── Toast ────────────────────────────────────────────────────
function toast(icon, message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); }, 2800);
  setTimeout(() => { el.remove(); }, 3200);
}

// ── Escape helpers ───────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
