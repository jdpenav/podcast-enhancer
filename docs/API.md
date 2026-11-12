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
  "guest": null,
  "episodeId": "e_k2m9qa"
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
| `episodeId` | The library episode this job enhances (see [`Episode`](#episode)). Every upload creates one; jobs created before the library existed get one the first time the new server starts. `null` if creating it failed or the uploaded episode was deleted |

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
  "role": "owner",
  "podcastName": "Mi podcast",
  "exportPreset": { "name": "castbox", "bitrateKbps": 128, "channels": 1, "sampleRate": 44100, "lufs": -16, "truePeak": -1, "cutCrossfadeMs": 20, "curtainFadeSec": 0 },
  "presetLimits": { "bitrateKbps": [64, 96, 128, 160, 192, 256, 320], "channels": [1, 2], "lufs": [-24, -12], "cutCrossfadeMs": [0, 200], "curtainFadeSec": [0, 5] }
}
```

- `role` is `"owner"` on port 3000, or `"guest"` on the guest port, where `maxUploadMB` is `95`.
- Factors start from values measured on a 4 GB GPU, and the server recalibrates them from finished jobs.

### `POST /api/jobs`

Two forms:

- **Upload:** `multipart/form-data` with the fields `mode`, `quality` (omit for denoise) and `file`. Send the fields **before** the file, so the server can validate them before receiving the upload. The upload also creates its `Episode` in the library (`source: "upload"`), linked through `episodeId`.
- **From the library:** JSON `{ "episodeId": "yt_dQw4w9WgXcQ", "mode": "enhance", "quality": "standard" }`. The episode must have its source audio (`files.source`). `409 CONFLICT` if it's already being enhanced, downloaded or exported.

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
| `episode` | The full `Episode`, when it's created or changes (status, files, edit state, export) |
| `episodeProgress` | `{ "id": "yt_…", "progress": { ... } }` during downloads and exports (~1–2 per second at most) |
| `episodeDeleted` | `{ "id": "e_…" }` when an uploaded episode is deleted |
| `library` | `{ "reason": "sync", "added": 3, "updated": 1 }` after a catalog sync: reload `GET /api/episodes` |

A `: ping` comment is sent every 15 s to keep proxies from closing the connection. Clients should reconnect automatically (`EventSource` does).

---

## Library

The library centralizes **every** audio: the streams from your YouTube channel (`YT_CHANNEL_ID` in `.env`) and manual uploads. From there an episode is enhanced (a normal `Job`), edited (cuts + intro/outro) and exported as the final MP3 for Castbox. Uploading to Castbox stays manual.

### `Episode`

```json
{
  "id": "yt_dQw4w9WgXcQ",
  "source": "youtube",
  "youtubeVideoId": "dQw4w9WgXcQ",
  "youtubeUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "title": "Episodio 47 · Directo del domingo",
  "publishedAt": "2026-11-09T06:51:45.000Z",
  "durationSec": 3395.03,
  "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
  "status": "editing",
  "progress": null,
  "retry": null,
  "error": null,
  "jobId": "j_18aa0q",
  "job": { "id": "j_18aa0q", "status": "done", "percent": 100, "stage": "processing" },
  "enhance": { "mode": "enhance", "quality": "standard" },
  "files": {
    "source": "/api/episodes/yt_dQw4w9WgXcQ/audio/source",
    "enhanced": "/api/episodes/yt_dQw4w9WgXcQ/audio/enhanced",
    "final": null
  },
  "editState": { "cuts": [{ "id": "c1", "start": 0, "end": 12.5 }], "introId": "a_i1e16r", "outroId": "a_snnn70", "preset": { "...": "see exportPreset" }, "savedAt": "…" },
  "export": null,
  "guest": null,
  "createdAt": "2026-11-11T23:18:35.000Z",
  "updatedAt": "2026-11-11T23:19:13.000Z"
}
```

| Field | Values |
|---|---|
| `id` | `yt_<videoId>` for YouTube · `e_xxxxxx` for uploads |
| `source` | `"youtube"` · `"upload"` |
| `status` | `"discovered"` (listed, no audio yet) · `"youtube_processing"` (the stream ended but YouTube is still processing it: **a waiting state, not an error**; see `retry`) · `"downloading"` (queued or downloading) · `"downloaded"` · `"enhancing"` (its `Job` is in the GPU queue) · `"enhanced"` · `"editing"` (has saved cuts/curtains) · `"exporting"` · `"ready"` (final MP3 available) · `"error"` |
| `progress` | `null`, or while `downloading`: `{ "stage": "queued" \| "checking" \| "downloading", "percent", "downloadedBytes", "totalBytes", "speedBps", "etaSec" }` (any of the numbers can be `null`); while `exporting`: `{ "stage": "queued" \| "measuring" \| "encoding" \| "validating", "percent" }` |
| `retry` | Only in `youtube_processing`: `{ "attempts", "firstAt", "lastAttemptAt", "nextAt", "giveUpAt", "intervalMin", "detail" }`. Retries every 30 min for up to 12 h (configurable on the server) |
| `error` | Only in `error`: `{ "code", "message", "step": "download" \| "enhance" \| "export" }`. Codes: `VIDEO_UNAVAILABLE` (private/deleted), `NOT_STARTED` (scheduled live that hasn't started), `VOD_TIMEOUT` (still processing after 12 h), `YTDLP_FAILED` (yt-dlp broken: update it), `YTDLP_BLOCKED`, `YTDLP_MISSING`, `NETWORK`, `DISK_FULL`, `INVALID_FILE`, the `Job` error codes for `enhance`, and `EXPORT_FAILED`, `ASSET_MISSING`, `FFMPEG_MISSING` for `export` |
| `job` | Summary of the latest enhancement `Job` (`null` if none). The full job is in `GET /api/jobs` for whoever owns it |
| `files` | Which audios exist. **What the UI offers depends on `files`, not only on `status`** (e.g. an `error` while exporting still allows editing) |
| `export` | Summary of the last export, or `null` (see below) |
| `guest` | Like `Job.guest`, for uploads made through the shared link |

`export`:

```json
{
  "exportedAt": "…", "durationSec": 3366.5, "expectedDurationSec": 3366.49, "sizeBytes": 53864735,
  "bitrateKbps": 128, "sampleRate": 44100, "channels": 1, "lufs": -16.5, "truePeak": -0.7, "inputLufs": -27.89,
  "removedSec": 42.5, "cuts": 2,
  "intro": { "id": "a_i1e16r", "name": "Intro del podcast", "durationSec": 8 }, "outro": null,
  "preset": { "...": "the preset used, to repeat an identical export" },
  "checks": { "sizeOk": true, "durationOk": true, "loudnessOk": true },
  "castboxOk": true
}
```

`lufs` and `truePeak` are measured on the final MP3. `castboxOk` = under Castbox's 400 MB and the duration matches what was expected.

### Visibility

YouTube episodes are shared: every visitor (owner and guests) sees them. Uploaded episodes follow the job rule: the owner sees all of them, and each guest sees only their own.

### `GET /api/episodes?status=&q=&source=`

→ `200` with `Episode[]`, newest first (`publishedAt`, then the channel order).

- `status`: one status, several separated by commas, or a group: `pending` (discovered) · `active` (youtube_processing, downloading, enhancing, exporting) · `editable` (downloaded, enhanced, editing) · `ready` · `error`.
- `q`: search in the title (case and accent insensitive).
- `source`: `youtube` · `upload`.

### `GET /api/episodes/:id` · `PATCH /api/episodes/:id`

`PATCH` body: `{ "title": "…" }` (used in the MP3's ID3 tags). → `200` with the `Episode`.

### `POST /api/episodes/sync`

Body (optional): `{ "full": true }`. Syncs the catalog: with `full` (default) it lists the whole `/streams` tab with yt-dlp (may take ~30 s), then refines recent dates with the RSS feed; with `full: false`, RSS only (the 15 most recent). Upsert by video id: it never duplicates and never touches the status or files of an existing episode. Scheduled lives that haven't started are skipped.

→ `200` with `{ "added": 3, "updated": 1, "total": 214, "full": true, "warnings": [] }`. `409 CHANNEL_NOT_CONFIGURED` if no channel is configured. Simultaneous calls share the same run. The server also checks the RSS every 3 h (`RSS_SYNC_HOURS`) to **detect** new streams; it never downloads or processes anything on its own.

### `POST /api/episodes/:id/download`

YouTube episodes without audio. Queues the download of the best audio track **as is** (m4a/opus, no conversion). → `200` with the `Episode` (`downloading`). Downloads and exports run one at a time, in their own queue, in parallel with the GPU queue.

### `POST /api/episodes/:id/retry`

- `youtube_processing`: "Retry now".
- `error`: continues from the failed `step` without redoing the previous ones (`download` downloads again, `enhance` resumes the job, `export` exports again).

→ `200` with the `Episode`. `409` if there's nothing to retry.

### `POST /api/episodes/:id/cancel`

Cancels a download or export in progress (or queued), or stops waiting for YouTube. → `200` with the `Episode` back in its resting status.

### `DELETE /api/episodes/:id`

- YouTube: deletes its audios (downloaded, enhanced, exported) and goes back to `discovered`. → `200` with the `Episode`.
- Upload: deletes the episode. → `204`, plus the `episodeDeleted` event. Its jobs stay, with `episodeId: null` (a `job` event is sent for each).

The linked `Job` is not touched (it has its own copy). `409` while its job is `pending`, `processing` or `paused`.

### `GET /api/episodes/:id/audio/:which`

`which`: `source` (downloaded/uploaded audio) · `enhanced` (enhanced MP3, light, for the editor) · `enhanced.wav` (lossless) · `final` (the MP3 for Castbox). `Range`, `HEAD` and `?download=1` like the job audio. `404 NOT_READY` if that audio doesn't exist yet.

### `GET /api/episodes/:id/peaks`

High-resolution peaks of the enhanced audio for the editor (20 per second: ~68,000 values and ~270 KB for 56 minutes; computed in ~5 s and cached).

```json
{ "peaks": [0.02, 0.31, ...], "durationSec": 3394.99, "pointsPerSec": 20 }
```

### `PUT /api/episodes/:id/edit`

Saves the editor state. Body: `{ "cuts": [{ "id", "start", "end" }], "introId": "a_…" | null, "outroId": "a_…" | null, "preset": { ...partial preset } }`. Times in seconds; at most 500 cuts. The chosen curtains become the defaults. Requires `files.enhanced`. → `200` with the `Episode` (`editing`).

### `POST /api/episodes/:id/export`

Exports the saved `editState`: [intro] + enhanced audio without the cuts (short crossfade at each join) + [outro], everything normalized to the same format, two-pass `loudnorm` and MP3 CBR with ID3 tags (title, year, podcast name). → `200` with the `Episode` (`exporting`); progress arrives through `episodeProgress`, and the result in `export` when it becomes `ready`.

---

## Curtains (`Asset`)

```json
{ "id": "a_i1e16r", "name": "Intro del podcast", "filename": "intro.wav", "durationSec": 8, "sizeBytes": 1536078, "createdAt": "…", "url": "/api/assets/a_i1e16r/audio" }
```

Shared by everyone using the app.

| Endpoint | |
|---|---|
| `GET /api/assets` | → `{ "items": Asset[], "defaults": { "introId", "outroId" } }` |
| `POST /api/assets` | `multipart/form-data` with `name` (optional) and `file`. Max 50 MB and 10 min. → `201` with the `Asset` |
| `PATCH /api/assets/:id` | `{ "name": "…" }` → `Asset` |
| `DELETE /api/assets/:id` | → `204`. An export that still points to it fails with `ASSET_MISSING` |
| `PUT /api/assets/defaults` | `{ "introId", "outroId" }` → the defaults |
| `GET /api/assets/:id/audio` | Streaming with `Range` |

---

## System

### `GET /api/system`

```json
{
  "ytDlp": { "installed": true, "version": "2026.10.22", "path": "tools/bin/yt-dlp", "canUpdate": true, "error": null },
  "ffmpeg": { "installed": true, "version": "4.4.2-0ubuntu0.22.04.1" },
  "model": { "present": true },
  "disk": { "freeBytes": 221000000000, "totalBytes": 269000000000 },
  "library": { "channelUrl": "https://www.youtube.com/@mi-canal/streams", "vodRetryMin": 30, "vodRetryMaxHours": 12, "rssSyncHours": 3 }
}
```

`ytDlp.error`: when the binary exists but doesn't start, yt-dlp's real error (e.g. an unsupported Python version).

`library.channelUrl` is `null` when no channel is configured.

### `POST /api/system/yt-dlp/update`

Owner only (guests get `404`). Runs `yt-dlp -U`. → `200` with `{ "ok": true, "before": "2026.09.01", "after": "2026.10.22", "output": "…" }`. `ok: false` comes with yt-dlp's output explaining why (e.g. installed with pip).

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
| 409 | `CHANNEL_NOT_CONFIGURED` | Syncing with YouTube without a channel configured (`YT_CHANNEL_ID` in `.env`) |
| 500 | `YTDLP_MISSING` | yt-dlp is not installed (`npm run setup` installs it in `tools/bin/`) |
| 502 | `YTDLP_FAILED` · `YTDLP_BLOCKED` · `NETWORK` · `SYNC_FAILED` | Syncing with YouTube failed. The message includes yt-dlp's real error |

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

- The library's YouTube episodes and the curtains are shared with guests (they can download, enhance, edit and export them). Uploaded episodes, like jobs, are private to whoever uploaded them. Only the owner can update yt-dlp.
- Job lists, job details, actions, audio, waveforms and SSE events include **only that guest's jobs**. Another guest's job id answers `404 NOT_FOUND`, the same as an id that doesn't exist.
- `GET /api/config` returns `"role": "guest"` and `"maxUploadMB": 95`, because Cloudflare's free plan rejects requests over 100 MB. The `413 TOO_LARGE` message suggests uploading an MP3.
- At most 2 active jobs per guest (`429 TOO_MANY_JOBS`).
- `health.gpu.tempC` is `null`.
- Responses are sent as `Cache-Control: private`, so Cloudflare never caches them.
- There is still a single queue: owner and guest jobs run in order of arrival.
