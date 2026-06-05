require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const TOKEN = process.env.BENBEN_MCP_TOKEN;
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

function checkAuth(req) {
  const auth = req.headers['authorization'] || '';
  return TOKEN && auth === `Bearer ${TOKEN}`;
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
  server.tool('read_messages', '读取昭昭留给笨笨的留言',
    { limit: z.number().optional().describe('返回最新N条，默认20') },
    async ({ limit = 20 }) => {
      const data = readJSON(path.join(DATA_DIR, 'messages.json')) || { messages: [] };
      const msgs = (data.messages || []).slice(0, limit).map(m => ({
        id: m.id,
        content: m.content,
        timestamp: m.timestamp,
        starred: m.starred,
        hasAttachments: !!(m.attachments && m.attachments.length)
      }));
      return { content: [{ type: 'text', text: JSON.stringify(msgs, null, 2) }] };
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

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); return res.end();
  }

  const pathname = req.url.split('?')[0];
  if (pathname !== '/mcp') {
    res.writeHead(404); return res.end('not found');
  }

  // Token 验证
  if (!checkAuth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
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
  process.stdout.write(`
╔══════════════════════════════════════╗
║   笨笨 MCP Server 已启动             ║
║   http://localhost:${PORT}               ║
║   端点: POST /mcp                    ║
╚══════════════════════════════════════╝\n\n`);
});
