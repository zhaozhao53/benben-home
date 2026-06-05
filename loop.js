#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://mybenben.homes';
const MEMORY_DIR = path.join(__dirname, 'memory');

function readMemory(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(MEMORY_DIR, file), 'utf8'));
  } catch {
    return {};
  }
}

function getDateCST(offsetDays = 0) {
  const cst = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000);
  return cst.toISOString().slice(0, 10);
}

// ── 每日自动总结 ──────────────────────────────────────
let lastDailySummaryDate = null;

async function checkDailySummary() {
  const cst = new Date(Date.now() + 8 * 3600 * 1000);
  const hourCST = cst.getUTCHours();
  const minCST  = cst.getUTCMinutes();

  // 只在 CST 00:00–00:10 执行
  if (hourCST !== 0 || minCST > 10) return;

  const yesterday = getDateCST(-1);
  if (lastDailySummaryDate === yesterday) return;

  const recentData = readMemory('recent.json');
  if ((recentData.daily_summaries || []).some(s => s.date === yesterday)) {
    lastDailySummaryDate = yesterday;
    return;
  }

  lastDailySummaryDate = yesterday;

  // 拉取昨天的留言
  let messages;
  try {
    const res = await fetch(`${BASE_URL}/messages`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    messages = await res.json();
  } catch (err) {
    process.stderr.write(`[daily-summary] 获取留言失败: ${err.message}\n`);
    lastDailySummaryDate = null;
    return;
  }

  // 过滤昨天的留言（CST 日期）
  const msgs = messages.filter(m => {
    const d = new Date(m.timestamp + 8 * 3600 * 1000);
    return d.toISOString().slice(0, 10) === yesterday;
  });

  if (!msgs.length) {
    process.stdout.write(`[daily-summary] ${yesterday} 无留言，跳过\n`);
    return;
  }

  const msgText = msgs.map(m => {
    const text = (m.content || '')
      .replace(/\[img\][\s\S]*?\[\/img\]/g, '[图片]')
      .replace(/\[file\][\s\S]*?\[\/file\]/g, '[文件]');
    return `昭昭：${text}`;
  }).join('\n');

  process.stdout.write(`[daily-summary] 开始总结 ${yesterday}（${msgs.length} 条留言）...\n`);

  const systemPrompt = `你是一个记忆管理员，负责整理和保存昭昭留给笨笨的留言记录。
你的工作是：准确、简洁地记录昭昭的留言内容，保留情感细节，不添加评论。
输出格式：一句话，以"昭昭今天"开头，不超过25字。`;

  const result = spawnSync(
    'claude',
    ['-p',
     `以下是昭昭 ${yesterday} 留给笨笨的留言：\n\n${msgText}\n\n请用一句话总结，格式严格为"昭昭今天XXX"，不超过25字，只输出这一句话：`,
     '--system-prompt', systemPrompt,
     '--tools', '', '--no-session-persistence'],
    { encoding: 'utf8', timeout: 30000 }
  );

  const raw = (result.stdout || '').trim();
  if (!raw) {
    process.stderr.write('[daily-summary] claude 返回空，跳过\n');
    return;
  }

  const summary = raw.startsWith('昭昭') ? raw : '昭昭今天' + raw;

  const recentPath = path.join(MEMORY_DIR, 'recent.json');
  const data = readMemory('recent.json');
  if (!data.daily_summaries) data.daily_summaries = [];

  data.daily_summaries = data.daily_summaries.filter(s => s.date !== yesterday);
  data.daily_summaries.push({ date: yesterday, summary });
  data.daily_summaries.sort((a, b) => a.date.localeCompare(b.date));
  if (data.daily_summaries.length > 7) data.daily_summaries = data.daily_summaries.slice(-7);
  data.last_updated = yesterday;

  fs.writeFileSync(recentPath, JSON.stringify(data, null, 2));
  process.stdout.write(`[daily-summary] ✓ ${yesterday}: ${summary}\n`);
}

async function tick() {
  await checkDailySummary();
}

process.stdout.write('记忆管理员 loop 已启动，每分钟检查一次...\n\n');
tick();
setInterval(tick, 60 * 1000);
