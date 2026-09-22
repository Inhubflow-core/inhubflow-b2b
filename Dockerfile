FROM node:22-slim

# Install system dependencies needed for better-sqlite3 compilation and certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definitions and install all dependencies (including devDependencies like TypeScript)
COPY package*.json ./
RUN npm ci --include=dev

COPY . .

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Ensure standard production environment for Next.js build and runtime
ENV NODE_ENV=production

# Build Next.js application
RUN npm run build

# Data directory and uploads — mount a volume at /data to persist DB and persistent files
RUN mkdir -p /data/uploads/workflow-attachments /app/public/uploads/workflow-attachments && \
    chown -R node:node /data /app/public
ENV INHUBFLOW_DB_PATH=/data/inhubflow.db

USER node

EXPOSE 3000

CMD ["npm", "start"]
