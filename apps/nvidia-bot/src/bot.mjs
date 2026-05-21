import "dotenv/config";
import { createClient } from "@open-wa/core";
import { Client } from "@open-wa/client";
import { PuppeteerDriver } from "@open-wa/driver-puppeteer";
import { startDashboard, logMessage, updateStats, stats, setPage, broadcastQR } from "./dashboard.mjs";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL   = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";
const BOT_NAME       = process.env.BOT_NAME || "Assistant WhatsApp";
const DASHBOARD_PORT = Number(process.env.PORT || process.env.DASHBOARD_PORT) || 3000;

// Chemin Chrome : variable d'env > Linux (Render) > Windows
const CHROME_PATH = process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/chromium");

// Sur Render ou serveur : headless obligatoire
const IS_HEADLESS = process.env.HEADLESS === "true" || !!process.env.RENDER || process.platform !== "win32";

if (!NVIDIA_API_KEY) { console.error("NVIDIA_API_KEY manquant dans .env"); process.exit(1); }

const history = new Map();
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

async function handleMessage(msg, client) {
  const msgId = msg.id?._serialized || msg.id || (msg.from + "_" + Date.now());
  if (processed.has(msgId)) return;
  processed.add(msgId);
  if (processed.size > 500) { const first = processed.values().next().value; processed.delete(first); }

  if (msg.fromMe) return;
  const chatId = msg.from || msg.chatId;
  if (!chatId) return;

  stats.messagesReceived++;
  updateStats({ messagesReceived: stats.messagesReceived });

  const inText = msg.body || msg.content || (msg.type === "image" ? "[Image]" : "[Fichier]");
  logMessage({ kind: "user-in", chatId, text: inText });
  console.log("[" + chatId + "] " + inText);

  const isImage = msg.type === "image" || msg.type === "document";

  if (isImage) {
    try {
      const mediaData = await client.decryptMedia(msg);
      const b64 = Buffer.from(mediaData).toString("base64");
      const ocrText = await ocrImage(b64, msg.mimetype || "image/jpeg");
      stats.ocrRequests++;
      updateStats({ ocrRequests: stats.ocrRequests });
      const caption = msg.caption?.trim();
      let reply;
      if (caption && !ocrText.startsWith("(")) {
        stats.aiRequests++;
        updateStats({ aiRequests: stats.aiRequests });
        const aiReply = await askNvidia(chatId, "Texte extrait: \"" + ocrText + "\"\nQuestion: " + caption);
        reply = "Texte extrait:\n" + ocrText + "\n\nReponse:\n" + aiReply;
      } else {
        reply = "Texte extrait de l image:\n\n" + ocrText;
      }
      await client.sendText(chatId, reply);
      logMessage({ kind: "bot-out", chatId, text: reply, tag: "ocr" });
    } catch (err) {
      stats.errors++;
      updateStats({ errors: stats.errors });
      console.error("Erreur OCR:", err.message);
      logMessage({ kind: "sys-error", msg: "OCR erreur: " + err.message });
      await client.sendText(chatId, "Impossible de lire cette image.");
    }
    return;
  }

  const text = (msg.body || msg.content || "").trim();
  if (!text) return;

  try {
    if (text.startsWith("!")) {
      const r = handleCommand(text, chatId);
      if (r) {
        stats.commandsExecuted++;
        updateStats({ commandsExecuted: stats.commandsExecuted });
        await client.sendText(chatId, r);
        logMessage({ kind: "bot-out", chatId, text: r, tag: "cmd" });
        return;
      }
    }
    stats.aiRequests++;
    updateStats({ aiRequests: stats.aiRequests });
    const aiReply = await askNvidia(chatId, text);
    await client.sendText(chatId, aiReply);
    logMessage({ kind: "bot-out", chatId, text: aiReply, tag: "ai" });
    console.log("Bot -> " + aiReply.slice(0, 100));
  } catch (err) {
    stats.errors++;
    updateStats({ errors: stats.errors });
    console.error("Erreur Chat:", err.message);
    logMessage({ kind: "sys-error", msg: "Erreur IA: " + err.message });
    await client.sendText(chatId, "Erreur IA. Veuillez reessayer.");
  }
}

async function main() {
  startDashboard(DASHBOARD_PORT);
  updateStats({ status: "connecting", model: NVIDIA_MODEL, botName: BOT_NAME });
  logMessage({ kind: "sys-info", msg: "Bot en cours de demarrage... (headless=" + IS_HEADLESS + ")" });
  console.log("\nBot WhatsApp - NVIDIA NIM (" + NVIDIA_MODEL + ")\nHeadless:", IS_HEADLESS, "| Chrome:", CHROME_PATH, "\n");

  const driver = new PuppeteerDriver({
    headless: IS_HEADLESS,
    executablePath: CHROME_PATH,
    args: IS_HEADLESS ? [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ] : [],
  });

  const core = await createClient({
    sessionId: "nvidia-bot",
    driver,
    headless: IS_HEADLESS,
    blockAssets: false,
    executablePath: CHROME_PATH,
    qrTimeoutMs: 0,      // Attendre indefiniment le scan du QR
    authTimeoutMs: 0,    // Attendre indefiniment l'authentification
  });

  const client = new Client({ client: core, transport: core.getTransport() });

  const ready = new Promise(function(resolve) {
    core.events.on("client.ready", function() {
      console.log("\nWhatsApp connecte! Bot operationnel.\n");
      updateStats({ status: "connected" });
      logMessage({ kind: "sys-info", msg: "WhatsApp connecte — bot operationnel ✓" });
      resolve();
    });
  });

  // Enregistrer le listener QR AVANT core.start() pour ne pas rater l'evenement
  const transport = core.getTransport();

  // Enregistrer la page puppeteer dès qu'elle est disponible
  function trySetPage() {
    const page = transport.getPage();
    if (page) { setPage(page); console.log("[OK] Page puppeteer enregistree pour /screenshot"); }
  }

  // Utiliser le texte QR du payload (data-ref du canvas) — bien plus fiable qu'un screenshot
  function sendQRToDashboard(payload) {
    try {
      const qrText = payload?.details?.qr;
      if (!qrText) { console.log("[QR] payload.details.qr manquant:", JSON.stringify(payload)?.slice(0, 200)); return; }
      broadcastQR(qrText);
      console.log("[QR] Texte QR envoye au dashboard (attempt " + (payload?.details?.attemptInThisCycle || 1) + ")");
      logMessage({ kind: "sys-info", msg: "QR code disponible — scannez avec WhatsApp" });
      trySetPage();
    } catch (e) { console.error("[QR] Erreur:", e.message); }
  }

  core.events.on("launch.auth.qr.generated", sendQRToDashboard);

  await core.start();

  // Page disponible apres core.start()
  const ipage = transport.getPage();
  if (ipage) { setPage(ipage); console.log("[OK] Page enregistree pour /screenshot"); }

  await ready;

  try {
    client.onMessage(async function(msg) { await handleMessage(msg, client); });
    console.log("[OK] client.onMessage enregistre");
  } catch (e) {
    console.log("[WARN] client.onMessage echoue:", e.message);
  }

  for (const evName of ["message.received", "message.any"]) {
    core.events.on(evName, async function(payload) {
      try {
        const msg = payload.message || payload.msg || payload;
        await handleMessage(msg, client);
      } catch (err) {
        console.error("Erreur [" + evName + "]:", err.message);
      }
    });
  }

  core.events.on("**", function(payload, sessionId, evName) {
    if (evName && typeof evName === "string" && (evName.startsWith("message") || evName.startsWith("Message"))) {
      console.log("[DEBUG]", evName, "->", JSON.stringify(payload).slice(0, 150));
    }
  });

  logMessage({ kind: "sys-info", msg: "Pret — en attente de messages WhatsApp" });
  console.log("\nPret. Envoyez un message WhatsApp pour tester.\n");

  function stop(sig) {
    updateStats({ status: "disconnected" });
    logMessage({ kind: "sys-error", msg: "Arret du bot: " + sig });
    core.stop(sig).then(function() { process.exit(0); });
  }
  process.on("SIGINT", function() { stop("SIGINT"); });
  process.on("SIGTERM", function() { stop("SIGTERM"); });
}

main().catch(function(err) {
  console.error("Erreur fatale:", err);
  logMessage({ kind: "sys-error", msg: "Erreur fatale: " + err.message });
  process.exit(1);
});
