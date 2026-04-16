FROM node:20-slim
WORKDIR /app

COPY dist/ dist/
COPY examples/podman-demo/server.js .

RUN npm init -y > /dev/null 2>&1 && \
    npm install --save undici lru-cache 2>/dev/null

EXPOSE 3000 7073
CMD ["node", "server.js"]
