import { randomUUID } from 'node:crypto';
import express, { type Application } from 'express';
import cookieParser from 'cookie-parser';
import type { Logger } from './logger.js';

export function buildApp(_logger: Logger): Application {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  app.use((req, _res, next) => {
    req.correlationId = randomUUID();
    next();
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/ready', (_req, res) => {
    res.status(200).json({ status: 'ready' });
  });

  return app;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- standard Express module augmentation pattern
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}
