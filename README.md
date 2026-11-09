# Enhancer

**Clean up and enhance voice recordings with AI — locally, on your own NVIDIA GPU.**

Drop in an hour-long recording (a talk, a class, a podcast, a church service), pick a mode, and get back a cleaner, studio-like version. Nothing is uploaded anywhere: the audio never leaves your machine.

Powered by the open-source [Resemble Enhance](https://github.com/resemble-ai/resemble-enhance) model, with a pipeline that makes long files fit on a modest 4 GB GPU.

![Enhancer dashboard](docs/images/dashboard.png)

> The interface is in Spanish.

---

## Features

- **Long files on small GPUs.** Audio is processed in small chunks, so an hour of audio fits in ~2.8 GB of VRAM.
- **Live progress.** Stage, percentage and time remaining, updated in real time.
- **Pause and resume.** Progress is saved as it goes. Closing the app mid-job, or even a crash, resumes where it left off.
- **Compare before and after.** A waveform player switches between *Original* and *Enhanced* at the same position.
- **Download** the result as MP3 or WAV.
- **Notifications** when a job finishes.
- **Optional sharing.** Let a few trusted people use your GPU through a secret link, with nothing to install on their side ([details](#share-your-local-setup)).

![Comparing original and enhanced audio](docs/images/player.png)

## Modes

| Mode | What it does | Time per hour of audio* |
|---|---|---|
| **Denoise** | Removes background noise | ~4 min |
| **Full enhancement · Standard** | Removes noise and regenerates the voice for a studio sound | ~40 min |
| **Full enhancement · Max** | Same, at the highest quality | ~1 h |

\* Measured on an entry-level 4 GB NVIDIA GPU. Faster GPUs take less, and the app recalibrates its estimates from your own finished jobs.

---

## Quick start

### Requirements

| | |
|---|---|
| **OS** | Windows 10/11 with **WSL2** (Ubuntu 22.04). Native Ubuntu should work the same. |
| **GPU** | NVIDIA with **4 GB+ VRAM**. On WSL, install the NVIDIA driver **on Windows** (not inside WSL); `nvidia-smi` should then work in Ubuntu. |
| **Python** | 3.10 with venv: `sudo apt install python3.10 python3.10-venv` |
| **ffmpeg** | `sudo apt install ffmpeg` |
| **Node.js** | 20 or newer (e.g. via [nvm](https://github.com/nvm-sh/nvm)) |
| **Disk** | ~5 GB for PyTorch and the model, plus ~1.5 GB per hour of audio being processed |

No GPU? It still runs on CPU, just much slower.

### Install and run

```bash
git clone https://github.com/jdpenav/podcast-enhancer.git
cd podcast-enhancer

npm run setup   # Python venv, PyTorch, Resemble Enhance, model download (~680 MB), npm packages
npm start       # builds the UI and starts the app
```

Open **http://localhost:3000**. On WSL, open it in your Windows browser.

`npm run setup` is safe to run again: it skips whatever is already installed. To only check what's missing: `bash scripts/setup.sh --check`.

To stop the app, press **Ctrl+C**. A job in progress is paused and resumes the next time you start the app.

### Commands

| Command | Use it to |
|---|---|
| `npm start` | Run the app at `localhost:3000` |
| `npm run dev` | Develop: API with auto-restart, plus the UI with hot reload at `localhost:5173` |
| `npm run setup` | Install or repair dependencies |
| `npm run share` | Run the app and share it through a secret link ([below](#share-your-local-setup)) |
| `npm --prefix web run dev:mock` | Try the UI with fake data: no GPU, Python or backend needed |

---

## Share your local setup

Want a friend or a teammate to use your GPU without installing anything? `npm run share` exposes the app through a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) on your own domain, protected by a **secret link**:

- **Guests** open the link, and from then on just the address. No account or app needed.
- **Without the link,** the site answers `404` to everyone, bots included.
- **Each guest sees only their own jobs.** You see everything from `localhost:3000`.
- **It only works while `npm run share` is running.** Close it and the link stops working.
- **You can revoke access** at any time with `npm run share:rotate`.
- **No ports are opened** on your router. It's free on Cloudflare's plan; you need a domain whose DNS is managed by Cloudflare.

Setup takes about 15 minutes, once: **[docs/sharing.md](docs/sharing.md)**.

---

## How it works

```
browser ──HTTP / live events──▶ Node.js server ──spawns──▶ Python engine ──▶ GPU
                                  │                          │
                            SQLite job queue          chunk → enhance → merge
```

1. The **web UI** (React) uploads the file and follows progress through Server-Sent Events.
2. The **server** (Fastify) stores the job in a SQLite queue and runs **one job at a time** (a single GPU).
3. The **engine** (Python) decodes the audio, enhances it in 6-second chunks, saves progress in groups, and merges the chunks back with crossfades into WAV and MP3.

Original files are never modified: everything happens on a copy under `data/`, and temporary files are removed when a job ends.

### Project structure

```
├── engine/       Python engine: long-audio pipeline on top of Resemble Enhance
├── server/       Node.js API: queue, live events, audio streaming      → server/README.md
├── web/          React UI (Vite + Tailwind)                            → web/README.md
├── docs/         API contract, sharing guide, screenshots
├── scripts/      setup.sh (install) and share.mjs (sharing)
├── data/         uploads, results, job database      (created at runtime, not versioned)
├── venv/         Python environment                  (created by setup, not versioned)
└── modelos/      model weights                       (downloaded by setup, not versioned)
```

### Tech stack

| Part | Stack |
|---|---|
| Engine | Python 3.10, PyTorch 2.1.1 (CUDA 12.1), Resemble Enhance, ffmpeg |
| Server | Node.js 20+, Fastify 5, better-sqlite3, Server-Sent Events |
| UI | React 18, Vite 6, Tailwind CSS 3, lucide-react |
| Sharing (optional) | Cloudflare Tunnel |

---

## Configuration

Everything works out of the box. Optional environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | App port |
| `COOLDOWN_SEC` | `0` | Pause between chunk groups so the GPU can cool down (e.g. `5`) |
| `MAX_UPLOAD_MB` | `500` | Maximum upload size |
| `DATA_DIR` | `./data` | Where uploads, results and the database are stored |
| `HOST` | `localhost` | Network interface. Keep it local: anyone who can reach it can use your GPU |

## Good to know

- **VRAM:** the engine uses 6-second chunks. On 4 GB cards, 8 s or more overflows memory and runs several times slower.
- **Heat:** long jobs can push a laptop GPU above 85 °C. A cooling pad or `COOLDOWN_SEC` helps.
- **One job at a time:** jobs queue up. If an engine started by hand is already using the GPU, the queue waits for it.
- **Engine without the UI:**
  ```bash
  source venv/bin/activate
  python engine/enhance_long.py input.mp3 output.mp3 --mode denoise
  python engine/enhance_long.py input.mp3 output.wav --mode enhance --nfe 32 --also-mp3 output.mp3
  ```
  Ctrl+C pauses; running the same command again resumes.

## Credits

- [Resemble Enhance](https://github.com/resemble-ai/resemble-enhance) by Resemble AI: the speech enhancement model doing the heavy lifting.
- [ffmpeg](https://ffmpeg.org/) for decoding and encoding.
