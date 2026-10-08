const GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const getUser = () => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } };

async function api(url, opts = {}) {
  const t = localStorage.getItem('token');
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function msg(text, ok) {
  const m = $('#msg');
  m.textContent = text;
  m.className = 'msg ' + (ok ? 'ok' : 'err');
}

function handleForm(sel, url, onOk) {
  $(sel).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(url, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      onOk(r, e.target);
    } catch (err) { msg(err.message, false); }
  });
}

function layout(active) {
  const u = getUser();
  const links = [['index.html','Home'],['needblood.html','Need Blood'],['donateblood.html','Donate'],['blog.html','Blog'],['admin.html','Admin']];
  let nav = links.map(([h, t]) => `<a href="${h}" class="${h === active ? 'active' : ''}">${t}</a>`).join('');
  nav += u
    ? `<a href="#" id="logout">Logout (${esc(u.name)})</a>`
    : `<a href="login.html" class="${active === 'login.html' ? 'active' : ''}">Login</a><a href="signup.html" class="nav-cta">Sign up</a>`;
  document.body.insertAdjacentHTML('afterbegin',
    `<header><div class="header-inner"><a class="brand" href="index.html">🩸 Blood Donation Hub</a><nav>${nav}</nav></div></header>`);
  document.body.insertAdjacentHTML('beforeend', '<footer><p>© 2026 Blood Donation Hub</p></footer>');
  document.querySelectorAll('select.groups').forEach((s) => {
    s.innerHTML = '<option value="">Select</option>' + GROUPS.map((g) => `<option>${g}</option>`).join('');
  });
  const lo = $('#logout');
  if (lo) lo.onclick = (e) => { e.preventDefault(); localStorage.clear(); location.href = 'index.html'; };
}

function saveLogin(r) {
  localStorage.setItem('token', r.token);
  localStorage.setItem('user', JSON.stringify(r.user));
  location.href = r.user.role === 'admin' ? 'admin.html' : 'index.html';
}
