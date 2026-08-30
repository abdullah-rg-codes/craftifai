FROM node:22-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install && npx tsc
EXPOSE 8081
ENV MOCK_MODEL_PORT=8081
CMD ["node", "dist/index.js"]
