FROM node:22-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install && npx tsc
RUN addgroup -S -g 10001 craftifai \
  && adduser -S -u 10001 -G craftifai -H -s /sbin/nologin craftifai
USER craftifai
EXPOSE 8081
ENV MOCK_MODEL_PORT=8081
CMD ["node", "dist/index.js"]
