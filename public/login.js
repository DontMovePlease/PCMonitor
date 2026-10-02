const pinInput = document.getElementById('pinInput');
const unlockBtn = document.getElementById('unlockBtn');
const errMsg = document.getElementById('errMsg');
try { localStorage.removeItem('auth_pin'); } catch (_) {}

async function attemptLogin() {
  const pin = pinInput.value.trim();
  if (!pin) return;
  errMsg.textContent = '';
  unlockBtn.disabled = true;
  unlockBtn.textContent = 'Verifying...';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ pin })
    });
    const data = await response.json();
    if (response.ok && data.success) {
      window.location.replace('/');
      return;
    }
    errMsg.textContent = response.status === 429
      ? `Too many attempts. Try again in ${Number(response.headers.get('Retry-After')) || 60} seconds.`
      : 'Incorrect PIN. Please try again.';
    pinInput.value = '';
    pinInput.focus();
  } catch (_) {
    errMsg.textContent = 'Connection error. Check Tailscale.';
  } finally {
    unlockBtn.disabled = false;
    unlockBtn.textContent = 'Unlock Dashboard';
  }
}

unlockBtn.addEventListener('click', attemptLogin);
pinInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') attemptLogin();
});
