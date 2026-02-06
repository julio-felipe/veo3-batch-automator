# 🎬 START HERE - VEO3 Batch Automator

Welcome! This guide will get you up and running in **5 minutes**.

---

## What Is This?

A **Tampermonkey browser extension** that automates video generation in Google Veo 3.1.

Instead of clicking buttons for each prompt, you:
1. Paste 100 prompts at once
2. Click "Iniciar"
3. Walk away
4. Come back to 100 videos in your Downloads folder

**Created by:** j. felipe 🚀

---

## Quick Start (5 min)

### Step 1: Install Tampermonkey
Pick your browser:
- **Chrome/Edge:** [Install here](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobgkta)
- **Firefox:** [Install here](https://addons.mozilla.org/firefox/addon/tampermonkey/)
- **Safari:** [Install here](https://apps.apple.com/us/app/tampermonkey/id1482490089)

### Step 2: Install the Script
1. Open `veo3-batch-automator.user.js` file
2. Copy ALL the code (Ctrl+A, Ctrl+C)
3. Click Tampermonkey icon → Create new script
4. Delete the template, paste the code
5. Press Ctrl+S to save

### Step 3: Open VEO3
Go to: `https://labs.google/fx/pt/tools/flow/project/YOUR_PROJECT_ID`

You should see a **purple panel on the right side** ← That's the extension!

### Step 4: Add Prompts
Click in the textarea and paste your prompts (one per line):
```
um video fofinho!
cachorrinho brincando
gato dormindo ao sol
```

### Step 5: Start
Click the green **"▶ Iniciar"** button and watch the magic happen!

---

## File Guide

📁 **veo3-batch-automator/**
```
├─ veo3-batch-automator.user.js    ← The main script (install this)
├─ README.md                       ← Full documentation
├─ START_HERE.md                   ← This file
├─ TESTING.md                      ← How to test the script
├─ DEBUG.md                        ← Troubleshooting guide
├─ CHANGELOG.md                    ← Version history
└─ package.json                    ← Project metadata
```

---

## Common Scenarios

### Scenario 1: "Panel doesn't appear"
→ See [DEBUG.md](DEBUG.md) → "Panel not found"

### Scenario 2: "Where are my videos?"
→ Check your Downloads folder (Ctrl+Shift+J in Chrome)

### Scenario 3: "It's generating videos but they're not downloading"
→ See [DEBUG.md](DEBUG.md) → "Downloads aren't happening"

### Scenario 4: "I want to test it first"
→ Read [TESTING.md](TESTING.md) → Test Suite 3 (Single Prompt Test)

### Scenario 5: "Something's broken"
→ See [DEBUG.md](DEBUG.md) → Run diagnostics

---

## What You Need

✅ Chrome, Firefox, Safari, or Edge
✅ Tampermonkey installed
✅ Google account with VEO3 access
✅ VEO3 credits (each video = ~20 credits)

---

## How It Works

```
Your Prompts
    ↓
Panel injects first prompt
    ↓
Clicks send button
    ↓
Monitors progress (0% → 100%)
    ↓
Clicks download when ready
    ↓
Moves to next prompt
    ↓
Repeats for all prompts
    ↓
Done! Videos in Downloads folder
```

**Time estimate:** ~1 minute per video + 2 seconds between videos

---

## Features

✅ **Multi-browser** - Works on Chrome, Firefox, Safari, Edge
✅ **Simple UI** - Just paste and click
✅ **Smart detection** - Finds buttons and progress bars automatically
✅ **Pause/Resume** - Stop anytime, pick up where you left off
✅ **Error handling** - Continues even if one video fails
✅ **Real-time status** - See exactly what's happening
✅ **Zero dependencies** - No installations, just a userscript

---

## Next Steps

1. **Install** - Follow Quick Start above
2. **Test** - Read [TESTING.md](TESTING.md) → Quick Test
3. **Learn more** - Read [README.md](README.md) for full docs
4. **Troubleshoot** - If issues, read [DEBUG.md](DEBUG.md)
5. **Track updates** - Check [CHANGELOG.md](CHANGELOG.md)

---

## Support

### Issue Examples

- ❌ "Input field not found"
- ❌ "Send button not found"
- ❌ "Download button not found"
- ❌ "Script doesn't load"

→ **Solution:** See [DEBUG.md](DEBUG.md)

### Before Reporting Issues

1. Open F12 → Console
2. Take a screenshot of any red errors
3. Try the solutions in [DEBUG.md](DEBUG.md)
4. If still broken, report with screenshot + console output

---

## Pro Tips

💡 **Tip 1:** Start with 1-2 prompts to test
💡 **Tip 2:** Use simple, clear prompts for best results
💡 **Tip 3:** Check your VEO3 credit balance before large batches
💡 **Tip 4:** Keep browser window focused while running
💡 **Tip 5:** Don't refresh page during processing

---

## Version Info

**Current version:** 0.1.0
**Created:** 2026-02-05
**Author:** j. felipe
**Framework:** Synkra AIOS

---

## Questions?

### "Can I use this on mobile?"
Not yet - Tampermonkey mobile support is limited. Desktop only.

### "Does this work on other AI video tools?"
Not yet - Built specifically for Google Veo 3.1. Other tools need different selectors.

### "Can I modify the script?"
Yes! It's vanilla JavaScript. See code comments for configuration.

### "Will this violate any terms?"
No - It's just automating what you could do manually. Respects all rate limits.

### "How do I uninstall?"
Click Tampermonkey → Dashboard → Find "VEO3 Batch Automator" → Click trash icon.

---

## One More Thing

This tool is **made with ❤️** for content creators who want to automate repetitive tasks.

Use it to:
- Generate batch content for social media
- Create variation videos from different prompts
- Test VEO3's capabilities at scale
- Speed up your creative workflow

**Happy creating!** 🎬

---

**Ready?** → Install Tampermonkey → Install script → Open VEO3 → Go! 🚀
