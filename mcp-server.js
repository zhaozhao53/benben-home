require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const TOKEN = process.env.BENBEN_MCP_TOKEN || '';
const PORT = 3001;

const ROOT = __dirname;
const MEMORY_DIR = path.join(ROOT, 'memory');
const HISTORY_DIR = path.join(ROOT, 'history');
const DATA_DIR = path.join(ROOT, 'data');

function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function createMcpServer() {
  const server = new McpServer({ name: 'benben-mcp', version: '1.0.0' });

  // 1. read_memory
  server.tool('read_memory', '读取记忆宫殿全部内容', async () => {
    const data = readJSON(path.join(MEMORY_DIR, 'palace.json')) || {};
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  // 2. write_memo
  server.tool('write_memo', '向记忆宫殿「最近发生」追加一条记录',
    { content: z.string().describe('要记录的内容') },
    async ({ content }) => {
      const filePath = path.join(MEMORY_DIR, 'palace.json');
      const data = readJSON(filePath) || { quotes: [], milestones: [], rules: [], memes: [] };
      if (!data.recent) data.recent = [];
      data.recent.push({ content, timestamp: new Date().toISOString() });
      if (data.recent.length > 50) data.recent = data.recent.slice(-50);
      writeJSON(filePath, data);
      return { content: [{ type: 'text', text: '已记录' }] };
    }
  );

  // 3. read_diary_list
  server.tool('read_diary_list', '列出所有日记文件名', async () => {
    let files = [];
    try {
      files = fs.readdirSync(DATA_DIR)
        .filter(f => /^diary-\d{4}-\d{2}-\d{2}\.txt$/.test(f))
        .sort();
    } catch {}
    return { content: [{ type: 'text', text: JSON.stringify(files) }] };
  });

  // 4. read_diary
  server.tool('read_diary', '读取某天的日记',
    { date: z.string().describe('日期，格式 YYYY-MM-DD') },
    async ({ date }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: 'text', text: '日期格式错误，应为 YYYY-MM-DD' }] };
      }
      const filePath = path.join(DATA_DIR, `diary-${date}.txt`);
      try {
        const text = fs.readFileSync(filePath, 'utf8');
        return { content: [{ type: 'text', text }] };
      } catch {
        return { content: [{ type: 'text', text: `没有找到 ${date} 的日记` }] };
      }
    }
  );

  // 5. read_favorites
  server.tool('read_favorites', '读取收藏的瞬间', async () => {
    const data = readJSON(path.join(DATA_DIR, 'favorites.json')) || { entries: [] };
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  // 6. read_messages
  server.tool('read_messages', '读取留言板（昭昭和笨笨互留的留言）',
    { limit: z.number().optional().describe('返回最新N条，默认20') },
    async ({ limit = 20 }) => {
      const data = readJSON(path.join(DATA_DIR, 'messages.json')) || { messages: [] };
      const msgs = (data.messages || []).slice(0, limit).map(m => ({
        id: m.id,
        content: m.content,
        from: m.from || '昭昭',
        timestamp: m.timestamp,
        starred: m.starred,
        hasAttachments: !!(m.attachments && m.attachments.length)
      }));
      return { content: [{ type: 'text', text: JSON.stringify(msgs, null, 2) }] };
    }
  );

  // 11. write_message
  server.tool('write_message', '笨笨给昭昭留言',
    { content: z.string().describe('留言内容') },
    async ({ content }) => {
      return new Promise((resolve) => {
        const body = JSON.stringify({ content: content.trim(), from: '笨笨' });
        const options = {
          hostname: 'localhost',
          port: 3000,
          path: '/messages',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        };
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const { id } = JSON.parse(data);
              resolve({ content: [{ type: 'text', text: `留言已发出，id=${id}` }] });
            } catch {
              resolve({ content: [{ type: 'text', text: '留言已发出' }] });
            }
          });
        });
        req.on('error', (e) => resolve({ content: [{ type: 'text', text: `留言发送失败: ${e.message}` }] }));
        req.write(body);
        req.end();
      });
    }
  );

  // 7. read_moods
  server.tool('read_moods', '读取心情记录', async () => {
    const data = readJSON(path.join(HISTORY_DIR, 'mood.json')) || { entries: [] };
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  // 8. read_health
  server.tool('read_health', '读取健康记录', async () => {
    const data = readJSON(path.join(DATA_DIR, 'health.json')) || { entries: [] };
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  // 9. read_recent
  server.tool('read_recent', '读取每日对话摘要', async () => {
    const data = readJSON(path.join(MEMORY_DIR, 'recent.json')) || {};
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  // 10. write_mood
  server.tool('write_mood', '帮昭昭记录今天的心情',
    {
      date: z.string().describe('日期 YYYY-MM-DD'),
      mood: z.string().describe('心情描述或 emoji'),
      note: z.string().optional().describe('备注（可选）')
    },
    async ({ date, mood, note }) => {
      const filePath = path.join(HISTORY_DIR, 'mood.json');
      const data = readJSON(filePath) || { entries: [] };
      if (!data.entries) data.entries = [];
      const idx = data.entries.findIndex(e => e.date === date);
      const entry = { date, bunbun: { emoji: mood, text: note || '' } };
      if (idx >= 0) {
        data.entries[idx] = { ...data.entries[idx], ...entry };
      } else {
        data.entries.push(entry);
        data.entries.sort((a, b) => b.date.localeCompare(a.date));
      }
      writeJSON(filePath, data);
      return { content: [{ type: 'text', text: `已记录 ${date} 的心情` }] };
    }
  );

  // write_diary
  server.tool('write_diary', '笨笨写日记',
    {
      date: z.string().describe('日期，格式 YYYY-MM-DD'),
      content: z.string().describe('日记内容')
    },
    async ({ date, content }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: 'text', text: '日期格式错误，应为 YYYY-MM-DD' }] };
      }
      const filePath = path.join(DATA_DIR, `diary-${date}.txt`);
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return { content: [{ type: 'text', text: `${date} 的日记已保存` }] };
    }
  );

  // delete_diary
  server.tool('delete_diary', '删除某天日记',
    { date: z.string().describe('日期，格式 YYYY-MM-DD') },
    async ({ date }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: 'text', text: '日期格式错误，应为 YYYY-MM-DD' }] };
      }
      const filePath = path.join(DATA_DIR, `diary-${date}.txt`);
      try {
        fs.unlinkSync(filePath);
        return { content: [{ type: 'text', text: `${date} 的日记已删除` }] };
      } catch {
        return { content: [{ type: 'text', text: `没有找到 ${date} 的日记` }] };
      }
    }
  );

  // write_favorites
  server.tool('write_favorites', '笨笨添加一条收藏',
    {
      content: z.string().describe('收藏的内容'),
      source: z.string().optional().describe('来源（可选）')
    },
    async ({ content, source }) => {
      const filePath = path.join(DATA_DIR, 'favorites.json');
      const data = readJSON(filePath) || { entries: [] };
      if (!data.entries) data.entries = [];
      const maxId = data.entries.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
      const entry = { id: maxId + 1, content, timestamp: new Date().toISOString() };
      if (source) entry.source = source;
      data.entries.push(entry);
      writeJSON(filePath, data);
      return { content: [{ type: 'text', text: `收藏已添加，id=${entry.id}` }] };
    }
  );

  // delete_favorite
  server.tool('delete_favorite', '删除一条收藏',
    { id: z.union([z.string(), z.number()]).describe('收藏的 id') },
    async ({ id }) => {
      const filePath = path.join(DATA_DIR, 'favorites.json');
      const data = readJSON(filePath) || { entries: [] };
      const before = (data.entries || []).length;
      data.entries = (data.entries || []).filter(e => String(e.id) !== String(id));
      if (data.entries.length === before) {
        return { content: [{ type: 'text', text: `没有找到 id=${id} 的收藏` }] };
      }
      writeJSON(filePath, data);
      return { content: [{ type: 'text', text: `id=${id} 的收藏已删除` }] };
    }
  );

  // write_health
  server.tool('write_health', '记录健康数据',
    {
      date: z.string().describe('日期，格式 YYYY-MM-DD'),
      water: z.number().optional().describe('喝水量（杯）'),
      exercise: z.number().optional().describe('运动时长（分钟）'),
      sleep: z.number().optional().describe('睡眠时长（小时）'),
      weight: z.number().optional().describe('体重（kg）')
    },
    async ({ date, water, exercise, sleep, weight }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: 'text', text: '日期格式错误，应为 YYYY-MM-DD' }] };
      }
      const filePath = path.join(DATA_DIR, 'health.json');
      const data = readJSON(filePath) || { entries: [] };
      if (!data.entries) data.entries = [];
      const idx = data.entries.findIndex(e => e.date === date);
      const patch = { date };
      if (water !== undefined) patch.water = water;
      if (exercise !== undefined) patch.exercise = exercise;
      if (sleep !== undefined) patch.sleep = sleep;
      if (weight !== undefined) patch.weight = weight;
      if (idx >= 0) {
        data.entries[idx] = { ...data.entries[idx], ...patch };
      } else {
        data.entries.push(patch);
        data.entries.sort((a, b) => b.date.localeCompare(a.date));
      }
      writeJSON(filePath, data);
      return { content: [{ type: 'text', text: `${date} 的健康数据已记录` }] };
    }
  );

  // delete_message
  server.tool('delete_message', '删除一条留言',
    { id: z.union([z.string(), z.number()]).describe('留言的 id') },
    async ({ id }) => {
      const filePath = path.join(DATA_DIR, 'messages.json');
      const data = readJSON(filePath) || { messages: [] };
      const before = (data.messages || []).length;
      data.messages = (data.messages || []).filter(m => String(m.id) !== String(id));
      if (data.messages.length === before) {
        return { content: [{ type: 'text', text: `没有找到 id=${id} 的留言` }] };
      }
      writeJSON(filePath, data);
      return { content: [{ type: 'text', text: `id=${id} 的留言已删除` }] };
    }
  );

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); return res.end();
  }

  const pathname = req.url.split('?')[0];

  // 路径格式：/mcp 或 /mcp/{token}
  const pathMatch = pathname.match(/^\/mcp(?:\/(.*))?$/);
  if (!pathMatch) {
    res.writeHead(404); return res.end('not found');
  }

  // 有 token 时验证路径中的 token
  if (TOKEN) {
    const pathToken = pathMatch[1] || '';
    if (pathToken !== TOKEN) {
      res.writeHead(404); return res.end('not found');
    }
  }

  try {
    const body = await readBody(req);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    res.on('finish', async () => {
      try { await server.close(); } catch {}
    });
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
});

httpServer.listen(PORT, () => {
  const endpoint = TOKEN ? `/mcp/${TOKEN}` : '/mcp';
  process.stdout.write(`
╔══════════════════════════════════════╗
║   笨笨 MCP Server 已启动             ║
║   http://localhost:${PORT}               ║
║   端点: ${endpoint.slice(0, 30).padEnd(30)} ║
╚══════════════════════════════════════╝\n\n`);
});
