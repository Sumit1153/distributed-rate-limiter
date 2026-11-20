import http from 'node:http';
import os from 'node:os';
const port = Number(process.env.PORT || 3001);
const server = http.createServer((req, res) => {
  if (req.url !== '/work' || req.method !== 'GET') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ success: true, message: 'Request accepted by backend', timestamp: new Date().toISOString(), backendInstance: os.hostname(), requestId: req.headers['x-request-id'] }));
});
server.listen(port, '0.0.0.0', () => console.log(`Backend listening on ${port}`));
process.on('SIGTERM', () => server.close());
