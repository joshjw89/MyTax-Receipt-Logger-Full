// mailer.js — sends emails via Brevo HTTP API (port 443 / HTTPS)
//
// Replaced Nodemailer SMTP with Brevo
// Render's free tier blocks all outbound SMTP ports (25, 465, 587) since
// September 26 2025. Brevo sends via a REST API over HTTPS (port 443) which
// Render permits. No additional npm package needed — uses Node's built-in https.
//
// Environment variables required (set in Render dashboard, never in code):
//   BREVO_API_KEY  — your Brevo API key (starts with "xkeysib-")
//   EMAIL_USER     — the Gmail address you verified as a sender in Brevo


const https = require('https');

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_USER    = process.env.EMAIL_USER;

const isConfigured = Boolean(BREVO_API_KEY && EMAIL_USER);

// Send a JSON payload to the Brevo transactional email API
function brevoSend(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'api-key': BREVO_API_KEY,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data || '{}'));
          } else {
            reject(new Error(`Brevo API error ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------- OTP verification email ----------
async function sendOtpEmail(toEmail, name, code) {
  if (!isConfigured) {
    console.log('============================================================');
    console.log('  EMAIL NOT CONFIGURED — DEVELOPMENT FALLBACK');
    console.log(`  OTP for ${toEmail}: ${code}`);
    console.log('  (Set BREVO_API_KEY and EMAIL_USER to send real emails)');
    console.log('============================================================');
    return { delivered: false, fallback: true };
  }

  await brevoSend({
    sender: { name: 'MyTax Receipt Logger', email: EMAIL_USER },
    to: [{ email: toEmail, name }],
    subject: `Your MyTax verification code: ${code}`,
    textContent: `Hi ${name}, your MyTax Receipt Logger verification code is ${code}. It expires in 5 minutes.`,
    htmlContent: `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#F4F7F9;border-radius:12px">
      <h2 style="color:#122B40;margin:0 0 4px">MyTax Receipt Logger</h2>
      <p style="color:#5A6B7A;margin:0 0 20px">Two-factor authentication</p>
      <div style="background:#fff;border-radius:10px;padding:24px;text-align:center;border:1px solid #e2e8f0">
        <p style="color:#5A6B7A;margin:0 0 8px">Hi ${name}, your one-time verification code is:</p>
        <p style="font-size:34px;letter-spacing:8px;font-weight:bold;color:#122B40;margin:8px 0">${code}</p>
        <p style="color:#94a3b8;font-size:13px;margin:8px 0 0">This code expires in 5 minutes.</p>
      </div>
      <p style="color:#94a3b8;font-size:12px;margin:20px 0 0">If you did not try to log in, you can safely ignore this email.</p>
    </div>`,
  });
  return { delivered: true, fallback: false };
}

// ---------- Password reset email ----------
async function sendPasswordResetEmail(toEmail, name, tempPass) {
  if (!isConfigured) {
    console.log('============================================================');
    console.log('  EMAIL NOT CONFIGURED — DEVELOPMENT FALLBACK');
    console.log(`  Temporary password for ${toEmail}: ${tempPass}`);
    console.log('  (Set BREVO_API_KEY and EMAIL_USER to send real emails)');
    console.log('============================================================');
    return { delivered: false, fallback: true };
  }

  await brevoSend({
    sender: { name: 'MyTax Receipt Logger', email: EMAIL_USER },
    to: [{ email: toEmail, name }],
    subject: 'Your MyTax temporary password',
    textContent: `Hi ${name}, your new temporary MyTax Receipt Logger password is: ${tempPass} — use it to log in. You will still be asked for a verification code.`,
    htmlContent: `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#F4F7F9;border-radius:12px">
      <h2 style="color:#122B40;margin:0 0 4px">MyTax Receipt Logger</h2>
      <p style="color:#5A6B7A;margin:0 0 20px">Password reset</p>
      <div style="background:#fff;border-radius:10px;padding:24px;text-align:center;border:1px solid #e2e8f0">
        <p style="color:#5A6B7A;margin:0 0 8px">Hi ${name}, your new temporary password is:</p>
        <p style="font-size:24px;letter-spacing:3px;font-weight:bold;color:#122B40;margin:8px 0;font-family:Consolas,monospace">${tempPass}</p>
        <p style="color:#94a3b8;font-size:13px;margin:8px 0 0">Use it to log in — you will still be asked for a verification code.</p>
      </div>
      <p style="color:#94a3b8;font-size:12px;margin:20px 0 0">If you did not request a password reset, please log in and check your account.</p>
    </div>`,
  });
  return { delivered: true, fallback: false };
}

// ---------- Invite email ----------
async function sendInviteEmail(toEmail, inviterName, inviteLink) {
  if (!isConfigured) {
    console.log('============================================================');
    console.log('  EMAIL NOT CONFIGURED — DEVELOPMENT FALLBACK');
    console.log(`  Invite link for ${toEmail}: ${inviteLink}`);
    console.log('  (Set BREVO_API_KEY and EMAIL_USER to send real emails)');
    console.log('============================================================');
    return { delivered: false, fallback: true };
  }

  await brevoSend({
    sender: { name: 'MyTax Receipt Logger', email: EMAIL_USER },
    to: [{ email: toEmail }],
    subject: `${inviterName} invited you to MyTax Receipt Logger`,
    textContent: `${inviterName} has invited you to join MyTax Receipt Logger. Create your account here (link valid for 7 days): ${inviteLink}`,
    htmlContent: `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#F4F7F9;border-radius:12px">
      <h2 style="color:#122B40;margin:0 0 4px">MyTax Receipt Logger</h2>
      <p style="color:#5A6B7A;margin:0 0 20px">You're invited</p>
      <div style="background:#fff;border-radius:10px;padding:24px;text-align:center;border:1px solid #e2e8f0">
        <p style="color:#5A6B7A;margin:0 0 16px">${inviterName} has invited you to join MyTax Receipt Logger — keep every tax relief receipt safe for 7 years, as LHDN requires.</p>
        <a href="${inviteLink}" style="display:inline-block;background:#122B40;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold">Create your account</a>
        <p style="color:#94a3b8;font-size:13px;margin:16px 0 0">This invitation expires in 7 days.</p>
      </div>
      <p style="color:#94a3b8;font-size:12px;margin:20px 0 0">If you weren't expecting this invitation, you can safely ignore this email.</p>
    </div>`,
  });
  return { delivered: true, fallback: false };
}

module.exports = { sendOtpEmail, sendPasswordResetEmail, sendInviteEmail, isConfigured };
