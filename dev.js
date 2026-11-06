// Local test server: node dev.js, then open http://localhost:3000
// Uses memory storage, so the token is forgotten when it stops.
import http from 'node:http';
import { createApp } from './lib/app.js';
import { memoryStore } from './lib/store.js';

const handle = createApp(memoryStore());

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === 'GET' ? undefined : Buffer.concat(chunks),
  });
  const response = await handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(3000, () => console.log('http://localhost:3000'));
