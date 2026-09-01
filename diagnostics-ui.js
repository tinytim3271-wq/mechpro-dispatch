/** Dodge/Ram OEM Diagnostics module — Phase 1 diagnostic-only prototype. */

const OEM_DIAG_STATE_KEY = 'mechpro-oem-diagnostics-v1';

function loadOemDiagState() {
  try {
    return JSON.parse(localStorage.getItem(OEM_DIAG_STATE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveOemDiagState(patch) {
  const current = loadOemDiagState();
  localStorage.setItem(OEM_DIAG_STATE_KEY, JSON.stringify({ ...current, ...patch }));
}

function oemDiagApi() {
  return window.mechproDiagnostics;
}

function isOemDiagnosticsAvailable() {
  return Boolean(window.mechproDesktop && window.mechproDiagnostics);
}

function platformFromVin(vin) {
  const year = Number(vin?.[9] ? (vin[9] >= 'A' ? 2010 + (vin.charCodeAt(9) - 65) : 2000 + Number(vin[9])) : 0);
  const wmi = String(vin || '').slice(0, 3).toUpperCase();
  if (!['1C6', '3C6', '1D7', '1B3'].includes(wmi)) return { platform: 'unknown', make: '', year };
  const modelCode = vin[3];
  const platformMap = { R: 'DT', H: 'DJ', C: 'LD', J: 'JC', U: 'DS' };
  const make = wmi.startsWith('1C6') || wmi.startsWith('3C6') ? 'Ram' : 'Dodge';
  return { platform: platformMap[modelCode] || 'unknown', make, year };
}

function procedureLabel(key) {
  return ({
    add_key: 'Add spare key',
    all_keys_lost: 'All keys lost',
    program_remote: 'Program remote',
    erase_keys: 'Erase / relearn keys',
  })[key] || key;
}

function supportedLabel(value) {
  return ({
    true: 'Available',
    false: 'Not supported',
    requires_authorization: 'Requires authorization',
    partial: 'Partial support',
    requires_dealer: 'Dealer only',
  })[value] || value;
}

function evaluateCoverage(record, vehicle) {
  if (!record) {
    return {
      eligible: false,
      blockers: ['No coverage record found for this platform and year.'],
      warnings: ['Key programming procedures cannot be evaluated without a matching coverage entry.'],
      procedures: [],
    };
  }
  const procedures = Object.entries(record.procedures || {}).map(([key, proc]) => ({
    key,
    label: procedureLabel(key),
    supported: proc.supported,
    authorizationRequired: proc.authorizationRequired,
    status: proc.supported
      ? (proc.authorizationRequired ? 'requires_authorization' : 'available')
      : 'not_supported',
  }));
  return {
    eligible: record.supported !== 'false' && record.supported !== false,
    blockers: record.supported === false || record.supported === 'false'
      ? ['This vehicle platform is not supported for key programming.']
      : [],
    warnings: record.warnings || [],
    preconditions: record.preconditions || [],
    procedures,
    record,
  };
}

async function fetchCoverageBundle() {
  const cached = loadOemDiagState().coverageBundle;
  try {
    const params = new URLSearchParams();
    const bundle = await apiFetch(`/diagnostics/coverage/bundle?${params}`);
    saveOemDiagState({ coverageBundle: bundle });
    return bundle;
  } catch {
    if (cached) return cached;
    const response = await fetch('./diagnostics/coverage/seed/dodge-ram-coverage.json');
    if (!response.ok) throw new Error('Coverage data unavailable');
    const bundle = await response.json();
    saveOemDiagState({ coverageBundle: bundle });
    return bundle;
  }
}

function matchCoverage(bundle, vehicle) {
  const records = bundle?.records || [];
  const year = Number(vehicle.modelYear || vehicle.year || 0);
  const platform = vehicle.platform || 'unknown';
  return records.find((record) => {
    const [start, end] = record.yearRange || [0, 9999];
    return record.platform === platform && year >= start && year <= end;
  }) || records.find((record) => record.platform === platform);
}

function normalizeOemAdapter(adapter) {
  if (!adapter) return null;
  return {
    id: adapter.id ?? adapter.Id ?? '',
    name: adapter.name ?? adapter.Name ?? 'Unknown adapter',
    vendor: adapter.vendor ?? adapter.Vendor ?? '',
    dllPath: adapter.dllPath ?? adapter.DllPath ?? '',
    protocols: adapter.protocols ?? adapter.Protocols ?? [],
    firmware: adapter.firmware ?? adapter.Firmware ?? '',
  };
}

  const time = new Date(entry.timestamp).toLocaleTimeString();
  const dir = entry.direction === 'tx' ? 'TX' : 'RX';
  return `[${time}] ${dir} ${entry.address} ${entry.data} — ${entry.description}`;
}

function oemDiagnosticsView() {
  const diag = loadOemDiagState();
  const status = diag.connectionStatus || {};
  const vehicle = diag.vehicleIdentification;
  const coverage = diag.coverageEvaluation;
  const log = (diag.commLog || []).slice(-100).map(formatCommEntry).join('\n') || 'No communication yet.';
  const dtcs = (diag.dtcs || []).map((d) => `${d.code} (${d.status}) — ${d.description}`).join('\n') || 'No DTCs read yet.';

  if (!isOemDiagnosticsAvailable()) {
    return shell(`${heading('OEM diagnostics', 'Dodge / Ram diagnostics', 'J2534 Pass-Thru diagnostics require the MechPro Windows desktop application.', false)}
      <section class="diagnostics-console oem-diagnostics">
        <div class="messaging-status idle">${icon('monitor', 17)}<div><strong>Windows desktop required</strong><span>OEM diagnostics with J2534 adapter support is available in the MechPro Windows app only.</span></div></div>
      </section>`);
  }

  const adaptersList = (diag.adapters || []).map(normalizeOemAdapter).filter(Boolean);
  const hardwareAdapters = adaptersList.filter((a) => a.id !== 'simulator');
  const adapters = adaptersList.map((a) => `<option value="${escapeHtml(a.id)}" ${diag.selectedAdapter === a.id ? 'selected' : ''}>${escapeHtml(a.name)} (${escapeHtml(a.vendor)})</option>`).join('');
  const adapterHelp = hardwareAdapters.length
    ? ''
    : `<div class="ledger-note">${icon('info', 15)} No J2534 hardware detected. Install your adapter vendor software (for TOPDON RLink X7: RLink Platform → Drivers → download the J2534 driver), plug in USB, then click Refresh. MechPro scans both 64-bit and 32-bit Windows J2534 registry entries.</div>`;

  return shell(`${heading('Stellantis OEM', 'Dodge / Ram diagnostics', 'Phase 1: J2534 identification, DTC read/clear, and coverage eligibility. Key programming is not enabled in this release.', false)}
    <section class="oem-phase-notice">${icon('shield-alert', 16)}<span><strong>Diagnostic-only mode.</strong> This module reads vehicle identification and reports procedure eligibility. It does not program keys or remotes. Authorized programming requires AutoAuth credentials (Phase 3).</span></section>
    <section class="diagnostics-console oem-diagnostics">
      <div class="oem-preflight">
        <h3>Pre-flight checklist</h3>
        <ul class="ai-checklist">
          <li>${icon('check-circle-2', 13)}Use a regulated 12V+ power supply when programming-class work is planned</li>
          <li>${icon('check-circle-2', 13)}Ignition ON — verify correct ignition state for the procedure</li>
          <li>${icon('check-circle-2', 13)}PC sleep is blocked automatically during an active session</li>
          <li>${icon('check-circle-2', 13)}Do not disconnect the USB J2534 adapter during a session</li>
          <li>${icon('check-circle-2', 13)}Confirm VIN matches the work order before any security operation</li>
        </ul>
      </div>
      <div class="oem-grid">
        <section class="oem-panel">
          <h3>${icon('usb', 16)} J2534 adapter</h3>
          <div class="messaging-status ${status.connected ? 'ready' : 'idle'}">${icon(status.connected ? 'circle-check' : 'plug-zap', 17)}<div><strong>${status.connected ? 'Connected' : 'Not connected'}</strong><span>${status.connected ? `${escapeHtml(status.protocol || '')} · ${status.voltage ?? '—'} V` : 'Select adapter and connect'}</span></div></div>
          <label>Adapter<select id="oem-adapter-select">${adapters || '<option value="simulator">MechPro CAN Simulator</option>'}</select></label>
          ${adapterHelp}
          <div class="ops-actions">
            <button class="primary" id="oem-refresh-adapters">${icon('refresh-cw', 14)} Refresh</button>
            <button class="primary" id="oem-connect" ${status.connected ? 'disabled' : ''}>${icon('plug-zap', 14)} Connect</button>
            <button class="secondary" id="oem-disconnect" ${status.connected ? '' : 'disabled'}>${icon('unplug', 14)} Disconnect</button>
          </div>
        </section>
        <section class="oem-panel">
          <h3>${icon('fingerprint', 16)} Vehicle identification</h3>
          ${vehicle ? `<dl class="oem-ident"><dt>VIN</dt><dd class="mono">${escapeHtml(vehicle.vin)}</dd><dt>Make / year</dt><dd>${escapeHtml(vehicle.make)} ${vehicle.modelYear}</dd><dt>Platform</dt><dd>${escapeHtml(vehicle.platform)}</dd><dt>Ignition</dt><dd>${escapeHtml(vehicle.ignitionType)}</dd></dl>` : '<p class="muted">Connect and identify vehicle to read VIN and ECU data.</p>'}
          <div class="ops-actions">
            <button class="primary" id="oem-identify" ${status.connected ? '' : 'disabled'}>${icon('scan', 14)} Identify vehicle</button>
          </div>
          ${vehicle?.ecus?.length ? `<table class="mini-table"><thead><tr><th>ECU</th><th>Part #</th><th>Software</th></tr></thead><tbody>${vehicle.ecus.map((ecu) => `<tr><td>${escapeHtml(ecu.name || ecu.logicalAddress)}</td><td class="mono">${escapeHtml(ecu.partNumber)}</td><td>${escapeHtml(ecu.softwareVersion)}</td></tr>`).join('')}</tbody></table>` : ''}
        </section>
        <section class="oem-panel">
          <h3>${icon('key-round', 16)} Coverage &amp; eligibility</h3>
          ${coverage ? `<p><strong>${supportedLabel(coverage.record?.supported)}</strong> — ${escapeHtml(coverage.record?.make || '')} ${escapeHtml(coverage.record?.model || '')} (${escapeHtml(coverage.record?.platform || '')})</p>
            <ul class="ai-checklist">${coverage.procedures.map((p) => `<li>${icon(p.status === 'not_supported' ? 'circle-x' : 'shield-check', 13)}${escapeHtml(p.label)}: ${p.supported ? (p.authorizationRequired ? 'requires authorization' : 'available') : 'not supported'}</li>`).join('')}</ul>
            ${coverage.warnings?.length ? `<div class="oem-warnings">${coverage.warnings.map((w) => `<p>${escapeHtml(w)}</p>`).join('')}</div>` : ''}` : '<p class="muted">Identify vehicle to evaluate key-programming procedure availability.</p>'}
        </section>
        <section class="oem-panel">
          <h3>${icon('triangle-alert', 16)} Diagnostic trouble codes</h3>
          <pre class="diagnostics-output">${escapeHtml(dtcs)}</pre>
          <div class="ops-actions">
            <button class="secondary" id="oem-read-dtcs" ${status.connected ? '' : 'disabled'}>${icon('scan-line', 14)} Read DTCs</button>
            <button class="secondary danger" id="oem-clear-dtcs" ${status.connected ? '' : 'disabled'}>${icon('eraser', 14)} Clear DTCs</button>
          </div>
        </section>
        <section class="oem-panel oem-panel-wide">
          <h3>${icon('radio', 16)} Communication log</h3>
          <div class="ops-actions">
            <button class="secondary" id="oem-start-log" ${status.connected ? '' : 'disabled'}>${icon('activity', 14)} Start live log</button>
            <button class="secondary" id="oem-stop-log">${icon('square', 14)} Stop log</button>
            <button class="secondary" id="oem-export-log">${icon('download', 14)} Export</button>
          </div>
          <pre class="diagnostics-output oem-comm-log" id="oem-comm-log">${escapeHtml(log)}</pre>
        </section>
      </div>
      ${diag.lastError ? `<div class="login-error oem-error">${icon('alert-circle', 14)} ${escapeHtml(diag.lastError)}<p class="muted">Preserve the adapter connection. Do not repeat programming commands after a failure. Review the communication log and recovery steps in manufacturer service information.</p></div>` : ''}
    </section>`);
}

async function refreshOemAdapters() {
  const api = oemDiagApi();
  const result = await api.listAdapters();
  const adapters = (result.adapters || []).map(normalizeOemAdapter).filter(Boolean);
  const hardware = adapters.filter((a) => a.id !== 'simulator');
  saveOemDiagState({
    adapters,
    selectedAdapter: hardware[0]?.id || adapters[0]?.id || 'simulator',
    lastError: null,
  });
}

async function refreshOemConnectionStatus() {
  const api = oemDiagApi();
  const status = await api.getConnectionStatus();
  saveOemDiagState({ connectionStatus: status, lastError: null });
  return status;
}

async function oemConnect() {
  const diag = loadOemDiagState();
  const select = document.querySelector('#oem-adapter-select');
  const adapterId = select?.value || diag.selectedAdapter || 'simulator';
  saveOemDiagState({ selectedAdapter: adapterId, lastError: null });
  await oemDiagApi().connect({ adapterId, protocol: 'ISO15765' });
  await refreshOemConnectionStatus();
  toast('J2534 adapter connected');
}

async function oemDisconnect() {
  await oemDiagApi().disconnect();
  await oemDiagApi().stopLiveLog().catch(() => {});
  if (window._oemLogTimer) clearInterval(window._oemLogTimer);
  saveOemDiagState({ connectionStatus: { connected: false }, lastError: null });
  toast('J2534 adapter disconnected');
}

async function oemIdentifyVehicle() {
  const api = oemDiagApi();
  const vehicle = await api.identifyVehicle();
  const decoded = platformFromVin(vehicle.vin);
  vehicle.make = vehicle.make || decoded.make;
  vehicle.modelYear = vehicle.modelYear || decoded.year;
  vehicle.platform = vehicle.platform === 'unknown' ? decoded.platform : vehicle.platform;
  let nhtsa = null;
  try {
    nhtsa = await apiFetch(`/vehicles/decode/${encodeURIComponent(vehicle.vin)}`);
    if (nhtsa?.make) vehicle.make = nhtsa.make;
    if (nhtsa?.year) vehicle.modelYear = Number(nhtsa.year) || vehicle.modelYear;
  } catch { /* offline or unauthenticated — use on-vehicle data */ }
  const bundle = await fetchCoverageBundle();
  const coverageEvaluation = evaluateCoverage(matchCoverage(bundle, vehicle), vehicle);
  saveOemDiagState({ vehicleIdentification: vehicle, coverageEvaluation, lastError: null });
  toast(`Vehicle identified: ${vehicle.vin}`);
}

async function oemReadDtcs() {
  const result = await oemDiagApi().readDtcs();
  saveOemDiagState({ dtcs: result.dtcs || [], lastError: null });
  toast('DTCs read');
}

async function oemClearDtcs() {
  if (!confirm('Clear stored diagnostic trouble codes? This may reset readiness monitors and should only be done after repairs are verified.')) return;
  await oemDiagApi().clearDtcs();
  saveOemDiagState({ dtcs: [], lastError: null });
  toast('DTCs cleared');
}

async function oemPollLog() {
  const diag = loadOemDiagState();
  const since = diag.lastLogTimestamp || 0;
  const result = await oemDiagApi().pollLiveLog(since);
  const entries = result.entries || [];
  if (!entries.length) return;
  const merged = (diag.commLog || []).concat(entries).slice(-500);
  saveOemDiagState({
    commLog: merged,
    lastLogTimestamp: entries[entries.length - 1].timestamp,
  });
}

function bindOemDiagnostics() {
  if (!isOemDiagnosticsAvailable()) return;
  document.querySelector('#oem-refresh-adapters')?.addEventListener('click', async () => {
    try { await refreshOemAdapters(); render(); } catch (e) { saveOemDiagState({ lastError: e.message }); render(); }
  });
  document.querySelector('#oem-connect')?.addEventListener('click', async () => {
    try { await oemConnect(); render(); } catch (e) { saveOemDiagState({ lastError: e.message }); render(); }
  });
  document.querySelector('#oem-disconnect')?.addEventListener('click', async () => {
    try { await oemDisconnect(); render(); } catch (e) { saveOemDiagState({ lastError: e.message }); render(); }
  });
  document.querySelector('#oem-identify')?.addEventListener('click', async () => {
    try { await oemIdentifyVehicle(); render(); } catch (e) { saveOemDiagState({ lastError: e.message }); render(); }
  });
  document.querySelector('#oem-read-dtcs')?.addEventListener('click', async () => {
    try { await oemReadDtcs(); render(); } catch (e) { saveOemDiagState({ lastError: e.message }); render(); }
  });
  document.querySelector('#oem-clear-dtcs')?.addEventListener('click', async () => {
    try { await oemClearDtcs(); render(); } catch (e) { saveOemDiagState({ lastError: e.message }); render(); }
  });
  document.querySelector('#oem-start-log')?.addEventListener('click', async () => {
    try {
      await oemDiagApi().startLiveLog();
      if (window._oemLogTimer) clearInterval(window._oemLogTimer);
      window._oemLogTimer = setInterval(async () => {
        if (state.route !== 'oem-diagnostics') return;
        try { await oemPollLog(); const el = document.querySelector('#oem-comm-log'); if (el) el.textContent = (loadOemDiagState().commLog || []).slice(-100).map(formatCommEntry).join('\n'); } catch { /* ignore poll errors */ }
      }, 1500);
      toast('Live communication log started');
    } catch (e) { saveOemDiagState({ lastError: e.message }); render(); }
  });
  document.querySelector('#oem-stop-log')?.addEventListener('click', async () => {
    try {
      await oemDiagApi().stopLiveLog();
      if (window._oemLogTimer) clearInterval(window._oemLogTimer);
      toast('Live log stopped');
    } catch (e) { saveOemDiagState({ lastError: e.message }); render(); }
  });
  document.querySelector('#oem-export-log')?.addEventListener('click', () => {
    const log = (loadOemDiagState().commLog || []).map(formatCommEntry).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([log], { type: 'text/plain' }));
    link.download = `mechpro-comm-log-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast('Communication log exported');
  });
  document.querySelector('#oem-adapter-select')?.addEventListener('change', (e) => {
    saveOemDiagState({ selectedAdapter: e.target.value });
  });
  if (!loadOemDiagState().adapters?.length) {
    refreshOemAdapters().then(() => { if (state.route === 'oem-diagnostics') render(); }).catch(() => {});
  }
}
