import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './read-night.js';

export function registerDigestJson(app: Hono, config: RigConfig): void {
  app.get('/api/digest/:night', (c) => {
    const result = readNight(config.runsDir, c.req.param('night'));

    if (result === null) return c.notFound();

    return c.json(result);
  });
}
