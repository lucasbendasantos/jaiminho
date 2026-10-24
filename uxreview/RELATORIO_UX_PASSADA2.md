# Jaiminho: revisão de UI/UX, 2ª passada

> 2026-10-24 · build avaliada: `apps/desktop/renderer/dist` (index.html de 10:57, mais novo que todo o `src`). Método: app real via Playwright `_electron` + xvfb (1440×900 e 1100×700), mocks do próprio app, leitura do código para confirmar o que o DOM mostrou. Scripts e capturas em `uxreview/passada2/` (`s1.js` temas, `s2.js`/`s3.js`/`s4.js` sondas de DOM, `perf.js`/`perf2.js` desempenho; imagens em `passada2/shots/`).

## Resumo executivo

A 1ª revisão foi bem absorvida: **17 dos 20 achados estão resolvidos e 3 parciais** (seletor gRPC, emojis residuais, microcopy em inglês). Os três temas funcionam: contraste medido ≥ 4.9:1 nos métodos/protocolos em todos, foco visível nos três, CodeMirror com a paleta própria, e o tema Branco deixou de ter os problemas do antigo "claro". A acessibilidade deu um salto (árvore navegável, modais com `role=dialog` + focus trap + devolução do foco). A Ajuda é clara e bonita, mas tem divergências pontuais com a UI e uma busca fraca. Desempenho com 3.000 requests é bom; os únicos engasgos são o filtro com milhares de resultados e abrir o corpo de 20 MB. **Novos achados: 0 altos, 5 médios, 7 baixos.**

## 1. Situação dos 20 achados da 1ª revisão

| ID | Tema | Status | Evidência |
|---|---|---|---|
| UX-01 | `{{var}}` sem destaque / erro enganoso | RESOLVIDO | `.url-hl .v-bad` vermelho (rgb 224,86,86), aviso `url-missing` "Variável não definida: {{baseUrl}}", tooltip "= http://127.0.0.1:4010 (ambiente)"; erro de envio cita a variável e o ambiente (ver UX2-05 sobre o caso da letra) · `shots/ux01-sem-ambiente.png` |
| UX-02 | Auth herdada com mensagem errada | RESOLVIDO | "Esta request usa Bearer Token · coleção "1. REST / JSON". Editar lá" · `ux02-auth-herdada.png` |
| UX-03 | Contraste do tema claro | RESOLVIDO | Branco medido: GET 5.3, POST 5.1, SOAP 6.9, gRPC 5.0, pill 4.9, muted 6.2; linha selecionada com `color-mix` + barra lateral · `t-branco-1-workspace.png` |
| UX-04 | Seletor de método gRPC | PARCIAL | Lista agora ancorada à direita, 600 px, dentro da janela. Mas o campo "Buscar método" continua com **20 px de largura** (`getBoundingClientRect`) · `ux04-seletor-metodo.png` (UX2-01) |
| UX-05 | Erro gRPC empurra abas | RESOLVIDO | Caixa com 64 px, abas a y=656 (visíveis) em 1440 e 1100×700; há a aba "Detalhes do erro" · `ux05-grpc-erro-1100.png` |
| UX-06 | Toasts cobrindo modais | RESOLVIDO | `.toasts` foi para `top: 54px` (direita), `role=status aria-live=polite`; o toast do import saiu (card basta) · `ux06-import-toast.png` |
| UX-07 | Seletor de cor de 245 px | RESOLVIDO | Substituído por 6 bolinhas (DEV/QUA/PRD…) · `t-preto-2-ambiente.png` |
| UX-08 | Segredos / painel de variáveis | RESOLVIDO | Olho por linha, placeholder "(usa o partilhado)", painel com escopos em PT ("ambiente", "global") e "segredo (definido)" · `ux08-vars-painel-aba-ambiente.png` |
| UX-09 | Teclado e ARIA | RESOLVIDO | `role=tree` + 61 `treeitem` com `tabindex`; ↓ move o foco, F2 abre rename, Shift+F10/menu `role=menu` com foco no 1º item; modais `role=dialog aria-modal`, Tab não escapa (0 de 40 tentativas), Esc fecha e o foco volta ao botão de origem; fechar aba 24×24 com `aria-label`. Resíduos em UX2-09/UX2-10 |
| UX-10 | Editor com fundo cinza | RESOLVIDO | `.cm-editor` transparente nos 3 temas, chaves `--azul`, strings `--verde` (cores computadas) · `t-padrao-1-workspace.png` |
| UX-11 | Emojis no lugar de ícones | PARCIAL | 102 SVGs; nenhum emoji na UI principal. Sobram 📮/📁 no modal "Salvar request" e "▶" no menu de contexto (UX2-08) |
| UX-12 | Headers automáticos | RESOLVIDO | `<details data-testid=auto-headers>` "4 headers automáticos": Authorization com origem "auth herdada (…coleção…)", User-Agent, Accept-Encoding, Cookie · `ux12-headers-auto.png` |
| UX-13 | Migração do Postman | RESOLVIDO | Botão "Importar do Postman (backup ou coleções)…" nas boas-vindas; "Criar workspace" pede o **nome antes** do seletor de pasta (prompt visível, `showOpenDialog` não chamado) · `ux13-welcome-novo.png` |
| UX-14 | Config. partilhada × local | RESOLVIDO | Abas "Workspace (partilhado)", "Certificados SSL/mTLS (partilhado)", "Proxy", "gRPC", "Este PC"; aviso "vão para quem receber o workspace"; seletor `cert-format` (PEM/PFX); texto "CAs do sistema operacional" · `ux14-mtls.png` |
| UX-15 | Histórico pobre | RESOLVIDO | Grupo "HOJE", hora, filtro, "Limpar" pede confirmação (`showMessageBox` chamado 1×), vazio = "Caixa de saída vazia." · `ux15-historico.png` |
| UX-16 | Carregando / vazios | RESOLVIDO | "Entregando… 1.2 s" com envelope e ponto pulsante na aba; dica do gRPC vazio cita grpcurl; hint do stream agora "Método de streaming (bidi)…"; sem mascote na área de resposta · `ux16-carregando.png` |
| UX-17 | Microcopy de correio | PARCIAL | "500 Internal Server Error · entregue em 3 ms · 19 B" e "Caixa de saída vazia" ok. Continuam "Pre-request", "Post-response (testes)", "Collection Runner" e "Sem coleções." (UX2-12) |
| UX-18 | Detalhes de descoberta | RESOLVIDO | Rename inline ao criar coleção (sem modal), F2/Del, "Sincronizar com o Swagger…" só na coleção importada, menu nas abas (Fechar / outras / da direita), Ctrl+Shift+S, "Exportar workspace…". Resta "Importar" duplicado (topo e lateral), inofensivo |
| UX-19 | Salvar sem coleção / atalhos | RESOLVIDO | Modal já traz "Minhas requests" + "＋ Nova coleção" e Salvar ativo; lista de atalhos completa (inclui Ctrl+O, Ctrl+Shift+Tab, F2, Del, Shift+F10) e "Esc · Cancelar envio / fechar modal" · `ux19-atalhos.png` |
| UX-20 | Densidade e tipografia | RESOLVIDO | `.method`/`.count` 11 px, barra de status mostra "Ambiente: Mocks locais", `.hsplit` com fundo transparente (sem barra azul grossa) |

## 2. Novos achados

Severidade: **alta** = induz a erro ou bloqueia; **média** = atrito frequente ou texto que contradiz a UI; **baixa** = polimento. Nenhuma alta nesta passada.

### UX2-01 · média · gRPC: campo "Buscar método" continua esmagado (resto de UX-04)
- **Onde:** gRPC → clicar no seletor de método · `shots/ux04-seletor-metodo.png`
- **Problema:** a lista cabe na janela, mas o input de busca mede 20 px, ao lado do botão recarregar, e parece um quadradinho com foco. O `style` inline tem `flex: 1 1 0%; min-width: 0`, então algum irmão está ocupando a linha.
- **Sugestão:** deixar o input numa linha própria (`.method-picker .search { display:flex; width:100% }`) com o botão recarregar à direita, ou dar `flex: 1 1 200px` ao input.

### UX2-02 · média · Ajuda × UI: três textos que não batem com os rótulos reais
- **Onde:** `HelpModal.jsx`, tópicos "Variáveis e ambientes", "Requests HTTP", "Atalhos"
- **Problemas (conferidos contra a UI):**
  1. Segredo: "marque o **cadeado**". A UI tem uma coluna **"Segredo"** com checkbox (`t-preto-2-ambiente.png`); o cadeado só aparece como TLS no gRPC.
  2. Resposta: "bonito, cru e pré-visualização". A UI mostra **Formatado** e **Bruto**; não há "Pré-visualização" no JSON.
  3. A tabela de atalhos da Ajuda tem 15 linhas; a janela "Atalhos de teclado" do app tem mais (Ctrl+Shift+Tab, ↑↓←→, Shift+F10) e diz "Esc · cancelar envio / fechar modal" enquanto a Ajuda diz "fechar janela". Duas listas que divergem.
- **Sugestão:** corrigir os dois rótulos; exportar a lista de atalhos de um único módulo usado pelas duas telas.

### UX2-03 · média · Busca da Ajuda frágil
- **Onde:** campo "Buscar na ajuda…" · evidência: `busca:*` na saída de `s4.js`, `shots/help-busca-vazia.png`
- **Problema:** é um `includes` literal sobre título + `kw` sem acentos e sem normalização. "variavel" acha 2 tópicos, mas "variável" (como se digita) não casa com `kw` e "variáveis" não contém "variável". "collection", "environment", "cookie", "pre-request" e "histórico" retornam zero (termos do Postman); "ctrl+s" não acha o tópico de atalhos; frase com espaço ("importar do postman") não acha nada. Não busca dentro do texto.
- **Sugestão:** normalizar com `s.normalize('NFD').replace(/\p{M}/g,'')` nos dois lados, buscar por todas as palavras separadamente (AND) e incluir sinônimos EN (`collection environment cookie pre-request history`) nos `kw`. O estado vazio podia sugerir "Tente: variável, cURL, proxy".

### UX2-04 · média · Faltam tópicos óbvios para quem vem do Postman
- **Onde:** índice da Ajuda (13 tópicos)
- **Problema:** não há (a) **"Vindo do Postman: o que mudou"** (tabela Collection=coleção, Environment=ambiente, Workspace=pasta no git, Globals, "Mocks" do Jaiminho ≠ mocks da nuvem; não há login, sincronização nem monitores), (b) **Histórico** (existe na barra lateral), (c) **Cookies** (a aba existe), (d) **o que da API `pm.*` é suportado**, (e) **Console** (aba de resposta). Os temas Padrão/Preto/Branco têm tópico, o Histórico não.
- **Sugestão:** um tópico "Vindo do Postman" logo depois de "Primeiros passos", com tabela de equivalências, e um tópico "Histórico, cookies e console".

### UX2-05 · média · Mensagem de variável não definida mostra o nome em minúsculas
- **Onde:** enviar `{{baseUrl}}/api/travellers` com "Sem ambiente" · `shots/ux01-sem-ambiente.png`
- **Problema:** o aviso sob a URL diz `{{baseUrl}}`, mas a resposta diz "Variável não definida: **{{baseurl}}**, {{token}}". Variáveis diferenciam maiúsculas; o nome minúsculo manda o usuário procurar uma variável que não existe. O `{{token}}` vem da auth herdada, o que é correto, mas não diz de onde veio.
- **Sugestão:** parar de aplicar `toLowerCase()` ao nome na mensagem de `send.js`/engine e acrescentar a origem ("{{token}} (auth da coleção)").

### UX2-06 · baixa · Tema Branco: linha ativa do editor e do gutter pesada demais
- **Onde:** qualquer CodeMirror no Branco · `shots/t-branco-3-grpc-erro.png`, `t-branco-4-importar.png`
- **Problema:** `.cm-activeLine` usa `--azul-profundo` (#214588) a 22%, que no Branco vira uma faixa lavanda forte sobre o JSON (e o número de linha também). Nos temas escuros é sutil.
- **Sugestão:** em `editorTheme.js` usar `color-mix(in srgb, var(--azul) 10%, transparent)` ou redefinir `--azul-profundo` no bloco `[data-theme="branco"]`.

### UX2-07 · baixa · Sem faixa de scroll com contraste nos 3 temas
- **Onde:** barras de rolagem (árvore, resposta) · `t-branco-1-workspace.png`
- **Problema:** o polegar usa `var(--line)`: ~1.3:1 no Branco (#d3dbec sobre #f4f6fb), ~1.4:1 no Preto, ~1.5:1 no Padrão. Dá para achar, mas é discreto em listas longas (a árvore de 3.000 itens).
- **Sugestão:** polegar em `color-mix(in srgb, var(--faint) 55%, transparent)` e `:hover` em `var(--faint)`.

### UX2-08 · baixa · Emojis residuais (resto de UX-11)
- **Onde:** modal "Salvar request" (📮 coleção, 📁 pasta, `Modals.jsx` ~linha 56) e "▶ Rodar (Runner)" do menu de contexto · `shots/ux19-saveas.png`
- **Sugestão:** usar `<Icon name="collection"/>`/`folder` já existentes no `icons.jsx` e tirar o "▶" do texto.

### UX2-09 · baixa · gRPC com erro: aba "Detalhes do erro" não abre sozinha
- **Onde:** invocar "Fail (erro com detalhes)" · `shots/ux05-grpc-erro-1100.png`
- **Problema:** a caixa manda "veja a aba Detalhes do erro", mas a aba ativa continua "Resposta" mostrando `[]` (vazio). Um clique a mais, no caso em que o usuário veio ver exatamente isso.
- **Sugestão:** quando `status != OK` e houver `errorDetails`, abrir a subaba "Detalhes do erro".

### UX2-10 · baixa · Acessibilidade: resíduos
- **Onde:** (a) bolinhas de cor do ambiente têm só `title` ("verde (DEV)", "#5D96DD") e nenhum `aria-label`; (b) toast fecha só com clique (sem ✕ nem teclado); (c) árvore da Ajuda sem `aria-current` no tópico ativo e sem setas (só Tab); (d) não há `@media (prefers-reduced-motion)` para o envelope e o ponto pulsante.
- **Sugestão:** `aria-label={título}` + `aria-pressed` nas bolinhas; `<button aria-label="Fechar aviso">✕</button>` no toast; `aria-current="page"` no `help-nav button.on`; um bloco `prefers-reduced-motion` desligando animações.

### UX2-11 · baixa · Ajuda em 1100×700: campo de busca encolhe
- **Onde:** F1 com janela pequena · `shots/help-1100.png`
- **Problema:** com o menu lateral rolando, o input "Buscar na ajuda…" fica com ~18 px de altura (esmagado pelo flex), e "Problemas comuns" some abaixo da dobra (só com rolagem, sem pista).
- **Sugestão:** `.help-nav input { flex: none; position: sticky; top: 0 }` e uma sombra de rolagem no fim da lista.

### UX2-12 · baixa · Microcopy ainda misturado (resto de UX-17)
- **Onde:** subabas de scripts ("Pre-request", "Post-response (testes)"), modal "Collection Runner", vazio da barra lateral ("Sem coleções.")
- **Sugestão:** "Antes da request"/"Depois da resposta (testes)" (como no gRPC, que já usa "Antes de invocar"), "Runner de coleções", e "Nenhuma carta por aqui" no vazio. Termos como Headers e Body podem ficar. Atualizar os mesmos nomes na Ajuda, que hoje repete os rótulos em inglês.

## 3. Temas: Padrão, Preto, Branco

As 6 telas foram capturadas nos três temas: `shots/t-{padrao,preto,branco}-{1-workspace,2-ambiente,3-grpc-erro,4-importar,5-config,6-menu-contexto}.png` e `t-*-7-estados.png` (hover, foco, selecionado).

| Verificação | Padrão | Preto | Branco |
|---|---|---|---|
| Texto principal / muted / status | 15.5 / 8.1 / 7.6 | 17.4 / 8.7 / 8.2 | 16.8 / 6.2 / 6.7 |
| Métodos (menor valor) | DELETE 4.9 | DELETE 5.3 | gRPC 5.0 |
| Cor de método em PATCH/SOAP/gRPC | ok | ok | ok (antes 1.5 a 2.8) |
| Foco visível (anel ciano / azul-petróleo) | sim | sim | sim |
| Editor de código | transparente, cores da paleta | idem | idem, mas linha ativa pesada (UX2-06) |
| Bordas, cards, modais | ok | borda `#2b2b32` sutil mas visível | ok |
| Selecionado / hover / desabilitado | ok | ok | ok ("Salvar" desabilitado legível) |
| Elementos com cor fixa fora do tema | nenhum visto | nenhum visto | nenhum visto |

Notas: o Preto é realmente preto puro (`--bg0: #000`) com neutros, sem resquício de azul-marinho, e a barra superior acompanha. O botão paleta troca em ciclo (Padrão → Preto → Branco), com tooltip dizendo qual é o tema atual. Os cards de tema em Configurações → Este PC têm nome + descrição ("Preto puro, neutro"). A única falha de tema encontrada foi UX2-06 (e a discrição das scrollbars, UX2-07). A checagem de "cor fixa" foi por inspeção visual das 18 capturas e leitura do `styles.css`, não por varredura automática de todos os componentes.

## 4. Página de Ajuda (F1 / botão ?)

**O que está bom:** abre por F1 inclusive na tela de boas-vindas; modal largo de duas colunas (índice + artigo), 13 tópicos curtos com exemplos reais (`pm.test`, passos numerados, avisos "Warn/Tip"), rodapé "funciona offline", botões "← anterior / próximo →" no fim, `HelpLink` ("Ver tutorial") nos pontos difíceis como o Importar, e funciona nos 3 temas (`help-preto-variaveis.png`, `help-branco-variaveis.png`). O foco inicial cai no campo de busca. O tópico "Problemas comuns" é o tipo de FAQ que falta em muita ferramenta.

**Afirmações conferidas contra a UI real (21; 18 batem):**

| # | Afirmação da Ajuda | UI real | OK |
|---|---|---|---|
| 1 | "Criar workspace…" na tela inicial | botão idêntico | sim |
| 2 | "Experimentar com os servidores mock…" | botão idêntico | sim |
| 3 | "Importar do Postman" na tela inicial | "Importar do Postman (backup ou coleções)…" | sim |
| 4 | Painel esquerdo: "clique em + para criar uma coleção" | "＋ Coleção" | sim |
| 5 | Ctrl+I → "Colar texto" | abas "Colar texto / Arquivo / URL (Swagger / WSDL)" | sim |
| 6 | Abas da request: Params, Autorização, Headers, Body, Scripts, Variáveis, Configurações | idênticas | sim |
| 7 | Auth "Herdar do pai" | primeira opção do seletor | sim |
| 8 | Headers automáticos visíveis | `auto-headers` | sim |
| 9 | Scripts "Pre-request" e "Post-response (testes)" | idênticos (mas em inglês, UX2-12) | sim |
| 10 | Abas de resposta: Corpo, Headers, Cookies, Testes, Console, "Tempos e request" | idênticas | sim |
| 11 | Ctrl+E abre variáveis efetivas | `vars-panel` abre | sim |
| 12 | Tema pelo botão da paleta, "cada clique passa para o próximo" | ciclo confirmado | sim |
| 13 | "Configurações → Este PC": tema e posição da resposta | cards de tema + "Embaixo / Ao lado da request" | sim |
| 14 | Configurações em Ctrl+, com abas Workspace, Certificados, Proxy | abas existem (nomes completos "…(partilhado)") | sim |
| 15 | Clique direito na coleção → "Exportar para Postman (v2.1)…", "Exportar .jaiminho", "Sincronizar com o Swagger…", "Rodar (Runner)" | itens presentes (Sincronizar só em coleção importada) | sim |
| 16 | gRPC: "Enviar mensagem", "Finalizar envio", aba "Detalhes do erro" | `↑ Enviar mensagem`, `Finalizar envio`, aba existe | sim |
| 17 | Botão **Mocks** no topo | "Mocks" | sim |
| 18 | "Exportar workspace…" no topo | idêntico | sim |
| 19 | Segredo: "marque o cadeado" | coluna "Segredo" com checkbox | **não** |
| 20 | Resposta: "bonito, cru e pré-visualização" | "Formatado" / "Bruto" | **não** |
| 21 | Atalhos: lista de 15 | app tem mais linhas e outro texto de Esc | **parcial** |

**Layout/navegação:** boa leitura (13 px, largura de linha confortável). Em 1100×700 o índice rola e o campo de busca encolhe (UX2-11). Sem `aria-current` nem setas no índice (UX2-10). Busca: ver UX2-03. Tópicos que faltam: UX2-04.

## 5. Desempenho percebido (workspace com 3.000 requests, 60 pastas × 50)

| Ação | Tempo | Maior travamento (long task) | Impressão |
|---|---|---|---|
| Abrir workspace | 1.4 s | 0 ms | rápido (árvore só desenha o que está aberto: 62 linhas) |
| Expandir pasta de 50 / recolher | 104 / 56 ms | 0 ms | instantâneo |
| Abrir request pela árvore | 46 ms | 0 ms | instantâneo |
| Filtro "Req 59-4" (13 resultados) | 117 ms | 0 ms | instantâneo |
| Filtro "Req" (**3.000 resultados**) | 1.2 s | **469 ms** | trava meio segundo, 3.061 linhas no DOM (UX2 abaixo) |
| Digitar "Req 12-3" caractere a caractere | 862 ms (com 40 ms de delay entre teclas) | 217 ms | perceptível só no início |
| Rolar a árvore / expandir 10 pastas | 0 ms / 58 ms | ok | fluido |
| Resposta JSON 2 MB | 491 ms | 96 ms | ok |
| Resposta JSON 20 MB | 1.25 s | 458 ms | aceitável; editor carrega e rola sem engasgo |
| Filtro `$[0]` no corpo de 20 MB | 636 ms | 120 ms | ok |
| Voltar para a aba "Corpo" com 20 MB | 487 ms | **398 ms** | notável |
| gRPC com 5.000 mensagens | 2.8 s (814 ms de entrega) | 105 ms | ok, "5000 mensagens" no status |
| Reenviar 5× | sem degradação | 106 ms | ok; heap final 202 MB |

Conclusão: nada trava no uso normal. Ressalvas de baixo impacto: o filtro com termo muito genérico monta 3.000 linhas e congela ~0,5 s; sugestão de virtualizar a lista filtrada (ou limitar a 300 linhas com "mostrar mais"). O mesmo vale para a aba Corpo com corpos acima de 10 MB (mostrar o aviso "resposta grande, formatação adiada"). Não registrei como achado numerado por ser raro na prática; fica como nota de melhoria.

## 6. Acessibilidade rápida

| Item | Resultado |
|---|---|
| Modais novos (Importar, Configurações, Ajuda, Mocks) | `role=dialog`, `aria-modal=true`, `aria-labelledby`; foco inicial no 1º controle (busca na Ajuda); Tab fica preso (40 tentativas sem escapar); Esc fecha; foco volta ao botão que abriu (`btn-import`, `btn-settings`, `btn-help`) |
| Menu de contexto | `role=menu`, foco no 1º item (setas e Esc pelo código, não exercitados) |
| Foco visível | anel `--focus` de 2 px nos três temas (ciano nos escuros, azul-petróleo no Branco), ver `t-*-7-estados.png` |
| `aria-label` | todos os botões do topo têm; botão de busca da Ajuda tem; faltam as bolinhas de cor do ambiente (UX2-10) |
| Árvore / abas | `role=tree`/`treeitem`/`tablist`/`tab`, `aria-expanded` não conferido; alvo de fechar aba 24×24 |
| Anúncios | toasts em `role=status aria-live=polite` |

## 7. O que está bom (manter)

- Os três temas compartilham os mesmos componentes sem exceção visível; o Preto é uma opção real para OLED.
- URL com `{{var}}` colorida e tooltip com valor e escopo; avisos de variável ausente antes de enviar.
- Rename inline, F2/Del e navegação por setas na árvore; menu de contexto nas abas.
- Estado "Entregando… 1,2 s" com cancelar, e mensagens de erro de rede em PT-BR.
- Desempenho com workspace grande: árvore só renderiza o que está expandido (62 linhas no DOM), resposta de 20 MB e gRPC de 5.000 mensagens sem travar a UI.

## 8. Top 5 para a próxima rodada

1. UX2-05: mensagem de variável com nome em minúsculas (1 linha).
2. UX2-02: três textos da Ajuda contradizem a UI ("cadeado", "pré-visualização", atalhos).
3. UX2-03 + UX2-04: busca com normalização/sinônimos e tópico "Vindo do Postman".
4. UX2-01: campo de busca do seletor gRPC com 20 px.
5. UX2-06: linha ativa do editor no tema Branco.
