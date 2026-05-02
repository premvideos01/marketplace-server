FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3010
ENV DB_PATH=/data/marketplace.db
ENV UPLOAD_DIR=/data/uploads

VOLUME ["/data"]
EXPOSE 3010

CMD ["node", "server.js"]
