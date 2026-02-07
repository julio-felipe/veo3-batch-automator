# 🎬 VEO3 Batch Automator

> Automate batch video generation in Google Veo 3.1 with human-like behavior and 2-phase workflow

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/julio-felipe/veo3-batch-automator)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-required-red.svg)](https://www.tampermonkey.net/)
[![Browser](https://img.shields.io/badge/browser-Chrome%20%7C%20Firefox%20%7C%20Safari%20%7C%20Edge-orange.svg)](#-quick-installation-2-minutes)

**[📥 Install Now](https://raw.githubusercontent.com/julio-felipe/veo3-batch-automator/main/veo3-batch-automator.user.js)** | **[📚 Documentation](docs/)** | **[🐛 Report Issue](https://github.com/julio-felipe/veo3-batch-automator/issues)**

---

**Created by:** j. felipe
**Status:** ✅ Ready for production use

---

## ✨ Key Features

🚀 **Human-like Automation** - Natural delays (3-7s) and typing simulation
📥 **2-Phase Workflow** - Send all prompts first, then download all videos
🎯 **Sequential Numbering** - Videos named 001, 002, 003... automatically
📋 **Automatic Manifest** - Generated guide with all your prompts
✅ **Multiple Selector Strategies** - Survives Google VEO3 UI updates
⏸️ **Pause/Resume** - Control the batch anytime
🌐 **Multi-browser** - Chrome, Firefox, Safari, Edge
🔐 **No External Dependencies** - 100% vanilla JavaScript

---

## 💾 Quick Installation (2 minutes)

### 1️⃣ Install Tampermonkey

Choose your browser:
- **Chrome**: [Tampermonkey Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobela)
- **Firefox**: [Tampermonkey Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)
- **Safari**: [Tampermonkey Safari](https://apps.apple.com/app/tampermonkey/id1482490089)
- **Edge/Opera**: Search "Tampermonkey" in your browser's extension store

### 2️⃣ Install Script

**[📥 Click here to install from GitHub](https://raw.githubusercontent.com/julio-felipe/veo3-batch-automator/main/veo3-batch-automator.user.js)**

Tampermonkey will open automatically and ask to install. Click **Install**.

### 3️⃣ Start Using

1. Go to https://labs.google/fx/tools/flow/
2. Open any project
3. Look for the purple **VEO** button (bottom-right corner)
4. Click it to open the control panel
5. Paste your prompts (one per line) and click **▶ Iniciar**

✅ **Pronto!**

**Veja `INSTALL_GUIDE.md`** para instruções detalhadas.

---

## 🚀 How It Works

### PHASE 1: Send All Videos

```
1. Open VEO3 project page
2. Click purple bubble (VEO) → opens panel
3. Paste your prompts (one per line)
4. Click "▶ Enviar Todos"
5. Script sends all prompts FAST:
   ├─ Inject prompt
   ├─ Click send
   ├─ Wait for generation
   └─ Next prompt (repeat)
6. No downloads yet — videos pile up in VEO3
7. When done: "Clique Baixar Todos para baixar os X vídeos"
```

### PHASE 2: Download All Videos

```
1. When Phase 1 finishes, button "📥 Baixar X vídeos" activates
2. Click it
3. Script downloads all videos in sequence:
   ├─ Hover over video
   ├─ Click download
   ├─ Wait for completion
   └─ Next video
4. Files saved: veo3-batch-001.mp4, 002.mp4, etc.
```

### Why Two Phases?

| Antes (v0.8) | Depois (v0.9) |
|---|---|
| Send + wait + Download + wait (20s per video) | Send all (2s per video) + Download when ready |
| 5 videos = 100+ seconds | 5 videos = 10s sending + download later |
| **Bottleneck:** Download | **Fast:** Send all first |

---

## 📋 Usage Example

### Your Prompts
```
cachorro brincando no parque
gato dormindo na cama
pássaro voando ao pôr do sol
flor florescendo em acelerado
água caindo em cascata
```

### Step-by-Step
1. **Click VEO bubble** (purple, bottom-right)
2. **Paste prompts** into text area
3. **Click "▶ Enviar Todos"** (green button)
4. **Wait 10-20 seconds** (all videos generating in parallel)
5. **See "Baixar Todos"** button light up (blue)
6. **Click it** whenever you're ready
7. **Videos download** to your Downloads folder

---

## ⏸️ Pause/Resume

Click **"⏸ Pausar"** to pause during PHASE 1 or PHASE 2. Click **"▶ Retomar"** to continue.

---

## Configuration

Edit these constants in the script to customize behavior:

```javascript
const CONFIG = {
  POLL_INTERVAL: 500,              // Check progress every 500ms
  PROGRESS_TIMEOUT: 480000,        // 8 minutes max wait for video generation
  DOWNLOAD_TIMEOUT: 30000,         // 30 seconds to detect download
  INTER_PROMPT_DELAY_MIN: 3000,    // Min delay between prompts (3s)
  INTER_PROMPT_DELAY_MAX: 7000,    // Max delay between prompts (7s)
  QUEUE_BATCH_SIZE: 5,             // VEO3 max queue size
  QUEUE_COOLDOWN: 15000            // Cooldown when queue is full (15s)
};
```

### Recommended Settings:
- **Slower VEO3 response?** Increase `PROGRESS_TIMEOUT` to 600000 (10 min)
- **Queue limit issues?** Adjust `QUEUE_BATCH_SIZE` and `QUEUE_COOLDOWN`
- **Downloads not detected?** Increase `DOWNLOAD_TIMEOUT` to 60000 (1 min)

---

## Troubleshooting

### Script doesn't appear
- Ensure Tampermonkey is enabled
- Refresh the page (F5)
- Check browser console (F12 → Console) for errors

### Input field not found
- Verify you're on the correct Google Veo 3.1 page
- Make sure the page has fully loaded
- Check if the UI has changed in the latest version

### Progress not detected
- The script may not recognize the new progress bar format
- Manually inspect the page (F12 → Inspector)
- Report the issue with a screenshot

### Downloads not working
- Check browser download folder permissions
- Verify downloads are not blocked
- Try adjusting `DOWNLOAD_TIMEOUT` in config
- v1.0.0: Downloads now use direct URL capture (much more reliable)

### Queue limit (max 5 generations)
- VEO3 allows max 5 generations in queue at once
- v1.0.0: Script auto-detects and waits for queue availability
- Adjust `QUEUE_COOLDOWN` if needed

### Batch gets stuck
- Check the status log in the panel
- Click "⏸ Pausar" and manually continue the current prompt
- Check your VEO3 credit balance

---

## 🛡️ Resiliência contra Atualizações

### O Script Sobrevive a Mudanças do VEO3

**Múltiplos Seletores (Fallback Strategy):**
```javascript
const sendButton = [
  'button:has(i.google-symbols)',      // Ícone (Material Design)
  'button[aria-haspopup="dialog"]',    // Atributo ARIA
  'button[aria-label*="enviar"]',      // Label PT
  'button[aria-label*="send"]',        // Label EN
  'button[title*="Enviar"]',           // Title
  'button[type="submit"]'              // Fallback genérico
];
```

Se Google muda a primeira estratégia, o script tenta a próxima. Muito difícil quebrar.

**Ícones Material Symbols (Stable):**
- Google usa Material Design icons (especificação estável)
- Nome dos ícones (`arrow_forward`, `download`) raramente muda
- Script procura pelo nome, não pela classe CSS

**Monitoramento de `<video>` Element:**
- Rastreia elemento HTML puro
- Não depende de CSS ou classes
- Detecta quando novo vídeo aparece na página

**Veja `COMPATIBILITY.md`** para detalhes completos sobre resiliência.

---

## Technical Details

### Technology Stack
- **Language:** Vanilla JavaScript (ES6+)
- **Environment:** Tampermonkey userscript
- **API:** DOM manipulation, MutationObserver
- **Browsers:** Chrome, Firefox, Safari, Edge

### Key Features
- Non-blocking async/await pattern
- Error handling with retry capability
- Real-time progress tracking
- Minimal memory footprint
- No external dependencies

---

## Known Limitations

1. **Session Timeout** - Script requires active Google session (doesn't auto-login)
2. **Credit Usage** - Each video uses 20 credits; ensure sufficient balance
3. **Rate Limiting** - VEO3 may throttle requests; script respects delays
4. **Download Naming** - Uses browser's default download folder (user can customize)
5. **UI Changes** - If VEO3 updates, selectors may need updating

---

## Future Enhancements

🚀 **Roadmap:**
- [ ] Custom naming scheme for downloads (timestamp, custom prefix)
- [ ] Batch statistics (total duration, credits used, success rate)
- [ ] Retry failed prompts automatically
- [ ] CLI version for headless batch processing
- [ ] Support for image generation (when added to VEO3)
- [ ] Export batch results as JSON/CSV

---

## Support & Feedback

**Found a bug?** Check the browser console (F12 → Console) for error messages and report with:
- Browser name and version
- VEO3 URL
- Error message from console
- Screenshot if applicable

**Have a feature request?** Suggestions are welcome! Consider:
- Is it compatible with Tampermonkey?
- Does it respect VEO3 rate limits?
- Can it be implemented without external dependencies?

---

## License

Created with ❤️ for content creators and batch processing automation.

**Author:** j. felipe
**Maintained by:** Synkra AIOS

---

## 📚 Documentation

| Arquivo | Propósito |
|---------|-----------|
| `README.md` | Overview & features (você está aqui) |
| `INSTALL_GUIDE.md` | Step-by-step installation para usuários |
| `COMPATIBILITY.md` | Como o script sobrevive a atualizações |
| `DISTRIBUTION.md` | Como compartilhar o script com outros |
| `DEBUG.md` | Troubleshooting & soluções de problemas |
| `CHANGELOG.md` | Histórico de versões |

---

## 📈 Changelog

### v1.0.0 (2026-02-07) - **STABLE RELEASE**
- 📥 **DOWNLOAD FIX:** Direct URL capture during generation — downloads work for ALL videos (not just visible ones)
- 📥 **BLOB PRESERVATION:** Pre-fetches blob URLs immediately to survive React re-renders
- 🚦 **QUEUE AWARENESS:** Auto-detects VEO3's 5-generation queue limit and waits for availability
- 🔍 **SMART SCROLL:** Finds videos off-screen with intelligent scrollable container detection
- ✅ **DOWNLOAD VALIDATION:** No more false positives — unconfirmed downloads reported separately
- ⚠️ **HONEST REPORTING:** Summary shows confirmed, unconfirmed, and failed downloads

### v0.9.0 (2026-02-06) - **PUBLIC RELEASE**
- ✨ **MAJOR:** Split into 2-phase workflow (Send All → Download All)
- ✨ **FEATURE:** One-click download button for all videos
- 🎯 **IMPROVEMENT:** Fast parallel prompt sending (no download delays)
- 🛡️ **RESILIENCE:** Multiple selector strategies + Material Design icons
- 📊 **UI:** New status display showing generated vs downloaded count
- 🔧 **CONFIG:** Increased timeouts for reliability (480s progress, 30s download)
- 📚 **DOCS:** Comprehensive installation & compatibility guides
- ✅ **Ready for:** Public distribution (Gist, GitHub, Greasy Fork)

### v0.8.2 (2026-02-05)
- Fixed download button detection (icon text matching)
- Improved React textarea injection with native setters
- Added human-like click sequence (mousedown → mouseup → click)
- Better progress bar detection with video element monitoring

### v0.8.0+
- Initial versions with sequential automation

---

## 🔒 License

MIT - Use, modify, distribute freely.

**Author:** j. felipe
**Maintained by:** Synkra AIOS
**Created with:** ❤️ for content creators
