# Testing Guide - VEO3 Batch Automator

Complete testing checklist and procedures for the VEO3 Batch Automator.

---

## Pre-Testing Setup

### Requirements
- ✅ Chrome, Firefox, Safari, or Edge browser
- ✅ Tampermonkey extension installed
- ✅ Active Google account with VEO3 access
- ✅ Sufficient VEO3 credits (each video uses ~20 credits)
- ✅ 30+ minutes of free time for full test cycle

### Installation Verification

1. **Verify Tampermonkey is installed:**
   - Browser toolbar should show Tampermonkey icon
   - Click icon → Dashboard → Should show installed scripts

2. **Install the script:**
   - Copy `veo3-batch-automator.user.js` content
   - Click Tampermonkey → Create a new script
   - Paste content → Save (Ctrl+S)

3. **Verify installation:**
   - Refresh any open VEO3 tab
   - Purple panel should appear on right side

---

## Test Suite 1: UI & Panel

### Test 1.1: Panel Appears
```
✓ Open https://labs.google/fx/pt/tools/flow/project/[YOUR_PROJECT_ID]
✓ Wait 2 seconds
✓ Look for purple panel on right side
✓ Verify it says "🎬 VEO3 Batch Automator"
✓ Check console (F12 → Console) for startup messages
```

**Expected:**
- Purple panel visible
- No red errors in console
- Startup message: "🎬 VEO3 Batch Automator v0.1.0"

**Pass / Fail:** ___

---

### Test 1.2: Panel UI Elements

```
✓ Verify panel has:
  - Title: "🎬 VEO3 Batch Automator"
  - Subtitle: "by j. felipe"
  - Textarea for prompts
  - "▶ Iniciar" button (green)
  - "⏸ Pausar" button (orange, disabled)
  - Status display area
✓ Try scrolling in textarea
✓ Try scrolling in status display
```

**Expected:**
- All UI elements present and visible
- Buttons are properly styled
- Scrolling works in both areas

**Pass / Fail:** ___

---

## Test Suite 2: Element Detection

### Test 2.1: Diagnostics Console Output

```
✓ Open VEO3 page
✓ Open F12 → Console
✓ Look for diagnostic output (shows ✅ or ❌ for elements)
```

**Expected to find:**
```
✅ Found input: [selector]
✅ Found send button: [selector]
✅ Found progress bar: [selector]
```

**If any show ❌:**
- Note which element failed
- See DEBUG.md for solutions

**Pass / Fail:** ___

---

## Test Suite 3: Single Prompt Test

### Test 3.1: Paste and Validate Prompt

```
✓ Click in textarea
✓ Paste this simple prompt:
  "a cute dog playing in the grass"
✓ Verify text appears in textarea
```

**Expected:**
- Text appears correctly

**Pass / Fail:** ___

---

### Test 3.2: Start Batch Process

```
✓ Click "▶ Iniciar" button
✓ Watch status display update
✓ Check console (F12 → Console) for messages
```

**Expected in console:**
```
✍️ Prompt injetado: "a cute dog playing..."
🚀 Enviado para geração...
📊 Progress: [increasing %]
```

**Expected on screen:**
- Status shows "Prompt injetado"
- Status shows "Enviado para geração"
- Status shows progress percentage

**Pass / Fail:** ___

---

### Test 3.3: Progress Monitoring

```
✓ Watch status for progress updates
✓ Should see: "📊 Progress: 50%" → "📊 Progress: 100%"
✓ Wait until status shows "✅ Download concluído"
✓ Check "Baixados: 1/1"
```

**Expected timeline:**
- T+0s: Prompt sent
- T+5-10s: Progress updates appear
- T+30-120s: Video generation completes
- T+130s: Download completes

**Known:** VEO3 typically takes 30-120 seconds per video

**Pass / Fail:** ___

---

### Test 3.4: Download Verification

```
✓ Once batch is complete
✓ Open browser Downloads folder (Ctrl+Shift+J in Chrome)
✓ Look for .mp4 file
✓ Verify file size > 100KB (actual video)
```

**Expected:**
- One .mp4 file in downloads
- File has timestamp showing it was just downloaded
- File size reasonable (>1MB typically)

**Pass / Fail:** ___

---

## Test Suite 4: Multiple Prompts

### Test 4.1: Three-Prompt Batch

```
✓ Clear textarea
✓ Paste these 3 prompts (one per line):
  a red apple on a table
  a blue butterfly flying
  a green tree in the forest

✓ Click "▶ Iniciar"
✓ Watch status display
✓ Wait for completion (~3-5 minutes)
```

**Expected:**
- Status shows "Processando: 1/3"
- After first completes: "Processando: 2/3"
- After second: "Processando: 3/3"
- Final: "Baixados: 3/3"

**Pass / Fail:** ___

---

### Test 4.2: Download Count Verification

```
✓ Check Downloads folder
✓ Should see 3 .mp4 files
✓ Each should have timestamp within last few minutes
```

**Expected:**
- 3 new .mp4 files
- All have video content (size > 1MB each)

**Pass / Fail:** ___

---

## Test Suite 5: Pause/Resume

### Test 5.1: Pause During Batch

```
✓ Start batch with 3 prompts
✓ After first video starts processing (status shows "Enviado para geração...")
✓ Click "⏸ Pausar" button
✓ Status should change
```

**Expected:**
- Status shows "⏸ Pausado"
- Button changes to "▶ Retomar"
- Process halts (no more activity)

**Pass / Fail:** ___

---

### Test 5.2: Resume After Pause

```
✓ Wait 5 seconds while paused
✓ Click "▶ Retomar" button
✓ Batch should continue
```

**Expected:**
- Status shows "▶ Retomado"
- Process resumes
- Remaining videos process normally

**Pass / Fail:** ___

---

## Test Suite 6: Error Handling

### Test 6.1: Empty Prompts Error

```
✓ Clear textarea completely
✓ Click "▶ Iniciar"
```

**Expected:**
- Alert dialog: "Por favor, adicione pelo menos um prompt!"

**Pass / Fail:** ___

---

### Test 6.2: Long Prompt

```
✓ Create a very long prompt (3-4 paragraphs)
✓ Paste into textarea
✓ Click "▶ Iniciar"
✓ Should still work normally
```

**Expected:**
- Prompt injects correctly
- Video generates despite long text
- No UI breaking

**Pass / Fail:** ___

---

### Test 6.3: Special Characters

```
✓ Test prompts with special characters:
  "A dog with émojis: 🐕 playing happily!"
  "São Paulo city with café's"
  "30% off sale @ store"

✓ Click "▶ Iniciar"
```

**Expected:**
- Prompts inject correctly
- No encoding issues
- Video generates normally

**Pass / Fail:** ___

---

## Test Suite 7: Cross-Browser (if applicable)

### Test 7.1: Chrome/Edge

```
✓ Install script in Chrome/Edge
✓ Repeat Test 3 (Single Prompt)
```

**Pass / Fail:** ___

---

### Test 7.2: Firefox

```
✓ Install Tampermonkey in Firefox
✓ Install script
✓ Repeat Test 3 (Single Prompt)
```

**Pass / Fail:** ___

---

### Test 7.3: Safari (if available)

```
✓ Install Tampermonkey in Safari
✓ Install script
✓ Repeat Test 3 (Single Prompt)
```

**Pass / Fail:** ___

---

## Test Suite 8: Edge Cases

### Test 8.1: Rapid Consecutive Batches

```
✓ Complete a single-prompt batch
✓ Immediately start another batch
✓ Should process second batch normally
```

**Expected:**
- Second batch processes without issues
- No UI state problems

**Pass / Fail:** ___

---

### Test 8.2: Page Refresh During Batch

```
✓ Start batch with 5 prompts
✓ After 2-3 prompts complete
✓ Press F5 to refresh page
✓ Panel should reappear
```

**Expected:**
- Panel reappears after refresh
- Batch progress is lost (expected - HTML state doesn't persist)
- No errors in console

**Pass / Fail:** ___

---

### Test 8.3: Session Timeout

```
✓ Start batch with 10 prompts
✓ Let it run for a while
✓ If Google session times out (unlikely):
  - Check if script handles gracefully
```

**Expected:**
- Script should display error message
- Should not crash
- Should allow user to login again

**Pass / Fail:** ___

---

## Performance Testing

### Test P1: Response Time

```
✓ Measure time from "Iniciar" click to status update:
  - Should be < 1 second
✓ Measure time from "Enviado" to first progress update:
  - Should be < 5 seconds
```

**Pass / Fail:** ___

---

### Test P2: Memory Leaks

```
✓ Run 10 consecutive single-prompt batches
✓ Open DevTools → Performance → Memory
✓ Check memory usage:
  - Should not grow indefinitely
  - Memory should stabilize or decrease over time
```

**Pass / Fail:** ___

---

## Final Sign-Off

### Overall Test Results

```
Date tested: _______________
Browser: ___________________
OS: _______________________

Total tests passed: _____ / 20+
Total tests failed: _____

Critical issues:
[List any blocking issues]

Non-critical issues:
[List cosmetic or minor issues]

Tester signature: ___________________
```

---

## Post-Test Actions

### If All Tests Pass ✅
- [ ] Document browser version tested
- [ ] Note any minor observations
- [ ] Script is ready for release

### If Tests Fail ❌
- [ ] Note exact failure in console
- [ ] Screenshot the error
- [ ] Check DEBUG.md for solutions
- [ ] Report issue with full details

---

## Quick Test (5 minutes)

If you're in a hurry, run this minimal test:

```
1. Install script in Tampermonkey
2. Open VEO3 page
3. Verify purple panel appears ✓
4. Paste 1 prompt
5. Click "▶ Iniciar"
6. Wait 2 minutes
7. Check Downloads folder for .mp4 file

If all above complete → Script works! ✅
```

---

Made with ❤️ for j. felipe
