// Tiny key-value store. Vercel Redis (REDIS_URL) on Vercel, plain memory for local testing.
import { createClient } from 'redis';

export function redisStore() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('set REDIS_URL (connect redis)');
  const client = createClient({ url });
  client.on('error', (err) => console.error('redis', err));
  const ready = client.connect();

  return {
    async get(key) {
      await ready;
      const v = await client.get(key);
      return v === null ? null : JSON.parse(v);
    },
    async set(key, value) {
      await ready;
      await client.set(key, JSON.stringify(value));
    },
  };
}

export function memoryStore() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
  };
}
