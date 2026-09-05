/**
 * MechPro J2534 diagnostic host — Node.js implementation with simulator mode.
 * On Windows with a real J2534 DLL, the C# J2534.Host.exe is preferred.
 * This host provides the same JSON-RPC named-pipe protocol for development and CI.
 */

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PIPE_NAME = process.env.MECHPRO_J2534_PIPE || (process.platform === 'win32'
  ? '\\\\.\\pipe\\mechpro-j2534'
  : path.join(os.tmpdir(), 'mechpro-j2534.sock'));
const HOST_TOKEN = process.env.MECHPRO_J2534_TOKEN || '';

const SIM_VIN = '1C6SRFHT0LN123456';
const SIM_PLATFORM = 'DT';

/** @type {import('./simulator').SimulatorState} */
let sim = null;

function createSimulator() {
  const { createSimulatorState } = require('./simulator');
  return createSimulatorState();
}

function logEntry(direction, address, data, description) {
  if (!sim) return;
  sim.commLog.push({
    timestamp: Date.now(),
    direction,
    address,
    data: Buffer.isBuffer(data) ? data.toString('hex').toUpperCase() : String(data),
    description,
  });
  if (sim.commLog.length > 5000) sim.commLog.shift();
}

function assertAuth(params = {}) {
  if (!HOST_TOKEN) return;
  if (String(params.authToken || '') !== HOST_TOKEN) {
    throw new Error('Unauthorized J2534 RPC — invalid host token');
  }
}

function handleRequest(req) {
  const { id, method, params = {} } = req;
  try {
    assertAuth(params);
    const result = dispatch(method, params);
    return { jsonrpc: '2.0', id, result };
  } catch (error) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: error.message } };
  }
}

function dispatch(method, params) {
  switch (method) {
    case 'ping':
      return { ok: true, simulator: sim?.simulator ?? true };
    case 'listAdapters':
      return listAdapters();
    case 'connect':
      return connect(params);
    case 'disconnect':
      return disconnect();
    case 'getConnectionStatus':
      return getConnectionStatus();
    case 'readVin':
      return readVin();
    case 'identifyEcus':
      return identifyEcus();
    case 'readDtcs':
      return readDtcs();
    case 'clearDtcs':
      return clearDtcs();
    case 'startLiveLog':
      if (!sim?.connected) throw new Error('Not connected to vehicle bus');
      sim.liveLogActive = true;
      return { active: true };
    case 'stopLiveLog':
      if (sim) sim.liveLogActive = false;
      return { active: false };
    case 'pollLiveLog':
      return pollLiveLog(params.since);
    case 'identifyVehicle':
      return identifyVehicle();
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

function listAdapters() {
  const adapters = [];
  const seenDlls = new Set();
  if (process.platform === 'win32') {
    const roots = [
      'HKLM\\SOFTWARE\\PassThruSupport.04.04',
      'HKLM\\SOFTWARE\\WOW6432Node\\PassThruSupport.04.04',
      'HKLM\\SOFTWARE\\PassThruSupport.04.02',
      'HKLM\\SOFTWARE\\WOW6432Node\\PassThruSupport.04.02',
    ];
    for (const root of roots) {
      for (const entry of readWindowsRegistryAdapters(root)) {
        const key = entry.dllPath.toLowerCase();
        if (seenDlls.has(key)) continue;
        seenDlls.add(key);
        adapters.push(entry);
      }
    }
    for (const root of ['HKLM\\SOFTWARE\\PassThruSupport.04.04', 'HKLM\\SOFTWARE\\PassThruSupport.04.02']) {
      for (const entry of readWindowsRegistryAdapters(root, 32)) {
        const key = entry.dllPath.toLowerCase();
        if (seenDlls.has(key)) continue;
        seenDlls.add(key);
        adapters.push(entry);
      }
    }
  }
  adapters.push({
    id: 'simulator',
    name: 'MechPro CAN Simulator (Dodge/Ram bench)',
    vendor: 'MechPro',
    dllPath: 'builtin-simulator',
    protocols: ['CAN', 'ISO15765'],
    firmware: '1.0.0-sim',
  });
  return { adapters, simulator: adapters.length === 1 };
}

function readWindowsRegistryAdapters(root, view = 64) {
  try {
    const { execSync } = require('node:child_process');
    const viewFlag = view === 32 ? ' /reg:32' : '';
    const output = execSync(`reg query "${root}" /s${viewFlag}`, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const entries = [];
    let currentKey = null;
    let currentValues = {};
    for (const line of output.split(/\r?\n/)) {
      const keyMatch = line.match(/^HKEY_LOCAL_MACHINE\\(.+)$/i);
      if (keyMatch) {
        if (currentKey) entries.push({ key: currentKey, values: currentValues });
        currentKey = keyMatch[1];
        currentValues = {};
        continue;
      }
      const valueMatch = line.trim().match(/^(\S+)\s+REG_\S+\s+(.+)$/);
      if (valueMatch && currentKey) currentValues[valueMatch[1]] = valueMatch[2].trim();
    }
    if (currentKey) entries.push({ key: currentKey, values: currentValues });

    const prefix = root.replace(/^HKLM\\/i, 'HKEY_LOCAL_MACHINE\\');
    return entries
      .filter((entry) => entry.key.startsWith(`${prefix}\\`) && entry.key !== prefix)
      .map((entry) => {
        const subKey = entry.key.slice(prefix.length + 1);
        const dllPath = (entry.values.FunctionLibrary || '').replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
        if (!dllPath) return null;
        const name = entry.values.Name || subKey;
        const vendor = entry.values.Vendor || name.split(/\s+/)[0] || name;
        const scope = root.includes('WOW6432Node') || view === 32 ? 'wow64' : 'native';
        const version = root.includes('04.02') ? '0402' : '0404';
        const slug = subKey.replace(/\s+/g, '-').toLowerCase();
        return {
          id: `registry-${scope}-${version}-${slug}`,
          name,
          vendor,
          dllPath,
          protocols: ['CAN', 'ISO15765', 'ISO15765_FD'],
          firmware: 'unknown',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function connect(params) {
  if (!sim) sim = createSimulator();
  const adapterId = params.adapterId || 'simulator';
  if (!adapterId) throw new Error('adapterId is required');
  sim.connected = true;
  sim.adapterId = adapterId;
  sim.protocol = params.protocol || 'ISO15765';
  sim.voltage = 12.6 + Math.random() * 0.4;
  sim.commFault = false;
  logEntry('tx', '0x7E0', '1003', 'Diagnostic session start');
  logEntry('rx', '0x7E8', '5003', 'Positive response');
  return { connected: true, protocol: sim.protocol, voltage: Math.round(sim.voltage * 10) / 10 };
}

function disconnect() {
  if (sim) {
    sim.connected = false;
    sim.liveLogActive = false;
  }
  return { connected: false };
}

function getConnectionStatus() {
  if (!sim?.connected) {
    return { connected: false, adapterId: null, protocol: null, voltage: null, commFault: false };
  }
  return {
    connected: true,
    adapterId: sim.adapterId,
    protocol: sim.protocol,
    voltage: Math.round(sim.voltage * 10) / 10,
    commFault: sim.commFault,
  };
}

function requireConnection() {
  if (!sim?.connected) throw new Error('Not connected. Select an adapter and connect first.');
}

function readVin() {
  requireConnection();
  logEntry('tx', '0x7E0', '22F190', 'Read VIN (UDS 0x22 F1 90)');
  logEntry('rx', '0x7E8', `62F190${Buffer.from(SIM_VIN).toString('hex').toUpperCase()}`, 'VIN response');
  return { vin: SIM_VIN, source: 'UDS_22_F190', raw: SIM_VIN };
}

function identifyEcus() {
  requireConnection();
  const ecus = [
    { logicalAddress: '0x7E0', name: 'Gateway (SGW)', partNumber: '68429235AE', softwareVersion: '23.23.1', calibrationId: 'DT_GW_2024' },
    { logicalAddress: '0x7E1', name: 'ECM', partNumber: '05094923AI', softwareVersion: '23.15.0', calibrationId: 'DT_ECM_5.7L' },
    { logicalAddress: '0x7E2', name: 'TCM', partNumber: '05094924AB', softwareVersion: '22.10.3', calibrationId: 'DT_TCM_8HP' },
    { logicalAddress: '0x7E3', name: 'BCM', partNumber: '68429240AC', softwareVersion: '21.08.2', calibrationId: 'DT_BCM' },
  ];
  const securityModules = [
    { type: 'gateway', logicalAddress: '0x7E0', partNumber: '68429235AE', generation: 'SGW_DT' },
    { type: 'rf_hub', logicalAddress: '0x7E4', partNumber: '68394147AA', generation: 'Gen3' },
    { type: 'immobilizer', logicalAddress: '0x7E0', partNumber: '68429235AE', generation: 'integrated' },
  ];
  ecus.forEach((ecu) => {
    logEntry('tx', ecu.logicalAddress, '22F18A', `Read part number from ${ecu.name}`);
    logEntry('rx', ecu.logicalAddress.replace('0x7E', '0x7E8'), `62F18A${Buffer.from(ecu.partNumber).toString('hex').toUpperCase()}`, 'Part number response');
  });
  return {
    ecus,
    securityModules,
    networkTopology: ecus.map((e) => e.logicalAddress).concat(['0x7E4']),
  };
}

function readDtcs() {
  requireConnection();
  logEntry('tx', '0x7E0', '1902FF', 'Read DTCs (UDS 0x19 02 FF)');
  logEntry('rx', '0x7E8', '5902FF0000', 'No DTCs stored');
  return {
    dtcs: sim.dtcs.length ? sim.dtcs : [],
  };
}

function clearDtcs() {
  requireConnection();
  logEntry('tx', '0x7E0', '14FFFFFF', 'Clear DTCs (UDS 0x14 FF FF FF)');
  logEntry('rx', '0x7E8', '54', 'DTCs cleared');
  sim.dtcs = [];
  return { cleared: true };
}

function pollLiveLog(since = 0) {
  if (!sim) return { entries: [] };
  const entries = sim.commLog.filter((e) => e.timestamp > since);
  if (sim.liveLogActive && sim.connected) {
    const rpm = 750 + Math.floor(Math.random() * 200);
    logEntry('rx', '0x7E8', `410C${rpm.toString(16).padStart(4, '0').toUpperCase()}`, `Engine RPM: ${rpm}`);
  }
  return { entries: entries.length ? entries : sim.commLog.slice(-5) };
}

function identifyVehicle() {
  requireConnection();
  const { ecus, securityModules, networkTopology } = identifyEcus();
  const vinResult = readVin();
  const sessionId = `diag-${Date.now()}`;
  return {
    sessionId,
    vin: vinResult.vin,
    make: 'Ram',
    modelYear: 2020,
    platform: SIM_PLATFORM,
    ignitionType: 'push_button',
    ecus,
    securityModules,
    networkTopology,
    identifiedAt: new Date().toISOString(),
    adapterInfo: {
      vendor: sim.adapterId === 'simulator' ? 'MechPro' : 'J2534',
      dll: sim.adapterId === 'simulator' ? 'builtin-simulator' : sim.adapterId,
      firmware: '1.0.0',
    },
  };
}

function handleConnection(socket) {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        continue;
      }
      const response = handleRequest(req);
      socket.write(`${JSON.stringify(response)}\n`);
    }
  });
}

function startServer() {
  if (process.platform === 'win32') {
    const server = net.createServer(handleConnection);
    server.listen(PIPE_NAME, () => {
      process.stdout.write(`J2534 host listening on ${PIPE_NAME}\n`);
    });
    return server;
  }
  const socketPath = PIPE_NAME;
  if (fs.existsSync(socketPath)) {
    try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
  }
  const server = net.createServer(handleConnection);
  server.listen(socketPath, () => {
    process.stdout.write(`J2534 host listening on ${socketPath}\n`);
  });
  server.on('error', (err) => {
    process.stderr.write(`J2534 host error: ${err.message}\n`);
    process.exit(1);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, PIPE_NAME, handleRequest };
