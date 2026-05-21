<div align="center">

# 🤖 WhatsApp AI Bot

**Bot WhatsApp intelligent propulsé par NVIDIA NIM (LLaMA 3.1 70B + OCR)**

Développé par **Leonard Durrell** · [leoadg229@gmail.com](mailto:leoadg229@gmail.com)

---

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js)](https://nodejs.org)
[![NVIDIA NIM](https://img.shields.io/badge/NVIDIA-NIM%20API-76b900?logo=nvidia)](https://www.nvidia.com/en-us/ai/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Web-25D366?logo=whatsapp)](https://web.whatsapp.com)
[![License](https://img.shields.io/badge/Licence-MIT-blue)](LICENSE)

</div>

---

## ✨ Fonctionnalités

- 💬 **Chat IA** — Conversations intelligentes via LLaMA 3.1 70B (NVIDIA NIM)
- 🔍 **OCR automatique** — Extraction de texte depuis les images envoyées
- 📊 **Dashboard en temps réel** — Interface web dark avec stats live et bulles de messages
- 📱 **QR Code intégré** — Scan du QR directement depuis le dashboard
- 🔄 **Historique de conversation** — Contexte maintenu par session WhatsApp
- ⚡ **Commandes rapides** — `!aide`, `!reset`, `!modele`

---

## 🚀 Démarrage rapide

### Prérequis

- [Node.js 20+](https://nodejs.org)
- [pnpm](https://pnpm.io) : `npm install -g pnpm`
- Google Chrome installé
- Une clé API NVIDIA NIM

### Installation

```bash
# Cloner le projet
git clone https://github.com/Durrell-229/whatsapp-ai-bot.git
cd whatsapp-ai-bot

# Installer les dépendances
pnpm install

# Builder les packages
pnpm --filter @open-wa/schema build
pnpm --filter @open-wa/logger build
pnpm --filter @open-wa/hyperemitter build
pnpm --filter @open-wa/utils build
pnpm --filter @open-wa/driver-interface build
pnpm --filter @open-wa/domain build
pnpm --filter @open-wa/core build
pnpm --filter @open-wa/client build
pnpm --filter @open-wa/driver-puppeteer build
```

### Configuration

Créez le fichier `apps/nvidia-bot/.env` :

```env
NVIDIA_API_KEY=votre_clé_api_nvidia
NVIDIA_MODEL=meta/llama-3.1-70b-instruct
BOT_NAME=Assistant WhatsApp
DASHBOARD_PORT=3000
```

### Lancement

```bash
pnpm --filter @open-wa/nvidia-bot start
```

Ouvrez ensuite **http://localhost:3000** dans votre navigateur.

---

## 📊 Dashboard

Le dashboard affiche en temps réel :

| Section | Contenu |
|---|---|
| **Barre du haut** | Nom du bot, statut de connexion, uptime |
| **Sidebar** | Statistiques (messages, OCR, IA, erreurs) |
| **Zone principale** | Flux de messages en bulles style WhatsApp |
| **Overlay QR** | QR code à scanner au démarrage |

---

## 🤖 Commandes WhatsApp

| Commande | Action |
|---|---|
| `!aide` | Affiche la liste des commandes |
| `!reset` | Efface l'historique de conversation |
| `!modele` | Affiche les modèles IA utilisés |
| _Texte libre_ | Réponse IA via LLaMA 3.1 70B |
| _Image_ | Extraction de texte OCR automatique |

---

## ☁️ Hébergement sur Render (gratuit)

### Étape 1 — Pousser sur GitHub

```bash
git remote set-url origin https://github.com/Durrell-229/whatsapp-ai-bot.git
git add .
git commit -m "Deploy WhatsApp AI Bot"
git push -u origin main
```

### Étape 2 — Configurer Render

1. Allez sur [render.com](https://render.com) → **New → Web Service**
2. Connectez votre repo GitHub
3. Choisissez **Docker** comme environment
4. Ajoutez les variables d'environnement :

| Variable | Valeur |
|---|---|
| `NVIDIA_API_KEY` | Votre clé API |
| `NVIDIA_MODEL` | `meta/llama-3.1-70b-instruct` |
| `BOT_NAME` | `Assistant WhatsApp` |
| `HEADLESS` | `true` |

5. Cliquez **Deploy**

### Étape 3 — Garder actif 24h/24

Le plan gratuit Render dort après 15 min. Solution :
- Créez un compte sur [uptimerobot.com](https://uptimerobot.com)
- Ajoutez un moniteur HTTP sur `https://votre-app.onrender.com/health`
- Intervalle : **5 minutes**

---

## 🐳 Docker

```bash
# Build
docker build -t whatsapp-ai-bot .

# Run
docker run -p 3000:3000 \
  -e NVIDIA_API_KEY=votre_clé \
  -e HEADLESS=true \
  whatsapp-ai-bot
```

---

## 🏗️ Architecture

```
wa-automate-nodejs/
├── apps/
│   └── nvidia-bot/           # Bot principal
│       ├── src/
│       │   ├── bot.mjs       # Logique du bot + handlers
│       │   └── dashboard.mjs # Serveur Express + SSE
│       ├── public/
│       │   └── index.html    # Interface web dashboard
│       └── .env              # Configuration
├── packages/
│   ├── core/                 # Runtime WhatsApp Web
│   ├── client/               # Client + EventManager
│   ├── driver-puppeteer/     # Driver Chrome/Chromium
│   └── schema/               # Types et schémas Zod
└── Dockerfile                # Image Docker pour déploiement
```

---

## 🔑 API NVIDIA NIM

Ce bot utilise deux modèles NVIDIA :

| Modèle | Usage | Endpoint |
|---|---|---|
| `meta/llama-3.1-70b-instruct` | Chat IA | `integrate.api.nvidia.com/v1/chat/completions` |
| `nvidia/nemotron-ocr-v1` | Extraction de texte | `ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v1` |

Obtenez votre clé API sur [build.nvidia.com](https://build.nvidia.com).

---

## 📝 Licence

MIT — Libre d'utilisation, de modification et de distribution.

---

<div align="center">

**Développé avec ❤️ par Leonard Durrell**

[leoadg229@gmail.com](mailto:leoadg229@gmail.com) · [GitHub](https://github.com/Durrell-229)

> Ce projet utilise [open-wa/wa-automate-nodejs](https://github.com/open-wa/wa-automate-nodejs) comme base technique.
> WhatsApp est une marque de Meta Platforms, Inc. Ce projet n'est pas affilié à WhatsApp ni à Meta.

</div>
