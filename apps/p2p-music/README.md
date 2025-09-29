# P2P Music Server for Umbrel

This Umbrel app runs a private IPFS node and a small TypeScript API that scans your music,
pins files to IPFS, and exposes a minimal UI for streaming and sharing CIDs.

## Folder layout

```
p2p-music-umbrel/
  ├─ umbrel-app.yml            # App manifest
  ├─ docker-compose.yml        # Defines app_proxy + ipfs + web services
  └─ server/                   # TypeScript API + static UI
```

## Where to put music

By default the `web` container mounts a private path **scoped to this app**:

```
${APP_DATA_DIR}/music  →  /music (read-only)
```

Copy audio files (mp3, flac, m4a, aac, wav, ogg, opus) into that folder.  
Advanced: you can instead map Umbrel's shared Storage (so other apps can see the same files) by editing `docker-compose.yml` to add a volume like:

```
# maps Umbrel's shared Storage/music into /music (read-only)
- ${UMBREL_ROOT}/data/storage/music:/music:ro
```

> Tip: Umbrel's File Browser app exposes `Storage/` in the web UI.

## Local testing on umbrelOS

Follow Umbrel's official app framework guide. In short:

1. SSH to your device: `ssh umbrel@umbrel.local`
2. Create an app store folder or use an existing community store.
3. Copy this app directory onto the device's app-store path and install it from the Umbrel UI,
   or via CLI using `umbreld client apps.install.mutate --appId p2p-music`.
   See the docs for the exact rsync path on your device.
4. After install, open `http://umbrel.local:3005`.

Docs: https://github.com/getumbrel/umbrel-apps#readme

## How it works

- Spins up **ipfs/kubo** and configures the API/Gateway to listen on 0.0.0.0 **inside Docker** (not exposed publicly).
- `web` (Node.js) connects to the IPFS RPC API at `http://ipfs:5001`.
- Clicking **Scan & Pin** recursively indexes `/music`, extracts tags, pins to IPFS, and saves a catalog to `/state/tracks.json`.
- Streams are served from `/api/stream/:cid` using `ipfs.cat`.

## Security notes

- The IPFS RPC API is reachable only within the app's internal Docker network and should **not** be exposed publicly.
- The Umbrel **App Proxy** protects `GET /` with Umbrel auth; API routes are whitelisted so the UI can function.
- For remote sharing, the UI links to a public gateway URL for the CID. Use your own gateway if you prefer.

## Build/Dev on another machine

You can `docker compose build` locally (the web service uses the included Dockerfile).  
To publish in a community store, push a multi-arch image to a registry and replace `build:` with a pinned `image: …@sha256:<digest>` in `docker-compose.yml`.
