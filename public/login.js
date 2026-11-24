document.getElementById('pwToggle').addEventListener('click', () => {
  const input = document.getElementById('password');
  input.type = input.type === 'password' ? 'text' : 'password';
});

(async () => {
  if (new URLSearchParams(window.location.search).get('error') === 'oidc') {
    document.getElementById('loginError').textContent = t('login.ssoFailed');
  }
  try {
    const res = await fetch('/api/auth/methods');
    const methods = await res.json();
    if (methods.oidc) {
      const btn = document.getElementById('ssoBtn');
      btn.textContent = t('login.sso', { provider: methods.oidcLabel });
      btn.style.display = '';
      document.getElementById('ssoDivider').style.display = '';
      btn.addEventListener('click', () => { window.location.href = '/auth/oidc/login'; });
    }
  } catch {}
})();

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  btn.disabled = true;
  btn.textContent = t('login.submitting');
  err.textContent = '';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    if (res.ok) {
      window.location.href = '/';
      return;
    }
    const data = await res.json().catch(() => ({}));
    err.textContent = data.code ? i18n.errorMessage(data, res.status) : (data.error || t('login.genericError'));
  } catch {
    err.textContent = t('login.networkError');
  }
  btn.disabled = false;
  btn.textContent = t('login.submit');
});
