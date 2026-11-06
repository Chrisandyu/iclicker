// Tiny key-value store. Upstash Redis on Vercel, plain memory for local testing.

export function redisStore() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('set KV_REST_API_URL and KV_REST_API_TOKEN (connect upstash redis)');

  async function cmd(...args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify(args),
    });
    const out = await res.json();
    if (out.error) throw new Error('Redis: ' + out.error);
    return out.result;
  }

  return {
    async get(key) {
      const v = await cmd('GET', key);
      return v === null ? null : JSON.parse(v);
    },
    async set(key, value) {
      await cmd('SET', key, JSON.stringify(value));
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
