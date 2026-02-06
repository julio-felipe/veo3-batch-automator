# 📢 Guia de Distribuição - VEO3 Batch Automator

**Como compartilhar este script com qualquer pessoa.**

---

## Opção 1: GitHub Gist (Recomendado)

### Por quê?
- ✅ Link permanente e versionado
- ✅ Fácil de atualizar
- ✅ Tampermonkey detecta atualizações automaticamente
- ✅ Grátis

### Como fazer:

**Passo 1:** Vá para [gist.github.com](https://gist.github.com)

**Passo 2:** Cole o conteúdo de `veo3-batch-automator.user.js`

**Passo 3:** Preencha:
```
Filename: veo3-batch-automator.user.js
Description: VEO3 Batch Automator - Send All Videos Then Download All
```

**Passo 4:** Selecione "Public"

**Passo 5:** Clique "Create public gist"

**Passo 6:** Copie o link "Raw"
```
https://gist.githubusercontent.com/seu-usuario/ID/raw/veo3-batch-automator.user.js
```

**Pronto!** Compartilhe este link com qualquer pessoa.

---

## Opção 2: GitHub Repository

### Por quê?
- ✅ Controle de versão completo
- ✅ Documentação junto
- ✅ Comunidade pode contribuir
- ✅ CI/CD para testes futuros

### Como fazer:

**Passo 1:** Crie um repositório público
```
https://github.com/novo/veo3-batch-automator
```

**Passo 2:** Envie os arquivos:
```
veo3-batch-automator.user.js
README.md
INSTALL_GUIDE.md
COMPATIBILITY.md
DEBUG.md
```

**Passo 3:** Crie releases com tags semânticas
```bash
git tag v0.9.0
git push origin v0.9.0
```

**Passo 4:** Link para instalação:
```
Raw URL: https://raw.githubusercontent.com/seu-usuario/veo3-batch-automator/main/veo3-batch-automator.user.js

Install link: https://github.com/seu-usuario/veo3-batch-automator/raw/main/veo3-batch-automator.user.js
```

---

## Opção 3: Distribuição Direta

### Se você quer só compartilhar o arquivo:

**Passo 1:** Hospede o arquivo em qualquer lugar:
- Google Drive (compartilhado)
- Dropbox
- Seu próprio site
- Discord/Slack

**Passo 2:** Envie o link `.js` direto

**Desvantagem:** Sem atualizações automáticas. Tem que compartilhar novo link sempre que atualizar.

---

## Opção 4: Greasy Fork (Comunidade)

### Se quer máxima visibilidade:

**Passo 1:** Vá para [greasy-fork.org](https://greasy-fork.org)

**Passo 2:** Crie conta e clique "Submit"

**Passo 3:** Cole o script e preencha:
```
Name: VEO3 Batch Automator
Description: Automate batch video generation in Google VEO3 Flow
Namespace: https://synkra.io/veo3
License: MIT (ou GPL)
```

**Passo 4:** Submit

**Resultado:** Seu script fica listado para qualquer pessoa encontrar (como um app store de scripts).

---

## Links de Instalação Prontos

### GitHub Gist
```markdown
[Instalar do Gist](https://gist.githubusercontent.com/seu-usuario/ID/raw/veo3-batch-automator.user.js)
```

### GitHub Raw
```markdown
[Instalar do GitHub](https://github.com/seu-usuario/veo3-batch-automator/raw/main/veo3-batch-automator.user.js)
```

### Greasy Fork
```markdown
[Instalar do Greasy Fork](https://greasy-fork.org/scripts/seu-id)
```

---

## Header do Script (Para Tampermonkey Detectar)

O script já tem o header correto:

```javascript
// ==UserScript==
// @name         Veo3 Prompt Batch Automator
// @namespace    https://synkra.io/
// @version      0.9.0
// @description  Automate batch video generation in Google Veo 3.1 — Send All then Download All
// @author       j. felipe
// @match        https://labs.google/fx/pt/tools/flow/project/*
// @match        https://labs.google/fx/*/tools/flow/project/*
// @grant        none
// @run-at       document-end
// ==/UserScript==
```

**Importante:** Quando atualizar, aumente a versão:
```
@version      0.9.0  →  0.9.1  (bug fix)
@version      0.9.1  →  0.10.0 (feature)
```

Tampermonkey usa o número para detectar atualizações.

---

## Checklist de Distribuição

- [ ] Script testado em Chrome, Firefox, e pelo menos 1 outro navegador
- [ ] Header do script está correto (name, version, match, etc.)
- [ ] Todos os documentos atualizados (README, INSTALL_GUIDE, COMPATIBILITY)
- [ ] Link funciona e abre diretamente no Tampermonkey
- [ ] Instruções de instalação são claras
- [ ] Incluir link para relatar bugs/issues

---

## Como Gerenciar Atualizações

### Versioning
```
v0.9.0 → v0.9.1 (patch: bug fix)
v0.9.0 → v0.10.0 (minor: nova feature)
v0.9.0 → v1.0.0 (major: breaking change)
```

### Publicar Atualização

1. **No GitHub/Gist:**
   ```
   Edita o arquivo
   Atualiza @version
   Salva
   ```
   Tampermonkey detecta automaticamente em 24h.

2. **No Greasy Fork:**
   ```
   Clique "Edit"
   Colar nova versão
   Atualizar changelog
   Submit
   ```

3. **No README:**
   ```markdown
   ## Changelog

   ### v0.10.0 (2026-02-07)
   - Added new feature X
   - Fixed bug Y
   - Improved performance Z

   ### v0.9.0 (2026-02-06)
   - Initial release with Phase 1/2 workflow
   ```

---

## Template de Anúncio

### Para compartilhar em redes/comunidades:

```markdown
# 🎬 VEO3 Batch Automator v0.9.0

Automate batch video generation in Google VEO3 Flow.

**Features:**
- ✅ Send all prompts at once (no waiting for downloads)
- ✅ Download all videos in one click
- ✅ Pause/Resume support
- ✅ Works with UI updates (multiple selector strategies)
- ✅ No external dependencies

**Installation:** [Install Script](LINK_HERE)

**Documentation:** [See Guide](INSTALL_GUIDE.md)

**License:** MIT | **Author:** j. felipe

Questions? See [FAQ](INSTALL_GUIDE.md#perguntas-comuns) or [GitHub Issues](LINK_HERE/issues)
```

---

## Suporte & Issues

Se distribuir, prepare:

1. **Email/Contact** para suporte
2. **GitHub Issues** ou **Discussions** para bugs
3. **Wiki** com FAQs comuns
4. **Templates de issue** para bug reports

---

## Analytics (Opcional)

### Se quiser rastrear uso:

Adicione ao script (uma única linha no init):
```javascript
// Completely optional - tracks installation count
new Image().src = `https://seu-tracker.com/track?version=0.9.0&installed=true`;
```

Mas avise aos usuários na privacidade.

---

## Exemplo Completo: Link Pronto para Usar

Se você hospedá no GitHub, compartilhe assim:

```
📦 VEO3 Batch Automator

Click to install:
https://github.com/seu-usuario/veo3-batch-automator/raw/main/veo3-batch-automator.user.js

Or use Greasy Fork:
https://greasy-fork.org/scripts/XXXXX

Questions? See INSTALL_GUIDE.md or report issues on GitHub
```

---

**Última atualização:** 2026-02-06
**Script:** VEO3 Batch Automator v0.9.0
