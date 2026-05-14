export default async function handler(req, res) {
  // 允许跨域
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '请用 POST 请求' });
  }

  const { sessionId, message } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ error: '缺少 sessionId 或 message' });
  }

  // Supabase 配置（你的信息）
  const SUPABASE_URL = 'https://ybpdeghwuoudtfmxirfc.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_GdDNoFt3aQ93fz8VMZWe0g_FbWCOLUg';

  try {
    // 使用原生 fetch 调用 Supabase REST API
    const response = await fetch(`${SUPABASE_URL}/rest/v1/chat_memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
        created_at: new Date().toISOString()
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase 返回错误: ${response.status} ${errorText}`);
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('写入失败:', err);
    res.status(500).json({ error: `数据库写入失败: ${err.message}` });
  }
}
