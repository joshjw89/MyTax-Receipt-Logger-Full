// mailer.js — sends the 6-digit OTP code to the user's email via Nodemailer.
//
// Uses a Gmail account through an "App Password" (set as environment variables,
// never hard-coded). If credentials are not configured, it falls back to printing
// the code to the server console so the app still works for local development.
const nodemailer = require('nodemailer');

const EMAIL_USER = process.env.EMAIL_USER; // your full Gmail address
const EMAIL_PASS = process.env.EMAIL_PASS; // the 16-character Gmail App Password

const isConfigured = Boolean(EMAIL_USER && EMAIL_PASS);

let transporter = null;
if (isConfigured) {
  transporter = nodemailer.createTransport({
     host: 'smtp.gmail.com',
     port: 587,
     secure: false,
     auth: { user: EMAIL_USER, pass: EMAIL_PASS },
   });
}

async function sendOtpEmail(toEmail, name, code) {
  // No credentials configured → development fallback: log to console.
  if (!isConfigured) {
    console.log('============================================================');
    console.log('  EMAIL NOT CONFIGURED — DEVELOPMENT FALLBACK');
    console.log(`  OTP for ${toEmail}: ${code}`);
    console.log('  (Set EMAIL_USER and EMAIL_PASS to send real emails)');
    console.log('============================================================');
    return { delivered: false, fallback: true };
  }

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#F4F7F9;border-radius:12px">
    <h2 style="color:#122B40;margin:0 0 4px">MyTax Receipt Logger</h2>
    <p style="color:#5A6B7A;margin:0 0 20px">Two-factor authentication</p>
    <div style="background:#fff;border-radius:10px;padding:24px;text-align:center;border:1px solid #e2e8f0">
      <p style="color:#5A6B7A;margin:0 0 8px">Hi ${name}, your one-time verification code is:</p>
      <p style="font-size:34px;letter-spacing:8px;font-weight:bold;color:#122B40;margin:8px 0">${code}</p>
      <p style="color:#94a3b8;font-size:13px;margin:8px 0 0">This code expires in 5 minutes.</p>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin:20px 0 0">If you didn't try to log in, you can safely ignore this email.</p>
  </div>`;

  await transporter.sendMail({
    from: `"MyTax Receipt Logger" <${EMAIL_USER}>`,
    to: toEmail,
    subject: `Your MyTax verification code: ${code}`,
    text: `Hi ${name}, your MyTax Receipt Logger verification code is ${code}. It expires in 5 minutes.`,
    html,
  });
  return { delivered: true, fallback: false };
}

async function sendPasswordResetEmail(toEmail, name, tempPass) {
  // No credentials configured → development fallback: log to console.
  if (!isConfigured) {
    console.log('============================================================');
    console.log('  EMAIL NOT CONFIGURED — DEVELOPMENT FALLBACK');
    console.log(`  Temporary password for ${toEmail}: ${tempPass}`);
    console.log('  (Set EMAIL_USER and EMAIL_PASS to send real emails)');
    console.log('============================================================');
    return { delivered: false, fallback: true };
  }

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#F4F7F9;border-radius:12px">
    <h2 style="color:#122B40;margin:0 0 4px">MyTax Receipt Logger</h2>
    <p style="color:#5A6B7A;margin:0 0 20px">Password reset</p>
    <div style="background:#fff;border-radius:10px;padding:24px;text-align:center;border:1px solid #e2e8f0">
      <p style="color:#5A6B7A;margin:0 0 8px">Hi ${name}, your new temporary password is:</p>
      <p style="font-size:24px;letter-spacing:3px;font-weight:bold;color:#122B40;margin:8px 0;font-family:Consolas,monospace">${tempPass}</p>
      <p style="color:#94a3b8;font-size:13px;margin:8px 0 0">Use it to log in — you will still be asked for a verification code.</p>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin:20px 0 0">If you didn't request a password reset, please log in and check your account.</p>
  </div>`;

  await transporter.sendMail({
    from: `"MyTax Receipt Logger" <${EMAIL_USER}>`,
    to: toEmail,
    subject: 'Your MyTax temporary password',
    text: `Hi ${name}, your new temporary MyTax Receipt Logger password is: ${tempPass} — use it to log in. You will still be asked for an emailed verification code.`,
    html,
  });
  return { delivered: true, fallback: false };
}

module.exports = { sendOtpEmail, sendPasswordResetEmail, isConfigured };
