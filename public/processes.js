'use strict';

(() => {
  const clientVisible = () => typeof window.dashboardClientVisible === 'function' ? window.dashboardClientVisible() : document.visibilityState === 'visible';
  const rows = document.getElementById('processesRows');
  const liveText = document.getElementById('processesLiveText');
  const liveDot = document.getElementById('processesLiveDot');
  const updated = document.getElementById('processesUpdated');
  const buttons = Array.from(document.querySelectorAll('.processes-sort button'));
  let sortBy = 'cpu';
  let snapshot = null;
  let newestSnapshot = null;
  let frozen = false;
  let touching = false;
  let interactionTimer = null;
  let displayOrder = [];
  const pointers = new Set();
  const endedIdentities = new Map();
  const freezeButton = document.getElementById('processesFreezeButton');
  let refreshTimer = null;
  let inFlight = false;
  let streamConnected = false;
  let selected = null;
  let killBusy = false;
  const killButton = document.getElementById('processesKillButton');
  const selectionText = document.getElementById('processesSelection');
  const killStatus = document.getElementById('processesKillStatus');
  function processLeaseHeader() { return window.monitoringLeaseId ? { 'X-Monitor-Lease': window.monitoringLeaseId } : {}; }
  const identity = item => `${item.pid}|${item.name}|${item.startedAt || ''}`;

  function acceptSnapshot(data) {
    // Ignore out-of-order cached GET results after a newer SSE sample.
    if (newestSnapshot?.sampledAt && data.sampledAt && data.sampledAt < newestSnapshot.sampledAt) return;
    newestSnapshot = data;
    if (!frozen && !touching && !killBusy) { snapshot = data; render(); }
  }

  function syncSelection() {
    const present = selected && newestSnapshot?.processes?.some(item => identity(item) === identity(selected));
    selectionText.textContent = selected ? `Selected · ${selected.name} (PID ${selected.pid})${present ? '' : ' · not in latest list'}` : 'Select a process to end';
    selectionText.title = selected ? `Observed start: ${selected.startedAt}` : '';
    killButton.disabled = !selected || !present || killBusy || newestSnapshot?.stale || !!newestSnapshot?.error || !newestSnapshot?.sampledAt || Date.now() - newestSnapshot.sampledAt > 15000;
  }

  function holdInteraction(event) {
    pointers.add(event.pointerId ?? 'keyboard');
    touching = true;
    clearTimeout(interactionTimer);
  }
  function releaseInteraction(event) {
    pointers.delete(event.pointerId ?? 'keyboard');
    if (pointers.size) return;
    clearTimeout(interactionTimer);
    // Keep the clicked row intact through pointerup and the ensuing click.
    interactionTimer = setTimeout(() => {
      touching = false;
      if (!frozen && !killBusy) { snapshot = newestSnapshot; render(); }
    }, 180);
  }
  rows.addEventListener('pointerdown', holdInteraction);
  rows.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') holdInteraction(event); });
  document.addEventListener('pointerup', releaseInteraction);
  document.addEventListener('pointercancel', releaseInteraction);
  rows.addEventListener('keyup', releaseInteraction);
  window.addEventListener('blur', () => { pointers.clear(); releaseInteraction({}); });

  freezeButton.addEventListener('click', () => {
    frozen = !frozen;
    freezeButton.textContent = frozen ? 'Resume live' : 'Freeze list';
    freezeButton.setAttribute('aria-pressed', String(frozen));
    if (!frozen && !touching && !killBusy) snapshot = newestSnapshot;
    render();
  });

  function setKillStatus(text, kind) {
    killStatus.textContent = text || '';
    killStatus.className = `processes-kill-status${kind ? ` ${kind}` : ''}`;
  }

  function syncFallback() {
    if (window.pcMonitorUninstalling) { clearInterval(refreshTimer); refreshTimer = null; return; }
    clearInterval(refreshTimer);
    refreshTimer = null;
    if (!streamConnected && clientVisible() && !document.getElementById('processesPage').hidden) refreshTimer = setInterval(refresh, 5000);
  }

  function render() {
    syncSelection();
    if (touching || killBusy) return;
    const stale = !snapshot || snapshot.stale || !snapshot.sampledAt || Date.now() - snapshot.sampledAt > 15000;
    liveDot.classList.toggle('is-stale', stale);
    liveText.textContent = frozen ? 'Frozen · monitoring continues' : snapshot?.error ? `Unavailable · ${snapshot.error.replaceAll('-', ' ')}` : stale ? 'Stale / waiting' : selected ? 'Live · selection order locked' : 'Live';
    updated.textContent = `Last updated · ${snapshot?.sampledAt ? new Date(snapshot.sampledAt).toLocaleTimeString() : '--'}`;
    const processes = Array.isArray(snapshot?.processes) ? [...snapshot.processes] : [];
    for (const [key, at] of endedIdentities) if (Date.now() - at > 60000) endedIdentities.delete(key);
    const visible = processes.filter(item => !endedIdentities.has(identity(item)));
    visible.sort((a, b) => sortBy === 'cpu' ? ((b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)) : b.ramMB - a.ramMB);
    if (selected || frozen) {
      const positions = new Map(displayOrder.map((key, index) => [key, index]));
      visible.sort((a, b) => (positions.get(identity(a)) ?? Infinity) - (positions.get(identity(b)) ?? Infinity));
    }
    displayOrder = visible.map(identity);
    rows.replaceChildren();
    if (!visible.length) {
      const row = rows.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 4;
      cell.className = 'processes-empty';
      cell.textContent = snapshot?.error ? `Process data unavailable (${snapshot.error.replaceAll('-', ' ')}). Retrying automatically.` : 'Collecting the first process sample…';
      return;
    }
    for (const process of visible) {
      const row = rows.insertRow();
      const name = row.insertCell(); name.className = 'process-name'; name.textContent = process.name;
      const pid = row.insertCell(); pid.textContent = String(process.pid);
      const cpu = row.insertCell(); cpu.textContent = process.cpuPercent === null || !Number.isFinite(Number(process.cpuPercent)) ? '—' : `${Number(process.cpuPercent).toFixed(1)}%`;
      const ram = row.insertCell(); ram.textContent = `${Number(process.ramMB || 0).toFixed(1)} MB`;
      // Only processes with a verified start-time identity can be selected for termination.
      if (process.startedAt) {
        row.classList.add('is-selectable');
        row.tabIndex = 0;
        row.setAttribute('aria-selected', String(!!selected && identity(selected) === identity(process)));
        if (selected && identity(selected) === identity(process)) row.classList.add('is-selected');
        const select = () => {
          if (killBusy) return;
          if (selected && identity(selected) === identity(process)) {
            selected = null;
            setKillStatus('', '');
          } else {
            selected = { pid: process.pid, name: process.name, startedAt: process.startedAt };
            setKillStatus('', '');
          }
          for (const item of rows.children) { item.classList.remove('is-selected'); item.setAttribute('aria-selected', 'false'); }
          if (selected) row.classList.add('is-selected');
          row.setAttribute('aria-selected', String(!!selected));
          render();
        };
        row.addEventListener('click', select);
        row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); holdInteraction(event); select(); } });
      }
    }
  }

  killButton.addEventListener('click', async () => {
    if (!selected || killBusy) return;
    const target = selected;
    if (killButton.disabled || !window.confirm(`End ${target.name} (PID ${target.pid})? Only this process is targeted; child processes or a restarted app may remain.`)) return;
    killBusy = true;
    render();
    setKillStatus(`Ending ${target.name} (PID ${target.pid}) · verifying exit…`, '');
    try {
      const response = await fetch('/api/processes/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...processLeaseHeader() },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ pid: target.pid, name: target.name, startedAt: target.startedAt })
      });
      if (response.status === 401) { window.location.replace('/'); return; }
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        endedIdentities.set(identity(target), Date.now());
        if (snapshot) snapshot = { ...snapshot, processes: snapshot.processes.filter(item => identity(item) !== identity(target)) };
        if (newestSnapshot) newestSnapshot = { ...newestSnapshot, processes: newestSnapshot.processes.filter(item => identity(item) !== identity(target)) };
        selected = null;
        setKillStatus(`Ended ${target.name} (PID ${target.pid}) · exit confirmed. Child processes or a new instance may remain.`, 'ok');
      } else {
        setKillStatus(data.error || 'End Task failed; the process may still be running.', 'error');
      }
    } catch (_) {
      setKillStatus('Connection lost.', 'error');
    } finally {
      killBusy = false;
      if (!frozen) snapshot = newestSnapshot;
      render();
      refresh();
    }
  });

  async function refresh() {
    if (window.pcMonitorUninstalling) return;
    if (inFlight || !clientVisible() || document.getElementById('processesPage').hidden) return;
    inFlight = true;
    try {
      const response = await fetch('/api/processes', { headers: processLeaseHeader(), credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { window.location.replace('/'); return; }
      if (response.ok) acceptSnapshot(await response.json());
      else acceptSnapshot({ ...(newestSnapshot || {}), stale: true, error: response.status === 403 ? 'profile-not-active' : 'server-error' });
    } catch (_) { acceptSnapshot({ ...(newestSnapshot || {}), stale: true, error: 'connection-lost' }); }
    finally { inFlight = false; render(); }
  }

  buttons.forEach(button => button.addEventListener('click', () => {
    sortBy = button.dataset.sort === 'memory' ? 'memory' : 'cpu';
    displayOrder = [];
    buttons.forEach(item => { const selected = item === button; item.classList.toggle('is-selected', selected); item.setAttribute('aria-pressed', String(selected)); });
    render();
  }));

  window.addEventListener('pc-monitor-processes', event => {
    acceptSnapshot(event.detail);
    syncSelection();
  });
  window.addEventListener('pc-monitor-pagechange', event => {
    clearTimeout(interactionTimer);
    touching = false; pointers.clear(); selected = null;
    frozen = false; freezeButton.textContent = 'Freeze list'; freezeButton.setAttribute('aria-pressed', 'false');
    newestSnapshot = null; displayOrder = [];
    if (event.detail.page === 'processesPage') {
      snapshot = null;
      render();
      refresh();
      syncFallback();
    } else {
      snapshot = null;
      render();
      syncFallback();
    }
  });
  window.addEventListener('pc-monitor-stream-state', event => {
    streamConnected = event.detail.connected === true;
    if (streamConnected && !document.getElementById('processesPage').hidden) refresh();
    syncFallback();
  });
  const visibilityChanged = () => {
    if (!clientVisible()) { clearTimeout(interactionTimer); pointers.clear(); touching = false; }
    if (clientVisible() && !document.getElementById('processesPage').hidden) refresh();
    syncFallback();
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('pc-monitor-desktop-visibility', visibilityChanged);
})();
