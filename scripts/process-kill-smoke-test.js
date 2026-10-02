'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { verifyProcessExit } = require('../process-stats');
const { terminateProcess } = require('../process-termination');

async function testNativeIdentityHelper() {
  const child = spawnDisposable();
  try {
    const { execFile } = require('child_process');
    const identity = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-Process -Id ${child.pid}; @{pid=$p.Id;name=$p.ProcessName;startedAt=$p.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress`], { windowsHide: true, timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout))));
    // Bypass the cached API gate deliberately: the native helper itself must
    // reject a stale/reused identity and leave this unrelated live instance alone.
    assert.strictEqual((await terminateProcess({ ...identity, startedAt: FAKE_STARTED_AT })).code, 'stale-process');
    assert(probeAlive(child.pid));
    assert.strictEqual((await terminateProcess({ ...identity, name: identity.name + '-other' })).code, 'stale-process');
    assert(probeAlive(child.pid));
    const result = await terminateProcess(identity);
    assert.strictEqual(result.code, 'terminated'); assert.strictEqual(result.verified, true);
    await waitForExit(child);
    assert.strictEqual((await terminateProcess(identity)).code, 'already-exited');
    console.log('PASS native handle verifies exact creation time/name, rejects stale PID-reuse identity, terminates owned target and handles exit before action');
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
}

async function testHandleRaceFixture() {
  const os = require('os');
  const { execFile } = require('child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-monitor-handle-test-'));
  try {
    const helper = fs.readFileSync(path.join(root, 'scripts/terminate-process.ps1'), 'utf8');
    let code = helper.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@/)[1];
    code = code.replace(/\s*\[DllImport[^\n]+\n/g, '\n');
    code = code.replace(/    static extern [^\n]+\n/g, '');
    // Same production Run method, fake native boundary: PID mapping changes
    // during image validation, while the held handle must still target object 1.
    code = code.replace('    public static string Run', `
    public static int Current=1, Killed=0, Closed=0;
    static IntPtr OpenProcess(uint a,bool i,int p) { return new IntPtr(Current); }
    static bool GetProcessTimes(IntPtr h,out long c,out long e,out long k,out long u) { c=h.ToInt32()==1?100:200; e=k=u=0; return true; }
    static bool QueryFullProcessImageName(IntPtr h,uint f,StringBuilder n,ref uint s) { n.Append("node.exe"); Current=2; return true; }
    static bool TerminateProcess(IntPtr h,uint c) { Killed=h.ToInt32(); return true; }
    static uint WaitForSingleObject(IntPtr h,uint m) { return Killed==h.ToInt32()?0u:258u; }
    static bool CloseHandle(IntPtr h) { Closed++; return true; }
    public static string Run`);
    const file = path.join(directory, 'fixture.ps1');
    fs.writeFileSync(file, `Add-Type -TypeDefinition @'\n${code}\n'@\n$r=[PCMonitorTermination]::Run(123,'node',100); if($r -ne 'terminated' -or [PCMonitorTermination]::Killed -ne 1 -or [PCMonitorTermination]::Closed -ne 1){throw 'Held object changed'}\n$r=[PCMonitorTermination]::Run(123,'node',100); if($r -ne 'stale-process' -or [PCMonitorTermination]::Killed -ne 1 -or [PCMonitorTermination]::Closed -ne 2){throw 'Reused PID was terminated'}\n'PASS held-handle PID mapping race fixture'`);
    const output = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(stdout)));
    assert.match(output, /PASS held-handle/); console.log(output.trim());
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function testExitVerification() {
  const exited = () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); };
  assert.strictEqual(await verifyProcessExit(123, { probe: exited }), 'exited');
  let probes = 0;
  assert.strictEqual(await verifyProcessExit(123, { probe: () => { probes++; }, timeoutMs: 200, pause: async () => {} }), 'still-running');
  assert.strictEqual(probes, 3, 'exit verification is bounded and only probes');
  assert.strictEqual(await verifyProcessExit(123, { probe: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } }), 'unconfirmed');
  probes = 0;
  assert.strictEqual(await verifyProcessExit(123, { probe: () => { if (++probes > 2) exited(); }, pause: async () => {} }), 'exited');
  console.log('PASS bounded exit verification: exited, delayed exit, still-running, and permission-denied outcomes');
}

async function testProcessesUI() {
  const elements = new Map(), windowEvents = new Map(), documentEvents = new Map();
  function element() {
    const classes = new Set();
    return { children: [], events: new Map(), attrs: {}, dataset: {}, textContent: '', hidden: false,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(name, callback) { this.events.set(name, callback); },
      replaceChildren() { this.children = []; },
      insertRow() { const row = element(); this.children.push(row); return row; },
      insertCell() { const cell = element(); this.children.push(cell); return cell; }
    };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const sortButtons = [element(), element()]; sortButtons[0].dataset.sort = 'cpu'; sortButtons[1].dataset.sort = 'memory';
  const a = { pid: 100, name: 'A', startedAt: '2020-01-01T00:00:00Z', cpuPercent: 90, ramMB: 30 };
  const b = { pid: 200, name: 'B', startedAt: '2020-01-02T00:00:00Z', cpuPercent: 20, ramMB: 50 };
  let current = { processes: [a, b], sampledAt: Date.now(), stale: false }, killResult = { success: true, verified: true }, sentIdentity;
  const context = { document: { visibilityState: 'visible', getElementById: get, querySelectorAll: () => sortButtons, addEventListener: (name, callback) => documentEvents.set(name, callback) },
    window: { monitoringLeaseId: 'lease', confirm: () => true, location: { replace() {} }, addEventListener: (name, callback) => windowEvents.set(name, callback) },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async (route, options) => {
      if (route.endsWith('/kill')) { sentIdentity = JSON.parse(options.body); return { ok: killResult.success, status: killResult.success ? 200 : 409, json: async () => killResult }; }
      return { ok: true, status: 200, json: async () => current };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public', 'processes.js'), 'utf8'), context);
  const send = data => { current = data; windowEvents.get('pc-monitor-processes')({ detail: data }); };
  const rows = get('processesRows');
  send(current);
  assert.strictEqual(rows.children[0].children[0].textContent, 'A');
  const touched = rows.children[0];
  rows.events.get('pointerdown')({ pointerId: 1 });
  send({ processes: [{ ...a, cpuPercent: 1 }, { ...b, cpuPercent: 95 }], sampledAt: Date.now() + 1, stale: false });
  assert.strictEqual(rows.children[0], touched, 'SSE cannot replace the DOM under a finger');
  touched.events.get('click')();
  assert(touched.classList.contains('is-selected'));
  assert.match(get('processesSelection').textContent, /A \(PID 100\)/);
  documentEvents.get('pointerup')({ pointerId: 1 });
  await new Promise(resolve => setTimeout(resolve, 210));
  assert.strictEqual(rows.children[0].children[0].textContent, 'A', 'selection keeps presentation order stable despite CPU resort');
  get('processesFreezeButton').events.get('click')();
  const frozenRow = rows.children[0];
  send({ processes: [{ ...a, cpuPercent: 70 }, b], sampledAt: Date.now() + 2, stale: false });
  assert.strictEqual(rows.children[0], frozenRow, 'freeze retains presentation and values');
  assert.match(get('processesLiveText').textContent, /Frozen/);
  get('processesFreezeButton').events.get('click')();
  assert.strictEqual(rows.children[0].children[2].textContent, '70.0%', 'resume applies the latest snapshot');
  await get('processesKillButton').events.get('click')();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(sentIdentity, { pid: a.pid, name: a.name, startedAt: a.startedAt }, 'End Task targets the selected identity, never row position');
  assert(!rows.children.some(row => row.children[0].textContent === 'A'), 'successful kill immediately removes the old identity even if cached GET is late');
  assert.match(get('processesKillStatus').textContent, /exit confirmed/);
  const restarted = { ...a, startedAt: '2020-01-03T00:00:00Z' };
  send({ processes: [restarted, b], sampledAt: Date.now() + 10, stale: false });
  assert(rows.children.some(row => row.children[0].textContent === 'A'), 'respawned identity is treated as new');
  rows.children.find(row => row.children[0].textContent === 'A').events.get('click')();
  killResult = { success: false, code: 'termination-unconfirmed', error: 'PID is still present.' };
  await get('processesKillButton').events.get('click')();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(get('processesKillStatus').textContent, /still present/);
  assert(rows.children.some(row => row.children[0].textContent === 'A'), 'failed/unconfirmed kill does not hide a live row');
  sortButtons[1].events.get('click')();
  assert.strictEqual(rows.children[0].children[0].textContent, 'B', 'explicit memory sort works while selection identity remains A');
  assert.match(get('processesSelection').textContent, /A \(PID 100\)/);
  windowEvents.get('pc-monitor-pagechange')({ detail: { page: 'dashboardPage' } });
  context.document.visibilityState = 'hidden'; documentEvents.get('visibilitychange')();
  console.log('PASS process UI touch hold, identity selection, order lock, freeze/resume, sorting, immediate kill feedback, late cache, respawn, and failed-kill reconciliation');
}

const root = path.resolve(__dirname, '..');
const pin = String(crypto.randomInt(100000000000, 999999999999));
const FAKE_STARTED_AT = '2001-01-01T00:00:00.0000000Z';
let serverProcess;
let output = '';
let baseUrl = null;
const disposableChildren = new Set();

function request(route, { method = 'GET', cookie, leaseId, body, headers = {} } = {}) {
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(leaseId ? { 'X-Monitor-Lease': leaseId } : {}),
      ...headers
    },
    body
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: '0', PC_MONITOR_PIN: pin, PC_MONITOR_SESSION_TTL_MS: '60000', PC_MONITORING_LEASE_TTL_MS: '30000' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => reject(new Error(`Server did not start in time. ${output.slice(-1200)}`)), 15000);
    const inspect = chunk => {
      output += chunk.toString();
      const match = output.match(/Localhost access: http:\/\/127\.0\.0\.1:(\d+)/);
      if (match && !baseUrl) {
        baseUrl = `http://127.0.0.1:${match[1]}`;
        clearTimeout(timer);
        resolve();
      }
    };
    serverProcess.stdout.on('data', inspect);
    serverProcess.stderr.on('data', inspect);
    serverProcess.on('error', reject);
    serverProcess.on('exit', code => {
      if (!baseUrl) {
        clearTimeout(timer);
        reject(new Error(`Server exited (${code}). ${output.slice(-1200)}`));
      }
    });
  });
}

async function login() {
  const response = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  assert.strictEqual(response.status, 200, 'valid PIN should authenticate the kill-test client');
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
  const sessionCookie = cookies.find(cookie => cookie.startsWith('pc_monitor_session='));
  assert(sessionCookie, 'login should return the normal authenticated session cookie');
  return sessionCookie.split(';')[0];
}

async function postLease(cookie, payload) {
  return request('/api/monitoring/lease', {
    method: 'POST', cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function getStatus(cookie) {
  const response = await request('/api/monitoring/status', { cookie });
  assert.strictEqual(response.status, 200);
  return response.json();
}

async function getProcesses(cookie, leaseId) {
  const response = await request('/api/processes', { cookie, leaseId });
  assert.strictEqual(response.status, 200, 'the processes lease owner should read the cached snapshot');
  return response.json();
}

async function waitForObservedProcess(cookie, leaseId, pid, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await getProcesses(cookie, leaseId);
    const observed = snapshot.processes.find(item => item.pid === pid);
    if (observed && observed.startedAt) return { snapshot, observed };
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for PID ${pid} in the process snapshot. ${output.slice(-1200)}`);
}

function spawnDisposable() {
  // Harmless, short-lived target: holds a buffer and burns brief CPU slices so it
  // reliably appears inside the bounded top-50 snapshot. Never a system process.
  const child = spawn(process.execPath, ['-e',
    'global.keep = Buffer.alloc(64 * 1024 * 1024); setInterval(() => { const end = Date.now() + 40; while (Date.now() < end) {} }, 200);'
  ], { windowsHide: true, stdio: 'ignore' });
  disposableChildren.add(child);
  child.once('exit', () => disposableChildren.delete(child));
  return child;
}

function probeAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

async function waitForExit(child, timeoutMs = 8000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Disposable process ${child.pid} did not exit in time.`)), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function killProcess(cookie, leaseId, payload, extraHeaders = {}) {
  return request('/api/processes/kill', {
    method: 'POST', cookie, leaseId,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload)
  });
}

async function testProcessKill() {
  await startServer();
  const cookie = await login();
  const cookie2 = await login();
  let leaseId = null;
  let leaseId2 = null;
  try {
    const acquired = await postLease(cookie, { action: 'acquire' });
    assert.strictEqual(acquired.status, 201);
    leaseId = (await acquired.json()).leaseId;
    assert.strictEqual((await postLease(cookie, { action: 'set-profile', leaseId, profile: 'processes' })).status, 200);

    // ── Authentication, origin, and lease scoping ─────────────────────────────
    const unauth = await killProcess(null, leaseId, { pid: 1234, name: 'node', startedAt: FAKE_STARTED_AT });
    assert.strictEqual(unauth.status, 401, 'unauthenticated kill must be rejected');

    const crossSite = await killProcess(cookie, leaseId, { pid: 1234, name: 'node', startedAt: FAKE_STARTED_AT }, { 'Sec-Fetch-Site': 'cross-site' });
    assert.strictEqual(crossSite.status, 403, 'cross-origin kill must be rejected');

    const dashboardAcquired = await postLease(cookie2, { action: 'acquire' });
    assert.strictEqual(dashboardAcquired.status, 201);
    leaseId2 = (await dashboardAcquired.json()).leaseId;
    const wrongProfile = await killProcess(cookie2, leaseId2, { pid: 1234, name: 'node', startedAt: FAKE_STARTED_AT });
    assert.strictEqual(wrongProfile.status, 403, 'a dashboard-only lease must not allow kills');
    assert.strictEqual((await wrongProfile.json()).code, 'profile-required');

    const foreignLease = await killProcess(cookie2, leaseId, { pid: 1234, name: 'node', startedAt: FAKE_STARTED_AT });
    assert.strictEqual(foreignLease.status, 403, 'another session cannot use this lease for a kill');
    console.log('PASS kill authentication, origin validation, and lease scoping');

    // ── Strict input validation ───────────────────────────────────────────────
    const invalidCases = [
      { pid: '1234', name: 'node', startedAt: FAKE_STARTED_AT },
      { pid: -1, name: 'node', startedAt: FAKE_STARTED_AT },
      { pid: 12.5, name: 'node', startedAt: FAKE_STARTED_AT },
      { pid: 0, name: 'node', startedAt: FAKE_STARTED_AT },
      { pid: 4194305, name: 'node', startedAt: FAKE_STARTED_AT },
      { pid: 1234, name: '', startedAt: FAKE_STARTED_AT },
      { pid: 1234, name: 'node' },
      { pid: 1234, name: 'node', startedAt: 'not-a-date' },
      { pid: 1234, name: 'node', startedAt: FAKE_STARTED_AT, force: true },
      { pid: 1234, name: 'node', startedAt: FAKE_STARTED_AT, extra: null },
      'not json at all',
      { pid: '1234; taskkill /f /im node.exe', name: 'node', startedAt: FAKE_STARTED_AT }
    ];
    for (const payload of invalidCases) {
      const response = await killProcess(cookie, leaseId, payload);
      assert.strictEqual(response.status, 400, `invalid payload must be rejected: ${JSON.stringify(payload).slice(0, 90)}`);
      const data = await response.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, 'invalid-request');
    }

    const wrongType = await request('/api/processes/kill', {
      method: 'POST', cookie, leaseId,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ pid: 1234, name: 'node', startedAt: FAKE_STARTED_AT })
    });
    assert.strictEqual(wrongType.status, 415, 'non-JSON content types must be rejected');

    const oversized = await killProcess(cookie, leaseId, `{"pid":1,"name":"x","startedAt":"${FAKE_STARTED_AT.repeat(60)}"}`);
    assert.strictEqual(oversized.status, 413, 'oversized kill bodies must be rejected');

    const shellName = await killProcess(cookie, leaseId, { pid: 999999, name: 'node"; Start-Process calc; "', startedAt: FAKE_STARTED_AT });
    assert.notStrictEqual(shellName.status, 200, 'shell syntax in fields must never succeed or be interpreted');
    assert([400, 409, 410].includes(shellName.status), `unexpected status for shell-syntax payload: ${shellName.status}`);
    assert.strictEqual((await request('/api/monitoring/status', { cookie })).status, 200, 'server must stay healthy after injection attempts');
    console.log('PASS strict kill input validation, content-type enforcement, and no command-execution path');

    // ── PC Monitor self-protection ────────────────────────────────────────────
    const protectionCases = [
      { payload: { pid: serverProcess.pid, name: 'node', startedAt: FAKE_STARTED_AT }, label: 'the active server' },
      { payload: { pid: process.pid, name: 'node', startedAt: FAKE_STARTED_AT }, label: 'its parent control process' },
      { payload: { pid: 4, name: 'System', startedAt: FAKE_STARTED_AT }, label: 'a system PID' },
      { payload: { pid: 12345, name: 'csrss', startedAt: FAKE_STARTED_AT }, label: 'a critical process name' }
    ];
    for (const { payload, label } of protectionCases) {
      const response = await killProcess(cookie, leaseId, payload);
      assert.strictEqual(response.status, 403, `${label} must be refused`);
      assert.strictEqual((await response.json()).code, 'protected-process', `${label} must be reported as protected`);
    }
    assert.strictEqual(serverProcess.exitCode, null, 'the server must still be running after self-protection refusals');
    assert.strictEqual((await request('/api/monitoring/status', { cookie })).status, 200, 'server must answer after self-protection refusals');
    console.log('PASS PC Monitor self-protection and critical-process refusal');

    // ── Process identity / PID reuse ──────────────────────────────────────────
    const child1 = spawnDisposable();
    const { observed: observed1 } = await waitForObservedProcess(cookie, leaseId, child1.pid);

    const wrongTime = await killProcess(cookie, leaseId, { pid: observed1.pid, name: observed1.name, startedAt: FAKE_STARTED_AT });
    assert.strictEqual(wrongTime.status, 409, 'a stale start time must be refused');
    assert.strictEqual((await wrongTime.json()).code, 'stale-process');
    assert(probeAlive(child1.pid), 'a stale identity must not terminate the live process');

    const wrongName = await killProcess(cookie, leaseId, { pid: observed1.pid, name: `${observed1.name}-other`, startedAt: observed1.startedAt });
    assert.strictEqual(wrongName.status, 409, 'a mismatched name must be refused');
    assert(probeAlive(child1.pid), 'a name mismatch must not terminate the live process');
    console.log('PASS PID-reuse identity verification refuses stale targets');

    // ── Already exited ────────────────────────────────────────────────────────
    child1.kill();
    await waitForExit(child1);
    const exited = await killProcess(cookie, leaseId, { pid: observed1.pid, name: observed1.name, startedAt: observed1.startedAt });
    assert.strictEqual(exited.status, 410, 'an already-exited process must return a controlled response');
    assert.strictEqual((await exited.json()).code, 'already-exited');
    console.log('PASS already-exited processes return controlled responses');

    // ── Real termination of a disposable process + duplicate request ──────────
    const child2 = spawnDisposable();
    const { observed: observed2 } = await waitForObservedProcess(cookie, leaseId, child2.pid);
    const killed = await killProcess(cookie, leaseId, { pid: observed2.pid, name: observed2.name, startedAt: observed2.startedAt });
    assert.strictEqual(killed.status, 200, 'a verified kill should succeed');
    const killedData = await killed.json();
    assert.strictEqual(killedData.success, true);
    assert.strictEqual(killedData.code, 'terminated');
    assert.strictEqual(killedData.pid, observed2.pid);
    await waitForExit(child2, 8000);
    assert(!probeAlive(child2.pid), 'the terminated disposable process must be gone');

    const duplicate = await killProcess(cookie, leaseId, { pid: observed2.pid, name: observed2.name, startedAt: observed2.startedAt });
    assert.strictEqual(duplicate.status, 200, 'a duplicate kill must resolve as a controlled idempotent response');
    assert.strictEqual((await duplicate.json()).code, 'already-terminated');

    const snapshotAfterKill = await getProcesses(cookie, leaseId);
    assert(!snapshotAfterKill.processes.some(item => item.pid === observed2.pid), 'the killed process must be dropped from the cached snapshot immediately');
    console.log('PASS real termination of a disposable process, snapshot removal, and duplicate requests');

    // ── Concurrent duplicate requests ─────────────────────────────────────────
    const child3 = spawnDisposable();
    const { observed: observed3 } = await waitForObservedProcess(cookie, leaseId, child3.pid);
    const [first, second] = await Promise.all([
      killProcess(cookie, leaseId, { pid: observed3.pid, name: observed3.name, startedAt: observed3.startedAt }),
      killProcess(cookie, leaseId, { pid: observed3.pid, name: observed3.name, startedAt: observed3.startedAt })
    ]);
    assert.deepStrictEqual([first.status, second.status].sort((a, b) => a - b), [200, 200], 'concurrent duplicates must both resolve cleanly');
    const bodyCodes = [(await first.json()).code, (await second.json()).code].sort();
    assert.deepStrictEqual(bodyCodes, ['already-terminated', 'terminated'], 'exactly one concurrent request may perform the termination');
    await waitForExit(child3, 8000);
    console.log('PASS concurrent duplicate kill requests terminate exactly once');

    // Reproduce the documented single-process scope with disposable fixtures:
    // ending a parent must not silently expand into killing its children.
    await postLease(cookie, { action: 'heartbeat', leaseId });
const parent = spawn(process.execPath, ['-e', 'const {spawn}=require("child_process");const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",windowsHide:true,detached:true});child.unref();console.log(child.pid);global.keep=Buffer.alloc(64*1024*1024);setInterval(()=>{const end=Date.now()+40;while(Date.now()<end){}},200);'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    disposableChildren.add(parent);
    parent.once('exit', () => disposableChildren.delete(parent));
    let descendantPid;
    try {
      descendantPid = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Disposable parent did not identify its child.')), 5000);
        parent.stdout.once('data', chunk => { clearTimeout(timer); resolve(Number(String(chunk).trim())); });
      });
      assert(Number.isSafeInteger(descendantPid) && descendantPid > 0);
      const { observed } = await waitForObservedProcess(cookie, leaseId, parent.pid);
      const response = await killProcess(cookie, leaseId, { pid: observed.pid, name: observed.name, startedAt: observed.startedAt });
      assert.strictEqual(response.status, 200);
      assert.strictEqual((await response.json()).verified, true);
      await waitForExit(parent);
      assert(probeAlive(descendantPid), 'single-identity End Task intentionally leaves child processes alive');
      console.log('PASS reproduced surviving child after verified parent termination; no unsafe process-tree expansion');
    } finally { if (descendantPid) { try { process.kill(descendantPid); } catch (_) {} } }

    // ── Adaptive monitoring and existing APIs unchanged ───────────────────────
    const status = await getStatus(cookie);
    assert.strictEqual(status.timers.processes, 5000, 'the kill feature must not change process sampling cadence');
    assert(!Object.keys(status.timers).some(key => key.includes('kill')), 'kill must not add a polling timer');
    assert(!status.activeCommands.some(name => String(name).includes('kill')), 'kill must not add a background command');
    const metrics = await request('/api/metrics', { cookie, leaseId });
    assert.strictEqual(metrics.status, 200, '/api/metrics must remain intact');
    const stream = await request(`/api/stream?lease=${encodeURIComponent(leaseId)}`, { cookie });
    assert.strictEqual(stream.status, 200, '/api/stream must remain intact');
    await stream.body.cancel();
    console.log('PASS adaptive monitoring unchanged and existing APIs intact');
  } finally {
    if (leaseId) await postLease(cookie, { action: 'release', leaseId }).catch(() => {});
    if (leaseId2) await postLease(cookie2, { action: 'release', leaseId2 }).catch(() => {});
    for (const child of disposableChildren) { try { child.kill(); } catch (_) {} }
  }
}

async function main() {
  try {
    await testExitVerification();
    await testProcessesUI();
    await testHandleRaceFixture();
    await testNativeIdentityHelper();
    await testProcessKill();
    console.log('PASS kill authentication, validation, identity protection, self-protection, and real termination');
  } finally {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill();
      await new Promise(resolve => serverProcess.once('exit', resolve));
    }
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  console.error(output.slice(-1600));
  process.exitCode = 1;
});
