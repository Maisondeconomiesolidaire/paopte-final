# ElevenLabs Papote

Next.js starter for an ElevenLabs conversational agent.

## What it includes

- Next.js App Router app
- Server route at `/api/signed-url` to request signed conversation URLs
- shadcn-style UI primitives
- Voice start/end controls
- Typed message fallback
- Live message panel

## Run it

1. Install dependencies with `npm install`
2. Start the app with `npm run dev`
3. Open `http://localhost:3000`
4. Paste your ElevenLabs `agent_...` ID into the UI and start the conversation

Your ElevenLabs API key stays in `.env` on the server side and is never exposed to the browser.

# paopte-final
