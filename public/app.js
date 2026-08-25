// Frontend interactions for Locket-Pre

let currentJobId = null;
let pollTimer = null;
let renderedLogCount = 0;
let activeAvatarUrl = null;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const claudeAlertDefaults = {
  background: '#faf9f5',
  color: '#141413',
  confirmButtonColor: '#cc785c',
  confirmButtonText: 'Đã hiểu',
  buttonsStyling: false,
  showClass: {
    popup: 'swal2-show'
  },
  hideClass: {
    popup: 'swal2-hide'
  },
  customClass: {
    popup: 'claude-popup',
    title: 'claude-title',
    htmlContainer: 'claude-html',
    confirmButton: 'claude-confirm'
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  const upgradeForm = document.getElementById('upgradeForm');
  const usernameInput = document.getElementById('usernameInput');
  const lookupBtn = document.getElementById('lookupBtn');
  const resetBtn = document.getElementById('resetBtn');

  upgradeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();

    if (!username) {
      await showClaudeAlert({
        icon: 'warning',
        title: 'Thiếu thông tin',
        text: 'Vui lòng nhập username hoặc liên kết Locket của bạn.',
        didClose: () => usernameInput.focus()
      });
      return;
    }

    const submitBtn = document.getElementById('submitBtn');
    setButtonLoading(submitBtn, true, 'Đang kiểm tra tài khoản...');

    let account = null;
    try {
      const lookupRes = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (lookupRes.ok) {
        const lookupData = await lookupRes.json();
        if (lookupData.success && lookupData.data) {
          account = lookupData.data;
        }
      }
    } catch (e) {
      console.warn('Lookup error:', e);
    } finally {
      setButtonLoading(submitBtn, false);
    }

function extractCleanUsername(input) {
  if (!input) return '';
  let str = String(input).trim();
  if (str.includes('locket.cam/')) {
    const parts = str.split('locket.cam/');
    str = parts[1].split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
  } else if (str.includes('locket.camera/')) {
    const parts = str.split('locket.camera/');
    str = parts[1].split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
  }
  str = str.replace(/^[@/]+/, '').trim();
  if (str.startsWith('invites/')) str = str.replace('invites/', '');
  if (str.startsWith('friend/')) str = str.replace('friend/', '');
  return str.replace(/[^a-zA-Z0-9._-]/g, '');
}

    const displayUser = account ? account.username : extractCleanUsername(username);
    const displayUid = account && account.uid ? account.uid : 'Tự động phân giải...';
    const avatarUrl = account ? sanitizeImageUrl(account.avatarUrl) : null;
    const initials = account && account.initials ? account.initials : (displayUser || 'LK').slice(0, 2).toUpperCase();

    const avatarMarkup = avatarUrl
      ? `<div class="claude-modal-avatar"><img src="${escapeHtml(avatarUrl)}" alt="Avatar của @${escapeHtml(displayUser)}"></div>`
      : `<div class="claude-modal-avatar"><span class="claude-modal-initials">${escapeHtml(initials)}</span></div>`;

    const confirmModal = await Swal.fire({
      ...claudeAlertDefaults,
      title: 'Xác nhận nâng cấp Gold',
      html: `
        ${avatarMarkup}
        <div class="claude-account-card">
          <p><strong>Tài khoản</strong><span class="account-username">@${escapeHtml(displayUser)}</span></p>
          <p><strong>UID</strong><span>${escapeHtml(displayUid)}</span></p>
          <p><strong>Gói áp dụng</strong><span class="text-moss-700 font-semibold">Locket Gold (Anti-Revoke)</span></p>
        </div>
        <p class="mt-3 text-xs text-muted text-center leading-relaxed">
          Bạn có chắc chắn muốn tiến hành kích hoạt Locket Gold cho tài khoản này không?
        </p>
      `,
      showCancelButton: true,
      confirmButtonText: '🚀 Xác nhận & Bắt đầu',
      cancelButtonText: 'Quay lại',
      customClass: {
        ...claudeAlertDefaults.customClass,
        confirmButton: 'claude-confirm !bg-accent-600 hover:!bg-accent-700 font-semibold px-4 py-2.5 rounded-xl text-white',
        cancelButton: 'claude-confirm !bg-surface !text-body hover:!bg-line border border-line ml-2 px-4 py-2.5 rounded-xl'
      },
      didOpen: (popup) => {
        const image = popup.querySelector('.claude-modal-avatar img');
        if (!image) return;
        image.addEventListener('error', () => {
          const container = image.parentElement;
          container.innerHTML = `<span class="claude-modal-initials">${escapeHtml(initials)}</span>`;
        }, { once: true });
      }
    });

    if (!confirmModal.isConfirmed) {
      return;
    }

    await submitToQueue(username);
  });

  lookupBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();

    if (!username) {
      await showClaudeAlert({
        icon: 'info',
        title: 'Tra cứu UID',
        text: 'Hãy nhập username hoặc liên kết Locket để kiểm tra.',
        didClose: () => usernameInput.focus()
      });
      return;
    }

    setLookupLoading(true);

    try {
      const response = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Không thể kiểm tra thông tin tài khoản.');
      }

      await showAccountResult(data.data);
    } catch (error) {
      await showClaudeAlert({
        icon: 'error',
        title: 'Không thể tra cứu',
        text: error.message || 'Không thể kết nối đến máy chủ API.'
      });
    } finally {
      setLookupLoading(false);
    }
  });

  resetBtn.addEventListener('click', async () => {
    stopPolling();
    currentJobId = null;
    resetProcessingState();

    await switchView(
      document.getElementById('processingSection'),
      document.getElementById('formSection')
    );

    usernameInput.value = '';
    usernameInput.focus({ preventScroll: true });
    document.querySelector('.main-card')?.scrollIntoView({
      behavior: prefersReducedMotion.matches ? 'auto' : 'smooth',
      block: 'center'
    });
  });

  const retryBtn = document.getElementById('retryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      retryCurrentJob();
    });
  }

  const failResetBtn = document.getElementById('failResetBtn');
  if (failResetBtn) {
    failResetBtn.addEventListener('click', async () => {
      stopPolling();
      currentJobId = null;
      resetProcessingState();

      await switchView(
        document.getElementById('processingSection'),
        document.getElementById('formSection')
      );

      usernameInput.value = '';
      usernameInput.focus({ preventScroll: true });
      document.querySelector('.main-card')?.scrollIntoView({
        behavior: prefersReducedMotion.matches ? 'auto' : 'smooth',
        block: 'center'
      });
    });
  }

  // Paste Clipboard to Input
  const pasteBtn = document.getElementById('pasteBtn');
  if (pasteBtn && usernameInput) {
    pasteBtn.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          throw new Error('Clipboard API không hỗ trợ');
        }
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          usernameInput.value = text.trim();
          usernameInput.focus();
          
          pasteBtn.innerHTML = `<i data-lucide="check" class="h-3.5 w-3.5 text-moss-700"></i><span>Đã dán</span>`;
          if (window.lucide) lucide.createIcons();
          
          setTimeout(() => {
            pasteBtn.innerHTML = `<i data-lucide="clipboard-paste" class="h-3.5 w-3.5 text-accent-600"></i><span>Dán</span>`;
            if (window.lucide) lucide.createIcons();
          }, 1600);
        } else {
          showClaudeAlert({
            icon: 'info',
            title: 'Bộ nhớ tạm trống',
            text: 'Không tìm thấy nội dung văn bản trong bộ nhớ tạm để dán.'
          });
        }
      } catch (err) {
        usernameInput.focus();
        showClaudeAlert({
          icon: 'info',
          title: 'Dán nội dung',
          text: 'Vui lòng nhấn phím Ctrl + V (hoặc chạm giữ để Dán) vào ô nhập liệu.'
        });
      }
    });
  }
});

function showClaudeAlert(options) {
  return Swal.fire({
    ...claudeAlertDefaults,
    ...options,
    customClass: {
      ...claudeAlertDefaults.customClass,
      ...(options.customClass || {})
    }
  });
}

async function showAccountResult(account) {
  const username = escapeHtml(account.username || 'Không xác định');
  const uid = escapeHtml(account.uid || 'Không xác định');
  const initials = escapeHtml(account.initials || username.slice(0, 2).toUpperCase());
  const avatarUrl = sanitizeImageUrl(account.avatarUrl);

  const avatarMarkup = avatarUrl
    ? `<div class="claude-modal-avatar"><img src="${escapeHtml(avatarUrl)}" alt="Avatar của @${username}"></div>`
    : `<div class="claude-modal-avatar"><span class="claude-modal-initials">${initials}</span></div>`;

  await showClaudeAlert({
    title: 'Tìm thấy tài khoản',
    html: `
      ${avatarMarkup}
      <div class="claude-account-card">
        <p><strong>Username</strong><span class="account-username">@${username}</span></p>
        <p><strong>UID</strong><span>${uid}</span></p>
        ${account.isSimulated ? '<span class="claude-sandbox-note">Dữ liệu UID đang ở chế độ mô phỏng sandbox.</span>' : ''}
      </div>
    `,
    confirmButtonText: 'Tiếp tục',
    didOpen: (popup) => {
      const image = popup.querySelector('.claude-modal-avatar img');
      if (!image) return;

      image.addEventListener('error', () => {
        const container = image.parentElement;
        container.innerHTML = `<span class="claude-modal-initials">${initials}</span>`;
      }, { once: true });
    }
  });
}

let isQueueModalOpen = false;
let lastRenderedPos = null;
let currentSubmittedUser = '';

// --- Queue Modal Functions ---

function openQueueModal(position, estimatedSeconds, username) {
  const modal = document.getElementById('queueModal');
  const card = document.getElementById('queueModalCard');
  const posEl = document.getElementById('queueModalPos');
  const estEl = document.getElementById('queueModalEstimate');
  const listEl = document.getElementById('queueModalList');
  const countEl = document.getElementById('queueModalAheadCount');

  if (!modal || !card) return;

  isQueueModalOpen = true;
  lastRenderedPos = position;

  posEl.textContent = `#${position || 1}`;
  estEl.textContent = `~${estimatedSeconds || 10}s`;
  countEl.textContent = `${Math.max(0, (position || 1) - 1)} người`;

  // Initial list showing current user
  listEl.innerHTML = `
    <div class="flex items-center justify-between p-2.5 rounded-xl bg-white border border-moss-300 shadow-xs">
      <div class="flex items-center gap-2 min-w-0">
        <span class="h-6 w-6 rounded-full bg-moss-700 text-white font-bold text-[10px] flex items-center justify-center">Bạn</span>
        <span class="font-semibold text-moss-700 truncate">@${escapeHtml(normalizeDisplayUsername(username))}</span>
      </div>
      <span class="text-[10px] font-bold text-moss-700 bg-moss-100 px-2.5 py-0.5 rounded-full shrink-0">
        Vị trí #${position || 1}
      </span>
    </div>
  `;

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    modal.classList.remove('opacity-0');
    card.classList.remove('opacity-0', 'scale-95');
    card.classList.add('opacity-100', 'scale-100');
  });

  const closeBtn = document.getElementById('queueModalCloseBtn');
  if (closeBtn) {
    closeBtn.onclick = () => closeQueueModal();
  }

  if (window.lucide) lucide.createIcons();
}

function updateQueueModal(job, username) {
  if (!isQueueModalOpen) return;

  const posEl = document.getElementById('queueModalPos');
  const estEl = document.getElementById('queueModalEstimate');
  const listEl = document.getElementById('queueModalList');
  const countEl = document.getElementById('queueModalAheadCount');

  if (!posEl || !listEl) return;

  const currentPos = job.queuePosition || 1;

  // Trigger bounce animation if position decreased
  if (lastRenderedPos !== null && currentPos < lastRenderedPos) {
    posEl.classList.remove('queue-num-pop');
    void posEl.offsetWidth; // trigger reflow
    posEl.classList.add('queue-num-pop');
  }
  lastRenderedPos = currentPos;

  posEl.textContent = `#${currentPos}`;
  estEl.textContent = `~${job.estimatedWaitSeconds || 6}s`;

  const ahead = job.queueAhead || [];
  countEl.textContent = `${ahead.length} người`;

  let html = '';
  ahead.forEach((item, idx) => {
    const isRunning = item.isCurrentlyRunning || item.status === 'processing';
    const initial = escapeHtml(item.initials || 'LK');
    const avatarHtml = item.avatarUrl
      ? `<img src="${escapeHtml(item.avatarUrl)}" class="h-7 w-7 rounded-full object-cover border border-accent-300 shrink-0 shadow-xs">`
      : `<span class="h-7 w-7 rounded-full bg-accent-100 text-accent-700 font-bold text-[10px] flex items-center justify-center shrink-0 border border-accent-200">${initial}</span>`;

    if (isRunning) {
      html += `
        <div class="queue-item-card queue-active-shimmer flex items-center justify-between p-2.5 rounded-2xl bg-white border border-accent-300 shadow-xs">
          <div class="flex items-center gap-2.5 min-w-0">
            ${avatarHtml}
            <div class="min-w-0">
              <span class="font-semibold text-ink text-xs truncate block">@${escapeHtml(item.maskedUsername)}</span>
              <span class="text-[10px] text-accent-700 font-mono flex items-center gap-1">
                <span class="h-1.5 w-1.5 rounded-full bg-accent-600 animate-ping"></span>
                <span>Đang nạp Gold...</span>
              </span>
            </div>
          </div>
          <span class="text-[10px] font-bold text-accent-700 bg-accent-100/90 px-2.5 py-1 rounded-full shrink-0 border border-accent-200/80">
            Active
          </span>
        </div>`;
    } else {
      html += `
        <div class="queue-item-card flex items-center justify-between p-2.5 rounded-2xl bg-white border border-line shadow-xs">
          <div class="flex items-center gap-2.5 min-w-0">
            ${avatarHtml}
            <div class="min-w-0">
              <span class="font-semibold text-ink text-xs truncate block">@${escapeHtml(item.maskedUsername)}</span>
              <span class="text-[10px] text-muted font-mono">Đang xếp hàng</span>
            </div>
          </div>
          <span class="text-[10px] text-muted font-mono font-semibold bg-surface px-2.5 py-0.5 rounded-full shrink-0 border border-line">
            Chờ #${item.position || (idx + 1)}
          </span>
        </div>`;
    }
  });

  // Current user item at bottom (High-tech highlight)
  html += `
    <div class="queue-item-card flex items-center justify-between p-2.5 rounded-2xl bg-white border-2 border-moss-500 shadow-sm">
      <div class="flex items-center gap-2.5 min-w-0">
        <span class="h-7 w-7 rounded-full bg-moss-700 text-white font-bold text-[10px] flex items-center justify-center shrink-0 shadow-xs">Bạn</span>
        <div class="min-w-0">
          <span class="font-bold text-moss-700 text-xs truncate block">@${escapeHtml(normalizeDisplayUsername(username))}</span>
          <span class="text-[10px] text-moss-700 font-medium">Tài khoản của bạn</span>
        </div>
      </div>
      <span class="text-[10px] font-extrabold text-moss-700 bg-moss-50 px-3 py-1 rounded-full shrink-0 border border-moss-300 flex items-center gap-1">
        <span class="h-1.5 w-1.5 rounded-full bg-moss-500 animate-pulse"></span>
        <span>Vị trí #${currentPos}</span>
      </span>
    </div>`;

  listEl.innerHTML = html;
}

function showQueueModalTurnArrived() {
  const ring = document.getElementById('queueHudRing');
  const posEl = document.getElementById('queueModalPos');
  const estEl = document.getElementById('queueModalEstimate');
  if (ring) ring.classList.add('is-turn');
  if (estEl) estEl.textContent = '0s';
  if (posEl) {
    posEl.innerHTML = `
      <div class="flex flex-col items-center justify-center scale-110 transition-transform">
        <span class="text-2xl sm:text-3xl leading-none">🚀</span>
        <span class="text-[9px] font-black tracking-wider text-moss-700 uppercase mt-0.5">ĐẾN LƯỢT</span>
      </div>
    `;
  }
}

function closeQueueModal() {
  const modal = document.getElementById('queueModal');
  const card = document.getElementById('queueModalCard');
  const ring = document.getElementById('queueHudRing');
  if (!modal || !card) return;

  card.classList.remove('opacity-100', 'scale-100');
  card.classList.add('opacity-0', 'scale-95');

  setTimeout(() => {
    modal.classList.add('hidden');
    if (ring) ring.classList.remove('is-turn');
    isQueueModalOpen = false;
  }, 250);
}

// --- Queue Submission & Polling ---

async function submitToQueue(username) {
  const submitBtn = document.getElementById('submitBtn');
  setButtonLoading(submitBtn, true, 'Đang gửi yêu cầu...');

  try {
    const response = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await response.json();

    if (!response.ok || !data.success || !data.jobId) {
      throw new Error(data.message || 'Không thể đưa yêu cầu vào hàng đợi.');
    }

    currentJobId = data.jobId;
    currentSubmittedUser = username;

    // Open Real-time Queue Modal
    openQueueModal(data.position || 1, data.estimatedWaitSeconds || 10, username);

    // Prepare processing state in background
    resetProcessingState();
    document.getElementById('procUsername').textContent = `@${normalizeDisplayUsername(username)}`;
    document.getElementById('procJobId').textContent = data.jobId;
    document.getElementById('queuePos').textContent = `#${data.position || 1}`;

    startPolling(data.jobId, username);
  } catch (error) {
    await showClaudeAlert({
      icon: 'error',
      title: 'Không thể gửi yêu cầu',
      text: error.message || 'Không thể kết nối với Backend API.'
    });
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

async function showProcessingView(username, jobId, position) {
  resetProcessingState();

  document.getElementById('procUsername').textContent = `@${normalizeDisplayUsername(username)}`;
  document.getElementById('procJobId').textContent = jobId;
  document.getElementById('queuePos').textContent = `#${position || 1}`;
  updateProgress(10, 'Đã kết nối máy chủ, đang đợi đến lượt...');
  appendLog(`Yêu cầu ${jobId} đã được gửi thành công.`, true);

  await switchView(
    document.getElementById('formSection'),
    document.getElementById('processingSection')
  );

  document.querySelector('.main-card')?.scrollIntoView({
    behavior: prefersReducedMotion.matches ? 'auto' : 'smooth',
    block: 'center'
  });
}

function startPolling(jobId, username = '') {
  stopPolling();

  const user = username || currentSubmittedUser;

  const poll = async () => {
    if (currentJobId !== jobId) return;

    try {
      const response = await fetch(`/api/status/${encodeURIComponent(jobId)}`);
      const data = await response.json();

      if (!response.ok || !data.success || !data.job) {
        throw new Error(data.message || 'Không thể đọc trạng thái yêu cầu.');
      }

      const job = data.job;

      // Real-time Queue Modal Update
      if (job.status === 'queued' && job.queuePosition > 0) {
        updateQueueModal(job, user);
        document.getElementById('queuePos').textContent = `#${job.queuePosition}`;
      }

      // If processing started (turn arrived)
      if (job.status === 'processing') {
        if (isQueueModalOpen) {
          showQueueModalTurnArrived();
          await wait(600);
          closeQueueModal();
        }

        const formSection = document.getElementById('formSection');
        const processingSection = document.getElementById('processingSection');
        if (!formSection.classList.contains('hidden')) {
          await switchView(formSection, processingSection);
          document.querySelector('.main-card')?.scrollIntoView({
            behavior: prefersReducedMotion.matches ? 'auto' : 'smooth',
            block: 'center'
          });
        }

        updateAvatar(job);
        updateQueueBadge(job);
        renderLogs(job.logs || []);
        updateProgress(job.progress || 15, getStatusLabel(job.status));
      }

      if (job.status === 'completed') {
        closeQueueModal();
        const formSection = document.getElementById('formSection');
        const processingSection = document.getElementById('processingSection');
        if (!formSection.classList.contains('hidden')) {
          await switchView(formSection, processingSection);
        }
        completeJob(job);
        return;
      }

      if (job.status === 'failed') {
        stopPolling();
        closeQueueModal();
        showFailedJob(job);
        return;
      }
    } catch (error) {
      console.warn('Lỗi kiểm tra tiến trình:', error);
    }

    if (currentJobId === jobId) {
      pollTimer = window.setTimeout(poll, 1000);
    }
  };

  poll();
}

async function showFailedJob(job) {
  stopPolling();
  closeQueueModal();

  const formSection = document.getElementById('formSection');
  const processingSection = document.getElementById('processingSection');
  if (formSection && !formSection.classList.contains('hidden')) {
    await switchView(formSection, processingSection);
  }

  const failedActions = document.getElementById('failedActions');
  const completedActions = document.getElementById('completedActions');
  const failedReasonText = document.getElementById('failedReasonText');
  const progressBar = document.getElementById('progressBar');

  if (completedActions) completedActions.classList.add('hidden');
  if (failedActions) {
    failedActions.classList.remove('hidden');
  }
  if (failedReasonText) {
    failedReasonText.textContent = job.error || 'Máy chủ Locket / Gateway đám mây tạm thời gián đoạn kết nối do quá tải. Vui lòng bấm Thử lại.';
  }

  if (progressBar) {
    progressBar.classList.remove('is-active');
  }
  updateProgress(job.progress || 35, 'Kích hoạt gián đoạn');

  if (window.lucide) lucide.createIcons();

  // Show SweetAlert2 popup with instant retry
  const result = await Swal.fire({
    ...claudeAlertDefaults,
    icon: 'warning',
    title: 'Kết nối bị gián đoạn',
    text: job.error || 'Máy chủ Locket / Gateway đám mây tạm thời gián đoạn kết nối do quá tải. Bạn có muốn thử lại ngay không?',
    showCancelButton: true,
    confirmButtonText: '🔄 Thử lại ngay',
    cancelButtonText: 'Đóng',
    customClass: {
      ...claudeAlertDefaults.customClass,
      confirmButton: 'claude-confirm !bg-accent-600 hover:!bg-accent-700 font-semibold px-4 py-2.5 rounded-xl text-white',
      cancelButton: 'claude-confirm !bg-surface !text-body hover:!bg-line border border-line ml-2 px-4 py-2.5 rounded-xl'
    }
  });

  if (result.isConfirmed) {
    retryCurrentJob();
  }
}

function retryCurrentJob() {
  if (currentSubmittedUser) {
    submitToQueue(currentSubmittedUser);
  } else {
    const input = document.getElementById('usernameInput');
    if (input && input.value.trim()) {
      submitToQueue(input.value.trim());
    }
  }
}

function stopPolling() {
  if (pollTimer) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function updateAvatar(job) {
  const avatarContainer = document.getElementById('procAvatarContainer');
  const avatarImage = document.getElementById('procAvatarImg');
  const avatarInitials = document.getElementById('procAvatarInitials');
  const avatarSpinner = document.getElementById('procAvatarSpinner');
  const avatarUrl = sanitizeImageUrl(job.avatarUrl);

  if (avatarUrl && activeAvatarUrl !== avatarUrl) {
    activeAvatarUrl = avatarUrl;
    avatarImage.src = avatarUrl;
    avatarImage.classList.remove('hidden');
    avatarInitials.classList.add('hidden');
    avatarSpinner.classList.add('hidden');
    avatarContainer.classList.remove('has-avatar');
    requestAnimationFrame(() => avatarContainer.classList.add('has-avatar'));

    avatarImage.onerror = () => {
      avatarImage.classList.add('hidden');
      showAvatarInitials(job.initials || '--');
    };
    return;
  }

  if (!avatarUrl && job.initials) {
    showAvatarInitials(job.initials);
  }
}

function showAvatarInitials(initials) {
  const avatarContainer = document.getElementById('procAvatarContainer');
  const avatarImage = document.getElementById('procAvatarImg');
  const avatarInitials = document.getElementById('procAvatarInitials');
  const avatarSpinner = document.getElementById('procAvatarSpinner');

  avatarImage.classList.add('hidden');
  avatarSpinner.classList.add('hidden');
  avatarInitials.textContent = String(initials).slice(0, 2).toUpperCase();
  avatarInitials.classList.remove('hidden');
  avatarContainer.classList.add('has-avatar');
}

function updateQueueBadge(job) {
  const queuePosition = document.getElementById('queuePos');

  if (job.status === 'queued') {
    queuePosition.textContent = `#${job.queuePosition || 1}`;
  } else if (job.status === 'processing') {
    queuePosition.textContent = 'Đang chạy';
  } else if (job.status === 'completed') {
    queuePosition.textContent = 'Hoàn tất';
  }
}

function renderLogs(logs) {
  const logContainer = document.getElementById('logContainer');

  if (logs.length < renderedLogCount) {
    logContainer.replaceChildren();
    renderedLogCount = 0;
  }

  logs.slice(renderedLogCount).forEach((message) => appendLog(message, true));
  renderedLogCount = logs.length;
}

function appendLog(message, animate = false) {
  const logContainer = document.getElementById('logContainer');
  const item = document.createElement('div');
  const marker = document.createElement('span');
  const text = document.createElement('span');

  item.className = `log-item${animate ? ' is-new' : ''}`;
  marker.className = 'log-marker';
  marker.textContent = '›';
  text.textContent = message;
  item.append(marker, text);
  logContainer.appendChild(item);
  logContainer.scrollTo({
    top: logContainer.scrollHeight,
    behavior: prefersReducedMotion.matches ? 'auto' : 'smooth'
  });
}

function completeJob(job) {
  stopPolling();
  updateQueueBadge({ status: 'completed' });
  updateProgress(100, 'Yêu cầu đã hoàn tất.');
  document.getElementById('progressBar').classList.remove('is-active');

  // Update DNS links
  if (job && job.dns) {
    const iosDnsLink = document.getElementById('iosDnsLink');
    if (iosDnsLink && job.dns.iosLink) {
      iosDnsLink.href = job.dns.iosLink;
    }
    const androidDnsText = document.getElementById('androidDnsText');
    if (androidDnsText && job.dns.androidDns) {
      androidDnsText.textContent = job.dns.androidDns;
    }
  }

  const completedActions = document.getElementById('completedActions');
  const successPanel = completedActions.querySelector('.success-panel');
  completedActions.classList.remove('hidden');
  successPanel.classList.remove('is-visible');
  requestAnimationFrame(() => successPanel.classList.add('is-visible'));

  if (window.lucide) {
    lucide.createIcons();
  }
}

function updateProgress(percent, label) {
  const normalizedPercent = Math.min(100, Math.max(0, Number(percent) || 0));
  const progressBar = document.getElementById('progressBar');
  const progressTrack = progressBar.parentElement;

  progressBar.style.width = `${normalizedPercent}%`;
  document.getElementById('procPercent').textContent = `${normalizedPercent}%`;
  document.getElementById('procStatusText').textContent = label || 'Đang thực hiện...';
  progressTrack.setAttribute('aria-valuenow', String(normalizedPercent));
}

function resetProcessingState() {
  renderedLogCount = 0;
  activeAvatarUrl = null;

  const completedActions = document.getElementById('completedActions');
  const failedActions = document.getElementById('failedActions');
  const progressBar = document.getElementById('progressBar');
  const avatarContainer = document.getElementById('procAvatarContainer');
  const avatarImage = document.getElementById('procAvatarImg');
  const avatarInitials = document.getElementById('procAvatarInitials');
  const avatarSpinner = document.getElementById('procAvatarSpinner');

  if (completedActions) completedActions.classList.add('hidden');
  if (failedActions) failedActions.classList.add('hidden');
  completedActions?.querySelector('.success-panel')?.classList.remove('is-visible');
  progressBar.classList.add('is-active');
  updateProgress(10, 'Đang khởi chạy tiến trình...');

  avatarContainer.classList.remove('has-avatar');
  avatarImage.classList.add('hidden');
  avatarImage.removeAttribute('src');
  avatarImage.onerror = null;
  avatarInitials.classList.add('hidden');
  avatarInitials.textContent = '--';
  avatarSpinner.classList.remove('hidden');

  document.getElementById('logContainer').replaceChildren();
  document.getElementById('queuePos').textContent = '#1';
}

async function switchView(outgoingView, incomingView) {
  if (outgoingView === incomingView) return;

  if (prefersReducedMotion.matches || outgoingView.classList.contains('hidden')) {
    outgoingView.classList.add('hidden');
    outgoingView.classList.remove('view-exit', 'view-enter');
    incomingView.classList.remove('hidden', 'view-exit');
    incomingView.classList.add('view-enter');
    return;
  }

  outgoingView.classList.remove('view-enter');
  outgoingView.classList.add('view-exit');
  await wait(180);
  outgoingView.classList.add('hidden');
  outgoingView.classList.remove('view-exit');

  incomingView.classList.remove('hidden', 'view-exit');
  incomingView.classList.remove('view-enter');
  void incomingView.offsetWidth;
  incomingView.classList.add('view-enter');
}

function setLookupLoading(isLoading) {
  const button = document.getElementById('lookupBtn');
  button.disabled = isLoading;
  button.setAttribute('aria-busy', String(isLoading));
  button.innerHTML = isLoading
    ? '<i data-lucide="loader-circle" class="h-[18px] w-[18px] animate-spin" aria-hidden="true"></i><span>Đang tra cứu...</span>'
    : '<i data-lucide="scan-search" class="h-[18px] w-[18px]" aria-hidden="true"></i><span>Kiểm tra UID</span>';

  if (window.lucide) lucide.createIcons();
}

function setButtonLoading(button, isLoading, loadingLabel = 'Đang xử lý...') {
  if (!button.dataset.defaultContent) {
    button.dataset.defaultContent = button.innerHTML;
  }

  button.disabled = isLoading;
  button.setAttribute('aria-busy', String(isLoading));
  button.innerHTML = isLoading
    ? `<i data-lucide="loader-circle" class="h-[18px] w-[18px] animate-spin" aria-hidden="true"></i><span>${escapeHtml(loadingLabel)}</span>`
    : button.dataset.defaultContent;

  if (window.lucide) lucide.createIcons();
}

function getStatusLabel(status) {
  switch (status) {
    case 'queued': return 'Đang xếp hàng chờ xử lý...';
    case 'processing': return 'Đang xử lý dữ liệu tài khoản...';
    case 'completed': return 'Yêu cầu đã hoàn tất.';
    case 'failed': return 'Đã xảy ra lỗi.';
    default: return 'Đang thực hiện...';
  }
}

function normalizeDisplayUsername(value) {
  const input = String(value || '').trim().replace(/^@/, '');
  const marker = 'locket.cam/';
  const markerIndex = input.toLowerCase().indexOf(marker);

  if (markerIndex >= 0) {
    return input.slice(markerIndex + marker.length).split(/[/?#]/)[0] || input;
  }

  return input;
}

function sanitizeImageUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}
