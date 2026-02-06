# 📦 Guia de Instalação - VEO3 Batch Automator

**Para qualquer pessoa que queira usar. Leva 2 minutos.**

---

## Opção 1: Instalação Rápida (Recomendado)

### Passo 1: Instale o Tampermonkey
Escolha seu navegador:

- **Chrome/Edge:** [Tampermonkey Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobela)
- **Firefox:** [Tampermonkey Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- **Safari:** [Tampermonkey Safari](https://apps.apple.com/app/tampermonkey/id1482490089)
- **Opera:** [Tampermonkey Opera](https://addons.opera.com/en/extensions/details/tampermonkey/)

Clique em "Add to [Browser]" e confirme.

### Passo 2: Abra o Script
**Opção A (Gist):** Copie este link no seu navegador:
```
https://gist.githubusercontent.com/seu-usuario/seu-gist-id/raw/veo3-batch-automator.user.js
```

**Opção B (GitHub Raw):** Ou use:
```
https://raw.githubusercontent.com/seu-usuario/seu-repo/main/veo3-batch-automator.user.js
```

### Passo 3: Instale
Tampermonkey abrirá uma página com o script. Clique:
```
Instalar Script
```

Pronto! ✅

---

## Opção 2: Instalação Manual

### Passo 1: Instale Tampermonkey (veja acima)

### Passo 2: Crie um novo script
1. Clique no ícone Tampermonkey (canto superior direito)
2. Selecione "Criar novo script"
3. Delete o conteúdo padrão

### Passo 3: Cole o script
1. Copie TODO o conteúdo de `veo3-batch-automator.user.js`
2. Cole na janela que abriu
3. Pressione `Ctrl+S` (ou `Cmd+S` no Mac)

### Passo 4: Pronto!
Recarga qualquer página do VEO3 e vê a bolinha roxa aparecer.

---

## Verificar Instalação

### 1. Vá para Google VEO3
```
https://labs.google/fx/tools/flow/
```

### 2. Abra um projeto
Cria ou abre um projeto existente.

### 3. Procure a bolinha roxa (VEO)
- Canto inferior direito da tela
- Fundo roxo com letras brancas "VEO"
- Se não ver, verifique se:
  - ✅ Tampermonkey está instalado
  - ✅ Script está habilitado (Dashboard do Tampermonkey)
  - ✅ Você está na URL correta (`labs.google/fx/.../project/...`)

### 4. Teste rápido
1. Clique na bolinha roxa
2. Cole um prompt rápido (ex: "uma bola vermelha")
3. Clique "Enviar Todos"
4. Vê o status no painel?

Se vê a bolinha e o painel, está funcionando! 🎉

---

## Uso Básico

### FASE 1: Enviar Todos (Gerar Vídeos)

```
1. Clique na bolinha roxa "VEO"
2. Cole seus prompts (um por linha):

   Prompt 1
   Prompt 2
   Prompt 3

3. Clique no botão verde "▶ Enviar Todos"
4. Vê o status atualizando no painel
5. Espera todos os vídeos serem gerados
```

### FASE 2: Baixar Todos (Download)

```
1. Quando terminar, o botão azul ativa
   "📥 Baixar 3 vídeos"

2. Clique nele

3. Os vídeos descem para Downloads/
   - veo3-batch-001.mp4
   - veo3-batch-002.mp4
   - veo3-batch-003.mp4
```

---

## Controles

| Botão | O que faz |
|-------|-----------|
| 🟢 **Enviar Todos** | Injeta prompts e gera vídeos (sem download) |
| 🔵 **Baixar Todos** | Baixa todos os vídeos gerados |
| 🟠 **Pausar** | Pausa e depois retoma com "Retomar" |
| 🔴 **Parar** | Cancela tudo |

---

## Perguntas Comuns

### P: E se meu navegador bloquear downloads?
**R:** Normal. Você vai ver um popup no canto pedindo permissão. Clique "Permitir".

### P: Onde os vídeos são salvos?
**R:** Na pasta "Downloads" do seu computador.

### P: Posso usar em qualquer navegador?
**R:** Sim! Chrome, Firefox, Safari, Edge, Opera — todos funcionam.

### P: Funciona offline?
**R:** Não. Precisa estar na página do VEO3 (online).

### P: O que é a bolinha roxa?
**R:** É o controle do script. Você clica para abrir/fechar o painel.

### P: Posso arrastar o painel?
**R:** Sim! Clique na barra de cima e arraste para qualquer lugar. A posição é salva.

### P: E se a página do VEO3 mudar?
**R:** Vê a documentação `COMPATIBILITY.md`. O script foi feito para sobreviver a atualizações.

### P: Como atualizo o script?
**R:** Se você instalou por Gist/Raw, atualiza automaticamente. Se instalou manualmente, repete o processo.

---

## Solução de Problemas

### Problema: Bolinha roxa não aparece

**Solução 1:** Verifique se está na URL certa
```
✅ https://labs.google/fx/pt/tools/flow/project/xyz
✅ https://labs.google/fx/en/tools/flow/project/xyz
❌ https://labs.google (não funciona)
```

**Solução 2:** Verifique se Tampermonkey está ativado
```
Clique no ícone Tampermonkey → Verifique se tem um número (scripts ativos)
```

**Solução 3:** Abra o console (F12) e vê se tem erros
```
F12 → Console → Procura por mensagens vermelhas
```

---

### Problema: Script não clica no botão "Enviar"

**Solução:** Vá para F12 → Console
- Script mostra mensagens como `✅ Found SEND button` ou `⚠️ Could not find SEND`
- Se não encontra, é possível que a UI do VEO3 tenha mudado
- Crie uma issue no GitHub com a mensagem de erro

---

### Problema: Vídeo não baixa

**Solução 1:** Verifique permissões
```
Navegador → Configurações → Privacidade
Procura por "Veo3" ou "Google" → Vê se downloads estão bloqueados
```

**Solução 2:** Tente manualmente
```
Clique no vídeo → Clique o botão download do VEO3 manualmente
Se funcionou, o script pode estar com timing desajustado
```

**Solução 3:** Aumente timeout
Edite o script (Tampermonkey Dashboard → Edit):
```javascript
const CONFIG = {
  POLL_INTERVAL: 500,
  PROGRESS_TIMEOUT: 600000,    // ← Aumente de 480000 para 600000 (10 min)
  DOWNLOAD_TIMEOUT: 60000,     // ← Aumente de 30000 para 60000
  INTER_PROMPT_DELAY: 2000
};
```

---

## Precisa de Ajuda?

1. **Veja `DEBUG.md`** para troubleshooting detalhado
2. **Veja `COMPATIBILITY.md`** se suspeita que a UI mudou
3. **Crie uma issue no GitHub** se nada funcionar
4. **Entre em contato:** [seu email/contact]

---

**Última atualização:** 2026-02-06
**Script:** VEO3 Batch Automator v0.9.0
