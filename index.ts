// @ts-nocheck
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import mime from "mime-types";
import { OpenAI } from "openai";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory storage
const gifts: Record<string, Array<{ item: string; details?: any; at: string }>> = {};

// ---------- Helpers ----------

function buildPepperSystemPrompt(childName?: string) {
  let base = `You are Pepper, one of Santa's helper elves in the North Pole.
You sound cheerful, playful, and kind. Always answer like Pepper the elf.
Your TOP priority is to respond directly to what the child just said.
Do NOT ignore what they say and do NOT keep asking open questions like "What can I help you with today?".
Only ask what they need help with if they literally only said hello and gave no other information.
Keep your replies short: 1–2 simple sentences.
Encourage good listening and kindness, but do not lecture or be scary.
Do NOT ask the child for their name; the parent has already provided it.`;

  if (childName && childName.trim().length > 0) {
    base += ` The child's first name is ${childName.trim()}. Use their name sometimes in a warm, friendly way, but do not overuse it.`;
  }

  base += `
If the child mentions a gift wish, include a JSON line at the very end like:
{"gift":{"item":"red bike","details":{"notes":"any extra info here"}}}`;

  return base;
}


// ---------- Routes ----------

// Health check
app.get("/", (_req, res) => {
  res.send("Pepper backend is running. Use /transcribe, /chat, /speak, /gifts");
});

// 1) STT: audio -> text
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    console.log("Uploaded file:", {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      path: req.file.path,
      size: req.file.size,
    });

    const filePath = req.file.path;
    const detectedType =
      req.file.mimetype || mime.lookup(req.file.originalname) || "audio/m4a";

    const transcription = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file: fs.createReadStream(filePath) as any,
      mime_type: String(detectedType),
    });

    const text = transcription.text || "Hello Pepper!";
    console.log("🎤 Transcribed:", text);

    // Clean up
    fs.unlink(filePath, () => {});
    return res.json({ text });
  } catch (err: any) {
    console.error("STT error:", err?.message || err);
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.json({ text: "Hello Pepper!" });
  }
});

// 2) Chat: child text -> Pepper reply (+ capture gifts)
app.post("/chat", async (req, res) => {
  const {
    childId = "demo-child",
    childName = "",
    text = "",
  } = req.body || {};

  try {
    const systemPrompt = buildPepperSystemPrompt(childName);

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ];

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    let reply =
      resp.choices[0]?.message?.content ||
      "Pepper the elf is having a little trouble right now. Please try again soon.";
        console.log("Pepper raw reply:", reply);

    // If Pepper gives a generic "how can I help" style answer, override it
    const genericRegex = /(what can i help you with today|how can i help you today|what can i help you with)/i;
    if (genericRegex.test(reply)) {
      reply = `I heard you say: "${text}". I'm Pepper the elf here in Santa's workshop, and that sounds very important!`;
    }


    // Extract gift JSON if present
    const giftMatch = reply.match(/\{"gift"[\s\S]*\}/);
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

    return res.json({ replyText: reply });
  } catch (err: any) {
    console.error(
      "LLM error (using fallback):",
      err?.code || err?.message || err
    );

    const fallback = `This is Pepper the elf! I heard: "${text}". I'll be sure to tell Santa. Keep being kind and helpful at home!`;

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

// 3) TTS: Pepper reply -> MP3
app.post("/speak", async (req, res) => {
  try {
    fs.mkdirSync("public", { recursive: true });

    const { text = "" } = req.body || {};
    const elfText = text; // No extra fluff, just Pepper's reply

    const tts = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy", // bright, elf-like
      input: elfText,
      response_format: "mp3",
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

// 4) Gift list per child
app.get("/gifts", (req, res) => {
  const childId = String(req.query.childId || "demo-child");
  res.json(gifts[childId] || []);
});

// Start server
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log("Pepper backend listening on", PORT);
});
