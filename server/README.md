# Server

Local **Node.js + Fastify** server (JavaScript, ES modules). It receives uploads, keeps a job queue in SQLite, runs the Python engine (`../engine/enhance_long.py`) one job at a time, and streams progress to the UI with Server-Sent Events.

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
├── waveform.js       1000-point waveform peaks via ffmpeg, cached as JSON
├── static.js         file streaming with Range/HEAD; serves web/dist in production
├── share.js          secret link, signed cookie, 404 for everyone else
└── routes/
    ├── jobs.js       list, upload (multipart), pause / resume / cancel / delete
    ├── audio.js      original / result audio (Range, ?download=1) and waveform
    └── system.js     health, config, events
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
```

## Running

From the repository root:

```bash
npm run dev:server   # server only, restarts when server/ changes
npm start            # build the UI + serve everything on :3000
npm run share        # same, plus the guest port (3001) and the Cloudflare tunnel
```

Useful for testing: `PYTHON`, `ENGINE_PATH` (a different engine script), `STOP_GRACE_MS`, `STOP_TERM_MS`, `HEALTH_INTERVAL_MS`, `SHARE_PORT`, plus the variables in the main README.
