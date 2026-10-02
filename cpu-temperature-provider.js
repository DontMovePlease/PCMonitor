'use strict';

const fs = require('fs');
const path = require('path');
const MODES = Object.freeze(['enhanced', 'thermal-zone', 'off']);
const VERSION = '0.9.6';
const SOURCES = Object.freeze({ enhanced: 'LibreHardwareMonitor ' + VERSION, 'thermal-zone': 'Windows ACPI / CIM', off: null });
const NOTES = Object.freeze({
  waiting: 'Waiting for an active monitoring lease and temperature sample.',
  disabled: 'Temperature monitoring is disabled.',
  'assets-missing': 'Optional Enhanced provider assets are missing.',
  'pawnio-missing': 'Enhanced hardware sensor support (PawnIO) is not installed. Install it from the local desktop dashboard.',
  'provider-load-failed': 'Enhanced provider could not load its libraries or dependencies.',
  'unsupported-cpu': 'No supported CPU hardware was detected.',
  'no-sensors': 'No supported CPU temperature sensor was detected.',
  'access-denied': 'Sensor access was denied. Enhanced sensors may require administrator privileges.',
  'thermal-zone-unavailable': 'Windows does not expose usable ACPI thermal-zone readings on this system.',
  'invalid-output': 'Temperature provider returned invalid sensor data.',
  'command-failed': 'Temperature provider failed to start or exited unexpectedly.',
  timeout: 'Temperature provider timed out.',
  available: 'Validated CPU-specific temperature sensor.',
  experimental: 'Experimental firmware/ACPI reading; may not represent CPU package temperature. CPU alerts are disabled.'
});
const ASSETS = Object.freeze(['LibreHardwareMonitorLib.dll', 'BlackSharp.Core.dll', 'DiskInfoToolkit.dll', 'HidSharp.dll', 'RAMSPDToolkit-NDD.dll', 'System.Buffers.dll', 'System.Memory.dll', 'System.Numerics.Vectors.dll', 'System.Runtime.CompilerServices.Unsafe.dll']);

function validTemperature(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 125; }
function selectCpuSensor(sensors) {
  if (!Array.isArray(sensors)) return null;
  const candidates = sensors.slice(0, 256).flatMap(sensor => {
    if (!sensor || sensor.hardwareType !== 'Cpu' || sensor.sensorType !== 'Temperature' || !validTemperature(sensor.value) || typeof sensor.name !== 'string') return [];
    const name = sensor.name.trim().slice(0, 64);
    // Allow only known CPU-specific labels, even if a provider misclassifies hardware.
    const rank = /^CPU Package$/i.test(name) ? 0 : /^(?:(CPU )?Tdie|Core \(Tdie\))$/i.test(name) ? 1 : /^Core Max$/i.test(name) ? 2 : /^(?:CPU )?(?:P-|E-)?Core(?: #?\d+)?$/i.test(name) ? 3 : /^(CPU )?CCD\d+( \(Tdie\))?$/i.test(name) ? 4 : /^(?:(CPU )?Tctl(?:\/Tdie)?|Core \(Tctl(?:\/Tdie)?\))$/i.test(name) ? 5 : null;
    return rank === null ? [] : [{ name, sensorType: 'cpu-specific', value: sensor.value, rank }];
  });
  return candidates.sort((a, b) => a.rank - b.rank || b.value - a.value || a.name.localeCompare(b.name))[0] || null;
}

class CpuTemperatureProvider {
  constructor({ root = __dirname, settingsFile = path.join(root, 'temperature-settings.json'), now = Date.now, assetsAvailable } = {}) {
    this.root = root; this.settingsFile = settingsFile; this.now = now;
    this.assetsAvailable = assetsAvailable || (() => ASSETS.every(file => fs.existsSync(path.join(root, 'vendor', 'LibreHardwareMonitor', VERSION, file))));
    this.mode = this.assetsAvailable() ? 'enhanced' : 'off';
    try { const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); if (MODES.includes(saved.mode)) this.mode = saved.mode; } catch (_) {}
    this.epoch = 0; this.inFlight = false; this.retryAt = 0; this.observations = {};
    this.result = this.makeResult(this.mode === 'off' ? 'disabled' : 'unavailable', this.mode === 'off' ? 'disabled' : 'waiting');
  }
  makeResult(status, code, extra = {}) {
    return { mode: this.mode, provider: this.mode === 'enhanced' ? 'LibreHardwareMonitor' : this.mode === 'thermal-zone' ? 'Windows ACPI' : null,
      source: SOURCES[this.mode], version: this.mode === 'enhanced' ? VERSION : null, status, code,
      note: NOTES[code] || NOTES['command-failed'], temperatureC: null, sensorName: null, sensorType: null, sampledAt: null, ...extra };
  }
  snapshot() { return { ...this.result }; }
  settings() { return { mode: this.mode, modes: MODES, enhancedAssetsAvailable: this.assetsAvailable(), enhancedVersion: VERSION, observations: { ...this.observations } }; }
  cancel() { this.epoch++; this.inFlight = false; }
  setMode(mode) {
    if (!MODES.includes(mode)) throw new Error('invalid-mode');
    if (this.settingsFile) {
      const temporary = this.settingsFile + '.' + process.pid + '.tmp';
      try { fs.writeFileSync(temporary, JSON.stringify({ mode }) + '\n', { mode: 0o600 }); fs.renameSync(temporary, this.settingsFile); }
      finally { try { fs.unlinkSync(temporary); } catch (_) {} }
    }
    this.cancel(); this.mode = mode; this.retryAt = 0;
    this.result = this.makeResult(mode === 'off' ? 'disabled' : 'unavailable', mode === 'off' ? 'disabled' : 'waiting');
    return this.settings();
  }
  sample(execute, callback) {
    if (this.inFlight) return false;
    if (this.mode === 'off' || this.now() < this.retryAt) { callback(this.snapshot()); return false; }
    const finish = result => {
      this.result = result; this.observations[this.mode] = { status: result.status, code: result.code, note: result.note, sensorName: result.sensorName, admin: result.admin ?? null, pawnIoInstalled: result.pawnIoInstalled ?? null };
      this.retryAt = result.status === 'available' ? 0 : this.now() + (['assets-missing', 'pawnio-missing'].includes(result.code) ? 300000 : 60000);
      callback(this.snapshot());
    };
    if (this.mode === 'enhanced' && !this.assetsAvailable()) { finish(this.makeResult('unavailable', 'assets-missing')); return false; }
    const epoch = this.epoch;
    this.inFlight = true;
    const done = (error, output) => {
      if (epoch !== this.epoch) return;
      this.inFlight = false;
      if (error) { finish(this.makeResult(error.code === 'ENOENT' ? 'unavailable' : 'failed', error.killed || error.code === 'ETIMEDOUT' ? 'timeout' : 'command-failed')); return; }
      let data;
      try { data = JSON.parse(output); } catch (_) {}
      if (!data || !['available', 'unavailable', 'failed'].includes(data.status)) { finish(this.makeResult('failed', 'invalid-output')); return; }
      const info = { admin: typeof data.admin === 'boolean' ? data.admin : null, pawnIoInstalled: typeof data.pawnIoInstalled === 'boolean' ? data.pawnIoInstalled : null };
      if (data.status !== 'available') {
        const allowed = ['pawnio-missing', 'provider-load-failed', 'unsupported-cpu', 'no-sensors', 'access-denied', 'thermal-zone-unavailable', 'invalid-output'];
        finish(this.makeResult(data.status, allowed.includes(data.code) ? data.code : 'command-failed', info)); return;
      }
      const sensor = this.mode === 'enhanced' ? selectCpuSensor(data.sensors) : validTemperature(data.temperatureC) ? { name: 'ACPI thermal zone', sensorType: 'system-thermal-zone', value: data.temperatureC } : null;
      if (!sensor) { finish(this.makeResult('unavailable', this.mode === 'enhanced' ? 'no-sensors' : 'thermal-zone-unavailable', info)); return; }
      finish(this.makeResult('available', this.mode === 'enhanced' ? 'available' : 'experimental', { ...info,
        temperatureC: Math.round(sensor.value * 10) / 10, sensorName: sensor.name, sensorType: sensor.sensorType, sampledAt: this.now() }));
    };
    try {
      const started = execute('cpu-temperature', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.root, 'scripts', 'cpu-temperature-provider.ps1'), '-Mode', this.mode], { windowsHide: true, timeout: 10000, maxBuffer: 64 * 1024 }, done);
      if (started === false) this.inFlight = false;
      return started !== false;
    } catch (error) { done(error, ''); return false; }
  }
}

module.exports = { CpuTemperatureProvider, selectCpuSensor, MODES, VERSION, ASSETS };
