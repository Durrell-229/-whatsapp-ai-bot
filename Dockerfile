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
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./

# Copier tous les packages necessaires
COPY packages/schema/       ./packages/schema/
COPY packages/logger/       ./packages/logger/
COPY packages/hyperemitter/ ./packages/hyperemitter/
COPY packages/utils/        ./packages/utils/
COPY packages/driver-interface/ ./packages/driver-interface/
COPY packages/domain/       ./packages/domain/
COPY packages/core/         ./packages/core/
COPY packages/client/       ./packages/client/
COPY packages/driver-puppeteer/ ./packages/driver-puppeteer/
COPY apps/nvidia-bot/       ./apps/nvidia-bot/

# Installer les dependances
RUN pnpm install --no-frozen-lockfile

# Build dans l'ordre des dependances
RUN pnpm --filter @open-wa/schema build
RUN pnpm --filter @open-wa/logger build
RUN pnpm --filter @open-wa/hyperemitter build
RUN pnpm --filter @open-wa/utils build
RUN pnpm --filter @open-wa/driver-interface build
RUN pnpm --filter @open-wa/domain build
RUN pnpm --filter @open-wa/core build
RUN pnpm --filter @open-wa/client build
RUN pnpm --filter @open-wa/driver-puppeteer build

EXPOSE 3000

CMD ["node", "apps/nvidia-bot/src/bot.mjs"]
