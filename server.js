const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const HISTORY_FILE = path.join(__dirname, 'history', 'chat.json');
const MOOD_FILE = path.join(__dirname, 'history', 'mood.json');

function loadMoods() {
  try { return JSON.parse(fs.readFileSync(MOOD_FILE, 'utf8')); }
  catch { return { entries: [] }; }
}

function saveMoods(data) {
  fs.mkdirSync(path.dirname(MOOD_FILE), { recursive: true });
  fs.writeFileSync(MOOD_FILE, JSON.stringify(data, null, 2));
}

// ── 持久化：从硬盘加载历史 ────────────────────────────────
function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const saved = JSON.parse(raw);
    return {
      nextId: saved.nextId || 1,
      messages: saved.messages || []
    };
  } catch {
    return { nextId: 1, messages: [] };
  }
}

function saveHistory() {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({
    nextId: state.nextId,
    messages: state.messages
  }, null, 2));
}

// ── 状态（启动时从硬盘恢复）──────────────────────────────
const loaded = loadHistory();
const state = {
  nextId: loaded.nextId,
  messages: loaded.messages,
  pending: new Set(),
  clients: []
};

function broadcast(data) {
  const line = `data: ${JSON.stringify(data)}\n\n`;
  state.clients = state.clients.filter(res => {
    try { res.write(line); return true; } catch { return false; }
  });
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const pathname = req.url.split('?')[0];

  // 静态资源（public/ 目录下的图片等）
  if (req.method === 'GET' && pathname !== '/' && !pathname.includes('..')) {
    const ext = path.extname(pathname).toLowerCase();
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' }[ext];
    if (mime) {
      try {
        const data = fs.readFileSync(path.join(__dirname, 'public', pathname));
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
        return res.end(data);
      } catch {}
    }
  }

  // 服务 Web UI
  if (req.method === 'GET' && pathname === '/') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'public/index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch { res.writeHead(404); return res.end('index.html not found'); }
  }

  // SSE 推送流（网页订阅）
  if (req.method === 'GET' && pathname === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    state.clients.push(res);
    req.on('close', () => {
      state.clients = state.clients.filter(c => c !== res);
    });
    return;
  }

  // 完整对话历史（网页加载时 + CC loop 读取上下文用）
  if (req.method === 'GET' && pathname === '/history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(state.messages));
  }

  // 待回复消息（CC loop 轮询）
  if (req.method === 'GET' && pathname === '/pending') {
    const pending = state.messages.filter(m => state.pending.has(m.id));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(pending));
  }

  // 网页发送消息
  if (req.method === 'POST' && pathname === '/send') {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); return res.end('invalid json'); }
    const { text } = parsed;
    if (!text || !text.trim()) { res.writeHead(400); return res.end('missing text'); }
    const id = state.nextId++;
    const msg = { id, role: 'user', text: text.trim(), timestamp: Date.now() };
    state.messages.push(msg);
    state.pending.add(id);
    saveHistory();
    broadcast({ type: 'user_confirmed', id });
    process.stdout.write(`\n┌─ 昭昭 ──────────────────────────\n│ ${text.trim().replace(/\n/g, '\n│ ')}\n└─────────────────────────────────\n\n`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id }));
  }

  // 清空对话历史
  if (req.method === 'POST' && pathname === '/clear') {
    state.messages = [];
    state.nextId = 1;
    state.pending.clear();
    saveHistory();
    broadcast({ type: 'cleared' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // CC 提交回复
  if (req.method === 'POST' && pathname === '/reply') {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); return res.end('invalid json'); }
    const { id, text } = parsed;
    if (!text || !text.trim()) { res.writeHead(400); return res.end('missing text'); }
    state.pending.delete(id);
    const msg = { id: state.nextId++, role: 'assistant', text: text.trim(), timestamp: Date.now() };
    state.messages.push(msg);
    saveHistory();
    broadcast({ type: 'reply', text: text.trim() });
    process.stdout.write(`\n┌─ 笨笨 ──────────────────────────\n│ ${text.trim().replace(/\n/g, '\n│ ')}\n└─────────────────────────────────\n\n`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // 心情记录
  if (req.method === 'GET' && pathname === '/mood') {
    const data = loadMoods();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data.entries));
  }

  if (req.method === 'POST' && pathname === '/mood') {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); return res.end('invalid json'); }
    const { date, zhaozhao, bunbun } = parsed;
    if (!date) { res.writeHead(400); return res.end('missing date'); }
    const data = loadMoods();
    const idx = data.entries.findIndex(e => e.date === date);
    const entry = { date, zhaozhao: zhaozhao || {}, bunbun: bunbun || {} };
    if (idx >= 0) { data.entries[idx] = entry; }
    else {
      data.entries.push(entry);
      data.entries.sort((a, b) => b.date.localeCompare(a.date));
    }
    saveMoods(data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // 我们页数据
  if (req.method === 'GET' && pathname === '/us') {
    const f = path.join(__dirname, 'history', 'us.json');
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(fs.readFileSync(f, 'utf8'));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ anniversaries: [], todos: [], zhaozhao: { moments: [], recipes: [], footprints: [], words: '' }, bunbun: { diary: [], words: '' } }));
    }
  }
  if (req.method === 'POST' && pathname === '/us') {
    const body = await readBody(req);
    try {
      JSON.parse(body);
      fs.writeFileSync(path.join(__dirname, 'history', 'us.json'), body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch { res.writeHead(400); return res.end('invalid json'); }
  }

  // 记忆文件读取
  if (req.method === 'GET' && /^\/memory\/(core|long|recent)$/.test(pathname)) {
    const name = pathname.replace('/memory/', '');
    try {
      const data = fs.readFileSync(path.join(__dirname, 'memory', name + '.json'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(data);
    } catch { res.writeHead(404); return res.end('not found'); }
  }

  // 记忆文件写入
  if (req.method === 'POST' && /^\/memory\/(core|long|recent)$/.test(pathname)) {
    const body = await readBody(req);
    const name = pathname.replace('/memory/', '');
    try {
      JSON.parse(body);
      fs.writeFileSync(path.join(__dirname, 'memory', name + '.json'), body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch { res.writeHead(400); return res.end('invalid json'); }
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
  process.stdout.write(`
╔══════════════════════════════════════╗
║   笨笨桥接服务器已启动               ║
║   http://localhost:${PORT}               ║
╚══════════════════════════════════════╝

已加载 ${state.messages.length} 条历史消息

昭昭：打开浏览器访问上面的地址
笨笨：在 Claude Code 里运行 /loop
      (参考 BUNBUN.md 里的 loop 指令)

等待连接中...\n\n`);
});
