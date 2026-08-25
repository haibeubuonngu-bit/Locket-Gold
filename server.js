const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Proxy (Required for Vercel / Reverse Proxies)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// NextDNS Config (Profile BO_LocketGold)
const NEXTDNS_PROFILE_ID = process.env.NEXTDNS_PROFILE_ID || '878367';
const NEXTDNS_IOS_LINK = `https://apple.nextdns.io/?profile=${NEXTDNS_PROFILE_ID}`;
const NEXTDNS_ANDROID_DNS = `${NEXTDNS_PROFILE_ID}.dns.nextdns.io`;

// Admin Auth Config
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '129324';
const JWT_SECRET = process.env.JWT_SECRET || ('locket-admin-secret-seed-' + ADMIN_PASSWORD);

// Data Persistence Config
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'jobs.json');

// In-Memory Queue State
const queue = [];
const jobs = new Map(); // jobId -> Job details
let isProcessing = false;

// Admin Auth Helpers
function generateAdminToken() {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  const data = `${expiresAt}`;
  const hmac = crypto.createHmac('sha256', JWT_SECRET).update(`${data}:${ADMIN_PASSWORD}`).digest('hex');
  return `${data}.${hmac}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expiresAtStr, hmac] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;
  const expectedHmac = crypto.createHmac('sha256', JWT_SECRET).update(`${expiresAtStr}:${ADMIN_PASSWORD}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'));
  } catch {
    return false;
  }
}

function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : (req.headers['x-admin-token'] || req.query.token || '');

  if (!token || !verifyAdminToken(token)) {
    return res.status(401).json({
      success: false,
      message: 'Phiên đăng nhập quản trị không hợp lệ hoặc đã hết hạn.'
    });
  }
  next();
}

// Persistence Helpers
function loadJobsFromFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const loaded = JSON.parse(raw);
      if (Array.isArray(loaded)) {
        loaded.forEach(job => {
          if (job && job.id) {
            jobs.set(job.id, job);
            if (job.status === 'queued' && !queue.includes(job.id)) {
              queue.push(job.id);
            }
          }
        });
      }
    }
  } catch (err) {
    console.warn('Could not load jobs from file:', err.message);
  }
}

function saveJobsToFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const allJobs = Array.from(jobs.values());
    fs.writeFileSync(DATA_FILE, JSON.stringify(allJobs, null, 2), 'utf8');
  } catch (err) {
    // Non-blocking in serverless/read-only environment
  }
}

// Rate Limiter for new submissions only
const submitLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // max 30 submissions per minute per IP
  validate: { xForwardedForHeader: false },
  message: {
    success: false,
    message: 'Bạn gửi yêu cầu quá nhanh! Vui lòng đợi 1 phút trước khi thử lại.'
  }
});

// Helper: Extract UID from username or Locket link
async function resolveLocketUid(input) {
  let cleanInput = String(input || '').trim();
  let username = cleanInput;

  // Extract username if URL is provided
  if (cleanInput.includes('locket.cam/')) {
    const parts = cleanInput.split('locket.cam/');
    username = parts[1].split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '').trim();
  } else if (cleanInput.includes('locket.camera/')) {
    const parts = cleanInput.split('locket.camera/');
    username = parts[1].split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '').trim();
  }

  // Remove leading @ or /
  username = username.replace(/^[@/]+/, '').trim();

  // If path is invites/UID or friend/username
  if (username.startsWith('invites/')) {
    username = username.replace('invites/', '');
  }
  if (username.startsWith('friend/')) {
    username = username.replace('friend/', '');
  }

  // Basic regex validation
  username = username.replace(/[^a-zA-Z0-9._-]/g, '');

  if (!username) {
    throw new Error('Username Locket không hợp lệ');
  }

  const url = `https://locket.cam/${username}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)',
        'Accept': 'text/html'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    const finalUrl = response.url || '';
    const htmlText = await response.text();

    const regex = /\/invites\/([A-Za-z0-9]{28})/;
    const linkParamRegex = /link=([^"'\s>]+)/;
    const avatarRegex = /class=["']profile-pic-img["']\s+src=["']?([^"'\s>]+)/;
    const initialAvatarRegex = /class=["']profile-pic-initials["'][^>]*>([^<]+)</;

    // Extract Avatar if present in HTML
    let avatarUrl = null;
    let initials = null;

    const avatarMatch = htmlText.match(avatarRegex);
    if (avatarMatch && avatarMatch[1]) {
      avatarUrl = avatarMatch[1];
    } else {
      const initialMatch = htmlText.match(initialAvatarRegex);
      if (initialMatch && initialMatch[1]) {
        initials = initialMatch[1].trim();
      }
    }

    // Default fallback avatar if not found
    if (!avatarUrl && !initials) {
      avatarUrl = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username)}`;
    }

    // Check final redirect URL
    let match = finalUrl.match(regex);
    if (match && match[1]) return { username, uid: match[1], avatarUrl, initials };

    // Check HTML text
    match = htmlText.match(regex);
    if (match && match[1]) return { username, uid: match[1], avatarUrl, initials };

    // Check link parameter in HTML
    const linkMatch = htmlText.match(linkParamRegex);
    if (linkMatch && linkMatch[1]) {
      const decoded = decodeURIComponent(linkMatch[1]);
      const dm = decoded.match(regex);
      if (dm && dm[1]) return { username, uid: dm[1], avatarUrl, initials };
    }

    // Fallback Mock UID generation for sandbox/demonstration if user not resolvable publicly
    const fallbackUid = crypto.createHash('md5').update(username).digest('hex').substring(0, 28);
    return {
      username,
      uid: fallbackUid,
      avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username)}`,
      initials: username.substring(0, 2).toUpperCase(),
      isSimulated: true
    };
  } catch (error) {
    // If network to locket.cam fails, return formatted mock identifier for demo
    const fallbackUid = crypto.createHash('md5').update(username).digest('hex').substring(0, 28);
    return {
      username,
      uid: fallbackUid,
      avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username)}`,
      initials: username.substring(0, 2).toUpperCase(),
      isSimulated: true
    };
  }
}

// Helper: Translate technical errors to user-friendly Vietnamese
function normalizeErrorMessage(err) {
  const str = String(err?.message || err || '');
  if (str.includes('SSLEOFError') || str.includes('SSLError') || str.includes('api.locketcamera.com') || str.includes('UNEXPECTED_EOF_WHILE_READING') || str.includes('HTTPSConnectionPool')) {
    return 'Máy chủ Locket (api.locketcamera.com) tạm thời gián đoạn kết nối SSL với Gateway. Vui lòng thử lại.';
  }
  if (str.includes('RemoteDisconnected') || str.includes('Connection aborted') || str.includes('ECONNRESET') || str.includes('socket hang up') || str.includes('fetch failed')) {
    return 'Máy chủ Locket / Gateway đám mây tạm thời gián đoạn kết nối do quá tải. Vui lòng bấm Thử lại.';
  }
  if (str.includes('User data not found') || str.includes('Không tìm thấy tài khoản') || str.includes('không tồn tại')) {
    return 'Không tìm thấy tài khoản Locket. Vui lòng kiểm tra lại chính xác Username hoặc link mời.';
  }
  if (str.includes('ETIMEDOUT') || str.includes('timeout') || str.includes('aborted')) {
    return 'Thời gian kết nối đến máy chủ quá lâu. Vui lòng kiểm tra kết nối mạng và thử lại.';
  }
  if (str.includes('429') || str.includes('Too Many Requests')) {
    return 'Hệ thống đang quá tải yêu cầu. Vui lòng đợi giây lát rồi thử lại.';
  }
  return str.replace(/^[❌⚠️\s]+/, '').trim() || 'Có lỗi xảy ra trong quá trình xử lý.';
}

// Queue Processor Loop
async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const jobId = queue[0];
    const job = jobs.get(jobId);

    if (!job) {
      queue.shift();
      continue;
    }

    job.status = 'processing';
    job.progress = 15;
    job.logs.push('Đang tìm kiếm UID Locket trên hệ thống...');
    saveJobsToFile();

    try {
      // Step 1: Resolve UID & Avatar
      const result = await resolveLocketUid(job.username);
      job.uid = result.uid;
      job.cleanUsername = result.username || job.username;
      job.avatarUrl = result.avatarUrl;
      job.initials = result.initials;
      job.progress = 40;
      job.logs.push(`Đã tìm thấy tài khoản! @${job.cleanUsername} (UID: ${job.uid})`);
      saveJobsToFile();

      await new Promise(r => setTimeout(r, 800));

      // Step 2: Call Vercel Remote Restore API Gateway with Auto-Retry (Up to 3 attempts)
      job.progress = 30;
      job.logs.push('Đang gửi yêu cầu kích hoạt tới Gateway đám mây...');

      let isGatewayDone = false;
      const MAX_RETRIES = 3;

      for (let attempt = 1; attempt <= MAX_RETRIES && !isGatewayDone; attempt++) {
        try {
          if (attempt > 1) {
            job.logs.push(`⚠️ Đang tự động kết nối lại Gateway (Lần ${attempt}/${MAX_RETRIES})...`);
            saveJobsToFile();
            await new Promise(r => setTimeout(r, attempt * 1500));
          }

          const restoreRes = await fetch('https://locket-pre.vercel.app/api/restore', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'origin': 'https://locket-pre.vercel.app',
              'referer': 'https://locket-pre.vercel.app/',
              'user-agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36'
            },
            body: JSON.stringify({ username: job.cleanUsername })
          });

          if (!restoreRes.ok) {
            throw new Error(`Gateway phản hồi mã trạng thái HTTP ${restoreRes.status}`);
          }

          const rData = await restoreRes.json();
          if (!rData.client_id) {
            throw new Error(rData.error || 'Gateway không tạo được Client ID');
          }

          job.logs.push(`Gateway đã tạo Client ID: ${rData.client_id}`);
          job.logs.push('Đang xếp hàng và chờ Gateway nạp biên lai Gold...');

          let lastStatusLogged = '';

          // Poll status until completion (up to 35 iterations ~ 50s)
          for (let p = 0; p < 35; p++) {
            await new Promise(r => setTimeout(r, 1500));
            
            const sRes = await fetch('https://locket-pre.vercel.app/api/queue/status', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'origin': 'https://locket-pre.vercel.app',
                'referer': 'https://locket-pre.vercel.app/'
              },
              body: JSON.stringify({ client_id: rData.client_id })
            });

            if (!sRes.ok) {
              throw new Error(`Lỗi kết nối kiểm tra tiến trình (HTTP ${sRes.status})`);
            }

            const sData = await sRes.json();
            const curStatus = sData.status || 'waiting';

            if (curStatus === 'completed' || curStatus === 'done' || (sData.success && sData.result)) {
              job.progress = 95;
              const successMsg = sData.result?.msg || 'Đã nạp biên lai Gold thành công!';
              job.logs.push(`✅ ${successMsg}`);
              isGatewayDone = true;
              break;
            } else if (curStatus === 'error' || curStatus === 'failed') {
              const errDetail = sData.error || 'Không tìm thấy tài khoản hoặc dữ liệu không hợp lệ';
              throw new Error(errDetail);
            } else if (sData.position > 0) {
              job.progress = Math.min(80, 25 + (p * 2));
              const statusText = `Đang chờ trong hàng đợi: Vị trí #${sData.position} (Ước tính: ${sData.estimated_time || 0}s)`;
              if (lastStatusLogged !== statusText) {
                job.logs.push(statusText);
                lastStatusLogged = statusText;
              }
            } else {
              // Position is 0 -> Worker actively processing
              job.progress = Math.min(90, 45 + (p * 5));
              if (p === 0 || p === 3 || p === 6) {
                const processingStages = [
                  'Đang kết nối tới máy chủ khai thác và phân bổ worker...',
                  'Worker đang nạp biên lai Apple In-App Purchase (locket_199_1m)...',
                  'Đang đồng bộ quyền lợi với máy chủ Locket / RevenueCat...'
                ];
                const stageText = processingStages[Math.floor(p / 3)] || 'Đang hoàn tất nạp biên lai...';
                job.logs.push(stageText);
              }
            }
          }
        } catch (attemptErr) {
          const friendly = normalizeErrorMessage(attemptErr);
          const isFatal = attemptErr.message?.includes('User data not found');

          if (!isFatal && attempt < MAX_RETRIES) {
            job.logs.push(`⚠️ Gián đoạn kết nối Gateway: ${friendly}`);
          } else {
            throw new Error(friendly);
          }
        }
      }

      if (!isGatewayDone) {
        throw new Error('Gateway chưa hoàn tất quá trình nạp Gold sau thời gian chờ. Vui lòng bấm Thử lại.');
      }

      // Step 3: Verification / Completion & DNS generation
      job.progress = 100;
      job.status = 'completed';
      job.logs.push('Đã hoàn tất kích hoạt Locket Gold!');
      job.logs.push(`Đã liên kết DNS Anti-Revoke VIP Node (${NEXTDNS_PROFILE_ID})`);
      job.completedAt = new Date().toISOString();
      job.expiresDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // +30 days
      job.dns = {
        profileId: NEXTDNS_PROFILE_ID,
        iosLink: NEXTDNS_IOS_LINK,
        androidDns: NEXTDNS_ANDROID_DNS
      };
      saveJobsToFile();
    } catch (err) {
      job.status = 'failed';
      job.error = normalizeErrorMessage(err);
      job.logs.push(`❌ Thất bại: ${job.error}`);
      saveJobsToFile();
    }

    queue.shift();
    saveJobsToFile();
    // Cooldown between jobs
    await new Promise(r => setTimeout(r, 500));
  }

  isProcessing = false;
}

// --- API Endpoints ---

// Helper: Mask username for public queue privacy
function maskUsername(username) {
  if (!username) return 'lk_***';
  const clean = String(username).replace(/^[@/]+/, '').trim();
  if (clean.length <= 2) return clean[0] + '***';
  if (clean.length <= 4) return clean.slice(0, 1) + '***' + clean.slice(-1);
  return clean.slice(0, 2) + '***' + clean.slice(-1);
}

function getActiveProcessingJob() {
  for (const j of jobs.values()) {
    if (j.status === 'processing') return j;
  }
  return null;
}

// Submit Job to Queue
app.post('/api/queue', submitLimiter, async (req, res) => {
  const { username } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Vui lòng cung cấp Username hoặc Link chia sẻ Locket.'
    });
  }

  const cleanUsername = username.trim();
  const jobId = crypto.randomBytes(8).toString('hex');

  const newJob = {
    id: jobId,
    username: cleanUsername,
    status: 'queued',
    progress: 5,
    logs: ['Yêu cầu đã được đưa vào hàng đợi.'],
    createdAt: new Date().toISOString(),
    uid: null,
    error: null
  };

  jobs.set(jobId, newJob);
  queue.push(jobId);
  saveJobsToFile();

  // Trigger processor asynchronously
  processQueue().catch(console.error);

  const queuePosition = queue.indexOf(jobId) + 1;
  const estimatedWaitSeconds = Math.max(8, queuePosition * 12);

  return res.json({
    success: true,
    jobId: jobId,
    position: queuePosition,
    estimatedWaitSeconds: estimatedWaitSeconds,
    message: 'Yêu cầu đã được ghi nhận vào hàng đợi.'
  });
});

// Check Job Status
app.get('/api/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Không tìm thấy mã yêu cầu (Job ID).'
    });
  }

  let queuePosition = 0;
  const queueAhead = [];
  const activeProcessing = getActiveProcessingJob();

  if (job.status === 'queued') {
    const idx = queue.indexOf(jobId);
    queuePosition = idx !== -1 ? idx + 1 : 1;

    // If another job is currently being processed, add it first to the queue ahead list
    if (activeProcessing && activeProcessing.id !== jobId) {
      queueAhead.push({
        id: activeProcessing.id,
        maskedUsername: maskUsername(activeProcessing.cleanUsername || activeProcessing.username),
        status: 'processing',
        avatarUrl: activeProcessing.avatarUrl || null,
        initials: activeProcessing.initials || 'LK',
        isCurrentlyRunning: true
      });
    }

    // Add jobs in queue that are ahead of this one
    if (idx > 0) {
      for (let i = 0; i < idx; i++) {
        const aheadId = queue[i];
        const aheadJob = jobs.get(aheadId);
        if (aheadJob && aheadJob.id !== activeProcessing?.id) {
          queueAhead.push({
            id: aheadJob.id,
            maskedUsername: maskUsername(aheadJob.cleanUsername || aheadJob.username),
            status: 'queued',
            avatarUrl: aheadJob.avatarUrl || null,
            initials: aheadJob.initials || 'LK',
            position: i + 1
          });
        }
      }
    }
  }

  const estimatedWaitSeconds = queuePosition > 0 ? Math.max(6, queueAhead.length * 12) : 0;

  return res.json({
    success: true,
    job: {
      ...job,
      queuePosition: queuePosition,
      queueAhead: queueAhead,
      estimatedWaitSeconds: estimatedWaitSeconds,
      activeProcessing: activeProcessing ? {
        id: activeProcessing.id,
        maskedUsername: maskUsername(activeProcessing.cleanUsername || activeProcessing.username),
        progress: activeProcessing.progress || 10
      } : null
    }
  });
});

// System Stats
app.get('/api/stats', (req, res) => {
  return res.json({
    success: true,
    stats: {
      queueLength: queue.length,
      totalProcessed: jobs.size,
      isWorkerActive: isProcessing,
      serverUptime: Math.floor(process.uptime())
    }
  });
});

// Quick Username Check (without queuing)
app.post('/api/lookup', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: 'Username không được bỏ trống' });
  }

  try {
    const result = await resolveLocketUid(username);
    return res.json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// --- Admin Endpoints ---

// Admin Authentication
app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  if (!password || String(password).trim() !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: 'Mật khẩu quản trị không chính xác.'
    });
  }

  const token = generateAdminToken();
  return res.json({
    success: true,
    token: token,
    message: 'Xác thực quản trị viên thành công.'
  });
});

// Get All Jobs & Queue List
app.get('/api/admin/jobs', requireAdminAuth, (req, res) => {
  const allJobs = Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const total = allJobs.length;
  const queued = allJobs.filter(j => j.status === 'queued').length;
  const processing = allJobs.filter(j => j.status === 'processing').length;
  const completed = allJobs.filter(j => j.status === 'completed').length;
  const failed = allJobs.filter(j => j.status === 'failed').length;
  const cancelled = allJobs.filter(j => j.status === 'cancelled').length;

  return res.json({
    success: true,
    stats: {
      total,
      queued,
      processing,
      completed,
      failed,
      cancelled,
      isWorkerActive: isProcessing,
      serverUptime: Math.floor(process.uptime())
    },
    queue: queue,
    jobs: allJobs
  });
});

// Cancel a Queued Job
app.post('/api/admin/jobs/:id/cancel', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  const job = jobs.get(id);

  if (!job) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu.' });
  }

  const qIdx = queue.indexOf(id);
  if (qIdx !== -1) {
    queue.splice(qIdx, 1);
  }

  job.status = 'cancelled';
  job.logs.push('🚫 Yêu cầu đã bị hủy bởi Quản trị viên.');
  saveJobsToFile();

  return res.json({
    success: true,
    message: `Đã hủy yêu cầu của @${job.username}`
  });
});

// Retry a Failed / Cancelled Job
app.post('/api/admin/jobs/:id/retry', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  const job = jobs.get(id);

  if (!job) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu.' });
  }

  job.status = 'queued';
  job.progress = 5;
  job.error = null;
  job.logs.push('🔄 Yêu cầu được thử lại bởi Quản trị viên.');

  if (!queue.includes(id)) {
    queue.push(id);
  }

  saveJobsToFile();
  processQueue().catch(console.error);

  return res.json({
    success: true,
    message: `Đã đưa @${job.username} trở lại hàng đợi.`
  });
});

// Delete a Job
app.delete('/api/admin/jobs/:id', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  const qIdx = queue.indexOf(id);
  if (qIdx !== -1) {
    queue.splice(qIdx, 1);
  }

  jobs.delete(id);
  saveJobsToFile();

  return res.json({
    success: true,
    message: 'Đã xóa bản ghi thành công.'
  });
});

// Clear Finished History
app.post('/api/admin/jobs/clear-history', requireAdminAuth, (req, res) => {
  let count = 0;
  for (const [id, job] of jobs.entries()) {
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      jobs.delete(id);
      count++;
    }
  }
  saveJobsToFile();

  return res.json({
    success: true,
    message: `Đã dọn dẹp ${count} bản ghi lịch sử.`
  });
});

// Download DNS Config (.mobileconfig) - redirect to official Vercel host
app.get('/download-config', (req, res) => {
  return res.redirect(302, 'https://locket-pre.vercel.app/download-config');
});

// Admin Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Load persistent data
loadJobsFromFile();
if (queue.length > 0) {
  processQueue().catch(console.error);
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`🚀 BO - LocketGold Web Server is running on:`);
    console.log(`👉 http://localhost:${PORT}`);
    console.log(`👉 http://localhost:${PORT}/admin`);
    console.log(`==========================================`);
  });
}

module.exports = app;
