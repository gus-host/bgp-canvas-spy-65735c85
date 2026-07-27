/**
 * Reference capture harness.
 *
 * Renders one scenario deterministically (1 tick = 1 frame), writes one PNG
 * per tick plus tick_index.json, and prints the ffmpeg command that muxes the
 * frames into a lossless FFV1 / ProRes 4444 60 FPS master.
 *
 *   node tools/capture-reference.mjs BAD_GADGET http://localhost:8080 out/
 */
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer";

const [scenario = "BAD_GADGET", base = "http://localhost:8080", outDir = "out"] =
  process.argv.slice(2);
const dir = `${outDir}/${scenario}`;
await mkdir(`${dir}/frames`, { recursive: true });

const events = (await (await fetch(`${base}/api/simulate?scenario=${scenario}`)).text())
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
await writeFile(`${dir}/events.ndjson`, events.map((e) => JSON.stringify(e)).join("\n"));

const lastTick = events[events.length - 1].tick + 90;
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1700, height: 1200, deviceScaleFactor: 1 });
await page.goto(`${base}/?scenario=${scenario}`, { waitUntil: "networkidle0" });
await page.waitForSelector("canvas[data-viz-canvas='bgp']");
// Freeze playback; the scrubber drives ticks so capture is frame-exact.
await page.click("button[data-viz-playpause]");
// Pin the canvas to its native 1200x800 so the capture region is exact.
await page.evaluate(() => {
  const c = document.querySelector("canvas[data-viz-canvas='bgp']");
  c.style.width = "1200px";
  c.style.height = "800px";
  c.style.maxWidth = "none";
});

const canvas = await page.$("canvas[data-viz-canvas='bgp']");
const index = { fps: 60, capture_region: { width: 1200, height: 800 }, frames: [] };


for (let tick = 0; tick <= lastTick; tick++) {
  await page.evaluate((t) => {
    const el = document.querySelector('input[type="range"]');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(el, String(t));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, tick);
  const file = `frames/${String(tick).padStart(6, "0")}.png`;
  await canvas.screenshot({ path: `${dir}/${file}` });
  index.frames.push({ frame: tick, tick, file });
}
await writeFile(`${dir}/tick_index.json`, JSON.stringify(index, null, 2));
await browser.close();

console.log(`frames: ${lastTick + 1} -> ${dir}/frames`);
console.log(
  `ffmpeg -framerate 60 -i ${dir}/frames/%06d.png -c:v ffv1 -level 3 -pix_fmt rgb24 ${dir}/${scenario}.mkv`,
);
console.log(
  `ffmpeg -framerate 60 -i ${dir}/frames/%06d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le ${dir}/${scenario}.mov`,
);
