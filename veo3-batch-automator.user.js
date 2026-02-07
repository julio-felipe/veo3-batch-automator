// ==UserScript==
// @name         Veo3 Prompt Batch Automator
// @namespace    https://synkra.io/
// @version      0.9.1
// @description  Automate batch video generation in Google Veo 3.1 — Send All then Download All
// @author       j. felipe
// @match        https://labs.google/fx/pt/tools/flow/project/*
// @match        https://labs.google/fx/*/tools/flow/project/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
  'use strict';

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================
  const state = {
    isRunning: false,
    isPaused: false,
    panelOpen: false,
    currentIndex: 0,
    prompts: [],
    downloadedCount: 0,
    lastDownloadComplete: false,
    lastError: null,
    startTime: null,
    statusLog: [],
    results: [],   // Per-prompt tracking: { index, prompt, filename, status, error }
    lastVideoElement: null,  // Track the most recently generated video
    videoCountBeforeGen: 0,  // Count videos before generation starts
    phase: 'idle',           // 'idle' | 'sending' | 'downloading'
    completedVideos: []      // { index, prompt, videoElement } - tracked for Phase 2 download
  };

  // ============================================================================
  // SELECTORS & CONSTANTS
  // ============================================================================
  const SELECTORS = {
    inputField: [
      'textarea[placeholder*="Crie um vídeo"]',
      'textarea[placeholder*="crie um vídeo"]',
      'input[placeholder*="Crie"]',
      '[contenteditable="true"]',
      'textarea',
      'div[contenteditable="true"]'
    ],

    sendButton: [
      'button:has(i.google-symbols)',
      'button[aria-haspopup="dialog"]',
      'i.google-symbols',
      'button[aria-label*="enviar"]',
      'button[aria-label*="Enviar"]',
      'button[title*="enviar"]',
      'button[title*="Enviar"]',
      'button[type="submit"]'
    ],

    // [H5] More specific — only role=progressbar with aria-valuenow
    progressBar: [
      '[role="progressbar"]',
      '[role="progressbar"][aria-valuenow]',
      '[aria-label*="progress"]',
      '[class*="progress"]:not([id^="veo3"])',
      '[class*="loading"]',
      '.MuiLinearProgress-root',
      '[data-testid*="progress"]',
      '[data-testid*="loading"]'
    ],

    videoContainer: [
      'video',
      '[class*="video"]',
      '[data-testid*="video"]',
      'main',
      '[role="main"]',
      'iframe'
    ]
  };

  const CONFIG = {
    POLL_INTERVAL: 500,
    PROGRESS_TIMEOUT: 480000,     // 8 minutes
    DOWNLOAD_TIMEOUT: 30000,      // 30 seconds
    INTER_PROMPT_DELAY_MIN: 3000, // Min delay between prompts (3s)
    INTER_PROMPT_DELAY_MAX: 7000, // Max delay between prompts (7s)
    TYPING_DELAY_PER_CHAR: 35,    // ~35ms per character (realistic typing speed)
    TYPING_DELAY_JITTER: 15,      // ±15ms jitter per character
    MICRO_DELAY_MIN: 200,         // Min micro-delay between actions (ms)
    MICRO_DELAY_MAX: 600,         // Max micro-delay between actions (ms)
    DOWNLOAD_FOLDER: 'veo3-batch' // Subfolder in Downloads
  };

  // ============================================================================
  // UI: FLOATING BUBBLE + EXPANDABLE PANEL
  // ============================================================================

  function getSavedBubblePosition() {
    try {
      const saved = localStorage.getItem('veo3-bubble-pos');
      if (saved) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return { right: 20, bottom: 20 };
  }

  function saveBubblePosition(right, bottom) {
    try {
      localStorage.setItem('veo3-bubble-pos', JSON.stringify({ right, bottom }));
    } catch (e) { /* ignore */ }
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes veo3-pulse {
        0%, 100% { box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4); }
        50% { box-shadow: 0 4px 25px rgba(102, 126, 234, 0.8); }
      }
      @keyframes veo3-fade-in {
        from { opacity: 0; transform: scale(0.9) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      @keyframes veo3-fade-out {
        from { opacity: 1; transform: scale(1) translateY(0); }
        to { opacity: 0; transform: scale(0.9) translateY(10px); }
      }
      #veo3-bubble.veo3-running {
        animation: veo3-pulse 1.5s ease-in-out infinite;
      }
      #veo3-panel.veo3-panel-open {
        animation: veo3-fade-in 0.2s ease-out forwards;
      }
      #veo3-panel.veo3-panel-closing {
        animation: veo3-fade-out 0.15s ease-in forwards;
      }
    `;
    document.head.appendChild(style);
  }

  function createFloatingBubble() {
    const pos = getSavedBubblePosition();

    const bubble = document.createElement('div');
    bubble.id = 'veo3-bubble';
    bubble.style.cssText = `
      position: fixed;
      right: ${pos.right}px;
      bottom: ${pos.bottom}px;
      width: 50px;
      height: 50px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 10001;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
      user-select: none;
      transition: transform 0.15s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    bubble.innerHTML = `<span style="color: white; font-weight: 700; font-size: 13px; letter-spacing: 0.5px; pointer-events: none;">VEO</span>`;

    const badge = document.createElement('div');
    badge.id = 'veo3-badge';
    badge.style.cssText = `
      position: absolute; top: -4px; right: -4px;
      min-width: 20px; height: 20px; background: #4CAF50; color: white;
      border-radius: 10px; font-size: 11px; font-weight: 700;
      display: none; align-items: center; justify-content: center;
      padding: 0 4px; pointer-events: none;
    `;
    bubble.appendChild(badge);

    bubble.addEventListener('mouseenter', () => { bubble.style.transform = 'scale(1.1)'; });
    bubble.addEventListener('mouseleave', () => { bubble.style.transform = 'scale(1)'; });

    // [H4] Drag — listeners registered only during drag, removed on mouseup
    let dragStartX, dragStartY, startRight, startBottom, hasMoved;

    const onBubbleMove = (e) => {
      const dx = dragStartX - e.clientX;
      const dy = dragStartY - e.clientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      bubble.style.right = Math.max(0, Math.min(window.innerWidth - 55, startRight + dx)) + 'px';
      bubble.style.bottom = Math.max(0, Math.min(window.innerHeight - 55, startBottom + dy)) + 'px';
    };

    const onBubbleUp = () => {
      bubble.style.transition = 'transform 0.15s ease';
      document.removeEventListener('mousemove', onBubbleMove);
      document.removeEventListener('mouseup', onBubbleUp);
      if (hasMoved) {
        saveBubblePosition(parseInt(bubble.style.right), parseInt(bubble.style.bottom));
      } else {
        togglePanel();
      }
    };

    bubble.addEventListener('mousedown', (e) => {
      hasMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      startRight = parseInt(bubble.style.right);
      startBottom = parseInt(bubble.style.bottom);
      bubble.style.transition = 'none';
      document.addEventListener('mousemove', onBubbleMove);
      document.addEventListener('mouseup', onBubbleUp);
      e.preventDefault();
    });

    document.body.appendChild(bubble);
    return bubble;
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'veo3-panel';
    panel.style.cssText = `
      position: fixed; right: 20px; bottom: 80px; width: 350px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px; display: none; opacity: 0; overflow: hidden;
    `;

    // [C4] No inline event handlers — all via addEventListener below
    panel.innerHTML = `
      <div id="veo3-panel-header" style="
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px; cursor: grab; background: rgba(0,0,0,0.1);
        border-radius: 12px 12px 0 0; user-select: none;
      ">
        <span style="font-weight: 600; font-size: 14px;">VEO3 Batch Automator</span>
        <div style="display: flex; gap: 8px;">
          <button id="veo3-minimize-btn" style="
            background: none; border: none; color: white; cursor: pointer;
            font-size: 16px; padding: 0 4px; opacity: 0.8; line-height: 1;
          " title="Minimizar">&#8722;</button>
          <button id="veo3-close-btn" style="
            background: none; border: none; color: white; cursor: pointer;
            font-size: 16px; padding: 0 4px; opacity: 0.8; line-height: 1;
          " title="Fechar">&times;</button>
        </div>
      </div>
      <div id="veo3-panel-body" style="padding: 16px;">
        <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 13px;">Prompts (um por linha):</label>
          <textarea id="veo3-prompts-input" style="
            width: 100%; height: 120px; padding: 8px; border: none; border-radius: 6px;
            font-family: monospace; font-size: 12px; resize: vertical; color: #333;
            box-sizing: border-box;
          " placeholder="Paste your prompts here...&#10;One per line"></textarea>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
          <button id="veo3-start-btn" style="
            padding: 10px; background: #4CAF50; color: white; border: none;
            border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;
            transition: background 0.2s;
          ">&#9654; Enviar Todos</button>
          <button id="veo3-download-all-btn" style="
            padding: 10px; background: #2196F3; color: white; border: none;
            border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;
            transition: background 0.2s; opacity: 0.5;
          " disabled>&#128229; Baixar Todos</button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
          <button id="veo3-pause-btn" style="
            padding: 10px; background: #ff9800; color: white; border: none;
            border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;
            transition: background 0.2s;
          " disabled>&#9208; Pausar</button>
          <button id="veo3-stop-btn" style="
            padding: 10px; background: #f44336; color: white; border: none;
            border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;
            transition: background 0.2s;
          " disabled>&#9632; Parar</button>
        </div>
        <div id="veo3-status-display" style="
          background: rgba(255,255,255,0.15); padding: 12px; border-radius: 6px;
          font-size: 11px; line-height: 1.6; max-height: 200px; overflow-y: auto;
          font-family: monospace;
        ">
          <div style="font-weight: 600; margin-bottom: 8px;">Status Log:</div>
          <div id="veo3-progress">Aguardando prompts...</div>
          <div id="veo3-current" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2);">-</div>
          <div id="veo3-downloaded" style="margin-top: 8px; font-weight: 600;">Baixados: 0</div>
          <div id="veo3-folder-hint" style="margin-top: 8px; padding: 8px; background: rgba(33, 150, 243, 0.2); border-radius: 4px; display: none; color: #90CAF9;">
            📂 Arquivos em: Downloads/veo3-batch-001.mp4, etc
          </div>
          <div id="veo3-errors" style="margin-top: 8px; color: #ffcccc; display: none;"></div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // [H4][M5] Panel header drag — listeners on demand, with upper bounds
    const header = document.getElementById('veo3-panel-header');
    let pDragStartX, pDragStartY, pStartRight, pStartBottom;

    const onPanelMove = (e) => {
      const dx = pDragStartX - e.clientX;
      const dy = pDragStartY - e.clientY;
      panel.style.right = Math.max(0, Math.min(window.innerWidth - 360, pStartRight + dx)) + 'px';
      panel.style.bottom = Math.max(0, Math.min(window.innerHeight - 100, pStartBottom + dy)) + 'px';
    };

    const onPanelUp = () => {
      header.style.cursor = 'grab';
      document.removeEventListener('mousemove', onPanelMove);
      document.removeEventListener('mouseup', onPanelUp);
    };

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      pDragStartX = e.clientX;
      pDragStartY = e.clientY;
      pStartRight = parseInt(panel.style.right);
      pStartBottom = parseInt(panel.style.bottom);
      header.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onPanelMove);
      document.addEventListener('mouseup', onPanelUp);
      e.preventDefault();
    });

    // [C4] Button hover via addEventListener (not inline handlers)
    const startBtn = document.getElementById('veo3-start-btn');
    const downloadAllBtn = document.getElementById('veo3-download-all-btn');
    const pauseBtn = document.getElementById('veo3-pause-btn');
    const stopBtn = document.getElementById('veo3-stop-btn');

    startBtn.addEventListener('mouseenter', () => { startBtn.style.background = '#45a049'; });
    startBtn.addEventListener('mouseleave', () => { startBtn.style.background = '#4CAF50'; });
    downloadAllBtn.addEventListener('mouseenter', () => { if (!downloadAllBtn.disabled) downloadAllBtn.style.background = '#1976D2'; });
    downloadAllBtn.addEventListener('mouseleave', () => { if (!downloadAllBtn.disabled) downloadAllBtn.style.background = '#2196F3'; });
    pauseBtn.addEventListener('mouseenter', () => { pauseBtn.style.background = '#e68900'; });
    pauseBtn.addEventListener('mouseleave', () => { pauseBtn.style.background = '#ff9800'; });
    stopBtn.addEventListener('mouseenter', () => { stopBtn.style.background = '#d32f2f'; });
    stopBtn.addEventListener('mouseleave', () => { stopBtn.style.background = '#f44336'; });

    document.getElementById('veo3-close-btn').addEventListener('click', () => togglePanel(false));
    document.getElementById('veo3-minimize-btn').addEventListener('click', () => togglePanel(false));
    startBtn.addEventListener('click', startBatchProcess);
    downloadAllBtn.addEventListener('click', downloadAllVideos);
    pauseBtn.addEventListener('click', togglePause);
    stopBtn.addEventListener('click', stopBatch);

    return panel;
  }

  function togglePanel(forceState) {
    const panel = document.getElementById('veo3-panel');
    if (!panel) return;
    const shouldOpen = forceState !== undefined ? forceState : !state.panelOpen;
    if (shouldOpen) {
      panel.style.display = 'block';
      panel.className = 'veo3-panel-open';
      state.panelOpen = true;
    } else {
      panel.className = 'veo3-panel-closing';
      state.panelOpen = false;
      setTimeout(() => { panel.style.display = 'none'; panel.className = ''; }, 150);
    }
  }

  function updateBubbleBadge() {
    const badge = document.getElementById('veo3-badge');
    const bubble = document.getElementById('veo3-bubble');
    if (!badge || !bubble) return;
    if (state.isRunning) {
      bubble.classList.add('veo3-running');
      badge.style.display = 'flex';
      const phaseIcon = state.phase === 'downloading' ? '📥' : '🚀';
      badge.textContent = `${phaseIcon}${state.currentIndex}/${state.prompts.length}`;
    } else {
      bubble.classList.remove('veo3-running');
      if (state.completedVideos.length > 0 && state.phase === 'idle') {
        badge.style.display = 'flex';
        badge.textContent = `📥${state.completedVideos.length}`;
        badge.style.background = '#2196F3';
      } else {
        badge.style.display = 'none';
        badge.style.background = '#4CAF50';
      }
    }
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================
  function updateStatus(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const statusLog = `[${timestamp}] ${message}`;
    state.statusLog.push(statusLog);
    console.log(statusLog);

    const progressEl = document.getElementById('veo3-progress');
    if (progressEl) {
      const lines = progressEl.textContent.split('\n').slice(-4);
      lines.push(message);
      progressEl.textContent = lines.join('\n');
    }

    // Show folder hint when downloads are complete
    if (message.includes('Downloads/')) {
      const hintEl = document.getElementById('veo3-folder-hint');
      if (hintEl) {
        hintEl.style.display = 'block';
      }
    }

    if (type === 'error') {
      const errorsEl = document.getElementById('veo3-errors');
      if (errorsEl) {
        errorsEl.style.display = 'block';
        errorsEl.textContent = message;
      }
      state.lastError = message;
    }

    updateBubbleBadge();
  }

  // [H1] Do NOT remove duplicates — user may want the same prompt multiple times
  function parsePrompts(text) {
    return text
      .split(/\r\n|\r|\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Human-like random delay using Box-Muller transform for gaussian distribution
  function gaussianRandom(mean, stdDev) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, mean + z * stdDev);
  }

  // Natural delay between prompts: 3-7s with gaussian spread around the center
  async function humanDelay() {
    const min = CONFIG.INTER_PROMPT_DELAY_MIN;
    const max = CONFIG.INTER_PROMPT_DELAY_MAX;
    const mean = (min + max) / 2;
    const stdDev = (max - min) / 4; // 95% of values within min-max
    const delay = Math.round(Math.max(min, Math.min(max, gaussianRandom(mean, stdDev))));
    console.log(`⏱️ Human delay: ${(delay / 1000).toFixed(1)}s`);
    updateStatus(`⏳ Aguardando ${(delay / 1000).toFixed(1)}s...`);
    await sleep(delay);
  }

  // Small random pause between micro-actions (click, type, focus)
  async function microDelay() {
    const delay = CONFIG.MICRO_DELAY_MIN + Math.random() * (CONFIG.MICRO_DELAY_MAX - CONFIG.MICRO_DELAY_MIN);
    await sleep(Math.round(delay));
  }

  function findElement(selectorList, purpose = 'unknown') {
    if (typeof selectorList === 'string') {
      selectorList = [selectorList];
    }

    // =========================================================================
    // SMART SEND BUTTON DETECTION
    // =========================================================================
    if (purpose === 'send') {
      const allGoogleSymbolIcons = Array.from(document.querySelectorAll('i.google-symbols'));
      for (const icon of allGoogleSymbolIcons) {
        const iconText = (icon.textContent || '').trim().toLowerCase();
        if (iconText === 'arrow_forward' || iconText === 'send' || iconText === 'arrow_upward') {
          const btn = icon.closest('button');
          if (btn && btn.offsetParent !== null) {
            console.log(`✅ Found SEND button: icon="${iconText}"`);
            return btn;
          }
        }
      }

      const textarea = document.querySelector('#PINHOLE_TEXT_AREA_ELEMENT_ID, textarea[placeholder*="Crie"], textarea');
      if (textarea) {
        const parent = textarea.closest('div[class]');
        if (parent) {
          let container = parent;
          for (let i = 0; i < 5; i++) {
            const btns = container.querySelectorAll('button');
            for (const btn of btns) {
              const text = (btn.textContent || '').toLowerCase();
              if (text.includes('edit') || text.includes('editar') || text.includes('delete')) continue;
              const hasArrow = btn.querySelector('i.google-symbols');
              if (hasArrow && btn.offsetParent !== null) {
                const it = (hasArrow.textContent || '').trim().toLowerCase();
                if (it !== 'edit' && it !== 'more_vert' && it !== 'close') {
                  console.log(`✅ Found SEND near textarea: icon="${it}"`);
                  return btn;
                }
              }
            }
            container = container.parentElement;
            if (!container) break;
          }
        }
      }

      const buttons = Array.from(document.querySelectorAll('button'));
      const sendBtn = buttons.find(b => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        const title = (b.title || '').toLowerCase();
        return label.includes('enviar') || title.includes('enviar') ||
               label.includes('send') || title.includes('send');
      });
      if (sendBtn) return sendBtn;

      console.warn('⚠️ Could not find SEND button.');
      return null;
    }

    // =========================================================================
    // SMART DOWNLOAD BUTTON DETECTION
    // [C3] All strategies check visibility (offsetParent !== null)
    // =========================================================================
    if (purpose === 'download') {
      const allGoogleSymbolIcons = Array.from(document.querySelectorAll('i.google-symbols'));
      for (const icon of allGoogleSymbolIcons) {
        const iconText = (icon.textContent || '').trim().toLowerCase();
        if (iconText === 'download' || iconText === 'file_download' || iconText === 'save_alt') {
          const btn = icon.closest('button') || icon.closest('a') || icon.closest('[role="button"]');
          if (btn && btn.offsetParent !== null) {
            console.log(`✅ Found DOWNLOAD: icon="${iconText}"`);
            return btn;
          }
        }
      }

      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const dlBtn = buttons.find(b => {
        if (b.offsetParent === null) return false;
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        const title = (b.title || '').toLowerCase();
        const text = (b.textContent || '').toLowerCase();
        return label.includes('baixa') || label.includes('download') ||
               title.includes('baixa') || title.includes('download') ||
               text.includes('baixar') || text.includes('download');
      });
      if (dlBtn) return dlBtn;

      const downloadLink = document.querySelector('a[download]');
      if (downloadLink) return downloadLink;

      return null;
    }

    // =========================================================================
    // GENERIC ELEMENT DETECTION (input, progress)
    // =========================================================================
    for (const selector of selectorList) {
      try {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) {
          return el;
        }
      } catch (e) { /* selector may be invalid */ }
    }

    if (purpose === 'input') {
      const textareas = Array.from(document.querySelectorAll('textarea'));
      const input = textareas.find(ta => ta.placeholder?.includes('vídeo') || ta.placeholder?.includes('Vídeo'));
      if (input) return input;
    }

    if (purpose !== 'download') {
      console.warn(`⚠️ Could not find ${purpose} element.`);
    }
    return null;
  }

  // [H2] Lightweight download button presence check (no heavy DOM queries)
  function hasDownloadButton() {
    const icons = document.querySelectorAll('i.google-symbols');
    for (const icon of icons) {
      const t = (icon.textContent || '').trim().toLowerCase();
      if ((t === 'download' || t === 'file_download' || t === 'save_alt') && icon.offsetParent !== null) {
        return true;
      }
    }
    return false;
  }

  // ============================================================================
  // CORE AUTOMATION LOGIC
  // ============================================================================
  async function injectPrompt(prompt) {
    const inputField = findElement(SELECTORS.inputField, 'input');
    if (!inputField) {
      throw new Error('Input field not found.');
    }

    // Human-like: focus with micro-delay
    inputField.focus();
    await microDelay();
    inputField.click();
    await microDelay();

    // unsafeWindow needed in sandbox mode (GM_download grant)
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      win.HTMLTextAreaElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype, 'value'
    )?.set;

    // Clear field first
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(inputField, '');
      inputField.dispatchEvent(new Event('input', { bubbles: true }));
      await microDelay();
    }

    // Simulate typing delay proportional to prompt length
    const typingTime = prompt.length * CONFIG.TYPING_DELAY_PER_CHAR
                     + (Math.random() - 0.5) * 2 * prompt.length * CONFIG.TYPING_DELAY_JITTER;
    const clampedTypingTime = Math.max(300, Math.min(3000, typingTime));
    console.log(`⌨️ Simulating typing: ${prompt.length} chars in ${(clampedTypingTime / 1000).toFixed(1)}s`);
    await sleep(clampedTypingTime);

    // Set full value (React-compatible)
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(inputField, prompt);
    } else {
      inputField.value = prompt;
    }

    inputField.dispatchEvent(new Event('input', { bubbles: true }));
    await microDelay();
    inputField.dispatchEvent(new Event('change', { bubbles: true }));
    await microDelay();

    if (inputField.value !== prompt) {
      console.warn(`⚠️ Injection mismatch: expected ${prompt.length} chars, got ${inputField.value.length}`);
    }

    updateStatus(`✍️ Prompt injetado: "${prompt.substring(0, 40)}..."`);
  }

  async function clickSendButton() {
    const sendBtn = findElement(SELECTORS.sendButton, 'send');
    if (!sendBtn) throw new Error('Send button not found.');
    if (sendBtn.offsetParent === null) throw new Error('Send button not visible.');

    // Human-like click sequence with natural micro-delays
    sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await sleep(40 + Math.random() * 80); // 40-120ms hold
    sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    await sleep(10 + Math.random() * 30); // 10-40ms release-to-click
    sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    // Single dispatch only — no .click() to avoid double send

    updateStatus('🚀 Enviado para geração...');
  }

  async function waitForProgressCompletion() {
    const startTime = Date.now();
    let lastProgress = 0;
    let initialDOMSize = document.body.innerHTML.length;

    // Count existing videos BEFORE generation starts
    state.videoCountBeforeGen = document.querySelectorAll('video').length;
    console.log(`📊 Videos on page before generation: ${state.videoCountBeforeGen}`);

    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        try {
          const elapsed = Date.now() - startTime;

          // Respect stop
          if (!state.isRunning) {
            clearInterval(interval);
            reject(new Error('Batch interrompido'));
            return;
          }

          if (elapsed > CONFIG.PROGRESS_TIMEOUT) {
            clearInterval(interval);
            reject(new Error(`Timeout (${(CONFIG.PROGRESS_TIMEOUT / 60000).toFixed(0)} min)`));
            return;
          }

          // Strategy 1: ARIA progress bars
          const progressBars = document.querySelectorAll('[role="progressbar"]');
          for (const bar of progressBars) {
            const val = bar.getAttribute('aria-valuenow');
            const label = bar.getAttribute('aria-label');

            if (val && parseInt(val) === 100) {
              clearInterval(interval);
              resolve();
              return;
            }
            if (label?.includes('100')) {
              clearInterval(interval);
              resolve();
              return;
            }
            if (val && val !== lastProgress) {
              lastProgress = val;
              updateStatus(`📊 Progresso: ${val}%`);
            }
          }

          // Strategy 2: Completion text near progress elements
          const progressEls = document.querySelectorAll('[role="progressbar"], [class*="progress"], [class*="loading"]');
          for (const el of progressEls) {
            const nearby = el.parentElement?.textContent || '';
            if (nearby.includes('100%') || nearby.includes('completo') || nearby.includes('concluído')) {
              clearInterval(interval);
              resolve();
              return;
            }
          }

          // Strategy 3: NEW video element appeared (more than before) - CHECK FIRST
          const currentVideos = document.querySelectorAll('video');
          if (currentVideos.length > state.videoCountBeforeGen) {
            // New video appeared! Mark it as the target
            state.lastVideoElement = currentVideos[currentVideos.length - 1];
            state.lastVideoElement.setAttribute('data-veo3-batch-target', 'true');
            console.log(`✅ NEW video detected (${currentVideos.length} total, was ${state.videoCountBeforeGen})`);
            clearInterval(interval);
            resolve();
            return;
          }

          // Strategy 4: Download button appeared [H2 lightweight check]
          if (hasDownloadButton()) {
            console.log('✅ Download button appeared');
            // Also mark the newest video as target (fallback if video count didn't increase)
            const allVideos = document.querySelectorAll('video');
            if (allVideos.length > 0) {
              state.lastVideoElement = allVideos[allVideos.length - 1];
              state.lastVideoElement.setAttribute('data-veo3-batch-target', 'true');
              console.log(`📌 Marked newest video as target (${allVideos.length} total)`);
            }
            clearInterval(interval);
            resolve();
            return;
          }

          // Strategy 5: Download link
          if (document.querySelector('a[href*="download"], a[download]')) {
            clearInterval(interval);
            resolve();
            return;
          }

          // Log every 15s
          if (elapsed % 15000 < CONFIG.POLL_INTERVAL) {
            console.log(`⏳ Waiting... (${(elapsed / 1000).toFixed(0)}s)`);
          }
        } catch (e) {
          console.debug(`Progress check error: ${e.message}`);
        }
      }, CONFIG.POLL_INTERVAL);
    });
  }

  // ============================================================================
  // MANIFEST & FOLDER ORGANIZATION
  // ============================================================================
  function generateManifest() {
    const timestamp = new Date().toLocaleString('pt-BR');
    const batchId = new Date().getTime();
    const lines = [
      '═══════════════════════════════════════════════════════════════',
      '📦 VEO3 BATCH AUTOMATOR - MANIFEST',
      '═══════════════════════════════════════════════════════════════',
      '',
      `Generated: ${timestamp}`,
      `Batch ID: ${batchId}`,
      `Total Videos: ${state.completedVideos.length}`,
      '',
      '📂 ORGANIZE YOUR FILES:',
      '',
      'Option 1: Create folder manually',
      '  1. Open Downloads folder',
      '  2. Create new folder: "veo3-batch"',
      '  3. Move ALL veo3-batch-*.mp4 files into it',
      '',
      'Option 2: Use command (Windows PowerShell/CMD):',
      '  mkdir "%USERPROFILE%\\Downloads\\veo3-batch"',
      '  move "%USERPROFILE%\\Downloads\\veo3-batch-*.mp4" "%USERPROFILE%\\Downloads\\veo3-batch\\"',
      '',
      'Option 3: Use command (Mac/Linux)',
      '  mkdir -p ~/Downloads/veo3-batch',
      '  mv ~/Downloads/veo3-batch-*.mp4 ~/Downloads/veo3-batch/',
      '',
      '📋 FILES DOWNLOADED:',
      ''
    ];

    state.completedVideos.forEach((entry, idx) => {
      const paddedNum = String(idx + 1).padStart(3, '0');
      lines.push(`  ${paddedNum}. veo3-batch-${paddedNum}.mp4`);
      lines.push(`     Prompt: ${entry.prompt}`);
      lines.push('');
    });

    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('💡 TIPS:');
    lines.push('  • All files start with "veo3-batch-" for easy organization');
    lines.push('  • Use numbered filenames (001, 002, etc) for sorting');
    lines.push('  • Keep this manifest for reference');
    lines.push('');
    lines.push('Questions? See: https://github.com/seu-usuario/veo3-batch-automator');
    lines.push('');

    return lines.join('\n');
  }

  async function downloadManifest() {
    const manifestContent = generateManifest();
    const blob = new Blob([manifestContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'veo3-batch-MANIFEST.txt';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);

    console.log('📄 Manifest downloaded: veo3-batch-MANIFEST.txt');
  }

  // [M1] Use element center for hover coordinates — multi-strategy
  async function hoverOverVideoArea() {
    const selectors = ['video', '[class*="video"]', '[class*="preview"]', '[class*="player"]', '[role="main"] [class*="container"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        // Strategy 1: Standard mouse events on element
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
        await sleep(300);

        // Strategy 2: Also hover on parent containers (VEO3 may listen on wrapper)
        let parent = el.parentElement;
        for (let i = 0; i < 3 && parent; i++) {
          parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
          parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
          parent.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
          parent = parent.parentElement;
        }
        await sleep(300);

        // Strategy 3: PointerEvent (some frameworks listen to pointer, not mouse)
        el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: cx, clientY: cy }));
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }));
        el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: cx, clientY: cy }));
        await sleep(400);

        console.log(`🖱️ Hover on: ${sel} at (${Math.round(cx)}, ${Math.round(cy)})`);
        return true;
      }
    }
    console.warn('🖱️ No video element found for hover');
    return false;
  }

  function findQualityOption(targetText) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip our own UI elements
          if (node.parentElement?.closest('#veo3-panel, #veo3-bubble')) return NodeFilter.FILTER_REJECT;
          return node.textContent.includes(targetText)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let textNode;
    while (textNode = walker.nextNode()) {
      let el = textNode.parentElement;
      while (el && el !== document.body) {
        if (el.matches('button, a, [role="menuitem"], [role="option"], [tabindex], li')) {
          if (el.offsetParent !== null) {
            console.log(`✅ Quality option: "${el.textContent.trim().substring(0, 60)}"`);
            return el;
          }
        }
        el = el.parentElement;
      }
    }

    return null;
  }

  // [C2] Native download via programmatic link creation
  async function triggerNativeDownload(url, filename) {
    console.log(`🎯 Native download: ${url.substring(0, 80)} → ${filename}`);

    // For Google Storage URLs, we need to fetch and then trigger download
    if (url.includes('storage.googleapis.com')) {
      console.log('📥 [DL] Google Storage URL detected - fetching...');

      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        }, 1000);

        state.lastDownloadComplete = true;
        console.log(`✅ Download triggered: ${filename}`);
        updateStatus(`✅ Baixado: ${filename}`);
      } catch (err) {
        console.error('❌ Fetch failed:', err);
        // Fallback: open in new tab (user downloads manually)
        window.open(url, '_blank');
        state.lastDownloadComplete = true;
        updateStatus(`⚠️ Aberto em nova aba: ${filename}`);
      }

      return;
    }

    // Standard blob/local URLs
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.setAttribute('download', filename);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }, 1000);

    state.lastDownloadComplete = true;
    console.log(`✅ Download triggered: ${filename}`);
    updateStatus(`✅ Baixado: ${filename}`);
  }

  // [NEW] Intercept window.open to capture video URLs and prevent tab opening
  function installWindowOpenInterceptor(expectedFilename) {
    const originalWindowOpen = window.open;

    const restore = () => {
      window.open = originalWindowOpen;
    };

    const timer = setTimeout(restore, 10000); // Auto-restore after 10s

    window.open = function(url, target, features) {
      // Check if this is a video URL
      if (url && (url.includes('storage.googleapis.com') || url.includes('.mp4') || url.includes('videofx'))) {
        console.log(`🎯 Intercepted window.open: ${url.substring(0, 80)}`);

        restore();
        clearTimeout(timer);

        // Trigger download instead of opening tab (async but fire-and-forget here)
        triggerNativeDownload(url, expectedFilename).catch(err => {
          console.error('📥 [DL] Interceptor download failed:', err);
        });

        return null; // Prevent tab from opening
      }

      // Not a video URL - allow normal behavior
      return originalWindowOpen.call(this, url, target, features);
    };

    return restore;
  }

  async function clickDownloadButton() {
    console.log('📥 [DL] Starting download flow...');

    // Sequential filename
    const paddedNum = String(state.currentIndex).padStart(3, '0');
    const filename = `veo3-batch-${paddedNum}.mp4`;
    state.lastDownloadComplete = false;

    // =========================================================================
    // STRATEGY 0: Direct video src download (MOST RELIABLE)
    // If the <video> element has a src URL, fetch it directly as blob
    // =========================================================================
    let targetVideo = state.lastVideoElement || document.querySelector('video[data-veo3-batch-target="true"]');

    if (!targetVideo) {
      const allVideos = document.querySelectorAll('video');
      if (allVideos.length > 0) {
        targetVideo = allVideos[allVideos.length - 1];
        state.lastVideoElement = targetVideo;
      }
    }

    if (!targetVideo) {
      throw new Error('No video elements found on page');
    }

    // Try to get video URL from src or source elements
    let videoUrl = targetVideo.src || '';
    if (!videoUrl) {
      const sourceEl = targetVideo.querySelector('source');
      if (sourceEl) videoUrl = sourceEl.src || '';
    }
    // Also check currentSrc (the actually playing source)
    if (!videoUrl && targetVideo.currentSrc) {
      videoUrl = targetVideo.currentSrc;
    }

    if (videoUrl && videoUrl.startsWith('http')) {
      console.log(`📥 [DL] Strategy 0: Direct video src found: ${videoUrl.substring(0, 80)}`);
      updateStatus(`⬇️ ${filename} (download direto)`);

      try {
        await triggerNativeDownload(videoUrl, filename);
        if (state.lastDownloadComplete) {
          console.log('📥 [DL] ✅ Direct src download succeeded');
          return;
        }
      } catch (err) {
        console.warn(`📥 [DL] Direct src download failed: ${err.message}. Trying button method...`);
      }
    } else if (videoUrl && videoUrl.startsWith('blob:')) {
      // Blob URLs can sometimes be downloaded directly
      console.log(`📥 [DL] Strategy 0b: Blob src found: ${videoUrl.substring(0, 60)}`);
      updateStatus(`⬇️ ${filename} (blob download)`);

      try {
        const a = document.createElement('a');
        a.href = videoUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => document.body.removeChild(a), 1000);
        state.lastDownloadComplete = true;
        console.log('📥 [DL] ✅ Blob download triggered');
        updateStatus(`✅ Baixado: ${filename}`);
        return;
      } catch (err) {
        console.warn(`📥 [DL] Blob download failed: ${err.message}. Trying button method...`);
      }
    } else {
      console.log(`📥 [DL] No direct video src available (src="${videoUrl || 'empty'}"). Using button method...`);
    }

    // =========================================================================
    // STRATEGY 1: Hover + Download button (FALLBACK)
    // =========================================================================
    console.log(`📥 [DL] Target video: ${targetVideo.tagName} (${targetVideo.src ? targetVideo.src.substring(0, 50) : 'no src'})`);

    // Scroll target video into view
    targetVideo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);

    // Hover over the target video to reveal its download button
    const rect = targetVideo.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    targetVideo.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
    targetVideo.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
    targetVideo.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
    await sleep(500);

    // Hover on parent containers too
    let parent = targetVideo.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
      parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
      parent = parent.parentElement;
    }
    await sleep(500);

    // Find download button near the target video
    let downloadBtn = null;
    const videoContainer = targetVideo.closest('div[class*="video"], div[class*="player"], div[class*="preview"], [role="main"]') || targetVideo.parentElement;

    for (let attempt = 0; attempt < 8; attempt++) {
      // Look inside the video container
      const iconsInContainer = videoContainer?.querySelectorAll('i.google-symbols') || [];
      for (const icon of iconsInContainer) {
        const iconText = (icon.textContent || '').trim().toLowerCase();
        if (iconText === 'download' || iconText === 'file_download' || iconText === 'save_alt') {
          const btn = icon.closest('button') || icon.closest('a') || icon.closest('[role="button"]');
          if (btn && btn.offsetParent !== null) {
            downloadBtn = btn;
            break;
          }
        }
      }
      if (downloadBtn) break;

      // Global search - prefer closest to target video
      const allDownloadIcons = document.querySelectorAll('i.google-symbols');
      let closestBtn = null;
      let closestDistance = Infinity;

      for (const icon of allDownloadIcons) {
        const iconText = (icon.textContent || '').trim().toLowerCase();
        if (iconText === 'download' || iconText === 'file_download' || iconText === 'save_alt') {
          const btn = icon.closest('button') || icon.closest('a') || icon.closest('[role="button"]');
          if (btn && btn.offsetParent !== null) {
            const btnRect = btn.getBoundingClientRect();
            const distance = Math.hypot(btnRect.left - cx, btnRect.top - cy);
            if (distance < closestDistance) {
              closestDistance = distance;
              closestBtn = btn;
            }
          }
        }
      }

      if (closestBtn) {
        downloadBtn = closestBtn;
        console.log(`📥 [DL] Found download btn (distance=${Math.round(closestDistance)}px)`);
        break;
      }

      console.log(`📥 [DL] Attempt ${attempt + 1}/8 — hovering again...`);
      targetVideo.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
      await sleep(1500);
    }

    if (!downloadBtn) {
      throw new Error('Download button not found after 8 attempts. Try downloading manually (F12 Console for details).');
    }

    // Click download button with human-like sequence
    downloadBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    await sleep(40 + Math.random() * 80);
    downloadBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await sleep(40 + Math.random() * 60);
    downloadBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    await sleep(20 + Math.random() * 40);
    downloadBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    await sleep(10 + Math.random() * 30);
    downloadBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(1500);

    // Install window.open interceptor
    const restoreWindowOpen = installWindowOpenInterceptor(filename);

    // =========================================================================
    // STRATEGY 2: Quality menu selection
    // =========================================================================
    const qualityTexts = ['Tamanho original', 'Original size', 'Original quality', '720p', '1080p', 'MP4'];
    let qualityOption = null;
    for (const text of qualityTexts) {
      qualityOption = findQualityOption(text);
      if (qualityOption) break;
    }

    if (!qualityOption) {
      // No quality menu — try direct click again, interceptor will catch window.open
      downloadBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(3000);
      restoreWindowOpen();

      if (state.lastDownloadComplete) {
        console.log('📥 [DL] ✅ Download intercepted');
        return;
      }

      // Check if video src became available after clicking download
      const freshSrc = targetVideo.src || targetVideo.currentSrc || '';
      if (freshSrc && freshSrc.startsWith('http')) {
        console.log(`📥 [DL] Video src appeared after click: ${freshSrc.substring(0, 60)}`);
        await triggerNativeDownload(freshSrc, filename);
        if (state.lastDownloadComplete) return;
      }

      // Check for blob/download links
      const blobLinks = document.querySelectorAll('a[href^="blob:"], a[download]');
      if (blobLinks.length > 0) {
        const url = blobLinks[blobLinks.length - 1].href;
        await triggerNativeDownload(url, filename);
        if (state.lastDownloadComplete) return;
      }

      // If we still can't download, throw an error instead of silently assuming success
      throw new Error(`Download não confirmado para ${filename}. Verifique manualmente.`);
    }

    // Click quality option
    const anchor = qualityOption.tagName === 'A' ? qualityOption : qualityOption.closest('a');
    const href = anchor?.href;

    if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
      updateStatus(`⬇️ ${filename}`);
      restoreWindowOpen();
      await triggerNativeDownload(href, filename);
      return;
    }

    // Click and wait for interceptor
    updateStatus(`⬇️ ${filename}`);
    qualityOption.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    await sleep(30);
    qualityOption.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(3000);
    restoreWindowOpen();

    if (state.lastDownloadComplete) return;

    // Final blob check
    const newBlobs = document.querySelectorAll('a[href^="blob:"], a[download]');
    if (newBlobs.length > 0) {
      const url = newBlobs[newBlobs.length - 1].href;
      await triggerNativeDownload(url, filename);
      if (state.lastDownloadComplete) return;
    }

    throw new Error(`Download não confirmado para ${filename}. Verifique manualmente.`);
  }

  async function waitForDownloadCompletion() {
    const initialBlobCount = document.querySelectorAll('a[href^="blob:"]').length;
    const initialDlCount = document.querySelectorAll('a[download]').length;
    const maxWait = CONFIG.DOWNLOAD_TIMEOUT;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const check = () => {
        const elapsed = Date.now() - startTime;

        if (state.lastDownloadComplete) {
          updateStatus('✅ Download concluído');
          state.lastDownloadComplete = false;
          resolve(true);
          return;
        }

        if (document.querySelectorAll('a[href^="blob:"]').length > initialBlobCount) {
          updateStatus('✅ Download concluído');
          resolve(true);
          return;
        }

        if (document.querySelectorAll('a[download]').length > initialDlCount) {
          updateStatus('✅ Download concluído');
          resolve(true);
          return;
        }

        if (elapsed >= maxWait) {
          updateStatus('⚠️ Download não confirmado (timeout)');
          resolve(false);
          return;
        }

        setTimeout(check, 500);
      };
      check();
    });
  }

  // ============================================================================
  // BATCH PROCESS ORCHESTRATION
  // ============================================================================
  function stopBatch() {
    const wasPhase = state.phase;
    state.isRunning = false;
    state.isPaused = false;
    state.phase = 'idle';
    updateStatus(`■ ${wasPhase === 'downloading' ? 'Download' : 'Envio'} interrompido`);
    updateBubbleBadge();
    document.getElementById('veo3-start-btn').disabled = false;
    document.getElementById('veo3-pause-btn').disabled = true;
    document.getElementById('veo3-stop-btn').disabled = true;

    // If stopped during send phase and some videos were generated, enable download
    if (wasPhase === 'sending' && state.completedVideos.length > 0) {
      const dlBtn = document.getElementById('veo3-download-all-btn');
      dlBtn.disabled = false;
      dlBtn.style.opacity = '1';
      dlBtn.textContent = `📥 Baixar ${state.completedVideos.length} vídeos`;
      updateStatus(`👉 ${state.completedVideos.length} vídeos prontos para download`);
    }
  }

  // ============================================================================
  // PHASE 1: SEND ALL PROMPTS (no download)
  // ============================================================================
  async function startBatchProcess() {
    const textarea = document.getElementById('veo3-prompts-input');
    if (!textarea) return;

    const prompts = parsePrompts(textarea.value);
    if (prompts.length === 0) {
      alert('Por favor, adicione pelo menos um prompt!');
      return;
    }

    state.prompts = prompts;
    state.isRunning = true;
    state.isPaused = false;
    state.currentIndex = 0;
    state.downloadedCount = 0;
    state.results = [];
    state.completedVideos = [];
    state.lastDownloadComplete = false;
    state.startTime = Date.now();
    state.phase = 'sending';
    updateBubbleBadge();

    document.getElementById('veo3-start-btn').disabled = true;
    document.getElementById('veo3-download-all-btn').disabled = true;
    document.getElementById('veo3-download-all-btn').style.opacity = '0.5';
    document.getElementById('veo3-pause-btn').disabled = false;
    document.getElementById('veo3-stop-btn').disabled = false;

    updateStatus(`🚀 FASE 1: Enviando ${prompts.length} prompts (sem download)`);

    try {
      for (let i = 0; i < prompts.length; i++) {
        if (!state.isRunning) break;

        while (state.isPaused && state.isRunning) {
          await sleep(100);
        }
        if (!state.isRunning) break;

        const prompt = prompts[i];
        state.currentIndex = i + 1;
        const paddedNum = String(i + 1).padStart(3, '0');

        document.getElementById('veo3-current').textContent = `Enviando: ${i + 1}/${prompts.length}`;
        updateStatus(`[${paddedNum}] Preparando...`);

        try {
          await injectPrompt(prompt);
          await microDelay(); // Natural pause after typing

          await clickSendButton();
          await microDelay(); // Natural pause after clicking send

          updateStatus(`[${paddedNum}] Aguardando geração...`);
          await waitForProgressCompletion();

          // Track the generated video for Phase 2 download
          const videoEl = state.lastVideoElement;
          if (videoEl) {
            videoEl.setAttribute('data-veo3-batch-index', String(i + 1));
          }
          state.completedVideos.push({
            index: i + 1,
            prompt: prompt.substring(0, 60),
            videoElement: videoEl
          });
          state.results.push({ index: i + 1, prompt: prompt.substring(0, 60), status: 'generated' });

          document.getElementById('veo3-downloaded').textContent =
            `Gerados: ${state.completedVideos.length}/${prompts.length} | Baixados: 0`;

          updateStatus(`[${paddedNum}] ✅ Vídeo gerado!`);

          if (i < prompts.length - 1) {
            await humanDelay();
          }
        } catch (error) {
          state.lastError = error.message;
          state.results.push({ index: i + 1, prompt: prompt.substring(0, 60), status: 'error', error: error.message });
          updateStatus(`[${paddedNum}] ❌ ${error.message}`);
          console.error(`Prompt ${i + 1}:`, error);
          await sleep(2000);
        }
      }

      // Phase 1 summary
      const duration = ((Date.now() - state.startTime) / 1000).toFixed(1);
      const genCount = state.completedVideos.length;
      const errCount = state.results.filter(r => r.status === 'error').length;

      updateStatus('────────────────────');
      updateStatus(`🎬 FASE 1 COMPLETA em ${duration}s`);
      updateStatus(`✅ ${genCount} gerados | ❌ ${errCount} erros`);

      if (genCount > 0) {
        updateStatus(`👉 Clique "Baixar Todos" para baixar os ${genCount} vídeos`);

        // Enable download button
        const dlBtn = document.getElementById('veo3-download-all-btn');
        dlBtn.disabled = false;
        dlBtn.style.opacity = '1';
        dlBtn.textContent = `📥 Baixar ${genCount} vídeos`;
      }

      console.log('═'.repeat(50));
      console.log('📋 PHASE 1 RESULTS (Send All):');
      state.results.forEach(r => {
        console.log(`  ${r.status === 'generated' ? '✅' : '❌'} [${String(r.index).padStart(3, '0')}] "${r.prompt}..."${r.error ? ` [${r.error}]` : ''}`);
      });
      console.log('═'.repeat(50));

    } catch (error) {
      updateStatus(`❌ Erro fatal: ${error.message}`);
      console.error('Fatal:', error);
    } finally {
      state.isRunning = false;
      state.isPaused = false;
      state.phase = 'idle';
      updateBubbleBadge();
      document.getElementById('veo3-start-btn').disabled = false;
      document.getElementById('veo3-pause-btn').disabled = true;
      document.getElementById('veo3-stop-btn').disabled = true;
    }
  }

  // ============================================================================
  // PHASE 2: DOWNLOAD ALL GENERATED VIDEOS
  // ============================================================================
  async function downloadAllVideos() {
    if (state.completedVideos.length === 0) {
      alert('Nenhum vídeo gerado para baixar! Envie os prompts primeiro.');
      return;
    }

    state.isRunning = true;
    state.isPaused = false;
    state.phase = 'downloading';
    state.downloadedCount = 0;
    updateBubbleBadge();

    document.getElementById('veo3-start-btn').disabled = true;
    document.getElementById('veo3-download-all-btn').disabled = true;
    document.getElementById('veo3-download-all-btn').style.opacity = '0.5';
    document.getElementById('veo3-pause-btn').disabled = false;
    document.getElementById('veo3-stop-btn').disabled = false;

    const total = state.completedVideos.length;
    updateStatus(`📥 FASE 2: Baixando ${total} vídeos...`);

    const downloadStartTime = Date.now();

    try {
      for (let i = 0; i < state.completedVideos.length; i++) {
        if (!state.isRunning) break;

        while (state.isPaused && state.isRunning) {
          await sleep(100);
        }
        if (!state.isRunning) break;

        const entry = state.completedVideos[i];
        const paddedNum = String(entry.index).padStart(3, '0');
        state.currentIndex = i + 1;
        state.lastDownloadComplete = false;

        document.getElementById('veo3-current').textContent = `Baixando: ${i + 1}/${total}`;
        updateStatus(`[${paddedNum}] Baixando vídeo...`);

        try {
          // Try to use the tracked video element
          let targetVideo = entry.videoElement;

          // Fallback: find by data attribute
          if (!targetVideo || !targetVideo.isConnected) {
            targetVideo = document.querySelector(`video[data-veo3-batch-index="${entry.index}"]`);
          }

          // Fallback: find by position (nth video)
          if (!targetVideo) {
            const allVideos = document.querySelectorAll('video');
            if (allVideos.length >= entry.index) {
              targetVideo = allVideos[entry.index - 1];
            }
          }

          if (!targetVideo) {
            throw new Error('Vídeo não encontrado na página');
          }

          // Set as current target for clickDownloadButton
          state.lastVideoElement = targetVideo;
          state.videoCountBeforeGen = document.querySelectorAll('video').length;

          await clickDownloadButton();
          await sleep(1000);
          const downloadConfirmed = await waitForDownloadCompletion();

          const result = state.results.find(r => r.index === entry.index);
          if (downloadConfirmed) {
            state.downloadedCount++;
            if (result) {
              result.status = 'ok';
              result.filename = `${CONFIG.DOWNLOAD_FOLDER}-${paddedNum}.mp4`;
            }
            updateStatus(`[${paddedNum}] ✅ Baixado!`);
          } else {
            if (result) {
              result.status = 'download_unconfirmed';
              result.error = 'Timeout - verifique manualmente';
            }
            updateStatus(`[${paddedNum}] ⚠️ Não confirmado — verifique na pasta Downloads`);
          }

          document.getElementById('veo3-downloaded').textContent =
            `Gerados: ${total} | Baixados: ${state.downloadedCount}/${total}`;

          if (i < state.completedVideos.length - 1) {
            await sleep(1500); // Small delay between downloads
          }
        } catch (error) {
          const result = state.results.find(r => r.index === entry.index);
          if (result) {
            result.status = 'download_error';
            result.error = error.message;
          }
          updateStatus(`[${paddedNum}] ❌ Download falhou: ${error.message}`);
          console.error(`Download ${entry.index}:`, error);
          await sleep(1000);
        }
      }

      // Phase 2 summary
      const dlDuration = ((Date.now() - downloadStartTime) / 1000).toFixed(1);
      const totalDuration = ((Date.now() - state.startTime) / 1000).toFixed(1);
      const okCount = state.results.filter(r => r.status === 'ok').length;
      const unconfirmedCount = state.results.filter(r => r.status === 'download_unconfirmed').length;
      const errCount = state.results.filter(r => r.status === 'error' || r.status === 'download_error').length;

      updateStatus('────────────────────');
      updateStatus(`🎉 TUDO COMPLETO!`);
      updateStatus(`📥 Downloads: ${dlDuration}s | Total: ${totalDuration}s`);
      updateStatus(`✅ ${okCount} baixados${unconfirmedCount > 0 ? ` | ⚠️ ${unconfirmedCount} não confirmados` : ''} | ❌ ${errCount} erros`);
      updateStatus('');
      updateStatus('📂 Organizando arquivos...');

      // Download manifest com instruções
      await sleep(1000);
      await downloadManifest();
      updateStatus('📄 Manifest baixado! (veo3-batch-MANIFEST.txt)');

      updateStatus('');
      updateStatus('📁 Seus arquivos estão em: Downloads/');
      updateStatus('Procure por: veo3-batch-001.mp4, veo3-batch-002.mp4, etc');
      updateStatus('');
      updateStatus('💡 Veja o MANIFEST para instruções de organização');

      console.log('═'.repeat(50));
      console.log('📋 FINAL RESULTS:');
      state.results.forEach(r => {
        const icon = r.status === 'ok' ? '✅' : '❌';
        console.log(`  ${icon} [${String(r.index).padStart(3, '0')}] "${r.prompt}..."${r.error ? ` [${r.error}]` : ''}`);
      });
      console.log('═'.repeat(50));

    } catch (error) {
      updateStatus(`❌ Erro fatal no download: ${error.message}`);
      console.error('Fatal download:', error);
    } finally {
      state.isRunning = false;
      state.isPaused = false;
      state.phase = 'idle';
      state.completedVideos = [];
      updateBubbleBadge();
      document.getElementById('veo3-start-btn').disabled = false;
      document.getElementById('veo3-download-all-btn').disabled = true;
      document.getElementById('veo3-download-all-btn').style.opacity = '0.5';
      document.getElementById('veo3-download-all-btn').textContent = '📥 Baixar Todos';
      document.getElementById('veo3-pause-btn').disabled = true;
      document.getElementById('veo3-stop-btn').disabled = true;
    }
  }

  function togglePause() {
    state.isPaused = !state.isPaused;
    const btn = document.getElementById('veo3-pause-btn');
    btn.textContent = state.isPaused ? '▶ Retomar' : '⏸ Pausar';
    updateStatus(state.isPaused ? '⏸ Pausado' : '▶ Retomado');
  }

  // ============================================================================
  // DEBUG & DIAGNOSTICS
  // ============================================================================
  function performDiagnostics() {
    console.log('🔍 VEO3 Batch Automator v0.9.1 — Diagnostics');
    console.log('='.repeat(50));

    const inputEl = findElement(SELECTORS.inputField, 'input');
    console.log(`  Input: ${inputEl ? `${inputEl.tagName} placeholder="${inputEl.placeholder || ''}"` : 'NOT FOUND'}`);

    const allIcons = Array.from(document.querySelectorAll('i.google-symbols'));
    console.log(`  Google Symbol icons: ${allIcons.length}`);
    allIcons.forEach((icon, idx) => {
      const btn = icon.closest('button');
      console.log(`    [${idx}] "${icon.textContent.trim()}" visible=${btn ? btn.offsetParent !== null : false}`);
    });

    const sendBtn = findElement(SELECTORS.sendButton, 'send');
    console.log(`  Send: ${sendBtn ? 'found ✅' : 'NOT FOUND ⚠️'}`);

    const dlBtn = findElement([], 'download');
    console.log(`  Download: ${dlBtn ? 'found ✅' : 'not found (normal before generation)'}`);

    console.log(`  Download mode: Native browser download`);
    console.log(`  Filenames: ${CONFIG.DOWNLOAD_FOLDER}/001.mp4, 002.mp4, ...`);
    console.log('='.repeat(50));
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  function init() {
    console.log('🎬 VEO3 Batch Automator v0.9.1');
    console.log(`📁 Downloads → ${CONFIG.DOWNLOAD_FOLDER}/001.mp4, 002.mp4, ...`);
    injectStyles();
    createFloatingBubble();
    createPanel();
    setTimeout(performDiagnostics, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
