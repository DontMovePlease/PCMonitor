'use strict';

const assert = require('assert');
const {
  TemperatureManager,
  loadTemperatureThresholds
} = require('../temperature-manager');

const manager = new TemperatureManager({
  staleAfterMs: 45000,
  providers: {
    cpu: { source: 'Windows CPU sensor', note: 'Unavailable on this host.' },
    gpu: { source: 'NVIDIA NVML' }
  }
});

let snapshot = manager.snapshot(1000);
assert.strictEqual(snapshot.readings.cpu.status, 'unavailable', 'CPU should be unavailable without a sensor');
assert.strictEqual(snapshot.alerts.current.cpu.level, 'unavailable');

const update = (temperatureC, sampledAt) => manager.setReading('gpu', {
  available: true,
  temperatureC,
  source: 'NVIDIA NVML',
  sampledAt
});

assert.strictEqual(update(65, 1000), true);
assert.strictEqual(manager.snapshot(1000).alerts.current.gpu.level, 'normal');
assert.strictEqual(update(78, 2000), true);
assert.strictEqual(manager.snapshot(2000).alerts.current.gpu.level, 'warning');
const warningEventCount = manager.snapshot(2000).alerts.events.length;
assert.strictEqual(update(78, 2000), true, 'replayed sample should remain accepted');
assert.strictEqual(manager.snapshot(2000).alerts.events.length, warningEventCount, 'duplicate samples must not duplicate alerts');
assert.strictEqual(update(85, 3000), true);
assert.strictEqual(manager.snapshot(3000).alerts.current.gpu.level, 'critical');
assert.strictEqual(update(82, 4000), true);
assert.strictEqual(manager.snapshot(4000).alerts.current.gpu.level, 'warning');
assert.strictEqual(update(77, 5000), true);
snapshot = manager.snapshot(5000);
assert.strictEqual(snapshot.alerts.current.gpu.level, 'normal');
assert.strictEqual(snapshot.alerts.events.at(-1).type, 'recovered');

const eventCount = snapshot.alerts.events.length;
assert.strictEqual(manager.setReading('gpu', { available: true, temperatureC: 151, source: 'invalid', sampledAt: 6000 }), false);
snapshot = manager.snapshot(6000);
assert.strictEqual(snapshot.readings.gpu.status, 'stale', 'invalid update should not be presented as fresh');
assert.strictEqual(snapshot.readings.gpu.temperatureC, 77, 'retain the last validated value for explicit stale display');
assert.strictEqual(snapshot.alerts.events.length, eventCount, 'sensor failure should not create a false recovery event');
assert.strictEqual(manager.snapshot(50001).readings.gpu.status, 'stale', 'old readings should age to stale');

const custom = loadTemperatureThresholds({
  PC_MONITOR_CPU_TEMP_WARNING_C: '88',
  PC_MONITOR_CPU_TEMP_CRITICAL_C: '97',
  PC_MONITOR_GPU_TEMP_WARNING_C: '79',
  PC_MONITOR_GPU_TEMP_CRITICAL_C: '86'
});
assert.deepStrictEqual(custom.cpu, { warning: 88, critical: 97 });
assert.deepStrictEqual(custom.gpu, { warning: 79, critical: 86 });
const invalid = loadTemperatureThresholds({
  PC_MONITOR_CPU_TEMP_WARNING_C: '99',
  PC_MONITOR_CPU_TEMP_CRITICAL_C: '90'
});
assert.deepStrictEqual(invalid.cpu, { warning: 85, critical: 95 }, 'invalid threshold order should fall back to defaults');

console.log('PASS unavailable CPU provider state');
console.log('PASS normal, warning, critical, downgrade, and recovery transitions');
console.log('PASS duplicate samples do not duplicate alert events');
console.log('PASS invalid values and stale readings are not presented as fresh');
console.log('PASS configurable thresholds validate and preserve safe defaults');
require('./cpu-temperature-smoke-test').main().catch(error => { console.error(error); process.exitCode = 1; });
