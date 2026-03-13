FROM alpine:edge

# Install Chromium and Node.js (Tor is in a separate container)
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      freetype-dev \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      nodejs \
      npm

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Copy app artifacts and dependencies
COPY ./core ./core
COPY ./handlers ./handlers
COPY ./helpers ./helpers
COPY ./services ./services
COPY ./utils ./utils
COPY ./web ./web
COPY ./index.js .
COPY ./agentManager.js .
COPY ./cli.js .
COPY ./package.json .

RUN npm install --production

EXPOSE 8093

CMD ["node", "--expose-gc", "index", "--color=16m"]
