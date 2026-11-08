import './core/env.js';
import { config } from './core/config.js';
import { db } from './core/db.js';
import { createApp } from './app.js';

const app = createApp();
const server = app.listen(config.PORT, '127.0.0.1', () => {
  console.log(`SmartHR API listening on http://127.0.0.1:${config.PORT} (${config.NODE_ENV})`);
});

async function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
