FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data NODE_ENV=production
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
