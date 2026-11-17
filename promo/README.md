# Промо-ролик «Вектора»

42 секунды, 1920×1080, 60 fps, H.264 + AAC. Брутальная типографика (сырые блоки, жёсткие тени, Manrope 800, моноширинные подписи) в фирменной палитре и со стеклянным интерфейсом приложения.

| Время | Сцена | Что показывает |
|---|---|---|
| 0–6 | Хаос | идеи, таблицы, дедлайны → «Всё есть. Нет направления.» → фиолетовая линия-вектор режет кадр |
| 6–10 | Вектор | линия становится логотипом, «Задайте маркетингу вектор» |
| 10–18 | AI-чат | 16 направлений, выбор «PR», запрос и ответ потоком |
| 18–24 | Задачи | «＋ В задачи» — шаги улетают на доску, первая задача выполнена |
| 24–30 | Калькулятор | ROMI +51,2 % (84 млн дохода, 45 % маржи, 25 млн расходов), 30+ метрик |
| 30–36 | Принципы | честно, точно, везде |
| 36–42 | Старт | «Начать бесплатно», адрес сайта |

## Сборка

```bash
node promo/audio.mjs                      # музыка и эффекты → promo/out/audio.wav
node promo/render.mjs --from 0 --to 42    # кадры → promo/out/video.mp4 (без звука)
ffmpeg -i promo/out/video.mp4 -i promo/out/audio.wav -c:v copy -c:a aac -b:a 256k -movflags +faststart promo/out/vektor-promo.mp4
```

С озвучкой (голос macOS «Милена», музыка приглушается под речь):

```bash
node promo/voice.mjs                      # реплики по сценам → promo/out/voice.wav
ffmpeg -i promo/out/audio.wav -i promo/out/voice.wav -filter_complex "[1]asplit=2[sc][v];[0]volume=0.75[m];[m][sc]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[d];[d][v]amix=inputs=2:normalize=0:weights=1 1.7,loudnorm=I=-14:TP=-1:LRA=9" -ar 48000 promo/out/mix.wav
ffmpeg -i promo/out/video.mp4 -i promo/out/mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart "promo/Вектор — промо с озвучкой.mp4"
```

Текст диктора и окна реплик — в `promo/voice.mjs`. Другой голос: `node promo/voice.mjs --voice Yuri`, если он установлен в системе.

Отдельные кадры для проверки: `node promo/render.mjs --stills 4.7,26.4`.

Кадр зависит только от времени: `renderAt(t)` в `index.html`. Склейки стоят на тактах 120 BPM (6, 10, 18, 24, 30, 36 с), и `audio.mjs` использует те же таймкоды.
