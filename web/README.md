# Web UI

Single-page dashboard for Enhancer: upload audio, follow progress live, compare the result with the original, and download it.

It talks to the server (`../server`) through the contract in [`../docs/API.md`](../docs/API.md). It also runs on its own with **fake data (mock mode)**, with no GPU, Python or backend required.

> The interface text is in Spanish.

## Stack

- **Vite 6 + React 18**, plain JavaScript (`.jsx`).
- **Tailwind CSS 3**, with light and dark themes (System / Light / Dark menu in the header; `darkMode: 'class'`).
- Icons from `lucide-react`; Inter font with a `system-ui` fallback.
- No state or UI libraries: `useReducer`, custom hooks, and hand-made modals, menus and toasts.

## Running

```bash
cd web
npm install
npm run dev            # http://localhost:5173 — /api is proxied to http://localhost:3000
npm run dev:mock       # fake data (VITE_MOCK=1), no backend needed
npm run mock:assets    # generates sample audio for mock mode in public/mock/
npm run build          # production build in dist/
```

From the repository root, `npm run dev` starts the UI and the server together, and `npm start` serves the build on port 3000.

`npm run mock:assets` creates a synthetic before/after pair by default. To use a real pair instead: `npm run mock:assets -- ORIGINAL ENHANCED`. Source files are only read, never modified.

## Mock mode

`src/api/index.js` picks the implementation:

- `mock.js` when `VITE_MOCK=1`, or when `/api/health` doesn't answer.
- `client.js` (the real API) otherwise.

Both expose the same interface. The mock simulates the queue, progress, pausing, errors and completion in memory.

| URL | What it does |
|---|---|
| `/?escenario=completo` | Jobs in every state |
| `/?escenario=vacio` | Starts with no jobs |
| `/?preview=config` | Opens the mode picker with a fake 56-min file |
| `/#escuchar=<id>` | Opens the player for a job (also works with the real backend) |
| A file with "error" in its name | Fails with `GPU_OOM` at ~35 %; *Retry* resumes it |

## Features

- **Upload:**
  - Drag and drop, anywhere in the window, or use the file picker.
  - Validates type and size against `/api/config`.
  - Reads the duration in the browser and shows upload progress.
- **Mode picker:** selectable cards (Denoise / Full enhancement, Standard or Max), each with its estimated time.
- **Jobs:**
  - Progress bar with stage, percentage and time remaining.
  - Context actions: pause, resume, cancel, retry and delete (with confirmation).
- **Result:**
  - Pill-shaped player with a seekable waveform.
  - *Original / Enhanced* toggle that keeps the playback position.
  - Speed from 0.75× to 2×, and MP3/WAV download.
- **Live updates:** everything updates through SSE (`/api/events`) and resyncs after a reconnect.
- **Notifications:** a toast plus a system notification when a job finishes or fails.
- **System status:**
  - GPU pill in the header: free, busy or no GPU, plus its temperature.
  - A banner when the server is unreachable.
- **Sharing:** jobs uploaded by guests show a "Guest" label in the owner's view.
- Responsive down to 400 px and keyboard accessible.

## Design

Minimal black and white:

- Light gray background with white `rounded-2xl` cards.
- A black primary color, plus one accent each for errors (red) and success (green).
- Dark mode inverts the palette. The theme follows the operating system by default; the header menu can force light or dark, and the choice is remembered in the browser.

## Structure

```
web/
├── index.html
├── vite.config.js         /api proxy; keeps public/mock out of production builds
├── tailwind.config.js
├── scripts/make-mock.mjs  generates public/mock/
├── public/mock/           mock-mode audio (not versioned)
└── src/
    ├── main.jsx, App.jsx, index.css
    ├── api/               client.js (real), mock.js, index.js (picks one)
    ├── hooks/             useJobs, useConfig, useApi, useNotify, useNow, useWindowDrop
    ├── components/        Header, UploadCard, DropOverlay, ConfigModal, JobCard, Sidebar,
    │   │                  ResultModal, AudioPlayer, Waveform, ConfirmModal, EmptyState, OfflineBanner
    │   └── ui/            Badge, Button, Menu, Modal, ProgressBar, Segmented, Toast, Tooltip
    └── lib/               format, audio, jobs, cn
```
