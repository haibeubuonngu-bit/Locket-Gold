// Admin Dashboard Logic for BO-LocketGold

let authToken = sessionStorage.getItem('locket_admin_token') || null;
let allJobsList = [];
let activeFilter = 'all';
let searchQuery = '';
let autoRefreshTimer = null;
let isAutoRefreshEnabled = true;

const sweetAlertDefaults = {
  background: '#faf9f5',
  color: '#141413',
  confirmButtonColor: '#cc785c',
  confirmButtonText: 'Đã hiểu',
  buttonsStyling: false,
  customClass: {
    popup: 'claude-popup',
    title: 'claude-title',
    htmlContainer: 'claude-html',
    confirmButton: 'claude-confirm !bg-accent-600 hover:!bg-accent-700 font-semibold px-4 py-2.5 rounded-xl text-white',
    cancelButton: 'claude-confirm !bg-surface !text-body hover:!bg-line border border-line ml-2 px-4 py-2.5 rounded-xl'
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();

  initAuth();
  initEventListeners();
});

// --- Auth & Session ---

function initAuth() {
  const lockScreen = document.getElementById('lockScreen');
  const adminDashboard = document.getElementById('adminDashboard');
  const authForm = document.getElementById('authForm');
  const adminPasswordInput = document.getElementById('adminPasswordInput');
  const authErrorMsg = document.getElementById('authErrorMsg');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');

  // Password visibility toggle
  if (togglePasswordBtn && adminPasswordInput) {
    togglePasswordBtn.addEventListener('click', () => {
      const type = adminPasswordInput.type === 'password' ? 'text' : 'password';
      adminPasswordInput.type = type;
      const eyeIcon = document.getElementById('eyeIcon');
      if (eyeIcon) {
        eyeIcon.setAttribute('data-lucide', type === 'password' ? 'eye' : 'eye-off');
        if (window.lucide) lucide.createIcons();
      }
    });
  }

  // Handle Login Submit
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = adminPasswordInput.value.trim();
    if (!password) return;

    const authSubmitBtn = document.getElementById('authSubmitBtn');
    authSubmitBtn.disabled = true;
    authSubmitBtn.innerHTML = `<i data-lucide="loader-circle" class="h-4 w-4 animate-spin"></i><span>Đang xác thực...</span>`;
    if (window.lucide) lucide.createIcons();
    authErrorMsg.classList.add('hidden');

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Mật khẩu không chính xác.');
      }

      authToken = data.token;
      sessionStorage.setItem('locket_admin_token', authToken);

      showDashboard();
    } catch (err) {
      authErrorMsg.textContent = err.message || 'Lỗi xác thực quản trị';
      authErrorMsg.classList.remove('hidden');
      adminPasswordInput.focus();
    } finally {
      authSubmitBtn.disabled = false;
      authSubmitBtn.innerHTML = `<i data-lucide="lock-open" class="h-4 w-4"></i><span>Mở khóa Quản trị</span>`;
      if (window.lucide) lucide.createIcons();
    }
  });

  // Check existing token
  if (authToken) {
    verifyAndLoad();
  }
}

async function verifyAndLoad() {
  try {
    const res = await fetch('/api/admin/jobs', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      showDashboard();
    } else {
      sessionStorage.removeItem('locket_admin_token');
      authToken = null;
    }
  } catch {
    sessionStorage.removeItem('locket_admin_token');
    authToken = null;
  }
}

function showDashboard() {
  document.getElementById('lockScreen').classList.add('hidden');
  document.getElementById('adminDashboard').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();

  fetchAdminData();
  startAutoRefresh();
}

function logout() {
  sessionStorage.removeItem('locket_admin_token');
  authToken = null;
  stopAutoRefresh();
  window.location.reload();
}

// --- Event Listeners ---

function initEventListeners() {
  // Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      Swal.fire({
        ...sweetAlertDefaults,
        title: 'Đăng xuất',
        text: 'Bạn có chắc chắn muốn đăng xuất khỏi trang Quản trị?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Đăng xuất',
        cancelButtonText: 'Hủy'
      }).then((result) => {
        if (result.isConfirmed) {
          logout();
        }
      });
    });
  }

  // Manual Refresh
  const manualRefreshBtn = document.getElementById('manualRefreshBtn');
  if (manualRefreshBtn) {
    manualRefreshBtn.addEventListener('click', () => {
      const refreshIcon = document.getElementById('refreshIcon');
      if (refreshIcon) refreshIcon.classList.add('animate-spin');
      fetchAdminData().finally(() => {
        setTimeout(() => {
          if (refreshIcon) refreshIcon.classList.remove('animate-spin');
        }, 500);
      });
    });
  }

  // Auto Refresh Toggle
  const autoRefreshBtn = document.getElementById('autoRefreshBtn');
  const autoRefreshLabel = document.getElementById('autoRefreshLabel');
  const liveDot = document.getElementById('liveDot');

  if (autoRefreshBtn) {
    autoRefreshBtn.addEventListener('click', () => {
      isAutoRefreshEnabled = !isAutoRefreshEnabled;
      if (isAutoRefreshEnabled) {
        startAutoRefresh();
        autoRefreshLabel.textContent = 'Tự làm mới: Bật';
        autoRefreshBtn.classList.remove('opacity-60');
        if (liveDot) liveDot.classList.add('animate-pulse');
      } else {
        stopAutoRefresh();
        autoRefreshLabel.textContent = 'Tự làm mới: Tắt';
        autoRefreshBtn.classList.add('opacity-60');
        if (liveDot) liveDot.classList.remove('animate-pulse');
      }
    });
  }

  // Filter Tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('is-active'));
      const target = e.currentTarget;
      target.classList.add('is-active');
      activeFilter = target.getAttribute('data-filter') || 'all';
      renderJobsTable();
    });
  });

  // Search Input
  const searchInput = document.getElementById('adminSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderJobsTable();
    });
  }

  // Clear History Button
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', async () => {
      const result = await Swal.fire({
        ...sweetAlertDefaults,
        title: 'Dọn dẹp lịch sử',
        text: 'Bạn có chắc chắn muốn xóa toàn bộ các yêu cầu đã hoàn thành và thất bại không? Các yêu cầu đang chạy hoặc trong hàng đợi sẽ được giữ lại.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '🗑️ Dọn dẹp ngay',
        cancelButtonText: 'Hủy'
      });

      if (result.isConfirmed) {
        try {
          const res = await fetch('/api/admin/jobs/clear-history', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          const data = await res.json();
          if (res.ok && data.success) {
            Swal.fire({
              ...sweetAlertDefaults,
              icon: 'success',
              title: 'Thành công',
              text: data.message
            });
            fetchAdminData();
          } else {
            throw new Error(data.message || 'Lỗi khi dọn dẹp lịch sử');
          }
        } catch (err) {
          Swal.fire({
            ...sweetAlertDefaults,
            icon: 'error',
            title: 'Lỗi',
            text: err.message
          });
        }
      }
    });
  }
}

// --- Data Fetching & Polling ---

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    if (authToken && isAutoRefreshEnabled) {
      fetchAdminData(true);
    }
  }, 2500);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

async function fetchAdminData(silent = false) {
  if (!authToken) return;

  try {
    const res = await fetch('/api/admin/jobs', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (res.status === 401) {
      logout();
      return;
    }

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Không thể tải dữ liệu');
    }

    allJobsList = data.jobs || [];
    updateStats(data.stats || {});
    renderJobsTable();

    // Update timestamp
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const lastUpdatedEl = document.getElementById('lastUpdatedTime');
    if (lastUpdatedEl) lastUpdatedEl.textContent = timeStr;

  } catch (err) {
    if (!silent) {
      console.error('Admin fetch error:', err);
    }
  }
}

// --- UI Rendering ---

function updateStats(stats) {
  const statProcessing = document.getElementById('statProcessing');
  const statQueued = document.getElementById('statQueued');
  const statCompleted = document.getElementById('statCompleted');
  const statFailed = document.getElementById('statFailed');
  const statTotal = document.getElementById('statTotal');

  if (statProcessing) statProcessing.textContent = stats.processing || 0;
  if (statQueued) statQueued.textContent = stats.queued || 0;
  if (statCompleted) statCompleted.textContent = stats.completed || 0;
  if (statFailed) statFailed.textContent = (stats.failed || 0) + (stats.cancelled || 0);
  if (statTotal) statTotal.textContent = stats.total || 0;

  // Update tab badges
  const badgeAll = document.getElementById('tabBadgeAll');
  const badgeActive = document.getElementById('tabBadgeActive');
  const badgeCompleted = document.getElementById('tabBadgeCompleted');
  const badgeFailed = document.getElementById('tabBadgeFailed');

  if (badgeAll) badgeAll.textContent = stats.total || 0;
  if (badgeActive) badgeActive.textContent = (stats.processing || 0) + (stats.queued || 0);
  if (badgeCompleted) badgeCompleted.textContent = stats.completed || 0;
  if (badgeFailed) badgeFailed.textContent = (stats.failed || 0) + (stats.cancelled || 0);
}

function renderJobsTable() {
  const tbody = document.getElementById('jobsTableBody');
  const mobileList = document.getElementById('jobsMobileList');
  const emptyState = document.getElementById('emptyState');
  if (!tbody) return;

  // Filter list
  let filtered = allJobsList.filter(job => {
    // Tab filter
    if (activeFilter === 'active') {
      if (job.status !== 'queued' && job.status !== 'processing') return false;
    } else if (activeFilter === 'completed') {
      if (job.status !== 'completed') return false;
    } else if (activeFilter === 'failed') {
      if (job.status !== 'failed' && job.status !== 'cancelled') return false;
    }

    // Search query
    if (searchQuery) {
      const username = String(job.username || '').toLowerCase();
      const cleanUsername = String(job.cleanUsername || '').toLowerCase();
      const uid = String(job.uid || '').toLowerCase();
      const id = String(job.id || '').toLowerCase();
      if (!username.includes(searchQuery) && !cleanUsername.includes(searchQuery) && !uid.includes(searchQuery) && !id.includes(searchQuery)) {
        return false;
      }
    }

    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (mobileList) mobileList.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  // 1. Render Desktop Table Body
  tbody.innerHTML = filtered.map(job => {
    const avatarUrl = sanitizeUrl(job.avatarUrl);
    const displayUser = escapeHtml(job.cleanUsername || job.username || 'unknown');
    const initials = escapeHtml(job.initials || displayUser.slice(0, 2).toUpperCase());
    const uid = job.uid ? escapeHtml(job.uid) : '<span class="text-muted italic">Đang giải mã...</span>';
    const timeStr = formatJobTime(job.createdAt);
    const statusBadge = renderStatusBadge(job.status);
    const progress = Math.min(100, Math.max(0, Number(job.progress) || 0));

    const avatarHtml = avatarUrl
      ? `<img src="${avatarUrl}" alt="${displayUser}" class="h-8 w-8 rounded-full object-cover border border-line" onerror="this.outerHTML='<div class=\\'flex h-8 w-8 items-center justify-center rounded-full bg-accent-100 font-bold text-accent-700 text-xs\\'>${initials}</div>'">`
      : `<div class="flex h-8 w-8 items-center justify-center rounded-full bg-accent-100 font-bold text-accent-700 text-xs border border-accent-200">${initials}</div>`;

    return `
      <tr class="hover:bg-surface/50 transition">
        <!-- Account -->
        <td class="py-3 pr-4">
          <div class="flex items-center gap-3">
            ${avatarHtml}
            <div class="min-w-0">
              <span class="font-semibold text-ink block truncate">@${displayUser}</span>
              <span class="font-mono text-[10px] text-muted truncate block">Job #${escapeHtml(job.id)}</span>
            </div>
          </div>
        </td>

        <!-- UID -->
        <td class="py-3 px-3 font-mono text-[11px] text-muted select-all">
          ${uid}
        </td>

        <!-- Status -->
        <td class="py-3 px-3 whitespace-nowrap">
          ${statusBadge}
        </td>

        <!-- Progress -->
        <td class="py-3 px-3">
          <div class="w-24">
            <div class="flex items-center justify-between text-[10px] font-mono text-muted mb-1">
              <span>${progress}%</span>
            </div>
            <div class="h-1.5 w-full rounded-full bg-line overflow-hidden">
              <div class="h-full rounded-full ${progress === 100 ? 'bg-moss-500' : (job.status === 'failed' ? 'bg-red-500' : 'bg-accent-600')}" style="width: ${progress}%"></div>
            </div>
          </div>
        </td>

        <!-- Time -->
        <td class="py-3 px-3 whitespace-nowrap text-[11px] text-muted">
          ${timeStr}
        </td>

        <!-- Actions -->
        <td class="py-3 pl-3 text-right whitespace-nowrap">
          <div class="flex items-center justify-end gap-1.5">
            <!-- View Logs -->
            <button onclick="viewJobLogs('${escapeHtml(job.id)}')" class="btn-secondary !p-1.5 !min-h-0 text-muted hover:!text-ink" title="Xem nhật ký chi tiết">
              <i data-lucide="file-text" class="h-3.5 w-3.5"></i>
            </button>

            <!-- Retry (If Failed or Cancelled) -->
            ${(job.status === 'failed' || job.status === 'cancelled') ? `
              <button onclick="retryJob('${escapeHtml(job.id)}')" class="btn-secondary !p-1.5 !min-h-0 text-accent-700 hover:!bg-accent-50" title="Thử lại yêu cầu này">
                <i data-lucide="rotate-cw" class="h-3.5 w-3.5"></i>
              </button>
            ` : ''}

            <!-- Cancel (If Queued) -->
            ${job.status === 'queued' ? `
              <button onclick="cancelJob('${escapeHtml(job.id)}')" class="btn-secondary !p-1.5 !min-h-0 text-red-600 hover:!bg-red-50" title="Hủy hàng đợi">
                <i data-lucide="x" class="h-3.5 w-3.5"></i>
              </button>
            ` : ''}

            <!-- Delete -->
            <button onclick="deleteJob('${escapeHtml(job.id)}')" class="btn-secondary !p-1.5 !min-h-0 text-muted hover:!text-red-600" title="Xóa bản ghi">
              <i data-lucide="trash" class="h-3.5 w-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // 2. Render Mobile Cards
  if (mobileList) {
    mobileList.innerHTML = filtered.map(job => {
      const avatarUrl = sanitizeUrl(job.avatarUrl);
      const displayUser = escapeHtml(job.cleanUsername || job.username || 'unknown');
      const initials = escapeHtml(job.initials || displayUser.slice(0, 2).toUpperCase());
      const uid = job.uid ? escapeHtml(job.uid) : '<span class="text-muted italic">Đang giải mã...</span>';
      const timeStr = formatJobTime(job.createdAt);
      const statusBadge = renderStatusBadge(job.status);
      const progress = Math.min(100, Math.max(0, Number(job.progress) || 0));

      const avatarHtml = avatarUrl
        ? `<img src="${avatarUrl}" alt="${displayUser}" class="h-9 w-9 rounded-full object-cover border border-line shrink-0" onerror="this.outerHTML='<div class=\\'flex h-9 w-9 items-center justify-center rounded-full bg-accent-100 font-bold text-accent-700 text-xs shrink-0\\'>${initials}</div>'">`
        : `<div class="flex h-9 w-9 items-center justify-center rounded-full bg-accent-100 font-bold text-accent-700 text-xs border border-accent-200 shrink-0">${initials}</div>`;

      return `
        <div class="rounded-xl border border-line bg-surface/90 p-3.5 shadow-xs space-y-3">
          <!-- Card Top: Avatar, Name, Status -->
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              ${avatarHtml}
              <div class="min-w-0">
                <span class="font-semibold text-ink text-sm block truncate">@${displayUser}</span>
                <span class="font-mono text-[10px] text-muted truncate block">Job #${escapeHtml(job.id)}</span>
              </div>
            </div>
            <div class="shrink-0">
              ${statusBadge}
            </div>
          </div>

          <!-- Card Mid: UID & Time -->
          <div class="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-line/60">
            <div>
              <span class="text-muted block text-[10px] uppercase font-semibold">UID Locket</span>
              <span class="font-mono text-ink text-[11px] truncate block select-all">${uid}</span>
            </div>
            <div class="text-right">
              <span class="text-muted block text-[10px] uppercase font-semibold">Thời gian</span>
              <span class="text-muted text-[11px]">${timeStr}</span>
            </div>
          </div>

          <!-- Card Progress -->
          <div>
            <div class="flex items-center justify-between text-[10px] font-mono text-muted mb-1">
              <span>Tiến độ</span>
              <span class="font-semibold text-ink">${progress}%</span>
            </div>
            <div class="h-1.5 w-full rounded-full bg-line overflow-hidden">
              <div class="h-full rounded-full ${progress === 100 ? 'bg-moss-500' : (job.status === 'failed' ? 'bg-red-500' : 'bg-accent-600')}" style="width: ${progress}%"></div>
            </div>
          </div>

          <!-- Card Bottom: Action Buttons -->
          <div class="flex items-center justify-end gap-1.5 pt-2 border-t border-line/60">
            <!-- View Logs -->
            <button onclick="viewJobLogs('${escapeHtml(job.id)}')" class="btn-secondary !py-1.5 !px-2.5 !min-h-0 text-xs flex items-center gap-1">
              <i data-lucide="file-text" class="h-3.5 w-3.5"></i>
              <span>Nhật ký</span>
            </button>

            <!-- Retry -->
            ${(job.status === 'failed' || job.status === 'cancelled') ? `
              <button onclick="retryJob('${escapeHtml(job.id)}')" class="btn-secondary !py-1.5 !px-2.5 !min-h-0 text-xs text-accent-700 hover:!bg-accent-50 flex items-center gap-1">
                <i data-lucide="rotate-cw" class="h-3.5 w-3.5"></i>
                <span>Thử lại</span>
              </button>
            ` : ''}

            <!-- Cancel -->
            ${job.status === 'queued' ? `
              <button onclick="cancelJob('${escapeHtml(job.id)}')" class="btn-secondary !py-1.5 !px-2.5 !min-h-0 text-xs text-red-600 hover:!bg-red-50 flex items-center gap-1">
                <i data-lucide="x" class="h-3.5 w-3.5"></i>
                <span>Hủy</span>
              </button>
            ` : ''}

            <!-- Delete -->
            <button onclick="deleteJob('${escapeHtml(job.id)}')" class="btn-secondary !py-1.5 !px-2 !min-h-0 text-xs text-muted hover:!text-red-600" title="Xóa">
              <i data-lucide="trash" class="h-3.5 w-3.5"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) lucide.createIcons();
}

function renderStatusBadge(status) {
  switch (status) {
    case 'queued':
      return `<span class="inline-flex items-center gap-1 rounded-full border border-[#e8ccb6] bg-[#f7e9d9] px-2 py-0.5 text-[10px] font-semibold text-[#8d562e]"><span class="h-1.5 w-1.5 rounded-full bg-[#8d562e]"></span>Hàng đợi</span>`;
    case 'processing':
      return `<span class="inline-flex items-center gap-1 rounded-full border border-accent-300 bg-accent-50 px-2 py-0.5 text-[10px] font-semibold text-accent-700"><span class="h-1.5 w-1.5 rounded-full bg-accent-600 animate-ping"></span>Đang xử lý</span>`;
    case 'completed':
      return `<span class="inline-flex items-center gap-1 rounded-full border border-[#d3dfcf] bg-moss-50 px-2 py-0.5 text-[10px] font-semibold text-moss-700"><span class="h-1.5 w-1.5 rounded-full bg-moss-500"></span>Hoàn tất Gold</span>`;
    case 'failed':
      return `<span class="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600"><span class="h-1.5 w-1.5 rounded-full bg-red-600"></span>Thất bại</span>`;
    case 'cancelled':
      return `<span class="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted"><span class="h-1.5 w-1.5 rounded-full bg-muted"></span>Đã hủy</span>`;
    default:
      return `<span class="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[10px] text-muted">${escapeHtml(status || 'unknown')}</span>`;
  }
}

function formatJobTime(isoString) {
  if (!isoString) return '--';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' +
      d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  } catch {
    return isoString;
  }
}

// --- Action Handlers ---

window.viewJobLogs = function(jobId) {
  const job = allJobsList.find(j => j.id === jobId);
  if (!job) return;

  const logs = job.logs || [];
  const logItemsHtml = logs.length > 0
    ? logs.map(l => `<div class="py-1 border-b border-line/40 text-left font-mono text-[10px] sm:text-[11px] text-body flex items-start gap-1.5"><span class="text-accent-600 font-bold shrink-0">›</span><span class="break-words">${escapeHtml(l)}</span></div>`).join('')
    : '<p class="text-xs text-muted py-4">Chưa có nhật ký ghi nhận.</p>';

  Swal.fire({
    ...sweetAlertDefaults,
    title: `Nhật ký Job #${job.id}`,
    html: `
      <div class="claude-account-card mb-3 text-left text-xs">
        <p><strong>Tài khoản:</strong><span>@${escapeHtml(job.cleanUsername || job.username)}</span></p>
        <p><strong>UID Locket:</strong><span class="font-mono text-[11px] select-all">${escapeHtml(job.uid || 'Chưa xác định')}</span></p>
        <p><strong>Trạng thái:</strong><span>${escapeHtml(job.status)} (${job.progress}%)</span></p>
        ${job.error ? `<p><strong>Lỗi:</strong><span class="text-red-600">${escapeHtml(job.error)}</span></p>` : ''}
      </div>
      <div class="max-h-56 sm:max-h-64 overflow-y-auto rounded-xl border border-line bg-canvas/80 p-2.5 sm:p-3">
        ${logItemsHtml}
      </div>
    `,
    confirmButtonText: 'Đóng'
  });
};

window.retryJob = async function(jobId) {
  try {
    const res = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      fetchAdminData();
    } else {
      throw new Error(data.message || 'Không thể thử lại');
    }
  } catch (err) {
    Swal.fire({ ...sweetAlertDefaults, icon: 'error', title: 'Lỗi', text: err.message });
  }
};

window.cancelJob = async function(jobId) {
  try {
    const res = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      fetchAdminData();
    } else {
      throw new Error(data.message || 'Không thể hủy yêu cầu');
    }
  } catch (err) {
    Swal.fire({ ...sweetAlertDefaults, icon: 'error', title: 'Lỗi', text: err.message });
  }
};

window.deleteJob = async function(jobId) {
  const result = await Swal.fire({
    ...sweetAlertDefaults,
    title: 'Xóa bản ghi',
    text: `Bạn có chắc chắn muốn xóa bản ghi Job #${jobId} này không?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Xóa',
    cancelButtonText: 'Hủy'
  });

  if (result.isConfirmed) {
    try {
      const res = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        fetchAdminData();
      } else {
        throw new Error(data.message || 'Không thể xóa bản ghi');
      }
    } catch (err) {
      Swal.fire({ ...sweetAlertDefaults, icon: 'error', title: 'Lỗi', text: err.message });
    }
  }
};

// --- Utilities ---

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  return null;
}
