import express from "express";
import { create as createIpfsClient, IPFSHTTPClient } from "ipfs-http-client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFile } from "music-metadata";
import { lookup as mimeLookup } from "mime-types";
import PQueue from "p-queue";

const PORT = parseInt(process.env.PORT || "3005", 10);
const MUSIC_DIR = process.env.MUSIC_DIR || "/music";
const STATE_DIR = process.env.STATE_DIR || "/state";
const STATE_FILE = path.join(STATE_DIR, "tracks.json");
const IPFS_API_URL = process.env.IPFS_API_URL || "http://ipfs:5001";

type Track = {
  relativePath: string;
  cid?: string;
  size?: number;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  mime?: string;
};

const AUDIO_EXTS = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".wav",
  ".ogg",
  ".opus",
]);

function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTS.has(path.extname(filePath).toLowerCase());
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function loadState(): Record<string, Track> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: Record<string, Track>) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function ensureIpfs(): Promise<IPFSHTTPClient> {
  const client = createIpfsClient({ url: IPFS_API_URL });
  // quick sanity call
  await client.id();
  return client;
}

async function scanAndIndex(ipfs: IPFSHTTPClient) {
  const absFiles = walk(MUSIC_DIR).filter(isAudioFile);
  const state = loadState();

  const queue = new PQueue({ concurrency: 2 });

  let added = 0;

  await Promise.all(
    absFiles.map((absPath) =>
      queue.add(async () => {
        const rel = path.relative(MUSIC_DIR, absPath);
        const stat = fs.statSync(absPath);
        const prev = state[rel];
        if (prev && prev.size === stat.size && prev.cid) {
          return; // likely unchanged
        }

        // Parse metadata (best effort)
        let meta: any = {};
        try {
          const m = await parseFile(absPath);
          meta = {
            title: m.common.title,
            artist: (m.common.artists && m.common.artists.join(", ")) || m.common.artist,
            album: m.common.album,
            duration: m.format.duration,
          };
        } catch {}

        // Add to IPFS
        const file = fs.createReadStream(absPath);
        const res = await ipfs.add(file, { pin: true });
        const cid = res.cid.toString();

        const mimeType = mimeLookup(absPath) || "application/octet-stream";

        state[rel] = {
          relativePath: rel,
          cid,
          size: stat.size,
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          duration: meta.duration,
          mime: mimeType,
        };
        added++;
      })
    )
  );

  saveState(state);
  return { total: absFiles.length, added };
}

async function main() {
  const app = express();
  app.use(express.json());

  let ipfs: IPFSHTTPClient | null = null;

  app.get("/api/health", async (_req, res) => {
    try {
      if (!ipfs) ipfs = await ensureIpfs();
      const info = await ipfs.id();
      res.json({ ok: true, ipfs: { id: info.id, agentVersion: info.agentVersion } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Scan music dir and pin all files to IPFS
  app.post("/api/index", async (_req, res) => {
    try {
      if (!ipfs) ipfs = await ensureIpfs();
      const result = await scanAndIndex(ipfs);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Return current track catalog
  app.get("/api/tracks", (_req, res) => {
    const state = loadState();
    const tracks = Object.values(state);
    res.json({ ok: true, count: tracks.length, tracks });
  });

  // Stream by CID (simple, no range requests)
  app.get("/api/stream/:cid", async (req, res) => {
    try {
      if (!ipfs) ipfs = await ensureIpfs();
      const { cid } = req.params;
      const state = loadState();
      const match = Object.values(state).find((t) => t.cid === cid);
      const ct = match?.mime || "audio/mpeg";
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

      for await (const chunk of ipfs.cat(cid)) {
        res.write(chunk);
      }
      res.end();
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Static files
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use("/", express.static(path.join(__dirname, "src", "public")));
  app.use("/", express.static(path.join(__dirname, "public"))); // after build

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[p2p-music] listening on :${PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
