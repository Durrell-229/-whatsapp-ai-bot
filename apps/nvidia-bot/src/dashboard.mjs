import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

const sseClients = new Set();
const messageLog = [];
let _page = null; // puppeteer page reference pour screenshot QR

export const stats = {
  messagesReceived: 0,
  aiRequests: 0,
  ocrRequests: 0,
  commandsExecuted: 0,
  errors: 0,
  startTime: Date.now(),
  status: 'connecting',
  model: process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
  botName: process.env.BOT_NAME || 'Assistant WhatsApp',
};

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch { sseClients.delete(res); }
  }
}

export function setPage(page) { _page = page; }

export function broadcastQR(qrData) {
  // qrData peut etre une URL data:image/... ou un code texte brut
  broadcast({ type: 'qr', qr: qrData });
}

export function logMessage(entry) {
  const full = { ...entry, id: Date.now() + '_' + Math.random().toString(36).slice(2), ts: Date.now() };
  messageLog.push(full);
  if (messageLog.length > 300) messageLog.shift();
  broadcast({ type: 'log', entry: full });
}

export function updateStats(updates) {
  Object.assign(stats, updates);
  broadcast({ type: 'stats', stats: { ...stats, uptime: Date.now() - stats.startTime } });
}

app.use(express.static(join(__dirname, '..', 'public')));

// Sante pour UptimeRobot
app.get('/health', (_req, res) => res.json({ ok: true, status: stats.status, uptime: Date.now() - stats.startTime }));

app.get('/api/init', (_req, res) => {
  res.json({
    stats: { ...stats, uptime: Date.now() - stats.startTime },
    log: messageLog.slice(-80),
  });
});

// Screenshot de la page Chrome (pour voir le QR code)
app.get('/screenshot', async (_req, res) => {
  if (!_page) return res.status(503).send('Page non disponible');
  try {
    const buf = await _page.screenshot({ type: 'png', fullPage: false });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(buf);
  } catch (err) {
    res.status(500).send('Erreur screenshot: ' + err.message);
  }
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write(': connected\n\n');
  sseClients.add(res);
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); } }, 25000);
  req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
});

export function startDashboard(port = 3000) {
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\x1b[36m\n  Dashboard: ${url}\x1b[0m`);
  });
}
