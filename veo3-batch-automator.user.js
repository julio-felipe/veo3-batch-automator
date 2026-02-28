// ==UserScript==
// @name         Veo3 Prompt Batch Automator
// @namespace    https://synkra.io/
// @version      1.7.2
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
        <span style="font-weight: 600; font-size: 14px;">VEO3 Batch Automator <span style="font-size:10px;opacity:0.6">v1.7.0</span></span>
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
          &#128161; <code style="background: rgba(0,0,0,0.2); padding: 1px 4px; border-radius: 2px;">[CHARS: Bao]</code> personagens @Nome &#8226; <code style="background: rgba(0,0,0,0.2); padding: 1px 4px; border-radius: 2px;">[IMGS: Bao, Monk]</code> imagens @Nome via &#8942;
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
        <div style="margin-bottom: 8px;">
          <button id="veo3-dl-images-btn" style="
            width: 100%; padding: 10px; background: #AB47BC; color: white; border: none;
            border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;
            transition: background 0.2s;
          ">&#128444; Baixar imagens da página</button>
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
    const dlImagesBtn = document.getElementById('veo3-dl-images-btn');
    const scanPageBtn = document.getElementById('veo3-scan-page-btn');

    startBtn.addEventListener('mouseenter', () => { startBtn.style.background = '#45a049'; });
    startBtn.addEventListener('mouseleave', () => { startBtn.style.background = '#4CAF50'; });
    downloadAllBtn.addEventListener('mouseenter', () => { if (!downloadAllBtn.disabled) downloadAllBtn.style.background = '#1976D2'; });
    downloadAllBtn.addEventListener('mouseleave', () => { if (!downloadAllBtn.disabled) downloadAllBtn.style.background = '#2196F3'; });
    dlPageBtn.addEventListener('mouseenter', () => { if (!dlPageBtn.disabled) dlPageBtn.style.background = '#0097A7'; });
    dlPageBtn.addEventListener('mouseleave', () => { if (!dlPageBtn.disabled) dlPageBtn.style.background = '#00BCD4'; });
    dlImagesBtn.addEventListener('mouseenter', () => { if (!dlImagesBtn.disabled) dlImagesBtn.style.background = '#8E24AA'; });
    dlImagesBtn.addEventListener('mouseleave', () => { if (!dlImagesBtn.disabled) dlImagesBtn.style.background = '#AB47BC'; });
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
    dlImagesBtn.addEventListener('click', downloadPageImages);
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

    // Helper: walk up from a text node to find the generation row container
    function findRowContainer(startEl) {
      let current = startEl;
      for (let depth = 0; depth < 15 && current; depth++) {
        const rect = current.getBoundingClientRect();
        if (rect.width > 2500 || rect.height > 1000) break;

        const hasImg = current.querySelector('img') || current.querySelector('[role="img"]');
        const hasBg = current.style.backgroundImage && current.style.backgroundImage !== 'none';
        const isCardSized = rect.width >= 80 && rect.height >= 80;

        if ((hasImg || hasBg) && isCardSized) return current;
        if (current.matches('[role="listitem"], [role="option"], [class*="card"], [class*="item"]') && isCardSized) return current;

        current = current.parentElement;
      }

      // Last resort: find any ancestor with an image
      let ancestor = startEl.parentElement;
      for (let i = 0; i < 20 && ancestor; i++) {
        const aRect = ancestor.getBoundingClientRect();
        if (aRect.width > 2500 || aRect.height > 1000) break;
        if (ancestor.querySelector('img') && aRect.height >= 80) return ancestor;
        ancestor = ancestor.parentElement;
      }

      return startEl.closest('[class*="card"], [class*="item"], [class*="asset"]') || startEl;
    }

    // Helper: register a name→card mapping, preferring cards WITH images
    function registerCard(name, card, source) {
      const existing = nameToCard.get(name);
      const existingHasImg = existing ? !!existing.querySelector('img') : false;
      const newHasImg = !!card.querySelector('img');

      if (!existing || (!existingHasImg && newHasImg)) {
        nameToCard.set(name, card);
        const cRect = card.getBoundingClientRect();
        console.log(`🎭 ${existing ? 'Upgraded' : 'Found'} character card (${source}): @${name} → ${card.tagName}.${(card.className || '').toString().substring(0, 40)} ${Math.round(cRect.width)}x${Math.round(cRect.height)} img=${newHasImg}`);
      }
    }

    // Strategy 1: Walk all text nodes looking for @Name pattern
    const walker1 = document.createTreeWalker(
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

    const atNamePattern = /@(\w[\w-]*)\s*:?/g;
    let textNode;
    while ((textNode = walker1.nextNode())) {
      const text = textNode.textContent;
      let match;
      atNamePattern.lastIndex = 0;
      while ((match = atNamePattern.exec(text))) {
        const name = match[1].trim().toLowerCase();
        if (name.length === 0 || name.length > 30) continue;
        const card = findRowContainer(textNode.parentElement);
        registerCard(name, card, '@pattern');
      }
    }

    // Strategy 2: Walk text nodes for Name_With_Underscore: [description] pattern
    // VEO3 right panel shows character definitions as "King_Raja: [50-year-old..."
    // without the @ prefix
    const walker2 = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = node.textContent || '';
          if (!text.includes('_') || !text.includes(':')) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || isOurs(parent)) return NodeFilter.FILTER_REJECT;
          // Skip the prompt input area (textbox) — only search result descriptions
          if (parent.closest('[role="textbox"], [contenteditable="true"], textarea')) return NodeFilter.FILTER_REJECT;
          if (parent.offsetParent === null && parent.style.display !== 'contents') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    // Match patterns like "King_Raja:" or "Monk_Ananda: [65-year-old..."
    const nameDefPattern = /\b(\w+(?:_\w+)+)\s*:/g;
    while ((textNode = walker2.nextNode())) {
      const text = textNode.textContent;
      let match;
      nameDefPattern.lastIndex = 0;
      while ((match = nameDefPattern.exec(text))) {
        const name = match[1].trim().toLowerCase();
        if (name.length < 3 || name.length > 30) continue;
        // Skip common non-name patterns
        if (['data_de', 'nano_banana', 'text_prompt'].includes(name)) continue;
        const card = findRowContainer(textNode.parentElement);
        registerCard(name, card, 'name:def');
      }
    }

    // Strategy 3: Also check aria-label and title attributes on images
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
          registerCard(name, card, 'img-attr');
        }
      }
    }

    // Filter out entries that came from the prompt input (no image, small size)
    for (const [name, card] of nameToCard) {
      const hasImg = !!card.querySelector('img');
      const rect = card.getBoundingClientRect();
      if (!hasImg && rect.width < 200) {
        nameToCard.delete(name);
        console.log(`🎭 Removed @${name}: no image, small card (${Math.round(rect.width)}x${Math.round(rect.height)})`);
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

  // Find "add" button (icon="add") in the right panel near a card
  // VEO3 places an "add" button inside each character/image section
  // in the right panel to include it in the prompt.
  function findAddButtonNearCard(cardEl) {
    const cardRect = cardEl.getBoundingClientRect();
    // The "add" button is in the right panel (x > 1800) at y within the card's vertical range
    const allBtns = document.querySelectorAll('button, [role="button"]');
    let bestBtn = null;
    let bestDist = Infinity;

    for (const btn of allBtns) {
      if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
      const icon = btn.querySelector('i.google-symbols, .google-symbols, i.material-icons');
      const iconText = icon ? (icon.textContent || '').trim() : '';
      if (iconText !== 'add') continue;
      // Also skip header-level "add" buttons (like "Adicionar mídia")
      const btnText = (btn.textContent || '').toLowerCase();
      if (btnText.includes('adicionar') || btnText.includes('mídia')) continue;

      const bRect = btn.getBoundingClientRect();
      if (bRect.width === 0 || bRect.height === 0) continue;

      // Check vertical overlap: button y should be within the card's y range (with margin)
      const vertOverlap = bRect.top >= cardRect.top - 50 && bRect.bottom <= cardRect.bottom + 50;
      // Check if button is in the right panel area (large cards span full width, right panel > 1800)
      const inRightPanel = bRect.left > 1700;
      // Also try: button just below the card (for right-panel sections)
      const justBelow = bRect.top >= cardRect.bottom - 30 && bRect.top <= cardRect.bottom + 100 && bRect.left > cardRect.left;

      if (vertOverlap || (inRightPanel && justBelow)) {
        const dist = Math.abs(bRect.top - cardRect.top) + Math.abs(bRect.left - cardRect.left) / 10;
        if (dist < bestDist) {
          bestDist = dist;
          bestBtn = btn;
        }
      }
    }

    if (bestBtn) {
      const r = bestBtn.getBoundingClientRect();
      console.log(`🎭 findAddButtonNearCard: found at (${Math.round(r.left)},${Math.round(r.top)}) dist=${Math.round(bestDist)}`);
    }
    return bestBtn;
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
    info.push(`Script: v1.7.0`);

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

        // Check for @Name in character cards — test the ACTUAL ⋮ → Incluir flow
        if (cardMap.size > 0) {
          info.push('\n── [PROFUNDO] HOVER + ⋮ → INCLUIR TEST ──');
          // Only test the first card to avoid side-effects
          const testEntries = [...cardMap.entries()].slice(0, 1);
          for (const [name, card] of testEntries) {
            info.push(`  @${name}: hovering card...`);
            try {
              // Step 0: Scroll into view first (cards may be off-screen)
              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await sleep(600);

              // Step 1: Hover to reveal ⋮ button
              const hoverTarget = card.querySelector('a, img, [role="img"]') || card;
              // Re-get rect AFTER scroll
              const hRect = hoverTarget.getBoundingClientRect();
              const hx = hRect.left + hRect.width / 2;
              const hy = hRect.top + hRect.height / 2;

              hoverTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: hx, clientY: hy }));
              hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: hx, clientY: hy }));
              hoverTarget.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: hx, clientY: hy }));
              hoverTarget.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: hx, clientY: hy }));
              hoverTarget.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hx, clientY: hy }));
              let hp = hoverTarget.parentElement;
              for (let hi = 0; hi < 4 && hp && hp !== card.parentElement; hi++) {
                hp.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: hx, clientY: hy }));
                hp.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: hx, clientY: hy }));
                hp = hp.parentElement;
              }
              await sleep(600);

              // Step 2: Find more_vert button — search GLOBALLY, filter by POSITION on image
              // The ⋮ overlay may be a React portal (outside card DOM tree)
              const imgCard = card.querySelector('a[class]') || card.querySelector('a') || card;
              const imgR = imgCard.getBoundingClientRect();
              info.push(`    📍 Image <${imgCard.tagName}> at (${Math.round(imgR.left)},${Math.round(imgR.top)}) ${Math.round(imgR.width)}x${Math.round(imgR.height)}`);

              let moreBtn = null;
              const allPageBtns2 = document.querySelectorAll('button, [role="button"]');
              for (const btn of allPageBtns2) {
                if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
                const icon = btn.querySelector('i.google-symbols, .google-symbols');
                const iconText = icon ? (icon.textContent || '').trim() : '';
                if (iconText !== 'more_vert' && iconText !== 'more_horiz') continue;
                const bRect = btn.getBoundingClientRect();
                if (bRect.width === 0 || bRect.height === 0) continue;
                // Must be positioned WITHIN image bounds
                const inBounds = bRect.left >= imgR.left - 30 && bRect.right <= imgR.right + 30 &&
                  bRect.top >= imgR.top - 30 && bRect.bottom <= imgR.bottom + 30;
                if (inBounds) {
                  moreBtn = btn;
                  info.push(`    🟢 Botão ⋮ at (${Math.round(bRect.left)},${Math.round(bRect.top)}) WITHIN image bounds`);
                  break;
                }
              }

              // Fallback: search inside card DOM only
              if (!moreBtn) {
                const cardBtns = card.querySelectorAll('button, [role="button"]');
                for (const btn of cardBtns) {
                  if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
                  const icon = btn.querySelector('i.google-symbols');
                  const iconText = icon ? (icon.textContent || '').trim() : '';
                  if (iconText === 'more_vert') {
                    const bRect = btn.getBoundingClientRect();
                    if (bRect.top > 50) { moreBtn = btn; break; } // skip header
                  }
                }
              }

              if (!moreBtn) {
                info.push(`    🔴 Botão ⋮ (more_vert) NÃO encontrado no card`);
                // List all buttons for debugging
                const allBtns = card.querySelectorAll('button, [role="button"]');
                info.push(`    Botões disponíveis: ${allBtns.length}`);
                allBtns.forEach((b, bi) => {
                  info.push(`      [${bi}] <${b.tagName}> text="${(b.textContent || '').trim().substring(0, 40)}" visible=${b.offsetParent !== null}`);
                });
              } else {
                info.push(`    🟢 Botão ⋮ encontrado: visible=${moreBtn.offsetParent !== null}`);
                info.push(`    🔬 React props: ${inspectReactProps(moreBtn)}`);

                // Step 3: Click ⋮ using triggerReactClick (PRIMARY)
                const origDisplay = moreBtn.style.display;
                const origVisibility = moreBtn.style.visibility;
                const origOpacity = moreBtn.style.opacity;
                moreBtn.style.setProperty('display', 'inline-flex', 'important');
                moreBtn.style.setProperty('visibility', 'visible', 'important');
                moreBtn.style.setProperty('opacity', '1', 'important');

                // Force-show ancestors
                const hiddenAncs = [];
                let anc = moreBtn.parentElement;
                for (let ai = 0; ai < 5 && anc && anc !== card; ai++) {
                  if (anc.offsetParent === null || getComputedStyle(anc).opacity === '0') {
                    hiddenAncs.push({ el: anc, d: anc.style.display, v: anc.style.visibility, o: anc.style.opacity });
                    anc.style.setProperty('display', 'flex', 'important');
                    anc.style.setProperty('visibility', 'visible', 'important');
                    anc.style.setProperty('opacity', '1', 'important');
                  }
                  anc = anc.parentElement;
                }
                await sleep(100);

                // Step 3a: Check elementFromPoint (detect overlapping elements)
                const bRect = moreBtn.getBoundingClientRect();
                const bcx = bRect.left + bRect.width / 2;
                const bcy = bRect.top + bRect.height / 2;
                const topEl = document.elementFromPoint(bcx, bcy);
                const isMoreOnTop = topEl === moreBtn || moreBtn.contains(topEl) || topEl?.closest('button') === moreBtn;
                info.push(`    📍 elementFromPoint(${Math.round(bcx)},${Math.round(bcy)}) = <${topEl?.tagName}> cls="${(topEl?.className || '').toString().substring(0, 30)}" isMoreBtn=${isMoreOnTop}`);

                // Step 3b: Hybrid click — pointerdown/mousedown + .click() (trusted)
                const clickTarget = isMoreOnTop ? moreBtn : topEl;
                if (clickTarget) {
                  clickTarget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: bcx, clientY: bcy, pointerId: 1, pointerType: 'mouse' }));
                  clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: bcx, clientY: bcy, button: 0 }));
                  await sleep(80);
                  clickTarget.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: bcx, clientY: bcy, pointerId: 1, pointerType: 'mouse' }));
                  clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: bcx, clientY: bcy, button: 0 }));
                  clickTarget.click();
                }
                await sleep(700);

                let menuAppeared = !!document.querySelector('[role="menu"], [role="listbox"], [role="menuitem"]');
                info.push(`    ${menuAppeared ? '🟢' : '🔴'} Menu after hybrid click: ${menuAppeared}`);

                // Step 3c: focus + Space key
                if (!menuAppeared) {
                  moreBtn.focus();
                  await sleep(100);
                  moreBtn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, cancelable: true }));
                  await sleep(50);
                  moreBtn.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
                  await sleep(700);
                  menuAppeared = !!document.querySelector('[role="menu"], [role="listbox"], [role="menuitem"]');
                  info.push(`    ${menuAppeared ? '🟢' : '🔴'} Menu after Space key: ${menuAppeared}`);
                }

                // Step 3d: Check for any popup (not just role="menu")
                if (!menuAppeared) {
                  const popups = document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [class*="popup"], [class*="dropdown"], [class*="menu"]');
                  for (const p of popups) {
                    if (p.closest('#veo3-panel, #veo3-bubble')) continue;
                    const pr = p.getBoundingClientRect();
                    if (pr.width > 0 && pr.height > 0) {
                      menuAppeared = true;
                      info.push(`    🟢 Found popup: <${p.tagName}> role="${p.getAttribute('role')}" cls="${(p.className || '').toString().substring(0, 40)}" (${Math.round(pr.left)},${Math.round(pr.top)}) ${Math.round(pr.width)}x${Math.round(pr.height)}`);
                      break;
                    }
                  }
                  if (!menuAppeared) info.push(`    🔴 No popups found anywhere`);
                }

                // Step 4: Search for "Incluir no comando" in any menu
                let incluirItem = null;
                const menuItems = document.querySelectorAll(
                  '[role="menuitem"], [role="option"], [role="menu"] button, [role="menu"] [role="button"], ' +
                  '[role="menu"] li, [role="menu"] div, [role="menu"] span, [role="listbox"] div'
                );
                const menuTexts = [];
                for (const item of menuItems) {
                  if (item.closest('#veo3-panel, #veo3-bubble')) continue;
                  const text = (item.textContent || '').toLowerCase();
                  menuTexts.push(text.trim().substring(0, 60));
                  if (text.includes('incluir no comando') || text.includes('include in prompt') ||
                    text.includes('incluir') || text.includes('include')) {
                    incluirItem = item;
                  }
                }

                if (incluirItem) {
                  info.push(`    🟢 "Incluir no comando" encontrado! → <${incluirItem.tagName}> text="${(incluirItem.textContent || '').trim().substring(0, 50)}"`);
                  info.push(`    ✅ FLUXO COMPLETO FUNCIONA ✅`);
                } else {
                  info.push(`    🔴 "Incluir no comando" NÃO encontrado no menu ⋮`);
                  info.push(`    Menu items encontrados: ${menuTexts.length}`);
                  menuTexts.forEach((t, i) => {
                    info.push(`      [${i}] "${t}"`);
                  });
                  // Also scan ALL visible elements for any "incluir" text (broader search)
                  const allEls = document.querySelectorAll('li, div, span, button, a');
                  const incluirCandidates = [];
                  for (const el of allEls) {
                    if (el.closest('#veo3-panel, #veo3-bubble')) continue;
                    const text = (el.textContent || '').toLowerCase().trim();
                    if (text.length > 80) continue;
                    if (text.includes('incluir') || text.includes('include')) {
                      const r = el.getBoundingClientRect();
                      if (r.width > 0 && r.height > 0) {
                        incluirCandidates.push(`<${el.tagName}> (${Math.round(r.left)},${Math.round(r.top)}) "${text.substring(0, 50)}"`);
                      }
                    }
                  }
                  if (incluirCandidates.length > 0) {
                    info.push(`    📍 Elementos com "incluir/include" visíveis: ${incluirCandidates.length}`);
                    incluirCandidates.forEach((c, i) => info.push(`      [${i}] ${c}`));
                  }
                }

                // NOW restore styles
                moreBtn.style.display = origDisplay;
                moreBtn.style.visibility = origVisibility;
                moreBtn.style.opacity = origOpacity;
                for (const h of hiddenAncs) { h.el.style.display = h.d; h.el.style.visibility = h.v; h.el.style.opacity = h.o; }

                // Close the menu
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                await sleep(300);
              }

              // Step 5: Scan for standalone "add" buttons near this card (alternative include method)
              const cardRect = card.getBoundingClientRect();
              const addBtns = document.querySelectorAll('button, [role="button"]');
              const nearbyAdds = [];
              for (const btn of addBtns) {
                if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
                const icon = btn.querySelector('i.google-symbols');
                const iconText = icon ? (icon.textContent || '').trim() : '';
                if (iconText !== 'add') continue;
                const btnRect = btn.getBoundingClientRect();
                // Must be on right side (x > 1800) and within card Y range ± 200px
                if (btnRect.left > 1800 && Math.abs(btnRect.top - cardRect.top) < cardRect.height + 200) {
                  nearbyAdds.push({ btn, x: Math.round(btnRect.left), y: Math.round(btnRect.top), w: Math.round(btnRect.width), h: Math.round(btnRect.height) });
                }
              }
              if (nearbyAdds.length > 0) {
                info.push(`    📍 Botões "add" no painel direito perto do card: ${nearbyAdds.length}`);
                nearbyAdds.forEach((a, i) => {
                  info.push(`      [${i}] (${a.x},${a.y}) ${a.w}x${a.h}`);
                });
              }

              // Mouse leave
              card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            } catch (e) {
              info.push(`    ❌ Erro no teste: ${e.message}`);
            }
          }

          // List buttons for remaining cards (without clicking)
          const remainingEntries = [...cardMap.entries()].slice(1);
          for (const [name, card] of remainingEntries) {
            const moreIcons = card.querySelectorAll('i.google-symbols');
            let hasMore = false;
            for (const icon of moreIcons) {
              if ((icon.textContent || '').trim() === 'more_vert') { hasMore = true; break; }
            }
            info.push(`  @${name}: ⋮ button ${hasMore ? '🟢 presente' : '🔴 ausente'} (não testado - mesma estrutura)`);
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

  // Helper: inspect React props on a DOM element (for diagnostics)
  function inspectReactProps(element) {
    if (!element) return 'null element';
    const keys = Object.keys(element);
    const reactKeys = keys.filter(k => k.startsWith('__react'));
    if (reactKeys.length === 0) return 'no React keys found';

    const results = [];
    results.push(`React keys: ${reactKeys.join(', ')}`);

    // Check __reactProps$
    const propsKey = keys.find(k => k.startsWith('__reactProps$'));
    if (propsKey && element[propsKey]) {
      const props = element[propsKey];
      const handlers = Object.keys(props).filter(k => k.startsWith('on'));
      results.push(`__reactProps handlers: [${handlers.join(', ')}]`);
    }

    // Check fiber
    const fiberKey = keys.find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (fiberKey && element[fiberKey]) {
      let fiber = element[fiberKey];
      for (let i = 0; i < 5 && fiber; i++) {
        const mp = fiber.memoizedProps || fiber.pendingProps;
        if (mp) {
          const handlers = Object.keys(mp).filter(k => k.startsWith('on'));
          if (handlers.length > 0) {
            results.push(`fiber[${i}] handlers: [${handlers.join(', ')}]`);
          }
        }
        fiber = fiber.return;
      }
    }

    return results.join(' | ');
  }

  // Helper: trigger a SPECIFIC React event handler on an element
  function triggerReactHandler(element, handlerName, eventObj) {
    if (!element) return false;
    const keys = Object.keys(element);

    // Try __reactProps$ first
    const propsKey = keys.find(k => k.startsWith('__reactProps$'));
    if (propsKey && element[propsKey]) {
      const props = element[propsKey];
      if (typeof props[handlerName] === 'function') {
        try {
          props[handlerName](eventObj);
          console.log(`🎭 triggerReactHandler: ${handlerName} via __reactProps$`);
          return true;
        } catch (e) {
          console.warn(`🎭 triggerReactHandler error: ${e.message}`);
        }
      }
    }

    // Walk fiber tree
    const fiberKey = keys.find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (fiberKey && element[fiberKey]) {
      let fiber = element[fiberKey];
      for (let i = 0; i < 10 && fiber; i++) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props && typeof props[handlerName] === 'function') {
          try {
            props[handlerName](eventObj);
            console.log(`🎭 triggerReactHandler: ${handlerName} via fiber[${i}]`);
            return true;
          } catch (e) {
            console.warn(`🎭 triggerReactHandler fiber error: ${e.message}`);
          }
        }
        fiber = fiber.return;
      }
    }

    return false;
  }

  // Main: trigger click on a React element by trying ALL common event handlers
  // Google Material/MUI components use onPointerDown/onPointerUp, not onClick
  function triggerReactClick(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Log what React props are available on this element
    console.log(`🎭 triggerReactClick: inspecting ${element.tagName} → ${inspectReactProps(element)}`);

    // Build fake events for different handler types
    const baseProps = { target: element, currentTarget: element, preventDefault: () => { }, stopPropagation: () => { }, bubbles: true, cancelable: true, isTrusted: true, clientX: cx, clientY: cy, pageX: cx, pageY: cy, screenX: cx, screenY: cy, button: 0, buttons: 1 };

    const clickEvent = { ...baseProps, type: 'click', nativeEvent: new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy }) };
    const pointerDownEvent = { ...baseProps, type: 'pointerdown', nativeEvent: new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }), pointerId: 1, pointerType: 'mouse' };
    const pointerUpEvent = { ...baseProps, type: 'pointerup', nativeEvent: new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy }), pointerId: 1, pointerType: 'mouse', buttons: 0 };
    const mouseDownEvent = { ...baseProps, type: 'mousedown', nativeEvent: new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }) };
    const mouseUpEvent = { ...baseProps, type: 'mouseup', nativeEvent: new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }), buttons: 0 };

    // Strategy 1: Try onClick directly
    if (triggerReactHandler(element, 'onClick', clickEvent)) return true;

    // Strategy 2: Try onPointerDown + onPointerUp (Google/MUI pattern)
    const pdOk = triggerReactHandler(element, 'onPointerDown', pointerDownEvent);
    if (pdOk) {
      triggerReactHandler(element, 'onPointerUp', pointerUpEvent);
      triggerReactHandler(element, 'onClick', clickEvent); // Some also need onClick after pointer
      return true;
    }

    // Strategy 3: Try onMouseDown + onMouseUp
    const mdOk = triggerReactHandler(element, 'onMouseDown', mouseDownEvent);
    if (mdOk) {
      triggerReactHandler(element, 'onMouseUp', mouseUpEvent);
      triggerReactHandler(element, 'onClick', clickEvent);
      return true;
    }

    // Strategy 4: Try any on* handler that looks like a click/press handler
    const keys = Object.keys(element);
    const propsKey = keys.find(k => k.startsWith('__reactProps$'));
    if (propsKey && element[propsKey]) {
      const props = element[propsKey];
      for (const key of Object.keys(props)) {
        if (typeof props[key] === 'function' && (key.includes('Press') || key.includes('Tap') || key.includes('Action'))) {
          try {
            props[key](clickEvent);
            console.log(`🎭 triggerReactClick: called ${key} via __reactProps$`);
            return true;
          } catch (e) { /* ignore */ }
        }
      }
    }

    console.warn(`🎭 triggerReactClick: no React handler found on ${element.tagName}`);
    return false;
  }

  // Include an image/character card in the prompt.
  //
  // STRATEGY ORDER:
  //   1. Hover card → find ⋮ → __reactProps$.onClick → "Incluir no comando"
  //   2. Hover → find "Incluir no comando" overlay button directly
  async function includeCardViaContextMenu(card, label) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);

    const cardRect = card.getBoundingClientRect();
    console.log(`🎭 ${label}: card <${card.tagName}> at (${Math.round(cardRect.left)},${Math.round(cardRect.top)}) ${Math.round(cardRect.width)}x${Math.round(cardRect.height)}`);

    // Check if this generation FAILED — failed cards don't have ⋮ overlay
    const cardText = (card.textContent || '').toLowerCase();
    if (cardText.includes('falha') || cardText.includes('failed') || cardText.includes('error')) {
      const hasWarning = card.querySelector('i.google-symbols')?.textContent?.trim() === 'warning';
      if (hasWarning) {
        console.warn(`🎭 ${label}: generation FAILED (has warning icon), skipping inclusion`);
        return false;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Find the correct image element to hover
    // In GALLERY view: card is a large row (~2177x400), find image inside
    // In EDITOR view: card may be a small prompt-text card (249x98),
    //   walk siblings to find the larger result image card.
    // ═══════════════════════════════════════════════════════════════════════
    let hoverTarget = card;

    // Detect small prompt-text card (editor view right panel)
    if (cardRect.height < 200 && cardRect.width < 400) {
      console.log(`🎭 ${label}: small card — searching for adjacent result image card...`);
      const siblings = card.parentElement ? [...card.parentElement.children] : [];
      const cardIndex = siblings.indexOf(card);
      let bestSibling = null;
      let bestDist = Infinity;

      for (let i = 0; i < siblings.length; i++) {
        const sib = siblings[i];
        if (sib === card) continue;
        const sibRect = sib.getBoundingClientRect();
        const sibImg = sib.querySelector('img');
        if (sibRect.height > 150 && sibImg && sibRect.width > 100) {
          const dist = Math.abs(i - cardIndex);
          if (dist < bestDist) { bestDist = dist; bestSibling = sib; }
        }
      }

      if (!bestSibling && card.parentElement) {
        const parent = card.parentElement;
        const pSiblings = parent.parentElement ? [...parent.parentElement.children] : [];
        const pIdx = pSiblings.indexOf(parent);
        for (let i = Math.max(0, pIdx - 3); i < Math.min(pSiblings.length, pIdx + 3); i++) {
          const sib = pSiblings[i];
          if (sib === parent) continue;
          const sibRect = sib.getBoundingClientRect();
          if (sibRect.height > 150 && sib.querySelector('img') && sibRect.width > 100) {
            const dist = Math.abs(i - pIdx);
            if (dist < bestDist) { bestDist = dist; bestSibling = sib; }
          }
        }
      }

      if (bestSibling) {
        console.log(`🎭 ${label}: found adjacent result image card at distance ${bestDist}`);
        hoverTarget = bestSibling;
      }
    }

    // IMPORTANT: do NOT click <A> links directly — that navigates to full-screen view!
    // Only use the card/div for hovering, never click the <A> itself.
    const imageEl = hoverTarget.querySelector('img') || card.querySelector('img');
    const hoverEl = imageEl || hoverTarget;
    hoverEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);

    const imgRect = hoverEl.getBoundingClientRect();
    console.log(`🎭 ${label}: hover target <${hoverEl.tagName}> at (${Math.round(imgRect.left)},${Math.round(imgRect.top)}) ${Math.round(imgRect.width)}x${Math.round(imgRect.height)}`);

    // Hover the element to trigger React overlay (⋮ button, "Incluir" button)
    await hoverOverImageCard(hoverEl);
    if (hoverEl !== hoverTarget) await hoverOverImageCard(hoverTarget);
    await sleep(500);

    // Quick check: "Incluir no comando" button directly visible?
    let incluirBtn = findIncluirButtonNear(hoverTarget);
    if (!incluirBtn) incluirBtn = findIncluirButtonNear(card);

    if (incluirBtn) {
      console.log(`🎭 ${label}: clicking "Incluir no comando" button directly...`);
      const clicked = await clickIncluirButton(incluirBtn);
      if (clicked) {
        console.log(`🎭 ✅ ${label}: included via "Incluir" button!`);
        hoverEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        return true;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Find ⋮ button and open context menu → "Incluir no comando"
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`🎭 ${label}: looking for ⋮ context menu...`);

    // Re-hover to ensure overlay is visible
    const hx = imgRect.left + imgRect.width * 0.8;
    const hy = imgRect.top + 30;
    hoverEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: hx, clientY: hy }));
    hoverEl.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hx, clientY: hy }));
    hoverEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: hx, clientY: hy }));
    hoverEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: hx, clientY: hy }));
    hoverEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: hx, clientY: hy }));
    await sleep(500);

    // Find ⋮ button by position over the image card
    let moreBtn = null;
    const allBtns = document.querySelectorAll('button, [role="button"]');

    for (const btn of allBtns) {
      if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
      const icon = btn.querySelector('i.google-symbols, i.material-icons, i.material-symbols-outlined, .google-symbols');
      const iconText = icon ? (icon.textContent || '').trim() : '';
      if (iconText !== 'more_vert' && iconText !== 'more_horiz') continue;

      const bRect = btn.getBoundingClientRect();
      if (bRect.width === 0 || bRect.height === 0) continue;

      const inXRange = bRect.left >= imgRect.left - 30 && bRect.right <= imgRect.right + 30;
      const inYRange = bRect.top >= imgRect.top - 30 && bRect.bottom <= imgRect.bottom + 30;

      if (inXRange && inYRange) {
        moreBtn = btn;
        console.log(`🎭 ${label}: found ⋮ at (${Math.round(bRect.left)},${Math.round(bRect.top)}) WITHIN image bounds`);
        break;
      }
    }

    if (!moreBtn) {
      // Search inside card DOM
      const cardBtns = card.querySelectorAll('button, [role="button"]');
      for (const btn of cardBtns) {
        if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
        const icon = btn.querySelector('i.google-symbols, .google-symbols');
        const iconText = icon ? (icon.textContent || '').trim() : '';
        if (iconText === 'more_vert' || iconText === 'more_horiz') {
          const bRect = btn.getBoundingClientRect();
          if (bRect.top > 0 && bRect.top < 50) continue;
          moreBtn = btn;
          break;
        }
      }
    }

    if (!moreBtn) {
      console.warn(`🎭 ${label}: ⋮ button not found, all inclusion methods failed`);
      hoverEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      return false;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Click the ⋮ button — COMPREHENSIVE multi-strategy approach
    // The button uses styled-components and has NO __reactProps$/__reactFiber$
    // on the element itself. React event delegation listens at the root.
    // We need events with composed:true, view:window, and proper detail.
    // ═══════════════════════════════════════════════════════════════════════
    const moreBtnRect = moreBtn.getBoundingClientRect();
    const bx = moreBtnRect.left + moreBtnRect.width / 2;
    const by = moreBtnRect.top + moreBtnRect.height / 2;

    // Force visibility if zero dimensions
    const forcedElements = [];
    if (moreBtnRect.width === 0 || moreBtnRect.height === 0) {
      forcedElements.push({
        el: moreBtn,
        orig: { display: moreBtn.style.display, visibility: moreBtn.style.visibility, opacity: moreBtn.style.opacity, pointerEvents: moreBtn.style.pointerEvents }
      });
      moreBtn.style.setProperty('display', 'inline-flex', 'important');
      moreBtn.style.setProperty('visibility', 'visible', 'important');
      moreBtn.style.setProperty('opacity', '1', 'important');
      moreBtn.style.setProperty('pointer-events', 'auto', 'important');

      let anc = moreBtn.parentElement;
      for (let i = 0; i < 20 && anc && anc !== document.body; i++) {
        const cs = getComputedStyle(anc);
        if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') {
          forcedElements.push({
            el: anc,
            orig: { display: anc.style.display, visibility: anc.style.visibility, opacity: anc.style.opacity, pointerEvents: anc.style.pointerEvents }
          });
          anc.style.setProperty('display', 'flex', 'important');
          anc.style.setProperty('visibility', 'visible', 'important');
          anc.style.setProperty('opacity', '1', 'important');
        }
        anc = anc.parentElement;
      }
      await sleep(300);
    }

    // Common event properties — include composed, view, detail
    const evtBase = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: bx, clientY: by,
      screenX: bx + (window.screenX || 0), screenY: by + (window.screenY || 0),
      pageX: bx + window.scrollX, pageY: by + window.scrollY,
      button: 0, detail: 1
    };

    // Helper: check if menu opened
    const checkMenu = () => {
      // Check role="menu" first
      let m = document.querySelector('[role="menu"]');
      if (m && m.getBoundingClientRect().width > 0) return m;
      // Check any visible popup
      const popups = document.querySelectorAll('[role="menu"], [role="listbox"], [class*="dropdown"], [class*="popup"], [class*="menu"]');
      for (const p of popups) {
        if (p.closest('#veo3-panel, #veo3-bubble')) continue;
        const r = p.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) return p;
      }
      return null;
    };

    let menu = null;

    // Determine click target (button or element actually on top)
    const topEl = document.elementFromPoint(bx, by);
    const clickTarget = (topEl === moreBtn || moreBtn.contains(topEl) ||
      topEl?.closest('button') === moreBtn) ? moreBtn : (topEl || moreBtn);
    console.log(`🎭 ${label}: topElement at ⋮ = <${topEl?.tagName}> cls="${(topEl?.className || '').toString().substring(0, 30)}"`);

    // ─── Strategy 0: Direct __reactProps$ onClick invocation ────────────
    // The ⋮ button has __reactProps$ with onClick handler (confirmed by diagnostic).
    // Call it directly — bypasses event delegation entirely, no trusted event needed.
    {
      const propsKey = Object.keys(moreBtn).find(k => k.startsWith('__reactProps$'));
      if (propsKey && moreBtn[propsKey]) {
        const reactProps = moreBtn[propsKey];
        const handlers = ['onClick', 'onMouseDown', 'onPointerDown'];
        for (const hn of handlers) {
          if (typeof reactProps[hn] === 'function' && !menu) {
            console.log(`🎭 ${label}: Strategy 0: invoking __reactProps$.${hn} directly...`);
            try {
              const evt = new MouseEvent('click', {
                bubbles: true, cancelable: true, composed: true, view: window,
                clientX: bx, clientY: by, button: 0, detail: 1
              });
              // Add SyntheticEvent-like methods React handlers may call
              evt.persist = () => { };
              evt.isDefaultPrevented = () => false;
              evt.isPropagationStopped = () => false;
              reactProps[hn](evt);
              await sleep(600);
              menu = checkMenu();
              if (menu) {
                console.log(`🎭 ${label}: S0 __reactProps$.${hn} → menu: YES ✅`);
                break;
              }
              console.log(`🎭 ${label}: S0 __reactProps$.${hn} → menu: NO`);
            } catch (e) {
              console.warn(`🎭 ${label}: S0 ${hn} error: ${e.message}`);
            }
          }
        }
      } else {
        console.log(`🎭 ${label}: S0 skipped — no __reactProps$ on button`);
      }
    }

    // ─── Strategy 1: Full pointer+mouse lifecycle (with composed+view+detail) ─
    if (!menu) {
      console.log(`🎭 ${label}: Strategy 1: full event lifecycle...`);
      // First hover directly over the ⋮ button
      moreBtn.dispatchEvent(new PointerEvent('pointerover', { ...evtBase, pointerId: 1, pointerType: 'mouse' }));
      moreBtn.dispatchEvent(new PointerEvent('pointerenter', { ...evtBase, bubbles: false, pointerId: 1, pointerType: 'mouse' }));
      moreBtn.dispatchEvent(new MouseEvent('mouseover', evtBase));
      moreBtn.dispatchEvent(new MouseEvent('mouseenter', { ...evtBase, bubbles: false }));
      await sleep(100);
      moreBtn.dispatchEvent(new PointerEvent('pointermove', { ...evtBase, pointerId: 1, pointerType: 'mouse' }));
      moreBtn.dispatchEvent(new MouseEvent('mousemove', evtBase));
      await sleep(100);
      // Press
      moreBtn.dispatchEvent(new PointerEvent('pointerdown', { ...evtBase, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
      moreBtn.dispatchEvent(new MouseEvent('mousedown', { ...evtBase, buttons: 1 }));
      moreBtn.focus({ preventScroll: true });
      await sleep(100);
      // Release
      moreBtn.dispatchEvent(new PointerEvent('pointerup', { ...evtBase, pointerId: 1, pointerType: 'mouse', buttons: 0 }));
      moreBtn.dispatchEvent(new MouseEvent('mouseup', { ...evtBase, buttons: 0 }));
      await sleep(30);
      // Click
      moreBtn.dispatchEvent(new MouseEvent('click', evtBase));
      await sleep(600);
      menu = checkMenu();
      console.log(`🎭 ${label}: S1 result → menu: ${menu ? 'YES' : 'NO'}`);
    }
    // ─── Strategy 2: Plain native .click() ─────────────────────────────────
    if (!menu) {
      console.log(`🎭 ${label}: Strategy 2: native .click()...`);
      moreBtn.click();
      await sleep(600);
      menu = checkMenu();
      console.log(`🎭 ${label}: S2 result → menu: ${menu ? 'YES' : 'NO'}`);
    }

    // ─── Strategy 2b: Click on the topEl if different from moreBtn ──────────
    if (!menu && clickTarget !== moreBtn) {
      console.log(`🎭 ${label}: Strategy 2b: clicking topElement...`);
      clickTarget.dispatchEvent(new PointerEvent('pointerdown', { ...evtBase, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
      clickTarget.dispatchEvent(new MouseEvent('mousedown', { ...evtBase, buttons: 1 }));
      await sleep(80);
      clickTarget.dispatchEvent(new PointerEvent('pointerup', { ...evtBase, pointerId: 1, pointerType: 'mouse', buttons: 0 }));
      clickTarget.dispatchEvent(new MouseEvent('mouseup', { ...evtBase, buttons: 0 }));
      clickTarget.click();
      await sleep(600);
      menu = checkMenu();
    }

    // ─── Strategy 3: Focus + Enter key ─────────────────────────────────────
    if (!menu) {
      console.log(`🎭 ${label}: Strategy 3: focus + Enter...`);
      moreBtn.focus({ preventScroll: true });
      await sleep(150);
      const kbBase = { bubbles: true, cancelable: true, composed: true, view: window };
      moreBtn.dispatchEvent(new KeyboardEvent('keydown', { ...kbBase, key: 'Enter', code: 'Enter', keyCode: 13 }));
      await sleep(60);
      moreBtn.dispatchEvent(new KeyboardEvent('keypress', { ...kbBase, key: 'Enter', code: 'Enter', keyCode: 13 }));
      await sleep(60);
      moreBtn.dispatchEvent(new KeyboardEvent('keyup', { ...kbBase, key: 'Enter', code: 'Enter', keyCode: 13 }));
      await sleep(600);
      menu = checkMenu();
      console.log(`🎭 ${label}: S3 Enter → menu: ${menu ? 'YES' : 'NO'}`);
    }

    // ─── Strategy 4: Focus + Space key ─────────────────────────────────────
    if (!menu) {
      console.log(`🎭 ${label}: Strategy 4: focus + Space...`);
      moreBtn.focus({ preventScroll: true });
      await sleep(100);
      const kbBase = { bubbles: true, cancelable: true, composed: true, view: window };
      moreBtn.dispatchEvent(new KeyboardEvent('keydown', { ...kbBase, key: ' ', code: 'Space', keyCode: 32 }));
      await sleep(60);
      moreBtn.dispatchEvent(new KeyboardEvent('keyup', { ...kbBase, key: ' ', code: 'Space', keyCode: 32 }));
      await sleep(600);
      menu = checkMenu();
      console.log(`🎭 ${label}: S4 Space → menu: ${menu ? 'YES' : 'NO'}`);
    }

    // ─── Strategy 5: Walk ANCESTOR chain to find React fiber, invoke handler ─
    if (!menu) {
      console.log(`🎭 ${label}: Strategy 5: walking ancestor React fiber tree...`);
      let reactEl = moreBtn;
      let ancFiber = null;
      for (let i = 0; i < 20 && reactEl; i++) {
        const keys = Object.keys(reactEl);
        const fk = keys.find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        if (fk) {
          ancFiber = reactEl[fk];
          console.log(`🎭 ${label}: found React fiber ${i} levels up on <${reactEl.tagName}>`);
          break;
        }
        reactEl = reactEl.parentElement;
      }

      if (ancFiber) {
        // Walk DOWN the fiber tree (child/sibling) to find click-like handlers
        const fakeEvent = {
          target: moreBtn, currentTarget: moreBtn,
          clientX: bx, clientY: by, button: 0,
          preventDefault: () => { }, stopPropagation: () => { },
          nativeEvent: new MouseEvent('click', { bubbles: true, clientX: bx, clientY: by }),
          bubbles: true, cancelable: true, type: 'click', isTrusted: true, detail: 1
        };

        // BFS through fiber nodes
        const queue = [ancFiber];
        const visited = new Set();
        let handlerFound = false;
        while (queue.length > 0 && !menu && !handlerFound) {
          const f = queue.shift();
          if (!f || visited.has(f)) continue;
          visited.add(f);
          if (visited.size > 100) break; // safety limit

          const props = f.memoizedProps || f.pendingProps;
          if (props) {
            const handlerNames = ['onClick', 'onPointerDown', 'onPointerUp', 'onMouseDown', 'onPress'];
            for (const hn of handlerNames) {
              if (typeof props[hn] === 'function') {
                try {
                  console.log(`🎭 ${label}: invoking fiber handler ${hn}...`);
                  props[hn](fakeEvent);
                  await sleep(500);
                  menu = checkMenu();
                  if (menu) { handlerFound = true; break; }
                } catch (e) {
                  console.warn(`🎭 ${label}: fiber handler ${hn} error: ${e.message}`);
                }
              }
            }
          }

          // Add children and siblings to queue
          if (f.child) queue.push(f.child);
          if (f.sibling) queue.push(f.sibling);
          // Also go up one level and try siblings there
          if (f.return && !visited.has(f.return)) queue.push(f.return);
        }
        console.log(`🎭 ${label}: S5 fiber walk → menu: ${menu ? 'YES' : 'NO'} (visited ${visited.size} nodes)`);
      } else {
        console.log(`🎭 ${label}: S5 skipped — no React fiber found in ancestor chain`);
      }
    }

    // ─── Strategy 6: triggerReactClick on button + icon ─────────────────────
    if (!menu) {
      console.log(`🎭 ${label}: Strategy 6: triggerReactClick...`);
      triggerReactClick(moreBtn);
      const icon = moreBtn.querySelector('i, span, svg');
      if (icon) triggerReactClick(icon);
      await sleep(700);
      menu = checkMenu();
      console.log(`🎭 ${label}: S6 result → menu: ${menu ? 'YES' : 'NO'}`);
    }

    // ─── Strategy 7: Dispatch events at document/root level (React 17 delegation) ─
    if (!menu) {
      console.log(`🎭 ${label}: Strategy 7: document-level event dispatch...`);
      // React 17+ attaches its event listeners to the root container
      // Dispatch a fresh click with correct coordinates — the target will be
      // whatever is at those coordinates per the browser's hit testing
      const clickEvt = new MouseEvent('click', {
        bubbles: true, cancelable: true, composed: true, view: window,
        clientX: bx, clientY: by, button: 0, detail: 1
      });
      // Dispatch on the element that's actually at those coordinates
      const target = document.elementFromPoint(bx, by);
      if (target) {
        target.dispatchEvent(new PointerEvent('pointerdown', { ...evtBase, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
        await sleep(50);
        target.dispatchEvent(new PointerEvent('pointerup', { ...evtBase, pointerId: 1, pointerType: 'mouse', buttons: 0 }));
        await sleep(30);
        target.dispatchEvent(clickEvt);
        await sleep(600);
        menu = checkMenu();
        console.log(`🎭 ${label}: S7 result → menu: ${menu ? 'YES' : 'NO'}`);
      }
    }

    // Restore forced styles
    for (const { el, orig } of forcedElements) {
      el.style.display = orig.display;
      el.style.visibility = orig.visibility;
      el.style.opacity = orig.opacity;
      el.style.pointerEvents = orig.pointerEvents;
    }

    // Find "Incluir no comando" in the menu
    let incluirMenuItem = null;
    if (menu) {
      const items = menu.querySelectorAll('[role="menuitem"], button, li, div, a, span');
      for (const item of items) {
        const text = (item.textContent || '').toLowerCase().trim();
        if (text.includes('incluir no comando') || text.includes('include in prompt') || text.includes('incluir')) {
          incluirMenuItem = item;
          console.log(`🎭 ${label}: found "${text}" in ⋮ menu`);
          break;
        }
      }
    }

    // Global scan fallback
    if (!incluirMenuItem) {
      const allEls = document.querySelectorAll('[role="menuitem"], [role="option"], li, button, div, span, a');
      for (const el of allEls) {
        if (el.closest('#veo3-panel, #veo3-bubble')) continue;
        const text = (el.textContent || '').toLowerCase().trim();
        if (text.length > 80) continue;
        if (text.includes('incluir no comando') || text.includes('include in prompt')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { incluirMenuItem = el; break; }
        }
      }
    }

    if (!incluirMenuItem) {
      console.warn(`🎭 ${label}: "Incluir no comando" NOT found via ⋮ menu either`);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(200);
      hoverEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      return false;
    }

    // Click "Incluir no comando" menu item
    console.log(`🎭 ${label}: clicking "Incluir no comando" from ⋮ menu...`);
    incluirMenuItem.click();
    await sleep(500);
    triggerReactClick(incluirMenuItem);
    await sleep(500);
    console.log(`🎭 ✅ ${label}: "Incluir no comando" clicked via ⋮ menu!`);
    hoverEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
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
      console.log(`🎭 Selecting characters via ⋮ → Incluir: ${characterNames.join(', ')}`);

      // ═══════════════════════════════════════════════════════════════════════
      // PROGRESSIVE SCROLL to bottom — ensures lazy-loaded content appears.
      // In VEO3 Flow, the timeline shows newest at top, original character
      // reference images at bottom. We scroll in steps to trigger loading.
      // ═══════════════════════════════════════════════════════════════════════

      // Find the scrollable container
      let scroller = null;
      const candidates = document.querySelectorAll('div');
      for (const div of candidates) {
        if (div.closest('#veo3-panel, #veo3-bubble')) continue;
        const cs = getComputedStyle(div);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
          div.scrollHeight > div.clientHeight + 100 &&
          div.clientHeight > 300) {
          scroller = div;
          break;
        }
      }

      const scrollTarget = scroller || document.scrollingElement || document.documentElement;
      const maxScroll = scrollTarget.scrollHeight - scrollTarget.clientHeight;
      console.log(`🎭 Scroll target: <${scrollTarget.tagName || 'HTML'}> scrollHeight=${scrollTarget.scrollHeight} maxScroll=${maxScroll}`);

      // Progressive scroll: go in 3 steps to trigger lazy loading
      if (maxScroll > 200) {
        for (let step = 1; step <= 3; step++) {
          const target = Math.min(maxScroll, (maxScroll * step) / 3);
          scrollTarget.scrollTop = target;
          await sleep(400);
        }
        // Final: ensure we're at the very bottom
        scrollTarget.scrollTop = maxScroll;
        await sleep(600);
      }
      // Also scroll the window as fallback
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(400);

      // Find character cards on the page by @Name: patterns
      let cardMap = findCharacterCards();

      if (cardMap.size === 0) {
        // Retry: maybe content is still loading — wait and try again
        console.log('🎭 No cards found, retrying after additional wait...');
        await sleep(1000);
        cardMap = findCharacterCards();
      }

      if (cardMap.size === 0) {
        console.warn('⚠️ No @Name: character cards found on page');
        return { success: false, count: 0, error: 'Nenhum personagem @Nome encontrado na página' };
      }

      let count = 0;

      for (const name of characterNames) {
        // Match name to card (exact + fuzzy)
        let card = cardMap.get(name);
        if (!card) {
          for (const [key, c] of cardMap) {
            if (key.startsWith(name) || name.startsWith(key) || key.includes(name) || name.includes(key)) {
              card = c;
              console.log(`🎭 Fuzzy match: "${name}" → "${key}"`);
              break;
            }
          }
        }

        // RETRY: if card not found, re-scroll to bottom and re-scan
        if (!card) {
          console.log(`🎭 @${name}: not found in first scan, re-scrolling to bottom...`);
          scrollTarget.scrollTop = maxScroll;
          window.scrollTo(0, document.documentElement.scrollHeight);
          await sleep(800);
          const retryMap = findCharacterCards();
          card = retryMap.get(name);
          if (!card) {
            for (const [key, c] of retryMap) {
              if (key.startsWith(name) || name.startsWith(key) || key.includes(name) || name.includes(key)) {
                card = c;
                break;
              }
            }
          }
        }

        if (!card) {
          console.warn(`🎭 @${name}: card not found on page after retry`);
          updateStatus(`🎭 ⚠️ @${name}: não encontrado na página`);
          continue;
        }

        // Scroll specific card into view
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500);

        // Click ⋮ → "Incluir no comando"
        const success = await includeCardViaContextMenu(card, `@${name}`);
        if (success) {
          count++;
          updateStatus(`🎭 ✅ @${name} incluído no comando`);
        } else {
          updateStatus(`🎭 ⚠️ @${name}: não conseguiu incluir`);
        }

        await sleep(CONFIG.IMAGE_SELECT_DELAY);
      }

      console.log(`🎭 Character selection complete: ${count}/${characterNames.length} included`);
      return { success: count > 0, count, error: null };
    } catch (err) {
      console.error(`❌ selectCharacterImages error: ${err.message}`);
      return { success: false, count: 0, error: err.message };
    } finally {
      state.imageSelectionInProgress = false;
    }
  }

  // ============================================================================
  // IMAGE-BY-KEYWORD SELECTION (via ⋮ → "Incluir no comando")
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

  // Select images by keyword/name or by numeric index via hover → "Incluir no comando"
  // keywords: array of strings, e.g. ["stone cave", "meditation"] or ["1", "3"]
  // Numeric keywords select by position (1-based index on the page)
  // skipClear: if true, don't clear attached images first (used when CHARS already selected)
  async function selectImagesByKeywords(keywords, skipClear = false) {
    if (state.imageSelectionInProgress) {
      return { success: false, count: 0, error: 'Seleção já em andamento' };
    }
    state.imageSelectionInProgress = true;

    try {
      console.log(`🖼️ Selecting images by keywords: ${keywords.join(', ')}`);

      // Find ALL image cards on the page
      const imageCards = findImageCards();

      if (imageCards.length === 0) {
        console.warn('⚠️ No image cards found on page for [IMGS] selection');
        return { success: false, count: 0, error: 'Nenhuma imagem encontrada na página' };
      }

      // Build a rich text index for each image card
      const cardTexts = imageCards.map(({ element: card, img }, idx) => {
        const parts = [];

        // 1. Walk up to find a row container with meaningful text
        let row = card;
        let rowContainer = card;
        for (let i = 0; i < 15 && row; i++) {
          const rect = row.getBoundingClientRect();
          // Lower threshold: individual cards are ~700px wide
          if (rect.width > 400 && rect.height > 80) {
            rowContainer = row;
            // Get ALL text content from this container
            const text = (row.textContent || '').trim();
            if (text.length > 0 && text.length < 5000) {
              parts.push(text);
            }
            break;
          }
          row = row.parentElement;
        }

        // 2. Get text from the card itself
        const cardText = (card.textContent || '').trim();
        if (cardText.length > 0 && cardText.length < 2000) {
          parts.push(cardText);
        }

        // 3. Get image attributes
        if (img) {
          const attrs = [img.alt, img.title, img.getAttribute('aria-label')].filter(Boolean);
          parts.push(...attrs);
        }

        // 4. Scan SIBLING elements of the card for prompt/description text
        // VEO3 often puts the prompt text in a sibling <div> to the image card
        if (card.parentElement) {
          for (const sibling of card.parentElement.children) {
            if (sibling === card) continue;
            const sibText = (sibling.textContent || '').trim();
            if (sibText.length > 3 && sibText.length < 2000) {
              parts.push(sibText);
            }
          }
        }

        // 5. Also check the next/previous siblings of the row container
        if (rowContainer && rowContainer !== card) {
          const prev = rowContainer.previousElementSibling;
          const next = rowContainer.nextElementSibling;
          if (prev) {
            const prevText = (prev.textContent || '').trim();
            if (prevText.length > 3 && prevText.length < 500) parts.push(prevText);
          }
          if (next) {
            const nextText = (next.textContent || '').trim();
            if (nextText.length > 3 && nextText.length < 500) parts.push(nextText);
          }
        }

        const fullText = parts.join(' ').toLowerCase();
        console.log(`🖼️  Card[${idx + 1}] text (${fullText.length} chars): "${fullText.substring(0, 100)}..."`);
        return { card, row: rowContainer, text: fullText, index: idx + 1 };
      });

      console.log(`🖼️ Built text index for ${cardTexts.length} image cards`);

      let count = 0;

      for (const keyword of keywords) {
        const kw = keyword.toLowerCase().trim();
        if (!kw) continue;

        let targetEntry = null;

        // Check if keyword is a numeric index (e.g., "1", "2", "3")
        const numIdx = parseInt(kw, 10);
        if (!isNaN(numIdx) && String(numIdx) === kw && numIdx >= 1 && numIdx <= cardTexts.length) {
          targetEntry = cardTexts[numIdx - 1];
          console.log(`🖼️ "${keyword}" → selecting image #${numIdx} by index`);
        }

        // Text-based matching
        if (!targetEntry) {
          let bestMatch = null;
          let bestScore = 0;

          for (const ct of cardTexts) {
            if (!ct.text.includes(kw)) continue;
            // Score: prefer exact word boundary match
            const wordMatch = ct.text.includes(' ' + kw + ' ') || ct.text.includes(kw + ' ') ||
              ct.text.startsWith(kw) || ct.text.includes(' ' + kw);
            const score = wordMatch ? 2 : 1;
            if (score > bestScore) {
              bestScore = score;
              bestMatch = ct;
            }
          }

          if (!bestMatch) {
            // Try matching individual words from the keyword
            const kwWords = kw.split(/\s+/);
            if (kwWords.length > 1) {
              for (const ct of cardTexts) {
                const matchedWords = kwWords.filter(w => ct.text.includes(w));
                const score = matchedWords.length / kwWords.length;
                if (score > 0.5 && score > bestScore) {
                  bestScore = score;
                  bestMatch = ct;
                }
              }
            }
          }

          if (bestMatch) {
            targetEntry = bestMatch;
            console.log(`🖼️ "${keyword}" matched card[${targetEntry.index}] with text: "${targetEntry.text.substring(0, 80)}..."`);
          }
        }

        if (!targetEntry) {
          console.log(`🖼️ "${keyword}": no matching image card (this is normal if keyword doesn't match image titles)`);
          continue;
        }

        // Include via hover → Incluir button
        const targetCard = targetEntry.row;
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(400);

        const success = await includeCardViaContextMenu(targetCard, `[IMGS] "${keyword}"`);
        if (success) {
          count++;
          updateStatus(`🖼️ ✅ "${keyword}" incluído no comando`);
        } else {
          updateStatus(`🖼️ ⚠️ "${keyword}": não conseguiu incluir`);
        }

        await sleep(CONFIG.IMAGE_SELECT_DELAY);
      }

      console.log(`🖼️ Image keyword selection complete: ${count}/${keywords.length} included`);
      return { success: count > 0, count, error: null };
    } catch (err) {
      console.error(`❌ selectImagesByKeywords error: ${err.message}`);
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

    try {
      // Step 0: Resolve tRPC redirect URLs to direct video URLs
      let resolvedUrl = url;
      if (url.includes('getMediaUrlRedirect')) {
        resolvedUrl = await resolveMediaRedirectUrl(url);
      }

      // Strategy 1: fetch as blob → <a download> (works for same-origin + direct URLs)
      const blob = await fetchVideoBlob(resolvedUrl);
      if (blob && blob.size > 0) {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 1000);

        state.lastDownloadComplete = true;
        console.log(`✅ Downloaded: ${filename} (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);
        updateStatus(`✅ Baixado: ${filename}`);
        return;
      }

      // Strategy 2: <a download> with resolved URL (browser handles CORS natively for navigation)
      console.log('📥 [DL] fetch failed, trying <a download> with resolved URL...');
      downloadViaAnchor(resolvedUrl, filename);

      state.lastDownloadComplete = true; // Assume success with <a download>
      console.log(`✅ Download via link: ${filename}`);
      updateStatus(`✅ Baixado: ${filename}`);
    } catch (err) {
      console.error(`❌ Download failed: ${err.message}`);
      // Last resort: <a download> with original URL
      downloadViaAnchor(url, filename);

      state.lastDownloadComplete = false;
      updateStatus(`⚠️ Download tentado: ${filename}`);
    }
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

  // ── Method 1: Extract ALL video URLs from React's internal fiber tree ──
  // VEO3 stores ALL media data in React state, even for items not rendered
  // in the virtual scroll DOM. This bypasses virtual-scroll entirely.
  function extractVideoUrlsFromReact() {
    const urls = new Set();
    const visited = new WeakSet();
    const urlPattern = /media\.getMediaUrlRedirect/;

    function searchValue(val, depth) {
      if (depth > 15) return;
      if (!val || typeof val !== 'object') return;
      if (visited.has(val)) return;
      try { visited.add(val); } catch (e) { return; }

      // Check arrays
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length && i < 500; i++) {
          const item = val[i];
          if (typeof item === 'string' && urlPattern.test(item)) {
            urls.add(item);
          } else if (typeof item === 'object' && item) {
            searchValue(item, depth + 1);
          }
        }
        return;
      }

      // Check object properties
      const keys = Object.keys(val);
      for (let k = 0; k < keys.length && k < 200; k++) {
        const key = keys[k];
        // Skip DOM nodes, fiber circular refs
        if (key === 'stateNode' || key === '_owner' || key === 'return' ||
          key === '_debugOwner' || key === '_store' || key === 'ref' ||
          key === '_self' || key === '_source') continue;
        try {
          const prop = val[key];
          if (typeof prop === 'string') {
            if (urlPattern.test(prop)) urls.add(prop);
          } else if (typeof prop === 'object' && prop) {
            searchValue(prop, depth + 1);
          }
        } catch (e) { /* skip inaccessible */ }
      }
    }

    // Strategy A: Search React fiber tree from root
    const root = document.getElementById('root') || document.querySelector('[data-reactroot]');
    if (root) {
      const fiberKey = Object.keys(root).find(k =>
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey) {
        console.log('📹 React: scanning fiber tree for video URLs...');
        try {
          const fiber = root[fiberKey];
          // Walk the fiber tree (child/sibling)
          function walkFiber(node, depth) {
            if (!node || depth > 30) return;
            if (visited.has(node)) return;
            try { visited.add(node); } catch (e) { return; }

            // Check memoizedProps
            if (node.memoizedProps) searchValue(node.memoizedProps, 0);
            // Check memoizedState
            if (node.memoizedState) searchValue(node.memoizedState, 0);
            // Check pendingProps
            if (node.pendingProps) searchValue(node.pendingProps, 0);

            walkFiber(node.child, depth + 1);
            walkFiber(node.sibling, depth + 1);
          }
          walkFiber(fiber, 0);
        } catch (e) {
          console.warn('📹 React fiber scan error:', e.message);
        }
      }
    }

    // Strategy B: Search React props on ALL DOM elements with props
    const propsPrefix = '__reactProps$';
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const propsKey = Object.keys(el).find(k => k.startsWith(propsPrefix));
      if (!propsKey) continue;
      try {
        searchValue(el[propsKey], 0);
      } catch (e) { /* skip */ }
    }

    // Filter: only keep getMediaUrlRedirect URLs (video/media)
    const videoUrls = [];
    for (const url of urls) {
      // Normalize partial URLs
      let fullUrl = url;
      if (!fullUrl.startsWith('http')) {
        fullUrl = 'https://labs.google/fx/api/trpc/' + fullUrl;
      }
      videoUrls.push(fullUrl);
    }

    console.log(`📹 React extraction: found ${videoUrls.length} media URLs`);
    return videoUrls;
  }

  // ── Method 2: Scroll-based collection (fallback) ──
  // Scrolls through "View videos" filter and collects <video> elements
  async function scrollCollectVideos() {
    const collected = new Map();

    function collectVisible() {
      let n = 0;
      const videos = document.querySelectorAll('video');
      for (const video of videos) {
        if (video.closest('#veo3-panel, #veo3-bubble')) continue;
        const url = video.currentSrc || video.src || '';
        if (!url) continue;
        const rect = video.getBoundingClientRect();
        if (rect.width < 50 && rect.height < 50 && video.videoWidth < 50) continue;
        if (!collected.has(url)) {
          collected.set(url, { url, element: video });
          n++;
        }
      }
      return n;
    }

    // Click "View videos" filter
    let clickedFilter = false;
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const icon = btn.querySelector('i.google-symbols, i.material-icons');
      const iconText = icon ? (icon.textContent || '').trim().toLowerCase() : '';
      const btnText = (btn.textContent || '').toLowerCase();
      if (iconText === 'videocam' && (btnText.includes('video') || btnText.includes('vídeo'))) {
        console.log('📹 Scroll: clicking "View videos" filter...');
        btn.click();
        clickedFilter = true;
        await sleep(1000);
        break;
      }
    }

    // Find scrollable container
    let scrollContainer = null;
    const divs = document.querySelectorAll('div, main, section');
    for (const el of divs) {
      if (el.closest('#veo3-panel, #veo3-bubble')) continue;
      const style = getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300) {
        if (!scrollContainer || el.scrollHeight > scrollContainer.scrollHeight) {
          scrollContainer = el;
        }
      }
    }

    const target = scrollContainer || document.documentElement;
    const maxH = target.scrollHeight;
    const step = 350;
    const saved = scrollContainer ? scrollContainer.scrollTop : window.scrollY;

    collectVisible();
    target.scrollTop = 0;
    if (!scrollContainer) window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(500);
    collectVisible();

    // Single pass down with 800ms wait
    console.log(`📹 Scroll: pass down (scrollHeight=${maxH})...`);
    for (let pos = 0; pos <= maxH; pos += step) {
      target.scrollTop = pos;
      if (!scrollContainer) window.scrollTo({ top: pos, behavior: 'instant' });
      await sleep(800);
      const n = collectVisible();
      if (n > 0) console.log(`📹 Scroll pos=${pos}: +${n} (total: ${collected.size})`);
    }

    // Single pass back up
    console.log(`📹 Scroll: pass up (found ${collected.size})...`);
    for (let pos = maxH; pos >= 0; pos -= step) {
      target.scrollTop = pos;
      if (!scrollContainer) window.scrollTo({ top: pos, behavior: 'instant' });
      await sleep(800);
      const n = collectVisible();
      if (n > 0) console.log(`📹 Scroll pos=${pos}: +${n} (total: ${collected.size})`);
    }

    // Restore view
    if (clickedFilter) {
      for (const btn of buttons) {
        const icon = btn.querySelector('i.google-symbols, i.material-icons');
        const iconText = icon ? (icon.textContent || '').trim().toLowerCase() : '';
        if (iconText === 'dashboard') {
          btn.click();
          await sleep(800);
          break;
        }
      }
    }
    if (scrollContainer) scrollContainer.scrollTop = saved;
    else window.scrollTo({ top: saved, behavior: 'instant' });
    await sleep(300);

    console.log(`📹 Scroll: found ${collected.size} unique videos`);
    return collected;
  }

  // ── MAIN: Collect ALL videos using both methods ──
  async function scrollToCollectAllVideos() {
    const collected = new Map(); // url → { url, element }

    // ═══ Method 1: Scroll-based (confirmed video URLs from <video> tags) ═══
    const scrollResults = await scrollCollectVideos();
    for (const [url, entry] of scrollResults) {
      collected.set(url, entry);
    }
    console.log(`📹 After scroll: ${collected.size} confirmed video URLs`);

    // ═══ Method 2: React fiber extraction (supplementary) ═══
    // Only add URLs NOT already found AND not used as <img> src
    const imgSrcs = new Set();
    document.querySelectorAll('img').forEach(img => {
      const s = img.currentSrc || img.src || '';
      if (s) imgSrcs.add(s);
    });

    const reactUrls = extractVideoUrlsFromReact();
    let reactAdded = 0;
    for (const url of reactUrls) {
      if (!collected.has(url) && !imgSrcs.has(url)) {
        collected.set(url, { url, element: null });
        reactAdded++;
      }
    }
    if (reactAdded > 0) {
      console.log(`📹 React added ${reactAdded} extra URLs (total: ${collected.size})`);
    }

    console.log(`📹 TOTAL: ${collected.size} unique videos found`);
    return [...collected.values()];
  }

  async function scanPageVideos() {
    updateStatus('────────────────────');
    updateStatus(`🔍 Escaneando TODA a página (com scroll)...`);

    const videoEntries = await scrollToCollectAllVideos();

    if (videoEntries.length === 0) {
      updateStatus('⚠️ Nenhum <video> encontrado na página.');
      return;
    }

    updateStatus(`📹 ${videoEntries.length} vídeo(s) encontrado(s):`);

    videoEntries.forEach((entry, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      const url = entry.url;

      let srcType = 'sem src';
      if (url.startsWith('blob:')) srcType = 'blob';
      else if (url.startsWith('http')) srcType = 'HTTP';

      const dims = (entry.width && entry.height) ? `${entry.width}x${entry.height}` : '?';
      const dur = entry.duration ? entry.duration.toFixed(1) : '?';
      updateStatus(`  [${num}] ${srcType} | ${dims} | ${dur}s`);
      if (url) {
        console.log(`  [${num}] URL: ${url.substring(0, 120)}`);
      }
    });

    updateStatus('────────────────────');

    // Update video count badge in panel
    const countBadge = document.getElementById('veo3-video-count-badge');
    if (countBadge) {
      countBadge.textContent = `📹 ${videoEntries.length} vídeo(s)`;
      countBadge.style.color = 'white';
      countBadge.style.background = 'rgba(0, 188, 212, 0.3)';
    }

    // Update bubble badge with video count
    const badge = document.getElementById('veo3-badge');
    if (badge && !state.isRunning) {
      badge.style.display = 'flex';
      badge.textContent = `📹${videoEntries.length}`;
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

  // Resolve a tRPC getMediaUrlRedirect URL → extract the actual GCS signed URL from JSON response
  async function resolveMediaRedirectUrl(url) {
    if (!url || !url.includes('getMediaUrlRedirect')) return url;

    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) {
        console.warn(`⚠️ resolveMediaRedirect: HTTP ${response.status}`);
        return url;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        // Not JSON — might be an actual redirect that fetch followed
        console.log(`📹 resolveMediaRedirect: not JSON (${contentType}), using response directly`);
        return response.url || url; // response.url = final URL after redirects
      }

      const json = await response.json();

      // tRPC response structures: { result: { data: { json: URL } } } or { result: { data: URL } }
      let directUrl = null;

      // Try common tRPC response shapes
      if (json?.result?.data?.json) {
        directUrl = typeof json.result.data.json === 'string' ? json.result.data.json : null;
      }
      if (!directUrl && json?.result?.data) {
        directUrl = typeof json.result.data === 'string' ? json.result.data : null;
      }
      if (!directUrl && typeof json?.result === 'string') {
        directUrl = json.result;
      }

      // Deep search for URL strings containing storage.googleapis.com or .mp4
      if (!directUrl) {
        const jsonStr = JSON.stringify(json);
        const urlMatch = jsonStr.match(/https?:\/\/storage\.googleapis\.com\/[^"\\]+/);
        if (urlMatch) directUrl = urlMatch[0];
      }
      if (!directUrl) {
        const jsonStr = JSON.stringify(json);
        const urlMatch = jsonStr.match(/https?:\/\/[^"\\]*\.mp4[^"\\]*/);
        if (urlMatch) directUrl = urlMatch[0];
      }
      // Also look for any long https URL that looks like a signed URL
      if (!directUrl) {
        const jsonStr = JSON.stringify(json);
        const urlMatch = jsonStr.match(/https?:\/\/[^"\\]{50,}/);
        if (urlMatch) directUrl = urlMatch[0];
      }

      if (directUrl) {
        console.log(`✅ resolveMediaRedirect: extracted direct URL: ${directUrl.substring(0, 100)}`);
        return directUrl;
      }

      console.warn(`⚠️ resolveMediaRedirect: could not extract URL from JSON`, json);
      return url;
    } catch (err) {
      console.warn(`⚠️ resolveMediaRedirect failed: ${err.message}`);
      return url;
    }
  }

  // Fetch video data as a Blob — resolves tRPC URLs first, then fetches actual video
  async function fetchVideoBlob(url) {
    if (!url) return null;
    if (!url.startsWith('http') && !url.startsWith('blob:')) return null;

    try {
      // Step 1: Resolve tRPC redirect URLs to actual video URLs
      let fetchUrl = url;
      if (url.includes('getMediaUrlRedirect')) {
        fetchUrl = await resolveMediaRedirectUrl(url);
        console.log(`📹 fetchVideoBlob: resolved URL: ${fetchUrl.substring(0, 100)}`);
      }

      // Step 2: Fetch the actual video content
      const response = await fetch(fetchUrl, { credentials: 'same-origin' });

      if (!response.ok) {
        console.warn(`⚠️ fetchVideoBlob: HTTP ${response.status}`);
        return null;
      }

      // Validate content type — skip if we got JSON/HTML instead of video
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('json') || contentType.includes('html') || contentType.includes('text/plain')) {
        console.warn(`⚠️ fetchVideoBlob: got "${contentType}" instead of video — skipping`);
        return null;
      }

      const blob = await response.blob();

      // Validate size — video should be at least 100KB
      if (blob.size < 100000) {
        console.warn(`⚠️ fetchVideoBlob: too small (${(blob.size / 1024).toFixed(0)}KB) — not a video`);
        return null;
      }

      console.log(`✅ fetchVideoBlob: ${(blob.size / 1024 / 1024).toFixed(1)}MB (${contentType || 'unknown type'})`);
      return blob;
    } catch (err) {
      console.warn(`⚠️ fetchVideoBlob failed: ${err.message}`);
      return null;
    }
  }

  // Fallback download: <a download> with resolved URL (browser handles redirect/CORS natively)
  function downloadViaAnchor(url, filename) {
    console.log(`📥 downloadViaAnchor: ${url.substring(0, 80)} → ${filename}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 2000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIDEO DOWNLOAD VIA NATIVE "Baixar" BUTTON (→ 720p)
  // Each video card has a direct "downloadBaixar" button (icon="download").
  // Clicking it opens a quality submenu: 270p, 720p, 1080p, 4K.
  // We scroll through, click each "Baixar" → select "720p".
  // Downloads go to the browser's default download folder.
  // ═══════════════════════════════════════════════════════════════════

  // Icon selector that covers all Google icon font variants
  const ICON_SELECTOR = 'i.google-symbols, i.material-icons, i.material-symbols-outlined, ' +
    'span.google-symbols, span.material-icons, span.material-symbols-outlined, ' +
    '.google-symbols, .material-icons, .material-symbols-outlined, mat-icon';

  // Find all visible "Baixar" (download) buttons on video cards
  function findBaixarButtons() {
    const results = [];
    const allBtns = document.querySelectorAll('button, [role="button"]');

    for (const btn of allBtns) {
      if (btn.closest('#veo3-panel, #veo3-bubble')) continue;
      if (btn.offsetParent === null) continue;

      const icon = btn.querySelector(ICON_SELECTOR);
      const iconText = icon ? (icon.textContent || '').trim() : '';
      const btnText = (btn.textContent || '').trim();

      // Match: icon="download" AND text contains "Baixar" or "Download"
      if (iconText === 'download' && (btnText.includes('Baixar') || btnText.includes('Download'))) {
        // Skip header-level buttons (y < 50)
        const rect = btn.getBoundingClientRect();
        if (rect.top < 50 && rect.top > -50) continue; // header area
        results.push(btn);
      }
    }

    return results;
  }

  // Dismiss any open menus/popups
  async function dismissMenus() {
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true
    }));
    await sleep(400);
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true
    }));
    await sleep(400);
  }

  // Click a button via React onClick (walk up fiber tree) + DOM fallbacks
  // skipReact: true → use only DOM events (for buttons like "Baixar" where
  //   React onClick triggers an immediate zip download, bypassing the quality submenu)
  async function clickButtonReliably(btn, { skipReact = false } = {}) {
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const evtOpts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: cx, clientY: cy, detail: 1 };

    // Strategy A: React onClick from __reactProps$ (skipped if skipReact=true)
    if (!skipReact) {
      let el = btn;
      for (let i = 0; i < 6 && el; i++) {
        const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
        if (propsKey) {
          const props = el[propsKey];
          if (typeof props.onClick === 'function') {
            console.log(`📹 clickButtonReliably: React onClick on <${el.tagName}>`);
            props.onClick({
              type: 'click', target: btn, currentTarget: el,
              clientX: cx, clientY: cy, pageX: cx, pageY: cy,
              preventDefault: () => {}, stopPropagation: () => {},
              nativeEvent: new MouseEvent('click', evtOpts)
            });
            return true;
          }
        }
        el = el.parentElement;
      }
    }

    // Strategy B: Full pointer + mouse lifecycle with coordinates
    console.log(`📹 clickButtonReliably: DOM events on <${btn.tagName}> at (${Math.round(cx)},${Math.round(cy)})${skipReact ? ' [skipReact]' : ''}`);
    btn.focus();
    await sleep(50);
    btn.dispatchEvent(new PointerEvent('pointerover', { ...evtOpts, pointerType: 'mouse' }));
    btn.dispatchEvent(new MouseEvent('mouseover', evtOpts));
    await sleep(50);
    btn.dispatchEvent(new PointerEvent('pointerenter', { ...evtOpts, pointerType: 'mouse', bubbles: false }));
    btn.dispatchEvent(new MouseEvent('mouseenter', { ...evtOpts, bubbles: false }));
    await sleep(100);
    btn.dispatchEvent(new PointerEvent('pointerdown', { ...evtOpts, pointerType: 'mouse' }));
    await sleep(40);
    btn.dispatchEvent(new MouseEvent('mousedown', evtOpts));
    await sleep(40);
    btn.dispatchEvent(new PointerEvent('pointerup', { ...evtOpts, pointerType: 'mouse' }));
    await sleep(40);
    btn.dispatchEvent(new MouseEvent('mouseup', evtOpts));
    await sleep(40);
    btn.dispatchEvent(new MouseEvent('click', evtOpts));

    // Strategy C: native .click()
    await sleep(100);
    btn.click();

    // Strategy D: Enter key (some buttons respond to keyboard)
    await sleep(100);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    btn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    return false;
  }

  // Find a visible element by text content (for quality submenu items)
  function findVisibleElementByText(targetTexts) {
    // Strategy 1: Use existing TreeWalker-based findQualityOption
    for (const target of targetTexts) {
      const found = findQualityOption(target);
      if (found) return found;
    }

    // Strategy 2: role-based elements
    const roleItems = document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"], [role="button"]');
    for (const item of roleItems) {
      if (item.closest('#veo3-panel, #veo3-bubble')) continue;
      if (item.offsetParent === null) continue;
      const text = (item.textContent || '').trim();
      for (const target of targetTexts) {
        if (text.includes(target)) return item;
      }
    }

    // Strategy 3: Broad search for leaf elements with short text
    const allEls = document.querySelectorAll('button, a, li, div, span');
    for (const el of allEls) {
      if (el.closest('#veo3-panel, #veo3-bubble')) continue;
      if (el.offsetParent === null) continue;
      if (el.children.length > 4) continue; // skip large containers
      const text = (el.textContent || '').trim();
      if (text.length > 50) continue; // skip long text blocks
      for (const target of targetTexts) {
        if (text.includes(target)) return el;
      }
    }

    return null;
  }

  // Count new elements that appeared after an action (menus, popups, etc.)
  function countNewVisibleElements() {
    let count = 0;
    const candidates = document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [role="menuitem"], [role="option"]');
    for (const el of candidates) {
      if (el.closest('#veo3-panel, #veo3-bubble')) continue;
      if (el.offsetParent !== null) count++;
    }
    return count;
  }

  // Download ONE video: click "Baixar" button → quality submenu → 720p
  async function downloadOneVideo(baixarBtn, index) {
    const num = String(index).padStart(3, '0');

    // 1. Scroll the button into view
    baixarBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(700);

    // Snapshot visible menus before clicking
    const menusBefore = countNewVisibleElements();

    // 2. Click "Baixar" using ONLY native DOM events (skipReact=true)
    //    React onClick triggers immediate zip download — we want the quality submenu
    console.log(`📹 [${num}] Clicking "Baixar" (native)... menus before: ${menusBefore}`);
    await clickButtonReliably(baixarBtn, { skipReact: true });
    await sleep(2000);

    // Check if a menu/popup appeared
    const menusAfter = countNewVisibleElements();
    console.log(`📹 [${num}] Menus after click: ${menusAfter} (was ${menusBefore})`);

    // 3. Find "720p" in the quality submenu
    let quality720 = findVisibleElementByText(['720p', '720']);

    if (!quality720) {
      // Retry: try pointer events with hover first, then click
      console.log(`📹 [${num}] 720p not found, retrying with hover+click...`);
      await dismissMenus();
      await sleep(500);

      // Hover over the button first
      const rect = baixarBtn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      baixarBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: cx, clientY: cy }));
      baixarBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
      await sleep(800);

      // Click again
      await clickButtonReliably(baixarBtn, { skipReact: true });
      await sleep(2500);
      quality720 = findVisibleElementByText(['720p', '720']);
    }

    if (!quality720) {
      // Last resort: try React onClick (might download a zip, but at least it downloads)
      console.log(`📹 [${num}] 720p still not found — trying React onClick fallback...`);
      await dismissMenus();
      await sleep(500);
      await clickButtonReliably(baixarBtn, { skipReact: false });
      await sleep(2000);
      quality720 = findVisibleElementByText(['720p', '720']);
    }

    if (!quality720) {
      // Log what IS visible for debugging
      const visibleItems = document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"]');
      const visibleTexts = [];
      for (const item of visibleItems) {
        if (item.offsetParent !== null) {
          visibleTexts.push((item.textContent || '').trim().substring(0, 50));
        }
      }
      console.warn(`📹 [${num}] 720p NOT FOUND. Visible menu items: [${visibleTexts.join(', ')}]`);

      // Also search for ANY quality-related text (270p, 480p, 720p, 1080p, 4K)
      const anyQuality = findVisibleElementByText(['270p', '480p', '720p', '1080p', '4K', '4k']);
      if (anyQuality) {
        console.log(`📹 [${num}] Found other quality: "${(anyQuality.textContent || '').trim()}" — clicking it`);
        await clickButtonReliably(anyQuality);
        await sleep(2500);
        await dismissMenus();
        updateStatus(`  [${num}] ✅ Download iniciado (qualidade disponível)`);
        return true;
      }

      await dismissMenus();
      console.warn(`📹 [${num}] No quality options found — download may have started as zip`);
      updateStatus(`  [${num}] ⚠️ Download iniciado (sem seleção de qualidade)`);
      return true; // A download probably happened (zip)
    }

    // 4. Click "720p"
    console.log(`📹 [${num}] Clicking "720p": <${quality720.tagName}> "${(quality720.textContent || '').trim().substring(0, 40)}"`);
    await clickButtonReliably(quality720);
    await sleep(2500);

    // 5. Dismiss any remaining menus/popups
    await dismissMenus();

    updateStatus(`  [${num}] ✅ Download 720p iniciado`);
    return true;
  }

  // ═══ Main video download function — scroll bottom→top + click "Baixar" → 720p ═══
  async function downloadPageVideos() {
    const dlPageBtn = document.getElementById('veo3-dl-page-btn');

    updateStatus('────────────────────');
    updateStatus('📹 Download de vídeos (Baixar → 720p)');
    updateStatus('📂 Arquivos vão para a pasta de Downloads do navegador');

    // Disable button during download
    if (dlPageBtn) {
      dlPageBtn.disabled = true;
      dlPageBtn.style.opacity = '0.5';
    }

    // ── STEP 1: Click "View videos" filter to show only videos ──
    let clickedFilter = false;
    const allPageBtns = document.querySelectorAll('button');
    for (const btn of allPageBtns) {
      const icon = btn.querySelector(ICON_SELECTOR);
      const iconText = icon ? (icon.textContent || '').trim().toLowerCase() : '';
      const btnText = (btn.textContent || '').toLowerCase();
      if (iconText === 'videocam' && (btnText.includes('video') || btnText.includes('vídeo'))) {
        console.log('📹 Clicking "View videos" filter...');
        btn.click();
        clickedFilter = true;
        await sleep(1500);
        break;
      }
    }

    // ── STEP 2: Find scrollable container ──
    let scrollContainer = null;
    const divs = document.querySelectorAll('div, main, section');
    for (const el of divs) {
      if (el.closest('#veo3-panel, #veo3-bubble')) continue;
      const style = getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300) {
        if (!scrollContainer || el.scrollHeight > scrollContainer.scrollHeight) {
          scrollContainer = el;
        }
      }
    }

    const scrollTarget = scrollContainer || document.documentElement;
    const savedScroll = scrollContainer ? scrollContainer.scrollTop : window.scrollY;

    // ── STEP 3: Scroll bottom→top (prompt order: oldest first) ──
    const processedSlots = new Set();
    let downloaded = 0;
    let failed = 0;
    let videoIndex = 0;

    const scrollStep = 350;
    const scrollWait = 1200;

    // Go to bottom first (oldest/first prompt is at the bottom)
    const maxHeight = scrollTarget.scrollHeight;
    scrollTarget.scrollTop = maxHeight;
    if (!scrollContainer) window.scrollTo({ top: maxHeight, behavior: 'instant' });
    await sleep(1500);

    // Recalculate maxHeight after scrolling (virtual scroll may update DOM)
    const finalMaxHeight = scrollTarget.scrollHeight;

    updateStatus('🔍 Escaneando vídeos (do primeiro ao último)...');

    // Process visible "Baixar" buttons at current scroll position
    async function processVisibleBaixar(scrollPos) {
      const baixarBtns = findBaixarButtons();
      for (const btn of baixarBtns) {
        const rect = btn.getBoundingClientRect();
        // Must be roughly in viewport
        if (rect.bottom < -100 || rect.top > window.innerHeight + 100) continue;
        if (rect.width === 0 || rect.height === 0) continue;

        // Dedup by approximate Y position in the full page (cards ~416px apart)
        const yInPage = Math.round((rect.top + scrollPos) / 200);
        if (processedSlots.has(yInPage)) continue;
        processedSlots.add(yInPage);
        processedSlots.add(yInPage - 1);
        processedSlots.add(yInPage + 1);

        videoIndex++;
        const num = String(videoIndex).padStart(3, '0');
        updateStatus(`  [${num}] 📹 Baixando...`);

        try {
          const ok = await downloadOneVideo(btn, videoIndex);
          if (ok) downloaded++;
          else failed++;
        } catch (err) {
          console.error(`📹 [${num}] Error:`, err);
          updateStatus(`  [${num}] ❌ Erro: ${err.message}`);
          failed++;
          await dismissMenus();
        }

        // Wait between downloads
        await sleep(2000);

        // Re-scroll (clicking/menus may have shifted the page)
        scrollTarget.scrollTop = scrollPos;
        if (!scrollContainer) window.scrollTo({ top: scrollPos, behavior: 'instant' });
        await sleep(500);
      }
    }

    // Single pass: bottom → top (oldest to newest = prompt order)
    for (let pos = finalMaxHeight; pos >= 0; pos -= scrollStep) {
      scrollTarget.scrollTop = pos;
      if (!scrollContainer) window.scrollTo({ top: pos, behavior: 'instant' });
      await sleep(scrollWait);
      await processVisibleBaixar(pos);
    }

    // Extra pass: scroll back down slowly to catch any missed (virtual scrolling gaps)
    const beforePass2 = videoIndex;
    console.log(`📹 Pass 1 done: ${videoIndex} videos. Checking for missed...`);
    for (let pos = 0; pos <= finalMaxHeight; pos += scrollStep) {
      scrollTarget.scrollTop = pos;
      if (!scrollContainer) window.scrollTo({ top: pos, behavior: 'instant' });
      await sleep(scrollWait);
      await processVisibleBaixar(pos);
    }
    if (videoIndex > beforePass2) {
      console.log(`📹 Pass 2 found ${videoIndex - beforePass2} additional videos`);
    }

    // ── STEP 4: Restore view ──
    if (clickedFilter) {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const icon = btn.querySelector(ICON_SELECTOR);
        const iconText = icon ? (icon.textContent || '').trim().toLowerCase() : '';
        if (iconText === 'dashboard') {
          btn.click();
          await sleep(800);
          break;
        }
      }
    }
    if (scrollContainer) scrollContainer.scrollTop = savedScroll;
    else window.scrollTo({ top: savedScroll, behavior: 'instant' });

    // ── STEP 5: Report results ──
    updateStatus('────────────────────');
    updateStatus(`📥 Resultado: ${downloaded} baixados | ${failed} falharam | ${videoIndex} encontrados`);
    if (downloaded > 0) {
      updateStatus(`📂 Arquivos na pasta de Downloads do navegador`);
    }

    // Re-enable button
    if (dlPageBtn) {
      dlPageBtn.disabled = false;
      dlPageBtn.style.opacity = '1';
    }
  }

  // Scroll through the entire page to collect ALL large image URLs
  // VEO3 uses virtual scrolling — only ~5 items are rendered at a time
  // Tries multiple scroll strategies to find the actual scrollable container
  async function scrollToCollectAllImages() {
    const collected = new Map(); // src → { src, alt } (deduped by src)

    // Helper: collect all large images currently in DOM
    function collectVisibleImages() {
      const imgs = document.querySelectorAll('img');
      let newCount = 0;
      for (const img of imgs) {
        if (img.closest('#veo3-panel, #veo3-bubble')) continue;
        if (!img.src || img.src.startsWith('data:')) continue;
        const w = img.naturalWidth || img.width || img.getBoundingClientRect().width;
        const h = img.naturalHeight || img.height || img.getBoundingClientRect().height;
        if (w > 150 && h > 150 && !collected.has(img.src)) {
          collected.set(img.src, { src: img.src, alt: img.alt || '' });
          newCount++;
        }
      }
      return newCount;
    }

    // Find VEO3's actual scrollable container (brute-force approach)
    // VEO3 uses styled-components with sc-* classes, so we check ALL elements
    let scrollContainer = null;
    const allElements = document.querySelectorAll('div, main, section');
    for (const el of allElements) {
      if (el.closest('#veo3-panel, #veo3-bubble')) continue;
      const style = getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 200 &&
        el.clientHeight > 300) {
        // Prefer the largest scrollable container
        if (!scrollContainer || el.scrollHeight > scrollContainer.scrollHeight) {
          scrollContainer = el;
        }
      }
    }

    if (scrollContainer) {
      console.log(`📜 scrollToCollectAllImages: found scrollable container ${scrollContainer.tagName}.${(scrollContainer.className || '').toString().substring(0, 30)} scrollHeight=${scrollContainer.scrollHeight} clientHeight=${scrollContainer.clientHeight}`);
    } else {
      console.log(`📜 scrollToCollectAllImages: no inner scrollable found, using document`);
    }

    // Save current scroll positions
    const savedContainerScroll = scrollContainer ? scrollContainer.scrollTop : 0;
    const savedWindowScroll = window.scrollY;

    // Collect initial images
    collectVisibleImages();

    // Try scrolling the container (or window)
    const target = scrollContainer || document.documentElement;
    const maxHeight = target.scrollHeight;
    const scrollStep = 300;
    const viewportHeight = target.clientHeight || window.innerHeight;

    // Scroll to top first
    target.scrollTop = 0;
    if (!scrollContainer) window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(400);
    collectVisibleImages();

    console.log(`📜 scrollToCollectAllImages: scrolling ${maxHeight}px in ${scrollStep}px steps...`);

    // Scroll down in increments, collecting images at each position
    let prevCount = collected.size;
    let noNewImagesCount = 0;

    for (let pos = 0; pos <= maxHeight; pos += scrollStep) {
      target.scrollTop = pos;
      if (!scrollContainer) window.scrollTo({ top: pos, behavior: 'instant' });
      await sleep(250);

      const newFound = collectVisibleImages();
      if (newFound > 0) {
        noNewImagesCount = 0;
        console.log(`📜 pos=${pos}: +${newFound} images (total: ${collected.size})`);
      } else {
        noNewImagesCount++;
      }

      // If we haven't found new images in 10 consecutive steps AND we're past the first screen, stop
      if (noNewImagesCount > 15 && pos > viewportHeight * 2) break;
    }

    // Restore scroll positions
    if (scrollContainer) {
      scrollContainer.scrollTop = savedContainerScroll;
    }
    window.scrollTo({ top: savedWindowScroll, behavior: 'instant' });
    await sleep(300);

    console.log(`📜 scrollToCollectAllImages: found ${collected.size} unique images total`);
    return [...collected.values()];
  }

  // ── Download all generated images from the page ──
  async function downloadPageImages() {
    const dlImagesBtn = document.getElementById('veo3-dl-images-btn');

    // Get folder name
    const folderInput = document.getElementById('veo3-folder-name');
    const rawFolderName = (folderInput?.value || '').trim();
    const folderName = rawFolderName.replace(/[<>:"/\\|?*]/g, '').trim();

    // ── STEP 1: Ask for folder FIRST (while user click gesture is fresh!) ──
    // showDirectoryPicker requires recent user activation — expires after ~5s
    let dirHandle = null;
    if (window.showDirectoryPicker) {
      try {
        if (folderName) {
          updateStatus(`📂 Selecione onde criar a pasta "${folderName}"...`);
        } else {
          updateStatus(`📂 Selecione a pasta para salvar as imagens...`);
        }
        const parentDir = await window.showDirectoryPicker({ mode: 'readwrite' });
        if (folderName) {
          dirHandle = await parentDir.getDirectoryHandle(folderName, { create: true });
        } else {
          dirHandle = parentDir;
        }
        updateStatus(`📂 Pasta selecionada! Escaneando imagens...`);
      } catch (err) {
        if (err.name === 'AbortError') {
          updateStatus('⚠️ Seleção de pasta cancelada.');
          return;
        }
        console.warn(`⚠️ File System API failed: ${err.message}. Falling back to downloads.`);
        dirHandle = null;
      }
    }

    // Disable button during download
    if (dlImagesBtn) {
      dlImagesBtn.disabled = true;
      dlImagesBtn.style.opacity = '0.5';
    }

    // ── STEP 2: Scroll to collect ALL images (virtual scrolling bypass) ──
    updateStatus('🔍 Escaneando página (scroll) para encontrar todas as imagens...');
    const collectedImages = await scrollToCollectAllImages();

    // Also check currently visible images (in case scroll missed any)
    const allImgs = document.querySelectorAll('img');
    for (const img of allImgs) {
      if (img.closest('#veo3-panel, #veo3-bubble')) continue;
      if (img.offsetParent === null) continue;
      if (!img.src || img.src.startsWith('data:')) continue;
      const w = img.naturalWidth || img.width || img.getBoundingClientRect().width;
      const h = img.naturalHeight || img.height || img.getBoundingClientRect().height;
      if (w > 150 && h > 150) {
        const exists = collectedImages.some(ci => ci.src === img.src);
        if (!exists) {
          collectedImages.push({ src: img.src, alt: img.alt || '' });
        }
      }
    }

    const images = collectedImages;

    updateStatus('────────────────────');

    if (images.length === 0) {
      updateStatus('⚠️ Nenhuma imagem grande encontrada na página.');
      if (dlImagesBtn) { dlImagesBtn.disabled = false; dlImagesBtn.style.opacity = '1'; }
      return;
    }

    // ── STEP 3: Download/save all images ──
    const useFolder = !!dirHandle;
    const filePrefix = (!useFolder && folderName) ? `${folderName}-` : (!useFolder ? 'veo3-img-' : '');

    if (useFolder) {
      updateStatus(`📂 Salvando ${images.length} imagens na pasta...`);
    } else {
      updateStatus(`📥 Baixando ${images.length} imagens...`);
    }

    let downloaded = 0;
    let failed = 0;

    // VEO3 shows newest images first in DOM — reverse to download in prompt order
    images.reverse();

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const num = String(i + 1).padStart(3, '0');
      const url = img.src;

      try {
        updateStatus(`  [${num}] ⬇️ Baixando imagem...`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();

        // Detect extension from blob type
        const typeMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
        const ext = typeMap[blob.type] || '.png';
        const filename = useFolder ? `${num}${ext}` : `${filePrefix}${num}${ext}`;

        if (useFolder) {
          await saveToFolder(dirHandle, filename, blob);
          updateStatus(`  [${num}] ✅ ${folderName}/${filename}`);
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
        }
        downloaded++;
      } catch (err) {
        updateStatus(`  [${num}] ❌ Erro: ${err.message}`);
        failed++;
      }

      // Delay between downloads
      if (i < images.length - 1) {
        await sleep(500);
      }
    }

    updateStatus('────────────────────');
    updateStatus(`🖼️ Resultado: ${downloaded} baixadas | ${failed} falharam`);
    if (downloaded > 0) {
      if (useFolder) {
        updateStatus(`📂 Arquivos em: ${folderName}/001.png, 002.png, etc`);
      } else {
        updateStatus(`📂 Arquivos: ${filePrefix}001.png, etc`);
      }
    }

    // Re-enable button
    if (dlImagesBtn) {
      dlImagesBtn.disabled = false;
      dlImagesBtn.style.opacity = '1';
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

          // Image/character selection ONLY runs when the toggle is enabled.
          // When disabled, directives are silently stripped and the clean prompt is sent normally.
          const shouldSelectImages = state.includeImagesEnabled;

          // Unified clear: clear attached images ONCE before any selection (CHARS or IMGS)
          if (shouldSelectImages && (characters.length > 0 || imageKeywords.length > 0)) {
            await clearAttachedImages();
          }

          if (shouldSelectImages && characters.length > 0) {
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

          if (shouldSelectImages && imageKeywords.length > 0) {
            // [IMGS: ...] — select images by keyword/index via resource panel
            // skipClear=true because we already cleared above (preserves CHARS selections)
            try {
              updateStatus(`[${paddedNum}] 🖼️ Selecionando imagens [IMGS: ${imageKeywords.join(', ')}]...`);
              const imgResult = await selectImagesByKeywords(imageKeywords, /* skipClear */ true);
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
          } else if (shouldSelectImages && characters.length === 0) {
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
    console.log('🔍 VEO3 Batch Automator v1.7.0 — Diagnostics');
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
    console.log('🎬 VEO3 Batch Automator v1.7.0');
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
