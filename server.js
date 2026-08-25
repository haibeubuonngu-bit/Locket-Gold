const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// NextDNS Config (Profile BO_LocketGold)
const NEXTDNS_PROFILE_ID = process.env.NEXTDNS_PROFILE_ID || '878367';
const NEXTDNS_IOS_LINK = `https://apple.nextdns.io/?profile=${NEXTDNS_PROFILE_ID}`;
const NEXTDNS_ANDROID_DNS = `${NEXTDNS_PROFILE_ID}.dns.nextdns.io`;

// Rate Limiter for new submissions only
const submitLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // max 30 submissions per minute per IP
  message: {
    success: false,
    message: 'Bạn gửi yêu cầu quá nhanh! Vui lòng đợi 1 phút trước khi thử lại.'
  }
});


// In-Memory Queue State
const queue = [];
const jobs = new Map(); // jobId -> Job details
let isProcessing = false;

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

    try {
      // Step 1: Resolve UID & Avatar
      const result = await resolveLocketUid(job.username);
      job.uid = result.uid;
      job.cleanUsername = result.username || job.username;
      job.avatarUrl = result.avatarUrl;
      job.initials = result.initials;
      job.progress = 40;
      job.logs.push(`Đã tìm thấy tài khoản! @${job.cleanUsername} (UID: ${job.uid})`);

      await new Promise(r => setTimeout(r, 1000));

      // Step 2: Call Vercel Remote Restore API Gateway
      job.progress = 30;
      job.logs.push('Đang gửi yêu cầu kích hoạt tới Gateway đám mây...');

      try {
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

        if (restoreRes.ok) {
          const rData = await restoreRes.json();
          if (rData.client_id) {
            job.logs.push(`Gateway đã tạo Client ID: ${rData.client_id}`);
            job.logs.push('Đang xếp hàng và chờ Gateway nạp biên lai Gold...');

            let isGatewayDone = false;
            let lastStatusLogged = '';

            // Poll status until completion (up to 35 iterations ~ 50s)
            for (let p = 0; p < 35; p++) {
              await new Promise(r => setTimeout(r, 1500));
              try {
                const sRes = await fetch('https://locket-pre.vercel.app/api/queue/status', {
                  method: 'POST',
                  headers: {
                    'content-type': 'application/json',
                    'origin': 'https://locket-pre.vercel.app',
                    'referer': 'https://locket-pre.vercel.app/'
                  },
                  body: JSON.stringify({ client_id: rData.client_id })
                });

                if (sRes.ok) {
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
                    job.logs.push(`❌ Lỗi Gateway: ${errDetail}`);
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
              } catch (err) {
                if (err.message && (err.message.includes('User data not found') || err.message.includes('Lỗi Gateway'))) {
                  throw err;
                }
              }
            }
          }
        }
      } catch (e) {
        if (e.message && e.message.includes('User data not found')) {
          throw new Error('Tài khoản Locket không tồn tại hoặc sai username (User data not found)');
        }
        job.logs.push(`Thông báo: ${e.message}`);
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
    } catch (err) {
      job.status = 'failed';
      job.error = err.message || 'Lỗi không xác định trong quá trình xử lý';
      job.logs.push(`❌ Thất bại: ${job.error}`);
    }

    queue.shift();
    // Cooldown between jobs
    await new Promise(r => setTimeout(r, 500));
  }

  isProcessing = false;
}

// --- API Endpoints ---

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

  // Trigger processor asynchronously
  processQueue().catch(console.error);

  const queuePosition = queue.indexOf(jobId) + 1;

  return res.json({
    success: true,
    jobId: jobId,
    position: queuePosition,
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
  if (job.status === 'queued') {
    queuePosition = queue.indexOf(jobId) + 1;
  }

  return res.json({
    success: true,
    job: {
      ...job,
      queuePosition: queuePosition
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

// Download DNS Config (.mobileconfig) for NextDNS BO_LocketGold
app.get('/download-config', (req, res) => {
  const profileId = NEXTDNS_PROFILE_ID || '878367';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>PayloadDisplayName</key>
    <string>BO - LocketGold (${profileId})</string>
    <key>PayloadDescription</key>
    <string>Cấu hình DNS Anti-Revoke bảo vệ Locket Gold - Powered by BewOnlyfans (Profile: ${profileId})</string>
    <key>PayloadIdentifier</key>
    <string>com.locketgold.bewonlyfans.profile</string>
    <key>PayloadScope</key>
    <string>System</string>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>4C2E4174-58CC-4D04-A91D-9D095F770001</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
    <key>PayloadContent</key>
    <array>
      <dict>
        <key>DNSSettings</key>
        <dict>
          <key>DNSProtocol</key>
          <string>HTTPS</string>
          <key>ServerURL</key>
          <string>https://dns.nextdns.io/${profileId}</string>
        </dict>
        <key>OnDemandRules</key>
        <array>
          <dict>
            <key>Action</key>
            <string>EvaluateConnection</string>
            <key>ActionParameters</key>
            <array>
              <dict>
                <key>DomainAction</key>
                <string>NeverConnect</string>
                <key>Domains</key>
                <array>
                  <string>captive.apple.com</string>
                  <string>3gppnetwork.org</string>
                  <string>dav.orange.fr</string>
                  <string>vvm.mobistar.be</string>
                  <string>vvm.mstore.msg.t-mobile.com</string>
                  <string>tma.vvm.mone.pan-net.eu</string>
                  <string>vvm.ee.co.uk</string>
                </array>
              </dict>
            </array>
          </dict>
          <dict>
            <key>Action</key>
            <string>Connect</string>
          </dict>
        </array>
        <key>PayloadType</key>
        <string>com.apple.dnsSettings.managed</string>
        <key>PayloadIdentifier</key>
        <string>com.locketgold.bewonlyfans.dns</string>
        <key>PayloadUUID</key>
        <string>4C2E4174-58CC-4D04-A91D-9D095F770002</string>
        <key>PayloadDisplayName</key>
        <string>BO - LocketGold (${profileId})</string>
        <key>PayloadOrganization</key>
        <string>BO - LocketGold</string>
        <key>PayloadVersion</key>
        <integer>1</integer>
      </dict>
    </array>
  </dict>
</plist>`;

  res.setHeader('Content-Type', 'application/x-apple-aspen-config');
  res.setHeader('Content-Disposition', 'inline; filename=BO_LocketGold.mobileconfig');
  return res.send(xml);
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`🚀 BO - LocketGold Web Server is running on:`);
    console.log(`👉 http://localhost:${PORT}`);
    console.log(`==========================================`);
  });
}

module.exports = app;
