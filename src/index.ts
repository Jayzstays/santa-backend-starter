import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { OpenAI } from "openai";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

// OpenAI client (Render will provide OPENAI_API_KEY in env)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory gift storage
const gifts: Record<string, Array<{ item: string; details?: any; at: string }>> = {};

const santaSystem = `You are Santa. Be warm, brief (1–3 sentences). Encourage kindness and listening without shaming.
If the child mentions a gift wish, include a JSON line at the end like:
{"gift":{"item":"red bike","details":{"color":"red"}}}`;

// Health check
app.get("/", (_req, res) => {
  res.send("Santa backend is running. Use /transcribe, /chat, /speak");
});

// 1) STT: audio -> text (for now: placeholder text, no real STT to keep it simple)
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (req.file) {
    console.log("Uploaded file:", {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      path: req.file.path,
      size: req.file.size,
    });
    // Clean up uploaded file; in a real STT we'd send it to OpenAI first
    fs.unlink(req.file.path, () => {});
  }

  // Placeholder transcription so the loop works
  const text = "Hi Santa, I want a red bike";
  res.json({ text, sessionId: Math.random().toString(36).slice(2) });
});

// 2) Chat: child text -> Santa reply (and capture gift if present)
app.post("/chat", async (req, res) => {
  try {
    const { childId = "demo-child", text = "" } = req.body || {};

    const messages = [
      { role: "system", content: santaSystem },
      { role: "user", content: text },
    ] as const;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    const reply =
      completion.choices[0]?.message?.content ||
      "Ho ho ho! Merry Christmas!";

    // Naive JSON extraction (if Santa included a gift JSON line)
    const match = reply.match(/\{[\s\S]*"gift"[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        const g = parsed.gift;
        if (g?.item) {
          gifts[childId] ??= [];
          gifts[childId].push({
            item: g.item,
            details: g.details,
            at: new Date().toISOString(),
          });
        }
      } catch {
        // ignore JSON parse errors
      }
    }

    const cleaned = reply.replace(/\{[\s\S]*"gift"[\s\S]*\}/, "").trim();
    res.json({ replyText: cleaned });
  } catch (err) {
    console.error("LLM error:", err);
    res.status(500).json({
      replyText:
        "Ho ho ho! Santa is having a little trouble right now. Please try again soon.",
    });
  }
});

// 3) TTS: text -> MP3 file and URL
app.post("/speak", async (req, res) => {
  try {
    fs.mkdirSync("public", { recursive: true });

    const { text = "" } = req.body || {};
    const santaText =
      `Ho ho ho! ${text}. ` +
      `This is Santa Claus speaking — remember, kindness and good listening matter.`;

    const tts = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy", // deeper male tone; change if you want different vibe
      input: santaText,
      format: "mp3",
    });

    const buf = Buffer.from(await tts.arrayBuffer());
    const fileName = `${Date.now()}-santa.mp3`;
    fs.writeFileSync(path.join("public", fileName), buf);

    const base = process.env.PUBLIC_BASE_URL || "";
    const audioUrl = `${base}/${fileName}`;
    console.log("🔊 TTS file:", fileName, "→", audioUrl);

    res.json({ audioUrl });
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ audioUrl: "", error: "tts_failed" });
  }
});

// 4) Get gifts for a child
app.get("/gifts", (req, res) => {
  const childId = String(req.query.childId || "demo-child");
  res.json(gifts[childId] || []);
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log("Santa backend listening on", PORT);
});
