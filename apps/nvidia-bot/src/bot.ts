import 'dotenv/config';
import { createClient } from '@open-wa/core';
import { Client } from '@open-wa/client';
import { PuppeteerDriver } from '@open-wa/driver-puppeteer';
import type { Message } from '@open-wa/schema';

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL   = process.env.NVIDIA_MODEL ?? 'meta/llama-3.1-70b-instruct';
const BOT_NAME       = process.env.BOT_NAME ?? 'Assistant WhatsApp';
const BOT_PREFIX     = process.env.BOT_PREFIX ?? '';

if (!NVIDIA_API_KEY) {
  console.error('NVIDIA_API_KEY manquant dans .env');
  process.exit(1);
}

const history = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

async function askNvidia(chatId: string, userMessage: string): Promise<string> {
  const msgs = history.get(chatId) ?? [];
  msgs.push({ role: 'user', content: userMessage });

  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [
        {
          role: 'system',
          content: `Tu es ${BOT_NAME}, un assistant IA sur WhatsApp. Reponds de facon concise et amicale dans la meme langue que l utilisateur.`,
        },
        ...msgs.slice(-20),
      ],
      temperature: 0.7,
      max_tokens: 1024,
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`Chat API [${res.status}]: ${await res.text()}`);

  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  const reply = json.choices[0]?.message?.content?.trim() ?? '(reponse vide)';
  msgs.push({ role: 'assistant', content: reply });
  history.set(chatId, msgs.slice(-20));
  return reply;
}

async function ocrImage(imageBase64: string, mimeType = 'image/jpeg'): Promise<string> {
  if (imageBase64.length >= 180_000) {
    return '(image trop grande pour OCR)';
  }

  const res = await fetch('https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v1', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      input: [{ type: 'image_url', url: `data:${mimeType};base64,${imageBase64}` }],
    }),
  });

  if (!res.ok) throw new Error(`OCR API [${res.status}]: ${await res.text()}`);

  const json = (await res.json()) as { output?: { text?: string }[] };
  return json.output?.[0]?.text?.trim() || '(aucun texte detecte)';
}

function handleCommand(text: string, chatId: string): string | null {
  switch (text.toLowerCase()) {
    case '!aide':
    case '!help':
      return [
        `Bot ${BOT_NAME} - Commandes :`,
        '',
        '!aide  - Cette aide',
        '!reset - Effacer historique',
        '!modele - Modele IA actif',
        '',
        'Envoyez une image pour extraire le texte (OCR).',
        'Envoyez du texte pour discuter avec l IA.',
      ].join('\n');
    case '!reset':
    case '!effacer':
      history.delete(chatId);
      return 'Historique efface.';
    case '!modele':
    case '!model':
      return `Chat : ${NVIDIA_MODEL}\nOCR  : nvidia/nemotron-ocr-v1`;
    default:
      return null;
  }
}

async function main() {
  console.log('\nBot WhatsApp - NVIDIA NIM');
  console.log(`Chat : ${NVIDIA_MODEL}`);
  console.log('OCR  : nvidia/nemotron-ocr-v1\n');

  const driver = new PuppeteerDriver({ headless: false });

  const core = await createClient({
    sessionId: 'nvidia-bot',
    driver,
    headless: false,
    blockAssets: false,
  });

  const client = new Client({ client: core, transport: core.getTransport() });

  const ready = new Promise<void>((resolve) =>
    core.events.on('client.ready', () => {
      console.log('\nWhatsApp connecte ! Bot operationnel.\n');
      resolve();
    })
  );

  await core.start();
  await ready;

  client.onMessage(async (msg: Message) => {
    if (msg.fromMe) return;

    const chatId  = msg.from;
    const isImage = msg.type === 'image' || msg.type === 'document';

    if (isImage) {
      console.log(`[${chatId}] Image recue - OCR en cours...`);
      try {
        await client.simulateTyping(chatId, true);
        const mediaData = await client.decryptMedia(msg);
        const b64 = (mediaData as Buffer).toString('base64');
        const mime = msg.mimetype ?? 'image/jpeg';
        const ocrText = await ocrImage(b64, mime);
        await client.simulateTyping(chatId, false);

        const caption = msg.caption?.trim();
        if (caption && !ocrText.startsWith('(')) {
          const prompt = `Texte extrait de l image :\n"${ocrText}"\n\nQuestion : ${caption}`;
          const aiReply = await askNvidia(chatId, prompt);
          await client.sendText(chatId, `Texte extrait :\n${ocrText}\n\nReponse :\n${aiReply}`);
        } else {
          await client.sendText(chatId, `Texte extrait de l image :\n\n${ocrText}`);
        }
      } catch (err) {
        await client.simulateTyping(chatId, false);
        console.error(`Erreur OCR [${chatId}]`, err);
        await client.sendText(chatId, 'Impossible de lire cette image. Essayez avec une image plus nette.');
      }
      return;
    }

    if (!msg.body?.trim()) return;
    const text  = msg.body.trim();
    const clean = BOT_PREFIX ? (text.startsWith(BOT_PREFIX) ? text.slice(BOT_PREFIX.length).trim() : null) : text;
    if (clean === null) return;

    console.log(`[${chatId}] ${clean}`);

    try {
      if (clean.startsWith('!')) {
        const cmdReply = handleCommand(clean, chatId);
        if (cmdReply) { await client.sendText(chatId, cmdReply); return; }
      }
      await client.simulateTyping(chatId, true);
      const aiReply = await askNvidia(chatId, clean);
      await client.simulateTyping(chatId, false);
      await client.sendText(chatId, aiReply);
      console.log(`Bot [${chatId}] ${aiReply.slice(0, 100)}`);
    } catch (err) {
      await client.simulateTyping(chatId, false);
      console.error(`Erreur Chat [${chatId}]`, err);
      await client.sendText(chatId, 'Erreur IA. Veuillez reessayer.');
    }
  });

  const stop = async (sig: string) => { console.log(`\nArret : ${sig}`); await core.stop(sig); process.exit(0); };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((err) => { console.error('Erreur fatale :', err); process.exit(1); });
