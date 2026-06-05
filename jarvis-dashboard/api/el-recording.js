module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const conversationId = req.query.id;
  if (!conversationId) return res.status(400).send('Missing ?id=conversationId');

  const elKey = process.env.ELEVENLABS_API_KEY;
  if (!elKey) return res.status(500).send('ELEVENLABS_API_KEY not set in Vercel env');

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}/audio`,
      { headers: { 'xi-api-key': elKey } }
    );
    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(upstream.status).send(body);
    }
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'audio/mpeg');
    res.setHeader('Content-Disposition', `inline; filename="${conversationId}.mp3"`);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(500).send('Proxy error: ' + e.message);
  }
};
