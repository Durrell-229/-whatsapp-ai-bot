FROM node:20-slim

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y git python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Rediriger SSH vers HTTPS (Render n'a pas de cles SSH GitHub)
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    git config --global url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app

# Copier uniquement le package.json du bot (standalone, sans workspace)
COPY apps/nvidia-bot/package.json ./package.json

# Installer les dependances (Baileys + express + pino)
RUN npm install --production

# Copier le code source et les fichiers statiques
COPY apps/nvidia-bot/src/ ./src/
COPY apps/nvidia-bot/public/ ./public/

EXPOSE 3000

CMD ["node", "src/bot.mjs"]
