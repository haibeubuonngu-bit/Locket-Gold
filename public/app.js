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
    await showProcessingView(username, data.jobId, data.position);
    startPolling(data.jobId);
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

function startPolling(jobId) {
  stopPolling();

  const poll = async () => {
    if (currentJobId !== jobId) return;

    try {
      const response = await fetch(`/api/status/${encodeURIComponent(jobId)}`);
      const data = await response.json();

      if (!response.ok || !data.success || !data.job) {
        throw new Error(data.message || 'Không thể đọc trạng thái yêu cầu.');
      }

      const job = data.job;
      updateAvatar(job);
      updateQueueBadge(job);
      renderLogs(job.logs || []);
      updateProgress(job.progress || 0, getStatusLabel(job.status));

      if (job.status === 'completed') {
        completeJob(job);
        return;
      }

      if (job.status === 'failed') {
        stopPolling();
        await showClaudeAlert({
          icon: 'error',
          title: 'Xử lý thất bại',
          text: job.error || 'Có lỗi xảy ra trong quá trình xử lý.'
        });
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
  const progressBar = document.getElementById('progressBar');
  const avatarContainer = document.getElementById('procAvatarContainer');
  const avatarImage = document.getElementById('procAvatarImg');
  const avatarInitials = document.getElementById('procAvatarInitials');
  const avatarSpinner = document.getElementById('procAvatarSpinner');

  completedActions.classList.add('hidden');
  completedActions.querySelector('.success-panel')?.classList.remove('is-visible');
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
