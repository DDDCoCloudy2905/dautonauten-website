// GitHub-Login für Decap CMS als Cloudflare Worker.
// Variablen im Worker: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET (als Secret),
// ALLOWED_USER (dein GitHub-Name), ALLOWED_ORIGIN (z. B. https://www.deinedomain.de),
// optional GITHUB_SCOPE (Standard: public_repo, bei privatem Repo: repo).

function randomHex(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function text(status, body) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function startAuth(url, env) {
  const state = randomHex(16);
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${url.origin}/callback`,
    scope: env.GITHUB_SCOPE || 'public_repo',
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://github.com/login/oauth/authorize?${params}`,
      'Set-Cookie': `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      'Cache-Control': 'no-store',
    },
  });
}

function popupResponse(token, origin) {
  const nonce = randomHex(16);
  const payload = JSON.stringify({ token, origin }).replace(/</g, '\\u003c');
  const html = `<!doctype html><meta charset="utf-8"><title>Anmeldung</title>
<p>Anmeldung erfolgreich. Dieses Fenster schließt sich gleich.</p>
<script nonce="${nonce}">
const { token, origin } = ${payload};
window.addEventListener('message', (event) => {
  if (event.origin !== origin) return;
  window.opener.postMessage('authorization:github:success:' + JSON.stringify({ token, provider: 'github' }), origin);
});
window.opener.postMessage('authorizing:github', origin);
</script>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'`,
      'Set-Cookie': 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      'Cache-Control': 'no-store',
    },
  });
}

async function finishAuth(request, url, env) {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code || state !== getCookie(request, 'oauth_state')) {
    return text(400, 'Ungültige Anmeldung.');
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'decap-oauth-worker',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/callback`,
    }),
  });
  const { access_token: token } = await tokenRes.json().catch(() => ({}));
  if (!token) return text(401, 'Anmeldung fehlgeschlagen.');

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'decap-oauth-worker',
    },
  });
  const user = userRes.ok ? await userRes.json() : null;
  if (!user || user.login.toLowerCase() !== env.ALLOWED_USER.toLowerCase()) {
    return text(403, 'Kein Zugriff.');
  }

  return popupResponse(token, env.ALLOWED_ORIGIN);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return text(405, 'Method not allowed');
    if (url.pathname === '/auth') return startAuth(url, env);
    if (url.pathname === '/callback') return finishAuth(request, url, env);
    return text(404, 'Not found');
  },
};
