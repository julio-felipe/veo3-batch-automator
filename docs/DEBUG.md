# Debug Guide - VEO3 Batch Automator

This guide helps you troubleshoot issues with the VEO3 Batch Automator script.

---

## Quick Diagnostics

### Step 1: Open Browser Console
Press `F12` to open Developer Tools, then go to the **Console** tab.

### Step 2: Check for Startup Messages
You should see:
```
🎬 VEO3 Batch Automator v0.1.0 - Initializing...
👤 Created by j. felipe
🔍 Running VEO3 Page Diagnostics...
```

If you don't see these, the script is not loaded properly.

### Step 3: Check Diagnostics Output
The console will show which elements were found:
```
✅ Found input: textarea[placeholder*="Crie um vídeo"]
✅ Found send button: button[type="submit"]
✅ Found progress bar: [role="progressbar"]
```

If you see ❌ instead of ✅, that element couldn't be found.

---

## Common Issues & Solutions

### Issue 1: "Panel not found!" or extension doesn't appear

**Causes:**
- Tampermonkey is disabled
- Script didn't load
- Page already loaded before script installed

**Solutions:**
```
1. Ensure Tampermonkey is enabled (icon visible in toolbar)
2. Refresh the page (F5)
3. Check Tampermonkey Dashboard for any errors:
   - Click Tampermonkey icon → Dashboard
   - Look for error messages
4. Reinstall the script from scratch
```

### Issue 2: "Input field not found"

**Console shows:**
```
❌ Could not find input element. DOM may have changed.
```

**Solutions:**
```
1. VEO3 UI may have changed
2. You're not on the correct VEO3 page
3. Page is still loading

Try:
- Refresh and wait 3 seconds before using
- Verify URL is: https://labs.google/fx/pt/tools/flow/project/[ID]
- Check if VEO3 layout changed in Google's latest update
```

### Issue 3: "Send button not found"

**Console shows:**
```
❌ Could not find send element. DOM may have changed.
```

**Solutions:**
```
1. The send button selector changed
2. VEO3 updated its UI

Debug steps:
1. Open Inspector (F12 → Inspector tab)
2. Click the element picker (top left arrow)
3. Click the arrow button next to the input field
4. Look at the HTML - note the classes and attributes
5. Report this to get the script updated
```

### Issue 4: Progress never completes

**Console shows:**
```
📊 Progress: 50%
📊 Progress: 75%
(... stuck waiting ...)
```

**Solutions:**
```
1. Video generation is slow (VEO3 is processing)
   → Increase PROGRESS_TIMEOUT in config:
   CONFIG.PROGRESS_TIMEOUT = 300000 (5 minutes)

2. Progress bar selector changed
   → Report the issue with screenshot

3. VEO3 is rate limiting you
   → Wait a few minutes and try again
   → Check your VEO3 credits
```

### Issue 5: Download button not found

**Console shows:**
```
❌ Could not find download element. DOM may have changed.
```

**Solutions:**
```
1. Download button selector needs updating
2. Video generation failed silently

Debug steps:
1. Look at the generated video on screen
2. Is there a download icon? (should be ⬇)
3. If yes - inspect it and report HTML structure
4. If no - video may not have generated successfully
```

### Issue 6: Downloads aren't happening

**Possible causes:**
```
1. Browser is blocking downloads
   → Check download settings
   → Add site to allowed list

2. Downloads folder is full or read-only
   → Check permissions

3. Download button isn't being clicked
   → Check console for errors
   → Try manually clicking the button

4. Video file is still being generated
   → Download starts but file is incomplete
   → Increase DOWNLOAD_TIMEOUT
```

---

## How to Report Issues

### Before Reporting

1. **Reproduce the issue:**
   - Clear cache (Ctrl+Shift+Delete)
   - Reinstall script
   - Try again with 1 simple prompt

2. **Check the console:**
   - Press F12 → Console
   - Copy all red errors

3. **Inspect the problem element:**
   - Right-click the element → Inspect
   - Screenshot the HTML structure

4. **Document your environment:**
   - Browser: Chrome / Firefox / Safari / Edge
   - OS: Windows / Mac / Linux
   - VEO3 URL
   - Prompt being used

### Report Template

```
**Browser:** Chrome / Firefox / Safari / Edge
**OS:** Windows 11 / Mac M1 / Linux

**Error:** [Copy error message from console]

**Steps to reproduce:**
1. Open VEO3 at [URL]
2. Paste this prompt: [Your prompt]
3. Click "Iniciar"
4. [What happened?]

**Expected behavior:**
[What should have happened]

**Console errors:**
[Copy paste from F12 Console]

**Screenshots:**
[Include if possible]
```

---

## Advanced Debugging

### Enable Verbose Logging

Add this to the script (before the closing `})()` ):

```javascript
// Enable verbose mode
window.VEO3_DEBUG = true;

// Add to updateStatus function:
if (window.VEO3_DEBUG) {
  console.log(`[DEBUG] Current state:`, state);
  console.log(`[DEBUG] DOM elements:`, {
    input: document.querySelector(SELECTORS.inputField),
    sendBtn: document.querySelector(SELECTORS.sendButton),
    progress: document.querySelector(SELECTORS.progressBar)
  });
}
```

### Inspect DOM Manually

In console, run:

```javascript
// Find all buttons
Array.from(document.querySelectorAll('button')).forEach((b, i) => {
  console.log(`Button ${i}:`, b.textContent, b.className, b.getAttribute('aria-label'));
});

// Find all textareas
Array.from(document.querySelectorAll('textarea')).forEach((t, i) => {
  console.log(`Textarea ${i}:`, t.placeholder, t.className);
});

// Find all elements with "download" in attributes
Array.from(document.querySelectorAll('[*]')).filter(el => {
  const attrs = Array.from(el.attributes).map(a => `${a.name}=${a.value}`).join(' ');
  return attrs.toLowerCase().includes('download');
}).forEach(el => console.log(el.outerHTML.substring(0, 200)));
```

### Monitor DOM Changes

In console:

```javascript
// Watch for new elements being added
const observer = new MutationObserver((mutations) => {
  console.log('🔍 DOM Changed:', mutations.length, 'mutations');
  mutations.forEach(m => {
    if (m.addedNodes.length > 0) {
      console.log('  Added:', m.addedNodes[0].className || m.addedNodes[0].tagName);
    }
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['aria-valuenow', 'style']
});
```

---

## Testing Checklist

Use this to verify the script works:

- [ ] Panel appears on page load (right side, purple)
- [ ] Can paste text into textarea
- [ ] "▶ Iniciar" button is clickable
- [ ] Start with 1 prompt to test
- [ ] Watch console for diagnostics output
- [ ] Verify element detection (should show ✅)
- [ ] Confirm progress monitoring updates
- [ ] Check that download button appears when video ready
- [ ] Verify "⏸ Pausar" button enables during execution

---

## Support

For detailed help, open an issue with:
1. **Console output** (F12 → Console, right-click → Save as)
2. **Element HTML** (F12 → Inspector, right-click element → Copy outer HTML)
3. **Steps to reproduce** (exactly what you did)
4. **Expected vs actual behavior**

Made with ❤️ by j. felipe
