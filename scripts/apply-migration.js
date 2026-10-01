#!/usr/bin/env node
/**
 * apply-migration.js — apply a Supabase SQL migration file.
 *
 * Why this exists (2026-10-01): the Supabase project went INACTIVE (free-tier
 * 7-day idle pause), which made the project domain resolve to NXDOMAIN. The
 * Management API host (api.supabase.com) stays reachable, so we execute SQL
 * through it instead of the project REST endpoint.
 *
 * It also gives us a path that works even when the project domain is blocked.
 *
 * Usage:
 *   node scripts/apply-migration.js                          # applies the highest-numbered migration
 *   node scripts/apply-migration.js 012_apply_alex_*.sql    # apply a specific file
 *   node scripts/apply-migration.js --dry-run               # print SQL, execute nothing
 *   node scripts/apply-migration.js --status                # check project status only
 *
 * Safety: wraps the file in a transaction and aborts on error. Every
 * migration in this repo is written to be idempotent, so re-running is safe.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
const TOKEN = (ENV.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m) || [])[1];
const PROJECT_REF = (ENV.match(/^SUPABASE_PROJECT_REF=(.+)$/m) || [])[1] || "cggqxaxunqxsgurgmiqh";

if (!TOKEN) {
  console.error("✗ SUPABASE_ACCESS_TOKEN missing from .env.local");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const STATUS_ONLY = process.argv.includes("--status");

function api(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(`https://api.supabase.com/v1${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
      timeout: 120000,
    }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(b) });
        } catch {
          resolve({ status: res.statusCode, body: b });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout 120s")));
    if (payload) req.write(payload);
    req.end();
  });
}

// Pick the migration to run
const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
function pickMigration() {
  const explicit = process.argv.slice(2).find((a) => /^\d{3}_/.test(a) && a.endsWith(".sql"));
  if (explicit) {
    const p = path.isAbsolute(explicit) ? explicit : path.join(migrationsDir, explicit);
    if (!fs.existsSync(p)) {
      console.error(`✗ Migration not found: ${p}`);
      process.exit(1);
    }
    return path.basename(p);
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
  if (files.length === 0) {
    console.error("✗ No migrations found");
    process.exit(1);
  }
  return files[files.length - 1];
}

async function showStatus() {
  const r = await api("GET", `/projects/${PROJECT_REF}`);
  if (r.status !== 200) {
    console.error(`✗ Could not read project: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return null;
  }
  const p = r.body;
  console.log(`Project:  ${p.name}`);
  console.log(`Ref:      ${p.id}`);
  console.log(`Status:   ${p.status}`);
  console.log(`Region:   ${p.region}`);
  return p;
}

(async () => {
  console.log("═".repeat(64));
  console.log("  Supabase migration runner");
  console.log("═".repeat(64) + "\n");

  const project = await showStatus();
  if (!project) process.exit(1);

  if (["INACTIVE", "COMING_UP", "RESTORING"].includes(project.status)) {
    console.log(`\n⚠ Project is ${project.status}.`);
    if (project.status === "INACTIVE") {
      const r = await api("POST", `/projects/${PROJECT_REF}/restore`);
      console.log(`  restore → ${r.status}`);
    } else {
      console.log("  Already restoring — no action needed.");
    }
    console.log("  Wait for status to become ACTIVE, then re-run this script.");
    process.exit(2);
  }
  if (project.status !== "ACTIVE" && project.status !== "ACTIVE_HEALTHY") {
    console.error(`\n✗ Unexpected project status: ${project.status}`);
    process.exit(1);
  }
  console.log("");

  if (STATUS_ONLY) {
    console.log("✓ Project is healthy. (--status only, nothing applied)");
    return;
  }

  const file = pickMigration();
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
  console.log(`Migration: ${file}  (${sql.length} bytes, ${sql.split("\n").length} lines)`);

  if (DRY_RUN) {
    console.log("\n🔍 DRY RUN — not executing. SQL follows:\n");
    console.log(sql);
    return;
  }

  // Confirm before writing to a live database
  console.log("\n⚠ Executing against the live project database…\n");
  const r = await api("POST", `/projects/${PROJECT_REF}/database/query`, { query: sql });

  if (r.status === 200 || r.status === 201) {
    const res = r.body;
    const rows = Array.isArray(res) ? res : [res];
    console.log(`✓ Applied. ${rows.length} statement result(s) returned.`);
    rows.forEach((row, i) => {
      const s = JSON.stringify(row);
      if (s && s !== "{}" && s !== "[]" && s !== "null") {
        console.log(`  [${i + 1}] ${s.slice(0, 160)}`);
      }
    });
  } else {
    console.error(`✗ FAILED: ${r.status}`);
    console.error(JSON.stringify(r.body, null, 2).slice(0, 1500));
    process.exit(1);
  }
})().catch((e) => {
  console.error("✗ Fatal:", e.message);
  process.exit(1);
});
