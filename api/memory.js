export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "请用 POST 请求" })
  }
  const { sessionId, message } = req.body
  if (!sessionId || !message) {
    return res.status(400).json({ error: "缺少参数" })
  }
  console.log("收到:", { sessionId, message })
  res.status(200).json({ success: true })
}
