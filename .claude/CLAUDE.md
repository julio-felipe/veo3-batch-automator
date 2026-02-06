# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**VEO3 Batch Automator** is a Tampermonkey userscript that automates batch video generation in Google Veo 3.1. It runs entirely in the browser with no external dependencies, focusing on DOM manipulation, event dispatching, and progress monitoring.

**Project Type:** Tampermonkey userscript (vanilla JavaScript ES6+)
**Target:** Chrome, Firefox, Safari, Edge browsers
**Main File:** `veo3-batch-automator.user.js`

---

## Project Structure

```
veo3-batch-automator/
├── veo3-batch-automator.user.js    # Main script (single monolithic file)
├── README.md                        # User documentation
├── TESTING.md                       # QA testing procedures
├── DEBUG.md                         # Troubleshooting guide
├── CHANGELOG.md                     # Version history
├── .claude/                         # Claude Code configuration
│   └── CLAUDE.md                    # This file
└── Documentation files              # Other guides (START_HERE.md, FAQ_SIMPLES.md, etc.)
```

---

## Architecture & Core Concepts

### Script Architecture

The userscript is organized into **functional sections** marked by comments:

```javascript
// STATE MANAGEMENT
// SELECTORS & CONSTANTS
// UI PANEL CREATION
// DOM UTILITIES
// CORE AUTOMATION LOGIC
// EVENT LISTENERS
// INITIALIZATION
```

### Key Design Patterns

**1. Multiple Selector Strategies**
- The script uses **arrays of selectors** for each element (input, button, progress bar, etc.)
- Falls back through multiple options to handle UI variations and updates
- Example:
  ```javascript
  const inputField = [
    'textarea[placeholder*="Crie um vídeo"]',
    'textarea[placeholder*="crie um vídeo"]',
    'input[placeholder*="Crie"]',
    '[contenteditable="true"]'
  ];
  ```
- This makes the script **robust to minor UI changes** without requiring full rewrites

**2. State Machine Pattern**
- Global `state` object tracks: `isRunning`, `isPaused`, `currentIndex`, `prompts`, `downloadedCount`, `statusLog`
- Single source of truth for automation state
- Enables pause/resume without complex context switching

**3. Configuration Constants**
- Timing and polling behavior isolated in `CONFIG` object
- Users can adjust: `POLL_INTERVAL`, `PROGRESS_TIMEOUT`, `DOWNLOAD_TIMEOUT`, `INTER_PROMPT_DELAY`
- Facilitates tuning without code changes

**4. Async/Await Pattern**
- Non-blocking operations throughout
- Uses `Promise` with `async/await` for sequential automation
- Polling loops use recursive `setTimeout` for event detection

### Automation Workflow

```
1. User pastes prompts into textarea (one per line)
2. Clicks "▶ Iniciar" button
3. For each prompt:
   ├─ Inject text into input field
   ├─ Click send button
   ├─ Poll progress bar until 100%
   ├─ Detect video completion
   ├─ Click download button
   ├─ Wait for download completion (5-10 seconds)
   └─ Add inter-prompt delay
4. Update status log and show completion summary
```

---

## Common Development Tasks

### Updating Element Selectors

VEO3 UI changes may require updating selectors. When a selector fails:

1. Open browser DevTools (F12)
2. Inspect the element you're looking for
3. Find the most reliable selector (IDs > aria-labels > data attributes > classes)
4. Add it to the appropriate array in `SELECTORS` object
5. Test with manual browser interaction first
6. Update TESTING.md with any new selector information

**Example:**
```javascript
// Before
const downloadButton = [
  'button[aria-label*="baixa"]',
  'button[aria-label*="download"]'
];

// After (added new selector)
const downloadButton = [
  'button[aria-label*="baixa"]',
  'button[aria-label*="download"]',
  'button[data-testid="download-btn"]'  // New selector added
];
```

### Adjusting Timing Parameters

Edit `CONFIG` object at the top of the script:

```javascript
const CONFIG = {
  POLL_INTERVAL: 500,           // How often to check progress (ms)
  PROGRESS_TIMEOUT: 180000,     // Max wait for video generation (3 min)
  DOWNLOAD_TIMEOUT: 30000,      // Max wait to detect download (30 sec)
  INTER_PROMPT_DELAY: 2000      // Delay between prompts (2 sec)
};
```

**When to adjust:**
- **Slow VEO3 response?** → Increase `PROGRESS_TIMEOUT` to 300000 (5 min)
- **Download not detected?** → Increase `DOWNLOAD_TIMEOUT` to 60000 (1 min)
- **Faster generation?** → Reduce `INTER_PROMPT_DELAY` to 1000 (1 sec)

### Adding Error Recovery

The script has basic error handling. To enhance it:

1. Locate the error handling section in the relevant function
2. Add logging to `state.statusLog` for user feedback
3. Update the status display panel
4. Consider adding retry logic if appropriate

**Pattern:**
```javascript
try {
  const element = findElement(SELECTORS.inputField);
  if (!element) {
    state.statusLog.push('❌ Input field not found');
    // Decide: retry, skip, or abort
  }
} catch (error) {
  state.statusLog.push(`❌ Error: ${error.message}`);
  logToConsole(`[ERROR] ${error.message}`, 'error');
}
```

---

## Testing & Validation

### Manual Testing Flow

1. **Setup:**
   - Install Tampermonkey in browser
   - Paste the userscript content
   - Navigate to VEO3 project page
   - Verify purple panel appears

2. **Element Detection Test:**
   - Open DevTools (F12 → Console)
   - Verify startup messages appear
   - Check for ✅ or ❌ for each element (input, button, progress, download)

3. **Single Prompt Test:**
   - Paste one simple prompt
   - Click "▶ Iniciar"
   - Monitor progress bar in VEO3
   - Verify download initiates
   - Check status log for success/error

4. **Batch Test:**
   - Paste 3-5 prompts
   - Run full batch
   - Verify all videos generated
   - Check that downloads worked

### Debugging Steps

1. **Panel not appearing?**
   - Check Tampermonkey Dashboard for errors
   - Verify script is enabled and has correct URL match
   - Try refreshing the page

2. **Elements not found?**
   - Open DevTools (F12 → Inspector)
   - Search for elements manually
   - Compare current selectors with found elements
   - Update `SELECTORS` if VEO3 UI changed

3. **Progress not detected?**
   - Use Inspector to find actual progress bar element
   - Note the attributes (class, role, aria-label, etc.)
   - Check if polling intervals are too short

4. **Downloads not working?**
   - Check browser download folder
   - Verify downloads aren't blocked in browser settings
   - Monitor `DOWNLOAD_TIMEOUT` - may need adjustment

---

## Documentation Files Reference

| File | Purpose | When to Update |
|------|---------|-----------------|
| README.md | User installation & usage guide | New features, breaking changes |
| TESTING.md | QA test procedures & checklist | Element selector changes, new features |
| DEBUG.md | Troubleshooting guide | Common issues, error messages |
| CHANGELOG.md | Version history | Every release |
| SECURITY_AUDIT.md | Security analysis | After security review |

---

## AIOS Framework Context

This project is part of **Synkra AIOS** and follows these conventions:

- **Story-driven development:** Changes tracked in `.claude/commands/AIOS/agents/`
- **Agent activation:** Use `@dev`, `@qa`, `@architect` for specific concerns
- **Configuration:** See `.aios-core/core-config.yaml` for AIOS settings
- **Testing:** Manual testing required (see TESTING.md)

---

## Code Style & Standards

### JavaScript Conventions

- **ES6+ syntax:** Use modern JavaScript (arrow functions, const/let, async/await)
- **No external dependencies:** Keep script lightweight for quick loading
- **Inline comments:** Use `// Comment` for complex logic sections
- **Clear variable names:** Prefer `inputField` over `input` or `i`
- **Error handling:** Always use try/catch for DOM operations that may fail

### Common Patterns Used

**Finding elements with fallback:**
```javascript
function findElement(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}
```

**Polling for completion:**
```javascript
function pollForCompletion(checkFn, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const poll = () => {
      if (checkFn()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for completion'));
      } else {
        setTimeout(poll, CONFIG.POLL_INTERVAL);
      }
    };
    poll();
  });
}
```

**Injecting text and triggering events:**
```javascript
const input = findElement(SELECTORS.inputField);
input.value = prompt;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

---

## Quick Reference

### Key Files to Edit

| Change Type | File |
|------------|------|
| Add/fix selectors | `veo3-batch-automator.user.js` (SELECTORS section) |
| Adjust timing | `veo3-batch-automator.user.js` (CONFIG section) |
| Fix bugs | `veo3-batch-automator.user.js` (relevant function) |
| Update user docs | `README.md` |
| Update test procedures | `TESTING.md` |
| Document issues | `DEBUG.md` |

### Browser DevTools Tips

- **F12** - Open DevTools
- **F12 → Console** - View script logs and errors
- **F12 → Inspector** - Inspect DOM elements
- **F12 → Network** - Monitor downloads
- **Ctrl+Shift+K** - Quick console

---

## Important Notes

1. **Single File Structure:** All code lives in one `veo3-batch-automator.user.js` file. Keep it organized with clear section comments.

2. **No Build Step:** This is a userscript - no compilation, bundling, or build process needed.

3. **Browser Environment:** Script runs in browser context. No Node.js APIs available.

4. **No External Deps:** No npm packages. All utilities must be vanilla JavaScript.

5. **VEO3 Updates:** Watch for Google VEO3 UI changes. Update selectors as needed.

6. **Testing is Manual:** Automated testing isn't feasible for DOM automation. Follow TESTING.md procedures.

---

**Last Updated:** 2026-02-05
**Created for:** VEO3 Batch Automator v0.1.0
