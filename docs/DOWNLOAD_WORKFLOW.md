# 📥 Download Workflow - VEO3 Batch Automator v0.9.0+

## Novo Sistema de Organização

O script agora gera **downloads organizados com numeração automática** e um manifest de instrução.

---

## O Que Você Recebe

Após clicar "Baixar Todos", seus Downloads/ ficam assim:

```
Downloads/
├── veo3-batch-001.mp4         ✅ Video 1
├── veo3-batch-002.mp4         ✅ Video 2
├── veo3-batch-003.mp4         ✅ Video 3
├── veo3-batch-004.mp4         ✅ Video 4
├── veo3-batch-005.mp4         ✅ Video 5
└── veo3-batch-MANIFEST.txt    📄 Instruções & manifest
```

---

## Arquivo MANIFEST

O `veo3-batch-MANIFEST.txt` contém:

1. **Timestamp** - Data/hora do batch
2. **Batch ID** - Identificador único
3. **Total de vídeos** - Quantidade baixada
4. **Instruções de organização** - 3 opções para criar pasta
5. **Lista de arquivos** - Todos os 5 vídeos numerados
6. **Links de suporte** - Como obter ajuda

---

## 3 Formas de Organizar

### Opção 1: Manualmente (Qualquer SO)

```
1. Abra pasta Downloads/
2. Crie nova pasta: "veo3-batch"
3. Selecione todos: veo3-batch-*.mp4
4. Mova para dentro da pasta veo3-batch/
```

Resultado:
```
Downloads/veo3-batch/
├── 001.mp4
├── 002.mp4
├── 003.mp4
├── 004.mp4
└── 005.mp4
```

### Opção 2: Windows (PowerShell)

```powershell
mkdir "$env:USERPROFILE\Downloads\veo3-batch"
move "$env:USERPROFILE\Downloads\veo3-batch-*.mp4" "$env:USERPROFILE\Downloads\veo3-batch\"
```

Ou no CMD:
```cmd
mkdir %USERPROFILE%\Downloads\veo3-batch
move %USERPROFILE%\Downloads\veo3-batch-*.mp4 %USERPROFILE%\Downloads\veo3-batch\
```

### Opção 3: Mac/Linux

```bash
mkdir -p ~/Downloads/veo3-batch
mv ~/Downloads/veo3-batch-*.mp4 ~/Downloads/veo3-batch/
```

---

## Como Funciona Internamente

### FASE 1: Enviar Todos
```
Injeta prompt → Envia → Gera vídeo → Próximo
(sem fazer download)
```

### FASE 2: Baixar Todos
```
Para cada vídeo gerado:
  1. Encontra elemento <video>
  2. Clica botão download
  3. Salva com nome: veo3-batch-NNN.mp4
  4. Aguarda confirmação
  5. Próximo vídeo
```

### Após Download Completar
```
Gera arquivo: veo3-batch-MANIFEST.txt
├─ Timestamp e batch ID
├─ Lista de todos os arquivos
├─ Instruções de organização
└─ Links de suporte
```

---

## Nomenclatura Explicada

### Formato: `veo3-batch-NNN.mp4`

| Parte | Significado | Exemplo |
|-------|-------------|---------|
| `veo3-batch` | Prefixo identificador | veo3-batch |
| `NNN` | Número sequencial (001-999) | 001, 002, 003 |
| `.mp4` | Formato de vídeo | .mp4 |

**Vantagens:**
- ✅ Fácil encontrar (busca por "veo3-batch")
- ✅ Ordem alfabética = ordem de geração
- ✅ Sem conflitos (número sequencial único)
- ✅ Compatível com todos os SOs

---

## Cenários Comuns

### Cenário 1: Tudo funciona perfeito
```
✅ 5 vídeos baixam corretamente
✅ Manifest é gerado
✅ User cria pasta veo3-batch/ e move arquivos
✅ Tudo organizado!
```

### Cenário 2: Um vídeo falha
```
✅ 4 vídeos baixam OK
❌ 1 vídeo falha (mostra erro no painel)
✅ Manifest gerado com status de cada arquivo
💡 User vê quais falharam no manifest
```

### Cenário 3: Browser bloqueia downloads
```
⚠️ Browser pede confirmação de download
User clica "Permitir"
✅ Download prossegue normalmente
```

### Cenário 4: Google bloqueia automação
```
⚠️ VEO3 detecta script e bloqueia
❌ Download falha com mensagem clara
💡 User pode tentar manualmente ou mais tarde
```

---

## Troubleshooting

### P: Vídeos não estão aparecendo em Downloads?
**R:** Verifique:
1. Pasta Downloads está no local padrão?
2. Browser permite downloads para essa pasta?
3. Espaço em disco disponível? (mínimo 50MB por vídeo)
4. Veja arquivo MANIFEST para detalhes de erro

### P: Manifest não apareceu?
**R:** Pode estar bloqueado ou renomeado. Procure por:
- `veo3-batch-MANIFEST.txt`
- Arquivos starting com `veo3-batch-`
- Abra DevTools (F12) e veja console para logs

### P: Quero usar um prefixo diferente?
**R:** Edit o script (linha ~100):
```javascript
const CONFIG = {
  DOWNLOAD_FOLDER: 'seus-videos'  // Mude para qualquer nome
};
```

### P: Posso copiar vídeos para Drive/Cloud?
**R:** Sim! Depois que estiverem em `Downloads/veo3-batch/`, copie para:
- Google Drive
- OneDrive
- Dropbox
- iCloud Drive
- etc.

---

## Melhorias Futuras

🔮 Planejamos adicionar:
- [ ] Option para ZIP automático
- [ ] Renomear com timestamps (evita conflitos)
- [ ] Custom prefix via UI
- [ ] Export para diferentes formatos
- [ ] Integration com cloud storage

---

## Sumário

**Novo Sistema (v0.9.0+):**
- ✅ Download automático com numeração (001, 002, 003...)
- ✅ Manifest com instruções
- ✅ 3 formas de organizar
- ✅ Mensagens claras no painel
- ✅ Fácil de encontrar e mover

**Resultado:**
Workflow liso, intuitivo, e profissional. Usuário não precisa se preocupar com organização — script guia tudo!

---

**Última atualização:** 2026-02-06
**Versão:** VEO3 Batch Automator v0.9.0+
