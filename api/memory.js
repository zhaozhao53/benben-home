import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ybpdeghwuoudtfmxirfc.supabase.co';
const supabaseAnonKey = 'sb_publishable_GdDNoFt3aQ93fz8VMZWe0g_FbWCOLUg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

  try {
    const { error } = await supabase
      .from('chat_memories')   // 假设你的表名是 chat_memories，如果不是请告诉我
      .insert([{ session_id: sessionId, message, created_at: new Date().toISOString() }]);

    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '数据库写入失败' });
  }
}
