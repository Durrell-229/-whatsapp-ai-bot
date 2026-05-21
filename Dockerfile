FROM node:20-slim

ENV NODE_ENV=production

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
