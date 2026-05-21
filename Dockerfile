FROM node:20-slim

# Chromium + dependances necessaires pour WhatsApp Web
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium
ENV HEADLESS=true
ENV NODE_ENV=production

RUN npm install -g pnpm@10

WORKDIR /app

# Copier les fichiers de config workspace
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json tsconfig.json ./

# Copier tous les packages et l'app
COPY packages/ ./packages/
COPY apps/nvidia-bot/ ./apps/nvidia-bot/

# Installer les dependances
RUN pnpm install --no-frozen-lockfile

# Compiler tous les packages (pnpm gere l'ordre des dependances automatiquement)
RUN pnpm -r --if-present build

EXPOSE 3000

CMD ["node", "apps/nvidia-bot/src/bot.mjs"]
