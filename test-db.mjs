
import "dotenv/config";
import pg from "pg";

const required = [
  "DATABASE_URL",
  "DATA_ENCRYPTION_KEY",
  "SESSION_SECRET"
];

for (const key of required) {
  const value = process.env[key] || "";

  if (
    !value ||
    value.includes("PASTE_") ||
    value.includes("CHANGE_ME")
  ) {
    console.error(`CONFIGURATION ERROR: ${key} is missing.`);
    process.exit(1);
  }
}

if (process.env.DATA_ENCRYPTION_KEY.length < 32) {
  console.error("Encryption key is too short.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 1,
  connectionTimeoutMillis: 10000
});

try {
  const result = await pool.query(`
    SELECT
      current_database() AS database,
      current_user AS role,
      current_schema() AS schema
  `);

  console.log("\nDATABASE CONNECTION: SUCCESS");
  console.log("Database:", result.rows[0].database);
  console.log("Role:", result.rows[0].role);
  console.log("Schema:", result.rows[0].schema);

} catch (error) {
  console.error("\nDATABASE CONNECTION FAILED");
  console.error(error.message);
  process.exitCode = 1;

} finally {
  await pool.end();
}
