import "dotenv/config";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import P from "pino";
import { execFile } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startDashboard, logMessage, updateStats, stats, broadcastQR } from "./dashboard.mjs";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const BOT_NAME       = process.env.BOT_NAME || "Assistant WhatsApp";
const DASHBOARD_PORT = Number(process.env.PORT || process.env.DASHBOARD_PORT) || 3000;

if (!NVIDIA_API_KEY) { console.error("NVIDIA_API_KEY manquant dans .env"); process.exit(1); }

const history  = new Map();
const processed = new Set();

async function askQwen(chatId, userMessage, imageBase64, imageMime) {
  const msgs = history.get(chatId) || [];

  const userContent = imageBase64
    ? [
        { type: "text", text: userMessage },
        { type: "image_url", image_url: { url: "data:" + (imageMime || "image/jpeg") + ";base64," + imageBase64 } }
      ]
    : userMessage;

  msgs.push({ role: "user", content: userContent });

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + NVIDIA_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen/qwen3.5-397b-a17b",
      messages: [
        { role: "system", content: "Tu es " + BOT_NAME + ", un assistant IA sur WhatsApp. Reponds de facon concise et amicale dans la meme langue que l utilisateur." },
        ...msgs.slice(-20),
      ],
      temperature: 0.7, max_tokens: 1024, stream: false,
    }),
  });
  if (!res.ok) throw new Error("Chat API [" + res.status + "]: " + await res.text());
  const json = await res.json();
  const reply = (json.choices[0]?.message?.content || "(reponse vide)").trim();
  msgs.push({ role: "assistant", content: reply });
  history.set(chatId, msgs.slice(-20));
  return reply;
}

async function transcribeAudio(audioBuffer) {
  return new Promise((resolve, reject) => {
    const tmpFile = join(tmpdir(), "audio_" + Date.now() + ".ogg");
    try {
      writeFileSync(tmpFile, audioBuffer);
      execFile("python3", ["transcribe.py", tmpFile, NVIDIA_API_KEY], { timeout: 30000 }, (err, stdout) => {
        try { unlinkSync(tmpFile); } catch {}
        if (err) return reject(new Error("Transcription erreur: " + err.message));
        try {
          const result = JSON.parse(stdout);
          if (result.success) resolve(result.text);
          else reject(new Error(result.error || "Transcription échouée"));
        } catch (e) {
          reject(new Error("Parse erreur: " + e.message));
        }
      });
    } catch (err) {
      try { unlinkSync(tmpFile); } catch {}
      reject(err);
    }
  });
}

function handleCommand(text, chatId) {
  switch (text.toLowerCase()) {
    case "!aide": case "!help":
      return BOT_NAME + " - Commandes:\n!aide - Cette aide\n!reset - Effacer historique\n!modele - Modele actif";
    case "!reset": case "!effacer":
      history.delete(chatId); return "Historique efface.";
    case "!modele": case "!model":
      return "Modele: Qwen 3.5-397B (texte + images + francais)";
    default: return null;
  }
}

async function handleMessage(msg, sock) {
  const msgId = msg.key.id;
  if (!msgId || processed.has(msgId)) return;
  processed.add(msgId);
  if (processed.size > 500) { const first = processed.values().next().value; processed.delete(first); }

  if (msg.key.fromMe) return;
  const chatId = msg.key.remoteJid;
  if (!chatId || chatId === "status@broadcast") return;

  stats.messagesReceived++;
  updateStats({ messagesReceived: stats.messagesReceived });

  const mc = msg.message;
  if (!mc) return;

  const imageMsg = mc.imageMessage || mc.documentWithCaptionMessage?.message?.imageMessage;
  const isImage  = !!imageMsg;
  const audioMsg = mc.audioMessage || mc.documentWithCaptionMessage?.message?.audioMessage;
  const isAudio  = !!audioMsg;
  const text     = (mc.conversation || mc.extendedTextMessage?.text || imageMsg?.caption || "").trim();

  if (isImage) logMessage({ kind: "user-in", chatId, text: "[Image] " + (imageMsg?.caption || "") });
  else if (isAudio) logMessage({ kind: "user-in", chatId, text: "[Message vocal]" });
  else logMessage({ kind: "user-in", chatId, text });
  console.log("[" + chatId + "] " + (isImage ? "[Image]" : isAudio ? "[Audio]" : text));

  if (isImage) {
    try {
      if (!imageMsg?.mediaKey) {
        await sock.sendMessage(chatId, { text: "Image non déchiffrable (clé media manquante)." });
        logMessage({ kind: "sys-error", msg: "Image erreur: clé media manquante" });
        return;
      }
      const buffer  = await downloadMediaMessage(msg, "buffer", {});
      const b64     = buffer.toString("base64");
      const mime    = imageMsg?.mimetype || "image/jpeg";
      const caption = (imageMsg?.caption || "").trim();

      if (b64.length >= 180000) {
        await sock.sendMessage(chatId, { text: "Image trop grande, impossible à analyser." });
        return;
      }

      stats.aiRequests++;
      updateStats({ aiRequests: stats.aiRequests });

      const prompt = caption ? "Question sur l image: " + caption : "Decris cette image en detail";
      const reply = await askQwen(chatId, prompt, b64, mime);

      await sock.sendMessage(chatId, { text: reply });
      logMessage({ kind: "bot-out", chatId, text: reply, tag: "image" });
    } catch (err) {
      stats.errors++;
      updateStats({ errors: stats.errors });
      console.error("Erreur Image:", err.message);
      logMessage({ kind: "sys-error", msg: "Erreur image: " + err.message });
      await sock.sendMessage(chatId, { text: "Impossible d'analyser cette image." });
    }
    return;
  }

  if (isAudio) {
    try {
      if (!audioMsg?.mediaKey) {
        await sock.sendMessage(chatId, { text: "Fichier audio non déchiffrable." });
        logMessage({ kind: "sys-error", msg: "Audio erreur: clé media manquante" });
        return;
      }
      const buffer = await downloadMediaMessage(msg, "buffer", {});

      if (buffer.length >= 5000000) {
        await sock.sendMessage(chatId, { text: "Fichier audio trop volumineux (max 5MB)." });
        return;
      }

      stats.aiRequests++;
      updateStats({ aiRequests: stats.aiRequests });

      const transcription = await transcribeAudio(buffer);
      console.log("[Transcription] " + transcription);
      logMessage({ kind: "user-in", chatId, text: transcription, tag: "audio-transcript" });

      const reply = await askQwen(chatId, transcription);
      await sock.sendMessage(chatId, { text: reply });
      logMessage({ kind: "bot-out", chatId, text: reply, tag: "audio-reply" });
    } catch (err) {
      stats.errors++;
      updateStats({ errors: stats.errors });
      console.error("Erreur Audio:", err.message);
      logMessage({ kind: "sys-error", msg: "Erreur audio: " + err.message });
      await sock.sendMessage(chatId, { text: "Impossible de transcrire ce message vocal." });
    }
    return;
  }

  if (!text) return;

  try {
    if (text.startsWith("!")) {
      const r = handleCommand(text, chatId);
      if (r) {
        stats.commandsExecuted++;
        updateStats({ commandsExecuted: stats.commandsExecuted });
        await sock.sendMessage(chatId, { text: r });
        logMessage({ kind: "bot-out", chatId, text: r, tag: "cmd" });
        return;
      }
    }
    stats.aiRequests++;
    updateStats({ aiRequests: stats.aiRequests });
    const aiReply = await askQwen(chatId, text);
    await sock.sendMessage(chatId, { text: aiReply });
    logMessage({ kind: "bot-out", chatId, text: aiReply, tag: "ai" });
    console.log("Bot -> " + aiReply.slice(0, 100));
  } catch (err) {
    stats.errors++;
    updateStats({ errors: stats.errors });
    console.error("Erreur Chat:", err.message);
    logMessage({ kind: "sys-error", msg: "Erreur IA: " + err.message });
    await sock.sendMessage(chatId, { text: "Erreur IA. Veuillez reessayer." });
  }
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_state");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state,
    printQRInTerminal: true,
    browser: ["WhatsApp Bot", "Chrome", "120.0.0"],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      broadcastQR(qr);
      updateStats({ status: "connecting" });
      logMessage({ kind: "sys-info", msg: "QR code disponible — scannez avec WhatsApp" });
      console.log("[QR] Code QR envoye au dashboard");
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : null;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logMessage({ kind: "sys-error", msg: "Connexion fermee (code: " + code + "). Reconnexion: " + shouldReconnect });
      updateStats({ status: "connecting" });
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000);
      } else {
        updateStats({ status: "disconnected" });
        logMessage({ kind: "sys-error", msg: "Session expiree — supprimez le dossier auth_state pour re-scanner" });
      }
    } else if (connection === "open") {
      console.log("\nWhatsApp connecte! Bot operationnel.\n");
      updateStats({ status: "connected" });
      logMessage({ kind: "sys-info", msg: "WhatsApp connecte — bot operationnel ✓" });
      broadcastQR(null);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try { await handleMessage(msg, sock); } catch (e) { console.error("Erreur message:", e.message); }
    }
  });
}

async function main() {
  startDashboard(DASHBOARD_PORT);
  updateStats({ status: "connecting", botName: BOT_NAME });
  logMessage({ kind: "sys-info", msg: "Bot en cours de demarrage (Baileys + Qwen 3.5 multimodal)" });
  console.log("\nBot WhatsApp - NVIDIA NIM Qwen 3.5 - Baileys\n");
  await connectToWhatsApp();
}

main().catch(function(err) {
  console.error("Erreur fatale:", err);
  logMessage({ kind: "sys-error", msg: "Erreur fatale: " + err.message });
  process.exit(1);
});
