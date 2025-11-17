# Santa Backend Starter (Beginner Friendly)

This is a tiny server you can run on your Mac. Your mobile app will talk to it.

## What this gives you
- `/transcribe` — turns recorded audio into text (currently a demo placeholder).
- `/chat` — sends the child's text to Santa (LLM) and gets a reply.
- `/speak` — turns Santa's text into a file URL (placeholder). Replace with real TTS later.
- `/gifts` — returns the saved gifts for a child (in-memory).

> The STT and TTS here are placeholders so you can see the full loop work first.
> After that, you can swap them for real OpenAI Whisper (STT) and TTS models.

## 1) Install tools
- Install Node: `brew install node` (or from nodejs.org)
- Install pnpm: `npm i -g pnpm` (or use npm/yarn)

## 2) Install dependencies
```bash
pnpm install
```

## 3) Configure environment
- Copy `.env.example` to `.env`
- Paste your `OPENAI_API_KEY`

## 4) Run the server
```bash
pnpm dev
```

If it works, you'll see:
```
Santa backend listening on 8787
```

## 5) Test endpoints quickly
- Open your browser to: `http://localhost:8787/`
- You should see a short message.

## 6) Next step: connect from your mobile app
- In your app, POST the recorded audio file to `http://localhost:8787/transcribe`
- Then send the transcribed text to `http://localhost:8787/chat`
- Then call `http://localhost:8787/speak` with `{ "text": "<Santa reply>" }` and play the returned URL.

## 7) Replace placeholders with real AI
- `/transcribe`: use OpenAI Whisper to transcribe audio (model: `whisper-1`)
- `/speak`: use OpenAI TTS to get audio (e.g., model `gpt-4o-mini-tts`)
- Both require your API key in `.env`

## 8) Make it reachable from your phone (optional)
If you are testing on an iPhone and need your phone to reach your Mac:
```bash
brew install ngrok/ngrok/ngrok
ngrok http 8787
```
- Use the `https://...ngrok...` URL in your mobile app instead of `http://localhost:8787`.

## 9) Notes
- This server stores gifts in memory only (they disappear if you restart).
- In production, add a database (e.g., Supabase/Postgres).

## 10) Troubleshooting
- If you see module errors, run `pnpm install` again.
- If the port is busy, change `PORT` in `.env` and restart.
