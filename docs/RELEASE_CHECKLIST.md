# ✅ Release Checklist - VEO3 Batch Automator v0.9.0

Use esta checklist antes de publicar a versão pública.

---

## Code Quality

- [x] Script testado em Chrome, Firefox, Safari
- [x] Sem erros no console (F12 → Console)
- [x] Header do script correto (name, version, match, description)
- [x] Version bump atualizado para 0.9.0
- [x] Sem console.error() não tratados
- [x] Sem hardcoded debug logs
- [x] Código usa strict mode ('use strict')

---

## Features (Phase 1 + Phase 2)

- [x] **PHASE 1:** Enviar Todos — injeta prompts rapidamente
- [x] **PHASE 1:** Sem downloads automáticos (só gera)
- [x] **PHASE 1:** Rastreia vídeos com data-attribute
- [x] **PHASE 2:** Botão "Baixar Todos" aparece quando vídeos prontos
- [x] **PHASE 2:** Download funciona para todos os vídeos
- [x] **UI:** Painel roxa com 2 botões (Enviar + Baixar)
- [x] **UI:** Pause/Resume em ambas as fases
- [x] **UI:** Status log atualiza em tempo real
- [x] **State:** Tracking de `phase`, `completedVideos[]`

---

## Browser Compatibility

- [x] Chrome (latest)
- [x] Firefox (latest)
- [x] Safari (latest)
- [x] Edge (latest)
- [x] Opera (optional)

**Test checklist:**
- [x] Bolinha roxa aparece
- [x] Painel abre/fecha
- [x] Botões funcionam
- [x] Status log mostra texto
- [x] Downloads vão para a pasta Downloads/

---

## Resilience & Edge Cases

- [x] Script sobrevive a UI changes (múltiplos seletores)
- [x] Detecção de vídeo element funciona
- [x] Material Design icons detectados corretamente
- [x] Hover+Click sequence é human-like
- [x] Pause durante Phase 1 permite continuar depois
- [x] Pause durante Phase 2 funciona
- [x] Stop em qualquer fase limpa o estado
- [x] Partial completion ativava o botão download

---

## Documentation

- [x] `README.md` — Overview atualizado para v0.9.0
- [x] `INSTALL_GUIDE.md` — Instruções step-by-step
- [x] `COMPATIBILITY.md` — Explicação de resiliência
- [x] `DISTRIBUTION.md` — Como compartilhar
- [x] `DEBUG.md` — Troubleshooting (existente)
- [x] `CHANGELOG.md` — Histórico de versões (existente)
- [x] Todos os docs têm "Última atualização: 2026-02-06"

---

## Distribution Preparation

### GitHub Gist
- [ ] Conta GitHub criada/pronta
- [ ] Script copiado para novo Gist
- [ ] Gist marcado como "Public"
- [ ] Link Raw copiado
- [ ] Testado: clicar no link abre instalação Tampermonkey

### GitHub Repository (Opcional)
- [ ] Repositório criado: `seu-usuario/veo3-batch-automator`
- [ ] Todos os arquivos (.js, .md) commitados
- [ ] Tag criada: `git tag v0.9.0`
- [ ] Release criada com notes
- [ ] Raw URL testado

### Greasy Fork (Opcional)
- [ ] Conta Greasy Fork criada
- [ ] Script submetido com:
  - [x] Name: "Veo3 Prompt Batch Automator"
  - [x] Description: "Automate batch video generation in Google VEO3 Flow"
  - [x] Namespace: "https://synkra.io/"
  - [x] License: "MIT"
- [ ] Descrição clara e exemplos
- [ ] Screenshot/GIF mostrando uso

---

## Testing Scenarios

### Scenario 1: Fresh Install
- [ ] User instala Tampermonkey
- [ ] Clica no link de instalação
- [ ] Script aparece em Tampermonkey Dashboard
- [ ] Vai para VEO3 → bolinha roxa aparece
- [ ] Painel abre → consegue colar prompts

### Scenario 2: Phase 1 (Send All)
- [ ] Cola 3 prompts
- [ ] Clica "Enviar Todos"
- [ ] Status mostra enviando
- [ ] Vídeos começam a aparecer
- [ ] Painel mostra "Gerados: 1/3", "Gerados: 2/3", etc.

### Scenario 3: Phase 2 (Download All)
- [ ] Botão "Baixar Todos" ativa após Phase 1
- [ ] Clica "Baixar 3 vídeos"
- [ ] Status mostra "Baixando: 1/3", etc.
- [ ] Vídeos caem na pasta Downloads/
- [ ] Filenames: veo3-batch-001.mp4, etc.

### Scenario 4: Pause/Resume
- [ ] Durante Phase 1, clica "Pausar"
- [ ] Status mostra "⏸ Pausado"
- [ ] Clica "Retomar"
- [ ] Continua de onde parou
- [ ] Funciona também em Phase 2

### Scenario 5: Stop
- [ ] Durante Phase 1, clica "Parar"
- [ ] Batch cancela imediatamente
- [ ] Botão download ativa se alguns vídeos foram gerados
- [ ] Consegue fazer novo batch depois

---

## Marketing/Announcement

### Prepare Template
- [ ] Announcement text escrito
- [ ] Features bullet points preparados
- [ ] Installation link pronta
- [ ] Screenshots/GIF de demo (opcional)

### Share Locations
- [ ] GitHub (commit + push)
- [ ] Gist (publicado)
- [ ] Communities (Reddit, Discord, Hacker News, etc.)
- [ ] Email/Newsletter (se aplicável)
- [ ] Social Media (Twitter/X, LinkedIn, etc.)

---

## Post-Release

### First Week
- [ ] Monitor issues/bug reports
- [ ] Respond to user questions
- [ ] Fix any critical bugs
- [ ] Publish patch if needed (v0.9.1)

### First Month
- [ ] Gather user feedback
- [ ] Update docs based on common questions
- [ ] Plan v0.10.0 features (if applicable)

---

## Final Checklist

**Before you share with the world:**

```
✅ Script v0.9.0 testado em 3+ navegadores
✅ README.md, INSTALL_GUIDE.md, COMPATIBILITY.md prontos
✅ DISTRIBUTION.md tem instruções claras
✅ Link de instalação (Gist ou GitHub) funciona
✅ Tampermonkey detecta atualizações corretamente (@version tag)
✅ Documentação tem sua informação de contato
✅ Licença clara (MIT)
✅ Video tutorial gravado (opcional)
```

---

## 🎉 Launch!

Quando tudo estiver checado:

```bash
# Se usando git:
git add .
git commit -m "release: VEO3 Batch Automator v0.9.0"
git tag v0.9.0
git push origin main --tags

# Share links:
📌 Gist: [seu-link-gist]
📌 Repo: [seu-repo-github]
📌 Install: [seu-install-link-tampermonkey]
```

---

**Status:** [ ] Ready for Launch 🚀
**Last Checked:** [data]
**Checked by:** [seu-nome]
