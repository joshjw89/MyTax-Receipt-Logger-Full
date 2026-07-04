// server.js — MyTax Receipt Logger full-stack prototype with Email OTP 2FA
// Node.js + Express (replaces Azure App Service)
// Local folders storage/hot and storage/cold (replace Azure Blob Storage tiers)
// Login/registration require a 6-digit OTP emailed to the user (Nodemailer + Gmail)

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initDb = require('./db');
const { sendOtpEmail, sendPasswordResetEmail, isConfigured } = require('./mailer');

// Render provides the port via an environment variable; fall back to 3000 locally.
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mytax-prototype-secret-key';

const HOT_DIR = path.join(__dirname, 'storage', 'hot');
const COLD_DIR = path.join(__dirname, 'storage', 'cold');
fs.mkdirSync(HOT_DIR, { recursive: true });
fs.mkdirSync(COLD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, HOT_DIR),
    filename: (req, file, cb) => {
      const safe = Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname).toLowerCase();
      cb(null, safe);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.pdf'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only JPEG, PNG and PDF files are allowed'), ok);
  }
});

// Full access token — issued only AFTER a successful OTP check
function fullToken(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email, scope: 'full' }, JWT_SECRET, { expiresIn: '8h' });
}
// Pending token — issued after password check, only usable to verify an OTP
function pendingToken(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email, scope: 'pending' }, JWT_SECRET, { expiresIn: '10m' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in first' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.scope !== 'full') return res.status(401).json({ error: 'Please complete two-factor verification' });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
}

const sixDigit = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const nowPlusMinutes = (m) => new Date(Date.now() + m * 60000).toISOString().replace('T', ' ').slice(0, 19);
const nowStamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Password policy: min 10 characters, at least 1 uppercase letter, at least 1 special character
function validatePassword(pw) {
  if (!pw || pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[A-Z]/.test(pw)) return 'Password must contain at least 1 uppercase letter';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must contain at least 1 special character (e.g. ! @ # $ %)';
  return null;
}

// Generate a random temporary password that satisfies the policy above (12 chars)
function tempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I/O to avoid confusion
  const lower = 'abcdefghijkmnpqrstuvwxyz';   // no l
  const digits = '23456789';                  // no 0/1
  const special = '!@#$%&*';
  const pick = (set, n) => Array.from({ length: n }, () => set[crypto.randomInt(set.length)]).join('');
  return pick(upper, 2) + pick(lower, 5) + pick(digits, 3) + pick(special, 2);
}

initDb().then((db) => {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Issue a fresh OTP for a user: replace any existing ones, store hashed, email it.
  async function issueOtp(user) {
    const code = sixDigit();
    const code_hash = bcrypt.hashSync(code, 10);
    db.run('DELETE FROM otps WHERE user_id = ?', [user.id]);
    db.run('INSERT INTO otps (user_id, code_hash, expires_at) VALUES (?, ?, ?)', [user.id, code_hash, nowPlusMinutes(5)]);
    const result = await sendOtpEmail(user.email, user.name, code);
    return result;
  }

  // ---------- Registration: create account, then require OTP ----------
  app.post('/api/register', async (req, res) => {
    try {
      const { name, email, password } = req.body || {};
      if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
      const pwError = validatePassword(password);
      if (pwError) return res.status(400).json({ error: pwError });
      const exists = db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
      if (exists) return res.status(409).json({ error: 'An account with this email already exists' });
      const hash = bcrypt.hashSync(password, 10);
      const info = db.run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name.trim(), email.toLowerCase(), hash]);
      const user = { id: info.lastInsertRowid, name: name.trim(), email: email.toLowerCase() };
      const sent = await issueOtp(user);
      res.json({ pendingToken: pendingToken(user), email: user.email, devFallback: sent.fallback === true,
        message: 'Account created. Enter the 6-digit code sent to your email.' });
    } catch (e) { res.status(500).json({ error: 'Could not send verification email: ' + e.message }); }
  });

  // ---------- Login step 1: check password, then require OTP ----------
  app.post('/api/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const user = db.get('SELECT * FROM users WHERE email = ?', [(email || '').toLowerCase()]);
      if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
        return res.status(401).json({ error: 'Incorrect email or password' });
      }
      const sent = await issueOtp(user);
      res.json({ pendingToken: pendingToken(user), email: user.email, devFallback: sent.fallback === true,
        message: 'Password correct. Enter the 6-digit code sent to your email.' });
    } catch (e) { res.status(500).json({ error: 'Could not send verification email: ' + e.message }); }
  });

  // ---------- Login step 2: verify OTP, issue full token ----------
  app.post('/api/verify-otp', (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Verification session expired — please log in again' }); }
    if (payload.scope !== 'pending') return res.status(401).json({ error: 'Invalid verification session' });

    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Please enter the 6-digit code' });
    const otp = db.get('SELECT * FROM otps WHERE user_id = ? ORDER BY id DESC LIMIT 1', [payload.id]);
    if (!otp) return res.status(400).json({ error: 'No active code — please request a new one' });
    if (otp.attempts >= 5) { db.run('DELETE FROM otps WHERE user_id = ?', [payload.id]); return res.status(429).json({ error: 'Too many attempts — please log in again' }); }
    if (nowStamp() > otp.expires_at) { db.run('DELETE FROM otps WHERE user_id = ?', [payload.id]); return res.status(400).json({ error: 'Code expired — please request a new one' }); }
    if (!bcrypt.compareSync(String(code), otp.code_hash)) {
      db.run('UPDATE otps SET attempts = attempts + 1 WHERE id = ?', [otp.id]);
      return res.status(401).json({ error: 'Incorrect code — please try again' });
    }
    db.run('DELETE FROM otps WHERE user_id = ?', [payload.id]);
    const row = db.get('SELECT must_change_password FROM users WHERE id = ?', [payload.id]);
    const user = { id: payload.id, name: payload.name, email: payload.email };
    res.json({ token: fullToken(user), user, mustChangePassword: !!(row && row.must_change_password), message: 'Verified — welcome!' });
  });

  // ---------- Resend OTP ----------
  app.post('/api/resend-otp', async (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Verification session expired — please log in again' }); }
    if (payload.scope !== 'pending') return res.status(401).json({ error: 'Invalid verification session' });
    try {
      const sent = await issueOtp({ id: payload.id, name: payload.name, email: payload.email });
      res.json({ devFallback: sent.fallback === true, message: 'A new code has been sent.' });
    } catch (e) { res.status(500).json({ error: 'Could not resend email: ' + e.message }); }
  });

  // ---------- Forgot password: generate a temporary password and email it ----------
  // Responds with the same generic message whether or not the email exists, so the
  // form cannot be used to discover which addresses are registered.
  app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Please enter your email address' });
    const generic = { message: 'If an account exists for that email, a new temporary password has been sent to it.' };
    const user = db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) return res.json(generic); // do not reveal that the account doesn't exist
    try {
      const newPass = tempPassword();
      db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [bcrypt.hashSync(newPass, 10), user.id]);
      db.run('DELETE FROM otps WHERE user_id = ?', [user.id]); // invalidate any pending OTPs
      const sent = await sendPasswordResetEmail(user.email, user.name, newPass);
      res.json({ ...generic, devFallback: sent.fallback === true });
    } catch (e) { res.status(500).json({ error: 'Could not send email: ' + e.message }); }
  });

  // ---------- Change password (used by the forced-change screen after a reset) ----------
  app.post('/api/change-password', authMiddleware, (req, res) => {
    const { newPassword } = req.body || {};
    const pwError = validatePassword(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });
    const user = db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (bcrypt.compareSync(newPassword, user.password_hash)) {
      return res.status(400).json({ error: 'New password must be different from the temporary password' });
    }
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [bcrypt.hashSync(newPassword, 10), req.user.id]);
    res.json({ message: 'Password updated' });
  });

  // ---------- Receipts ----------
  app.post('/api/receipts', authMiddleware, upload.single('file'), (req, res) => {
    const { merchant, receipt_date, amount, category, notes, ocr_used } = req.body;
    if (!req.file) return res.status(400).json({ error: 'A receipt file is required' });
    if (!merchant || !receipt_date || !amount || !category) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Merchant, date, amount and category are required' });
    }
    const info = db.run(
      `INSERT INTO receipts (user_id, merchant, receipt_date, amount, category, notes, filename, original_name, tier, ocr_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'hot', ?)`,
      [req.user.id, merchant.trim(), receipt_date, parseFloat(amount), category, (notes || '').trim(),
       req.file.filename, req.file.originalname, ocr_used === 'true' ? 1 : 0]);
    res.json({ id: info.lastInsertRowid, message: 'Receipt saved to Hot tier' });
  });

  app.get('/api/receipts', authMiddleware, (req, res) => {
    const { search = '', category = '', from = '', to = '', min = '', max = '' } = req.query;
    let sql = 'SELECT * FROM receipts WHERE user_id = ?';
    const params = [req.user.id];
    if (search) { sql += ' AND (merchant LIKE ? OR notes LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (from) { sql += ' AND receipt_date >= ?'; params.push(from); }
    if (to) { sql += ' AND receipt_date <= ?'; params.push(to); }
    if (min) { sql += ' AND amount >= ?'; params.push(parseFloat(min)); }
    if (max) { sql += ' AND amount <= ?'; params.push(parseFloat(max)); }
    sql += ' ORDER BY receipt_date DESC, id DESC';
    res.json(db.all(sql, params));
  });

  app.put('/api/receipts/:id', authMiddleware, (req, res) => {
    const r = db.get('SELECT * FROM receipts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!r) return res.status(404).json({ error: 'Receipt not found' });
    const { merchant, receipt_date, amount, category, notes } = req.body;
    db.run('UPDATE receipts SET merchant = ?, receipt_date = ?, amount = ?, category = ?, notes = ? WHERE id = ?',
      [merchant ?? r.merchant, receipt_date ?? r.receipt_date,
       amount != null ? parseFloat(amount) : r.amount, category ?? r.category, notes ?? r.notes, r.id]);
    res.json({ message: 'Receipt updated' });
  });

  app.delete('/api/receipts/:id', authMiddleware, (req, res) => {
    const r = db.get('SELECT * FROM receipts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!r) return res.status(404).json({ error: 'Receipt not found' });
    const file = path.join(r.tier === 'hot' ? HOT_DIR : COLD_DIR, r.filename);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    db.run('DELETE FROM receipts WHERE id = ?', [r.id]);
    res.json({ message: 'Receipt deleted' });
  });

  app.get('/api/receipts/:id/file', authMiddleware, (req, res) => {
    const r = db.get('SELECT * FROM receipts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!r) return res.status(404).json({ error: 'Receipt not found' });
    const file = path.join(r.tier === 'hot' ? HOT_DIR : COLD_DIR, r.filename);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'File missing from storage' });
    res.sendFile(file);
  });

  // ---------- Lifecycle policy (simulates Azure Blob Lifecycle Management) ----------
  app.post('/api/lifecycle/run', authMiddleware, (req, res) => {
    const days = Math.max(0, parseInt(req.body.days ?? 30, 10));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const candidates = db.all(`SELECT * FROM receipts WHERE user_id = ? AND tier = 'hot' AND uploaded_at <= ?`, [req.user.id, cutoff]);
    let moved = 0;
    for (const r of candidates) {
      const src = path.join(HOT_DIR, r.filename);
      const dst = path.join(COLD_DIR, r.filename);
      if (fs.existsSync(src)) { fs.renameSync(src, dst); db.run(`UPDATE receipts SET tier = 'cold' WHERE id = ?`, [r.id]); moved++; }
    }
    res.json({ moved, message: `Lifecycle policy complete — ${moved} receipt(s) moved from Hot to Cold tier` });
  });

  // ---------- Annual summary ----------
  app.get('/api/summary', authMiddleware, (req, res) => {
    const year = req.query.year || new Date().getFullYear().toString();
    const categories = db.all(
      `SELECT category, COUNT(*) AS count, SUM(amount) AS total
       FROM receipts WHERE user_id = ? AND substr(receipt_date, 1, 4) = ?
       GROUP BY category ORDER BY total DESC`, [req.user.id, year]);
    const tiers = db.all(`SELECT tier, COUNT(*) AS count FROM receipts WHERE user_id = ? GROUP BY tier`, [req.user.id]);
    res.json({ year, categories, tiers });
  });

  app.listen(PORT, () => {
    console.log('---------------------------------------------------');
    console.log('  MyTax Receipt Logger (Full-Stack + Email OTP)');
    console.log(`  Listening on port ${PORT}`);
    console.log(`  Email sending: ${isConfigured ? 'ENABLED (Gmail)' : 'DISABLED (console fallback)'}`);
    console.log('  Local: http://localhost:' + PORT);
    console.log('---------------------------------------------------');
  });
}).catch((err) => { console.error('Failed to start:', err); });
