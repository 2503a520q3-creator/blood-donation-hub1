// Blood Donation Hub - backend
// Run: npm install && npm start  ->  http://localhost:3000
// Put all your HTML, CSS and images inside the "public" folder.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'change-this-secret-before-deploying';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@bloodhub.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DB_FILE = path.join(__dirname, 'data.json');

const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Which donor groups can give to each recipient group
const CAN_RECEIVE_FROM = {
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'A-': ['A-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'AB+': GROUPS,
  'AB-': ['A-', 'B-', 'AB-', 'O-'],
  'O+': ['O+', 'O-'],
  'O-': ['O-'],
};

// ---------- Tiny JSON file database ----------
let db = { users: [], donors: [], requests: [], posts: [] };
if (fs.existsSync(DB_FILE)) {
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (e) {
    console.error('Could not read data.json, starting empty:', e.message);
  }
}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const newId = () => crypto.randomUUID();
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// Seed an admin account on first run
if (!db.users.some((u) => u.role === 'admin')) {
  db.users.push({
    id: newId(),
    name: 'Admin',
    email: ADMIN_EMAIL,
    passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
    role: 'admin',
    createdAt: new Date().toISOString(),
  });
  save();
  console.log(`Admin created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}  (change this!)`);
}

// ---------- App + auth helpers ----------
const app = express();
app.use(express.json({ limit: '100kb' }));

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

function readToken(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(h.slice(7), SECRET);
  } catch {
    return null;
  }
}
function optionalAuth(req, _res, next) {
  req.user = readToken(req);
  next();
}
function requireAuth(req, res, next) {
  const t = readToken(req);
  if (!t) return res.status(401).json({ error: 'Please log in first.' });
  req.user = t;
  next();
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
    next();
  });
}

// ---------- Auth ----------
app.post('/api/signup', (req, res) => {
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 120).toLowerCase();
  const password = String(req.body.password ?? '');
  const role = req.body.role === 'patient' ? 'patient' : 'donor';

  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.users.some((u) => u.email === email)) return res.status(409).json({ error: 'Email already registered.' });

  const user = {
    id: newId(),
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  save();
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const password = String(req.body.password ?? '');
  const user = db.users.find((u) => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(publicUser(user));
});

// ---------- Donors (Donate page) ----------
app.post('/api/donors', optionalAuth, (req, res) => {
  const bloodGroup = str(req.body.bloodGroup, 4).toUpperCase();
  const age = Number(req.body.age);
  const donor = {
    id: newId(),
    userId: req.user?.id || null,
    name: str(req.body.name, 80),
    bloodGroup,
    phone: str(req.body.phone, 20),
    city: str(req.body.city, 80),
    age,
    lastDonation: str(req.body.lastDonation, 20),
    available: true,
    createdAt: new Date().toISOString(),
  };
  if (!donor.name || !donor.phone || !donor.city) {
    return res.status(400).json({ error: 'Name, phone and city are required.' });
  }
  if (!GROUPS.includes(bloodGroup)) return res.status(400).json({ error: 'Invalid blood group.' });
  if (!Number.isFinite(age) || age < 18 || age > 65) {
    return res.status(400).json({ error: 'Donors must be between 18 and 65 years old.' });
  }
  db.donors.push(donor);
  save();
  res.status(201).json({ message: 'Thank you for registering as a donor!', donor });
});

// Search donors. Phone numbers are only shown to logged-in users.
app.get('/api/donors', optionalAuth, (req, res) => {
  const group = str(req.query.bloodGroup, 4).toUpperCase();
  const city = str(req.query.city, 80).toLowerCase();
  const compatible = req.query.compatible === 'true';

  let list = db.donors.filter((d) => d.available);
  if (group) {
    const allowed = compatible ? CAN_RECEIVE_FROM[group] || [group] : [group];
    list = list.filter((d) => allowed.includes(d.bloodGroup));
  }
  if (city) list = list.filter((d) => d.city.toLowerCase().includes(city));

  res.json(
    list.map((d) => ({
      id: d.id,
      name: d.name,
      bloodGroup: d.bloodGroup,
      city: d.city,
      lastDonation: d.lastDonation,
      phone: req.user ? d.phone : undefined,
    }))
  );
});

// ---------- Blood requests (Need Blood page) ----------
app.post('/api/requests', optionalAuth, (req, res) => {
  const bloodGroup = str(req.body.bloodGroup, 4).toUpperCase();
  const reqObj = {
    id: newId(),
    userId: req.user?.id || null,
    patientName: str(req.body.patientName || req.body.name, 80),
    bloodGroup,
    units: Math.max(1, Number(req.body.units) || 1),
    hospital: str(req.body.hospital, 120),
    city: str(req.body.city, 80),
    phone: str(req.body.phone, 20),
    urgency: ['normal', 'urgent', 'emergency'].includes(req.body.urgency) ? req.body.urgency : 'normal',
    note: str(req.body.note, 300),
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  if (!reqObj.patientName || !reqObj.phone || !reqObj.city) {
    return res.status(400).json({ error: 'Patient name, phone and city are required.' });
  }
  if (!GROUPS.includes(bloodGroup)) return res.status(400).json({ error: 'Invalid blood group.' });

  db.requests.push(reqObj);
  save();

  const allowed = CAN_RECEIVE_FROM[bloodGroup];
  const matches = db.donors.filter(
    (d) => d.available && allowed.includes(d.bloodGroup) && d.city.toLowerCase() === reqObj.city.toLowerCase()
  );
  res.status(201).json({
    message: 'Request submitted.',
    request: reqObj,
    matchingDonors: matches.length,
    donors: matches.map((d) => ({ name: d.name, bloodGroup: d.bloodGroup, phone: d.phone })),
  });
});

app.get('/api/requests', (req, res) => {
  const group = str(req.query.bloodGroup, 4).toUpperCase();
  const city = str(req.query.city, 80).toLowerCase();
  let list = db.requests.filter((r) => r.status === 'open');
  if (group) list = list.filter((r) => r.bloodGroup === group);
  if (city) list = list.filter((r) => r.city.toLowerCase().includes(city));
  res.json(list.slice().reverse());
});

// ---------- Emergency circle ----------
app.get('/api/circle', (req, res) => {
  const list = db.requests
    .filter((r) => r.status === 'open' && r.urgency === 'emergency')
    .slice()
    .reverse();
  res.json(list);
});

// ---------- Blog ----------
app.get('/api/posts', (_req, res) => res.json(db.posts.slice().reverse()));

app.post('/api/posts', requireAdmin, (req, res) => {
  const title = str(req.body.title, 120);
  const content = str(req.body.content, 5000);
  if (!title || !content) return res.status(400).json({ error: 'Title and content are required.' });
  const post = { id: newId(), title, content, author: req.user.name, createdAt: new Date().toISOString() };
  db.posts.push(post);
  save();
  res.status(201).json(post);
});

app.delete('/api/posts/:id', requireAdmin, (req, res) => {
  db.posts = db.posts.filter((p) => p.id !== req.params.id);
  save();
  res.json({ ok: true });
});

// ---------- Admin ----------
app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  res.json({
    users: db.users.length,
    donors: db.donors.length,
    openRequests: db.requests.filter((r) => r.status === 'open').length,
    posts: db.posts.length,
  });
});

app.get('/api/admin/users', requireAdmin, (_req, res) => res.json(db.users.map(publicUser)));
app.get('/api/admin/donors', requireAdmin, (_req, res) => res.json(db.donors));
app.get('/api/admin/requests', requireAdmin, (_req, res) => res.json(db.requests));

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const target = db.users.find((u) => u.id === req.params.id);
  if (target && target.role === 'admin') return res.status(400).json({ error: 'Cannot delete an admin.' });
  db.users = db.users.filter((u) => u.id !== req.params.id);
  save();
  res.json({ ok: true });
});

app.delete('/api/admin/donors/:id', requireAdmin, (req, res) => {
  db.donors = db.donors.filter((d) => d.id !== req.params.id);
  save();
  res.json({ ok: true });
});

app.patch('/api/admin/requests/:id', requireAdmin, (req, res) => {
  const r = db.requests.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found.' });
  if (['open', 'fulfilled', 'closed'].includes(req.body.status)) r.status = req.body.status;
  save();
  res.json(r);
});

app.delete('/api/admin/requests/:id', requireAdmin, (req, res) => {
  db.requests = db.requests.filter((r) => r.id !== req.params.id);
  save();
  res.json({ ok: true });
});

// ---------- Chatbot (simple rule-based) ----------
app.post('/api/chatbot', (req, res) => {
  const msg = str(req.body.message, 300).toLowerCase();
  let reply = "I can help with blood groups, who can donate, eligibility, and how to use this site. Try asking 'who can donate to O-?'";

  const group = (msg.match(/\b(ab|a|b|o)\s?([+-]|positive|negative)/) || []);
  const g = group[1] ? group[1].toUpperCase() + (group[2].startsWith('p') || group[2] === '+' ? '+' : '-') : null;

  if (/^(hi|hello|hey)\b/.test(msg)) {
    reply = 'Hello! Ask me about blood groups, donor eligibility, or how to request blood.';
  } else if (g && GROUPS.includes(g) && /(receive|get|need|take)/.test(msg)) {
    reply = `People with ${g} can receive blood from: ${CAN_RECEIVE_FROM[g].join(', ')}.`;
  } else if (g && GROUPS.includes(g) && /(donate|give)/.test(msg)) {
    const to = GROUPS.filter((r) => CAN_RECEIVE_FROM[r].includes(g));
    reply = `${g} donors can give to: ${to.join(', ')}.`;
  } else if (/universal donor/.test(msg)) {
    reply = 'O- is the universal donor: it can be given to any blood group.';
  } else if (/universal recipient/.test(msg)) {
    reply = 'AB+ is the universal recipient: it can receive from any blood group.';
  } else if (/(eligible|eligibility|age|weight|who can donate)/.test(msg)) {
    reply = 'Generally donors are 18-65 years old, weigh at least 50 kg, are in good health, and wait about 3 months between donations. A doctor makes the final decision.';
  } else if (/(how often|gap|again)/.test(msg)) {
    reply = 'Whole blood donors usually wait around 3 months (12 weeks) between donations.';
  } else if (/(request|need blood|find donor)/.test(msg)) {
    reply = "Go to the 'Need Blood' page, fill in the patient details, and we will show matching donors in your city.";
  } else if (/(register|become a donor|donate now)/.test(msg)) {
    reply = "Open the 'Donate' page and fill in your details to register as a donor.";
  } else if (/(emergency|urgent)/.test(msg)) {
    reply = "For emergencies, mark your request as 'emergency' so it appears in the Emergency Circle. Also call your local emergency number.";
  }
  res.json({ reply });
});

// ---------- Static website + errors ----------
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => console.log(`Blood Donation Hub running at http://localhost:${PORT}`));
