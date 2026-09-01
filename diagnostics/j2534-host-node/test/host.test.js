const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const socketPath = path.join(os.tmpdir(), `mechpro-j2534-test-${process.pid}.sock`);

function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (!buffer.includes('\n')) return;
      socket.end();
      const response = JSON.parse(buffer.trim());
      if (response.error) reject(new Error(response.error.message));
      else resolve(response.result);
    });
    socket.on('error', reject);
  });
}

async function run() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'start.js')], {
    env: { ...process.env, MECHPRO_J2534_PIPE: socketPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ready = false;
  for (let attempt = 0; attempt < 25 && !ready; attempt += 1) {
    try {
      await rpc('ping');
      ready = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!ready) throw new Error('host start timeout');

  const ping = await rpc('ping');
  assert.equal(ping.ok, true);

  const adapters = await rpc('listAdapters');
  assert.ok(adapters.adapters.length >= 1);

  const connect = await rpc('connect', { adapterId: 'simulator', protocol: 'ISO15765' });
  assert.equal(connect.connected, true);
  assert.ok(connect.voltage > 11);

  const vin = await rpc('readVin');
  assert.equal(vin.vin.length, 17);

  const vehicle = await rpc('identifyVehicle');
  assert.equal(vehicle.vin, vin.vin);
  assert.ok(vehicle.ecus.length >= 2);
  assert.equal(vehicle.platform, 'DT');

  const dtcs = await rpc('readDtcs');
  assert.ok(Array.isArray(dtcs.dtcs));

  const cleared = await rpc('clearDtcs');
  assert.equal(cleared.cleared, true);

  await rpc('startLiveLog');
  const log = await rpc('pollLiveLog', { since: 0 });
  assert.ok(log.entries.length >= 1);

  child.kill();
  console.log('j2534 host tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
