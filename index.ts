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
const santaSystem = `You are Santa. Be warm, brief (1–3 sentences). Encourage kindness and listening without shaming.
If the child mentions a gift wish, include a JSON line at the end like:
{"gift":{"item":"red bike","details":{"color":"red"}}}`;

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

  const messages = [
    { role: "system", content: santaSystem },
    { role: "user", content: text }
  ];

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    let reply = resp.choices[0]?.message?.content || "Ho ho ho! Merry Christmas!";

    // If the model included gift JSON, capture it
    const m = reply.match(/\{[\s\S]*"gift"[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        const g = parsed.gift;
        if (g?.item) {
          gifts[childId] ??= [];
          gifts[childId].push({ item: g.item, details: g.details, at: new Date().toISOString() });
        }
        reply = reply.replace(/\{[\s\S]*"gift"[\s\S]*\}/, "").trim();
      } catch {}
    }

    return res.json({ replyText: reply });
  } catch (err: any) {
    console.error("LLM error (using fallback):", err?.code || err?.message || err);
    const fallback = `Ho ho ho! I heard: "${text}". I'll tell the elves! Keep being kind and helpful at home.`;

    const wish = text.match(/i (?:want|would like|wish for) (.+)/i);
    if (wish) {
      gifts[childId] ??= [];
      gifts[childId].push({ item: wish[1], at: new Date().toISOString() });
    }

    return res.json({ replyText: fallback });
  }
});


app.post("/speak", async (req, res) => {
  try {
    fs.mkdirSync("public", { recursive: true });

    const { text = "" } = req.body || {};

    // 💬 Adjust tone for deep, grandpa-like Santa
    const santaText =
  `Ho ho ho… *cough*, pardon me there. ${text}. ` +
  `This is Santa… comin’ to you in my old raspy voice. ` +
  `You know, after all these winters by the fire and all these years talkin’ to children, ` +
  `my voice has gotten a bit rough around the edges. ` +
  `But don’t you worry — I’m still jolly, still listenin’, and still proud of you. ` +
  `Now remember… good behavior and kindness warm this old heart more than anything under the tree.`;



    // 🧑‍🎤 Deep & grandpa-like tone
    // "alloy" produces a fuller, deeper timbre than "verse"
    // You can try "alloy", "brass", or "onyx" (if available)
    const tts = await openai.audio.speech.create({
  model: "gpt-4o-mini-tts",
  voice: "onyx", // deeper, more mature-sounding
  input: santaText,
  response_format: "mp3",
});


    const buf = Buffer.from(await tts.arrayBuffer());
    const fileName = `${Date.now()}-santa.mp3`;
    fs.writeFileSync(path.join("public", fileName), buf);

    return res.json({
      audioUrl: `${process.env.PUBLIC_BASE_URL}/${fileName}`
    });
  } catch (err) {
    console.error("TTS error:", err);
    const { text = "" } = req.body || {};
    const fileName = `${Date.now()}-santa.txt`;
    fs.writeFileSync(path.join("public", fileName), text, "utf-8");
    return res.json({
      audioUrl: `${process.env.PUBLIC_BASE_URL}/${fileName}`
    });
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
