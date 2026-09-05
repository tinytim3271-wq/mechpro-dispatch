const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const os = require('node:os');
const crypto = require('node:crypto');

const sessionId = crypto.randomBytes(8).toString('hex');
const hostToken = crypto.randomBytes(24).toString('base64url');
const PIPE_WIN = `\\\\.\\pipe\\mechpro-j2534-${sessionId}`;
const PIPE_UNIX = path.join(os.tmpdir(), `mechpro-j2534-${sessionId}.sock`);

let hostProcess = null;
let requestId = 0;
let powerSaveBlockerId = null;

function pipePath() {
  return process.platform === 'win32' ? PIPE_WIN : PIPE_UNIX;
}

function csharpPipeName() {
  return `mechpro-j2534-${sessionId}`;
}

function hostScriptPath() {
  return path.join(__dirname, '..', 'diagnostics', 'j2534-host-node', 'bin', 'start.js');
}

function csharpHostPath() {
  const fs = require('node:fs');
  const { app } = require('electron');
  const packaged = path.join(process.resourcesPath, 'j2534-host', 'J2534.Host.exe');
  if (app?.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'diagnostics', 'j2534-service', 'publish', 'win-x64', 'J2534.Host.exe');
}

function startHostProcess() {
  if (hostProcess) return hostProcess;

  const fs = require('node:fs');
  const csharp = csharpHostPath();
  const hostEnv = {
    ...process.env,
    MECHPRO_J2534_PIPE: process.platform === 'win32' ? csharpPipeName() : pipePath(),
    MECHPRO_J2534_TOKEN: hostToken,
    MECHPRO_DIAG_CAPABILITY_SECRET:
      process.env.MECHPRO_DIAG_CAPABILITY_SECRET
      || process.env.DIAGNOSTICS_CAPABILITY_SECRET
      || 'mechpro-dev-diagnostics-capability-v1',
  };
  if (process.platform === 'win32' && fs.existsSync(csharp)) {
    hostProcess = spawn(csharp, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: hostEnv,
    });
  } else {
    hostProcess = spawn(process.execPath, [hostScriptPath()], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...hostEnv, MECHPRO_J2534_PIPE: pipePath() },
    });
  }

  hostProcess.stdout?.on('data', (chunk) => process.stdout.write(`[j2534] ${chunk}`));
  hostProcess.stderr?.on('data', (chunk) => process.stderr.write(`[j2534] ${chunk}`));
  hostProcess.on('exit', (code) => {
    process.stderr.write(`[j2534] host exited with code ${code}\n`);
    hostProcess = null;
  });
  return hostProcess;
}

async function waitForPipe(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await rpcCall('ping', {});
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('J2534 diagnostic host did not become ready');
}

function rpcCall(method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipePath());
    const id = ++requestId;
    let buffer = '';
    const payload = { ...params, authToken: hostToken };

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`J2534 RPC timeout: ${method}`));
    }, 15000);

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: payload })}\n`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      socket.end();
      clearTimeout(timer);
      try {
        const response = JSON.parse(line);
        if (response.error) reject(new Error(response.error.message || 'RPC error'));
        else resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function ensureHost() {
  startHostProcess();
  await waitForPipe();
}

async function listAdapters() {
  await ensureHost();
  return rpcCall('listAdapters');
}

async function connect(params) {
  await ensureHost();
  const result = await rpcCall('connect', params || {});
  if (powerSaveBlockerId === null) {
    const { powerSaveBlocker } = require('electron');
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  }
  return result;
}

async function disconnect() {
  if (!hostProcess) return { connected: false };
  const result = await rpcCall('disconnect');
  if (powerSaveBlockerId !== null) {
    const { powerSaveBlocker } = require('electron');
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
  return result;
}

async function getConnectionStatus() {
  if (!hostProcess) {
    return { connected: false, adapterId: null, protocol: null, voltage: null, commFault: true };
  }
  try {
    return await rpcCall('getConnectionStatus');
  } catch {
    return { connected: false, adapterId: null, protocol: null, voltage: null, commFault: true };
  }
}

async function readVin() {
  await ensureHost();
  return rpcCall('readVin');
}

async function identifyEcus() {
  await ensureHost();
  return rpcCall('identifyEcus');
}

async function readDtcs() {
  await ensureHost();
  return rpcCall('readDtcs');
}

/** Mutating UDS — requires a cloud /diagnostics/authorize capability token from the renderer. */
async function clearDtcs(params = {}) {
  const authorizationToken = String(params.authorizationToken || '').trim();
  if (!authorizationToken) {
    throw new Error('clearDtcs requires an authorization token from /diagnostics/authorize');
  }
  const { verifyClearDtcsToken } = require('../diagnostics/j2534-host-node/capability-token');
  // Signature/expiry check only — host enforces single-use consumption.
  verifyClearDtcsToken(authorizationToken, { consume: false });
  await ensureHost();
  return rpcCall('clearDtcs', { authorizationToken });
}

async function startLiveLog() {
  await ensureHost();
  return rpcCall('startLiveLog');
}

async function stopLiveLog() {
  await ensureHost();
  return rpcCall('stopLiveLog');
}

async function pollLiveLog(since = 0) {
  await ensureHost();
  return rpcCall('pollLiveLog', { since });
}

async function identifyVehicle() {
  await ensureHost();
  return rpcCall('identifyVehicle');
}

function stopHost() {
  if (hostProcess) {
    hostProcess.kill();
    hostProcess = null;
  }
  if (powerSaveBlockerId !== null) {
    try {
      const { powerSaveBlocker } = require('electron');
      powerSaveBlocker.stop(powerSaveBlockerId);
    } catch { /* ignore */ }
    powerSaveBlockerId = null;
  }
}

module.exports = {
  ensureHost,
  listAdapters,
  connect,
  disconnect,
  getConnectionStatus,
  readVin,
  identifyEcus,
  readDtcs,
  clearDtcs,
  startLiveLog,
  stopLiveLog,
  pollLiveLog,
  identifyVehicle,
  stopHost,
};
