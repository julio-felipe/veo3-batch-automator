// ==UserScript==
// @name         Veo3 Prompt Batch Automator
// @namespace    https://synkra.io/
// @version      1.5.0
// @description  Automate batch video generation in Google Veo 3.1 — Send All then Download All
// @author       j. felipe
// @match        https://labs.google/fx/pt/tools/flow/project/*
// @match        https://labs.google/fx/*/tools/flow/project/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
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
    completedVideos: [],      // { index, prompt, videoElement } - tracked for Phase 2 download
    // Character Consistency
    includeImagesEnabled: false,
    detectedImageCount: 0,
    imageSelectionInProgress: false
  };

  // ============================================================================
  // SELECTORS & CONSTANTS
  // ============================================================================
  const SELECTORS = {
    inputField: [
      'textarea[placeholder*="O que você quer criar"]',
      'textarea[placeholder*="What do you want to create"]',
      'textarea[placeholder*="Crie um vídeo"]',
      'textarea[placeholder*="crie um vídeo"]',
      '#PINHOLE_TEXT_AREA_ELEMENT_ID',
      'input[placeholder*="Crie"]',
      'input[placeholder*="criar"]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '[contenteditable="true"]'
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
    DOWNLOAD_FOLDER: 'veo3-batch', // Subfolder in Downloads
    QUEUE_BATCH_SIZE: 5,           // VEO3 max queue size
    QUEUE_COOLDOWN: 15000,          // Cooldown after full batch (15s)
    IMAGE_SELECT_DELAY: 500,        // Delay after selecting each image (ms)
    TAB_SWITCH_DELAY: 700,          // Delay after switching tabs (ms)
    IMAGE_HOVER_DELAY: 400,         // Delay after hovering over image card (ms)
    MAX_IMAGE_SELECT_RETRIES: 3     // Max retries for selecting images
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
        <span style="font-weight: 600; font-size: 14px;">VEO3 Batch Automator <span style="font-size:10px;opacity:0.6">v1.3.0</span></span>
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
        <div id="veo3-image-options" style="
          background: rgba(255,255,255,0.1); padding: 10px 12px; border-radius: 8px;
          margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px;
        ">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="veo3-include-images-cb" style="
              width: 16px; height: 16px; cursor: pointer; accent-color: #4CAF50;
            ">
            <label for="veo3-include-images-cb" style="
              font-size: 12px; font-weight: 500; cursor: pointer; user-select: none;
            ">Incluir imagens no comando</label>
          </div>
          <div id="veo3-image-count" style="
            font-size: 11px; color: rgba(255,255,255,0.7); padding-left: 24px;
            display: none;
          ">Detectando imagens...</div>
        </div>
        <div style="font-size: 10px; opacity: 0.6; padding: 0 2px; margin-bottom: 10px;">
          &#128161; <code style="background: rgba(0,0,0,0.2); padding: 1px 4px; border-radius: 2px;">[CHARS: Bao]</code> personagens @Nome &#8226; <code style="background: rgba(0,0,0,0.2); padding: 1px 4px; border-radius: 2px;">[IMGS: macaw, 1]</code> imagens por t&#237;tulo/&#237;ndice
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
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
          <button id="veo3-scan-page-btn" style="
            padding: 10px; background: #78909C; color: white; border: none;
            border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;
            transition: background 0.2s;
          ">&#128269; Ler página</button>
          <div id="veo3-video-count-badge" style="
            padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;
            font-size: 12px; font-weight: 600; display: flex; align-items: center;
            justify-content: center; color: rgba(255,255,255,0.7);
          ">— vídeos</div>
        </div>
        <div style="
          background: rgba(255,255,255,0.1); padding: 10px 12px; border-radius: 8px;
          margin-bottom: 8px; display: flex; flex-direction: column; gap: 8px;
        ">
          <label for="veo3-folder-name" style="font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.8);">Nome da pasta:</label>
          <input id="veo3-folder-name" type="text" style="
            width: 100%; padding: 8px 10px; border: none; border-radius: 6px;
            font-size: 12px; color: #333; box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          " placeholder="Ex: URSO 2, Cena Final...">
        </div>
        <div style="margin-bottom: 8px;">
          <button id="veo3-dl-page-btn" style="
            width: 100%; padding: 10px; background: #00BCD4; color: white; border: none;
            border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;
            transition: background 0.2s;
          ">&#128249; Baixar vídeos da página</button>
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

    const dlPageBtn = document.getElementById('veo3-dl-page-btn');
    const scanPageBtn = document.getElementById('veo3-scan-page-btn');

    startBtn.addEventListener('mouseenter', () => { startBtn.style.background = '#45a049'; });
    startBtn.addEventListener('mouseleave', () => { startBtn.style.background = '#4CAF50'; });
    downloadAllBtn.addEventListener('mouseenter', () => { if (!downloadAllBtn.disabled) downloadAllBtn.style.background = '#1976D2'; });
    downloadAllBtn.addEventListener('mouseleave', () => { if (!downloadAllBtn.disabled) downloadAllBtn.style.background = '#2196F3'; });
    dlPageBtn.addEventListener('mouseenter', () => { if (!dlPageBtn.disabled) dlPageBtn.style.background = '#0097A7'; });
    dlPageBtn.addEventListener('mouseleave', () => { if (!dlPageBtn.disabled) dlPageBtn.style.background = '#00BCD4'; });
    // DIAGNOSTIC BUTTONS — light and deep page analysis
    const diagContainer = document.createElement('div');
    diagContainer.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;margin-bottom:2px';

    const diagLightBtn = document.createElement('button');
    diagLightBtn.id = 'veo3-diag-light-btn';
    diagLightBtn.textContent = '🔍 Diag Rápido';
    diagLightBtn.style.cssText = 'padding:6px 10px;background:#FF9800;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px';
    diagLightBtn.addEventListener('click', () => runDiagnostic('light'));

    const diagDeepBtn = document.createElement('button');
    diagDeepBtn.id = 'veo3-diag-deep-btn';
    diagDeepBtn.textContent = '🔬 Diag Profundo';
    diagDeepBtn.style.cssText = 'padding:6px 10px;background:#E65100;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px';
    diagDeepBtn.addEventListener('click', () => runDiagnostic('deep'));

    diagContainer.appendChild(diagLightBtn);
    diagContainer.appendChild(diagDeepBtn);

    const statusDisplay = document.getElementById('veo3-status-display');
    statusDisplay.parentElement.insertBefore(diagContainer, statusDisplay);

    scanPageBtn.addEventListener('mouseenter', () => { scanPageBtn.style.background = '#607D8B'; });
    scanPageBtn.addEventListener('mouseleave', () => { scanPageBtn.style.background = '#78909C'; });
    pauseBtn.addEventListener('mouseenter', () => { pauseBtn.style.background = '#e68900'; });
    pauseBtn.addEventListener('mouseleave', () => { pauseBtn.style.background = '#ff9800'; });
    stopBtn.addEventListener('mouseenter', () => { stopBtn.style.background = '#d32f2f'; });
    stopBtn.addEventListener('mouseleave', () => { stopBtn.style.background = '#f44336'; });

    document.getElementById('veo3-close-btn').addEventListener('click', () => togglePanel(false));
    document.getElementById('veo3-minimize-btn').addEventListener('click', () => togglePanel(false));
    startBtn.addEventListener('click', startBatchProcess);
    downloadAllBtn.addEventListener('click', downloadAllVideos);
    dlPageBtn.addEventListener('click', downloadPageVideos);
    scanPageBtn.addEventListener('click', scanPageVideos);
    pauseBtn.addEventListener('click', togglePause);
    stopBtn.addEventListener('click', stopBatch);

    // Folder name: restore saved value + auto-save on change
    const folderNameInput = document.getElementById('veo3-folder-name');
    try {
      const savedFolder = localStorage.getItem('veo3-folder-name');
      if (savedFolder) folderNameInput.value = savedFolder;
    } catch (e) { /* ignore */ }
    folderNameInput.addEventListener('input', () => {
      try { localStorage.setItem('veo3-folder-name', folderNameInput.value); } catch (e) { /* ignore */ }
    });

    // Character Consistency: checkbox + image count indicator
    const includeImagesCb = document.getElementById('veo3-include-images-cb');
    const imageCountEl = document.getElementById('veo3-image-count');

    // Restore saved preference
    try {
      const saved = localStorage.getItem('veo3-include-images');
      if (saved === 'true') {
        includeImagesCb.checked = true;
        state.includeImagesEnabled = true;
        imageCountEl.style.display = 'block';
        // Detect images after panel renders
        setTimeout(async () => {
          const count = await detectImagesOnPage();
          state.detectedImageCount = count;
          imageCountEl.textContent = count > 0
            ? `🖼️ ${count} imagem(ns) detectada(s)`
            : '⚠️ Nenhuma imagem detectada';
        }, 2000);
      }
    } catch (e) { /* ignore */ }

    includeImagesCb.addEventListener('change', async () => {
      state.includeImagesEnabled = includeImagesCb.checked;
      try {
        localStorage.setItem('veo3-include-images', String(includeImagesCb.checked));
      } catch (e) { /* ignore */ }

      if (includeImagesCb.checked) {
        imageCountEl.style.display = 'block';
        imageCountEl.textContent = 'Detectando imagens...';
        const count = await detectImagesOnPage();
        state.detectedImageCount = count;
        imageCountEl.textContent = count > 0
          ? `🖼️ ${count} imagem(ns) detectada(s)`
          : '⚠️ Nenhuma imagem detectada';
      } else {
        imageCountEl.style.display = 'none';
        state.detectedImageCount = 0;
      }
    });

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

  // Extracts [CHARS: Name1, Name2] and [IMGS: keyword1, 2] from prompt
  // Returns clean prompt + character list + image keywords list
  // Supports: [CHARS: ...], [CHAR: ...], [IMGS: ...], [IMG: ...] — case-insensitive
  function parseCharsFromPrompt(promptText) {
    let cleanPrompt = promptText;
    let characters = [];
    let imageKeywords = [];

    // Extract [CHARS: ...] / [CHAR: ...]
    const charsMatch = cleanPrompt.match(/\[CHARS?:\s*([^\]]+)\]\s*\n?/i);
    if (charsMatch) {
      characters = charsMatch[1]
        .split(',')
        .map(c => c.trim().toLowerCase())
        .filter(c => c.length > 0);
      cleanPrompt = cleanPrompt.replace(charsMatch[0], '');
    }

    // Extract [IMGS: ...] / [IMG: ...]
    const imgsMatch = cleanPrompt.match(/\[IMGS?:\s*([^\]]+)\]\s*\n?/i);
    if (imgsMatch) {
      imageKeywords = imgsMatch[1]
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(k => k.length > 0);
      cleanPrompt = cleanPrompt.replace(imgsMatch[0], '');
    }

    cleanPrompt = cleanPrompt.replace(/\n{2,}/g, '\n').trim();
    return { cleanPrompt, characters, imageKeywords };
  }

  // Scans page for elements with @Name: text pattern near image cards
  // Returns Map<lowercase_name, HTMLElement> — the card/container element for each character
  function findCharacterCards() {
    const nameToCard = new Map();

    function isOurs(el) {
      return el.closest('#veo3-panel, #veo3-bubble');
    }

    // Strategy 1: Walk all text nodes looking for @Name: pattern
    // VEO3 shows character descriptions like "@Bao: Majestic Bombay black cat..."
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.textContent || !node.textContent.includes('@')) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || isOurs(parent)) return NodeFilter.FILTER_REJECT;
          if (parent.offsetParent === null && parent.style.display !== 'contents') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const atNamePattern = /@(\w[\w\s-]*?):/g;
    let textNode;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent;
      let match;
      atNamePattern.lastIndex = 0;
      while ((match = atNamePattern.exec(text))) {
        const name = match[1].trim().toLowerCase();
        if (name.length === 0 || name.length > 30) continue;

        // Find the nearest card/image container by walking up from the text node
        const el = textNode.parentElement;
        let card = null;

        let current = el;
        for (let depth = 0; depth < 8 && current; depth++) {
          const hasImg = current.querySelector('img') || current.querySelector('[role="img"]');
          const hasBg = current.style.backgroundImage && current.style.backgroundImage !== 'none';
          const rect = current.getBoundingClientRect();
          const isCardSized = rect.width >= 80 && rect.height >= 80;

          if ((hasImg || hasBg) && isCardSized) {
            card = current;
            break;
          }

          if (current.matches('[role="listitem"], [role="option"], [class*="card"], [class*="item"]') && isCardSized) {
            card = current;
            break;
          }

          current = current.parentElement;
        }

        if (!card) {
          card = el.closest('[class*="card"], [class*="item"], [class*="asset"]') || el;
        }

        if (!nameToCard.has(name)) {
          nameToCard.set(name, card);
          console.log(`🎭 Found character card: @${name} → ${card.tagName}.${(card.className || '').toString().substring(0, 40)}`);
        }
      }
    }

    // Strategy 2: Also check aria-label and title attributes on images
    const allImgs = document.querySelectorAll('img:not(#veo3-panel img):not(#veo3-bubble img)');
    for (const img of allImgs) {
      if (isOurs(img)) continue;
      const alt = (img.alt || '') + ' ' + (img.title || '') + ' ' + (img.getAttribute('aria-label') || '');
      let match;
      atNamePattern.lastIndex = 0;
      while ((match = atNamePattern.exec(alt))) {
        const name = match[1].trim().toLowerCase();
        if (name.length === 0 || name.length > 30) continue;
        if (!nameToCard.has(name)) {
          const card = img.closest('[class*="card"], [class*="item"], [role="listitem"]') || img.parentElement || img;
          nameToCard.set(name, card);
          console.log(`🎭 Found character (img attr): @${name} → ${card.tagName}`);
        }
      }
    }

    console.log(`🎭 findCharacterCards: found ${nameToCard.size} character(s): ${[...nameToCard.keys()].join(', ')}`);
    return nameToCard;
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

  // Check if VEO3 queue is full (max 5 generations)
  function detectQueueFull() {
    const candidates = document.querySelectorAll(
      '[role="alert"], [role="status"], [role="tooltip"], ' +
      '[class*="snack"], [class*="toast"], [class*="notif"], ' +
      '[class*="banner"], [class*="message"], [class*="popup"]'
    );
    for (const el of candidates) {
      const text = el.textContent || '';
      if (text.includes('máximo') && text.includes('geraç')) return true;
      if (text.includes('maximum') && text.includes('generation')) return true;
    }
    return false;
  }

  // Wait for queue slot if VEO3 reports queue full
  async function waitForQueueSlot() {
    if (!detectQueueFull()) return;
    updateStatus(`⏳ Fila cheia (${CONFIG.QUEUE_BATCH_SIZE}/${CONFIG.QUEUE_BATCH_SIZE}) — aguardando vaga...`);
    let waited = 0;
    const maxWait = CONFIG.QUEUE_COOLDOWN * 20; // 5 min max based on cooldown
    while (detectQueueFull() && waited < maxWait && state.isRunning) {
      await sleep(CONFIG.QUEUE_COOLDOWN);
      waited += CONFIG.QUEUE_COOLDOWN;
    }
    if (waited > 0) {
      updateStatus('✅ Vaga na fila disponível!');
      await sleep(2000);
    }
  }

  // Count active generations on VEO3 page (progress bars, spinners, loading indicators)
  function countActiveGenerations() {
    let count = 0;
    // Count active progress bars (not at 100%)
    const progressBars = document.querySelectorAll('[role="progressbar"]');
    for (const bar of progressBars) {
      const val = parseInt(bar.getAttribute('aria-valuenow') || '0');
      if (val > 0 && val < 100) count++;
    }
    // Count loading/spinner indicators
    const spinners = document.querySelectorAll(
      '[class*="loading"]:not([id^="veo3"]), [class*="spinner"]:not([id^="veo3"]), ' +
      '[class*="generating"], [class*="pending"], [class*="processing"]'
    );
    count += spinners.length;
    return count;
  }

  // Wait until active generations drop below maxActive
  async function waitForActiveGenerations(maxActive) {
    const maxWait = CONFIG.PROGRESS_TIMEOUT;
    const startTime = Date.now();
    while (state.isRunning && (Date.now() - startTime) < maxWait) {
      const active = countActiveGenerations();
      if (active <= maxActive) return;
      if (detectQueueFull()) {
        updateStatus(`⏳ Fila cheia — ${active} gerações ativas...`);
      }
      await sleep(3000); // Check every 3s
    }
  }

  // Find the actual scrollable container (SPA apps often scroll inner divs, not body)
  function findScrollableContainer() {
    const candidates = document.querySelectorAll(
      'main, [role="main"], [class*="scroll"], [class*="content"], [class*="feed"], [class*="container"]'
    );
    for (const el of candidates) {
      const style = getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 100) {
        return el;
      }
    }
    return null;
  }

  // Scroll page to find a video not in visible DOM (virtual scrolling)
  async function scrollToLoadVideo(targetIndex) {
    updateStatus(`🔍 Procurando vídeo ${targetIndex}... (scroll)`);

    // Try both: inner scrollable container AND window scroll
    const innerScrollable = findScrollableContainer();
    const targets = innerScrollable ? [innerScrollable, document.documentElement] : [document.documentElement];

    for (const scrollable of targets) {
      // Reset to top
      scrollable.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: 'instant' });
      await sleep(800);

      // Scroll down incrementally
      const scrollStep = 300;
      const maxHeight = Math.max(scrollable.scrollHeight, document.documentElement.scrollHeight);

      for (let pos = 0; pos <= maxHeight; pos += scrollStep) {
        scrollable.scrollTop = pos;
        window.scrollTo({ top: pos, behavior: 'instant' });
        await sleep(400);

        // Check by data attribute
        const byAttr = document.querySelector(`video[data-veo3-batch-index="${targetIndex}"]`);
        if (byAttr && byAttr.isConnected) {
          byAttr.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(500);
          return byAttr;
        }

        // Check by count
        const allVideos = document.querySelectorAll('video');
        if (allVideos.length >= targetIndex) {
          const found = allVideos[targetIndex - 1];
          found.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(500);
          return found;
        }
      }
    }

    return null;
  }

  // Deep querySelector that also searches inside Shadow DOM roots
  function querySelectorDeep(selector) {
    // 1. Try normal DOM first
    const normal = document.querySelector(selector);
    if (normal && !normal.closest('#veo3-panel, #veo3-bubble')) return normal;

    // 2. Search inside shadow roots
    function searchShadow(root) {
      const els = root.querySelectorAll('*');
      for (const el of els) {
        if (el.shadowRoot) {
          try {
            const found = el.shadowRoot.querySelector(selector);
            if (found) return found;
            // Recurse deeper
            const deeper = searchShadow(el.shadowRoot);
            if (deeper) return deeper;
          } catch (e) { /* invalid selector in shadow */ }
        }
      }
      return null;
    }
    return searchShadow(document);
  }

  function querySelectorAllDeep(selector) {
    const results = [];
    // Normal DOM
    document.querySelectorAll(selector).forEach(el => {
      if (!el.closest('#veo3-panel, #veo3-bubble')) results.push(el);
    });
    // Shadow DOM
    function searchShadow(root) {
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          try {
            el.shadowRoot.querySelectorAll(selector).forEach(found => results.push(found));
            searchShadow(el.shadowRoot);
          } catch (e) { }
        }
      });
    }
    searchShadow(document);
    return results;
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

      const textarea = document.querySelector('#PINHOLE_TEXT_AREA_ELEMENT_ID, textarea[placeholder*="O que você"], textarea[placeholder*="What do you"], textarea[placeholder*="Crie"], textarea, [contenteditable="true"][role="textbox"], div[contenteditable="true"]');
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
    // GENERIC ELEMENT DETECTION (input, progress) — includes Shadow DOM
    // =========================================================================
    for (const selector of selectorList) {
      try {
        // Try deep search (normal + shadow DOM)
        const elements = querySelectorAllDeep(selector);
        for (const el of elements) {
          if (el.offsetParent === null && purpose === 'input') {
            // For input, also accept hidden elements (React may use hidden textarea)
            console.log(`🔍 findElement(${purpose}): matched "${selector}" → <${el.tagName.toLowerCase()}> id="${el.id || ''}" placeholder="${el.placeholder || ''}" [HIDDEN]`);
            // Don't return hidden yet, prefer visible
            continue;
          }
          if (el.offsetParent !== null) {
            console.log(`🔍 findElement(${purpose}): matched "${selector}" → <${el.tagName.toLowerCase()}> id="${el.id || ''}" placeholder="${el.placeholder || ''}"`);
            return el;
          }
        }
        // If only hidden ones found for input purpose, return first hidden
        if (purpose === 'input' && elements.length > 0) {
          console.log(`🔍 findElement(${purpose}): returning hidden element "${selector}" → <${elements[0].tagName.toLowerCase()}>`);
          return elements[0];
        }
      } catch (e) { /* selector may be invalid */ }
    }

    if (purpose === 'input') {
      // Deep search for any textarea
      const textareas = querySelectorAllDeep('textarea');
      const input = textareas.find(ta => {
        return ta.placeholder?.includes('vídeo') || ta.placeholder?.includes('Vídeo') ||
          ta.placeholder?.includes('criar') || ta.placeholder?.includes('create') ||
          ta.placeholder?.includes('O que');
      });
      if (input) return input;
      // Return first non-panel textarea
      if (textareas.length > 0) return textareas[0];
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
  // CHARACTER CONSISTENCY: IMAGE SELECTION
  // ============================================================================

  // Find a tab element by its visible text (e.g., "Imagens", "Vídeos")
  function findTabByText(tabName) {
    const lowerName = tabName.toLowerCase();

    // Strategy 1: role=tab elements
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      if (tab.closest('#veo3-panel, #veo3-bubble')) continue;
      const text = (tab.textContent || '').trim().toLowerCase();
      if (text.includes(lowerName)) return tab;
    }

    // Strategy 2: buttons in tab-like containers
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text === lowerName || text.includes(lowerName)) {
        // Check if it's in a tab-like context (parent has multiple sibling buttons)
        const parent = btn.parentElement;
        if (parent && parent.querySelectorAll('button').length >= 2) {
          return btn;
        }
      }
    }

    // Strategy 3: TreeWalker for text nodes
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.parentElement?.closest('#veo3-panel, #veo3-bubble')) return NodeFilter.FILTER_REJECT;
          return (node.textContent || '').trim().toLowerCase().includes(lowerName)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let textNode;
    while (textNode = walker.nextNode()) {
      let el = textNode.parentElement;
      while (el && el !== document.body) {
        if (el.matches('button, [role="tab"], a[role="tab"], [tabindex]')) {
          if (el.offsetParent !== null) return el;
        }
        el = el.parentElement;
      }
    }

    return null;
  }

  // Switch to a named tab (e.g., "Imagens" or "Vídeos")
  async function switchToTab(tabName) {
    const tab = findTabByText(tabName);
    if (!tab) {
      console.warn(`⚠️ Tab "${tabName}" not found`);
      return false;
    }

    // Check if already active
    const isActive = tab.getAttribute('aria-selected') === 'true' ||
      tab.classList.contains('active') ||
      tab.classList.contains('selected');
    if (isActive) {
      console.log(`📑 Tab "${tabName}" already active`);
      return true;
    }

    // Human-like click
    const rect = tab.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    await sleep(40 + Math.random() * 80);
    tab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    await sleep(10 + Math.random() * 30);
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));

    await sleep(CONFIG.TAB_SWITCH_DELAY);
    console.log(`📑 Switched to tab: "${tabName}"`);
    return true;
  }

  // Hover over an image card to reveal the "Incluir no comando" button
  async function hoverOverImageCard(container) {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Mouse events on the container
    container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
    container.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
    container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
    await sleep(300);

    // Hover on parent containers
    let parent = container.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
      parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
      parent.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
      parent = parent.parentElement;
    }
    await sleep(300);

    // Pointer events
    container.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: cx, clientY: cy }));
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }));
    container.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: cx, clientY: cy }));
    await sleep(CONFIG.IMAGE_HOVER_DELAY);
  }

  // Find image cards on the Imagens tab (large images = generated reference images)
  function findImageCards() {
    const cards = [];
    const seen = new Set();

    // Strategy 1: Large img elements (generated images are typically > 200px)
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      if (img.closest('#veo3-panel, #veo3-bubble')) continue;
      if (img.offsetParent === null) continue;
      const w = img.naturalWidth || img.width || img.getBoundingClientRect().width;
      const h = img.naturalHeight || img.height || img.getBoundingClientRect().height;
      if (w > 150 && h > 150) {
        // Find the card container (walk up to a meaningful wrapper)
        let card = img.parentElement;
        for (let i = 0; i < 5 && card; i++) {
          if (card.offsetWidth > 200 && card.offsetHeight > 200) break;
          card = card.parentElement;
        }
        if (card && !seen.has(card)) {
          seen.add(card);
          cards.push({ element: card, img });
          console.log(`🖼️ Card found: ${img.src?.substring(0, 60) || 'no-src'} (${Math.round(w)}x${Math.round(h)})`);
        }
      }
    }

    // Strategy 2: Figure elements or elements with image-related classes
    if (cards.length === 0) {
      const figures = document.querySelectorAll('figure, [class*="image-card"], [class*="imageCard"], [class*="gallery-item"]');
      for (const fig of figures) {
        if (fig.closest('#veo3-panel, #veo3-bubble')) continue;
        if (fig.offsetParent === null) continue;
        if (!seen.has(fig)) {
          seen.add(fig);
          const img = fig.querySelector('img');
          cards.push({ element: fig, img });
        }
      }
    }

    console.log(`🖼️ findImageCards: ${cards.length} card(s) found`);
    return cards;
  }

  // Search for "Incluir no comando" button near/within a specific card element
  function findIncluirButtonNear(cardEl) {
    // Search scope: the card and a few parent levels
    const searchRoots = [cardEl];
    let parent = cardEl.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      searchRoots.push(parent);
      parent = parent.parentElement;
    }

    for (const root of searchRoots) {
      // Check aria-label
      const ariaButtons = root.querySelectorAll(
        'button[aria-label*="Incluir"], button[aria-label*="incluir"], button[aria-label*="Include"], ' +
        '[role="button"][aria-label*="Incluir"], [role="button"][aria-label*="incluir"], ' +
        'button[title*="Incluir"], button[title*="incluir"]'
      );
      for (const btn of ariaButtons) {
        if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
        console.log(`🖼️ Found "Incluir" btn via aria/title: tag=${btn.tagName} aria="${btn.getAttribute('aria-label') || ''}" visible=${btn.offsetParent !== null}`);
        return btn; // Return even if offsetParent is null — it may be in hover overlay
      }

      // Check text content of buttons
      const allBtns = root.querySelectorAll('button, [role="button"], a');
      for (const btn of allBtns) {
        if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
        const text = (btn.textContent || '').toLowerCase();
        if (text.includes('incluir') || text.includes('include in')) {
          console.log(`🖼️ Found "Incluir" btn via text: tag=${btn.tagName} text="${text.trim().substring(0, 40)}" visible=${btn.offsetParent !== null}`);
          return btn;
        }
      }
    }

    // Global fallback: TreeWalker for ANY "Incluir no comando" text
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.parentElement?.closest('#veo3-panel, #veo3-bubble')) return NodeFilter.FILTER_REJECT;
          const text = (node.textContent || '').trim().toLowerCase();
          return (text.includes('incluir no comando') || text === 'incluir')
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let textNode;
    while (textNode = walker.nextNode()) {
      let el = textNode.parentElement;
      while (el && el !== document.body) {
        if (el.matches('button, [role="button"], a, [tabindex], span[role], div[role="button"]')) {
          console.log(`🖼️ Found "Incluir" btn via TreeWalker: tag=${el.tagName} text="${(el.textContent || '').trim().substring(0, 40)}" visible=${el.offsetParent !== null}`);
          return el;
        }
        el = el.parentElement;
      }
    }

    return null;
  }

  // Detect how many images are available on the "Image"/"Imagens" tab
  async function detectImagesOnPage() {
    try {
      // Switch to Images tab — try English first (2026 VEO3 UI), then Portuguese
      const switched = await switchToTab('Image') || await switchToTab('Imagens') || await switchToTab('Images');
      if (!switched) {
        console.warn('⚠️ Could not find Image tab');
      }
      await sleep(800);

      const cards = findImageCards();
      const count = cards.length;

      console.log(`🖼️ Detected ${count} image(s) on page`);

      // Switch back to Videos tab — try English first, then Portuguese
      await switchToTab('Video') || await switchToTab('Vídeos') || await switchToTab('Videos');

      return count;
    } catch (err) {
      console.warn(`⚠️ Image detection failed: ${err.message}`);
      return 0;
    }
  }

  // Multi-strategy click for framework-bound buttons
  async function clickIncluirButton(btn) {
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Snapshot state before click
    const textBefore = (btn.textContent || '').trim();
    const classBefore = btn.className;

    // Strategy A: Full pointer + mouse event sequence
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    await sleep(50);
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    await sleep(50);
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    await sleep(30);
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    await sleep(20);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    await sleep(250);

    // Check if it worked
    if (!btn.isConnected || (btn.textContent || '').trim() !== textBefore || btn.className !== classBefore) {
      return true;
    }

    // Strategy B: Native .click()
    btn.click();
    await sleep(250);

    if (!btn.isConnected || (btn.textContent || '').trim() !== textBefore || btn.className !== classBefore) {
      return true;
    }

    // Strategy C: Focus + Enter
    btn.focus();
    await sleep(80);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    btn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    await sleep(250);

    if (!btn.isConnected || (btn.textContent || '').trim() !== textBefore || btn.className !== classBefore) {
      return true;
    }

    // Strategy D: Dispatch click on all ancestors (framework might listen on parent)
    let ancestor = btn.parentElement;
    for (let i = 0; i < 3 && ancestor; i++) {
      ancestor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      ancestor = ancestor.parentElement;
    }
    await sleep(250);

    return !btn.isConnected || (btn.textContent || '').trim() !== textBefore || btn.className !== classBefore;
  }

  // Main orchestrator: select all reference images before sending a prompt
  async function selectAllImages() {
    if (state.imageSelectionInProgress) {
      return { success: false, count: 0, error: 'Seleção já em andamento' };
    }

    state.imageSelectionInProgress = true;

    try {
      // Step 1: Switch to Images tab — try English first (2026 VEO3 UI), then Portuguese
      let switched = await switchToTab('Image') || await switchToTab('Imagens') || await switchToTab('Images');
      if (!switched) {
        // VEO3 may auto-include images now (no tab needed). Continue gracefully.
        console.log('🖼️ Image tab not found — VEO3 may auto-include images as Ingredients');
        return { success: true, count: 0, error: null };
      }
      await sleep(600);

      // Step 2: Find image cards (the containers with generated images)
      const imageCards = findImageCards();
      if (imageCards.length === 0) {
        await switchToTab('Video') || await switchToTab('Vídeos') || await switchToTab('Videos');
        // Not an error — VEO3 may auto-include, or no images generated yet
        console.log('🖼️ No image cards found — VEO3 may auto-include images');
        return { success: true, count: 0, error: null };
      }

      // Step 3: For EACH card: hover → find "Incluir" button → click
      let selectedCount = 0;
      for (let i = 0; i < imageCards.length; i++) {
        const { element: card, img } = imageCards[i];

        console.log(`🖼️ Processing image ${i + 1}/${imageCards.length}...`);

        for (let retry = 0; retry < CONFIG.MAX_IMAGE_SELECT_RETRIES; retry++) {
          try {
            // Scroll card into view
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(300);

            // Hover to reveal overlay controls
            await hoverOverImageCard(card);
            // Also hover directly on the img element
            if (img) await hoverOverImageCard(img);
            await sleep(500);

            // Now search for the "Incluir no comando" button that should have appeared
            let incluirBtn = findIncluirButtonNear(card);

            if (!incluirBtn) {
              console.log(`🖼️ Image ${i + 1}: no button after hover — re-hovering...`);
              // Try hovering more aggressively with movement simulation
              const cardRect = card.getBoundingClientRect();
              for (let mx = 0; mx < 3; mx++) {
                const x = cardRect.left + (cardRect.width * (mx + 1)) / 4;
                const y = cardRect.top + cardRect.height / 2;
                card.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
                await sleep(150);
              }
              await sleep(500);
              incluirBtn = findIncluirButtonNear(card);
            }

            if (!incluirBtn) {
              console.warn(`🖼️ Image ${i + 1}: "Incluir" button NOT found (retry ${retry + 1})`);
              if (retry < CONFIG.MAX_IMAGE_SELECT_RETRIES - 1) {
                // Move mouse away and back to re-trigger hover
                document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 0 }));
                await sleep(300);
                continue; // retry
              }
              break; // give up on this card
            }

            // Click the "Incluir no comando" button
            console.log(`🖼️ Image ${i + 1}: clicking "Incluir" button...`);
            const confirmed = await clickIncluirButton(incluirBtn);

            if (confirmed) {
              console.log(`🖼️ ✅ Image ${i + 1}/${imageCards.length} — click confirmed!`);
            } else {
              console.log(`🖼️ ⚠️ Image ${i + 1}/${imageCards.length} — click sent but no state change`);
            }

            selectedCount++;
            await sleep(CONFIG.IMAGE_SELECT_DELAY);
            break; // success, move to next image
          } catch (err) {
            console.warn(`⚠️ Image ${i + 1} retry ${retry + 1}: ${err.message}`);
            await sleep(500);
          }
        }
      }

      // Step 4: Switch back to Videos tab — try English first, then Portuguese
      await switchToTab('Video') || await switchToTab('Vídeos') || await switchToTab('Videos');
      await sleep(500);

      // Step 5: Verify images appear in prompt area (circular thumbnails)
      const promptArea = document.querySelector('[class*="prompt"], [class*="input"], [class*="command"]');
      const thumbnails = promptArea ? promptArea.querySelectorAll('img') : [];
      if (thumbnails.length > 0) {
        console.log(`🖼️ ✅ ${thumbnails.length} thumbnail(s) visible in prompt area`);
      } else {
        console.log(`🖼️ ⚠️ No thumbnails detected in prompt area after selection`);
      }

      return { success: selectedCount > 0, count: selectedCount, error: null };
    } catch (err) {
      console.error(`❌ selectAllImages error: ${err.message}`);
      try {
        await switchToTab('Video') || await switchToTab('Vídeos') || await switchToTab('Videos');
      } catch (e) { /* ignore */ }
      return { success: false, count: 0, error: err.message };
    } finally {
      state.imageSelectionInProgress = false;
    }
  }

  // ============================================================================
  // DIAGNOSTIC SYSTEM
  // ============================================================================

  // mode: 'light' = quick overview (inputs, buttons, images count)
  // mode: 'deep'  = full scan (all of light + @Name cards, Incluir buttons, tabs, DOM tree, image cards detail)
  async function runDiagnostic(mode = 'light') {
    const info = [];
    const isDeep = mode === 'deep';
    const ts = new Date().toLocaleTimeString('pt-BR');
    info.push(`=== VEO3 DIAGNOSTIC (${isDeep ? 'PROFUNDO' : 'RÁPIDO'}) — ${ts} ===`);
    info.push(`URL: ${window.location.href}`);
    info.push(`Script: v1.5.0`);

    updateStatus(`🔍 Executando diagnóstico ${isDeep ? 'profundo' : 'rápido'}...`);

    // Disable buttons during diagnostic
    const lightBtn = document.getElementById('veo3-diag-light-btn');
    const deepBtn = document.getElementById('veo3-diag-deep-btn');
    if (lightBtn) lightBtn.disabled = true;
    if (deepBtn) deepBtn.disabled = true;

    try {
      // ─── SECTION 1: INPUT ELEMENTS ───
      info.push('\n── INPUTS ──');
      const tas = document.querySelectorAll('textarea');
      info.push(`Textareas: ${tas.length}`);
      tas.forEach((ta, i) => {
        const ours = ta.closest('#veo3-panel, #veo3-bubble') ? ' [NOSSO]' : '';
        info.push(`  [${i}] id="${ta.id}" placeholder="${(ta.placeholder || '').substring(0, 50)}" visible=${ta.offsetParent !== null}${ours}`);
      });

      const ces = document.querySelectorAll('[contenteditable="true"]');
      info.push(`Contenteditables: ${ces.length}`);
      ces.forEach((ce, i) => {
        const ours = ce.closest('#veo3-panel, #veo3-bubble') ? ' [NOSSO]' : '';
        info.push(`  [${i}] <${ce.tagName}> role="${ce.getAttribute('role') || ''}" visible=${ce.offsetParent !== null} text="${(ce.textContent || '').substring(0, 30)}"${ours}`);
      });

      // ─── SECTION 2: BUTTONS (send, download) ───
      info.push('\n── BOTÕES ──');
      const sendBtn = findElement(SELECTORS.sendButton, 'send');
      info.push(`Botão Enviar: ${sendBtn ? `✅ <${sendBtn.tagName}> text="${(sendBtn.textContent || '').trim().substring(0, 30)}"` : '❌ NÃO ENCONTRADO'}`);

      const dlBtn = findElement(SELECTORS.sendButton, 'download');
      info.push(`Botão Download: ${dlBtn ? `✅ <${dlBtn.tagName}>` : '⚠️ não visível (normal se não há vídeo pronto)'}`);

      // Google Symbols icons summary
      const allIcons = document.querySelectorAll('i.google-symbols');
      const iconNames = [];
      allIcons.forEach(icon => {
        const t = (icon.textContent || '').trim();
        if (t && icon.offsetParent !== null) iconNames.push(t);
      });
      info.push(`Google Symbols visíveis: ${iconNames.length} → [${[...new Set(iconNames)].join(', ')}]`);

      // ─── SECTION 3: IMAGES & VIDEOS ───
      info.push('\n── IMAGENS & VÍDEOS ──');
      const allImgs = document.querySelectorAll('img');
      let contentImgs = 0;
      allImgs.forEach(img => {
        if (img.closest('#veo3-panel, #veo3-bubble')) return;
        if (img.offsetParent === null) return;
        const r = img.getBoundingClientRect();
        if (r.width >= 80 && r.height >= 80) contentImgs++;
      });
      info.push(`Imagens totais: ${allImgs.length} | Conteúdo (≥80px): ${contentImgs}`);

      const allVideos = document.querySelectorAll('video');
      info.push(`Vídeos: ${allVideos.length}`);
      allVideos.forEach((v, i) => {
        info.push(`  [${i}] src="${(v.src || v.currentSrc || '').substring(0, 60)}" ${Math.round(v.getBoundingClientRect().width)}x${Math.round(v.getBoundingClientRect().height)} duration=${v.duration || '?'}`);
      });

      // ─── SECTION 4: @NAME CHARACTER DETECTION ───
      info.push('\n── @NOME: PERSONAGENS ──');

      // Find all visible text containing @
      const atElements = [];
      document.querySelectorAll('*:not(script):not(style):not(#veo3-panel *):not(#veo3-bubble *)').forEach(el => {
        // Only leaf nodes or nodes with single text child
        if (el.children.length > 0 && el.childNodes.length > 1) return;
        const text = (el.textContent || '').trim();
        if (!text.includes('@') || text.length > 300) return;
        if (el.offsetParent === null && el.style.display !== 'contents') return;
        atElements.push(el);
      });

      info.push(`Elementos com "@" visíveis: ${atElements.length}`);
      atElements.forEach((el, i) => {
        const text = (el.textContent || '').trim();
        const rect = el.getBoundingClientRect();
        const parentTag = el.parentElement ? `<${el.parentElement.tagName}>` : '';
        info.push(`  [${i}] <${el.tagName}> ${parentTag} (${Math.round(rect.left)},${Math.round(rect.top)}) "${text.substring(0, 120)}"`);
      });

      // Run findCharacterCards()
      const cardMap = findCharacterCards();
      info.push(`\nfindCharacterCards() resultado: ${cardMap.size} personagem(ns)`);
      for (const [name, card] of cardMap) {
        const rect = card.getBoundingClientRect();
        const hasImg = card.querySelector('img') ? '✅ tem img' : '❌ sem img';
        info.push(`  @${name} → <${card.tagName}> cls="${(card.className || '').toString().substring(0, 50)}" (${Math.round(rect.left)},${Math.round(rect.top)}) ${Math.round(rect.width)}x${Math.round(rect.height)} ${hasImg}`);
      }

      // ─── SECTION 5 (DEEP ONLY): IMAGE CARDS + INCLUIR BUTTONS ───
      if (isDeep) {
        info.push('\n── [PROFUNDO] CARDS DE IMAGEM ──');
        const imageCards = findImageCards();
        info.push(`findImageCards(): ${imageCards.length} card(s)`);
        for (let i = 0; i < imageCards.length; i++) {
          const { element: card, img } = imageCards[i];
          const rect = card.getBoundingClientRect();
          const imgSrc = img ? (img.src || '').substring(0, 60) : 'sem-img';
          info.push(`  [${i + 1}] <${card.tagName}> cls="${(card.className || '').toString().substring(0, 50)}" (${Math.round(rect.left)},${Math.round(rect.top)}) ${Math.round(rect.width)}x${Math.round(rect.height)} src="${imgSrc}"`);

          // Check for nearby text containing @
          const nearbyText = (card.textContent || '').trim();
          const atMatch = nearbyText.match(/@\w[\w\s-]*?:/);
          if (atMatch) {
            info.push(`    📛 Nome detectado no card: "${atMatch[0]}"`);
          }

          // Look for Incluir button
          const incluirBtn = findIncluirButtonNear(card);
          if (incluirBtn) {
            info.push(`    🟢 Botão Incluir: <${incluirBtn.tagName}> text="${(incluirBtn.textContent || '').trim().substring(0, 40)}" visible=${incluirBtn.offsetParent !== null} aria="${incluirBtn.getAttribute('aria-label') || ''}"`);
          } else {
            info.push(`    🔴 Botão Incluir: NÃO ENCONTRADO`);
          }
        }

        // Check for @Name in character cards that findCharacterCards found
        if (cardMap.size > 0) {
          info.push('\n── [PROFUNDO] HOVER + INCLUIR TEST ──');
          for (const [name, card] of cardMap) {
            info.push(`  @${name}: hovering...`);
            try {
              await hoverOverImageCard(card);
              const img = card.querySelector('img');
              if (img) await hoverOverImageCard(img);
              await sleep(600);

              const btn = findIncluirButtonNear(card);
              if (btn) {
                info.push(`    🟢 Botão encontrado APÓS hover: <${btn.tagName}> text="${(btn.textContent || '').trim().substring(0, 40)}" visible=${btn.offsetParent !== null}`);
              } else {
                // Scan more broadly - any new buttons that appeared?
                const allBtns = card.querySelectorAll('button, [role="button"]');
                info.push(`    🔴 Botão NÃO encontrado após hover. Botões dentro do card: ${allBtns.length}`);
                allBtns.forEach((b, bi) => {
                  info.push(`      [${bi}] <${b.tagName}> text="${(b.textContent || '').trim().substring(0, 40)}" visible=${b.offsetParent !== null} aria="${b.getAttribute('aria-label') || ''}"`);
                });

                // Check parent too
                if (card.parentElement) {
                  const parentBtns = card.parentElement.querySelectorAll('button, [role="button"]');
                  info.push(`    Botões no parent: ${parentBtns.length}`);
                  parentBtns.forEach((b, bi) => {
                    if (b.closest('#veo3-panel')) return;
                    info.push(`      [${bi}] <${b.tagName}> text="${(b.textContent || '').trim().substring(0, 40)}" visible=${b.offsetParent !== null} aria="${b.getAttribute('aria-label') || ''}"`);
                  });
                }
              }

              // Mouse leave
              card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            } catch (e) {
              info.push(`    ❌ Erro no hover: ${e.message}`);
            }
          }
        }

        // ─── SECTION 6 (DEEP): TABS ───
        info.push('\n── [PROFUNDO] TABS/ABAS ──');
        const tabCandidates = document.querySelectorAll('[role="tab"], [role="tablist"] *, button[class*="tab"], a[class*="tab"]');
        info.push(`Tab candidates: ${tabCandidates.length}`);
        tabCandidates.forEach((tab, i) => {
          if (tab.closest('#veo3-panel, #veo3-bubble')) return;
          const text = (tab.textContent || '').trim();
          const selected = tab.getAttribute('aria-selected');
          info.push(`  [${i}] <${tab.tagName}> text="${text.substring(0, 30)}" selected=${selected || '?'} visible=${tab.offsetParent !== null}`);
        });

        // ─── SECTION 7 (DEEP): SHADOW DOM ───
        info.push('\n── [PROFUNDO] SHADOW DOM ──');
        let shadowCount = 0;
        document.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot) {
            shadowCount++;
            const innerImgs = el.shadowRoot.querySelectorAll('img');
            const innerBtns = el.shadowRoot.querySelectorAll('button');
            if (innerImgs.length > 0 || innerBtns.length > 5) {
              info.push(`  Shadow <${el.tagName}> id="${el.id}": ${innerImgs.length} img, ${innerBtns.length} btns`);
            }
          }
        });
        info.push(`  Total shadow roots: ${shadowCount}`);

        // ─── SECTION 8 (DEEP): ALL BUTTONS ON PAGE ───
        info.push('\n── [PROFUNDO] TODOS OS BOTÕES (fora do painel) ──');
        const allPageBtns = document.querySelectorAll('button, [role="button"]');
        let btnIdx = 0;
        allPageBtns.forEach(btn => {
          if (btn.closest('#veo3-panel, #veo3-bubble')) return;
          if (btn.offsetParent === null) return;
          const text = (btn.textContent || '').trim().substring(0, 50);
          const aria = btn.getAttribute('aria-label') || '';
          const title = btn.title || '';
          const icon = btn.querySelector('i.google-symbols');
          const iconText = icon ? (icon.textContent || '').trim() : '';
          const rect = btn.getBoundingClientRect();
          info.push(`  [${btnIdx++}] <${btn.tagName}> (${Math.round(rect.left)},${Math.round(rect.top)}) text="${text}" aria="${aria}" title="${title}" icon="${iconText}"`);
        });
        info.push(`  Total botões visíveis (fora painel): ${btnIdx}`);

        // ─── SECTION 9 (DEEP): PROMPT INPUT AREA SCAN ───
        info.push('\n── [PROFUNDO] ÁREA DO PROMPT INPUT ──');
        try {
          // Find the contenteditable textbox (the main VEO3 input)
          const veoInput = document.querySelector('div[contenteditable="true"][role="textbox"]')
            || document.querySelector('[contenteditable="true"][role="textbox"]');

          if (!veoInput) {
            info.push('  ❌ Textbox não encontrado');
          } else {
            const inputRect = veoInput.getBoundingClientRect();
            info.push(`  Textbox: (${Math.round(inputRect.left)},${Math.round(inputRect.top)}) ${Math.round(inputRect.width)}x${Math.round(inputRect.height)}`);

            // Focus the input first — the "+" may only appear when focused
            veoInput.focus();
            veoInput.click();
            await sleep(500);

            // Scan ALL elements near the textbox (within 150px vertically)
            const yMin = inputRect.top - 150;
            const yMax = inputRect.bottom + 150;
            info.push(`  Escaneando elementos entre y=${Math.round(yMin)} e y=${Math.round(yMax)}...`);

            const nearbyEls = [];
            document.querySelectorAll('*').forEach(el => {
              if (el.closest('#veo3-panel, #veo3-bubble')) return;
              if (el.offsetParent === null && el.style.display !== 'contents') return;
              if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return;
              const r = el.getBoundingClientRect();
              if (r.width < 10 || r.height < 10) return;
              if (r.top < yMin || r.top > yMax) return;
              // Only report leaf or semi-leaf elements (not giant containers)
              if (r.width > 800 && r.height > 200) return;
              nearbyEls.push(el);
            });

            info.push(`  Elementos perto do input: ${nearbyEls.length}`);
            const seenPos = new Set();
            nearbyEls.forEach((el, i) => {
              const r = el.getBoundingClientRect();
              const posKey = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
              if (seenPos.has(posKey)) return;
              seenPos.add(posKey);
              const text = (el.textContent || '').trim().substring(0, 50);
              const tag = el.tagName;
              const role = el.getAttribute('role') || '';
              const cls = (el.className || '').toString().substring(0, 40);
              const clickable = el.matches('button, a, [role="button"], [tabindex="0"], [tabindex="-1"], input, label') ? ' 👆' : '';
              const icon = el.querySelector('i.google-symbols');
              const iconText = icon ? ` icon="${(icon.textContent || '').trim()}"` : '';
              info.push(`    <${tag}> role="${role}" cls="${cls}" (${Math.round(r.left)},${Math.round(r.top)}) ${Math.round(r.width)}x${Math.round(r.height)} "${text}"${iconText}${clickable}`);
            });
          }
        } catch (e) {
          info.push(`  ❌ Erro: ${e.message}`);
        }

        // ─── SECTION 10 (DEEP): CLICK "+" AND MAP RESOURCE PICKER POPUP ───
        info.push('\n── [PROFUNDO] POPUP DE RECURSOS (botão "+") ──');
        try {
          // Find the "+" button near the prompt area.
          // Strategy: find ALL elements that look like "+" near the input (y > 800)
          const veoInput = document.querySelector('div[contenteditable="true"][role="textbox"]');
          const inputY = veoInput ? veoInput.getBoundingClientRect().top : 800;
          let addBtn = null;

          // Strategy 1: button/div near input with "add" icon or "+" text
          const candidates = document.querySelectorAll('button, [role="button"], [tabindex="0"], [tabindex="-1"]');
          const addCandidates = [];
          for (const el of candidates) {
            if (el.closest('#veo3-panel, #veo3-bubble')) continue;
            if (el.offsetParent === null) continue;
            const rect = el.getBoundingClientRect();
            const text = (el.textContent || '').trim();
            const icon = el.querySelector('i.google-symbols');
            const iconText = icon ? (icon.textContent || '').trim() : '';
            const isAdd = iconText === 'add' || iconText === 'add_circle' || text === '+';
            // Must be near the input area (within 200px vertically)
            const nearInput = Math.abs(rect.top - inputY) < 200;
            if (isAdd || nearInput) {
              const dist = Math.abs(rect.top - inputY);
              addCandidates.push({ el, rect, text: text.substring(0, 40), iconText, dist, isAdd });
            }
          }

          // Sort: prefer "add" icons near input, then any "add" icon
          addCandidates.sort((a, b) => {
            if (a.isAdd && !b.isAdd) return -1;
            if (!a.isAdd && b.isAdd) return 1;
            return a.dist - b.dist;
          });

          info.push(`  Candidatos "+" encontrados: ${addCandidates.length}`);
          addCandidates.slice(0, 8).forEach((c, i) => {
            info.push(`    [${i}] (${Math.round(c.rect.left)},${Math.round(c.rect.top)}) ${Math.round(c.rect.width)}x${Math.round(c.rect.height)} icon="${c.iconText}" text="${c.text}" dist=${Math.round(c.dist)} isAdd=${c.isAdd}`);
          });

          // Pick: nearest "add" icon to input
          const bestAdd = addCandidates.find(c => c.isAdd && c.dist < 200);
          if (bestAdd) {
            addBtn = bestAdd.el;
            info.push(`  ✅ Usando: (${Math.round(bestAdd.rect.left)},${Math.round(bestAdd.rect.top)}) icon="${bestAdd.iconText}" text="${bestAdd.text}"`);
          } else if (addCandidates.length > 0 && addCandidates[0].isAdd) {
            addBtn = addCandidates[0].el;
            info.push(`  ⚠️ Usando melhor candidato add: (${Math.round(addCandidates[0].rect.left)},${Math.round(addCandidates[0].rect.top)})`);
          }

          if (!addBtn) {
            // Strategy 2: Look for SVG or span with "+" inside the input area
            const inputParent = veoInput?.parentElement?.parentElement?.parentElement;
            if (inputParent) {
              const allEls = inputParent.querySelectorAll('*');
              for (const el of allEls) {
                const text = (el.textContent || '').trim();
                if (text === '+' || text === 'add') {
                  info.push(`  📍 Encontrado "${text}" em <${el.tagName}> cls="${(el.className || '').toString().substring(0, 40)}"`);
                  const clickable = el.closest('button, [role="button"], [tabindex]');
                  if (clickable) {
                    addBtn = clickable;
                    info.push(`  ✅ Parent clicável: <${clickable.tagName}>`);
                  } else {
                    addBtn = el;
                    info.push(`  ⚠️ Usando elemento direto: <${el.tagName}>`);
                  }
                  break;
                }
              }
            }
          }

          if (!addBtn) {
            info.push('  ❌ Botão "+" NÃO encontrado perto do input');
            info.push('  💡 O "+" pode aparecer apenas ao clicar/focar o input. Tente clicar no campo de texto e rodar novamente.');
          } else {
            info.push(`  ✅ Clicando no "+" ...`);
            // Full event sequence
            const r = addBtn.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            addBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
            await sleep(50);
            addBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
            await sleep(50);
            addBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy }));
            addBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
            addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy }));
            addBtn.click();
            await sleep(1000);

            // Snapshot DOM after click — look for popup/dialog/overlay
            const popups = document.querySelectorAll(
              '[role="dialog"], [role="listbox"], [role="menu"], [role="presentation"]:not(iframe), ' +
              '[class*="popup"], [class*="modal"], [class*="dropdown"], ' +
              '[class*="picker"], [class*="resource"]'
            );
            info.push(`  Popups/dialogs: ${popups.length}`);

            // Search for resource items (the character thumbnails with titles)
            let resourceItems = [];
            // Broad search: any new visible element with image + text that looks like a resource
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              if (el.closest('#veo3-panel, #veo3-bubble')) continue;
              if (el.offsetParent === null) continue;
              const rect = el.getBoundingClientRect();
              if (rect.width < 30 || rect.height < 20) continue;
              // Must be in popup zone (above the input)
              if (rect.top > inputY + 50) continue;
              if (rect.top < inputY - 600) continue;

              const text = (el.textContent || '').trim();
              const hasImg = el.querySelector('img');
              const tag = el.tagName;
              const role = el.getAttribute('role') || '';
              const cls = (el.className || '').toString();

              // Look for items that look like resource entries
              const isResourceItem = (
                (hasImg && text.length > 3 && text.length < 100 && rect.height < 80) ||
                role === 'option' || role === 'menuitem' || role === 'listitem' ||
                (cls.includes('item') && hasImg) ||
                (cls.includes('resource') || cls.includes('asset') || cls.includes('result'))
              );
              if (!isResourceItem) continue;

              resourceItems.push({
                el, text: text.substring(0, 80), tag, role,
                cls: cls.substring(0, 50),
                x: Math.round(rect.left), y: Math.round(rect.top),
                w: Math.round(rect.width), h: Math.round(rect.height),
                hasImg: hasImg ? '🖼️' : ''
              });
            }

            // Deduplicate
            const seenRes = new Set();
            resourceItems = resourceItems.filter(r => {
              const key = `${r.x},${r.y},${r.w}`;
              if (seenRes.has(key)) return false;
              seenRes.add(key);
              return true;
            });

            info.push(`  Itens de recurso: ${resourceItems.length}`);
            resourceItems.forEach((r, i) => {
              info.push(`    [${i}] <${r.tag}> role="${r.role}" cls="${r.cls}" (${r.x},${r.y}) ${r.w}x${r.h} ${r.hasImg} "${r.text}"`);
            });

            // Dump popup DOM structure
            for (const popup of popups) {
              if (popup.closest('#veo3-panel')) continue;
              if (popup.tagName === 'IFRAME') continue;
              const pRect = popup.getBoundingClientRect();
              if (pRect.width < 50) continue;
              info.push(`\n  Popup DOM (<${popup.tagName}> role="${popup.getAttribute('role') || ''}" cls="${(popup.className || '').toString().substring(0, 40)}" ${Math.round(pRect.width)}x${Math.round(pRect.height)}):`);
              const children = popup.querySelectorAll('*');
              let ci = 0;
              children.forEach(child => {
                if (ci > 40) return;
                if (child.offsetParent === null) return;
                const cRect = child.getBoundingClientRect();
                if (cRect.width < 10) return;
                const text = (child.textContent || '').trim();
                if (text.length === 0) return;
                const tag = child.tagName;
                const role = child.getAttribute('role') || '';
                const cls = (child.className || '').toString().substring(0, 40);
                const clickable = child.matches('button, a, [role="button"], [role="option"], [role="menuitem"], [tabindex]') ? ' 👆' : '';
                const img = child.querySelector('img');
                const imgMark = img ? ' 🖼️' : '';
                info.push(`    <${tag}> role="${role}" cls="${cls}" (${Math.round(cRect.left)},${Math.round(cRect.top)}) ${Math.round(cRect.width)}x${Math.round(cRect.height)} "${text.substring(0, 60)}"${clickable}${imgMark}`);
                ci++;
              });
            }

            // Close popup
            info.push('\n  Fechando popup (Escape)...');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            await sleep(300);
            document.body.click();
            await sleep(300);
          }
        } catch (popupErr) {
          info.push(`  ❌ Erro ao testar popup: ${popupErr.message}`);
        }
      }

      // ─── SUMMARY ───
      info.push('\n── RESUMO ──');
      info.push(`Input: ${ces.length > 0 ? '✅' : '❌'} | Send: ${sendBtn ? '✅' : '❌'} | Imgs(≥80px): ${contentImgs} | Videos: ${allVideos.length} | @Names: ${cardMap.size}`);

      const output = info.join('\n');
      console.log(output);

      // Copy to clipboard
      navigator.clipboard.writeText(output).then(() => {
        updateStatus(`📋 Diagnóstico ${isDeep ? 'profundo' : 'rápido'} copiado! Cole aqui no chat.`);
      }).catch(() => {
        // Fallback: show in prompt dialog
        window.prompt('Copie o texto abaixo:', output);
      });
    } finally {
      if (lightBtn) lightBtn.disabled = false;
      if (deepBtn) deepBtn.disabled = false;
    }
  }

  // ============================================================================
  // CHARACTER-BASED IMAGE SELECTION (auto-detect @Name: on page)
  // ============================================================================

  // Selects specific character images by auto-detecting @Name: text on page
  // characterNames: array of lowercase names from [CHARS:] directive
  // Reuses existing helpers: hoverOverImageCard, findIncluirButtonNear, clickIncluirButton
  // Opens the ⋮ context menu on an image card and clicks "Incluir no comando"
  // The ⋮ button may be hidden (CSS :hover only) — we force-click it via multiple strategies
  async function includeCardViaContextMenu(card, label) {
    // Step A: Find the ⋮ (more_vert) button — search broadly (may be hidden)
    let moreBtn = null;

    // Search inside the card and up to 2 parent levels
    const searchRoots = [card];
    if (card.parentElement) searchRoots.push(card.parentElement);
    if (card.parentElement?.parentElement) searchRoots.push(card.parentElement.parentElement);

    for (const root of searchRoots) {
      const btns = root.querySelectorAll('button, [role="button"]');
      for (const btn of btns) {
        if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
        const icon = btn.querySelector('i.google-symbols');
        const iconText = icon ? (icon.textContent || '').trim() : '';
        const text = (btn.textContent || '').toLowerCase();
        if (iconText === 'more_vert' || text.includes('mais opç') || text.includes('more')) {
          moreBtn = btn;
          break;
        }
      }
      if (moreBtn) break;
    }

    // Strategy B: Even hidden buttons are in the DOM — search ALL descendants
    if (!moreBtn) {
      const allDescendants = card.querySelectorAll('i.google-symbols');
      for (const icon of allDescendants) {
        if ((icon.textContent || '').trim() === 'more_vert') {
          moreBtn = icon.closest('button') || icon.parentElement;
          break;
        }
      }
    }

    // Strategy C: Find by position — look for more_vert buttons at similar Y as card
    if (!moreBtn) {
      const cardRect = card.getBoundingClientRect();
      const allMoreBtns = document.querySelectorAll('i.google-symbols');
      for (const icon of allMoreBtns) {
        if ((icon.textContent || '').trim() !== 'more_vert') continue;
        const btn = icon.closest('button') || icon.parentElement;
        if (!btn) continue;
        const btnRect = btn.getBoundingClientRect();
        // Must be within the same vertical band as the card
        if (Math.abs(btnRect.top - cardRect.top) < cardRect.height) {
          moreBtn = btn;
          break;
        }
      }
    }

    if (!moreBtn) {
      console.warn(`🎭 ${label}: ⋮ (more_vert) button not found`);
      // Fallback: try right-click (contextmenu event) on the image
      const img = card.querySelector('img, a');
      if (img) {
        console.log(`🎭 ${label}: trying contextmenu event on image...`);
        const imgRect = img.getBoundingClientRect();
        img.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true,
          clientX: imgRect.left + imgRect.width / 2,
          clientY: imgRect.top + imgRect.height / 2
        }));
        await sleep(600);
      } else {
        return false;
      }
    } else {
      // Force visibility and click the ⋮ button
      console.log(`🎭 ${label}: clicking ⋮ (more_vert)... visible=${moreBtn.offsetParent !== null}`);

      // Temporarily force-show the button if hidden
      const origDisplay = moreBtn.style.display;
      const origVisibility = moreBtn.style.visibility;
      const origOpacity = moreBtn.style.opacity;
      const origPointerEvents = moreBtn.style.pointerEvents;
      moreBtn.style.setProperty('display', 'inline-flex', 'important');
      moreBtn.style.setProperty('visibility', 'visible', 'important');
      moreBtn.style.setProperty('opacity', '1', 'important');
      moreBtn.style.setProperty('pointer-events', 'auto', 'important');

      // Also force-show parent containers that might be hiding it
      const hiddenAncestors = [];
      let ancestor = moreBtn.parentElement;
      for (let i = 0; i < 5 && ancestor && ancestor !== card; i++) {
        if (ancestor.offsetParent === null || getComputedStyle(ancestor).opacity === '0') {
          hiddenAncestors.push({
            el: ancestor,
            origDisplay: ancestor.style.display,
            origVisibility: ancestor.style.visibility,
            origOpacity: ancestor.style.opacity
          });
          ancestor.style.setProperty('display', 'flex', 'important');
          ancestor.style.setProperty('visibility', 'visible', 'important');
          ancestor.style.setProperty('opacity', '1', 'important');
        }
        ancestor = ancestor.parentElement;
      }

      await sleep(100);

      // Click with full event sequence
      const rect = moreBtn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      moreBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      await sleep(30);
      moreBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      await sleep(30);
      moreBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      moreBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      moreBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      moreBtn.click();
      await sleep(600);

      // Restore original styles
      moreBtn.style.display = origDisplay;
      moreBtn.style.visibility = origVisibility;
      moreBtn.style.opacity = origOpacity;
      moreBtn.style.pointerEvents = origPointerEvents;
      for (const h of hiddenAncestors) {
        h.el.style.display = h.origDisplay;
        h.el.style.visibility = h.origVisibility;
        h.el.style.opacity = h.origOpacity;
      }
    }

    // Step B: Find "Incluir no comando" in the context menu that appeared
    await sleep(200);
    let incluirMenuItem = null;

    // Search for the menu item by text
    const menuItems = document.querySelectorAll(
      '[role="menuitem"], [role="option"], button, [role="button"], a'
    );
    for (const item of menuItems) {
      if (item.closest('#veo3-panel, #veo3-bubble')) continue;
      const text = (item.textContent || '').toLowerCase();
      if (text.includes('incluir no comando') || text.includes('include in prompt') ||
        text.includes('incluir') && text.includes('comando')) {
        incluirMenuItem = item;
        console.log(`🎭 ${label}: found "Incluir no comando" → <${item.tagName}> text="${(item.textContent || '').trim().substring(0, 40)}"`);
        break;
      }
    }

    // Also try: search by "add" icon near menu items
    if (!incluirMenuItem) {
      const icons = document.querySelectorAll('i.google-symbols');
      for (const icon of icons) {
        if ((icon.textContent || '').trim() === 'add') {
          const parent = icon.closest('button, [role="menuitem"], [role="button"], a, li, div');
          if (parent && parent.offsetParent !== null) {
            const text = (parent.textContent || '').toLowerCase();
            if (text.includes('incluir') || text.includes('include')) {
              incluirMenuItem = parent;
              console.log(`🎭 ${label}: found "Incluir" via add icon → <${parent.tagName}>`);
              break;
            }
          }
        }
      }
    }

    if (!incluirMenuItem) {
      console.warn(`🎭 ${label}: "Incluir no comando" menu item NOT found`);
      // Close menu by pressing Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(200);
      return false;
    }

    // Step C: Click "Incluir no comando"
    console.log(`🎭 ${label}: clicking "Incluir no comando"...`);
    const miRect = incluirMenuItem.getBoundingClientRect();
    const miCx = miRect.left + miRect.width / 2;
    const miCy = miRect.top + miRect.height / 2;
    incluirMenuItem.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: miCx, clientY: miCy }));
    await sleep(30);
    incluirMenuItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: miCx, clientY: miCy }));
    await sleep(30);
    incluirMenuItem.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: miCx, clientY: miCy }));
    incluirMenuItem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: miCx, clientY: miCy }));
    incluirMenuItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: miCx, clientY: miCy }));
    incluirMenuItem.click();

    await sleep(500);
    console.log(`🎭 ✅ ${label}: "Incluir no comando" clicked!`);
    return true;
  }

  // Selects specific character images by auto-detecting @Name: text on page
  // Uses the ⋮ context menu → "Incluir no comando" flow
  async function selectCharacterImages(characterNames) {
    if (state.imageSelectionInProgress) {
      return { success: false, count: 0, error: 'Seleção já em andamento' };
    }
    state.imageSelectionInProgress = true;

    try {
      // VEO3 Flow shows images and videos on the SAME page (no separate tabs)
      console.log(`🎭 Scanning page for @Name: patterns... (looking for: ${characterNames.join(', ')})`);

      const cardMap = findCharacterCards();

      if (cardMap.size === 0) {
        console.warn('⚠️ No @Name: character cards found on page');
        return { success: false, count: 0, error: 'Nenhum personagem @Nome encontrado na página' };
      }

      // Match requested names to found cards (exact + fuzzy)
      const matched = [];
      const notFound = [];
      for (const name of characterNames) {
        if (cardMap.has(name)) {
          matched.push({ name, card: cardMap.get(name) });
        } else {
          let found = false;
          for (const [key, card] of cardMap) {
            if (key.startsWith(name) || name.startsWith(key) || key.includes(name) || name.includes(key)) {
              matched.push({ name, card });
              console.log(`🎭 Fuzzy match: "${name}" → "${key}"`);
              found = true;
              break;
            }
          }
          if (!found) notFound.push(name);
        }
      }

      if (notFound.length > 0) {
        console.warn(`⚠️ Characters not found on page: ${notFound.join(', ')}`);
        updateStatus(`⚠️ Não encontrado(s): ${notFound.join(', ')}`);
      }

      if (matched.length === 0) {
        return { success: false, count: 0, error: `Personagens não encontrados: ${characterNames.join(', ')}` };
      }

      console.log(`🎭 Selecting ${matched.length} character(s): ${matched.map(m => m.name).join(', ')}`);

      // For each matched character: open ⋮ menu → click "Incluir no comando"
      let count = 0;
      for (const { name, card } of matched) {
        // Scroll card into view
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(400);

        const success = await includeCardViaContextMenu(card, `@${name}`);
        if (success) {
          count++;
          updateStatus(`🎭 ✅ @${name} incluído no comando`);
        } else {
          updateStatus(`🎭 ⚠️ @${name}: não conseguiu incluir`);
        }

        await sleep(CONFIG.IMAGE_SELECT_DELAY);
      }

      console.log(`🎭 Character selection complete: ${count}/${matched.length} included`);
      return { success: count > 0, count, error: null };
    } catch (err) {
      console.error(`❌ selectCharacterImages error: ${err.message}`);
      return { success: false, count: 0, error: err.message };
    } finally {
      state.imageSelectionInProgress = false;
    }
  }

  // ============================================================================
  // IMAGE-BY-KEYWORD SELECTION (via "+" button → resource panel)
  // ============================================================================

  // Remove images/thumbnails already attached to the prompt area
  // before including new ones (prevents accumulation across consecutive prompts)
  async function clearAttachedImages() {
    // Strategy 1: Find "x" / close buttons on image chips/thumbnails in the prompt area
    const promptAreas = document.querySelectorAll(
      '[class*="prompt"], [class*="input"], [class*="command"], ' +
      '[class*="composer"], [class*="editor"], [class*="textarea"]'
    );

    let cleared = 0;
    for (const area of promptAreas) {
      if (area.closest('#veo3-panel, #veo3-bubble')) continue;

      // Look for close/remove buttons on attached image chips
      const closeButtons = area.querySelectorAll(
        'button[aria-label*="Remover"], button[aria-label*="remover"], ' +
        'button[aria-label*="Remove"], button[aria-label*="remove"], ' +
        'button[aria-label*="close"], button[aria-label*="Close"], ' +
        'button[aria-label*="Fechar"], button[aria-label*="fechar"], ' +
        'button[aria-label*="Excluir"], button[aria-label*="excluir"]'
      );

      for (const btn of closeButtons) {
        try {
          btn.click();
          cleared++;
          await sleep(200);
        } catch (e) { /* ignore */ }
      }
    }

    // Strategy 2: Find X/close icons near tiny thumbnails (<50px)
    if (cleared === 0) {
      const tinyImgs = document.querySelectorAll('img');
      for (const img of tinyImgs) {
        if (img.closest('#veo3-panel, #veo3-bubble')) continue;
        const rect = img.getBoundingClientRect();
        // Attached thumbnails are small circular chips (typically 24-48px)
        if (rect.width > 12 && rect.width < 60 && rect.height > 12 && rect.height < 60) {
          const container = img.parentElement;
          if (!container) continue;
          const closeBtn = container.querySelector(
            'button, [role="button"], i.google-symbols'
          );
          if (closeBtn) {
            const iconText = (closeBtn.textContent || '').trim();
            if (iconText === 'close' || iconText === 'cancel' || iconText === '✕' || iconText === '×') {
              try {
                closeBtn.click();
                cleared++;
                await sleep(200);
              } catch (e) { /* ignore */ }
            }
          }
        }
      }
    }

    if (cleared > 0) {
      console.log(`🧹 clearAttachedImages: removed ${cleared} attached image(s)`);
      await sleep(300);
    }
    return cleared;
  }

  // Open the resource panel by clicking the "+" button near the prompt area
  // Returns: the button element or null
  async function openResourcePanel() {
    // Strategy 1: Find "+" / "add" button near the textarea
    const addButtons = document.querySelectorAll('button, [role="button"]');
    let addBtn = null;

    for (const btn of addButtons) {
      if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
      const icon = btn.querySelector('i.google-symbols');
      const iconText = icon ? (icon.textContent || '').trim() : '';
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();

      if (iconText === 'add' || iconText === 'add_circle' || iconText === 'add_circle_outline' ||
        ariaLabel.includes('adicionar') || ariaLabel.includes('add') ||
        ariaLabel.includes('recurso') || ariaLabel.includes('resource') ||
        title.includes('adicionar') || title.includes('add')) {
        // Must be near the prompt input (not a random add button)
        const textarea = document.querySelector('textarea, [contenteditable="true"]');
        if (textarea) {
          const textRect = textarea.getBoundingClientRect();
          const btnRect = btn.getBoundingClientRect();
          // Check proximity: within 200px vertically
          if (Math.abs(btnRect.top - textRect.top) < 200) {
            addBtn = btn;
            break;
          }
        } else {
          addBtn = btn;
          break;
        }
      }
    }

    if (!addBtn) {
      console.warn('🖼️ openResourcePanel: "+" button not found');
      return null;
    }

    console.log(`🖼️ Opening resource panel via "+" button...`);
    const rect = addBtn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    addBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    await sleep(30);
    addBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    await sleep(30);
    addBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    addBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    addBtn.click();

    await sleep(800); // Wait for popup animation
    return addBtn;
  }

  // Close the resource panel by pressing Escape or clicking outside
  async function closeResourcePanel() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true
    }));
    await sleep(400);
  }

  // Find images listed in the resource panel popup
  // Returns: Array<{ element, title, index }>
  function findResourceImages() {
    const results = [];

    // The resource panel shows a list of items with thumbnails + titles
    // Strategy 1: Search for items with images + text in overlay/dialog/popup containers
    const panels = document.querySelectorAll(
      '[role="dialog"], [role="listbox"], [role="menu"], [role="list"], ' +
      '[class*="popup"], [class*="overlay"], [class*="modal"], [class*="dropdown"], ' +
      '[class*="panel"], [class*="resource"], [class*="picker"], [class*="selector"]'
    );

    for (const panel of panels) {
      if (panel.closest('#veo3-panel, #veo3-bubble')) continue;
      if (panel.offsetParent === null && panel.style.display !== 'contents') continue;

      // Find items inside the panel
      const items = panel.querySelectorAll(
        '[role="option"], [role="listitem"], [role="menuitem"], ' +
        'li, [class*="item"], [class*="card"], [class*="row"]'
      );

      for (const item of items) {
        const img = item.querySelector('img');
        if (!img) continue;

        // Get the title text: aria-label, text content, alt, or title
        let title = item.getAttribute('aria-label') || '';
        if (!title) {
          // Get text content excluding deeply nested elements
          const textNodes = [];
          const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            const t = (n.textContent || '').trim();
            if (t.length > 2) textNodes.push(t);
          }
          title = textNodes.join(' ');
        }
        if (!title) {
          title = img.alt || img.title || img.getAttribute('aria-label') || '';
        }

        if (title.length > 0) {
          results.push({
            element: item,
            title: title.trim(),
            index: results.length + 1 // 1-based
          });
        }
      }

      if (results.length > 0) break; // Found items in this panel, stop
    }

    // Strategy 2: If no panel found, search for recently-appeared elements with images
    if (results.length === 0) {
      const allImgs = document.querySelectorAll('img');
      const seen = new Set();
      for (const img of allImgs) {
        if (img.closest('#veo3-panel, #veo3-bubble')) continue;
        const rect = img.getBoundingClientRect();
        // Resource panel images are small thumbnails (40-80px) in a vertical list
        if (rect.width >= 30 && rect.width <= 120 && rect.height >= 30 && rect.height <= 120) {
          const container = img.closest('li, [role="option"], [role="listitem"], [class*="item"]');
          if (!container || seen.has(container)) continue;
          seen.add(container);

          let title = container.textContent?.trim() || img.alt || img.title || '';
          if (title.length > 0) {
            results.push({
              element: container,
              title: title,
              index: results.length + 1
            });
          }
        }
      }
    }

    console.log(`🖼️ findResourceImages: found ${results.length} resource image(s):`, results.map(r => `[${r.index}] ${r.title.substring(0, 40)}`));
    return results;
  }

  // Select images by keyword/index from the resource panel
  // keywords: array of lowercase strings (e.g., ["macaw", "2"])
  async function selectImagesByKeywords(keywords) {
    if (state.imageSelectionInProgress) {
      return { success: false, count: 0, error: 'Seleção já em andamento' };
    }
    state.imageSelectionInProgress = true;

    try {
      // Step 1: Clear any previously attached images
      await clearAttachedImages();

      let totalSelected = 0;

      // We select one image at a time: open panel → find → click → panel closes → repeat
      for (const keyword of keywords) {
        console.log(`🖼️ Selecting image for keyword: "${keyword}"...`);

        // Open resource panel
        const panelBtn = await openResourcePanel();
        if (!panelBtn) {
          console.warn(`🖼️ Could not open resource panel for keyword "${keyword}"`);
          continue;
        }

        // Find available images
        const images = findResourceImages();
        if (images.length === 0) {
          console.warn('🖼️ No images found in resource panel');
          await closeResourcePanel();
          continue;
        }

        // Match by index (numeric keyword) or title (text keyword)
        let target = null;
        const isNumeric = /^\d+$/.test(keyword);

        if (isNumeric) {
          const idx = parseInt(keyword);
          target = images.find(img => img.index === idx);
          if (!target) {
            console.warn(`🖼️ Index ${idx} out of range (${images.length} images available)`);
          }
        } else {
          // Fuzzy text match: substring in title (case-insensitive)
          target = images.find(img => img.title.toLowerCase().includes(keyword));
          if (!target) {
            // Try matching start of each word
            target = images.find(img => {
              const words = img.title.toLowerCase().split(/\s+/);
              return words.some(w => w.startsWith(keyword) || keyword.startsWith(w));
            });
          }
          if (!target) {
            console.warn(`🖼️ No image matching keyword "${keyword}" in titles: ${images.map(i => i.title.substring(0, 30)).join(', ')}`);
          }
        }

        if (target) {
          // Click the matched item to include it
          console.log(`🖼️ Clicking resource image: [${target.index}] "${target.title.substring(0, 50)}"`);
          target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(200);

          const rect = target.element.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          target.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
          await sleep(30);
          target.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
          await sleep(30);
          target.element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
          target.element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
          target.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
          target.element.click();

          totalSelected++;
          console.log(`🖼️ ✅ Image "${target.title.substring(0, 30)}" selected!`);
          await sleep(CONFIG.IMAGE_SELECT_DELAY);
        }

        // Close panel (it may auto-close after selection, but ensure it)
        await closeResourcePanel();
        await sleep(300);
      }

      console.log(`🖼️ Image keyword selection complete: ${totalSelected}/${keywords.length} selected`);
      return { success: totalSelected > 0, count: totalSelected, error: null };
    } catch (err) {
      console.error(`❌ selectImagesByKeywords error: ${err.message}`);
      await closeResourcePanel();
      return { success: false, count: 0, error: err.message };
    } finally {
      state.imageSelectionInProgress = false;
    }
  }

  // ============================================================================
  // CORE AUTOMATION LOGIC
  // ============================================================================
  // Get ORIGINAL native setter via hidden iframe (bypasses any prototype patching)
  let _cachedTextareaSetter = null;
  function getOriginalNativeSetter() {
    if (_cachedTextareaSetter) return _cachedTextareaSetter;
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      _cachedTextareaSetter = Object.getOwnPropertyDescriptor(
        iframe.contentWindow.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      document.body.removeChild(iframe);
    } catch (e) {
      console.warn(`⚠️ iframe setter trick failed: ${e.message}`);
    }
    return _cachedTextareaSetter;
  }

  // ============================================================================
  // FETCH + XHR INTERCEPTOR — Fixes "Prompt must be provided" error
  // VEO3 React ignores DOM changes; we intercept ALL API calls and inject prompt
  // ============================================================================
  let _pendingPrompt = null;
  let _fetchInterceptorInstalled = false;

  function deepInjectPrompt(obj, prompt) {
    if (!obj || typeof obj !== 'object') return false;
    let injected = false;
    const promptKeys = ['prompt', 'text', 'input', 'query', 'message', 'content', 'userInput',
      'promptText', 'user_input', 'request_text', 'textInput'];
    for (const key of promptKeys) {
      if (key in obj && (obj[key] === '' || obj[key] === null || obj[key] === undefined ||
        (typeof obj[key] === 'string' && obj[key].trim().length === 0))) {
        obj[key] = prompt;
        injected = true;
        console.log(`🎯 Interceptor: injected prompt into "${key}"`);
      }
    }
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (deepInjectPrompt(obj[key], prompt)) injected = true;
      }
    }
    return injected;
  }

  function installFetchInterceptor() {
    if (_fetchInterceptorInstalled) return;
    _fetchInterceptorInstalled = true;

    // --- Intercept fetch() ---
    const originalFetch = window.fetch;
    window.fetch = async function (url, options) {
      if (_pendingPrompt && options?.method?.toUpperCase() === 'POST' && options.body) {
        const urlStr = typeof url === 'string' ? url : (url?.url || '');
        // Intercept ANY POST with JSON body from labs.google domain
        try {
          const bodyStr = typeof options.body === 'string'
            ? options.body
            : await new Response(options.body).text();
          if (bodyStr.startsWith('{') || bodyStr.startsWith('[')) {
            const body = JSON.parse(bodyStr);
            const modified = deepInjectPrompt(body, _pendingPrompt);
            if (modified) {
              options = { ...options, body: JSON.stringify(body) };
              console.log(`🎯 Fetch interceptor: prompt injected → ${urlStr.substring(0, 80)}`);
              _pendingPrompt = null;
            }
          }
        } catch (e) { /* not JSON, skip */ }
      }
      return originalFetch.call(this, url, options);
    };

    // --- Intercept XMLHttpRequest ---
    const origXHROpen = XMLHttpRequest.prototype.open;
    const origXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._veo3Method = method;
      this._veo3Url = url;
      return origXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (_pendingPrompt && this._veo3Method?.toUpperCase() === 'POST' && body) {
        try {
          const bodyStr = typeof body === 'string' ? body : null;
          if (bodyStr && (bodyStr.startsWith('{') || bodyStr.startsWith('['))) {
            const parsed = JSON.parse(bodyStr);
            const modified = deepInjectPrompt(parsed, _pendingPrompt);
            if (modified) {
              body = JSON.stringify(parsed);
              console.log(`🎯 XHR interceptor: prompt injected → ${(this._veo3Url || '').substring(0, 80)}`);
              _pendingPrompt = null;
            }
          }
        } catch (e) { /* not JSON, skip */ }
      }
      return origXHRSend.call(this, body);
    };

    console.log('🎯 Fetch + XHR interceptors installed — will inject prompts into ALL POST requests');
  }

  async function injectPrompt(prompt) {
    // =========================================================================
    // STEP 0: Install fetch interceptor & store prompt for API injection
    // This is the REAL fix — React ignores DOM changes, so we intercept fetch
    // =========================================================================
    installFetchInterceptor();
    _pendingPrompt = prompt;

    // =========================================================================
    // VEO3 uses a contenteditable DIV with role="textbox" — NOT a textarea!
    // The DOM manipulation below is COSMETIC (shows text to user)
    // The REAL prompt goes via fetch interceptor above
    // =========================================================================
    const veoInput = document.querySelector('div[contenteditable="true"][role="textbox"]')
      || document.querySelector('[contenteditable="true"][role="textbox"]')
      || querySelectorDeep('[contenteditable="true"][role="textbox"]');

    if (!veoInput) {
      throw new Error('VEO3 input (contenteditable div[role=textbox]) not found.');
    }

    // Log ALL React event handlers on this element
    const propsKey = Object.keys(veoInput).find(k => k.startsWith('__reactProps$'));
    const reactProps = propsKey ? veoInput[propsKey] : {};
    const handlers = Object.keys(reactProps).filter(k => k.startsWith('on'));
    console.log(`📝 VEO3 input: <${veoInput.tagName}> handlers=[${handlers.join(', ')}]`);
    console.log(`📝 VEO3 input innerHTML BEFORE: "${veoInput.innerHTML.substring(0, 80)}"`);
    console.log(`📝 VEO3 input children: ${veoInput.childNodes.length} nodes, firstChild type=${veoInput.firstChild?.nodeType} text="${(veoInput.firstChild?.textContent || '').substring(0, 30)}"`);

    // ─── STEP 1: Focus + Click to activate editing mode ───
    veoInput.focus();
    await sleep(150);
    const rect = veoInput.getBoundingClientRect();
    veoInput.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 10 }));
    await sleep(30);
    veoInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 10 }));
    await sleep(50);
    veoInput.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 10 }));
    veoInput.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 10 }));
    veoInput.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 10 }));
    veoInput.focus();
    await sleep(300); // Wait for placeholder to dismiss

    console.log(`📝 After focus/click innerHTML: "${veoInput.innerHTML.substring(0, 80)}"`);

    // Typing delay
    const typingTime = Math.max(300, Math.min(2000, prompt.length * CONFIG.TYPING_DELAY_PER_CHAR));
    await sleep(typingTime);

    // ─── STEP 2: Try execCommand('insertText') first (trusted events) ───
    // Select all existing content
    veoInput.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await sleep(50);

    const execResult = document.execCommand('insertText', false, prompt);
    await sleep(100);

    const afterExec = (veoInput.textContent || '').trim();
    console.log(`📝 execCommand result=${execResult}, textContent="${afterExec.substring(0, 50)}" (${afterExec.length} chars)`);

    // ─── STEP 3: If execCommand failed, set content directly ───
    if (!afterExec || afterExec.length < 5 || !afterExec.includes(prompt.substring(0, 10))) {
      console.log(`📝 execCommand failed, setting content directly...`);

      // Clear everything
      while (veoInput.firstChild) {
        veoInput.removeChild(veoInput.firstChild);
      }

      // Insert as text node
      const textNode = document.createTextNode(prompt);
      veoInput.appendChild(textNode);

      // Position cursor at end
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(veoInput);
      range.collapse(false); // collapse to end
      sel.removeAllRanges();
      sel.addRange(range);

      console.log(`📝 Direct set: textContent="${(veoInput.textContent || '').substring(0, 50)}" (${(veoInput.textContent || '').length} chars)`);
    }
    await sleep(50);

    // ─── STEP 4: Fire ALL possible events to notify React ───
    // beforeinput
    veoInput.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: prompt
    }));
    // input (this is what React typically listens to for contenteditable)
    veoInput.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: false, inputType: 'insertText', data: prompt
    }));
    // change
    veoInput.dispatchEvent(new Event('change', { bubbles: true }));
    // keyup (some frameworks check for this)
    veoInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    await sleep(100);

    // ─── STEP 5: Call React handlers directly with REAL DOM element ───
    if (propsKey) {
      const props = veoInput[propsKey];
      console.log(`📝 Calling React handlers...`);
      try {
        // Try EVERY handler that might be related
        for (const handlerName of handlers) {
          if (['onInput', 'onChange', 'onKeyUp', 'onKeyDown', 'onBeforeInput', 'onCompositionEnd'].includes(handlerName)) {
            try {
              props[handlerName]({ target: veoInput, currentTarget: veoInput, type: handlerName.substring(2).toLowerCase(), preventDefault: () => { }, stopPropagation: () => { }, nativeEvent: { inputType: 'insertText', data: prompt } });
              console.log(`  ✅ Called ${handlerName}`);
            } catch (e) {
              console.warn(`  ❌ ${handlerName}: ${e.message}`);
            }
          }
        }
      } catch (e) {
        console.warn(`  ⚠️ React handler calls failed: ${e.message}`);
      }
    }

    // ─── STEP 6: Walk fiber tree for parent handlers ───
    try {
      const fiberKey = Object.keys(veoInput).find(k => k.startsWith('__reactFiber$'));
      if (fiberKey) {
        let fiber = veoInput[fiberKey];
        for (let d = 0; d < 30 && fiber; d++) {
          const mp = fiber.memoizedProps;
          if (mp) {
            if (mp.onInput) { try { mp.onInput({ target: veoInput }); console.log(`  ✅ Fiber onInput d=${d}`); } catch (e) { } }
            if (mp.onChange) { try { mp.onChange({ target: veoInput }); console.log(`  ✅ Fiber onChange d=${d}`); } catch (e) { } }
          }
          fiber = fiber.return;
        }
      }
    } catch (e) { /* skip */ }

    console.log(`📝 FINAL textContent: "${(veoInput.textContent || '').substring(0, 50)}" (${(veoInput.textContent || '').length} chars)`);
    await sleep(200);
    updateStatus(`✍️ Prompt injetado: "${prompt.substring(0, 40)}..."`);
  }

  async function clickSendButton() {
    // NOTE: Strategy 0 (Enter key) was REMOVED — it triggered VEO3's empty-prompt
    // validation before the fetch interceptor could inject the prompt, causing
    // "Prompt must be provided" toasts. The fetch interceptor + button click works.

    // =========================================================================
    // STRATEGY 1: Find and click the send button with full event sequence
    // =========================================================================
    const sendBtn = findElement(SELECTORS.sendButton, 'send');
    if (!sendBtn) {
      console.warn('⚠️ Send button not found');
      updateStatus('⚠️ Botão de envio não encontrado');
      return;
    }
    if (sendBtn.offsetParent === null) {
      console.warn('⚠️ Send button not visible');
    }

    console.log(`🖱️ Strategy 1: Full click on send button (disabled=${sendBtn.disabled}, aria-disabled=${sendBtn.getAttribute('aria-disabled')})`);

    const rect = sendBtn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const eventOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };

    // Full pointer + mouse event sequence
    sendBtn.dispatchEvent(new PointerEvent('pointerdown', { ...eventOpts, pointerId: 1 }));
    await sleep(30);
    sendBtn.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    await sleep(60);
    sendBtn.dispatchEvent(new PointerEvent('pointerup', { ...eventOpts, pointerId: 1 }));
    await sleep(15);
    sendBtn.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    await sleep(15);
    sendBtn.dispatchEvent(new MouseEvent('click', eventOpts));
    await sleep(300);

    // Strategy 2: Native .click()
    sendBtn.click();
    await sleep(300);

    // Strategy 3: Try React onClick from props
    try {
      const propsKey = Object.keys(sendBtn).find(k => k.startsWith('__reactProps$'));
      if (propsKey && sendBtn[propsKey]?.onClick) {
        console.log('🖱️ Strategy 3: React onClick direct call...');
        sendBtn[propsKey].onClick({ preventDefault: () => { }, stopPropagation: () => { } });
      }
    } catch (e) {
      console.warn(`⚠️ React onClick failed: ${e.message}`);
    }

    // Strategy 4: Find and submit the parent form
    const form = sendBtn.closest('form');
    if (form) {
      console.log('🖱️ Strategy 4: Form submit...');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

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
            // New video appeared! VEO3 prepends newest at top → index 0 is the new one
            state.lastVideoElement = currentVideos[0];
            state.lastVideoElement.setAttribute('data-veo3-batch-target', 'true');
            console.log(`✅ NEW video detected at [0] (${currentVideos.length} total, was ${state.videoCountBeforeGen})`);
            clearInterval(interval);
            resolve();
            return;
          }

          // Strategy 4: Download button appeared [H2 lightweight check]
          if (hasDownloadButton()) {
            console.log('✅ Download button appeared');
            // Newest video is at index 0 (VEO3 prepends)
            const allVideos = document.querySelectorAll('video');
            if (allVideos.length > 0) {
              state.lastVideoElement = allVideos[0];
              state.lastVideoElement.setAttribute('data-veo3-batch-target', 'true');
              console.log(`📌 Marked newest video [0] as target (${allVideos.length} total)`);
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
        state.lastDownloadComplete = false;
        updateStatus(`⚠️ Aberto em nova aba (verifique): ${filename}`);
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

    window.open = function (url, target, features) {
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
        // VEO3 prepends newest at top → index 0 is the most recent
        targetVideo = allVideos[0];
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
  // PAGE VIDEO SCAN & DOWNLOAD (independent of batch flow)
  // ============================================================================

  function scanPageVideos() {
    const videos = document.querySelectorAll('video');
    updateStatus('────────────────────');
    updateStatus(`🔍 Escaneando página...`);

    if (videos.length === 0) {
      updateStatus('⚠️ Nenhum <video> encontrado na página.');
      return;
    }

    updateStatus(`📹 ${videos.length} vídeo(s) encontrado(s):`);

    videos.forEach((video, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      const src = video.src || '';
      const currentSrc = video.currentSrc || '';
      const url = currentSrc || src;
      const w = video.videoWidth || video.width || 0;
      const h = video.videoHeight || video.height || 0;
      const dur = isNaN(video.duration) ? '?' : video.duration.toFixed(1);

      let srcType = 'sem src';
      if (url.startsWith('blob:')) srcType = 'blob';
      else if (url.startsWith('http')) srcType = 'HTTP';

      const dims = (w && h) ? `${w}x${h}` : '?';
      updateStatus(`  [${num}] ${srcType} | ${dims} | ${dur}s`);
      if (url) {
        console.log(`  [${num}] URL: ${url.substring(0, 120)}`);
      }
    });

    updateStatus('────────────────────');

    // Update video count badge in panel
    const countBadge = document.getElementById('veo3-video-count-badge');
    if (countBadge) {
      countBadge.textContent = `📹 ${videos.length} vídeo(s)`;
      countBadge.style.color = 'white';
      countBadge.style.background = 'rgba(0, 188, 212, 0.3)';
    }

    // Update bubble badge with video count
    const badge = document.getElementById('veo3-badge');
    if (badge && !state.isRunning) {
      badge.style.display = 'flex';
      badge.textContent = `📹${videos.length}`;
      badge.style.background = '#00BCD4';
    }
  }

  // Find download button nearest to a given video element (does NOT touch batch state)
  function findDownloadButtonNear(videoEl) {
    const rect = videoEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Search inside video's container first
    const container = videoEl.closest('div[class*="video"], div[class*="player"], div[class*="preview"], [role="main"]') || videoEl.parentElement;
    const iconsInContainer = container?.querySelectorAll('i.google-symbols') || [];
    for (const icon of iconsInContainer) {
      const iconText = (icon.textContent || '').trim().toLowerCase();
      if (iconText === 'download' || iconText === 'file_download' || iconText === 'save_alt') {
        const btn = icon.closest('button') || icon.closest('a') || icon.closest('[role="button"]');
        if (btn && btn.offsetParent !== null) return btn;
      }
    }

    // Global search — pick closest to video center
    const allIcons = document.querySelectorAll('i.google-symbols');
    let closestBtn = null;
    let closestDist = Infinity;
    for (const icon of allIcons) {
      const iconText = (icon.textContent || '').trim().toLowerCase();
      if (iconText === 'download' || iconText === 'file_download' || iconText === 'save_alt') {
        const btn = icon.closest('button') || icon.closest('a') || icon.closest('[role="button"]');
        if (btn && btn.offsetParent !== null) {
          const bRect = btn.getBoundingClientRect();
          const dist = Math.hypot(bRect.left - cx, bRect.top - cy);
          if (dist < closestDist) {
            closestDist = dist;
            closestBtn = btn;
          }
        }
      }
    }
    return closestBtn;
  }

  // Hover over a video element to reveal VEO3's native controls
  async function hoverOverVideo(videoEl) {
    const rect = videoEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Mouse events on the video itself
    videoEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
    videoEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
    videoEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
    await sleep(400);

    // Hover on parent containers (VEO3 may listen on wrapper)
    let parent = videoEl.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
      parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
      parent.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
      parent = parent.parentElement;
    }
    await sleep(400);

    // Pointer events (some frameworks listen to pointer, not mouse)
    videoEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: cx, clientY: cy }));
    videoEl.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }));
    videoEl.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: cx, clientY: cy }));
    await sleep(400);
  }

  // Save a blob directly to a folder using File System Access API
  async function saveToFolder(dirHandle, filename, blob) {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  // Fetch video data as a Blob from any URL type
  async function fetchVideoBlob(url) {
    if (!url) return null;
    if (url.startsWith('http') || url.startsWith('blob:')) {
      try {
        const response = await fetch(url);
        return await response.blob();
      } catch (err) {
        console.warn(`⚠️ fetchVideoBlob failed: ${err.message}`);
        return null;
      }
    }
    return null;
  }

  async function downloadPageVideos() {
    const dlPageBtn = document.getElementById('veo3-dl-page-btn');
    const videos = document.querySelectorAll('video');

    // Get folder name
    const folderInput = document.getElementById('veo3-folder-name');
    const rawFolderName = (folderInput?.value || '').trim();
    // Sanitize: remove chars that are invalid in filenames
    const folderName = rawFolderName.replace(/[<>:"/\\|?*]/g, '').trim();

    updateStatus('────────────────────');

    if (videos.length === 0) {
      updateStatus('⚠️ Nenhum <video> encontrado na página.');
      return;
    }

    // Disable button during download
    if (dlPageBtn) {
      dlPageBtn.disabled = true;
      dlPageBtn.style.opacity = '0.5';
    }

    // ── Try File System Access API for real folder creation ──
    let dirHandle = null;
    if (folderName && window.showDirectoryPicker) {
      try {
        updateStatus(`📂 Selecione onde criar a pasta "${folderName}"...`);
        const parentDir = await window.showDirectoryPicker({ mode: 'readwrite' });
        dirHandle = await parentDir.getDirectoryHandle(folderName, { create: true });
        updateStatus(`📂 Pasta "${folderName}" criada! Baixando ${videos.length} vídeos...`);
      } catch (err) {
        if (err.name === 'AbortError') {
          updateStatus('⚠️ Seleção de pasta cancelada.');
          if (dlPageBtn) { dlPageBtn.disabled = false; dlPageBtn.style.opacity = '1'; }
          return;
        }
        console.warn(`⚠️ File System API failed: ${err.message}. Falling back to prefix.`);
        dirHandle = null;
      }
    }

    // Fallback: use folder name as prefix
    const useFolder = !!dirHandle;
    const filePrefix = (!useFolder && folderName) ? `${folderName}-` : (!useFolder ? 'veo3-page-' : '');

    if (!useFolder) {
      if (folderName) {
        updateStatus(`📥 Baixando vídeos → prefixo "${folderName}-"...`);
      } else {
        updateStatus(`📥 Baixando vídeos da página...`);
      }
    }

    let downloaded = 0;
    let failed = 0;

    // VEO3 shows newest videos first in DOM — reverse to download in prompt order
    const videoArray = Array.from(videos).reverse();

    for (let i = 0; i < videoArray.length; i++) {
      const video = videoArray[i];
      const num = String(i + 1).padStart(3, '0');
      const filename = useFolder ? `${num}.mp4` : `${filePrefix}${num}.mp4`;
      const url = video.currentSrc || video.src || '';
      let success = false;

      try {
        // ── Strategy 0: Save directly to folder (File System API) ──
        if (useFolder && (url.startsWith('http') || url.startsWith('blob:'))) {
          updateStatus(`  [${num}] 📂 Salvando na pasta...`);
          const blob = await fetchVideoBlob(url);
          if (blob && blob.size > 0) {
            await saveToFolder(dirHandle, filename, blob);
            updateStatus(`  [${num}] ✅ ${folderName}/${filename}`);
            success = true;
          }
        }

        // ── Strategy 1: Direct URL download (HTTP) ──
        if (!success && url.startsWith('http')) {
          updateStatus(`  [${num}] ⬇️ Download direto (HTTP)...`);
          if (useFolder) {
            // Try fetching for folder save
            const blob = await fetchVideoBlob(url);
            if (blob && blob.size > 0) {
              await saveToFolder(dirHandle, filename, blob);
              updateStatus(`  [${num}] ✅ ${useFolder ? folderName + '/' : ''}${filename}`);
              success = true;
            }
          }
          if (!success) {
            state.lastDownloadComplete = false;
            await triggerNativeDownload(url, filename);
            if (state.lastDownloadComplete) success = true;
          }
        }

        // ── Strategy 2: Blob URL download ──
        if (!success && url.startsWith('blob:')) {
          updateStatus(`  [${num}] ⬇️ Download blob...`);
          try {
            const blob = await fetchVideoBlob(url);
            if (blob) {
              if (useFolder) {
                await saveToFolder(dirHandle, filename, blob);
                updateStatus(`  [${num}] ✅ ${folderName}/${filename}`);
                success = true;
              } else {
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 1000);
                updateStatus(`  [${num}] ✅ ${filename}`);
                success = true;
              }
            }
          } catch (err) {
            console.warn(`  [${num}] Blob fetch failed: ${err.message}`);
          }
        }

        // ── Strategy 3: Hover + native VEO3 download button ──
        if (!success) {
          updateStatus(`  [${num}] 🖱️ Hover + botão nativo...`);
          video.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(500);

          // Try hovering and finding button up to 4 attempts
          let downloadBtn = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            await hoverOverVideo(video);
            downloadBtn = findDownloadButtonNear(video);
            if (downloadBtn) break;
            await sleep(800);
          }

          if (downloadBtn) {
            // Install interceptor to catch window.open with video URL
            const restoreWindowOpen = installWindowOpenInterceptor(filename);
            state.lastDownloadComplete = false;

            // Human-like click
            downloadBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            await sleep(50 + Math.random() * 80);
            downloadBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            await sleep(40 + Math.random() * 60);
            downloadBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
            await sleep(20 + Math.random() * 40);
            downloadBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            await sleep(10 + Math.random() * 30);
            downloadBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await sleep(1500);

            // Check quality menu
            const qualityTexts = ['Tamanho original', 'Original size', 'Original quality', '720p', '1080p', 'MP4'];
            let qualityOption = null;
            for (const text of qualityTexts) {
              qualityOption = findQualityOption(text);
              if (qualityOption) break;
            }

            if (qualityOption) {
              const anchor = qualityOption.tagName === 'A' ? qualityOption : qualityOption.closest('a');
              const href = anchor?.href;
              if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
                restoreWindowOpen();
                if (useFolder) {
                  const blob = await fetchVideoBlob(href);
                  if (blob && blob.size > 0) {
                    await saveToFolder(dirHandle, filename, blob);
                    success = true;
                  }
                }
                if (!success) {
                  await triggerNativeDownload(href, filename);
                  success = state.lastDownloadComplete;
                }
              } else {
                qualityOption.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                await sleep(2000);
                restoreWindowOpen();
                success = state.lastDownloadComplete;
              }
            } else {
              // No quality menu — direct click may have triggered download
              await sleep(1500);
              restoreWindowOpen();
              success = state.lastDownloadComplete;

              // Check if video src appeared after clicking
              if (!success) {
                const freshSrc = video.src || video.currentSrc || '';
                if (freshSrc && freshSrc.startsWith('http')) {
                  if (useFolder) {
                    const blob = await fetchVideoBlob(freshSrc);
                    if (blob && blob.size > 0) {
                      await saveToFolder(dirHandle, filename, blob);
                      success = true;
                    }
                  }
                  if (!success) {
                    await triggerNativeDownload(freshSrc, filename);
                    success = state.lastDownloadComplete;
                  }
                }
              }
            }

            if (success) {
              updateStatus(`  [${num}] ✅ ${useFolder ? folderName + '/' : ''}${filename}`);
            } else {
              updateStatus(`  [${num}] ⚠️ Download não confirmado`);
            }
          } else {
            updateStatus(`  [${num}] ❌ Botão de download não encontrado`);
          }
        }

        if (success) {
          downloaded++;
        } else {
          failed++;
        }

        // Delay between downloads
        if (i < videos.length - 1) {
          await sleep(1200);
        }
      } catch (err) {
        updateStatus(`  [${num}] ❌ Erro: ${err.message}`);
        failed++;
      }
    }

    updateStatus('────────────────────');
    updateStatus(`📥 Resultado: ${downloaded} baixados | ${failed} falharam`);
    if (downloaded > 0) {
      if (useFolder) {
        updateStatus(`📂 Arquivos em: ${folderName}/001.mp4, 002.mp4, etc`);
      } else {
        updateStatus(`📂 Arquivos: ${filePrefix}001.mp4, etc`);
      }
    }

    // Re-enable button
    if (dlPageBtn) {
      dlPageBtn.disabled = false;
      dlPageBtn.style.opacity = '1';
    }
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
          // Smart queue: count active generations (progress bars / spinners)
          await waitForQueueSlot();
          const activeGens = countActiveGenerations();
          if (activeGens >= CONFIG.QUEUE_BATCH_SIZE) {
            updateStatus(`⏳ ${activeGens} gerações ativas — aguardando conclusão...`);
            await waitForActiveGenerations(CONFIG.QUEUE_BATCH_SIZE - 1);
            updateStatus(`✅ Vaga liberada, continuando...`);
            await sleep(1500);
          }

          // Parse [CHARS: Name1, Name2] and [IMGS: keyword1, 2] directives from prompt
          const { cleanPrompt, characters, imageKeywords } = parseCharsFromPrompt(prompt);

          if (characters.length > 0) {
            // Selective: only include named character images (auto-detected by @Name:)
            try {
              updateStatus(`[${paddedNum}] 🎭 Selecionando personagens: ${characters.join(', ')}...`);
              const charResult = await selectCharacterImages(characters);
              if (charResult.success) {
                updateStatus(`[${paddedNum}] ✅ ${charResult.count} personagem(ns) incluído(s)`);
              } else {
                updateStatus(`[${paddedNum}] ⚠️ ${charResult.error || 'Seleção parcial'}`);
              }
              await microDelay();
            } catch (charErr) {
              // Character selection is best-effort — never block prompt send
              console.warn(`⚠️ Character selection failed: ${charErr.message}. Continuing with prompt send.`);
              updateStatus(`[${paddedNum}] ⚠️ Seleção de personagens falhou, continuando...`);
            }
          }

          if (imageKeywords.length > 0) {
            // [IMGS: ...] — select images by keyword/index via resource panel
            try {
              updateStatus(`[${paddedNum}] 🖼️ Selecionando imagens [IMGS: ${imageKeywords.join(', ')}]...`);
              const imgResult = await selectImagesByKeywords(imageKeywords);
              if (imgResult.success) {
                updateStatus(`[${paddedNum}] ✅ ${imgResult.count} imagem(ns) incluída(s) por keyword`);
              } else {
                updateStatus(`[${paddedNum}] ⚠️ ${imgResult.error || 'Seleção de imagens parcial'}`);
              }
              await microDelay();
            } catch (imgErr) {
              // Image keyword selection is best-effort — never block prompt send
              console.warn(`⚠️ Image keyword selection failed: ${imgErr.message}. Continuing with prompt send.`);
              updateStatus(`[${paddedNum}] ⚠️ Seleção de imagens por keyword falhou, continuando...`);
            }
          } else if (characters.length === 0 && state.includeImagesEnabled) {
            // Legacy: include ALL images (existing behavior unchanged)
            updateStatus(`[${paddedNum}] 🖼️ Selecionando imagens de referência...`);
            const imageResult = await selectAllImages();
            if (!imageResult.success) {
              updateStatus(`[${paddedNum}] ⚠️ Imagens não selecionadas: ${imageResult.error || 'desconhecido'}`);
            } else {
              updateStatus(`[${paddedNum}] ✅ ${imageResult.count} imagem(ns) incluída(s)`);
            }
            await microDelay();
          }

          await injectPrompt(cleanPrompt);
          await microDelay(); // Natural pause after typing

          await clickSendButton();
          await microDelay(); // Natural pause after clicking send

          updateStatus(`[${paddedNum}] Aguardando geração...`);
          await waitForProgressCompletion();

          // Track the generated video for Phase 2 download
          const videoEl = state.lastVideoElement;
          let videoUrl = videoEl ? (videoEl.src || videoEl.currentSrc || '') : '';
          if (videoEl) {
            videoEl.setAttribute('data-veo3-batch-index', String(i + 1));
          }
          // Pre-fetch blob URLs to preserve video data before React re-renders
          if (videoUrl && videoUrl.startsWith('blob:')) {
            try {
              const response = await fetch(videoUrl);
              const blob = await response.blob();
              videoUrl = URL.createObjectURL(blob);
              console.log(`📎 Blob preservado: vídeo ${i + 1} (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);
            } catch (e) {
              console.warn(`⚠️ Blob não preservado vídeo ${i + 1}: ${e.message}`);
            }
          }
          state.completedVideos.push({
            index: i + 1,
            prompt: prompt.substring(0, 60),
            videoElement: videoEl,
            videoUrl: videoUrl
          });
          if (videoUrl) {
            console.log(`📎 URL capturada para vídeo ${i + 1}: ${videoUrl.substring(0, 80)}`);
          }
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
          const filename = `veo3-batch-${paddedNum}.mp4`;
          let directDownloaded = false;

          // =====================================================================
          // STRATEGY A: Direct URL download (most reliable — no DOM needed)
          // =====================================================================
          if (entry.videoUrl && entry.videoUrl.length > 0) {
            updateStatus(`[${paddedNum}] ⬇️ Download direto via URL...`);
            try {
              state.lastDownloadComplete = false;
              await triggerNativeDownload(entry.videoUrl, filename);
              if (state.lastDownloadComplete) {
                directDownloaded = true;
                console.log(`📥 [DL] ✅ URL download succeeded for ${paddedNum}`);
              }
            } catch (err) {
              console.warn(`📥 [DL] URL download failed for ${paddedNum}: ${err.message}`);
            }
          }

          // =====================================================================
          // STRATEGY B: Element-based download (fallback if URL unavailable/expired)
          // =====================================================================
          if (!directDownloaded) {
            let targetVideo = entry.videoElement;

            // Fallback: find by data attribute
            if (!targetVideo || !targetVideo.isConnected) {
              targetVideo = document.querySelector(`video[data-veo3-batch-index="${entry.index}"]`);
            }

            // Fallback: find by position (VEO3 shows newest first → reverse order)
            if (!targetVideo) {
              const allVideos = Array.from(document.querySelectorAll('video'));
              const totalVideos = allVideos.length;
              // VEO3 DOM order: [newest, ..., oldest] → reverse to [oldest, ..., newest]
              const reversed = allVideos.slice().reverse();
              if (reversed.length >= entry.index) {
                targetVideo = reversed[entry.index - 1];
                console.log(`📥 Video ${entry.index}: reversed position ${entry.index - 1} of ${totalVideos}`);
              }
            }

            // Fallback: scroll page to load video into DOM
            if (!targetVideo) {
              targetVideo = await scrollToLoadVideo(entry.index);
            }

            if (!targetVideo) {
              throw new Error('Vídeo não encontrado na página (mesmo após scroll)');
            }

            // Set as current target for clickDownloadButton
            state.lastVideoElement = targetVideo;
            state.videoCountBeforeGen = document.querySelectorAll('video').length;

            await clickDownloadButton();
          }

          await sleep(1000);
          const downloadConfirmed = directDownloaded || (await waitForDownloadCompletion());

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
    console.log('🔍 VEO3 Batch Automator v1.3.0 — Diagnostics');
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

    // Character Consistency diagnostics
    console.log(`  Include images: ${state.includeImagesEnabled ? 'ENABLED ✅' : 'disabled'}`);
    const imagesTab = findTabByText('Imagens') || findTabByText('Images');
    console.log(`  Images tab: ${imagesTab ? 'found ✅' : 'not found'}`);
    const videosTab = findTabByText('Vídeos') || findTabByText('Videos');
    console.log(`  Videos tab: ${videosTab ? 'found ✅' : 'not found'}`);
    if (state.detectedImageCount > 0) {
      console.log(`  Detected images: ${state.detectedImageCount}`);
    }
    console.log('='.repeat(50));
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  function init() {
    console.log('🎬 VEO3 Batch Automator v1.3.0');
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
