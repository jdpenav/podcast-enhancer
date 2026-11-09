// Persistencia de trabajos con better-sqlite3 (síncrono: simple y sin carreras).
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { DATA_DIR, DB_PATH, JOBS_DIR } from './config.js'

fs.mkdirSync(JOBS_DIR, { recursive: true })
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id            TEXT PRIMARY KEY,
    filename      TEXT NOT NULL,
    ext           TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL,
    duration_sec  REAL NOT NULL,
    mode          TEXT NOT NULL,
    quality       TEXT,
    status        TEXT NOT NULL,
    progress      TEXT,
    estimated_sec REAL,
    created_at    TEXT NOT NULL,
    started_at    TEXT,
    finished_at   TEXT,
    error         TEXT,
    pid           INTEGER,             -- PID del motor mientras corre (para recuperar huérfanos)
    active_sec    REAL NOT NULL DEFAULT 0  -- segundos reales de proceso acumulados (calibración)
  );
  CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
`)
// Migración: dueño del trabajo ('local' = el usuario de la laptop; si no, id del invitado)
if (!db.prepare('PRAGMA table_info(jobs)').all().some((c) => c.name === 'owner')) {
  db.exec("ALTER TABLE jobs ADD COLUMN owner TEXT NOT NULL DEFAULT 'local'")
}

// camelCase (código) ↔ snake_case (SQL)
const COLS = {
  id: 'id', filename: 'filename', ext: 'ext', sizeBytes: 'size_bytes', durationSec: 'duration_sec',
  mode: 'mode', quality: 'quality', status: 'status', progress: 'progress', estimatedSec: 'estimated_sec',
  createdAt: 'created_at', startedAt: 'started_at', finishedAt: 'finished_at', error: 'error',
  pid: 'pid', activeSec: 'active_sec', owner: 'owner',
}
const JSON_COLS = new Set(['progress', 'error'])

function fromRow(r) {
  if (!r) return null
  const job = {}
  for (const [k, c] of Object.entries(COLS)) job[k] = JSON_COLS.has(k) && r[c] != null ? JSON.parse(r[c]) : r[c]
  return job
}

function toParams(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in COLS)) continue
    out[k] = JSON_COLS.has(k) && v != null ? JSON.stringify(v) : v
  }
  return out
}

const stmts = {
  get: db.prepare('SELECT * FROM jobs WHERE id = ?'),
  list: db.prepare('SELECT * FROM jobs ORDER BY created_at DESC'),
  nextPending: db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"),
  byStatus: db.prepare('SELECT * FROM jobs WHERE status = ?'),
  withPid: db.prepare('SELECT * FROM jobs WHERE pid IS NOT NULL'),
  del: db.prepare('DELETE FROM jobs WHERE id = ?'),
  activeByOwner: db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE owner = ? AND status IN ('pending', 'processing', 'paused')"),
  calib: db.prepare(`
    SELECT active_sec / duration_sec AS ratio FROM jobs
    WHERE status = 'done' AND mode = ? AND IFNULL(quality, '') = IFNULL(?, '')
      AND duration_sec >= ? AND active_sec > 0
    ORDER BY finished_at DESC LIMIT ?`),
}

export function insertJob(job) {
  const p = toParams(job)
  const keys = Object.keys(p)
  db.prepare(`INSERT INTO jobs (${keys.map((k) => COLS[k]).join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(p)
  return getJob(job.id)
}

export const getJob = (id) => fromRow(stmts.get.get(id))
export const listJobs = () => stmts.list.all().map(fromRow)
export const nextPending = () => fromRow(stmts.nextPending.get())
export const jobsByStatus = (s) => stmts.byStatus.all(s).map(fromRow)
export const jobsWithPid = () => stmts.withPid.all().map(fromRow)
export const deleteJobRow = (id) => stmts.del.run(id)
export const activeCountByOwner = (owner) => stmts.activeByOwner.get(owner).n

/** Actualiza campos (parcial) y devuelve el trabajo actualizado. */
export function updateJob(id, patch) {
  const p = toParams(patch)
  const keys = Object.keys(p)
  if (keys.length) db.prepare(`UPDATE jobs SET ${keys.map((k) => `${COLS[k]} = @${k}`).join(', ')} WHERE id = @id`).run({ ...p, id })
  return getJob(id)
}

export function calibrationRatios(mode, quality, minDuration, limit) {
  return stmts.calib.all(mode, quality ?? null, minDuration, limit).map((r) => r.ratio)
}

export function closeDb() {
  db.close()
}

export { DATA_DIR }
