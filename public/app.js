// MyTax Receipt Logger — React frontend (prototype)
const { useState, useEffect, useRef } = React;

// LHDN MyTax tax relief categories (Year of Assessment limits, RM)
const CATEGORIES = [
  { name: 'Medical expenses (self, spouse, child)', limit: 10000 },
  { name: 'Lifestyle (books, internet, gadgets)', limit: 2500 },
  { name: 'Sports equipment & activities', limit: 1000 },
  { name: 'Education fees (self)', limit: 7000 },
  { name: 'SSPN net savings', limit: 8000 },
  { name: 'Childcare fees (TASKA / TADIKA)', limit: 3000 },
  { name: 'Life insurance & EPF', limit: 7000 },
  { name: 'Medical & education insurance', limit: 3000 },
  { name: 'EV charging facilities', limit: 2500 },
  { name: 'Other / Uncategorised', limit: null },
];

const RM = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- API helper ----------
async function api(path, { method = 'GET', body, token, isForm } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ---------- OCR text parsing heuristics ----------
function parseOcrText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let merchant = '';
  for (const l of lines) {
    if (/[A-Za-z]{3,}/.test(l) && !/receipt|invoice|resit|tax/i.test(l)) { merchant = l; break; }
  }
  // Date: dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd
  let date = '';
  const dm = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/) || text.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (dm) {
    if (dm[1].length === 4) date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
    else date = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  }
  // Amount: prefer lines containing TOTAL / JUMLAH, else largest decimal number
  let amount = '';
  const totalLine = lines.find((l) => /total|jumlah|amount due/i.test(l) && /\d/.test(l));
  const numFrom = (s) => { const m = s.match(/(\d{1,3}(?:[,\s]?\d{3})*\.\d{2})/g); return m ? m.map((x) => parseFloat(x.replace(/[,\s]/g, ''))) : []; };
  if (totalLine) { const nums = numFrom(totalLine); if (nums.length) amount = Math.max(...nums).toFixed(2); }
  if (!amount) { const all = numFrom(text); if (all.length) amount = Math.max(...all).toFixed(2); }
  return { merchant, date, amount };
}

// ---------- Shared small components ----------
function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#122B40] bg-white';

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm text-white z-50 ${toast.kind === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>
      {toast.msg}
    </div>
  );
}

// ---------- Auth page ----------
function AuthPage({ onLogin, notify }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Invite-only registration state
  const [invite, setInvite] = useState(null);       // { token, email } when a valid invite link is used
  const [firstRun, setFirstRun] = useState(false);  // true only when zero accounts exist (bootstrap)
  const [maintenance, setMaintenance] = useState(false);

  useEffect(() => {
    // Check first-run + maintenance status, and validate any ?invite= token in the URL
    api('/api/setup-status').then((s) => {
      setFirstRun(s.firstRun);
      setMaintenance(s.maintenance);
    }).catch(() => {});
    const token = new URLSearchParams(window.location.search).get('invite');
    if (token) {
      api('/api/invite/' + token)
        .then((data) => {
          setInvite({ token, email: data.email });
          setMode('register');
          setForm((f) => ({ ...f, email: data.email }));
          notify('Invitation verified — create your account');
        })
        .catch((e) => notify(e.message, 'error'));
    }
  }, []);

  const canRegister = firstRun || !!invite; // registration hidden unless bootstrapping or invited

  // Two-factor step state
  const [stage, setStage] = useState('credentials'); // 'credentials' | 'otp' | 'forgot' | 'changepw'
  const [pending, setPending] = useState(null);       // { pendingToken, email, devFallback }
  const [code, setCode] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [fullSession, setFullSession] = useState(null); // held back while password change is forced
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');

  // Client-side mirror of the server password policy (server still enforces it)
  const policyChecks = (pw) => ([
    { label: 'At least 10 characters', ok: pw.length >= 10 },
    { label: 'At least 1 uppercase letter', ok: /[A-Z]/.test(pw) },
    { label: 'At least 1 special character (e.g. ! @ # $ %)', ok: /[^A-Za-z0-9]/.test(pw) },
  ]);
  const pwChecks = policyChecks(form.password);
  const pwOk = pwChecks.every((c) => c.ok);
  const newPwChecks = policyChecks(newPw);
  const newPwOk = newPwChecks.every((c) => c.ok) && newPw === newPw2;

  async function submit() {
    if (mode === 'register' && !pwOk) { notify('Password does not meet the requirements yet', 'error'); return; }
    setBusy(true);
    try {
      const body = mode === 'register' && invite ? { ...form, inviteToken: invite.token } : form;
      const data = await api(mode === 'login' ? '/api/login' : '/api/register', { method: 'POST', body });
      setPending(data);
      setStage('otp');
      setCode('');
      notify(data.devFallback ? 'Email not configured — check the server window for your code' : 'Code sent to ' + data.email);
    } catch (e) { notify(e.message, 'error'); }
    setBusy(false);
  }

  async function sendForgot() {
    if (!forgotEmail.trim()) { notify('Please enter your email address', 'error'); return; }
    setBusy(true);
    try {
      const data = await api('/api/forgot-password', { method: 'POST', body: { email: forgotEmail.trim() } });
      notify(data.devFallback ? 'Temporary password printed in the server window' : data.message);
      setStage('credentials');
      setMode('login');
      setForm({ ...form, email: forgotEmail.trim(), password: '' });
    } catch (e) { notify(e.message, 'error'); }
    setBusy(false);
  }

  async function verify() {
    if (code.trim().length !== 6) { notify('Enter the 6-digit code', 'error'); return; }
    setBusy(true);
    try {
      const data = await api('/api/verify-otp', { method: 'POST', token: pending.pendingToken, body: { code: code.trim() } });
      if (data.mustChangePassword) {
        // Logged in with a temporary password — force a new one before entering the app
        setFullSession(data);
        setNewPw(''); setNewPw2('');
        setStage('changepw');
        notify('Please set a new password to continue');
      } else {
        onLogin(data);
      }
    } catch (e) { notify(e.message, 'error'); }
    setBusy(false);
  }

  async function changePassword() {
    if (!newPwOk) { notify(newPw !== newPw2 ? 'Passwords do not match' : 'New password does not meet the requirements yet', 'error'); return; }
    setBusy(true);
    try {
      await api('/api/change-password', { method: 'POST', token: fullSession.token, body: { newPassword: newPw } });
      notify('Password updated — welcome!');
      onLogin(fullSession);
    } catch (e) { notify(e.message, 'error'); }
    setBusy(false);
  }

  async function resend() {
    setBusy(true);
    try {
      const data = await api('/api/resend-otp', { method: 'POST', token: pending.pendingToken });
      notify(data.devFallback ? 'New code in the server window' : 'A new code has been sent');
    } catch (e) { notify(e.message, 'error'); }
    setBusy(false);
  }

  function backToCredentials() {
    setStage('credentials');
    setPending(null);
    setCode('');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-ink text-white display text-2xl font-bold mb-3">M</div>
          <h1 className="text-3xl font-bold ink">MyTax Receipt Logger</h1>
          <p className="text-slate-500 mt-1 text-sm">Keep every tax relief receipt safe for 7 years as LHDN requires.</p>
        </div>

        {stage === 'credentials' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            {maintenance && (
              <p className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                The site is currently under maintenance. Only administrators can log in.
              </p>
            )}
            {firstRun && (
              <p className="text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-lg px-3 py-2 mb-4">
                First-time setup: the first account created becomes the Super Administrator.
              </p>
            )}
            {canRegister ? (
              <div className="flex rounded-lg bg-slate-100 p-1 mb-6">
                {['login', 'register'].map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-md text-sm font-medium capitalize ${mode === m ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}>
                    {m === 'login' ? 'Log in' : 'Create account'}
                  </button>
                ))}
              </div>
            ) : (
              <h2 className="text-lg font-bold ink mb-5 text-center">Log in</h2>
            )}
            {mode === 'register' && (
              <Field label="Full name"><input className={inputCls} value={form.name} onChange={set('name')} placeholder="e.g. Joshua Tan" /></Field>
            )}
            <Field label="Email">
              <input className={inputCls + (invite && mode === 'register' ? ' bg-slate-50 text-slate-500' : '')} type="email" value={form.email} onChange={set('email')}
                placeholder="you@email.com" readOnly={!!(invite && mode === 'register')} />
            </Field>
            {invite && mode === 'register' && (
              <p className="text-xs text-slate-400 -mt-2 mb-4">This invitation was issued for this email address.</p>
            )}
            <Field label="Password"><input className={inputCls} type="password" value={form.password} onChange={set('password')} placeholder={mode === 'register' ? 'Min 10 chars, 1 uppercase, 1 special' : 'Your password'} onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>
            {mode === 'register' && form.password.length > 0 && (
              <div className="mb-4 -mt-2 space-y-1">
                {pwChecks.map((c) => (
                  <p key={c.label} className={`text-xs flex items-center gap-1.5 ${c.ok ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span>{c.ok ? '✓' : '○'}</span> {c.label}
                  </p>
                ))}
              </div>
            )}
            <button onClick={submit} disabled={busy}
              className="w-full bg-ink text-white rounded-lg py-2.5 font-medium hover:opacity-90 disabled:opacity-50 mt-2">
              {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
            {mode === 'login' && (
              <button onClick={() => { setForgotEmail(form.email); setStage('forgot'); }}
                className="w-full text-center text-sm text-slate-500 hover:text-slate-800 mt-3">
                Forgot password?
              </button>
            )}
            <p className="text-center text-xs text-slate-400 mt-4">Protected by two-factor authentication. A one-time code will be emailed to you.</p>
          </div>
        )}

        {stage === 'forgot' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <h2 className="text-lg font-bold ink mb-1">Forgot password</h2>
            <p className="text-sm text-slate-500 mb-5">
              Enter your registered email. A new temporary password will be sent to it, which you can use to log in.
            </p>
            <Field label="Email">
              <input className={inputCls} type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="you@email.com" onKeyDown={(e) => e.key === 'Enter' && sendForgot()} autoFocus />
            </Field>
            <button onClick={sendForgot} disabled={busy}
              className="w-full bg-ink text-white rounded-lg py-2.5 font-medium hover:opacity-90 disabled:opacity-50 mt-1">
              {busy ? 'Sending…' : 'Send temporary password'}
            </button>
            <button onClick={() => setStage('credentials')} className="w-full text-center text-sm text-slate-500 hover:text-slate-800 mt-4">
              ← Back to log in
            </button>
          </div>
        )}

        {stage === 'changepw' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <h2 className="text-lg font-bold ink mb-1">Set a new password</h2>
            <p className="text-sm text-slate-500 mb-5">
              You logged in with a temporary password. For your security, choose a new one before continuing.
            </p>
            <Field label="New password">
              <input className={inputCls} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
                placeholder="Min 10 chars, 1 uppercase, 1 special" autoFocus />
            </Field>
            {newPw.length > 0 && (
              <div className="mb-4 -mt-2 space-y-1">
                {newPwChecks.map((c) => (
                  <p key={c.label} className={`text-xs flex items-center gap-1.5 ${c.ok ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span>{c.ok ? '✓' : '○'}</span> {c.label}
                  </p>
                ))}
                <p className={`text-xs flex items-center gap-1.5 ${newPw2 && newPw === newPw2 ? 'text-emerald-600' : 'text-slate-400'}`}>
                  <span>{newPw2 && newPw === newPw2 ? '✓' : '○'}</span> Passwords match
                </p>
              </div>
            )}
            <Field label="Confirm new password">
              <input className={inputCls} type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)}
                placeholder="Type it again" onKeyDown={(e) => e.key === 'Enter' && changePassword()} />
            </Field>
            <button onClick={changePassword} disabled={busy}
              className="w-full bg-emerald-600 text-white rounded-lg py-2.5 font-medium hover:opacity-90 disabled:opacity-50 mt-1">
              {busy ? 'Saving…' : 'Save new password & continue'}
            </button>
          </div>
        )}

        {stage === 'otp' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <h2 className="text-lg font-bold ink mb-1">Two-factor verification</h2>
            <p className="text-sm text-slate-500 mb-5">
              We sent a 6-digit code to <span className="font-medium text-slate-700">{pending && pending.email}</span>. It expires in 5 minutes.
            </p>
            {pending && pending.devFallback && (
              <p className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                Email isn't configured, so the code was printed in the server console window. Check there.
              </p>
            )}
            <Field label="6-digit code">
              <input className={inputCls + ' text-center tracking-[0.5em] text-lg font-semibold'} value={code} inputMode="numeric" maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000"
                onKeyDown={(e) => e.key === 'Enter' && verify()} autoFocus />
            </Field>
            <button onClick={verify} disabled={busy}
              className="w-full bg-emerald-600 text-white rounded-lg py-2.5 font-medium hover:opacity-90 disabled:opacity-50 mt-1">
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            <div className="flex justify-between mt-4 text-sm">
              <button onClick={backToCredentials} className="text-slate-500 hover:text-slate-800">← Back</button>
              <button onClick={resend} disabled={busy} className="text-slate-500 hover:text-slate-800 disabled:opacity-50">Resend code</button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">By logging into this system, you acknowledge that you are an authorized user and that you agree to be bound by our Terms of Use and Privacy Policy. Unauthorized access or use of this platform is strictly prohibited and may result in civil or criminal penalties. By continuing, you consent to the monitoring and logging of your system activities.</p>
      </div>
    </div>
  );
}

// ---------- Dashboard ----------
function Dashboard({ token }) {
  const [summary, setSummary] = useState(null);
  const year = new Date().getFullYear().toString();
  useEffect(() => { api('/api/summary?year=' + year, { token }).then(setSummary).catch(() => {}); }, []);
  if (!summary) return <p className="text-slate-500">Loading…</p>;

  const byCat = Object.fromEntries(summary.categories.map((c) => [c.category, c]));
  const total = summary.categories.reduce((s, c) => s + c.total, 0);
  const count = summary.categories.reduce((s, c) => s + c.count, 0);
  const hot = (summary.tiers.find((t) => t.tier === 'hot') || {}).count || 0;
  const cold = (summary.tiers.find((t) => t.tier === 'cold') || {}).count || 0;

  return (
    <div>
      <h2 className="text-2xl font-bold ink mb-1">Dashboard</h2>
      <p className="text-slate-500 text-sm mb-6">Your claimable tax relief for Year of Assessment {year}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-ink text-white rounded-2xl p-6">
          <p className="text-sm opacity-70">Total claimable so far</p>
          <p className="display text-3xl font-bold mt-1" style={{ color: '#E8C766' }}>{RM(total)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-sm text-slate-500">Receipts logged ({year})</p>
          <p className="display text-3xl font-bold ink mt-1">{count}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-sm text-slate-500">Storage tiers (all years)</p>
          <p className="display text-xl font-bold ink mt-2">
            <span className="text-orange-500">{hot} Hot</span>
            <span className="text-slate-300 mx-2">/</span>
            <span className="text-sky-600">{cold} Cold</span>
          </p>
        </div>
      </div>
      <h3 className="font-semibold ink mb-3">Relief category limits</h3>
      <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
        {CATEGORIES.filter((c) => c.limit).map((c) => {
          const claimed = (byCat[c.name] || {}).total || 0;
          const pct = Math.min(100, (claimed / c.limit) * 100);
          return (
            <div key={c.name} className="px-5 py-4">
              <div className="flex justify-between text-sm mb-1.5">
                <span className="font-medium text-slate-700">{c.name}</span>
                <span className="text-slate-500">{RM(claimed)} <span className="text-slate-300">/</span> {RM(c.limit)}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-[#122B40]'}`} style={{ width: pct + '%' }}></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Upload page (Tesseract.js OCR) ----------
function UploadPage({ token, notify, goTo }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrDone, setOcrDone] = useState(false);
  const [form, setForm] = useState({ merchant: '', receipt_date: '', amount: '', category: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function pickFile(f) {
    if (!f) return;
    setFile(f); setOcrDone(false);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  }

  async function runOcr() {
    if (!file || !file.type.startsWith('image/')) { notify('OCR works on JPEG/PNG images. For PDFs, fill the form manually.', 'error'); return; }
    setOcrBusy(true); setOcrProgress(0);
    try {
      const result = await Tesseract.recognize(file, 'eng', {
        logger: (m) => { if (m.status === 'recognizing text') setOcrProgress(Math.round(m.progress * 100)); }
      });
      const parsed = parseOcrText(result.data.text);
      setForm((f) => ({ ...f, merchant: parsed.merchant || f.merchant, receipt_date: parsed.date || f.receipt_date, amount: parsed.amount || f.amount }));
      setOcrDone(true);
      notify('OCR complete — please review the auto-filled fields');
    } catch (e) { notify('OCR failed: ' + e.message, 'error'); }
    setOcrBusy(false);
  }

  async function save() {
    if (!file) { notify('Please choose a receipt file first', 'error'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append('ocr_used', ocrDone ? 'true' : 'false');
      await api('/api/receipts', { method: 'POST', body: fd, token, isForm: true });
      notify('Receipt saved to Hot tier');
      goTo('receipts');
    } catch (e) { notify(e.message, 'error'); }
    setSaving(false);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold ink mb-1">Upload a receipt</h2>
      <p className="text-slate-500 text-sm mb-6">Step 1: choose a file · Step 2: scan with OCR · Step 3: review and save</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <input type="file" accept=".jpg,.jpeg,.png,.pdf" id="fileInput" className="hidden" onChange={(e) => pickFile(e.target.files[0])} />
          <label htmlFor="fileInput"
            className="block border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-[#122B40]">
            {preview ? <img src={preview} alt="Receipt preview" className="max-h-72 mx-auto rounded-lg" />
              : <div><p className="font-medium text-slate-600">{file ? file.name : 'Click to choose a receipt'}</p>
                  <p className="text-xs text-slate-400 mt-1">JPEG, PNG or PDF · up to 10 MB</p></div>}
          </label>
          <button onClick={runOcr} disabled={!file || ocrBusy}
            className="w-full mt-4 bg-ink text-white rounded-lg py-2.5 font-medium disabled:opacity-40">
            {ocrBusy ? `Scanning… ${ocrProgress}%` : 'Scan'}
          </button>
          {ocrBusy && <div className="h-1.5 bg-slate-100 rounded-full mt-3 overflow-hidden">
            <div className="h-full bg-[#122B40] rounded-full transition-all" style={{ width: ocrProgress + '%' }}></div></div>}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <Field label="Merchant"><input className={inputCls} value={form.merchant} onChange={set('merchant')} placeholder="e.g. Guardian Pharmacy" /></Field>
          <Field label="Receipt date"><input className={inputCls} type="date" value={form.receipt_date} onChange={set('receipt_date')} /></Field>
          <Field label="Amount (RM)"><input className={inputCls} type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} placeholder="0.00" /></Field>
          <Field label="LHDN relief category">
            <select className={inputCls} value={form.category} onChange={set('category')}>
              <option value="">Choose a category…</option>
              {CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name}{c.limit ? ` (limit ${RM(c.limit)})` : ''}</option>)}
            </select>
          </Field>
          <Field label="Notes (optional)"><input className={inputCls} value={form.notes} onChange={set('notes')} placeholder="e.g. Annual medical check-up" /></Field>
          <button onClick={save} disabled={saving} className="w-full bg-emerald-600 text-white rounded-lg py-2.5 font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Save receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Receipts list ----------
function ReceiptsPage({ token, notify }) {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ search: '', category: '', from: '', to: '' });
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  async function load() {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    setRows(await api('/api/receipts?' + q, { token }));
  }
  useEffect(() => { load().catch((e) => notify(e.message, 'error')); }, [filters]);

  async function del(id) {
    if (!confirm('Delete this receipt permanently?')) return;
    try { await api('/api/receipts/' + id, { method: 'DELETE', token }); notify('Receipt deleted'); load(); }
    catch (e) { notify(e.message, 'error'); }
  }
  async function view(id) {
    const res = await fetch(`/api/receipts/${id}/file`, { headers: { Authorization: 'Bearer ' + token } });
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  }
  async function saveEdit() {
    try {
      await api('/api/receipts/' + editing.id, { method: 'PUT', token, body: editing });
      notify('Receipt updated'); setEditing(null); load();
    } catch (e) { notify(e.message, 'error'); }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold ink mb-1">My receipts</h2>
      <p className="text-slate-500 text-sm mb-6">Search, filter, edit or open any stored receipt</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <input className={inputCls} placeholder="Search merchant or notes…" value={filters.search} onChange={set('search')} />
        <select className={inputCls} value={filters.category} onChange={set('category')}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <input className={inputCls} type="date" value={filters.from} onChange={set('from')} title="From date" />
        <input className={inputCls} type="date" value={filters.to} onChange={set('to')} title="To date" />
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500 border-b border-slate-100">
            <th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Merchant</th>
            <th className="px-4 py-3 font-medium">Category</th><th className="px-4 py-3 font-medium text-right">Amount</th>
            <th className="px-4 py-3 font-medium">Tier</th><th className="px-4 py-3 font-medium">OCR</th><th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-400">No receipts yet. Upload your first one to get started.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-3 whitespace-nowrap">{r.receipt_date}</td>
                <td className="px-4 py-3">{r.merchant}<div className="text-xs text-slate-400">{r.notes}</div></td>
                <td className="px-4 py-3 text-slate-600">{r.category}</td>
                <td className="px-4 py-3 text-right font-medium">{RM(r.amount)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.tier === 'hot' ? 'bg-orange-100 text-orange-700' : 'bg-sky-100 text-sky-700'}`}>
                    {r.tier === 'hot' ? 'Hot' : 'Cold'}</span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{r.ocr_used ? 'Auto' : 'Manual'}</td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  <button onClick={() => view(r.id)} className="text-slate-500 hover:text-slate-900 mr-3">Open</button>
                  <button onClick={() => setEditing({ ...r })} className="text-slate-500 hover:text-slate-900 mr-3">Edit</button>
                  <button onClick={() => del(r.id)} className="text-red-400 hover:text-red-600">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="font-bold ink text-lg mb-4">Edit receipt</h3>
            <Field label="Merchant"><input className={inputCls} value={editing.merchant} onChange={(e) => setEditing({ ...editing, merchant: e.target.value })} /></Field>
            <Field label="Date"><input className={inputCls} type="date" value={editing.receipt_date} onChange={(e) => setEditing({ ...editing, receipt_date: e.target.value })} /></Field>
            <Field label="Amount (RM)"><input className={inputCls} type="number" step="0.01" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} /></Field>
            <Field label="Category">
              <select className={inputCls} value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Notes"><input className={inputCls} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
            <div className="flex gap-3 mt-2">
              <button onClick={saveEdit} className="flex-1 bg-ink text-white rounded-lg py-2 font-medium">Save changes</button>
              <button onClick={() => setEditing(null)} className="flex-1 border border-slate-300 rounded-lg py-2 font-medium text-slate-600">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Annual summary with PDF export ----------
function SummaryPage({ token, user }) {
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [summary, setSummary] = useState(null);
  useEffect(() => { api('/api/summary?year=' + year, { token }).then(setSummary).catch(() => {}); }, [year]);
  const years = [];
  for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 7; y--) years.push(String(y));
  const total = summary ? summary.categories.reduce((s, c) => s + c.total, 0) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold ink mb-1">Annual tax claim summary</h2>
          <p className="text-slate-500 text-sm">Use this report when completing your e-Filing</p>
        </div>
        <div className="flex gap-3">
          <select className={inputCls + ' w-32'} value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
          <button onClick={() => window.print()} className="bg-ink text-white rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap">Download PDF</button>
        </div>
      </div>
      <div id="print-area" className="bg-white border border-slate-200 rounded-2xl p-8">
        <div className="border-b border-slate-200 pb-4 mb-4">
          <h3 className="display text-xl font-bold ink">MyTax Receipt Logger — Annual Tax Claim Summary</h3>
          <p className="text-sm text-slate-500 mt-1">Taxpayer: {user.name} ({user.email}) · Year of Assessment {year} · Generated {new Date().toLocaleDateString('en-MY')}</p>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-2 font-medium">LHDN relief category</th>
            <th className="py-2 font-medium text-right">Receipts</th>
            <th className="py-2 font-medium text-right">Claimable amount</th>
          </tr></thead>
          <tbody>
            {summary && summary.categories.length === 0 && <tr><td colSpan="3" className="py-8 text-center text-slate-400">No receipts recorded for {year}.</td></tr>}
            {summary && summary.categories.map((c) => (
              <tr key={c.category} className="border-b border-slate-100">
                <td className="py-2.5">{c.category}</td>
                <td className="py-2.5 text-right">{c.count}</td>
                <td className="py-2.5 text-right font-medium">{RM(c.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td className="py-3 font-bold ink" colSpan="2">Total claimable</td>
            <td className="py-3 text-right display font-bold ink text-lg">{RM(total)}</td>
          </tr></tfoot>
        </table>
        <p className="text-xs text-slate-400 mt-6">All supporting receipts are retained in secure storage for 7 years in compliance with the Income Tax Act 1967. This summary is for personal reference during e-Filing and is not an official LHDN document.</p>
      </div>
    </div>
  );
}

// ---------- Lifecycle page ----------
function LifecyclePage({ token, notify }) {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [summary, setSummary] = useState(null);
  const loadTiers = () => api('/api/summary', { token }).then(setSummary).catch(() => {});
  useEffect(() => { loadTiers(); }, []);

  async function run() {
    setBusy(true);
    try {
      const r = await api('/api/lifecycle/run', { method: 'POST', token, body: { days: Number(days) } });
      setResult(r); notify(r.message); loadTiers();
    } catch (e) { notify(e.message, 'error'); }
    setBusy(false);
  }
  const hot = summary ? (summary.tiers.find((t) => t.tier === 'hot') || {}).count || 0 : 0;
  const cold = summary ? (summary.tiers.find((t) => t.tier === 'cold') || {}).count || 0 : 0;

  return (
    <div>
      <h2 className="text-2xl font-bold ink mb-1">Storage lifecycle policy</h2>
      <p className="text-slate-500 text-sm mb-6">Simulates the Azure Blob Lifecycle Management rule from the project plan: receipts move from the Hot tier to the low-cost Cold tier after 30 days, then stay there for the rest of the 7-year retention period.</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <Field label="Move receipts older than (days)">
            <input className={inputCls} type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-400 mb-4">Tip for your demo: set this to 0 to move every Hot receipt to Cold immediately.</p>
          <button onClick={run} disabled={busy} className="w-full bg-ink text-white rounded-lg py-2.5 font-medium disabled:opacity-50">
            {busy ? 'Running…' : 'Run lifecycle policy now'}
          </button>
          {result && <p className="text-sm text-emerald-600 mt-3">{result.message}</p>}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <h3 className="font-semibold ink mb-4">Current tier distribution</h3>
          <div className="flex gap-4">
            <div className="flex-1 rounded-xl bg-orange-50 border border-orange-100 p-5 text-center">
              <p className="display text-3xl font-bold text-orange-600">{hot}</p>
              <p className="text-sm text-orange-700 mt-1">Hot tier</p>
              <p className="text-xs text-slate-400 mt-1">storage/hot</p>
            </div>
            <div className="flex-1 rounded-xl bg-sky-50 border border-sky-100 p-5 text-center">
              <p className="display text-3xl font-bold text-sky-600">{cold}</p>
              <p className="text-sm text-sky-700 mt-1">Cold tier</p>
              <p className="text-xs text-slate-400 mt-1">storage/cold</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-4">In production this runs automatically on Azure; here it is triggered manually so it can be demonstrated live.</p>
        </div>
      </div>
    </div>
  );
}

// ---------- Admin page (User Admin + Super Admin) ----------
function AdminPage({ token, user, notify }) {
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const isSuper = user.role === 'superadmin';

  async function load() {
    try {
      setUsers(await api('/api/admin/users', { token }));
      setInvites(await api('/api/admin/invites', { token }));
    } catch (e) { notify(e.message, 'error'); }
  }
  useEffect(() => { load(); }, []);

  async function updateUser(id, changes, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try {
      await api('/api/admin/users/' + id, { method: 'PUT', token, body: changes });
      notify('User updated'); load();
    } catch (e) { notify(e.message, 'error'); }
  }
  async function deleteUser(u) {
    if (!confirm(`Permanently delete ${u.email} and ALL their receipts? This cannot be undone.`)) return;
    try {
      const r = await api('/api/admin/users/' + u.id, { method: 'DELETE', token });
      notify(r.message); load();
    } catch (e) { notify(e.message, 'error'); }
  }
  async function sendInvite() {
    if (!inviteEmail.trim()) { notify('Enter an email address to invite', 'error'); return; }
    setBusy(true);
    try {
      const r = await api('/api/admin/invites', { method: 'POST', token, body: { email: inviteEmail.trim() } });
      notify(r.devFallback ? 'Email not configured — invite link printed in the server window' : r.message);
      setInviteEmail(''); load();
    } catch (e) { notify(e.message, 'error'); }
    setBusy(false);
  }
  async function revokeInvite(inv) {
    if (!confirm(`Revoke the pending invitation for ${inv.email}?`)) return;
    try {
      const r = await api('/api/admin/invites/' + inv.id, { method: 'DELETE', token });
      notify(r.message); load();
    } catch (e) { notify(e.message, 'error'); }
  }

  const roleBadge = (r) => r === 'superadmin' ? 'bg-purple-100 text-purple-700' : r === 'useradmin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600';
  const roleLabel = (r) => r === 'superadmin' ? 'Super Admin' : r === 'useradmin' ? 'User Admin' : 'User';

  return (
    <div>
      <h2 className="text-2xl font-bold ink mb-1">User administration</h2>
      <p className="text-slate-500 text-sm mb-6">Manage accounts, subscriptions and invitations</p>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500 border-b border-slate-100">
            <th className="px-4 py-3 font-medium">User</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Subscription</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-3">{u.name}{u.id === user.id && <span className="text-xs text-slate-400"> (you)</span>}
                  <div className="text-xs text-slate-400">{u.email}</div></td>
                <td className="px-4 py-3">
                  {isSuper && u.id !== user.id ? (
                    <select className="border border-slate-200 rounded px-1.5 py-1 text-xs bg-white" value={u.role}
                      onChange={(e) => updateUser(u.id, { role: e.target.value }, `Change ${u.email} to ${e.target.value}?`)}>
                      <option value="user">User</option>
                      <option value="useradmin">User Admin</option>
                      <option value="superadmin">Super Admin</option>
                    </select>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleBadge(u.role)}`}>{roleLabel(u.role)}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => updateUser(u.id, { subscription: u.subscription === 'premium' ? 'freemium' : 'premium' })}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.subscription === 'premium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}
                    title="Click to toggle">
                    {u.subscription === 'premium' ? 'Premium' : 'Freemium'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {u.status === 'active' ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{(u.created_at || '').slice(0, 10)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  {u.id !== user.id && (
                    <span>
                      <button onClick={() => updateUser(u.id, { status: u.status === 'active' ? 'disabled' : 'active' },
                        u.status === 'active' ? `Disable ${u.email}? They will no longer be able to log in.` : null)}
                        className="text-slate-500 hover:text-slate-900 mr-3">
                        {u.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => deleteUser(u)} className="text-red-400 hover:text-red-600">Delete</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="font-semibold ink mb-3">Invitations</h3>
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
        <div className="flex gap-3">
          <input className={inputCls + ' flex-1'} type="email" placeholder="new.user@email.com" value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendInvite()} />
          <button onClick={sendInvite} disabled={busy}
            className="bg-ink text-white rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-50 whitespace-nowrap">
            {busy ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">Registration is by invitation only. The invite link is valid for 7 days and can be used once.</p>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500 border-b border-slate-100">
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Invited by</th>
            <th className="px-4 py-3 font-medium">Expires</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {invites.length === 0 && <tr><td colSpan="5" className="px-4 py-8 text-center text-slate-400">No invitations sent yet.</td></tr>}
            {invites.map((inv) => (
              <tr key={inv.id} className="border-b border-slate-50">
                <td className="px-4 py-3">{inv.email}</td>
                <td className="px-4 py-3 text-slate-500">{inv.invited_by}</td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{(inv.expires_at || '').slice(0, 10)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${inv.used ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                    {inv.used ? 'Used' : 'Pending'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {!inv.used && <button onClick={() => revokeInvite(inv)} className="text-red-400 hover:text-red-600">Revoke</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Maintenance page (Super Admin only) ----------
function MaintenancePage({ token, notify }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/admin/maintenance', { token }).then((d) => setOn(d.maintenance)).catch(() => {}); }, []);

  async function toggle() {
    const target = !on;
    const msg = target
      ? 'Turn ON maintenance mode? All users except Super Administrators will be unable to log in until it is turned off.'
      : 'Turn OFF maintenance mode? All users will be able to log in again.';
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const r = await api('/api/admin/maintenance', { method: 'POST', token, body: { enabled: target } });
      setOn(r.maintenance); notify(r.message);
    } catch (e) { notify(e.message, 'error'); }
    setBusy(false);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold ink mb-1">Maintenance mode</h2>
      <p className="text-slate-500 text-sm mb-6">Take the site offline for all users in case of a security incident or planned maintenance. Super Administrators can still log in.</p>
      <div className={`rounded-2xl border p-8 max-w-xl ${on ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold ink text-lg">{on ? 'Maintenance mode is ON' : 'Maintenance mode is OFF'}</p>
            <p className="text-sm text-slate-500 mt-1">
              {on ? 'Regular users and User Admins are blocked from logging in.' : 'The site is operating normally — all users can log in.'}
            </p>
          </div>
          <button onClick={toggle} disabled={busy}
            className={`rounded-lg px-6 py-2.5 font-medium text-white disabled:opacity-50 ${on ? 'bg-emerald-600' : 'bg-red-600'}`}>
            {busy ? 'Working…' : on ? 'Turn OFF' : 'Turn ON'}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-4 max-w-xl">Existing sessions are not force-terminated in this prototype; maintenance mode blocks new logins. In production this would also invalidate active sessions.</p>
    </div>
  );
}

// ---------- App shell ----------
const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'upload', label: 'Upload receipt' },
  { id: 'receipts', label: 'My receipts' },
  { id: 'summary', label: 'Annual summary' },
  { id: 'lifecycle', label: 'Storage lifecycle' },
  { id: 'admin', label: 'Administration', roles: ['useradmin', 'superadmin'] },
  { id: 'maintenance', label: 'Maintenance', roles: ['superadmin'] },
];
const navFor = (role) => NAV.filter((n) => !n.roles || n.roles.includes(role || 'user'));

function App() {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('mytax-session')) || null; } catch { return null; }
  });
  const [page, setPage] = useState('dashboard');
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  function notify(msg, kind = 'ok') {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }
  function onLogin(data) {
    setSession(data);
    sessionStorage.setItem('mytax-session', JSON.stringify(data));
    notify('Welcome, ' + data.user.name);
  }
  function logout() {
    setSession(null);
    sessionStorage.removeItem('mytax-session');
  }

  if (!session) return <div><AuthPage onLogin={onLogin} notify={notify} /><Toast toast={toast} /></div>;
  const { token, user } = session;

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 bg-ink text-white flex-col hidden md:flex">
        <div className="px-5 py-6 border-b border-white/10">
          <p className="display font-bold text-lg leading-tight">MyTax<br />Receipt Logger</p>
          <p className="text-xs opacity-50 mt-1">Prototype</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navFor(user.role).map((n) => (
            <button key={n.id} onClick={() => setPage(n.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm ${page === n.id ? 'bg-white/15 font-medium' : 'opacity-70 hover:opacity-100 hover:bg-white/5'}`}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-white/10">
          <p className="text-sm font-medium">{user.name}</p>
          {user.role && user.role !== 'user' && (
            <p className="text-xs" style={{ color: '#E8C766' }}>{user.role === 'superadmin' ? 'Super Administrator' : 'User Administrator'}</p>
          )}
          <button onClick={logout} className="text-xs opacity-60 hover:opacity-100 mt-1">Log out</button>
        </div>
      </aside>
      <main className="flex-1 px-6 py-8 max-w-5xl mx-auto w-full">
        <div className="md:hidden flex gap-2 mb-6 overflow-x-auto">
          {navFor(user.role).map((n) => (
            <button key={n.id} onClick={() => setPage(n.id)}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${page === n.id ? 'bg-ink text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
              {n.label}</button>
          ))}
        </div>
        {page === 'dashboard' && <Dashboard token={token} />}
        {page === 'upload' && <UploadPage token={token} notify={notify} goTo={setPage} />}
        {page === 'receipts' && <ReceiptsPage token={token} notify={notify} />}
        {page === 'summary' && <SummaryPage token={token} user={user} />}
        {page === 'lifecycle' && <LifecyclePage token={token} notify={notify} />}
        {page === 'admin' && <AdminPage token={token} user={user} notify={notify} />}
        {page === 'maintenance' && <MaintenancePage token={token} notify={notify} />}
      </main>
      <Toast toast={toast} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
