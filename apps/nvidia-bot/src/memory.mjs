import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";

const MEMORY_DIR = "./chat_memory";

function ensureMemoryDir() {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function getMemoryFile(chatId) {
  return join(MEMORY_DIR, `${chatId}.json`);
}

export function loadHistory(chatId) {
  ensureMemoryDir();
  const file = getMemoryFile(chatId);
  if (existsSync(file)) {
    try {
      const data = readFileSync(file, "utf-8");
      return JSON.parse(data);
    } catch (e) {
      console.error("Erreur lecture mémoire:", e.message);
      return [];
    }
  }
  return [];
}

export function saveHistory(chatId, messages) {
  ensureMemoryDir();
  const file = getMemoryFile(chatId);
  try {
    writeFileSync(file, JSON.stringify(messages, null, 2), "utf-8");
  } catch (e) {
    console.error("Erreur sauvegarde mémoire:", e.message);
  }
}

export function clearHistory(chatId) {
  const file = getMemoryFile(chatId);
  try {
    if (existsSync(file)) {
      writeFileSync(file, JSON.stringify([], null, 2), "utf-8");
    }
  } catch (e) {
    console.error("Erreur suppression mémoire:", e.message);
  }
}
