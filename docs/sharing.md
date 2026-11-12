# Share your local setup

Let a few trusted people use Enhancer on **your** machine from anywhere. They don't install anything or create an account: they just open a link.

```
guest's browser
   │  https://enhance.example.com/?k=SECRET
   ▼
Cloudflare (HTTPS, free)
   │  outbound tunnel: no ports opened on your router
   ▼
cloudflared ──▶ 127.0.0.1:3001   guest port: requires the secret link, each guest sees only their jobs
                localhost:3000   your port: local only, sees everything
```

Both ports belong to the same server process, so there is still one queue and one job on the GPU at a time.

## What you need

- A domain whose DNS is managed by Cloudflare. The free plan is enough.
- About 15 minutes for the one-time setup below.

---

## One-time setup

Replace `example.com` with your domain. `enhance` is just the suggested subdomain and tunnel name.

### 1. Install `cloudflared`

On Ubuntu / WSL:

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
cloudflared --version
```

Other systems: see [Cloudflare's downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

### 2. Create the tunnel

```bash
cloudflared tunnel login                                  # opens the browser: choose your domain
cloudflared tunnel create enhance                         # prints the tunnel ID (UUID)
cloudflared tunnel route dns enhance enhance.example.com  # adds one CNAME record, nothing else
```

### 3. Write `~/.cloudflared/config.yml`

```yaml
tunnel: <TUNNEL-ID>
credentials-file: /home/<you>/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: enhance.example.com
    service: http://127.0.0.1:3001
  - service: http_status:404
```

The tunnel must point to port **3001**, the protected one. `npm run share` refuses to start if it points anywhere else, because port 3000 has no protection.

Check it:

```bash
cloudflared tunnel ingress validate
```

All of this lives in your home folder, outside the repository. Nothing about your tunnel or domain is ever committed.

---

## Everyday use

```bash
npm run share
```

This command:

1. Creates a secret key in `.env` the first time. `.env` is git-ignored.
2. Builds the UI and starts the server on ports 3000 and 3001.
3. Checks that port 3001 rejects anyone without the link, and only then opens the tunnel.
4. Prints the link to send (terminal messages are in Spanish, like the UI):

   ```
   ✓ Compartiendo. Manda este enlace a quien quieras dar acceso:

       https://enhance.example.com/?k=7Hq2vX9mPz4LwR8tYc3N
   ```

Press **Ctrl+C** to stop sharing. Any job in progress is paused, and it resumes the next time you start the app.

| Command | Use it to |
|---|---|
| `npm run share` | Share (the link stays the same between sessions) |
| `npm run share:rotate` | Create a new link. The old link and every guest session stop working |
| `npm run share -- --local` | Test the guest port locally, without the tunnel |
| `npm start` | Use the app only by yourself |

`npm start` and `npm run share` can't run at the same time: both use port 3000.

## How the secret link works

1. A guest opens `https://enhance.example.com/?k=SECRET`.
2. The server checks the key, stores a signed cookie (valid 90 days and renewed on each visit), and redirects to the clean address so the key doesn't stay in the address bar.
3. Next time, `https://enhance.example.com` is enough.
4. Anyone without the key or a valid cookie gets a plain `404 Not Found` on every path: pages, API and static files.

The subdomain itself is public (it shows up in certificate logs); the key is what keeps the app private.

## You vs. guests

| | You (`localhost:3000`) | Guests (link) |
|---|---|---|
| Jobs | All, with a "Guest" label on theirs | Only their own |
| Workspaces | Create, edit, delete, switch | Switch only |
| Library: YouTube streams | All | All (they can download, enhance, edit and export them) |
| Library: uploaded audio | All, with a "Guest" label on theirs | Only their own |
| Curtains (intro/outro) | Shared | Shared |
| Update yt-dlp | Yes | No |
| Max upload | 500 MB | 95 MB (Cloudflare's free plan caps requests at 100 MB; an hour of MP3 is 30–80 MB) |
| Active jobs | Unlimited | 2 at a time |
| GPU temperature | Visible | Hidden |

| If… | Guests see |
|---|---|
| `npm run share` is running | The app |
| It's stopped, or the computer is off, asleep or offline | A Cloudflare error page (nothing reaches your machine) |

## Tips

- Keep the computer plugged in and set it to **never sleep** while sharing.
- Avoid gaming or other GPU-heavy work while a job runs: they compete for VRAM.
- If a link leaks, run `npm run share:rotate` and send the new link only to the right people.
- Tunnel logs are written to `data/cloudflared.log`.

## Why this approach

| Option | Why not |
|---|---|
| Port forwarding on the router | Exposes your computer to the whole internet |
| Public URL without protection | Bots find new subdomains within minutes through certificate logs |
| Cloudflare Access (email codes) | Secure, but guests have to log in |
| Tailscale | Guests have to install an app |
| Quick tunnels (`trycloudflare.com`) | Unprotected, and the URL changes every time |
