# API contract

The single source of truth between the UI (`web/`) and the server (`server/`). Any change starts here.

- Server: `http://localhost:3000`. Every route lives under `/api`.
- In development, Vite (port 5173) proxies `/api` to `http://localhost:3000`.
- With `npm run share`, a **guest port** (`127.0.0.1:3001`, behind Cloudflare Tunnel) serves the same routes, with the differences listed in [Guest access](#guest-access).
- JSON uses camelCase. Durations are in **seconds** (numbers). Dates are ISO 8601.
- User-facing strings (`label`, `description`, `message`) are in Spanish, like the UI.

---

## `Job`

```json
{
  "id": "j_8f3a2c",
  "filename": "Podcast - Episodio 12.mp3",
  "sizeBytes": 31701737,
  "durationSec": 3395.03,
  "mode": "denoise",
  "quality": null,
  "status": "processing",
  "progress": {
    "percent": 42.9,
    "done": 12,
    "total": 28,
    "elapsedSec": 1490.2,
    "etaSec": 1980.5,
    "stage": "processing"
  },
  "estimatedSec": 3400,
  "createdAt": "2026-11-09T04:51:17.000Z",
  "startedAt": "2026-11-09T04:51:20.000Z",
  "finishedAt": null,
  "error": null,
  "outputs": null,
  "guest": null
}
```

| Field | Values |
|---|---|
| `mode` | `"denoise"` (noise removal only) · `"enhance"` (full enhancement) |
| `quality` | `null` when `mode` is `denoise` · `"standard"` (nfe 32) · `"max"` (nfe 64) |
| `status` | `"pending"` · `"processing"` · `"paused"` · `"done"` · `"error"` · `"canceled"` |
| `progress` | `null` while `pending` and never started |
| `progress.stage` | `"decoding"` (preparing the audio with ffmpeg) · `"processing"` (chunks on the GPU; `percent`, `done`, `total` and `etaSec` apply) · `"merging"` (joining chunks, exporting MP3/WAV). Optional: when missing, the UI assumes `"processing"` |
| `error` | `null` or `{ "code": "GPU_OOM" \| "FFMPEG_MISSING" \| "INVALID_FILE" \| "ENGINE_FAILED", "message": "..." }` |
| `outputs` | `null` until `done`; then `{ "mp3": "/api/jobs/j_8f3a2c/audio/result.mp3", "wav": "/api/jobs/j_8f3a2c/audio/result.wav" }` |
| `guest` | `null` for jobs uploaded by the owner · a short guest id (e.g. `"k7m2qx"`) for jobs uploaded through the shared link |

**`status: "done"` is only sent once both `outputs.mp3` and `outputs.wav` exist and can be downloaded.**

---

## Endpoints

### `GET /api/health`

System status, used by the header indicator.

```json
{ "ok": true, "ffmpeg": true, "gpu": { "name": "NVIDIA GeForce RTX 3060", "vramGB": 12, "tempC": 62, "busy": false } }
```

`gpu` is `null` when there is no NVIDIA GPU (CPU mode). For guests, `gpu.tempC` is always `null`.

### `GET /api/config`

Modes and time factors, so the UI can estimate processing time before uploading: `estimatedSec = durationSec × factor`.

```json
{
  "modes": [
    { "mode": "denoise", "quality": null, "label": "Limpiar ruido", "description": "Quita el ruido de fondo. Rápido.", "factor": 0.06 },
    { "mode": "enhance", "quality": "standard", "label": "Mejora completa · Estándar", "description": "Voz tipo estudio. Buen balance.", "factor": 0.68 },
    { "mode": "enhance", "quality": "max", "label": "Mejora completa · Máxima", "description": "La mejor calidad. Más lento.", "factor": 1.02 }
  ],
  "maxUploadMB": 500,
  "acceptedTypes": [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".mp4"],
  "role": "owner"
}
```

- `role` is `"owner"` on port 3000, or `"guest"` on the guest port, where `maxUploadMB` is `95`.
- Factors start from values measured on a 4 GB GPU, and the server recalibrates them from finished jobs.

### `POST /api/jobs`

`multipart/form-data` with the fields `mode`, `quality` (omit for denoise) and `file`. Send the fields **before** the file, so the server can validate them before receiving the upload.

→ `201` with the new `Job` (`status: "pending"`).

### `GET /api/jobs`

→ `200` with `Job[]`, newest first (`createdAt` descending).

### `GET /api/jobs/:id`

→ `200` with the `Job`, or `404`.

### `POST /api/jobs/:id/pause`

Only when `processing`. Stops the engine; progress is kept. → `200` with the `Job` (`paused`).

### `POST /api/jobs/:id/resume`

Only when `paused` or `error`. Re-queues the job, which continues where it left off. → `200` with the `Job` (`pending`).

### `POST /api/jobs/:id/cancel`

When `pending`, `processing` or `paused`. Deletes partial files. → `200` with the `Job` (`canceled`).

### `DELETE /api/jobs/:id`

Deletes the job and all its files (upload and results). Not allowed while `processing`. → `204`.

### `GET /api/jobs/:id/audio/original` · `/audio/result.mp3` · `/audio/result.wav`

Audio streaming with `Range` support (for seeking in the player). `HEAD` is supported too.
`?download=1` adds `Content-Disposition: attachment` with the name `<original name>_mejorado.<ext>`.

### `GET /api/jobs/:id/waveform?which=original|result`

Precomputed peaks for drawing the waveform, so the browser never decodes an hour of audio.

```json
{ "peaks": [0.02, 0.31, 0.27, ...], "durationSec": 3395.03 }
```

`peaks` holds 1000 values between 0 and 1.

### `GET /api/events` (Server-Sent Events)

One stream for the whole dashboard. Each message has an `event:` and a JSON `data:` line.

| Event | Data |
|---|---|
| `job` | The full `Job`, when it's created or changes status |
| `progress` | `{ "id": "j_8f3a2c", "progress": { ... } }`, after every processed group and every stage change |
| `deleted` | `{ "id": "j_8f3a2c" }` |
| `health` | Same as `GET /api/health`: once on connect, then every ~10 s |

A `: ping` comment is sent every 15 s to keep proxies from closing the connection. Clients should reconnect automatically (`EventSource` does).

---

## Errors

Every error uses the same shape:

```json
{ "error": { "code": "INVALID_FILE", "message": "El archivo no es un audio válido o está dañado." } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_FILE` | Unsupported extension, or not a valid audio file (checked with ffprobe) |
| 400 | `INVALID_REQUEST` | Invalid `mode`, `quality` or `which` |
| 400 | `UPLOAD_FAILED` | The upload was interrupted |
| 404 | `NOT_FOUND` | Unknown job or route |
| 404 | `NOT_READY` | Result audio or waveform requested before the job is `done` |
| 409 | `CONFLICT` | Action not allowed in the current status (e.g. pausing a paused job) |
| 413 | `TOO_LARGE` | Larger than `maxUploadMB` |
| 429 | `TOO_MANY_JOBS` | A guest with 2 active jobs (`pending`, `processing` or `paused`) tries to upload or retry another |
| 500 | `FFMPEG_MISSING` | ffmpeg or ffprobe is not installed on the server |
| 500 | `WAVEFORM_FAILED` | The waveform couldn't be computed |
| 507 | `DISK_FULL` | Not enough free disk space (~1.5 GB per hour of audio) |

### Behavior notes

- Pausing or canceling a running job **waits** for the engine to stop (usually under 10 s) before responding.
- Only one engine runs at a time. If an engine started outside the app is using the GPU, the queue waits and `health.gpu.busy` is `true`.
- If the server restarts or crashes during a job, that job becomes `paused` and resumes without losing progress.

---

## Guest access

Only exists while `npm run share` is running. Port 3000 behaves exactly as above and sees **every** job, with the `guest` field identifying guest uploads.

### Secret link

- `GET <any path>?k=KEY` with the correct key (`SHARE_KEY` in `.env`) → `302` to the same path without `?k=`, setting an `HttpOnly; Secure; SameSite=Lax` cookie valid for 90 days. The cookie is renewed whenever the page is opened.
- Without a valid key or cookie, **every** path (page, `/api/*`, static files) answers `404` with a plain-text `Not Found` body. The JSON error shape is not used, so nothing reveals that an app is there.
- Changing `SHARE_KEY` (`npm run share:rotate`) invalidates every previous link and cookie.

### What a guest sees

- Job lists, job details, actions, audio, waveforms and SSE events include **only that guest's jobs**. Another guest's job id answers `404 NOT_FOUND`, the same as an id that doesn't exist.
- `GET /api/config` returns `"role": "guest"` and `"maxUploadMB": 95`, because Cloudflare's free plan rejects requests over 100 MB. The `413 TOO_LARGE` message suggests uploading an MP3.
- At most 2 active jobs per guest (`429 TOO_MANY_JOBS`).
- `health.gpu.tempC` is `null`.
- Responses are sent as `Cache-Control: private`, so Cloudflare never caches them.
- There is still a single queue: owner and guest jobs run in order of arrival.
