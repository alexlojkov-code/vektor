// Покадровый рендер promo/index.html в Chromium.
//   node promo/render.mjs --stills 1,5.6,12      — отдельные кадры в promo/out/stills
//   node promo/render.mjs --from 0 --to 42       — кадры по сетке i/60 сразу в ffmpeg → promo/out/video.mp4 (без звука)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const FPS = +arg('fps', 60);
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT + 'stills', { recursive: true });

// Playwright из проекта ждёт свою версию Chromium; если её нет — берём уже установленный
const local = `${homedir()}/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('JS:', e.message));
await page.goto(new URL('./index.html', import.meta.url).href);
await page.evaluate(() => window.ready);
await page.waitForTimeout(500);

const shot = async t => { await page.evaluate(t => renderAt(t), t); return page.screenshot({ type: 'png' }); };

if (arg('stills')) {
  for (const t of arg('stills').split(',').map(Number)) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${OUT}stills/t${t.toFixed(2).padStart(6, '0')}.png`, await shot(t));
  }
  console.log('stills →', OUT + 'stills');
} else {
  const from = +arg('from', 0), to = +arg('to', 42);
  const name = arg('name', 'video');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', `${OUT}${name}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n0 = Math.round(from * FPS), n1 = Math.round(to * FPS);
  const started = Date.now();
  for (let i = n0; i < n1; i++) {
    const buf = await shot(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((i - n0) % 300 === 0) console.log(`кадр ${i}/${n1} · ${((Date.now() - started) / 1000).toFixed(0)} с`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  console.log(`готово: ${OUT}${name}.mp4, кадров ${n1 - n0}, ${((Date.now() - started) / 1000).toFixed(0)} с`);
}
await browser.close();
