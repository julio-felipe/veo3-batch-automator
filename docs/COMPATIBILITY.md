# Compatibilidade & Resiliência - VEO3 Batch Automator

## Sim, funciona mesmo com atualizações do VEO3 Flow

Este script foi projetado para **sobreviver a atualizações** da interface do Google VEO3. Veja como:

---

## Estratégia de Resiliência #1: Seletores Múltiplos

### O Problema
Google atualiza a UI constantemente. Quando encontram um elemento, frequentemente mudam:
- Classes CSS (`class="mv-button-123"` → `class="button-new-456"`)
- IDs (`id="send-btn"` → `id="submit-action"`)
- Atributos (`aria-label="Enviar"` → `aria-label="Send message"`)

### A Solução
**Cada elemento procura por múltiplos seletores em cascata:**

```javascript
// Se o primeiro não funciona, tenta o segundo, depois o terceiro, etc.
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
    'button:has(i.google-symbols)',      // Ícone do Google Symbols
    'button[aria-haspopup="dialog"]',
    'i.google-symbols',
    'button[aria-label*="enviar"]',      // Labels em português
    'button[aria-label*="send"]',        // Labels em inglês
    'button[title*="enviar"]',
    'button[title*="Enviar"]',
    'button[type="submit"]'              // Fallback genérico
  ]
};
```

**Resultado:** Se Google muda a classe, o script tenta a próxima estratégia. Muito difícil quebrar.

---

## Estratégia de Resiliência #2: Busca Inteligente por Ícones

O Google usa **Google Material Symbols** (`i.google-symbols`) — um sistema de ícones que **raramente muda**.

### Detecção de Botão Enviar
```javascript
// Procura por TODOS os ícones da página
const allGoogleSymbolIcons = Array.from(document.querySelectorAll('i.google-symbols'));
for (const icon of allGoogleSymbolIcons) {
  const iconText = icon.textContent.trim().toLowerCase();
  // Procura especificamente por arrow_forward, send, ou arrow_upward
  if (iconText === 'arrow_forward' || iconText === 'send' || iconText === 'arrow_upward') {
    const btn = icon.closest('button');
    if (btn && btn.offsetParent !== null) { // Visível?
      return btn;
    }
  }
}
```

**Por quê funciona:** Os nomes dos ícones (`arrow_forward`, `download`, `send`) são parte da especificação Material Design e mudam muito raramente.

### Detecção de Botão Download
Mesma lógica, procura por `download`, `file_download`, ou `save_alt`.

---

## Estratégia de Resiliência #3: Monitoramento de Video Element

O script rastreia elementos `<video>` diretamente do DOM:

```javascript
// Antes da geração: conta quantos <video> existem
state.videoCountBeforeGen = document.querySelectorAll('video').length;

// Durante: se aparecer UM NOVO <video>, sabe que gerou!
const currentVideos = document.querySelectorAll('video');
if (currentVideos.length > state.videoCountBeforeGen) {
  // Video apareceu! Marca como alvo
  state.lastVideoElement = currentVideos[currentVideos.length - 1];
  // Download usa este elemento depois
}
```

**Por quê funciona:** O elemento `<video>` é HTML puro, não depende de classes CSS nem de UI específica.

---

## Estratégia de Resiliência #4: Visibilidade Verificada

Todos os cliques verificam se o elemento está **visível e no DOM**:

```javascript
if (btn.offsetParent !== null) {  // Visível?
  // Clica
}
```

Evita clicar em botões ocultos, herdados ou desativados.

---

## O que Muda com Atualizações (E Como Lidar)

| Mudança | Impacto | Como o Script Lida |
|---------|---------|-------------------|
| Classes CSS | Mínimo | Tenta próximo seletor |
| Placeholders | Baixo | Procura por substring com `*=` |
| Ícones Material | Nenhum | Usa nome do ícone (raramente muda) |
| Elemento `<video>` | Nenhum | Direto do DOM |
| Estrutura HTML principal | Alto | Pode quebrar (raro) |
| Google bloqueia automação | Alto | Script continua, precisa confirmação manual |

---

## Cenários Reais

### ✅ Funciona mesmo se:
- Google muda as cores, fontes, tamanho dos botões
- Classes CSS são renomeadas (`btn-send-123` → `button-xyz-456`)
- Layout da página muda (sidebar → topbar, etc.)
- Placeholders de texto mudam de "Crie um vídeo" para "Gerar vídeo"
- Adiciona novos elementos entre o input e o botão

### ⚠️ Pode quebrar se:
- Google remove completamente os ícones Material Symbols
- Muda o elemento `<video>` para `<canvas>` ou outra API
- Implementa detecção/bloqueio de automação (improvável)
- Muda arquitetura HTML radical (muito raro)

---

## Como Atualizar o Script Se Algo Quebrar

### Passo 1: Diagnosticar
```
F12 → Console → Script entra em "Diagnostics"
Mostra: "Input: ✅ | Send: ❌ | Download: ❌"
```

### Passo 2: Inspecionar
```
F12 → Inspector → Clica com botão direito no elemento
Vê a estrutura HTML atual
```

### Passo 3: Adicionar ao Script
```javascript
// Se o botão enviar mudou, adiciona novo seletor
const sendButton = [
  'button:has(i.google-symbols)',
  'button[aria-haspopup="dialog"]',
  // ... seletores existentes ...
  '[data-new-attribute="send"]'  // ← novo seletor adicionado
];
```

### Passo 4: Testar
Recarrega a página e testa manualmente.

---

## Histórico de Atualizações Conhecidas

| Data | Mudança | Impacto | Status |
|------|---------|---------|--------|
| v0.9.0 | Split Send/Download em 2 fases | Melhoria | ✅ |
| v0.8.2 | Adicionado detecção de video element | Resiliência | ✅ |
| v0.8.0 | Primeira versão com múltiplos seletores | Resiliência | ✅ |

---

## TL;DR

**O script SOBREVIVE a atualizações porque:**

1. ✅ Tenta 7+ seletores diferentes para cada elemento
2. ✅ Usa ícones Material (especificação estável)
3. ✅ Monitora `<video>` direto do DOM
4. ✅ Verifica visibilidade antes de clicar
5. ✅ Sem dependências externas (100% vanilla JS)

**Se algo quebrar:** Basta adicionar 1 seletor novo. Takes 5 minutes.

---

**Última atualização:** 2026-02-06
**Script:** VEO3 Batch Automator v0.9.0
