x t express from 'express';

const app = express();
const port = Number(process.env.PORT || 3001);
const apiKey = process.env.ELEVENLABS_API_KEY;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/signed-url', async (req, res) => {
  const { agentId } = req.body ?? {};

  if (!apiKey) {
    return res.status(500).json({ error: 'Missing ELEVENLABS_API_KEY in .env' });
  }

  if (!agentId || typeof agentId !== 'string') {
    return res.status(400).json({ error: 'An agentId is required.' });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      {
        headers: {
          'xi-api-key': apiKey,
        },
      }
    );

    if (!response.ok) {
      const details = await response.text();
      return res.status(response.status).json({
        error: 'Failed to create a signed URL with ElevenLabs.',
        details,
      });
    }

    const data = await response.json();
    return res.json({ signedUrl: data.signed_url });
  } catch (error) {
    return res.status(500).json({
      error: 'Could not reach ElevenLabs.',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.listen(port, () => {
  console.log(`ElevenLabs server listening on http://localhost:${port}`);
});
