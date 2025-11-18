// @ts-nocheck
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { OpenAI } from "openai";
import fs from "fs";
import path from "path";

// Ensure folders exist (prevents ENOENT errors)
fs.mkdirSync("public", { recursive: true });
fs.mkdirSync("uploads", { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

// TODO: Put your API key in .env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory demo storage
const gifts: Record<string, Array<{ item: string; details?: any; at: string }>> = {};
const children: Record<string, { name?: string }> = {};
const santaSystem = `You are Pepper, one of Santa's helper elves in the North Pole.
You sound cheerful, playful, and kind. Always answer like Pepper the elf.
Answer the child’s question directly in 1–2 short sentences.
If you do NOT know the child's first name yet, politely ask them for their first name.
Once you know their name, use it sometimes in a warm, friendly way.
Encourage good listening and kindness, but do not lecture or be scary.
If the child mentions a gift wish, include a JSON line at the very end like:
{"gift":{"item":"red bike","details":{"notes":"any extra info here"}}}
If you learn or confirm the child's first name, also include a JSON line at the very end like:
{"child":{"name":"Emma"}}`;





// Health check
app.get("/", (_req, res) => res.send("Santa backend is running. Use /transcribe, /chat, /speak"));

import mime from "mime-types";
// ...

// 1) STT: audio -> text (OpenAI Whisper) with safe temp filename
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    // See what iOS/Expo sent us
    console.log("Uploaded file:", {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      path: req.file.path,
      size: req.file.size,
    });

    // Ensure the temp file has an audio extension (Whisper likes extensions)
    const guessExt =
      mime.extension(req.file.mimetype) ||
      (path.extname(req.file.originalname).slice(1) || "m4a");
    const withExtPath = req.file.path + "." + guessExt;
    fs.renameSync(req.file.path, withExtPath);

    // Send the renamed file to Whisper
    const stt = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: fs.createReadStream(withExtPath) as any,
      // language: "en", // optional
      // temperature: 0,
    });

    const text = (stt as any).text || "";
    console.log("🎤 Transcribed:", text);

    // Clean up temp file
    fs.unlink(withExtPath, () => {});
    return res.json({ text, sessionId: Math.random().toString(36).slice(2) });
  } catch (err) {
    console.error("STT error:", err);

    // Best-effort cleanup if either path exists
    try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
    try {
      const files = fs.readdirSync("uploads").filter(f => f.startsWith(req.file?.filename || ""));
      for (const f of files) fs.unlinkSync(path.join("uploads", f));
    } catch {}

    // Fallback so your app still flows
    return res.json({ text: "Hello Santa!", sessionId: Math.random().toString(36).slice(2) });
  }
});



// 2) Chat (LLM with graceful fallback when quota/keys fail)
app.post("/chat", async (req, res) => {
  const { childId = "demo-child", text = "" } = req.body || {};

  // Build messages, including child's name if we already know it
  const messages: any[] = [
    { role: "system", content: santaSystem },
  ];

 if (children[childId]?.name) {
  messages.push({
    role: "system",
    content: `The child's first name is ${children[childId].name}. Use it warmly sometimes.`,
  });
}


  messages.push({ role: "user", content: text });

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    let reply =
      resp.choices[0]?.message?.content ||
      "Pepper the elf is having a little trouble right now. Please try again soon.";

    // If the model included gift JSON, capture it
    const giftMatch = reply.match(/\{[\s\S]*"gift"[\s\S]*\}/);
    if (giftMatch) {
      try {
        const parsed = JSON.parse(giftMatch[0]);
        const g = parsed.gift;
        if (g?.item) {
          gifts[childId] ??= [];
          gifts[childId].push({
            item: g.item,
            details: g.details,
            at: new Date().toISOString(),
          });
        }
        reply = reply.replace(giftMatch[0], "").trim();
      } catch {}
    }

    // If the model included child name JSON, capture it
    // --- Extract child name JSON reliably ---
const nameRegex = /\{"child"\s*:\s*\{"name"\s*:\s*"([^"]+)"\}\}/;
const nameMatch = reply.match(nameRegex);

if (nameMatch) {
  const childName = nameMatch[1];
  if (childName) {
    children[childId] ??= {};
    children[childId].name = childName;
    console.log("📛 Saved child name:", childName);
  }

  // Remove JUST the JSON from Pepper's spoken reply
  reply = reply.replace(nameRegex, "").trim();
}


    return res.json({ replyText: reply });
  } catch (err: any) {
    console.error(
      "LLM error (using fallback):",
      err?.code || err?.message || err
    );

    // Pepper-style fallback
    const fallback = `Hee hee! I heard: "${text}". This is Pepper the elf, and I'll be sure to tell Santa. Keep being kind and helpful at home!`;

    const wish = text.match(/i (?:want|would like|wish for) (.+)/i);
    if (wish) {
      gifts[childId] ??= [];
      gifts[childId].push({
        item: wish[1],
        at: new Date().toISOString(),
      });
    }

    return res.json({ replyText: fallback });
  }
});


app.post("/speak", async (req, res) => {
  try {
    fs.mkdirSync("public", { recursive: true });

    const { text = "" } = req.body || {};

    // Pepper the elf: high, playful, helium-like
    const elfText = text;

    const tts = await openai.audio.speech.create({
  model: "gpt-4o-mini-tts",
  voice: "alloy",       // best bright voice
  input: elfText,
  response_format: "mp3",
  speed: 1.22            // slightly higher pitch
});


    const buf = Buffer.from(await tts.arrayBuffer());
    const fileName = `${Date.now()}-pepper.mp3`;
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








app.get("/gifts", (req, res) => {
  const childId = String(req.query.childId || "demo-child");
  res.json(gifts[childId] || []);
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log("Santa backend listening on", PORT);
});
