# Buraq Holidays — Corporate Management Suite

A production-oriented full-stack deployment of the existing Buraq Holidays corporate suite. The existing navy/blue/gold visual identity, finance entry screens, pilgrim management workflows, ID card studio, dashboard charts, and print layouts are retained.

## Architecture

- Existing browser UI is served by a Node.js/Express application.
- PostgreSQL stores Finance, Pilgrim Management, ID Card Studio, drafts, package itineraries and ticket bookings in encrypted JSONB module records.
- Passwords are hashed with bcrypt (12 rounds); plaintext passwords are never stored. Personal/business module data is encrypted before it is stored in PostgreSQL using AES-256-GCM.
- Authentication uses server-side sessions stored in PostgreSQL.
- Session cookies are HttpOnly, SameSite=Strict, and Secure in production.
- Backend role checks protect data read/write endpoints and administration routes.
- Login rate limiting, same-origin checks, Helmet security headers and audit logging are enabled.
- Initial Super Admin is created from environment variables only when the database has no Super Admin. First login and every temporary-password login require a password change before company data can be opened.

## Roles

| Role | Access |
|---|---|
| Super Admin | All modules, users, backups, restore and audit log |
| Finance Admin | Finance & Accounts data; read-only package records for importing clients |
| Pilgrim & Card Admin | Pilgrim bookings, drafts, ID cards, Package Generator and Ticket Booking |

Package and ticket records are stored in the dedicated commercial module store. Finance Admin can read package records and import package clients into the finance ledger; the finance ledger remains inaccessible to the Pilgrim role.

## Local run with Docker

Requirements: Docker Desktop with Docker Compose.

1. On Windows PowerShell, run `.\setup-windows.ps1`. It securely generates database/session/encryption secrets and asks you to choose the initial Super Admin password. It creates `.env` and will not overwrite an existing one.
   - Alternatively, copy `.env.example` to `.env` and replace every `CHANGE_ME` value manually.
2. If editing `.env` manually, use strong unique values for `POSTGRES_PASSWORD`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, and `ADMIN_PASSWORD`.
   - `SESSION_SECRET`: at least 32 characters; use `openssl rand -hex 48`.
   - `DATA_ENCRYPTION_KEY`: at least 32 random characters; use `openssl rand -hex 32`. Keep this key in a secure password manager. Losing it makes encrypted records unrecoverable.
   - `ADMIN_PASSWORD`: 14–72 UTF-8 bytes; use a password manager.
3. Start the system:

   ```bash
   docker compose up -d --build
   ```

4. Open `http://localhost:3000`.
5. Sign in with `ADMIN_USERNAME` and the `ADMIN_PASSWORD` you placed in `.env`.
6. Change the Super Admin password in Account after signing in.
7. Create separate Finance Admin and Pilgrim & Card Admin accounts from **User & Access Control**.

Logs:

```bash
docker compose logs -f app
```

Stop the app without deleting data:

```bash
docker compose down
```

The PostgreSQL volume is retained when using `docker compose down`. Do not use `docker compose down -v` unless you intentionally want to delete the database.

## Deploy from GitHub

**GitHub Pages is not suitable** because this project requires the Node.js server and PostgreSQL.

Recommended route: **GitHub → Railway application service + Neon PostgreSQL**.

1. Use a private GitHub repository and copy the project contents into its root. Do not upload `.env`.
2. Push the code to GitHub.
3. In Railway, create a project and deploy from the GitHub repository.
4. Set the start command to `npm start` if it is not detected automatically. The `package.json` already defines this command.
5. Use Node.js 20 or newer (Node.js 22 LTS is recommended).
6. Add the environment variables listed below. Set `DATABASE_URL` to the Neon PostgreSQL connection string and `PGSSLMODE=require`.
7. Set `NODE_ENV=production`, generate strong unique values for `SESSION_SECRET` and `DATA_ENCRYPTION_KEY`, and set the initial Super Admin credentials.
8. Deploy and verify `/api/health`. Sign in, change the temporary password, and create the required staff accounts.

For Namecheap Stellar/cPanel setup, follow the **Namecheap Stellar / cPanel Node.js deployment** section below. The legacy Render deployment manifest has been removed; Render is not part of the supported deployment path for this release.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PGSSLMODE` | Set to `require` for Neon or another PostgreSQL host requiring TLS |
| `SESSION_SECRET` | Secret used to sign session cookies |
| `DATA_ENCRYPTION_KEY` | Key material for AES-256-GCM application-data encryption |
| `ADMIN_USERNAME` | Initial Super Admin username |
| `ADMIN_PASSWORD` | Initial Super Admin password (14+ chars) |
| `ADMIN_NAME` | Initial Super Admin display name |
| `NODE_ENV` | Set `production` on hosted deployment |
| `PORT` | HTTP port (provided by many hosts) |

The initial Super Admin environment variables are only used when no Super Admin exists in the database. After the first successful bootstrap, you may remove `ADMIN_PASSWORD` from the hosting environment to reduce secret exposure; the bcrypt password hash remains in PostgreSQL. Changing `ADMIN_PASSWORD` later does not reset an existing account.

## Data persistence and backups

The application persists these datasets in PostgreSQL:

- `buraq_finance_data`
- `buraq_records`
- `buraq_draft`
- `buraqPilgrims`
- `buraq_commercial_data`

Super Admin can download and restore a business-data JSON backup in **User & Access Control**. This JSON backup covers the five application data modules, not user accounts or sessions. For a complete database backup including user accounts, password hashes, sessions and audit history, use provider-level PostgreSQL backups or the included Docker scripts (`./scripts/backup-db.sh` and `./scripts/restore-db.sh`). Also configure automated PostgreSQL backups / point-in-time recovery in your hosting provider. Store downloaded backups securely; they contain personal and financial data.

## Important deployment/security notes

- Use HTTPS in production. The production session cookie is marked Secure.
- Never commit `.env`, database credentials, session secrets or real customer records.
- Use a private GitHub repository if the code should not be public.
- Restrict Railway, cPanel and database access to trusted administrators.
- Set a backup retention policy and test restores.
- Existing print templates remain separate from internal cost/finance data; this build does not intentionally add booking cost fields to ID card print layouts.
- This build stores application records as PostgreSQL JSONB to preserve the existing module data structure. Keep the database plan sized for the number of records and uploaded ID-card images.
- A local browser cache is used only as a working cache; the server database is the authoritative store. Writes are synchronized to the server automatically.



## Buraq Holidays enhancement release (1.1.0)

### Pilgrim Management
- Registration now uses **Visa Number** in place of the email field.
- Travel itinerary includes visa category, outbound and return routes, flight departure/arrival dates and times, ticket status (including Confirmed), and PNR Reference.
- Hotel stays capture check-in and check-out times.
- Transport is a repeatable section for pickup/drop-off, date/time, medium, provider and vehicle details.
- Ziyarah is recorded as individual dated visits with transport medium and pickup/visit time.
- The former Cost & Payment Management step has been removed from the active pilgrim workflow and from the travel voucher printout. Legacy cost fields in previously saved records are not automatically deleted from the database.

### Package Generator
- A new main-menu module creates, saves, reopens and prints complete package itineraries.
- It captures client name, CNIC, visa information, outbound/return travel, hotel stays and timings, transport, Ziyarah and notes.
- It intentionally has no package-cost or payment-entry fields.
- Finance & Accounts includes **Import Package Generator** in Client Accounts. Import creates or refreshes linked client details; the finance user must enter the agreed amount before receivables can be calculated.

### Ticket Booking
- A new main-menu module supports Single Route and Double Route bookings.
- Passenger name, CNIC, passport/contact, ticket category, airline, flight, country, city, airport, date/time, PNR, status and package-maker details are supported.
- Country, city, airport and airline values are free-text to support international routes and carriers.
- The ticket module does not collect payment details.

### Finance & Accounts printing
- Client records, client forms, payment receipts and expense forms can be printed on the Buraq Holidays letterhead.
- Saving an income receipt opens the browser print dialog for the receipt. Choose **Save as PDF** in the print destination to create a PDF.
- Receipts show the current payment, cumulative amount received, agreed package amount and outstanding balance when linked to a client account.

### Data storage and permissions
- The new commercial data store is `buraq_commercial_data` in the existing encrypted PostgreSQL `app_data` table. It stores package and ticket records.
- The application creates this JSONB key automatically during startup; no destructive database migration is required.
- Super Admin and Pilgrim & Card Admin can create and edit package/ticket records. Finance Admin can read package data for client import but cannot edit the commercial store.
- Existing backups containing the four original data keys remain restorable; the new commercial store defaults to empty when it is absent from an older backup.

### Printing
- Print actions open the browser print dialog. Select **Save as PDF** to save a PDF file. Confirm paper size A4 and enable background graphics only if the browser print preview requires it.

## Railway + Neon PostgreSQL deployment

1. Push the project root to a private GitHub repository.
2. In Railway, create a service from that GitHub repository. The project already defines `npm start`; set the Start Command to `npm start` if Railway does not detect it automatically.
3. Use Node.js 20 or newer (Node.js 22 LTS is recommended).
4. In Railway service Variables, set:
   - `NODE_ENV=production`
   - `DATABASE_URL` to the Neon PostgreSQL connection string (use the Neon pooled connection string for the application where appropriate).
   - `PGSSLMODE=require`
   - `SESSION_SECRET` to at least 32 random characters.
   - `DATA_ENCRYPTION_KEY` to at least 32 random characters.
   - `ADMIN_USERNAME`, `ADMIN_NAME`, and `ADMIN_PASSWORD` for the first Super Admin only. The initial password must be at least 14 characters and no more than 72 UTF-8 bytes.
5. Railway injects `PORT`; the server reads `process.env.PORT`. Ensure the Railway service exposes the port used by the application and confirm `/api/health` after deployment.
6. Keep Neon backups enabled and test restoration before production use.

## Namecheap Stellar / cPanel Node.js deployment

1. Confirm **cPanel → Setup Node.js App** is available on the hosting account and that Node.js 20 or newer is offered. Select Node.js 22 where available.
2. Upload or clone the project into a private application-root directory. Do not place `.env` or database backups in a public web directory.
3. Create the Node.js application in cPanel:
   - Application root: the project root directory.
   - Application URL: the domain or subdirectory assigned to the app.
   - Application mode: Production.
   - Startup file: `server/index.js`.
4. Run the cPanel **NPM Install** action (or `npm install` in the application environment).
5. Add the same runtime variables listed in the Railway section. Use Neon as the external PostgreSQL database and set `PGSSLMODE=require`. Confirm that the hosting account permits outbound TLS connections to the Neon endpoint.
6. Restart the application from cPanel and verify `/api/health`, login, data persistence and printing.

**Hosting limitation:** Namecheap's shared-hosting software/version availability varies by plan and server. Namecheap documents the Node.js App setup workflow and Node.js 20/22/24 availability on its shared servers. Its current shared-server software page lists PostgreSQL for Stellar Plus and Stellar Business, not the base Stellar plan; using Neon avoids depending on a local PostgreSQL installation. Confirm the Node.js App feature and outbound database connectivity on the actual account before production cutover.

The project listens on `process.env.PORT` (default `3000`), serves static assets through Express, stores sessions in PostgreSQL, and does not require a writable local upload directory for the current modules. Docker is suitable for local development or a Docker-capable host; cPanel deployment uses the Node.js App manager instead of Docker.

## Full local database backup

```bash
./scripts/backup-db.sh
./scripts/restore-db.sh backups/your-backup.sql
```

The restore script requires typing `RESTORE` because it replaces current database contents. Keep backup files out of GitHub and store them in encrypted storage.

## Troubleshooting

- `Incorrect username or password`: use the credentials set as `ADMIN_USERNAME` and `ADMIN_PASSWORD` on the first database initialization.
- `Database unavailable`: check `DATABASE_URL` and PostgreSQL service health.
- `502` / app won't start: inspect service logs and verify required environment variables.
- If a previous database already contains a Super Admin, environment bootstrap credentials will not overwrite it. Use that existing account or reset it through a controlled database-admin process.
