// Runs the sync Worker (sync/worker.js) locally, with storage in memory.
//   node tests/sync-dev.mjs [port]      (default port 8788)
// Data is lost when it stops. For trying the app's sync without Cloudflare.
import http from 'node:http';
import worker from '../sync/worker.js';
import { memoryBucket } from './r2-memory.mjs';

const port = Number(process.argv[2] || 8788);
const env = { SYNC: memoryBucket() };

http
  .createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(e));
    }
  })
  .listen(port, () => console.log(`sync service running at http://localhost:${port} (in memory)`));
