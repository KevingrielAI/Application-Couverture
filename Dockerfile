# syntax=docker/dockerfile:1
FROM node:22-slim

# Dépendances de compilation pour better-sqlite3 (au cas où le binaire
# précompilé n'est pas disponible pour la plateforme).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# Installe les dépendances en couche séparée (cache).
COPY package*.json ./
RUN npm ci --omit=dev

# Code applicatif.
COPY . .

# La base SQLite et les sessions vivent dans /app/data (à monter en volume).
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
