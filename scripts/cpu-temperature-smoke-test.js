'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { CpuTemperatureProvider, selectCpuSensor } = require('../cpu-temperature-provider');
const { TemperatureManager } = require('../temperature-manager');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cpu = (name, value, hardwareType = 'Cpu') => ({ name, value, hardwareType, sensorType: 'Temperature' });

async function testProvider() {
  assert.strictEqual(selectCpuSensor([cpu('CPU Package', 99, 'Gpu'), cpu('System', 63)]), null);
  assert.strictEqual(selectCpuSensor([cpu('CPU Core #1', 70), cpu('CPU Package', 63), cpu('Core Max', 75)]).name, 'CPU Package');
  assert.strictEqual(selectCpuSensor([cpu('Core (Tctl)', 95), cpu('Core (Tdie)', 65)]).name, 'Core (Tdie)');
  assert.strictEqual(selectCpuSensor([cpu('CPU Core #1', 71), cpu('CPU Core #2', 72)]).value, 72);
  assert.strictEqual(selectCpuSensor([cpu('CPU Core', 70)]).value, 70, 'single-core sensors remain supported');
  assert.strictEqual(selectCpuSensor([cpu('CPU Core #1 Distance to TjMax', 70)]), null, 'distance-to-limit is not temperature');
  for (const value of [null, '', NaN, Infinity, -1, 126]) assert.strictEqual(selectCpuSensor([cpu('CPU Package', value)]), null);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-monitor-temperature-'));
  try {
    let now = Date.now(), calls = 0;
    const settingsFile = path.join(directory, 'settings.json');
    const provider = new CpuTemperatureProvider({ settingsFile, now: () => now, assetsAvailable: () => true });
    const sample = (data, error) => new Promise(resolve => provider.sample((_name, _command, _args, options, callback) => {
      calls++; assert.strictEqual(options.timeout, 10000); callback(error, typeof data === 'string' ? data : JSON.stringify(data)); return true;
    }, resolve));
    assert.strictEqual(provider.mode, 'enhanced');
    assert.throws(() => provider.setMode('../file'), /invalid-mode/);
    assert.strictEqual((await sample({ status: 'available', sensors: [cpu('CPU Package', 63)] })).temperatureC, 63);
    for (const [error, status, code] of [[{ code: 'ENOENT' }, 'unavailable', 'command-failed'], [{ killed: true }, 'failed', 'timeout'], [{ code: 1 }, 'failed', 'command-failed']]) {
      provider.setMode('enhanced'); const result = await sample('', error); assert.strictEqual(result.status, status); assert.strictEqual(result.code, code);
      const before = calls; await sample(''); assert.strictEqual(calls, before, 'failures back off without launching another process'); now += 300001;
    }
    for (const data of ['bad-json', { status: 'available', sensors: [cpu('CPU Package', null)] }, { status: 'available', sensors: [cpu('CPU Package', 65, 'Motherboard')] }]) {
      provider.setMode('enhanced'); assert.notStrictEqual((await sample(data)).status, 'available');
    }
    provider.setMode('thermal-zone'); const thermal = await sample({ status: 'available', temperatureC: 100 });
    assert.strictEqual(thermal.sensorType, 'system-thermal-zone'); assert.match(thermal.note, /may not represent CPU/);
    const manager = new TemperatureManager();
    manager.setReading('cpu', { ...thermal, available: true, suppressAlerts: true });
    assert.strictEqual(manager.snapshot().alerts.current.cpu.active, false); assert.strictEqual(manager.snapshot().alerts.events.length, 0);
    manager.setReading('gpu', { available: true, temperatureC: 90 }); manager.clearReading('cpu');
    assert.strictEqual(manager.snapshot().alerts.current.gpu.level, 'critical', 'CPU mode changes do not reset GPU alerts');
    provider.setMode('off'); const before = calls; assert.strictEqual((await sample('')).status, 'disabled'); assert.strictEqual(calls, before);
    assert.strictEqual(new CpuTemperatureProvider({ settingsFile, assetsAvailable: () => true }).mode, 'off', 'mode persists separately from auth');
    const missing = new CpuTemperatureProvider({ settingsFile: null, assetsAvailable: () => false }); missing.setMode('enhanced');
    let result; missing.sample(() => { throw new Error('must not run'); }, data => result = data);
    assert.strictEqual(result.code, 'assets-missing');
    provider.setMode('enhanced'); let delayed; provider.sample((_n, _c, _a, _o, done) => { delayed = done; return true; }, () => { throw new Error('obsolete callback'); });
    assert.strictEqual(provider.sample(() => { throw new Error('duplicate'); }, () => {}), false);
    provider.setMode('off'); delayed(null, JSON.stringify({ status: 'available', sensors: [cpu('CPU Package', 60)] }));
    assert.strictEqual(provider.snapshot().status, 'disabled', 'late callbacks cannot overwrite a new mode');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  console.log('PASS CPU-only selection, AMD fallback, numeric validation, persistence, failure backoff, cancellation, and thermal-zone alert isolation');
}

async function testApi(fixture, mode = 'enhanced') {
  const root = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['--require', './scripts/diagnostics-test-tools.js', '--require', './scripts/cpu-temperature-test-tools.js', 'server.js'], {
    cwd: root, env: { ...process.env, PORT: '0', PC_MONITOR_PIN: '123456789012', PC_MONITOR_DIAGNOSTICS_FIXTURE: 'supported', PC_MONITOR_CPU_TEMPERATURE_FIXTURE: fixture, PC_MONITORING_LEASE_TTL_MS: '1000' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  try {
    for (let i = 0; i < 150 && !/Localhost access: http:\/\/127\.0\.0\.1:(\d+)/.test(output); i++) { assert.strictEqual(child.exitCode, null, output); await pause(100); }
    const match = output.match(/Localhost access: http:\/\/127\.0\.0\.1:(\d+)/); assert(match, output);
    const base = 'http://127.0.0.1:' + match[1]; let cookie;
    const request = (route, method = 'GET', body, extra = {}) => fetch(base + route, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const method of ['GET', 'POST']) assert.strictEqual((await request('/api/temperature/settings', method, method === 'POST' ? { mode: 'off' } : undefined)).status, 401);
    const login = await request('/api/login', 'POST', { pin: '123456789012' }); assert.strictEqual(login.status, 200);
    cookie = login.headers.getSetCookie().find(value => value.startsWith('pc_monitor_session=')).split(';')[0];
    assert.strictEqual((await request('/api/temperature/settings', 'POST', { mode: 'off' }, { Origin: 'http://attacker.test' })).status, 403);
    for (const bad of [{ mode: '../tool' }, { mode: 'enhanced', path: 'C:\\private' }, { mode: 2 }, [], null]) assert.strictEqual((await request('/api/temperature/settings', 'POST', bad)).status, 400);
    assert.strictEqual((await request('/api/temperature/settings?path=bad')).status, 400);
    assert.strictEqual((await request('/api/temperature/settings', 'POST', { mode }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.strictEqual((await fetch(base + '/api/temperature/settings', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.strictEqual((await request('/api/temperature/settings', 'POST', { mode })).status, 200);
    assert(!output.includes('CPU_TEMPERATURE_TEST_SAMPLE'), 'settings and idle server do not launch provider');
    const lease = await (await request('/api/monitoring/lease', 'POST', { action: 'acquire' })).json(); assert(lease.leaseId);
    if (fixture === 'hold') {
      const live = await (await request('/api/monitoring/status')).json(); assert(live.activeCommands.includes('cpu-temperature'));
      await pause(1800);
      const idle = await (await request('/api/monitoring/status')).json();
      assert.strictEqual(idle.active, false); assert.deepStrictEqual(idle.timers, {}); assert.deepStrictEqual(idle.activeCommands, []); assert.deepStrictEqual(idle.terminatingCommands, []);
      console.log('PASS real sleeping PowerShell helper terminated and reaped on final lease expiry'); return;
    }
    await pause(150);
    const response = await request('/api/metrics?lease=' + lease.leaseId); assert.strictEqual(response.status, 200);
    const data = (await response.json()).metrics;
    assert(data.cpu.sampledAt && data.ram, 'unrelated samplers continue');
    const expected = fixture === 'success' ? 'available' : ['exit', 'timeout', 'throws', 'malformed', 'provider-load-failed', 'access-denied'].includes(fixture) ? 'failed' : 'unavailable';
    assert.strictEqual(data.cpu.temperatureProvider.status, expected, fixture + ': ' + JSON.stringify(data.cpu.temperatureProvider));
    if (mode === 'thermal-zone') { assert.strictEqual(data.temperatureAlerts.current.cpu.active, false); assert(!data.temperatureAlerts.events.some(event => event.component === 'cpu')); }
    const stream = await request('/api/stream?lease=' + lease.leaseId); assert.strictEqual(stream.status, 200); await stream.body.cancel();
    const report = await (await request('/api/diagnostics')).json();
    assert.strictEqual(report.temperatureSettings.mode, mode); assert.strictEqual(report.overall.status, 'supported');
    assert.strictEqual(report.checks.find(check => check.id === 'cpu-temperature').status, expected === 'available' ? 'supported' : expected);
    assert(!JSON.stringify(report).includes('C:\\secret')); assert(!JSON.stringify(report).includes('123456789012'));
    assert.strictEqual(output.split('CPU_TEMPERATURE_TEST_SAMPLE').length - 1, 1, 'one provider launch; diagnostics reuses cached status');
    assert.strictEqual((await request('/api/temperature/settings', 'POST', { mode: 'off' })).status, 200);
    const state = await (await request('/api/monitoring/status')).json(); assert.strictEqual(state.timers.temperature, undefined, 'Off removes the centralized temperature timer');
    assert.strictEqual(state.timers.gpu, 4000, 'GPU cadence unchanged');
    await pause(1200);
    const idle = await (await request('/api/monitoring/status')).json(); assert.strictEqual(idle.active, false); assert.deepStrictEqual(idle.timers, {}); assert.deepStrictEqual(idle.activeCommands, []);
    assert.strictEqual(output.split('CPU_TEMPERATURE_TEST_SAMPLE').length - 1, 1, 'no helper after expiry');
  } finally { if (child.exitCode === null) { const exit = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exit; } }
  console.log('PASS authenticated CPU provider API, isolation, SSE, diagnostics, Off and lease expiry: ' + mode + '/' + fixture);
}

async function main() {
  await testProvider();
  for (const fixture of ['success', 'pawnio-missing', 'unsupported-cpu', 'no-sensors', 'provider-load-failed', 'access-denied', 'invalid', 'malformed', 'exit', 'timeout', 'throws']) await testApi(fixture);
  for (const fixture of ['success', 'thermal-zone-unavailable', 'access-denied', 'invalid', 'malformed', 'timeout']) await testApi(fixture, 'thermal-zone');
  await testApi('hold');
}
module.exports = { main };
