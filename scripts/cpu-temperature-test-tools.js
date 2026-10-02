'use strict';
// Test-only preload: deterministic sensor results, never loaded in production.
const assert = require('assert');
const cp = require('child_process');
const original = cp.execFile;
const fixture = process.env.PC_MONITOR_CPU_TEMPERATURE_FIXTURE;
if (fixture) cp.execFile = (command, args, options, callback) => {
  if (!args.includes(require('path').join(__dirname, 'cpu-temperature-provider.ps1'))) return original(command, args, options, callback);
  assert.strictEqual(command, 'powershell.exe'); assert.strictEqual(options.timeout, 10000); assert.strictEqual(options.maxBuffer, 65536); assert(!options.shell);
  console.log('CPU_TEMPERATURE_TEST_SAMPLE');
  if (fixture === 'hold') return original(command, ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 20'], options, callback);
  if (fixture === 'throws') throw new Error('private C:\\secret\\failure');
  let error = null, data = { status: 'available', admin: false, pawnIoInstalled: true, temperatureC: 100,
    sensors: [{ hardwareType: 'Cpu', sensorType: 'Temperature', name: 'CPU Package', value: 63 }] };
  if (['exit', 'timeout'].includes(fixture)) error = Object.assign(new Error('private failure'), { code: fixture === 'timeout' ? 'ETIMEDOUT' : 1, killed: fixture === 'timeout' });
  if (['pawnio-missing', 'unsupported-cpu', 'no-sensors', 'thermal-zone-unavailable'].includes(fixture)) data = { status: 'unavailable', code: fixture, admin: false, pawnIoInstalled: fixture !== 'pawnio-missing' };
  if (['provider-load-failed', 'access-denied'].includes(fixture)) data = { status: 'failed', code: fixture };
  if (fixture === 'invalid') data = { status: 'available', temperatureC: null, sensors: [{ hardwareType: 'Motherboard', sensorType: 'Temperature', name: 'CPU Package', value: 61 }] };
  const timer = setTimeout(() => callback(error, fixture === 'malformed' ? 'not-json' : JSON.stringify(data), ''), 25);
  return { kill() { clearTimeout(timer); callback(Object.assign(new Error('canceled'), { killed: true }), '', ''); } };
};
