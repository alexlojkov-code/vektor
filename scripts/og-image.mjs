/* Картинки для превью ссылки и иконок: SVG → PNG через resvg со шрифтом Manrope из scripts/fonts.
   Запуск: npm run build:og → public/og.png (1200×630), public/apple-touch-icon.png (180×180) */
import { Resvg } from '@resvg/resvg-js';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fonts = ['Manrope-500.ttf', 'Manrope-800.ttf'].map(f => `${root}scripts/fonts/${f}`);

// Логотип «Галочка-стрелка» (как в public/favicon.svg), size — сторона квадрата
const logo = (x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 48})">
  <rect width="48" height="48" rx="13" fill="#6B3FD6"/>
  <g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="10,23 19,33 37,12"/><polyline points="29,11.5 37,12 37.5,20"/></g>
  <circle cx="10" cy="23" r="2.6" fill="#BBA4FF"/></g>`;

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="g1" cx="85%" cy="10%" r="60%"><stop offset="0" stop-color="#8B5EFF" stop-opacity=".55"/><stop offset="1" stop-color="#8B5EFF" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="5%" cy="100%" r="55%"><stop offset="0" stop-color="#6B3FD6" stop-opacity=".45"/><stop offset="1" stop-color="#6B3FD6" stop-opacity="0"/></radialGradient>
    <linearGradient id="word" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#CDB8FF" stop-opacity=".16"/><stop offset="1" stop-color="#8B5EFF" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#0D071A"/>
  <rect width="1200" height="630" fill="url(#g1)"/>
  <rect width="1200" height="630" fill="url(#g2)"/>
  <text x="600" y="730" text-anchor="middle" font-family="Manrope" font-weight="800" font-size="300" letter-spacing="-12" fill="url(#word)">ВЕКТОР</text>
  ${logo(80, 72, 56)}
  <text x="152" y="111" font-family="Manrope" font-weight="800" font-size="26" letter-spacing="4" fill="#F4EFFB">ВЕКТОР</text>
  <text x="80" y="262" font-family="Manrope" font-weight="500" font-size="84" letter-spacing="-3" fill="#F4EFFB">Задайте маркетингу</text>
  <text x="80" y="356" font-family="Manrope" font-weight="500" font-size="84" letter-spacing="-3" fill="#BDADCE">вектор</text>
  <text x="80" y="432" font-family="Manrope" font-weight="500" font-size="30" fill="#BDADCE">AI-ассистент маркетолога: 16 направлений, задачи</text>
  <text x="80" y="474" font-family="Manrope" font-weight="500" font-size="30" fill="#BDADCE">и калькулятор 30+ метрик в одном окне</text>
</svg>`;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  ${logo(0, 0, 180).replace('rx="13"', 'rx="0"')}
</svg>`; // углы скругляет сама система

const render = (svg, width) => new Resvg(svg, {
  fitTo: { mode: 'width', value: width },
  font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Manrope' },
}).render().asPng();

await writeFile(`${root}public/og.png`, render(og, 1200));
await writeFile(`${root}public/apple-touch-icon.png`, render(icon, 180));
console.log('Готово: public/og.png, public/apple-touch-icon.png');
