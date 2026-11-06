import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
if (typeof process.env.DATA_ENCRYPTION_KEY !== "string" || process.env.DATA_ENCRYPTION_KEY.length < 32) throw new Error("DATA_ENCRYPTION_KEY must be at least 32 random characters.");
const dataEncryptionKey = crypto.createHash("sha256").update(process.env.DATA_ENCRYPTION_KEY, "utf8").digest();
function encryptData(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { _enc: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
}
function decryptData(value) {
  if (!value || value._enc !== "aes-256-gcm") return value; // Supports migration of earlier unencrypted app_data rows.
  const decipher = crypto.createDecipheriv("aes-256-gcm", dataEncryptionKey, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(plain);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "require" || process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
const roles = ["super", "finance", "pilgrim"];
const roleLabels = { super: "Super Admin", finance: "Finance Admin", pilgrim: "Pilgrim & Card Admin" };
const allKeys = ["buraq_finance_data", "buraq_records", "buraq_draft", "buraqPilgrims", "buraq_commercial_data"];
const writable = {
  super: new Set(allKeys),
  finance: new Set(["buraq_finance_data"]),
  pilgrim: new Set(["buraq_records", "buraq_draft", "buraqPilgrims", "buraq_commercial_data"])
};
const readable = {
  super: new Set(allKeys),
  finance: new Set(["buraq_finance_data", "buraq_commercial_data"]),
  pilgrim: new Set(["buraq_records", "buraq_draft", "buraqPilgrims", "buraq_commercial_data"])
};
const PgSession = connectPgSimple(session);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", "data:", "blob:"],
      formAction: ["'self'"]
    }
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(express.json({ limit: "30mb", strict: true }));
app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true, pruneSessionInterval: 15 * 60 }),
  name: "buraq.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: production,
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

function sameOrigin(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return res.status(403).json({ error: "Origin header required." });
  try {
    if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Cross-origin request rejected." });
  } catch { return res.status(403).json({ error: "Invalid request origin." }); }
  next();
}
app.use("/api", sameOrigin);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super','finance','pilgrim')),
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      force_password_change BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS app_data (
      data_key TEXT PRIMARY KEY,
      data_value JSONB NOT NULL,
      updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revision BIGINT NOT NULL DEFAULT 1
    );
    ALTER TABLE app_data ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
  `);
  const defaults = {
    buraq_finance_data: { clients: [], income: [], expenses: [], settings: { company: "Buraq Holidays" } },
    buraq_records: [], buraq_draft: {}, buraqPilgrims: [], buraq_commercial_data: { packages: [], tickets: [] }
  };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query("INSERT INTO app_data(data_key,data_value) VALUES($1,$2::jsonb) ON CONFLICT(data_key) DO NOTHING",
      [key, JSON.stringify(encryptData(value))]);
  }
  const username = String(process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD;
  const found = await pool.query("SELECT id FROM app_users WHERE role='super' LIMIT 1");
  if (!found.rowCount && adminPass) {
    if (adminPass.length < 14 || Buffer.byteLength(adminPass, "utf8") > 72) throw new Error("Initial ADMIN_PASSWORD must be 14–72 UTF-8 bytes.");
    const hash = await bcrypt.hash(adminPass, 12);
    await pool.query(
      "INSERT INTO app_users(id,username,display_name,role,password_hash,active,force_password_change) VALUES($1,$2,$3,'super',$4,TRUE,TRUE)",
      [crypto.randomUUID(), username, process.env.ADMIN_NAME || "Buraq Super Admin", hash]
    );
    console.log(`Initial Super Admin created: ${username}. Change the password after first login.`);
  } else if (!found.rowCount && !adminPass) {
    throw new Error("No Super Admin exists. Set ADMIN_USERNAME and ADMIN_PASSWORD (minimum 14 characters).");
  }
}
async function requireAuth(req, res, next) {
  try {
    if (!req.session?.user?.id) return res.status(401).json({ error: "Authentication required." });
    const r = await pool.query("SELECT id,username,display_name,role,active,force_password_change FROM app_users WHERE id=$1", [req.session.user.id]);
    if (!r.rowCount || !r.rows[0].active) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Your account is inactive. Contact the Super Admin." });
    }
    req.session.user = publicUser(r.rows[0]);
    if (req.session.user.forcePasswordChange && !["/api/auth/me", "/api/auth/change-password", "/api/auth/logout"].includes(req.path)) {
      return res.status(428).json({ error: "Password change required before accessing company data." });
    }
    next();
  } catch (e) { next(e); }
}
function requireRole(...allowed) {
  return (req, res, next) => requireAuth(req, res, () => {
    if (!allowed.includes(req.session.user.role)) return res.status(403).json({ error: "You do not have permission for this action." });
    next();
  });
}
async function audit(req, action, details = {}) {
  const u = req.session?.user;
  if (!u) return;
  await pool.query(
    "INSERT INTO audit_logs(user_id,username,role,action,details,ip_address) VALUES($1,$2,$3,$4,$5,$6)",
    [u.id, u.username, u.role, action, JSON.stringify(details), req.ip]
  );
}
function publicUser(u) {
  return { id: u.id, username: u.username, name: u.display_name, role: u.role, active: u.active, forcePasswordChange: u.force_password_change };
}
function validPassword(p) {
  return typeof p === "string" && p.length >= 12 && Buffer.byteLength(p, "utf8") <= 72;
}
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes and try again." }
});

app.get("/api/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ status: "ok", database: "connected" }); }
  catch { res.status(503).json({ status: "error", database: "unavailable" }); }
});

app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = req.body?.password;
    if (!username || typeof password !== "string" || username.length > 80) return res.status(400).json({ error: "Enter a valid username and password." });
    const result = await pool.query("SELECT * FROM app_users WHERE username=$1", [username]);
    const user = result.rows[0];
    if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
      await pool.query("INSERT INTO audit_logs(username,role,action,details,ip_address) VALUES($1,$2,$3,$4,$5)",
        [username || "unknown", "unknown", "Failed login", JSON.stringify({ reason: "Invalid credentials" }), req.ip]);
      return res.status(401).json({ error: "Incorrect username or password." });
    }
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = publicUser(user);
    await audit(req, "Signed in");
    res.json({ user: req.session.user });
  } catch (e) { next(e); }
});
app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.session.user }));
app.post("/api/auth/logout", requireAuth, async (req, res, next) => {
  try {
    await audit(req, "Signed out");
    await new Promise((resolve, reject) => req.session.destroy(err => err ? reject(err) : resolve()));
    res.clearCookie("buraq.sid", { httpOnly: true, secure: production, sameSite: "strict" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.post("/api/auth/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!validPassword(newPassword)) return res.status(400).json({ error: "New password must be 12–200 characters." });
    const r = await pool.query("SELECT password_hash FROM app_users WHERE id=$1 AND active=TRUE", [req.session.user.id]);
    if (!r.rowCount || !(await bcrypt.compare(String(currentPassword || ""), r.rows[0].password_hash))) return res.status(400).json({ error: "Current password is incorrect." });
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query("UPDATE app_users SET password_hash=$1,force_password_change=FALSE,updated_at=NOW() WHERE id=$2", [hash, req.session.user.id]);
    req.session.user.forcePasswordChange = false;
    await audit(req, "Changed password");
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/api/data", requireAuth, async (req, res, next) => {
  try {
    const keys = [...readable[req.session.user.role]];
    const r = await pool.query("SELECT data_key,data_value,revision FROM app_data WHERE data_key=ANY($1::text[])", [keys]);
    const data = Object.fromEntries(r.rows.map(x => [x.data_key, decryptData(x.data_value)]));
    const versions = Object.fromEntries(r.rows.map(x => [x.data_key, Number(x.revision)]));
    res.json({ data, versions });
  } catch (e) { next(e); }
});
app.put("/api/data/:key", requireAuth, async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!allKeys.includes(key) || !writable[req.session.user.role].has(key)) return res.status(403).json({ error: "You cannot modify this data module." });
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "value")) return res.status(400).json({ error: "Missing data value." });
    if (key === "buraq_commercial_data") {
      const commercial = req.body.value;
      const validRows = rows => Array.isArray(rows) && rows.length <= 10000 && rows.every(row =>
        row && typeof row === "object" && !Array.isArray(row) &&
        typeof row.id === "string" && row.id.length > 0 && row.id.length <= 120
      );
      if (!commercial || typeof commercial !== "object" || Array.isArray(commercial) ||
          !validRows(commercial.packages) || !validRows(commercial.tickets)) {
        return res.status(400).json({ error: "Invalid package or ticket data structure." });
      }
    }
    const expectedVersion = Number(req.body.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return res.status(400).json({ error: "Missing or invalid data revision. Refresh the application and try again." });
    const saved = await pool.query(
      "UPDATE app_data SET data_value=$1,updated_by=$2,updated_at=NOW(),revision=revision+1 WHERE data_key=$3 AND revision=$4 RETURNING revision",
      [JSON.stringify(encryptData(req.body.value)), req.session.user.id, key, expectedVersion]
    );
    if (!saved.rowCount) return res.status(409).json({ error: "This module was changed by another user. Reload the latest data before saving your changes." });
    await audit(req, "Saved module data", { key, revision: Number(saved.rows[0].revision) });
    res.json({ ok: true, key, revision: Number(saved.rows[0].revision), savedAt: new Date().toISOString() });
  } catch (e) { next(e); }
});

// Pilgrim bookings can create a finance-side client and advance receipt without granting the pilgrim role access to finance ledgers.
app.post("/api/booking-sync", requireRole("super", "pilgrim"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const booking = req.body?.booking;
    if (!booking || !booking.main?.name || !booking.voucherNo) return res.status(400).json({ error: "Booking name and voucher number are required." });
    await client.query("BEGIN");
    const current = await client.query("SELECT data_value FROM app_data WHERE data_key='buraq_finance_data' FOR UPDATE");
    const finance = current.rows[0] ? decryptData(current.rows[0].data_value) : { clients: [], income: [], expenses: [], settings: { company: "Buraq Holidays" } };
    finance.clients ||= []; finance.income ||= []; finance.expenses ||= [];
    const safeRef = String(booking.voucherNo).replace(/[^a-zA-Z0-9_-]/g, "_");
    const id = "pilgrim_" + safeRef;
    let account = finance.clients.find(x => x.id === id);
    const fields = {
      id, name: String(booking.main.name || "Pilgrim Booking"), phone: String(booking.main.phone || ""),
      email: String(booking.main.email || ""), service: String(booking.travel?.package || "Pilgrim Travel Package"),
      agreed: Number(booking.total) || 0, ref: String(booking.voucherNo),
      date: String(booking.travel?.departure || new Date().toISOString().slice(0,10)),
      notes: "Automatically linked from Pilgrim Management"
    };
    if (account) Object.assign(account, fields); else finance.clients.push(fields);
    const receipt = "PILGRIM-ADV-" + safeRef;
    const existing = finance.income.find(x => x.receipt === receipt);
    if (Number(booking.advance) > 0) {
      const row = { id: existing?.id || ("auto_" + id), date: new Date().toISOString().slice(0,10), receipt,
        clientId: id, source: "Pilgrim booking advance", amount: Number(booking.advance), method: "Cash",
        reference: "Synced from booking " + booking.voucherNo };
      if (existing) Object.assign(existing, row); else finance.income.push(row);
    } else if (existing) finance.income = finance.income.filter(x => x.receipt !== receipt);
    const updated = await client.query("UPDATE app_data SET data_value=$1,updated_by=$2,updated_at=NOW(),revision=revision+1 WHERE data_key='buraq_finance_data' RETURNING revision", [JSON.stringify(encryptData(finance)), req.session.user.id]);
    await client.query("COMMIT");
    await audit(req, "Synced pilgrim booking to finance", { voucherNo: booking.voucherNo });
    res.json(req.session.user.role === "super" ? { ok: true, finance, revision: Number(updated.rows[0].revision) } : { ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally { client.release(); }
});

app.get("/api/admin/users", requireRole("super"), async (_req, res, next) => {
  try {
    const r = await pool.query("SELECT id,username,display_name,role,active,force_password_change,created_at FROM app_users ORDER BY created_at");
    res.json({ users: r.rows.map(publicUser) });
  } catch (e) { next(e); }
});
app.post("/api/admin/users", requireRole("super"), async (req, res, next) => {
  try {
    const { name, username, password, role } = req.body || {};
    const cleanName = String(name || "").trim(), cleanUser = String(username || "").trim().toLowerCase();
    if (!cleanName || cleanName.length > 120 || !/^[a-z0-9._-]{3,50}$/.test(cleanUser)) return res.status(400).json({ error: "Enter a name and a username with 3–50 letters, numbers, dots, underscores or hyphens." });
    if (!validPassword(password)) return res.status(400).json({ error: "Temporary password must be at least 12 characters." });
    if (!roles.includes(role)) return res.status(400).json({ error: "Invalid role." });
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query("INSERT INTO app_users(id,username,display_name,role,password_hash,force_password_change) VALUES($1,$2,$3,$4,$5,TRUE) RETURNING id,username,display_name,role,active,force_password_change,created_at",
      [crypto.randomUUID(), cleanUser, cleanName, role, hash]);
    await audit(req, "Created user", { username: cleanUser, role });
    res.status(201).json({ user: publicUser(r.rows[0]) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That username already exists." });
    next(e);
  }
});
app.patch("/api/admin/users/:id", requireRole("super"), async (req, res, next) => {
  try {
    if (req.params.id === req.session.user.id) return res.status(400).json({ error: "You cannot disable your own active session." });
    const r = await pool.query("UPDATE app_users SET active=NOT active,updated_at=NOW() WHERE id=$1 RETURNING id,username,display_name,role,active,force_password_change,created_at", [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: "User not found." });
    await audit(req, r.rows[0].active ? "Enabled user" : "Disabled user", { username: r.rows[0].username });
    res.json({ user: publicUser(r.rows[0]) });
  } catch (e) { next(e); }
});
app.post("/api/admin/users/:id/reset-password", requireRole("super"), async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!validPassword(password)) return res.status(400).json({ error: "Temporary password must be at least 12 characters." });
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query("UPDATE app_users SET password_hash=$1,force_password_change=TRUE,updated_at=NOW() WHERE id=$2 RETURNING username", [hash, req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: "User not found." });
    await audit(req, "Reset user password", { username: r.rows[0].username });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.get("/api/admin/audit", requireRole("super"), async (_req, res, next) => {
  try {
    const r = await pool.query("SELECT username,role,action,details,ip_address,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 150");
    res.json({ logs: r.rows.map(x => ({ ...x, createdAt: x.created_at })) });
  } catch (e) { next(e); }
});
app.get("/api/admin/backup", requireRole("super"), async (req, res, next) => {
  try {
    const r = await pool.query("SELECT data_key,data_value,updated_at FROM app_data ORDER BY data_key");
    await audit(req, "Downloaded server backup");
    res.json({ product: "Buraq Holidays Corporate Management Suite", version: 1, exportedAt: new Date().toISOString(), data: Object.fromEntries(r.rows.map(x => [x.data_key, decryptData(x.data_value)])) });
  } catch (e) { next(e); }
});
app.post("/api/admin/backup", requireRole("super"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const data = req.body?.data;
    if (!data || !["buraq_finance_data","buraq_records","buraq_draft","buraqPilgrims"].every(k => Object.prototype.hasOwnProperty.call(data, k))) return res.status(400).json({ error: "Backup is incomplete. The four original data modules are required." });
    data.buraq_commercial_data ||= { packages: [], tickets: [] };
    await client.query("BEGIN");
    for (const key of allKeys) {
      await client.query("INSERT INTO app_data(data_key,data_value,updated_by,updated_at,revision) VALUES($1,$2,$3,NOW(),1) ON CONFLICT(data_key) DO UPDATE SET data_value=EXCLUDED.data_value,updated_by=EXCLUDED.updated_by,updated_at=NOW(),revision=app_data.revision+1", [key, JSON.stringify(encryptData(data[key])), req.session.user.id]);
    }
    await client.query("COMMIT");
    await audit(req, "Restored server backup");
    res.json({ ok: true });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html", maxAge: production ? "1h" : 0 }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: production ? "An internal server error occurred." : (err.message || "Internal server error.") });
});

await initDb();
const server = app.listen(PORT, () => console.log(`Buraq Holidays server listening on port ${PORT}`));
async function shutdown() {
  server.close(async () => { await pool.end(); process.exit(0); });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
