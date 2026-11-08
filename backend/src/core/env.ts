// Loads .env into process.env (Node 22 built-in; no dotenv package needed).
// Import this first in every entry point.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file: use the real environment (production) */
}
export {};
