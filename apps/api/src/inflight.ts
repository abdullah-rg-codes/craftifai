import type { Request, Response, NextFunction } from 'express';

let inflight = 0;

export function inflightMiddleware(_req: Request, res: Response, next: NextFunction): void {
  inflight += 1;
  const done = (): void => {
    res.off('finish', done);
    res.off('close', done);
    inflight = Math.max(0, inflight - 1);
  };
  res.on('finish', done);
  res.on('close', done);
  next();
}

export function inflightCount(): number {
  return inflight;
}
