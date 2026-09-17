/**
 * Test environment defaults. Set before any module that eagerly validates env
 * (lib/env) is imported, so unit tests can import app modules without a real
 * .env. Individual tests can still call `parseEnv` with their own inputs.
 */
const defaults: Record<string, string> = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  MONGODB_URI: "mongodb://localhost:27017/shelf-test",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "test-access-secret-that-is-at-least-32-characters",
  JWT_REFRESH_SECRET: "test-refresh-secret-that-is-at-least-32-chars-x",
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-key",
  R2_SECRET_ACCESS_KEY: "test-secret",
  R2_BUCKET: "shelf-test",
  RESEND_API_KEY: "re_test_key",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
