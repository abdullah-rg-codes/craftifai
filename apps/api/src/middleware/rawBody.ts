import type { Request, Response } from 'express';

export function attachRawBody(req: Request, _res: Response, buf: Buffer): void {
  req.rawBody = buf;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}
