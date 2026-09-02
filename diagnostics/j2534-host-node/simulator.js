/** Simulator state for bench / development without hardware. */

function createSimulatorState() {
  return {
    simulator: true,
    connected: false,
    adapterId: null,
    protocol: null,
    voltage: 12.6,
    commFault: false,
    liveLogActive: false,
    commLog: [],
    dtcs: [
      { code: 'P0456', status: 'stored', description: 'EVAP system small leak detected' },
    ],
  };
}

module.exports = { createSimulatorState };
