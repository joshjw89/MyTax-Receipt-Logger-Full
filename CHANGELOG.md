# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased] - yyyy-mm-dd

### Added

### Changed

### Fixed

---

## [2.2.2] - 2026-07-04

Root cause confirmed for email delivery failure on Render free tier.
Switched from SMTP to Brevo HTTP API. No new npm dependencies added.

### Added

### Changed

- [FEAT-015](../../issues/15)
  MAJOR Replaced Nodemailer SMTP with Brevo HTTP API for email delivery.
  Removed nodemailer from package.json entirely — the new mailer.js uses
  Node's built-in https module with zero additional dependencies.

### Fixed

- [BUG-004](../../issues/4)
  MAJOR Root cause of SMTP failure confirmed: Render permanently blocked all
  outbound SMTP ports (25, 465, 587) on free tier as of September 26 2025 to
  prevent spam abuse. Port-switching (465 → 587) did not resolve the issue as
  the entire SMTP protocol is blocked at the network level, not just specific
  ports. Fix: replaced Nodemailer SMTP with Brevo's transactional email REST
  API, which sends over HTTPS on port 443 — a port Render permits on all tiers.
  Brevo's authorised IP list updated to include Render's outbound IP
  (74.220.52.6). Emails deliver successfully; currently routed to spam folder
  due to missing SPF/DKIM/DMARC DNS records on the sender domain — expected
  for a prototype using a personal email address as the sender.
  Files changed: `mailer.js`, `package.json`

## [2.2.1] - 2026-07-03

Hotfix for Render cloud deployment - SMTP port blocked on free tier.

### Added

### Changed

### Fixed

- [BUG-003](../../issues/3)
  MAJOR Gmail SMTP port 465 (SSL) is blocked by Render's free-tier infrastructure,
  causing all login and registration attempts to fail in the cloud deployment with
  error: `Could not send verification email: connect ENETUNREACH on port 465`.
  Root cause: Render's free tier restricts outbound connections on port 465 to
  prevent spam abuse. Fix: replaced the `service: 'gmail'` Nodemailer shorthand
  (which defaults to port 465 with SSL) with an explicit SMTP configuration using
  `host: 'smtp.gmail.com'`, `port: 587`, and `secure: false` (STARTTLS). STARTTLS
  upgrades the connection to TLS automatically after the initial handshake —
  the connection remains fully encrypted, just on a different port that Render
  permits. Verified locally before committing; Render redeployed automatically
  via the GitHub Actions CI/CD pipeline.
  Files changed: `mailer.js`

---

## [2.2.0] - 2026-07-03

Security hardening: forced password change after a temporary-password login,
and safe database migration for existing deployments.

### Added

- [FEAT-012](../../issues/12)
  MAJOR Forced password change screen after logging in with a temporary password
  issued by the forgot-password flow. The user cannot access the application until
  a new password meeting the full policy is chosen. Reusing the temporary password
  as the new password is explicitly rejected server-side.

- [FEAT-013](../../issues/13)
  MINOR `must_change_password` flag added to the `users` table. Set to `1` when a
  temporary password is issued; cleared to `0` after a successful forced change.
  Includes a safe `ALTER TABLE` migration so existing databases are upgraded without
  data loss.

- [FEAT-014](../../issues/14)
  MINOR `POST /api/change-password` endpoint added. Enforces the password policy,
  prevents reuse of the temporary password, and clears the forced-change flag on
  success.

### Changed

### Fixed

---

## [2.1.0] - 2026-07-02

Password security policy and account recovery via email.

### Added

- [FEAT-010](../../issues/10)
  MAJOR Password complexity policy enforced server-side on all new passwords:
  minimum 10 characters, at least 1 uppercase letter, at least 1 special character
  (e.g. ! @ # $ %). Specific error messages returned for each failed rule.
  Live client-side checklist displayed in the registration form as the user types,
  mirroring the server policy for immediate feedback.

- [FEAT-011](../../issues/11)
  MAJOR Forgot-password flow: submitting a registered email generates a
  12-character temporary password that itself satisfies the complexity policy,
  replaces the existing password hash, invalidates any pending OTPs, and emails
  the temporary password to the registered address. The response is intentionally
  generic ("If an account exists...") regardless of whether the email is registered,
  preventing email enumeration attacks. Implemented in `mailer.js` as
  `sendPasswordResetEmail()`.

### Changed

### Fixed

---

## [2.0.1] - 2026-07-02

Security: upgraded nodemailer to resolve high-severity CVEs.

### Added

### Changed

### Fixed

- [BUG-002](../../issues/2)
  MAJOR Upgraded nodemailer from `^6.9.14` to `^9.0.3` to resolve 8 high-severity
  CVEs including SMTP command injection (GHSA-vvjj-xcjg-gr5g, GHSA-c7w3-x93f-qmm8),
  denial-of-service via recursive address parsing (GHSA-rcmh-qjqh-p98v), CRLF
  injection in List-* headers (GHSA-268h-hp4c-crq3), improper TLS certificate
  validation in OAuth2 (GHSA-r7g4-qg5f-qqm2), and others. The upgrade is
  non-breaking for our Gmail SMTP usage pattern (`createTransport` / `sendMail`).
  Files changed: `package.json`

---

## [2.0.0] - 2026-06-24

Full-stack prototype with real Email OTP two-factor authentication,
deployed to Render with a GitHub Actions CI/CD pipeline.

### Added

- [FEAT-007](../../issues/7)
  MAJOR Two-factor authentication (2FA) via emailed 6-digit OTP. Login and
  registration are now two-step: (1) password verified server-side, a short-lived
  "pending" JWT issued and a 6-digit OTP generated, hashed with bcrypt, and stored
  in the new `otps` table with a 5-minute expiry; (2) user submits the OTP, server
  verifies the hash, and only then issues a full-access JWT. Pending tokens are
  explicitly rejected by all protected API routes. OTP invalidated after successful
  verification, on resend, and on forgot-password reset.

- [FEAT-008](../../issues/8)
  MINOR OTP resend endpoint (`POST /api/resend-otp`). Replaces the active OTP with
  a fresh one and re-emails it. Requires a valid pending token.

- [FEAT-009](../../issues/9)
  MINOR Development console fallback: when `EMAIL_USER` and `EMAIL_PASS` environment
  variables are not set, the server prints the OTP and temporary passwords to the
  console instead of sending email. Allows full local testing without Gmail
  credentials. UI displays an amber notice informing the developer to check the
  server window.

- [FEAT-010](../../issues/10)
  MAJOR Nodemailer + Gmail App Password integration for real email delivery.
  `mailer.js` reads `EMAIL_USER` and `EMAIL_PASS` from environment variables
  (never hard-coded). Sends styled HTML email for OTP verification and password
  reset. Configured as environment variables on Render so credentials are never
  committed to the repository.

- [FEAT-011](../../issues/11)
  MAJOR GitHub Actions CI/CD pipeline (`.github/workflows/deploy.yml`). Two jobs:
  CI verifies the build (installs dependencies, syntax-checks server files, compiles
  React/JSX with Babel); CD triggers a Render deploy hook only if CI passes. Deploy
  hook URL stored as a GitHub Actions secret (`RENDER_DEPLOY_HOOK`), never exposed
  in code.

- [FEAT-012](../../issues/12)
  MINOR `otps` database table added to track active OTP codes with expiry timestamps
  and attempt counters. Maximum 5 attempts before the OTP is invalidated and the
  user must log in again.

### Changed

- [FEAT-013](../../issues/13)
  MINOR `POST /api/login` and `POST /api/register` now return a `pendingToken`
  instead of a full access token. Full token is only issued after OTP verification
  via `POST /api/verify-otp`.

### Fixed

---

## [1.0.1] - 2026-06-21

Hotfix for blank page on GitHub Pages — Babel automatic JSX runtime.

### Added

### Changed

### Fixed

- [BUG-001](../../issues/1)
  MAJOR Blank page on GitHub Pages with console error:
  `Uncaught SyntaxError: Failed to execute 'appendChild' on 'Node':
  Cannot use import statement outside a module` at `transformScriptTags.ts`.
  Root cause: `index.html` loaded `app.js` using `<script type="text/babel"
  src="app.js">`, relying on Babel Standalone's automatic script-tag scanner.
  The CDN version of Babel Standalone defaults to the "automatic" JSX runtime,
  which injects an ES module `import` statement incompatible with plain browser
  `<script>` tags. Fix: replaced the automatic loader with a manual `fetch()`
  call that transforms the source using `Babel.transform()` with
  `presets: [['react', { runtime: 'classic' }]]`, compiling JSX to
  `React.createElement()` calls with no `import` statement required.
  Reproduced locally with `npx serve`, verified clean console and full
  functionality before committing.
  Files changed: `index.html`

---

## [1.0.0] - 2026-06-14

Initial release of the UI-only static prototype with GitHub Actions CI/CD pipeline.

### Added

- [FEAT-001](../../issues/2)
  MAJOR User registration and login using browser localStorage as the data layer
  (no backend server). Session managed via base64-encoded token stored in
  sessionStorage.

- [FEAT-002](../../issues/3)
  MAJOR Receipt upload supporting JPEG, PNG and PDF formats. Images compressed
  client-side via Canvas API before storage to fit within browser localStorage
  limits (~5 MB).

- [FEAT-003](../../issues/4)
  MINOR Client-side OCR using Tesseract.js v5. Scans uploaded receipt images
  in-browser and auto-fills merchant name, date, and amount fields. All OCR
  fields support manual override.

- [FEAT-004](../../issues/5)
  MINOR Receipt categorisation against all official LHDN MyTax individual tax
  relief categories, with their respective annual RM claim limits.

- [FEAT-005](../../issues/6)
  MINOR Dashboard with real-time claimable amount tracking per relief category,
  displayed as progress bars against each category's LHDN limit.

- [FEAT-006](../../issues/7)
  MINOR Search and filter receipts by merchant name, category, and date range.
  Edit and delete individual receipts with confirmation.

- [FEAT-007](../../issues/8)
  MINOR Hot → Cold storage lifecycle simulation. Receipts are assigned a `tier`
  field (`hot` or `cold`). A manual trigger moves eligible receipts from Hot to
  Cold based on a configurable day threshold, simulating the Azure Blob Storage
  lifecycle management policy from the Assignment 1 architecture.

- [FEAT-008](../../issues/9)
  MINOR Annual tax claim summary report for a selected year of assessment,
  showing total claimable amount per LHDN relief category. Exportable to PDF
  via the browser's built-in print function.

- [FEAT-009](../../issues/10)
  MAJOR GitHub Actions CI/CD pipeline (`.github/workflows/deploy.yml`). Two jobs:
  CI installs Babel and compiles the React/JSX source to verify the build; CD
  deploys to GitHub Pages only if CI passes. Deployment target: GitHub Pages
  (static hosting — no server required for the UI-only build).

### Changed

### Fixed
