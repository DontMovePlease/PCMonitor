'use strict';

function parseCpuSeconds(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isSameProcessInstance(current, previous) {
  return Boolean(current && previous
    && current.pid === previous.pid
    && current.name === previous.name
    && typeof current.startedAt === 'string'
    && current.startedAt.length > 0
    && current.startedAt === previous.startedAt);
}

function normalizeProcessRecords(records, previousCpuTimes, sampledAt, logicalProcessors) {
  const nextCpuTimes = new Map();
  const processes = [];
  if (!Array.isArray(records)) return { processes, nextCpuTimes };

  for (const record of records) {
    if (!record || (typeof record.Id !== 'number' && typeof record.Id !== 'string')) continue;
    const pid = Number(record.Id);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    const name = String(record.ProcessName || 'Unknown').slice(0, 128);
    const cpuSeconds = parseCpuSeconds(record.CPU);
    const ramRaw = record.WorkingSet64;
    const ramBytes = typeof ramRaw === 'number' || (typeof ramRaw === 'string' && ramRaw.trim() !== '') ? Number(ramRaw) : NaN;
    if (!Number.isFinite(ramBytes) || ramBytes < 0) continue;
    const startedAt = typeof record.StartedAt === 'string' && record.StartedAt ? record.StartedAt : null;
    const currentIdentity = { pid, name, startedAt };
    const previous = previousCpuTimes.get(pid);
    const sameProcess = cpuSeconds !== null && startedAt && isSameProcessInstance(currentIdentity, previous) && cpuSeconds >= previous.cpuSeconds;
    const cpuPercent = cpuSeconds === null || !startedAt ? null : sameProcess
      ? calculateCpuPercent(cpuSeconds, previous.cpuSeconds, sampledAt - previous.sampledAt, logicalProcessors)
      : 0;
    if (cpuSeconds !== null && startedAt) nextCpuTimes.set(pid, { ...currentIdentity, cpuSeconds, sampledAt });
    processes.push({ name, pid, cpuPercent, ramMB: Math.round((ramBytes / (1024 ** 2)) * 10) / 10, startedAt });
  }

  processes.sort((a, b) => ((b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)) || (b.ramMB - a.ramMB));
  return { processes, nextCpuTimes };
}

function isProcessSnapshotStale(sampledAt, now, staleAfterMs) {
  return !Number.isFinite(sampledAt) || sampledAt <= 0
    || !Number.isFinite(now) || !Number.isFinite(staleAfterMs) || staleAfterMs < 0
    || now - sampledAt > staleAfterMs;
}

function calculateCpuPercent(cpuSeconds, previousCpuSeconds, elapsedMs, logicalProcessors) {
  if (!Number.isFinite(cpuSeconds) || cpuSeconds < 0 || !Number.isFinite(previousCpuSeconds) || previousCpuSeconds < 0) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || cpuSeconds < previousCpuSeconds) return 0;
  const cores = Number.isInteger(logicalProcessors) && logicalProcessors > 0 ? logicalProcessors : 1;
  const elapsedSeconds = elapsedMs / 1000;
  return Math.round(Math.max(0, Math.min(100, ((cpuSeconds - previousCpuSeconds) / elapsedSeconds) * (100 / cores))) * 10) / 10;
}

// Bounded exit verification. Never signals a still-present PID again: it may
// already identify a different process. No telemetry loop is created.
async function verifyProcessExit(pid, { probe = target => process.kill(target, 0), timeoutMs = 2000, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const checks = Math.max(1, Math.ceil(timeoutMs / 100));
  for (let index = 0; index <= checks; index++) {
    try { probe(pid); }
    catch (error) { return error.code === 'ESRCH' ? 'exited' : 'unconfirmed'; }
    if (index < checks) await pause(100);
  }
  return 'still-running';
}

module.exports = { calculateCpuPercent, parseCpuSeconds, isSameProcessInstance, normalizeProcessRecords, isProcessSnapshotStale, verifyProcessExit };
