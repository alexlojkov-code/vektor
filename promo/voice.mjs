// Озвучка промо: текст диктора по сценам → голос (macOS say) → подгонка по окнам сцен → promo/out/voice.wav
// Каждая реплика начинается в своё время и обязана закончиться до конца окна; если не влезает — говорим быстрее.
//   node promo/voice.mjs [--voice Milena] [--rate 175]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const VOICE = arg('voice', 'Milena'), RATE = +arg('rate', 172);
const OUT = fileURLToPath(new URL('./out/voice/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// [начало, конец окна, текст]. Окна совпадают со сценами index.html; «AI» записан как «эй-ай», чтобы синтезатор не читал буквы
export const LINES = [
  [0.45, 5.45, 'Идеи, таблицы, дедлайны, чаты. Всё есть — а направления нет.'],
  [6.3, 9.55, 'Вектор. Эй-ай ассистент для маркетологов.'],
  [10.3, 14.1, 'Шестнадцать направлений — от пиара до маркетплейсов.'],
  [14.35, 17.9, 'Ассистент помнит ваш бренд и отвечает как эксперт.'],
  [18.45, 23.6, 'А шаги из ответа одной кнопкой становятся задачами.'],
  [24.2, 29.7, 'Окупаемость проверьте в калькуляторе: больше тридцати метрик по точным формулам.'],
  [30.15, 35.8, 'Честно — без выдуманной статистики. Точно. И везде — на телефоне и ноутбуке.'],
  [36.4, 41.4, 'Задайте маркетингу вектор. Начните бесплатно.'],
];

const dur = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString();
const parts = [];
LINES.forEach(([t0, t1, text], i) => {
  const aiff = `${OUT}l${i}.aiff`, wav = `${OUT}l${i}.wav`;
  execFileSync('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, text]);
  const d = dur(aiff), room = t1 - t0;
  // не влезает — ускоряем без смены высоты (atempo), но не больше чем на 25 %
  const tempo = Math.min(1.25, Math.max(1, d / room));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-af',
    `atempo=${tempo.toFixed(3)},highpass=f=90,equalizer=f=3200:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,aresample=48000`,
    '-ac', '2', wav]);
  const fin = d / tempo;
  console.log(`${String(i + 1).padStart(2)} ${t0.toFixed(2)}–${(t0 + fin).toFixed(2)} (окно до ${t1}) ${tempo > 1 ? `×${tempo.toFixed(2)} ` : ''}${fin > room + .01 ? 'НЕ ВЛЕЗАЕТ ' : ''}${text}`);
  parts.push({ wav, t0 });
});

// всё на одну дорожку длиной 42 с
const inputs = parts.flatMap(p => ['-i', p.wav]);
const delays = parts.map((p, i) => `[${i}]adelay=${Math.round(p.t0 * 1000)}|${Math.round(p.t0 * 1000)}[d${i}]`).join(';');
const mix = parts.map((_, i) => `[d${i}]`).join('') + `amix=inputs=${parts.length}:normalize=0,apad=whole_dur=42,atrim=0:42[v]`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${delays};${mix}`, '-map', '[v]', '-ar', '48000', fileURLToPath(new URL('./out/voice.wav', import.meta.url))]);
writeFileSync(`${OUT}lines.json`, JSON.stringify(LINES));
console.log('voice.wav готов');
