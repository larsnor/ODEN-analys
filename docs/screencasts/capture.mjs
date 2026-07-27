/*
 * Render the interactive walkthroughs to silent MP4s.
 *   node capture.mjs [topic ...]        (default: all four)
 * Needs: `npm i -D playwright && npx playwright install chromium` (in plugin/)
 * and ffmpeg on PATH. Frame-steps the player deterministically (30 fps), so
 * output is smooth regardless of machine load, then encodes H.264 without audio.
 */
import { createServer } from "node:http";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };

const topics = process.argv.slice(2).length ? process.argv.slice(2) : ["installation", "omrade", "flodet", "verktyg"];

const server = createServer(async (req, res) => {
  try {
    const path = join(here, decodeURIComponent(new URL(req.url, "http://x").pathname));
    const body = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((ok) => server.listen(0, ok));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

for (const topic of topics) {
  if (!existsSync(join(here, "timelines", `${topic}.json`))) {
    console.error(`hoppar över ${topic}: timelines/${topic}.json saknas`);
    continue;
  }
  console.log(`== ${topic} ==`);
  await page.goto(`http://localhost:${port}/player.html?topic=${topic}&capture=1`);
  await page.waitForFunction("window.__ready === true", { timeout: 30_000 });
  const duration = await page.evaluate("window.__duration");
  const frames = Math.ceil((duration / 1000) * FPS);

  const tmp = join(here, "out", `.frames-${topic}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });

  const stage = page.locator("#stage");
  for (let i = 0; i <= frames; i++) {
    await page.evaluate((t) => window.__seek(t), (i / FPS) * 1000);
    await stage.screenshot({ path: join(tmp, `f-${String(i).padStart(5, "0")}.png`) });
    if (i % 150 === 0) console.log(`  bild ${i}/${frames}`);
  }

  const out = join(here, "out", `${topic}.mp4`);
  execFileSync("ffmpeg", ["-y", "-r", String(FPS), "-i", join(tmp, "f-%05d.png"), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", out], { stdio: "inherit" });
  await rm(tmp, { recursive: true, force: true });
  console.log(`  → ${out}`);
}

await browser.close();
server.close();
