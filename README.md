# MyTax Receipt Logger — Full Prototype

A web application that helps Malaysian individual taxpayers digitise, categorise, store and track tax relief receipts in compliance with LHDN's 7-year retention requirement under the Income Tax Act 1967.

**Live demo:** https://mytax-receipt-logger-full.onrender.com

> This MyTax Receipt Logger is a prototype built using open source equivalents in place of Azure cloud services.

---

## Features

- **Two-factor authentication (2FA)** - login and registration require a 6-digit OTP code emailed to the user via Brevo
- **Password security policy** - minimum 10 characters, at least 1 uppercase letter, at least 1 special character; enforced server-side with a live checklist in the UI
- **Forgot password** - a temporary password meeting the full policy is generated and emailed; the old password is invalidated immediately
- **Forced password change** - after logging in with a temporary password, the user must set a new one before accessing the app
- **Receipt upload** - JPEG, PNG and PDF support, stored on the server filesystem
- **OCR auto-fill** - Tesseract.js scans receipt images client-side and auto-fills merchant, date and amount; all fields support manual override
- **LHDN relief categorisation** - receipts mapped to official MyTax tax relief categories with their annual RM claim limits
- **Dashboard** - real-time claimable amount tracking per category with progress bars against LHDN limits
- **Search & filter** - by merchant name, category, and date range
- **Storage lifecycle simulation** - Hot → Cold tier movement modelled on Azure Blob Storage lifecycle management; configurable day threshold
- **Annual summary report** - exportable to PDF via the browser print function

---

## Architecture

This is the **full-stack prototype**. A separate UI-only static build is also maintained at [MyTax-Receipt-Logger](https://github.com/joshjw89/MyTax-Receipt-Logger) (GitHub Pages).

### How this prototype maps to the production design

| Production Design | Prototype |
|---|---|
| Azure App Service (Node.js) | Render web service |
| Azure PostgreSQL Flexible Server | SQLite (`mytax.db`) via sql.js |
| Azure Blob Storage - Hot tier | `storage/hot/` folder |
| Azure Blob Storage - Cold tier | `storage/cold/` folder |
| Azure Blob Lifecycle Management | Manual "Run lifecycle policy" button |
| Azure AI Vision OCR | Tesseract.js (client-side, free) |
| Speakeasy TOTP / SMS OTP (2FA) | Email OTP via Brevo HTTP API |
| GitHub Actions → Azure App Service | GitHub Actions → Render deploy hook |
| Puppeteer server-side PDF | Browser print-to-PDF |
| TLS (Azure App Service) | TLS via Render (automatic, Let's Encrypt) |

---

## Prototype Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 (CDN, no build step), Tailwind CSS, Babel Standalone |
| OCR | Tesseract.js v5 (client-side) |
| Backend | Node.js + Express |
| Authentication | JWT (jsonwebtoken), bcrypt (bcryptjs), 6-digit email OTP |
| Database | SQLite via sql.js |
| File uploads | Multer |
| Email | Brevo HTTP API (port 443) |
| Hosting | Render (free tier) |
| CI/CD | GitHub Actions |

---

## Known limitations

- **Data resets on Render redeploy** - SQLite lives on Render's ephemeral disk. A new deploy starts with an empty database. Acceptable for a prototype; in production this would be a managed database (Azure PostgreSQL).
- **Render free tier sleeps** after ~15 minutes of inactivity. The first request after sleeping takes 30–50 seconds to wake. 
- **Receipt files are not persisted across Render redeploys** - files in `storage/hot` and `storage/cold` are also on ephemeral disk.
- **Emails may land in spam** - due to missing SPF/DKIM/DMARC DNS records on the sender domain. Expected for a prototype using a personal email address as the sender. In production, these records would be configured on the domain's DNS provider.

---

## Upcoming features

The following features have been built locally and are pending deployment:

- **Invite-only registration** - public self-registration is disabled; Super Administrators and User Administrators send invite links to specific email addresses (7-day expiry, single-use, cryptographically random token)
- **Administrator roles** - three roles: Super Administrator (full access), User Administrator (user management only), User (normal access)
- **Admin panel** - dedicated Administration tab for User Admins and Super Admins: view all users with role, subscription, status and created date; toggle Freemium/Premium subscription; disable/enable accounts; delete accounts and all associated receipts
- **Role management** - Super Admins can promote or demote any user's role; last Super Administrator is protected from demotion or deletion
- **Maintenance mode** - Super Admins can take the site offline instantly; all non-Super-Admin login attempts are blocked with a maintenance message; Super Admins continue to log in normally through the same URL


