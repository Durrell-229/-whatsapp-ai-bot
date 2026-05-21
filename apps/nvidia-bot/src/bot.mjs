import "dotenv/config";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import P from "pino";
import { startDashboard, logMessage, updateStats, stats, broadcastQR } from "./dashboard.mjs";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL   = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";
const BOT_NAME       = process.env.BOT_NAME || "Assistant WhatsApp";
const DASHBOARD_PORT = Number(process.env.PORT || process.env.DASHBOARD_PORT) || 3000;

if (!NVIDIA_API_KEY) { console.error("NVIDIA_API_KEY manquant dans .env"); process.exit(1); }

const history  = new Map();
const processed = new Set();

async function askNvidia(chatId, userMessage) {
  const msgs = history.get(chatId) || [];
  msgs.push({ role: "user", content: userMessage });
  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + NVIDIA_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
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

async function ocrImage(imageBase64, mimeType) {
  mimeType = mimeType || "image/jpeg";
  if (imageBase64.length >= 180000) return "(image trop grande pour OCR)";
  const res = await fetch("https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v1", {
    method: "POST",
    headers: { "Authorization": "Bearer " + NVIDIA_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ input: [{ type: "image_url", url: "data:" + mimeType + ";base64," + imageBase64 }] }),
  });
  if (!res.ok) throw new Error("OCR API [" + res.status + "]: " + await res.text());
  const json = await res.json();
  return (json.output?.[0]?.text?.trim()) || "(aucun texte detecte)";
}

function handleCommand(text, chatId) {
  switch (text.toLowerCase()) {
    case "!aide": case "!help":
      return BOT_NAME + " - Commandes:\n!aide - Cette aide\n!reset - Effacer historique\n!modele - Modele actif";
    case "!reset": case "!effacer":
      history.delete(chatId); return "Historique efface.";
    case "!modele": case "!model":
      return "Chat: " + NVIDIA_MODEL + "\nOCR: nvidia/nemotron-ocr-v1";
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
  const text     = (mc.conversation || mc.extendedTextMessage?.text || imageMsg?.caption || "").trim();

  logMessage({ kind: "user-in", chatId, text: isImage ? "[Image] " + (imageMsg?.caption || "") : text });
  console.log("[" + chatId + "] " + (isImage ? "[Image]" : text));

  if (isImage) {
    try {
      const buffer  = await downloadMediaMessage(msg, "buffer", {});
      const b64     = buffer.toString("base64");
      const mime    = imageMsg?.mimetype || "image/jpeg";
      const ocrText = await ocrImage(b64, mime);
      stats.ocrRequests++;
      updateStats({ ocrRequests: stats.ocrRequests });

      let reply;
      const caption = imageMsg?.caption?.trim();
      if (caption && !ocrText.startsWith("(")) {
        stats.aiRequests++;
        updateStats({ aiRequests: stats.aiRequests });
        const aiReply = await askNvidia(chatId, "Texte extrait: \"" + ocrText + "\"\nQuestion: " + caption);
        reply = "Texte extrait:\n" + ocrText + "\n\nReponse:\n" + aiReply;
      } else {
        reply = "Texte extrait de l image:\n\n" + ocrText;
      }
      await sock.sendMessage(chatId, { text: reply });
      logMessage({ kind: "bot-out", chatId, text: reply, tag: "ocr" });
    } catch (err) {
      stats.errors++;
      updateStats({ errors: stats.errors });
      console.error("Erreur OCR:", err.message);
      logMessage({ kind: "sys-error", msg: "OCR erreur: " + err.message });
      await sock.sendMessage(chatId, { text: "Impossible de lire cette image." });
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
    const aiReply = await askNvidia(chatId, text);
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
  updateStats({ status: "connecting", model: NVIDIA_MODEL, botName: BOT_NAME });
  logMessage({ kind: "sys-info", msg: "Bot en cours de demarrage (Baileys — sans Chrome)" });
  console.log("\nBot WhatsApp - NVIDIA NIM (" + NVIDIA_MODEL + ") - Baileys\n");
  await connectToWhatsApp();
}

main().catch(function(err) {
  console.error("Erreur fatale:", err);
  logMessage({ kind: "sys-error", msg: "Erreur fatale: " + err.message });
  process.exit(1);
});
