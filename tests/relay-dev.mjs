// Runs the Cloudflare relay (relay/worker.js) locally for testing.
//   node tests/relay-dev.mjs [port]      (default port 8787)
// Then set imageRelay in js/config.js to http://localhost:8787 to try it.
import http from 'node:http';
import worker from '../relay/worker.js';

const port = Number(process.argv[2] || 8787);

http
  .createServer(async (req, res) => {
    try {
      const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers });
      const response = await worker.fetch(request, {}, { waitUntil() {} });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        for await (const chunk of response.body) res.write(chunk);
      }
      res.end();
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(e));
    }
  })
  .listen(port, () => console.log(`relay running at http://localhost:${port}`));
