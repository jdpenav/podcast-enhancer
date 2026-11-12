# Server

Local **Node.js + Fastify** server (JavaScript, ES modules). It receives uploads, keeps a job queue in SQLite, runs the Python engine (`../engine/enhance_long.py`) one job at a time, and streams progress to the UI with Server-Sent Events.

It also runs the **library**: it syncs each workspace's YouTube channel, downloads stream audio with yt-dlp, links every audio to its enhancement job, stores the editor state, and exports the final MP3 for Castbox with ffmpeg.

**Workspaces** (`workspaces.js`) group everything that belongs to one channel or congregation: its channel, episodes, curtains, podcast name and default curtains. They're a `workspace_id` column on `episodes`, `assets` and `jobs`; files stay where they are. There's always at least one. On startup, `ensureWorkspaces()` creates the first one if needed (with `YT_CHANNEL_ID` from `.env`, for older installs) and assigns it everything that has no workspace yet. Requests that don't say which workspace use the default (oldest) one.

- HTTP contract: [`../docs/API.md`](../docs/API.md)
- Guest access (`npm run share`): [`../docs/sharing.md`](../docs/sharing.md)

## Architecture

```
browser ──HTTP / SSE──▶ Fastify (server/) ──spawn──▶ venv/bin/python engine/enhance_long.py
                              │                                │
                      SQLite (data/jobs.db)            stdout: "@@{json}" lines
```

The server never touches the GPU itself. It starts the engine as a **child process** in its own process group and reads its events line by line.

With `--share`, the same process runs two Fastify apps that share the routes, the queue and the database:

| App | Listens on | Access |
|---|---|---|
| Owner | `localhost:3000` | Full |
| Guests | `127.0.0.1:3001` (only `cloudflared` reaches it) | Secret link `?k=` → signed cookie; otherwise a plain-text `404`. Each guest sees only their own jobs, with at most 2 active and 95 MB per upload |

## Stack

- `fastify` 5 and `@fastify/multipart`: uploads stream to disk, not to memory.
- `better-sqlite3` (WAL mode) for the queue and history.
- `nanoid` for job ids (`j_xxxxxx`).
- Hand-written SSE, static files, `Range` streaming and cookie signing (HMAC): no extra dependencies.
- Node.js 20+.

## Two queues

| Queue | Runs | Concurrency |
|---|---|---|
| GPU (`queue.js`) | Enhancement jobs (Resemble Enhance) | 1, and never alongside an engine started by hand |
| Tasks (`tasks.js`) | Downloads (yt-dlp, network) and exports (ffmpeg, CPU) | 1, **in parallel** with the GPU queue |

A download never waits 40 min behind an enhancement, and the GPU still runs only one thing at a time. The tasks queue is persisted through the episode status (`downloading` / `exporting`): on startup those are queued again.

## Modules

```
server/
├── index.js          startup, error handling, recovery, graceful shutdown
├── config.js         paths, ports, modes and time factors, limits (all overridable via env)
├── db.js             SQLite schema, migrations and helpers
├── jobs.js           per-job file paths, API shape of a Job, time calibration
├── queue.js          job state machine and single-slot queue
├── engine.js         spawns the engine, parses @@json events, writes engine.log
├── procs.js          finds live engines through /proc, staged stop
├── events.js         SSE hub; each guest only receives events for their own jobs
├── health.js         ffmpeg + nvidia-smi checks (cached)
├── waveform.js       waveform peaks via ffmpeg (1000 points, or 20/s for the editor), cached as JSON
├── static.js         file streaming with Range/HEAD; serves web/dist in production
├── share.js          secret link, signed cookie, 404 for everyone else
├── workspaces.js     workspaces: API shape, first-start migration, create/edit/delete, channel resolution, default curtains
├── episodes.js       Episode model: file paths, API shape, visibility, SSE
├── library.js        episode lifecycle: downloads + VOD retry, jobs ↔ episodes, uploads, edit, export
├── tasks.js          non-GPU task queue (downloads, exports)
├── ytdlp.js          yt-dlp: locate, version/update, resolve a channel from any link, list a channel, metadata, download, errors
├── catalog.js        catalog sync per workspace: RSS + full /streams (or /videos) listing, upsert by video id
├── exporter.js       ffmpeg export: cuts + crossfades, curtains, two-pass loudnorm, MP3 CBR, ID3, checks
├── media.js          ffprobe, free disk, hard links
├── system.js         status for Settings (yt-dlp, ffmpeg, model, disk)
├── errors.js, log.js
└── routes/
    ├── jobs.js       list, upload (multipart) or from an episode (JSON), pause / resume / cancel / delete
    ├── audio.js      original / result audio (Range, ?download=1) and waveform
    ├── episodes.js   library: list, sync, download, retry, cancel, delete, audio, peaks, edit, export
    ├── assets.js     curtains (per workspace): upload, list, rename, delete, defaults, audio
    ├── workspaces.js list, resolve a channel link, create / edit / delete (owner only)
    └── system.js     health, config, events, system status, yt-dlp update
```

## Engine interface

```bash
venv/bin/python engine/enhance_long.py INPUT RESULT.wav --also-mp3 RESULT.mp3 \
  --mode denoise|enhance [--nfe 32|64] --work-dir DIR --cooldown SEC --parent-pid PID
```

The engine prints one `@@{json}` line per event:

| Event | When |
|---|---|
| `stage` | `decoding` → `processing` → `merging` |
| `start` | After decoding: `durationSec`, `total` groups and how many were already done |
| `progress` | Once per group: `done`, `total`, `percent`, `elapsed`, `eta` |
| `done` | WAV and MP3 written. Each is written to a temp file and renamed, so an existing file is always complete |
| `error` | `GPU_OOM`, `INVALID_FILE`, `FFMPEG_MISSING` or `ENGINE_FAILED`, with a user-facing message |

- **Pause:** on `SIGINT` the engine saves its progress and exits with code **130**. Running it again with the same arguments and `--work-dir` resumes.
- **Watchdog:** with `--parent-pid`, if the server dies the engine pauses itself and exits within ~2 s. No orphan processes are left on the GPU.
- Internal chunks are 6 s. Don't raise them on 4 GB GPUs.

## Job lifecycle

```
pending ──▶ processing ──▶ done
               │  ├──▶ paused ──▶ pending   (resume)
               │  ├──▶ error  ──▶ pending   (retry)
               │  └──▶ canceled
```

- **Upload:**
  1. Validates the extension and the mode.
  2. Streams the file to a `.part` file.
  3. Checks with `ffprobe` that it's audio.
  4. Checks free disk space.
  5. Renames the file into place.

  Any failure leaves nothing behind.
- **Queue:** takes the oldest `pending` job, unless another engine is already running (even one started by hand).
- **Pause / cancel:** staged stop: `SIGINT` (30 s) → `SIGTERM` to the process group (10 s) → `SIGKILL`. Cancel also deletes partial results.
- **Done:** only when the engine exited with code 0, emitted `done`, and both files exist. The result's waveform is computed afterwards.
- **Error:** the engine's last `error` event or, failing that, a summary of its last stderr lines.
- **On startup:** stops any engine left alive (by stored PID, or any engine working inside `data/jobs/`). Jobs left `processing` become `paused`. Orphan folders and temp files are removed.
- **Shutdown (Ctrl+C / SIGTERM):** pauses the running job before exiting.
- **Estimates:** `durationSec × factor`. The factor is the median of the last 5 finished jobs of 5 min or more in that mode, or the defaults in `config.js` until there are enough.

## Episode lifecycle

```
YouTube:  discovered ──download──▶ downloading ──▶ downloaded ──┐
                 ▲                      │                        │ POST /api/jobs { episodeId }
                 └── youtube_processing ◀┘ (not ready yet:       ▼
                     retry every 30 min, up to 12 h)         enhancing (a normal Job)
Upload:   the upload creates the episode and its Job ──────────▶     │ Job done: hard links
                                                                     ▼
                                    enhanced ──edit──▶ editing ──export──▶ exporting ──▶ ready
```

- **What can be done depends on the files** (`source`, `enhanced`, `final`), not only on the status: an export error still allows editing, and *Retry* continues from the failed step (`error.step`).
- **Hard links** share the audio between the episode and its jobs: no duplicated space, and deleting one doesn't delete the other.
- **Not-ready VOD:** after a live stream, YouTube takes up to ~12 h to process the recording, and yt-dlp answers *"This live stream recording is not available"*. That's the `youtube_processing` waiting state, not an error. The retry time comes from `VOD_RETRY_MIN` (30) and `VOD_RETRY_MAX_HOURS` (12).
- **Downloads:** `yt-dlp -f bestaudio` with **no conversion** (m4a/opus). The only lossy encoding is the final MP3.
- **Export:**
  1. Kept segments (outside the cuts), joined with a 20 ms crossfade.
  2. Intro and outro, everything normalized first to 44.1 kHz with the same channels.
  3. `loudnorm` measure pass, then apply in linear mode.
  4. `libmp3lame` CBR 128 kbps mono with ID3 tags.
  5. Final measurement with `ebur128`, plus size and duration checks.

  About 2–3 minutes for an hour of audio.
- **On first startup,** existing jobs get their episode once (hard links only), and everything goes into the first workspace.
- **A video belongs to one workspace:** a channel can only be connected to one workspace, and syncing never moves an episode between workspaces. A workspace's channel can't be changed once it has episodes from it.

## Files on disk

```
data/
├── jobs.db
└── jobs/<id>/
    ├── original.<ext>          copy of the upload (never modified)
    ├── result.wav
    ├── result.mp3
    ├── waveform-original.json
    ├── waveform-result.json
    ├── engine.log              full engine output
    └── work/                   engine partials (removed when the job ends)
data/
├── episodes/<id>/              yt_<videoId> or e_xxxxxx
│   ├── source.<ext>            downloaded (m4a/webm) or uploaded audio (hard link)
│   ├── enhanced.wav            enhanced audio for exporting (hard link to the job's result.wav)
│   ├── enhanced.mp3            for listening in the editor (hard link to result.mp3)
│   ├── peaks.json              editor peaks (20 per second)
│   ├── final.mp3               the MP3 for Castbox
│   └── descarga/               yt-dlp temporary output
└── assets/<id>.<ext>           curtains
tools/bin/yt-dlp                installed by npm run setup (not versioned)
```

## Running

From the repository root:

```bash
npm run dev:server   # server only, restarts when server/ changes
npm start            # build the UI + serve everything on :3000
npm run share        # same, plus the guest port (3001) and the Cloudflare tunnel
```

Useful for testing: `PYTHON`, `ENGINE_PATH` (a different engine script), `STOP_GRACE_MS`, `STOP_TERM_MS`, `HEALTH_INTERVAL_MS`, `SHARE_PORT`, `WEB_DIST` (a different UI build), plus the variables in the main README.

To try a change without touching the app you're running, use another port and a copy of the data, for example: `cp -al data /tmp/data-test && DATA_DIR=/tmp/data-test PORT=3100 node server/index.js` (`cp -al` creates hard links: instant and without duplicating space).
