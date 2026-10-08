const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// System state
let lastHeartbeat = 0;
let isPowerOn = false;
let currentOutageStart = null;
const outageHistory = [];

// Outage detection threshold (10 seconds)
const TIMEOUT_MS = 10000; 

// 1. ESP32 Heartbeat Receiver
app.post('/api/heartbeat', (req, res) => {
  const now = Date.now();
  lastHeartbeat = now;

  if (!isPowerOn) {
    isPowerOn = true;
    const restoredAt = new Date(now).toLocaleTimeString();
    
    if (currentOutageStart) {
      const durationSeconds = Math.round((now - currentOutageStart) / 1000);
      outageHistory.unshift({
        event: 'Power Restored',
        timestamp: restoredAt,
        duration: `${durationSeconds}s`
      });
      currentOutageStart = null;
    } else {
      outageHistory.unshift({
        event: 'System Online',
        timestamp: restoredAt,
        duration: '-'
      });
    }
    console.log(`[STATUS CHANGE] Power RESTORED at ${restoredAt}`);
  }

  res.status(200).json({ status: 'success', message: 'Heartbeat acknowledged' });
});

// 2. Real-Time Status API
app.get('/api/status', (req, res) => {
  const now = Date.now();
  const secondsSincePing = lastHeartbeat === 0 ? null : Math.round((now - lastHeartbeat) / 1000);
  const outageDuration = currentOutageStart ? Math.round((now - currentOutageStart) / 1000) : 0;

  res.json({
    powerOn: isPowerOn,
    serverTime: now,
    secondsSincePing: secondsSincePing,
    outageDurationSeconds: outageDuration,
    lastSeen: lastHeartbeat === 0 ? 'Never' : new Date(lastHeartbeat).toLocaleTimeString(),
    history: outageHistory.slice(0, 10)
  });
});

// 3. Test Simulation Endpoint
app.post('/api/test-toggle', (req, res) => {
  if (isPowerOn) {
    isPowerOn = false;
    currentOutageStart = Date.now();
    outageHistory.unshift({
      event: 'Power Cut (Simulated)',
      timestamp: new Date().toLocaleTimeString(),
      duration: 'Ongoing'
    });
  } else {
    isPowerOn = true;
    lastHeartbeat = Date.now();
    outageHistory.unshift({
      event: 'Power Restored (Simulated)',
      timestamp: new Date().toLocaleTimeString(),
      duration: 'Restored'
    });
    currentOutageStart = null;
  }
  res.json({ success: true, powerOn: isPowerOn });
});

// 4. Background Watchdog (Checks every 1 second)
setInterval(() => {
  if (lastHeartbeat !== 0 && isPowerOn) {
    const elapsed = Date.now() - lastHeartbeat;
    if (elapsed > TIMEOUT_MS) {
      isPowerOn = false;
      currentOutageStart = Date.now();
      const cutTime = new Date().toLocaleTimeString();
      
      outageHistory.unshift({
        event: 'Power Cut Detected',
        timestamp: cutTime,
        duration: 'Ongoing'
      });

      console.log(`[ALERT] Office power outage detected at ${cutTime}!`);
    }
  }
}, 1000);

// 5. Embedded Web Dashboard with Real-Time Clocks
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Office Power Monitor - Real Time</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #0b1120; color: #f8fafc; display: flex; justify-content: center; padding: 2rem 1rem; min-height: 100vh; }
    .container { width: 100%; max-width: 500px; display: flex; flex-direction: column; gap: 1.2rem; }
    .card { background: #1e293b; border-radius: 1rem; padding: 1.5rem; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
    
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .header h1 { font-size: 1.1rem; color: #94a3b8; font-weight: 600; }
    .clock { font-family: monospace; font-size: 1rem; color: #38bdf8; background: #0f172a; padding: 0.3rem 0.6rem; border-radius: 0.4rem; border: 1px solid #1e293b; }

    .status-box { text-align: center; padding: 1.5rem 1rem; border-radius: 0.75rem; margin-bottom: 1rem; transition: background 0.3s; }
    .status-online { background: #064e3b; border: 1px solid #059669; }
    .status-offline { background: #7f1d1d; border: 1px solid #dc2626; }
    .status-title { font-size: 1.8rem; font-weight: 800; letter-spacing: 0.5px; }
    .status-sub { font-size: 0.9rem; margin-top: 0.4rem; opacity: 0.9; }

    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; text-align: center; }
    .meta-item { background: #0f172a; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #1e293b; }
    .meta-label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .meta-val { font-size: 1.2rem; font-weight: 700; margin-top: 0.2rem; font-family: monospace; }

    .history-card h2 { font-size: 1rem; margin-bottom: 0.75rem; color: #94a3b8; }
    .history-list { list-style: none; display: flex; flex-direction: column; gap: 0.5rem; }
    .history-item { background: #0f172a; padding: 0.6rem 0.8rem; border-radius: 0.5rem; font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center; }
    .tag-cut { color: #f87171; font-weight: bold; }
    .tag-restored { color: #4ade80; font-weight: bold; }

    .btn-test { width: 100%; margin-top: 1rem; background: #334155; color: #cbd5e1; border: none; padding: 0.6rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.85rem; font-weight: 600; }
    .btn-test:hover { background: #475569; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <h1>OFFICE POWER MONITOR</h1>
        <div id="liveClock" class="clock">--:--:--</div>
      </div>
      
      <div id="statusBox" class="status-box status-offline">
        <div id="statusTitle" class="status-title">CHECKING...</div>
        <div id="statusSub" class="status-sub">Connecting to monitor server...</div>
      </div>

      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">Last Signal Time</div>
          <div id="lastSeen" class="meta-val">--</div>
        </div>
        <div class="meta-item">
          <div id="dynamicLabel" class="meta-label">Signal Delay</div>
          <div id="dynamicVal" class="meta-val">--</div>
        </div>
      </div>

      <button class="btn-test" onclick="toggleTest()">Simulate Outage / Restoration</button>
    </div>

    <div class="card history-card">
      <h2>Recent Power Events</h2>
      <ul id="historyList" class="history-list">
        <li class="history-item"><span>No events recorded yet</span></li>
      </ul>
    </div>
  </div>

  <script>
    // Live Clock (Local Browser Time)
    function updateClock() {
      const now = new Date();
      document.getElementById('liveClock').innerText = now.toLocaleTimeString();
    }
    setInterval(updateClock, 1000);
    updateClock();

    // Fetch live status from server
    async function updateDashboard() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        const box = document.getElementById('statusBox');
        const title = document.getElementById('statusTitle');
        const sub = document.getElementById('statusSub');
        const dynLabel = document.getElementById('dynamicLabel');
        const dynVal = document.getElementById('dynamicVal');

        if (data.powerOn) {
          box.className = 'status-box status-online';
          title.innerText = '🟢 POWER ACTIVE';
          sub.innerText = 'Router online & transmitting';
          dynLabel.innerText = 'Signal Delay';
          dynVal.innerText = (data.secondsSincePing !== null ? data.secondsSincePing : 0) + 's';
          dynVal.style.color = '#4ade80';
        } else {
          box.className = 'status-box status-offline';
          title.innerText = '🔴 POWER OUTAGE';
          sub.innerText = 'No signal from office router';
          dynLabel.innerText = 'Outage Duration';
          dynVal.innerText = data.outageDurationSeconds + 's';
          dynVal.style.color = '#f87171';
        }

        document.getElementById('lastSeen').innerText = data.lastSeen;

        const historyEl = document.getElementById('historyList');
        if (data.history && data.history.length > 0) {
          historyEl.innerHTML = data.history.map(item => {
            const isCut = item.event.includes('Cut') || item.event.includes('Detected');
            const tagClass = isCut ? 'tag-cut' : 'tag-restored';
            return \`
              <li class="history-item">
                <span class="\${tagClass}">\${item.event}</span>
                <span style="color: #64748b;">\${item.timestamp} (\${item.duration})</span>
              </li>
            \`;
          }).join('');
        }
      } catch (err) {
        console.error('Fetch error:', err);
      }
    }

    async function toggleTest() {
      await fetch('/api/test-toggle', { method: 'POST' });
      updateDashboard();
    }

    // Refresh status every 1 second for live real-time feel
    setInterval(updateDashboard, 1000);
    updateDashboard();
  </script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`Office Power Monitor server running on port ${PORT}`);
});
