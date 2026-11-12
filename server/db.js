// Persistencia con better-sqlite3 (síncrono: simple y sin carreras).
// Tablas: workspaces (espacios), jobs (cola de la GPU), episodes (biblioteca), assets (cortinas), settings.
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { ASSETS_DIR, DATA_DIR, DB_PATH, EPISODES_DIR, JOBS_DIR } from './config.js'

for (const d of [JOBS_DIR, EPISODES_DIR, ASSETS_DIR]) fs.mkdirSync(d, { recursive: true })
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

  -- Biblioteca: cada audio (stream de YouTube o subida manual) con su recorrido completo
  CREATE TABLE IF NOT EXISTS episodes (
    id             TEXT PRIMARY KEY,   -- yt_<videoId> (YouTube) · e_xxxxxx (subida)
    source         TEXT NOT NULL,      -- 'youtube' | 'upload'
    youtube_id     TEXT UNIQUE,
    owner          TEXT,               -- NULL = compartido (YouTube); 'local' o id de invitado (subidas)
    title          TEXT NOT NULL,
    published_at   TEXT,
    duration_sec   REAL,
    thumbnail_url  TEXT,
    position       INTEGER,            -- orden en la pestaña /streams (0 = más reciente)
    status         TEXT NOT NULL,
    source_ext     TEXT,               -- extensión del audio descargado/subido
    job_id         TEXT,               -- último trabajo de mejora
    enhance        TEXT,               -- JSON { mode, quality } de la mejora vigente
    edit_state     TEXT,               -- JSON { cuts, introId, outroId, preset }
    export_info    TEXT,               -- JSON con el resumen de la última exportación
    progress       TEXT,               -- JSON (descarga / exportación en curso)
    retry          TEXT,               -- JSON { attempts, nextAt, giveUpAt, lastAttemptAt }
    error          TEXT,               -- JSON { code, message, step }
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS episodes_status ON episodes(status);

  -- Cortinas (intro/outro)
  CREATE TABLE IF NOT EXISTS assets (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    filename      TEXT NOT NULL,
    ext           TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL,
    duration_sec  REAL NOT NULL,
    created_at    TEXT NOT NULL
  );

  -- Espacios: un canal / congregación con su biblioteca, cortinas y nombre de podcast
  CREATE TABLE IF NOT EXISTS workspaces (
    id              TEXT PRIMARY KEY,   -- w_xxxxxx
    name            TEXT NOT NULL,
    podcast_name    TEXT,
    channel_id      TEXT UNIQUE,        -- UC… (NULL = sin canal todavía)
    channel_title   TEXT,
    channel_handle  TEXT,
    channel_avatar  TEXT,
    streams_url     TEXT,
    settings        TEXT,               -- JSON { curtainDefaults: { introId, outroId } }
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`)
// Migraciones
const jobCols = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name)
// dueño del trabajo ('local' = el usuario de la laptop; si no, id del invitado)
if (!jobCols.includes('owner')) db.exec("ALTER TABLE jobs ADD COLUMN owner TEXT NOT NULL DEFAULT 'local'")
// episodio de la biblioteca al que pertenece el trabajo
if (!jobCols.includes('episode_id')) db.exec('ALTER TABLE jobs ADD COLUMN episode_id TEXT')
// espacio de cada cosa (NULL solo antes de la migración de workspaces.js)
for (const t of ['jobs', 'episodes', 'assets']) {
  if (!db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'workspace_id')) db.exec(`ALTER TABLE ${t} ADD COLUMN workspace_id TEXT`)
}
db.exec('CREATE INDEX IF NOT EXISTS episodes_workspace ON episodes(workspace_id)')

/**
 * Mapeo camelCase (código) ↔ snake_case (SQL) para una tabla.
 * Las columnas JSON se (de)serializan solas.
 */
function table(name, cols, jsonCols = []) {
  const json = new Set(jsonCols)
  const fromRow = (r) => {
    if (!r) return null
    const o = {}
    for (const [k, c] of Object.entries(cols)) o[k] = json.has(k) && r[c] != null ? JSON.parse(r[c]) : r[c]
    return o
  }
  const toParams = (obj) => {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in cols) || v === undefined) continue
      out[k] = json.has(k) && v != null ? JSON.stringify(v) : v
    }
    return out
  }
  const get = db.prepare(`SELECT * FROM ${name} WHERE id = ?`)
  return {
    fromRow,
    get: (id) => fromRow(get.get(id)),
    insert(obj) {
      const p = toParams(obj)
      const keys = Object.keys(p)
      db.prepare(`INSERT INTO ${name} (${keys.map((k) => cols[k]).join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(p)
      return fromRow(get.get(obj.id))
    },
    update(id, patch) {
      const p = toParams(patch)
      const keys = Object.keys(p)
      if (keys.length) db.prepare(`UPDATE ${name} SET ${keys.map((k) => `${cols[k]} = @${k}`).join(', ')} WHERE id = @id`).run({ ...p, id })
      return fromRow(get.get(id))
    },
    del: (id) => db.prepare(`DELETE FROM ${name} WHERE id = ?`).run(id),
  }
}

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------
const jobs = table(
  'jobs',
  {
    id: 'id', filename: 'filename', ext: 'ext', sizeBytes: 'size_bytes', durationSec: 'duration_sec',
    mode: 'mode', quality: 'quality', status: 'status', progress: 'progress', estimatedSec: 'estimated_sec',
    createdAt: 'created_at', startedAt: 'started_at', finishedAt: 'finished_at', error: 'error',
    pid: 'pid', activeSec: 'active_sec', owner: 'owner', episodeId: 'episode_id', workspaceId: 'workspace_id',
  },
  ['progress', 'error'],
)

const jobStmts = {
  list: db.prepare('SELECT * FROM jobs ORDER BY created_at DESC'),
  nextPending: db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"),
  byStatus: db.prepare('SELECT * FROM jobs WHERE status = ?'),
  withPid: db.prepare('SELECT * FROM jobs WHERE pid IS NOT NULL'),
  byEpisode: db.prepare('SELECT * FROM jobs WHERE episode_id = ? ORDER BY created_at DESC'),
  withoutEpisode: db.prepare("SELECT * FROM jobs WHERE episode_id IS NULL AND status != 'canceled' ORDER BY created_at ASC"),
  activeByOwner: db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE owner = ? AND status IN ('pending', 'processing', 'paused')"),
  calib: db.prepare(`
    SELECT active_sec / duration_sec AS ratio FROM jobs
    WHERE status = 'done' AND mode = ? AND IFNULL(quality, '') = IFNULL(?, '')
      AND duration_sec >= ? AND active_sec > 0
    ORDER BY finished_at DESC LIMIT ?`),
}

export const insertJob = (job) => jobs.insert(job)
export const getJob = (id) => jobs.get(id)
export const listJobs = () => jobStmts.list.all().map(jobs.fromRow)
export const nextPending = () => jobs.fromRow(jobStmts.nextPending.get())
export const jobsByStatus = (s) => jobStmts.byStatus.all(s).map(jobs.fromRow)
export const jobsWithPid = () => jobStmts.withPid.all().map(jobs.fromRow)
export const jobsByEpisode = (episodeId) => jobStmts.byEpisode.all(episodeId).map(jobs.fromRow)
export const jobsWithoutEpisode = () => jobStmts.withoutEpisode.all().map(jobs.fromRow)
export const deleteJobRow = (id) => jobs.del(id)
export const activeCountByOwner = (owner) => jobStmts.activeByOwner.get(owner).n
/** Actualiza campos (parcial) y devuelve el trabajo actualizado. */
export const updateJob = (id, patch) => jobs.update(id, patch)

export function calibrationRatios(mode, quality, minDuration, limit) {
  return jobStmts.calib.all(mode, quality ?? null, minDuration, limit).map((r) => r.ratio)
}

// ---------------------------------------------------------------------------
// episodes
// ---------------------------------------------------------------------------
const episodes = table(
  'episodes',
  {
    id: 'id', source: 'source', youtubeId: 'youtube_id', owner: 'owner', title: 'title', publishedAt: 'published_at',
    durationSec: 'duration_sec', thumbnailUrl: 'thumbnail_url', position: 'position', status: 'status',
    sourceExt: 'source_ext', jobId: 'job_id', enhance: 'enhance', editState: 'edit_state', exportInfo: 'export_info',
    progress: 'progress', retry: 'retry', error: 'error', createdAt: 'created_at', updatedAt: 'updated_at',
    workspaceId: 'workspace_id',
  },
  ['enhance', 'editState', 'exportInfo', 'progress', 'retry', 'error'],
)

const epStmts = {
  // Más recientes primero; los que no tienen fecha, por su orden en el canal
  list: db.prepare(`
    SELECT * FROM episodes
    ORDER BY COALESCE(published_at, created_at) DESC, IFNULL(position, 1e9) ASC`),
  byYoutube: db.prepare('SELECT * FROM episodes WHERE youtube_id = ?'),
  byStatus: db.prepare('SELECT * FROM episodes WHERE status = ? ORDER BY updated_at ASC'),
  byWorkspace: db.prepare(`
    SELECT * FROM episodes WHERE workspace_id = ?
    ORDER BY COALESCE(published_at, created_at) DESC, IFNULL(position, 1e9) ASC`),
}

export const insertEpisode = (ep) => episodes.insert(ep)
export const getEpisode = (id) => episodes.get(id)
export const updateEpisodeRow = (id, patch) => episodes.update(id, { ...patch, updatedAt: new Date().toISOString() })
export const deleteEpisodeRow = (id) => episodes.del(id)
export const listEpisodes = () => epStmts.list.all().map(episodes.fromRow)
export const episodeByYoutubeId = (yid) => episodes.fromRow(epStmts.byYoutube.get(yid))
export const episodesByStatus = (s) => epStmts.byStatus.all(s).map(episodes.fromRow)
export const episodesByWorkspace = (wsId) => epStmts.byWorkspace.all(wsId).map(episodes.fromRow)
export const transaction = (fn) => db.transaction(fn)

// ---------------------------------------------------------------------------
// assets (cortinas)
// ---------------------------------------------------------------------------
const assets = table('assets', {
  id: 'id', name: 'name', filename: 'filename', ext: 'ext', sizeBytes: 'size_bytes', durationSec: 'duration_sec', createdAt: 'created_at',
  workspaceId: 'workspace_id',
})
const listAssetsStmt = db.prepare('SELECT * FROM assets WHERE workspace_id = ? ORDER BY created_at DESC')
export const insertAsset = (a) => assets.insert(a)
export const getAsset = (id) => assets.get(id)
export const updateAsset = (id, patch) => assets.update(id, patch)
export const deleteAssetRow = (id) => assets.del(id)
export const listAssets = (wsId) => listAssetsStmt.all(wsId).map(assets.fromRow)

// ---------------------------------------------------------------------------
// workspaces
// ---------------------------------------------------------------------------
const workspaces = table(
  'workspaces',
  {
    id: 'id', name: 'name', podcastName: 'podcast_name', channelId: 'channel_id', channelTitle: 'channel_title',
    channelHandle: 'channel_handle', channelAvatar: 'channel_avatar', streamsUrl: 'streams_url', settings: 'settings',
    createdAt: 'created_at', updatedAt: 'updated_at',
  },
  ['settings'],
)
const wsStmts = {
  list: db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC, id ASC'),
  byChannel: db.prepare('SELECT * FROM workspaces WHERE channel_id = ?'),
  counts: db.prepare(`
    SELECT workspace_id AS ws, COUNT(*) AS episodes,
           SUM(CASE WHEN source = 'youtube' THEN 1 ELSE 0 END) AS youtube,
           SUM(CASE WHEN source_ext IS NOT NULL THEN 1 ELSE 0 END) AS withAudio,
           SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready
    FROM episodes GROUP BY workspace_id`),
  assignAll: {
    episodes: db.prepare('UPDATE episodes SET workspace_id = ? WHERE workspace_id IS NULL'),
    assets: db.prepare('UPDATE assets SET workspace_id = ? WHERE workspace_id IS NULL'),
    jobs: db.prepare('UPDATE jobs SET workspace_id = ? WHERE workspace_id IS NULL'),
  },
  moveJobs: db.prepare('UPDATE jobs SET workspace_id = ? WHERE workspace_id = ?'),
  deleteBare: db.prepare("DELETE FROM episodes WHERE workspace_id = ? AND source_ext IS NULL AND status IN ('discovered', 'error', 'youtube_processing')"),
}
export const insertWorkspace = (w) => workspaces.insert(w)
export const getWorkspace = (id) => workspaces.get(id)
export const updateWorkspaceRow = (id, patch) => workspaces.update(id, { ...patch, updatedAt: new Date().toISOString() })
export const deleteWorkspaceRow = (id) => workspaces.del(id)
export const listWorkspaces = () => wsStmts.list.all().map(workspaces.fromRow)
export const workspaceByChannel = (channelId) => workspaces.fromRow(wsStmts.byChannel.get(channelId))
/** Conteos por espacio: Map(wsId → { episodes, youtube, withAudio, ready }). */
export const workspaceCounts = () =>
  new Map(wsStmts.counts.all().map((r) => [r.ws, { episodes: r.episodes, youtube: r.youtube ?? 0, withAudio: r.withAudio ?? 0, ready: r.ready ?? 0 }]))
/** Migración: todo lo que no tiene espacio pasa a `wsId`. Devuelve cuántas filas se movieron por tabla. */
export const assignOrphansTo = (wsId) =>
  transaction(() => Object.fromEntries(Object.entries(wsStmts.assignAll).map(([t, st]) => [t, st.run(wsId).changes])))()
export const moveJobsToWorkspace = (fromId, toId) => wsStmts.moveJobs.run(toId, fromId).changes
/** Borra los episodios del espacio que solo están listados (sin audio). */
export const deleteBareEpisodes = (wsId) => wsStmts.deleteBare.run(wsId).changes

// ---------------------------------------------------------------------------
// settings (clave → JSON)
// ---------------------------------------------------------------------------
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
const setSettingStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
export function getSetting(key, fallback = null) {
  const r = getSettingStmt.get(key)
  return r ? JSON.parse(r.value) : fallback
}
export const setSetting = (key, value) => setSettingStmt.run(key, JSON.stringify(value))

export function closeDb() {
  db.close()
}

export { DATA_DIR }
