FROM node:20-slim

ENV NODE_ENV=production
ENV REBUILD_TIMESTAMP=2026-05-21T19:25

RUN apt-get update && apt-get install -y git python3 python3-pip make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Rediriger SSH vers HTTPS (Render n'a pas de cles SSH GitHub)
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    git config --global url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app

# Copier uniquement le package.json du bot (standalone, sans workspace)
COPY apps/nvidia-bot/package.json ./package.json

# Installer les dependances (Baileys + express + pino)
RUN npm install --production

# Installer OpenAI pour la transcription vocale (Whisper)
RUN pip install --no-cache-dir --break-system-packages openai

# Copier le code source, les fichiers statiques et le script Python
COPY apps/nvidia-bot/src/ ./src/
COPY apps/nvidia-bot/public/ ./public/
COPY apps/nvidia-bot/transcribe.py ./transcribe.py
RUN chmod +x ./transcribe.py

EXPOSE 3000

CMD ["node", "src/bot.mjs"]
