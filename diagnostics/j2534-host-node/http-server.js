/**
 * HTTP bridge for local OEM diagnostics demo (development / CI walkthrough).
 * Wraps the same JSON-RPC logic as the named-pipe host.
 */
const http = require('node:http');
const { handleRequest } = require('./index');

const PORT = Number(process.env.MECHPRO_J2534_HTTP_PORT || 39254);

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/rpc') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const request = JSON.parse(body);
      const response = handleRequest(request);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`J2534 HTTP bridge listening on http://127.0.0.1:${PORT}/rpc\n`);
  });
}

module.exports = { server, PORT };
