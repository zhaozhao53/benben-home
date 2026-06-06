const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');
const MOOD_FILE     = path.join(__dirname, 'history', 'mood.json');
const PALACE_FILE   = path.join(__dirname, 'memory', 'palace.json');
const AVATARS_FILE  = path.join(__dirname, 'data', 'avatars.json');

function loadAvatars() {
  try { return JSON.parse(fs.readFileSync(AVATARS_FILE, 'utf8')); }
  catch { return { zhaozhao: '', bunbun: '' }; }
}
function saveAvatars(data) {
  fs.mkdirSync(path.dirname(AVATARS_FILE), { recursive: true });
  fs.writeFileSync(AVATARS_FILE, JSON.stringify(data, null, 2));
}

function loadMoods() {
  try { return JSON.parse(fs.readFileSync(MOOD_FILE, 'utf8')); }
  catch { return { entries: [] }; }
}

function saveMoods(data) {
  fs.mkdirSync(path.dirname(MOOD_FILE), { recursive: true });
  fs.writeFileSync(MOOD_FILE, JSON.stringify(data, null, 2));
}

function loadPalaceData() {
  try { return JSON.parse(fs.readFileSync(PALACE_FILE, 'utf8')); }
  catch { return { quotes: [], milestones: [], rules: [], memes: [] }; }
}

function savePalaceData(data) {
  fs.mkdirSync(path.dirname(PALACE_FILE), { recursive: true });
  fs.writeFileSync(PALACE_FILE, JSON.stringify(data, null, 2));
}

function loadMessages() {
  try {
    const raw = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    return { nextId: raw.nextId || 1, messages: raw.messages || [] };
  } catch {
    return { nextId: 1, messages: [] };
  }
}

function saveMessages() {
  fs.mkdirSync(path.dirname(MESSAGES_FILE), { recursive: true });
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify({
    nextId: state.nextId,
    messages: state.messages
  }, null, 2));
}

const loaded = loadMessages();
const state = {
  nextId: loaded.nextId,
  messages: loaded.messages,
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const pathname = req.url.split('?')[0];

  // 静态资源
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

  // Web UI
  if (req.method === 'GET' && pathname === '/') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'public/index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch { res.writeHead(404); return res.end('index.html not found'); }
  }

  // SSE
  if (req.method === 'GET' && pathname === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    state.clients.push(res);
    req.on('close', () => { state.clients = state.clients.filter(c => c !== res); });
    return;
  }

  // ── 留言板 ──────────────────────────────────────────────

  // 获取留言列表（可选 ?from=YYYY-MM-DD&to=YYYY-MM-DD 过滤）
  if (req.method === 'GET' && pathname === '/messages') {
    const qs     = new URL(req.url, 'http://localhost').searchParams;
    const from   = qs.get('from');
    const to     = qs.get('to');
    let msgs = state.messages;
    if (from || to) {
      msgs = msgs.filter(m => {
        const d = new Date(m.timestamp).toISOString().slice(0, 10);
        if (from && d < from) return false;
        if (to   && d > to)   return false;
        return true;
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(msgs));
  }

  // 新增留言
  if (req.method === 'POST' && pathname === '/messages') {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); return res.end('invalid json'); }
    const { content, attachments, from } = parsed;
    if (!content && (!attachments || !attachments.length)) {
      res.writeHead(400); return res.end('missing content');
    }
    const id = state.nextId++;
    const msg = {
      id,
      content: (content || '').trim(),
      attachments: attachments || [],
      from: from === '笨笨' ? '笨笨' : '昭昭',
      timestamp: Date.now(),
      starred: false
    };
    state.messages.unshift(msg);
    saveMessages();
    broadcast({ type: 'new_message', id });
    process.stdout.write(`\n[留言] #${id} ${new Date().toLocaleString('zh-CN')}\n${msg.content.slice(0, 60)}\n\n`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id }));
  }

  // 切换收藏
  const starMatch = pathname.match(/^\/messages\/(\d+)$/);
  if (req.method === 'PATCH' && starMatch) {
    const id = parseInt(starMatch[1], 10);
    const msg = state.messages.find(m => m.id === id);
    if (!msg) { res.writeHead(404); return res.end('not found'); }
    msg.starred = !msg.starred;
    saveMessages();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ starred: msg.starred }));
  }

  // ── 心情 ────────────────────────────────────────────────

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

  // ── 我们 ────────────────────────────────────────────────

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

  // ── 健康 ─────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/health') {
    const f = path.join(__dirname, 'history', 'health.json');
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(fs.readFileSync(f, 'utf8'));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ goalWeight: null, entries: [] }));
    }
  }

  if (req.method === 'POST' && pathname === '/health') {
    const body = await readBody(req);
    try {
      JSON.parse(body);
      const f = path.join(__dirname, 'history', 'health.json');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch { res.writeHead(400); return res.end('invalid json'); }
  }

  // ── 待办 ─────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/todos') {
    const f = path.join(__dirname, 'data', 'todos.json');
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(fs.readFileSync(f, 'utf8'));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ todos: [] }));
    }
  }

  if (req.method === 'POST' && pathname === '/todos') {
    const body = await readBody(req);
    try {
      JSON.parse(body);
      const f = path.join(__dirname, 'data', 'todos.json');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch { res.writeHead(400); return res.end('invalid json'); }
  }

  // ── 记忆宫殿 ─────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/palace') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(loadPalaceData()));
  }

  if (req.method === 'POST' && pathname === '/palace') {
    const body = await readBody(req);
    try {
      savePalaceData(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch { res.writeHead(400); return res.end('invalid json'); }
  }

  // ── 记忆文件 ─────────────────────────────────────────────

  if (req.method === 'GET' && /^\/memory\/(core|long|recent)$/.test(pathname)) {
    const name = pathname.replace('/memory/', '');
    try {
      const data = fs.readFileSync(path.join(__dirname, 'memory', name + '.json'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(data);
    } catch { res.writeHead(404); return res.end('not found'); }
  }

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

  // ── 日记 ─────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/diaries') {
    const memDir = path.join(__dirname, 'memory');
    try {
      const files = fs.readdirSync(memDir)
        .filter(f => /^diary-\d{4}-\d{2}-\d{2}\.txt$/.test(f))
        .sort();
      const diaries = files.map(f => ({
        date: f.slice(6, 16),
        content: fs.readFileSync(path.join(memDir, f), 'utf8')
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(diaries));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('[]');
    }
  }

  const diaryMatch = pathname.match(/^\/diary\/(\d{4}-\d{2}-\d{2})$/);

  if (req.method === 'POST' && diaryMatch) {
    const date = diaryMatch[1];
    const body = await readBody(req);
    let content = '';
    try { content = JSON.parse(body).content || ''; } catch { res.writeHead(400); return res.end('invalid json'); }
    fs.mkdirSync(path.join(__dirname, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'memory', `diary-${date}.txt`), content, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === 'DELETE' && diaryMatch) {
    const date = diaryMatch[1];
    try { fs.unlinkSync(path.join(__dirname, 'memory', `diary-${date}.txt`)); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── 头像 ─────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/avatars') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(loadAvatars()));
  }

  const avatarMatch = pathname.match(/^\/avatar\/(zhaozhao|bunbun)$/);
  if (req.method === 'POST' && avatarMatch) {
    const who  = avatarMatch[1];
    const body = await readBody(req);
    try {
      const { dataUrl } = JSON.parse(body);
      if (!dataUrl || !dataUrl.startsWith('data:image/')) { res.writeHead(400); return res.end('invalid image'); }
      const data = loadAvatars();
      data[who] = dataUrl;
      saveAvatars(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch { res.writeHead(400); return res.end('invalid json'); }
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
  process.stdout.write(`
╔══════════════════════════════════════╗
║   笨笨留言板服务器已启动             ║
║   http://localhost:${PORT}               ║
╚══════════════════════════════════════╝

已加载 ${state.messages.length} 条留言

等待连接中...\n\n`);
});
