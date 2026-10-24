# Jaiminho: revisão de UI/UX

> 2026-10-24 · revisor: agente de UI/UX · build avaliada: `apps/desktop/renderer/dist` de 2026-10-24 02:40 (igual ao `src`)
> Método: o app rodou de verdade (Playwright `_electron`, xvfb, 1440×900 e 1100×700), em dois workspaces: um vazio criado do zero e o de exemplo com os mocks. Também li o código de `renderer/src`. Medi o contraste WCAG nas cores dos tokens de `styles.css`.
> Script de captura: `uxreview/capturar.js` (`cd apps/desktop && xvfb-run -a -s "-screen 0 1440x900x24" node ../../uxreview/capturar.js`). Screenshots em `uxreview/shots/`: `u*.png` são desta revisão e `ref-*.png` vêm da rodada de QA.

## Resumo

A base é boa. A estrutura segue a do Postman (barra lateral com Coleções/Ambientes/Histórico, abas com bolinha de "não salvo" e aba provisória em itálico, barra método+URL+Enviar, subabas Params/Autorização/Headers/Body/Scripts e resposta com Corpo/Headers/Cookies/Testes/Console). Quem vem do Postman se orienta em segundos. O gRPC e o SOAP estão acima da média: a linha do tempo, o stream bidi com "Enviar mensagem/Finalizar envio" e os selos de XSD ok funcionam bem. O foco visível por teclado também funciona.

Os problemas que mais pesam:

1. **Variáveis**: a URL não destaca `{{var}}` e não avisa quando uma variável não está definida. O resultado é um erro de DNS que não diz a causa.
2. **Uma mensagem errada sobre a auth herdada.**
3. **O tema claro tem contraste ruim** nas cores de método e protocolo e na linha selecionada.
4. **Bugs de layout pequenos e visíveis**: o seletor de cor do ambiente, o seletor de método gRPC que sai da janela, a caixa de erro que esconde as abas e as notificações (toasts) que cobrem os botões do modal.
5. **Acessibilidade**: zero `aria-*`/`role`, e a árvore não é navegável por teclado.
6. **Identidade aplicada pela metade**: emojis no lugar dos ícones da paleta, o editor com fundo cinza fora da paleta, o mascote dentro do fluxo de trabalho (a identidade proíbe) e o microcopy de correio usado só em parte.

---

## Achados priorizados

Severidade: **alta** = induz a erro ou bloqueia; **média** = atrito frequente ou visual quebrado; **baixa** = polimento.

### UX-01 · alta · Barra de URL: variáveis sem destaque e erro enganoso quando não existem
- **Tela:** request HTTP sem ambiente, URL `{{baseUrl}}/api/x` → `shots/u05-variavel-inexistente.png`
- **Problema:** a URL é um `<input>` simples: `{{baseUrl}}` aparece com a mesma cor do resto, sem tooltip com o valor e sem autocompletar. Ao enviar com a variável indefinida, a resposta é "NÃO ENTREGUE · Host não encontrado (DNS) [ENOTFOUND]", sem citar a variável. O mesmo vale para o gRPC (`grpc://{{grpcHost}}`).
- **Por que importa:** no Postman, `{{var}}` fica laranja quando resolvida e vermelha quando não existe, e o hover mostra o valor e o escopo. É o recurso mais usado no dia a dia, e na VPN o "DNS" faz o dev ir atrás do problema de rede errado.
- **Recomendação:**
  1. (barato) Em `send.js`/`exec:send`, antes de enviar, procurar `{{x}}` não resolvidas na URL, nos headers e na auth. Se houver, mostrar no `error-box`: "A variável `{{baseUrl}}` não está definida. Selecione um ambiente (hoje: *Sem ambiente*) ou crie a variável." e incluir um botão "Escolher ambiente".
  2. (médio) Trocar o input da URL (`RequestEditor.jsx`, `.reqbar .url`, e `GrpcPanel.jsx`) por um CodeMirror de uma linha, reaproveitando o `varPlugin` de `Editor.jsx`. O decorator pinta a variável de `--dourado` quando resolvida e de `--erro` quando não resolvida. Acrescentar um tooltip com valor e escopo (usar `vars:effective`) e autocompletar ao digitar `{{`. Aplicar o mesmo destaque nas células da `KVTable`.

### UX-02 · alta · "Herdar do pai" diz que não há auth acima, mas há
- **Tela:** "Bearer (herdado da coleção)" → Autorização → `shots/u19-auth-herdada.png`
- **Problema:** aparece "Usa a autenticação da pasta/coleção (nenhuma definida acima)", mas a coleção define Bearer e o envio funciona. Causa: `AuthEditor` recebe a prop `inheritedFrom`, mas `RequestEditor.jsx` (linha da subaba `auth`) não a passa.
- **Por que importa:** o Postman mostra "This request is using Bearer Token from collection X". Aqui a mensagem diz o contrário do que acontece, e o usuário pode duplicar o token na request ou desconfiar da herança.
- **Recomendação:** resolver a cadeia (`item:chain`, já usado no `NameBar`) até achar o primeiro ancestral com `auth.type` diferente de `inherit`. Passar `inheritedFrom="Bearer Token · coleção 1. REST / JSON"` e incluir um link "Editar na coleção" que chama `openItem(id, 'collection')`.

### UX-03 · alta · Tema claro: cores de método e protocolo e linha selecionada sem contraste
- **Telas:** `shots/u28-claro-request.png`, `shots/u29-claro-grpc-bidi.png`, `shots/ref-15-tema-claro.png`
- **Medições (WCAG, texto normal, AA = 4.5:1):**

| Par | Contraste |
|---|---|
| `gRPC` (`--brilho` #7ED9F1) sobre #F4F6FB | **1.48** |
| `SOAP` (#C08A5A) sobre #F4F6FB | **2.76** |
| `GET` (#3F7D27) sobre a linha selecionada (#607AAA) | **1.16** |
| texto sobre a linha selecionada | 4.2 |
| "Enviar": branco sobre `--accent` #1A8FB0 | **3.75** |
| `--faint` #7A84A3 (placeholders, dicas, "não salva") sobre #F4F6FB | **3.43** |
| pill 200 OK (verde sobre verde 25%) | 3.58 |

- **Por que importa:** a identidade exige "mín. 4.5:1 para texto". No claro o gRPC some da árvore, e a linha selecionada (azul-profundo a 70% sobre fundo claro) fica escura demais para o texto escuro.
- **Recomendação (só `styles.css`, bloco `:root[data-theme="light"]`):** redefinir `--brilho: #0E7490` (de onde vêm `.m-gRPC`, `.dir-st` e o cursor), `--accent: #0E7490` (contraste ~5.4:1 com branco) e `--faint: #5F6987`. Trocar `.m-SOAP` para `var(--couro)` (#7A4A24, ~7:1). Para `.tree-row.sel` no claro, usar `background: color-mix(in srgb, var(--azul) 16%, transparent)` com `box-shadow: inset 3px 0 0 var(--azul)` em vez do azul-profundo a 70%. No escuro, `.m-PATCH` (#9040D8 sobre `--noite`) fica em 3.42: clarear para ~#B07CF0 só no texto do método.

### UX-04 · média-alta · Seletor de método gRPC sai da janela e o campo de busca fica esmagado
- **Tela:** `shots/u21-grpc-seletor-metodo.png`
- **Problema:** `.method-picker` tem `width: 560px` e está ancorado à esquerda de um contêiner de 380px, que fica encostado no botão Invocar. A lista passa da borda direita, os tipos (`GetTravellerRequest → …`) aparecem cortados e o input "Buscar método" encolhe até virar um quadradinho ao lado de "Recarregar".
- **Por que importa:** escolher o método é o passo 1 do gRPC (no Postman é o dropdown "Select a method", que já abre com busca).
- **Recomendação:** em `styles.css`, usar `.method-picker { right: 0; left: auto; width: min(560px, calc(100vw - 40px)); }`. Em `GrpcPanel.jsx` (MethodPicker), dar `min-width: 0; flex: 1` ao input e transformar "Recarregar" em `icon-btn` com `title`. Acrescentar navegação por ↑/↓/Enter na lista.

### UX-05 · média-alta · O erro gRPC com detalhes empurra as abas da resposta para fora da tela
- **Tela:** `shots/u22-grpc-erro.png`
- **Problema:** o `error-box` com `errorDetails` (BadRequest, ErrorInfo…) cresce sem limite. A barra Resposta / Linha do tempo / Metadata / Trailers fica abaixo da dobra e passa por baixo da barra de status. Não há rolagem nesse trecho.
- **Recomendação:** em `ResponseView.jsx` (ramo gRPC), limitar a caixa (`.error-box { max-height: 40%; overflow: auto }`) ou, melhor, mostrar só a linha do status no `error-box` e colocar os detalhes numa subaba "Detalhes do erro", aberta automaticamente quando houver erro. O mesmo vale para os erros de XSD no HTTP.

### UX-06 · média · Toasts cobrem o rodapé dos modais e repetem mensagens
- **Telas:** `shots/ref-14-config-certs.png` (o "Salvar" das Configurações fica escondido atrás de dois toasts), `shots/ref-07-grpc-bidi-aberto.png` ("Reflection v1: 1 serviço(s)" duas vezes)
- **Problema:** `.toasts` tem `z-index: 60` e fica no canto inferior direito, que é onde estão os botões primários dos modais (`z-index: 50`). Os toasts duram 4,5 a 9 s. Toasts informativos de rotina (reflection, "variáveis atualizadas pelo script") se acumulam, e o resultado do import aparece duas vezes: no card e no toast.
- **Recomendação:**
  1. Com modal aberto, subir os toasts (`.modal-bg ~ .toasts { bottom: 90px }`) ou mudar a pilha para o canto superior direito.
  2. Em `store.js`, não repetir um toast com o mesmo texto que ainda está visível.
  3. Não mostrar o toast de reflection quando ela der certo (o seletor já mostra os métodos), e tirar o toast de `ImportModal`, porque o card já informa.
  4. Acrescentar um ✕ visível e `role="status" aria-live="polite"` no contêiner.

### UX-07 · média · Seletor de cor do ambiente vira uma barra de 245 px
- **Telas:** `shots/u13-ambiente-novo.png`, `shots/ref-13-ambiente.png`
- **Problema:** em `EnvironmentEditor`, o `<input type="color">` herda `.reqname input { min-width: 260px }`, e o estilo inline `width: 28` é ignorado. Fica uma faixa verde ou cinza enorme ao lado do nome.
- **Recomendação:** acrescentar `.reqname input[type=color] { min-width: 0; width: 22px; height: 22px; padding: 0; border-radius: 50% }`. Melhor ainda: mostrar 8 bolinhas com as cores da paleta (verde = DEV, dourado = QUA, erro = PRD), no estilo das cores de ambiente do Postman.

### UX-08 · média · Ambientes: segredo impossível de conferir e painel 👁 com escopo errado
- **Telas:** `shots/ref-13-ambiente.png`, `shots/u30-claro-ambiente.png`, `shots/u32-claro-vars.png`, `shots/ref-12-vars.png`
- **Problemas:**
  - Um segredo aparece como `••••••` sem botão para revelar. Não dá para conferir se o token salvo é o certo (o Postman tem o olho por linha).
  - A coluna "Valor local" mostra `—` como placeholder, o que parece um valor.
  - O painel "Variáveis efetivas", aberto com a aba de *ambiente* ativa, rotula tudo como `folder/request` e mostra `token`/`apiKey` em branco. Causa: `VarsPanel` manda o draft do ambiente como `draft` de request.
  - Os escopos aparecem em inglês (`global`, `environment`, `folder/request`) no meio de uma UI em PT-BR.
- **Recomendação:**
  - Em `ItemEditors.jsx` (`VarsWithSecrets`), usar um input `type=password` com um botão 👁 por linha que lê `secret:get` só enquanto o botão estiver pressionado. Trocar o placeholder `—` por "(usa o partilhado)".
  - Em `Modals.jsx` (`VarsPanel`), mandar `draft` só quando `tab.type === 'request'`, traduzir os escopos (global, coleção, ambiente, pasta/request, dados, local) e marcar os segredos como "segredo (definido)" ou "segredo (sem valor)" em `--dourado`.

### UX-09 · alta (acessibilidade) · Árvore, abas e menus sem teclado e sem ARIA
- **Telas:** `shots/u01-welcome-foco-teclado.png` e `shots/u09-foco-teclado-subabas.png` mostram que o anel de foco funciona nos botões. Na árvore, nada recebe foco.
- **Problema:** `grep` em `renderer/src` dá **0** ocorrências de `aria-`, `role=` ou `tabIndex`.
  - `.tree-row`, `.tab` e as linhas do histórico são `<div onClick>`, sem foco possível. Não há como abrir uma request sem mouse.
  - O menu de contexto não responde a setas nem a Esc. Os modais não têm `role="dialog"`/`aria-modal` nem prendem o foco (Tab sai para a tela de trás).
  - Os botões de ícone (✕, ⋯, 👁, 🧪, ⚙) usam só `title`, sem `aria-label`.
  - Nas subabas, falta `role="tablist"`/`aria-selected`.
- **Por que importa:** é requisito básico, e quem vem do Postman navega muito por teclado.
- **Recomendação:**
  - `Sidebar.jsx`: `role="tree"`/`treeitem`, `aria-expanded`, `tabIndex` roving, ↑/↓ para mover, ←/→ para recolher e expandir, Enter para abrir, **F2 para renomear**, **Del para apagar**, Shift+F10 ou a tecla Menu para abrir o menu de contexto.
  - `ContextMenu`: focar o primeiro item, navegar com setas, fechar com Esc.
  - `Modal`: `role="dialog" aria-modal="true" aria-labelledby`, foco inicial no primeiro campo, focus trap e devolver o foco ao fechar.
  - Botões de ícone: `aria-label` com o mesmo texto do `title`.
  - Fechar aba: alvo de 20×20 hoje; subir para 24×24 (WCAG 2.2 AA, 2.5.8).

### UX-10 · média · Editor de código com fundo cinza fora da paleta
- **Telas:** `shots/ref-03-get-200.png`, `shots/u07-body-json-vazio.png`, `shots/u20-soap.png`
- **Problema:** no escuro, o CodeMirror (`theme='dark'` do `@uiw`) pinta um bloco cinza neutro (~#2B2D33) só até onde há texto. Abaixo dele aparece o `--bg0` azul-noite. O resultado parece uma janela colada dentro do app, e a cor do JSON (vermelho e laranja do one-dark) não conversa com a paleta.
- **Recomendação:** em `Editor.jsx`, trocar `theme={t==='light'?'light':'dark'}` por temas próprios (`createTheme` do `@uiw/codemirror-themes` ou `EditorView.theme` + `HighlightStyle`): fundo `transparent`/`var(--bg0)`, linha ativa a azul-profundo 22% (já existe), chaves JSON em `--azul`, strings em `--verde`, números em `--dourado`, tags XML em `--violeta`, atributos em `--brilho`, comentários em `--faint`. Assim o editor fica igual nos dois temas.

### UX-11 · média · Emojis no lugar de ícones: fora da paleta e diferentes em cada sistema
- **Telas:** praticamente todas: 📮 vermelho (coleção), 📁 amarelo (pasta), 🌐 (ambiente), 👁 🧪 ⚙ (barra superior), 🔒/🔓 (TLS do gRPC e barra de status), ❄ (congelar), ▶ (rodar)
- **Problema:** a identidade pede `--couro` para coleções e pastas, mas o 📮 é vermelho e o 📁 é amarelo. Emojis não aceitam `color`, mudam de aparência entre Windows (Segoe UI Emoji) e Linux, e não seguem o tema. O 🔓 dourado no gRPC parece um aviso, quando só quer dizer "plaintext". O 🧪 para "mocks" não se entende sem o tooltip.
- **Recomendação:** um conjunto pequeno de SVGs inline (por exemplo, copiar ~15 ícones do Lucide, ISC, para `renderer/src/icons.jsx`; funciona offline). Mapeamento: coleção = envelope `{ }` em `--couro` (o próprio símbolo da marca), pasta em `--couro`, ambiente = globo, variáveis = olho, mocks = servidor, configurações = engrenagem, TLS = cadeado em `--verde`/`--faint`. Botões só com ícone ganham `aria-label`. Na barra superior, mostrar o rótulo "Mocks" ao lado do ícone.

### UX-12 · média · Faltam os headers automáticos (o "hidden headers" do Postman)
- **Tela:** Headers de "Listar viajantes" → `shots/u18-aba-nao-salva.png`
- **Problema:** a aba Headers mostra só o que o usuário digitou. `Content-Type` do SOAP, `Authorization` da auth herdada, `User-Agent` e `Cookie` só aparecem depois do envio, em "Tempos e request".
- **Recomendação:** em `RequestEditor.jsx`, acrescentar uma linha recolhível "N headers automáticos (ver)", somente leitura, em `--faint`, com a origem de cada um ("auth da coleção", "versão SOAP", "pote de cookies"). Renomear a subaba "Tempos e request" da resposta para "Request enviada" e deixar os tempos numa seção dela, porque é lá que o usuário procura o que realmente saiu.

### UX-13 · média · Boas-vindas sem caminho para migrar do Postman
- **Telas:** `shots/u01-welcome-foco-teclado.png`, `shots/u02-prompt-nome-workspace.png`
- **Problema:** as opções são criar, abrir ou mocks. Quem chega do Postman quer trazer o backup ou as coleções logo de cara, mas a importação só aparece depois que o workspace existe. "Criar workspace…" abre primeiro o seletor de pasta e só depois pede o nome, a ordem inversa da esperada.
- **Recomendação:** em `App.jsx` (Welcome), acrescentar um 4º botão: "Importar do Postman (backup/coleções)…". Ele cria o workspace e abre o `ImportModal` já na aba Arquivo. Em `newWorkspace`, pedir primeiro o nome e depois a pasta, sugerindo `Documentos/Jaiminho/<nome>`.

### UX-14 · média · Configurações misturam o que é do workspace (partilhado) com o que é do PC
- **Telas:** `shots/u26-config-geral.png`, `shots/u25-config-proxy.png`, `shots/ref-14-config-certs.png`
- **Problema:** o mesmo modal "Configurações" grava em `jaiminho.yaml` (vai para o git e para o time: SSL, CAs, mTLS, proxy) e nas preferências locais (tema, layout). O usuário não sabe o que o colega vai receber. Num cartão mTLS, CRT/PEM, Chave e PFX/P12 aparecem juntos, embora sejam excludentes. O checkbox diz "CAs do Windows" também no Linux/macOS.
- **Recomendação:** dividir o título em "Workspace (partilhado)" e "Este PC". Mover Aparência para "Este PC". Pôr um selo "vai no workspace" nas abas partilhadas. Na aba Proxy, avisar que credenciais ficam locais. No cartão mTLS, usar um seletor "Formato: PEM | PFX/P12" que mostra só os campos correspondentes. Gerar o texto das CAs a partir de `process.platform`.

### UX-15 · média-baixa · Histórico pobre
- **Tela:** `shots/u14-historico.png`
- **Problema:** não há horário nem agrupamento por dia, não há busca, e o nome repete ("Nova request" duas vezes). Clicar abre um rascunho novo sem dizer isso. "Limpar" apaga tudo sem confirmar. O estado vazio diz "Nada enviado ainda." quando a identidade previa "Caixa de saída vazia".
- **Recomendação:** em `Sidebar.jsx` (History), agrupar por "Hoje / Ontem / data", mostrar a hora em `--faint`, acrescentar um filtro (reaproveitar o input "Filtrar"), confirmar antes de limpar, e oferecer "Abrir" e "Salvar em coleção…" no menu de contexto.

### UX-16 · baixa-média · Estados de carregamento e vazios
- **Telas:** `shots/u16-carregando.png`, `shots/u17-erro-500.png`, `shots/u21-grpc-seletor-metodo.png`
- **Problemas:**
  - "Entregando…" vem sem indicador de progresso nem cronômetro (o Postman mostra o tempo correndo). Na aba, o `…` fica em `.hint`, quase invisível.
  - O chip "Testes 0/0" aparece mesmo quando não há testes.
  - No vazio do gRPC, a dica é "cole um cURL na barra de URL", quando deveria ser grpcurl.
  - Antes de invocar um bidi, a dica diz "Método de streaming **do cliente**".
  - O mascote aparece no vazio da resposta, e `identidade.md` diz "**Não** usar o mascote no fluxo de trabalho (barra de URL, resposta)".
- **Recomendação:**
  - `ResponseView.jsx`: um envelope animado (CSS) + "Entregando… 1,2 s" (`Date.now() - tab.startedAt` a cada 100 ms). Na aba, um ponto pulsante em `--brilho`.
  - Ocultar o chip de testes quando `tests.length === 0` (no HTTP já é assim na status line, falta na barra de abas).
  - Corrigir as duas dicas de texto.
  - Trocar o logo do vazio da resposta por um ícone de envelope `{ }` monocromático em `--faint`. O mascote fica só nas boas-vindas, em "Sobre" e nos vazios da barra lateral.

### UX-17 · baixa · O microcopy de correio aparece pela metade
- **Problema:** a identidade define "Entregue em 143 ms", "Não entregue: conexão recusada", "Caixa de saída vazia" e "Nenhuma carta por aqui". O app usa "NÃO ENTREGUE" e "Entregando…", mas a linha de status mostra só "17 ms". O vazio da coleção diz "vazio — clique ⋯ para adicionar", e o do histórico, "Nada enviado ainda.". Há inglês misturado: "Pre-request", "Post-response", "Collection Runner", "Body", "Headers", "Trailers", "unary/bidi". Para devs Java isso é aceitável, mas é bom padronizar.
- **Recomendação:** status `200 OK · entregue em 17 ms · 534 B`. Coleção vazia: "Nenhuma carta por aqui. [＋ Request] [Colar cURL]", com botões de verdade no lugar da instrução "clique ⋯". Termos técnicos consagrados (Headers, Body, Params, Runner) podem ficar em inglês; o resto deve ficar em PT-BR, de forma consistente (por exemplo, "Antes da request" e "Depois da resposta (testes)", espelhando o gRPC).

### UX-18 · baixa · Árvore, abas e menu de contexto: detalhes de descoberta
- **Telas:** `shots/u10-colecao-vazia.png`, `shots/u11-menu-contexto-colecao.png`
- **Problemas:**
  - "＋ Coleção" pede o nome num modal e não abre a coleção. Renomear também é por modal; não há rename inline nem F2.
  - "Sincronizar com o Swagger…" aparece em coleções que não vieram de um Swagger.
  - "Colar cURL aqui" fica sem o `＋` que os vizinhos têm.
  - Nomes longos são cortados em 290 px ("Buscar viajante po…"), e a barra é redimensionável, mas não há nenhuma pista visual disso.
  - As abas não têm menu de contexto (fechar outras, fechar à direita, duplicar).
  - Não há "Salvar como…" (Ctrl+Shift+S) para duplicar uma request editada.
  - "Importar" está duplicado (na barra superior e na lateral), e "Exportar" na barra superior não diz *o quê* (é o workspace inteiro).
- **Recomendação:** rename inline no `TreeNode` (o input substitui o `.name`; Enter salva, Esc cancela; disparar ao criar a coleção e com F2). Mostrar "Sincronizar" só se `node.origin?.type === 'openapi'`. Menu de contexto nas abas. Ctrl+Shift+S abre `saveAs`. Barra superior: "Exportar workspace…". O `.resizer` ganha uma linha de 1px visível no hover (já existe) e `cursor` também no `:active`.

### UX-19 · baixa · Salvar sem coleção e lista de atalhos incompleta
- **Telas:** `shots/u08-salvar-sem-colecao.png`, `shots/u15-atalhos.png`
- **Problemas:** em workspace vazio, "Salvar request" mostra "Crie uma coleção primeiro." e o botão Salvar fica desabilitado, embora com aparência de ativo (o `opacity: .5` sobre `--brilho` ainda parece clicável). A lista de atalhos omite Ctrl+O, Ctrl+Shift+Tab, F2 e Del, e "Esc · fechar janela" é ambíguo (é o modal, não a janela).
- **Recomendação:** quando não houver coleção, `SaveAsModal` cria automaticamente "Minhas requests" já selecionada. `.btn.primary:disabled` usa `background: var(--bg3); color: var(--faint)`. Completar os atalhos e trocar o texto para "Esc · cancelar envio / fechar modal".

### UX-20 · baixa · Densidade e tipografia
- Os tamanhos 10px de `.method`, `.kind-tag` e `.count` e os 10.5px de `.scope-tag` estão abaixo do confortável. Subir para 11px. O `.method` tem `width: 44px` e já cabe "PATCH" a 11px.
- O separador entre request e resposta (`.hsplit`, 5px `--line`) parece uma borda azul grossa (`ref-03-get-200.png`). Melhor: 1px de linha + 4px de área de arraste transparente.
- A barra de status repete o caminho completo do workspace, que já está no seletor. Trocar por "Ambiente: Mocks locais" (o Postman mostra o ambiente perto da URL) e deixar o caminho no tooltip.

---

## O que já está bom (manter)
- A estrutura e o vocabulário seguem os do Postman: preview tab em itálico, ponto de "não salvo" em `--dourado`, confirmação ao fechar com alterações, Ctrl+Enter, Ctrl+S, Ctrl+L.
- Colar um cURL ou grpcurl na URL preenche a request (`ref-09`), e o código sai para bash, cmd e PowerShell.
- Os erros de rede vêm explicados em PT-BR, com o código técnico entre colchetes (`u06-nao-entregue.png`).
- O gRPC tem linha do tempo com direção e cores (↑ dourado / ↓ verde), barra de stream fixa com Enviar/Finalizar e geração automática de exemplo ao escolher o método.
- No SOAP: selos "XSD request ok / XSD resposta ok", XPath no filtro e versão 1.1/1.2 na aba própria.
- A explicação de valor partilhado, local e segredo no editor de ambientes é clara e cita o "current value" do Postman.
- O foco visível existe (`:focus-visible` em `--brilho`), e no escuro os contrastes principais passam: texto 15:1, muted 7.5:1, Enviar 10.4:1.
- A tela de boas-vindas é bonita e fiel à arte do mascote.

---

## Top 10: maior impacto com pouco esforço

| # | Melhoria | Onde | Esforço |
|---|---|---|---|
| 1 | Passar `inheritedFrom` ao `AuthEditor` e dizer de onde vem a auth, com link "Editar na coleção" (UX-02) | `RequestEditor.jsx`, `AuthEditor.jsx` | ~30 min |
| 2 | Checar `{{var}}` não resolvidas antes de enviar e mostrar o erro com o nome da variável e o ambiente ativo (UX-01, parte 1) | `send.js` / `exec:send` | ~1 h |
| 3 | Tokens do tema claro: `--brilho`, `--accent`, `--faint`, `.m-SOAP` e a linha selecionada (UX-03) | `styles.css` | ~30 min |
| 4 | Corrigir o `input[type=color]` do ambiente (UX-07) | `styles.css` | 5 min |
| 5 | `.method-picker` ancorado à direita, com largura limitada e busca com `flex:1` (UX-04) | `styles.css`, `GrpcPanel.jsx` | ~20 min |
| 6 | `error-box` com `max-height` + rolagem, ou subaba "Detalhes do erro" (UX-05) | `ResponseView.jsx`, `styles.css` | ~30 min |
| 7 | Toasts: não cobrir o rodapé dos modais, sem repetidos, sem toast de reflection bem-sucedida (UX-06) | `store.js`, `styles.css`, `GrpcPanel.jsx` | ~40 min |
| 8 | Painel 👁: escopos em PT-BR, sem draft quando a aba não é request, estado dos segredos (UX-08) | `Modals.jsx` (`VarsPanel`) | ~30 min |
| 9 | Acessibilidade mínima: `aria-label` nos botões de ícone, `role="dialog"` + foco inicial nos modais, `tabIndex=0` + Enter/F2/Del nas linhas da árvore (UX-09, parte) | `Modals.jsx`, `Sidebar.jsx`, `App.jsx` | ~2 h |
| 10 | Tema próprio do CodeMirror com a paleta, sem o bloco cinza (UX-10) | `Editor.jsx` | ~1 h |

Logo depois desses, com esforço médio e retorno alto: destaque e tooltip de `{{var}}` na URL (UX-01, parte 2), ícones SVG no lugar dos emojis (UX-11), headers automáticos visíveis (UX-12) e o botão "Importar do Postman" nas boas-vindas (UX-13).
