# ⚡ Quick Start - VEO3 Batch Automator

**Getting started in 60 seconds.**

---

## 🎯 TL;DR

1. **Install:** [Get Tampermonkey](https://tampermonkey.net/) → [Install Script](INSERT_LINK_HERE)
2. **Open:** Go to [Google VEO3](https://labs.google/fx/tools/flow/)
3. **Use:** Paste prompts → Click "Enviar Todos" → Click "Baixar Todos"
4. **Done:** Videos in Downloads/ folder

---

## 5-Minute Walkthrough

### 1️⃣ Install Tampermonkey (1 min)
- Chrome: [Get it](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobela)
- Firefox: [Get it](https://addons.mozilla.org/firefox/addon/tampermonkey/)
- Other: Search "Tampermonkey" in your browser's extension store

### 2️⃣ Install Script (10 sec)
[**CLICK TO INSTALL** 👈](INSERT_SCRIPT_LINK_HERE)

Tampermonkey will ask for confirmation. Click "Install script".

### 3️⃣ Test It Works (30 sec)
- Go to: https://labs.google/fx/tools/flow/
- Open any project
- Look for **purple bubble** (VEO) in bottom-right corner
- Click it
- You should see the control panel

### 4️⃣ Use It (3 min)
```
1. Copy your prompts (or use examples below)
2. Paste in the text area
3. Click "▶ Enviar Todos" (green button)
4. Wait for videos to generate
5. Click "📥 Baixar Todos" (blue button)
6. Videos save automatically
```

✅ **Done!**

---

## Example Prompts

Paste these to test:

```
uma bola vermelha quicando
um gato dormindo no sofá
pôr do sol na praia
uma árvore crescendo em acelerado
água caindo em uma cachoeira
```

---

## What's Happening?

```
PHASE 1: Sending Videos
├─ Script injects your prompt
├─ Clicks send button
├─ Waits for video generation
├─ Moves to next prompt
└─ Repeat for all prompts

⏸ You can PAUSE here

PHASE 2: Download All
├─ Click "Baixar Todos"
├─ Script downloads all videos
└─ Saved as: veo3-batch-001.mp4, 002.mp4, ...
```

---

## Controls

| Button | What it does |
|--------|-------------|
| 🟢 **Enviar Todos** | Generate all videos |
| 🔵 **Baixar Todos** | Download all videos |
| 🟠 **Pausar** | Pause, then "Retomar" to continue |
| 🔴 **Parar** | Stop and cancel |

---

## Common Questions

**Q: Where do videos save?**
A: Your browser's Downloads folder (e.g., ~/Downloads/veo3-batch-001.mp4)

**Q: Can I use this on mobile?**
A: No, VEO3 requires desktop browser.

**Q: Does this work if Google updates VEO3?**
A: Probably yes! The script uses multiple detection strategies that survive UI changes. See [COMPATIBILITY.md](COMPATIBILITY.md).

**Q: Is this safe?**
A: Yes. It's just clicking buttons automatically. No viruses, no stealing data. [Source code](veo3-batch-automator.user.js) is open.

**Q: Does it work on all browsers?**
A: Chrome, Firefox, Safari, Edge, Opera — yes to all.

**Q: What if something breaks?**
A: See [DEBUG.md](DEBUG.md) for troubleshooting.

---

## What NOT to Do

❌ Close the VEO3 page during generation (script stops)
❌ Use on very large batches (100+ videos) without breaks
❌ Change tabs while downloading (browser might interrupt)

---

## Troubleshooting in 30 Seconds

**Purple bubble doesn't appear?**
- Refresh page (F5)
- Check you're at: https://labs.google/fx/.../project/...
- See [DEBUG.md](DEBUG.md)

**Script doesn't send?**
- Open F12 → Console
- Look for error messages
- Report with screenshot

**Videos don't download?**
- Check your Downloads folder
- Try increasing timeout in script settings
- See [DEBUG.md](DEBUG.md) → "Videos not downloading"

---

## Next Steps

- 📖 Read [INSTALL_GUIDE.md](INSTALL_GUIDE.md) for detailed steps
- 🔧 Read [COMPATIBILITY.md](COMPATIBILITY.md) about resilience
- 🐛 Read [DEBUG.md](DEBUG.md) if something's wrong
- 📢 Share with friends!

---

## Support

Found a bug or need help?

- **Check:** [FAQ in INSTALL_GUIDE.md](INSTALL_GUIDE.md#perguntas-comuns)
- **Read:** [Troubleshooting in DEBUG.md](DEBUG.md)
- **Ask:** [GitHub Issues](INSERT_GITHUB_ISSUES_LINK)

---

**That's it! Enjoy automated video generation! 🎉**

Script: VEO3 Batch Automator v0.9.0 | By: j. felipe
