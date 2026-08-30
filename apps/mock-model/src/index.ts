import { buildMockModelApp } from './app.js';

const port = Number.parseInt(process.env.MOCK_MODEL_PORT ?? '8081', 10);
const app = buildMockModelApp();

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console -- process entrypoint
  console.log(`mock-model listening on ${String(port)}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
