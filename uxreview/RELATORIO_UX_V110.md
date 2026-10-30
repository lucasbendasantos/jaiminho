# Jaiminho 1.1: revisão de UI/UX, só das novidades

> 2026-10-30 · escopo: multi-seleção/arrastar, Ctrl+Enter, Ctrl+F, layout lado a lado, versão web (diálogos). Métodos: app real (Playwright `_electron` + xvfb) e Chromium contra o servidor web. Scripts: `qa/e2e-v110-bordas.js`, `uxreview/ux-v110.js`. Capturas: `qa/shots/v110/`.

## Resumo

Duas falhas reais encontradas e **corrigidas**, nenhuma pendente de severidade alta. Os três temas passam em contraste.

| ID | Sev. | Onde | Achado | Status |
|---|---|---|---|---|
| UX11-01 | **alta** | Desktop, janela ≤ ~1100 px | O app inteiro ficava mais largo que a janela (grid sem `minmax(0,1fr)`): botão **Enviar** e botões da barra superior cortados, mais evidente no lado a lado. | CORRIGIDO (`.app` e `.main` com `minmax(0, 1fr)`); teste mede que Enviar e `.work` cabem em 1000 px · `lado-a-lado-1000px.png` |
| UX11-02 | média | Web, diálogos | Sem `aria-modal`; Tab saía do diálogo e o app por baixo também tratava a tecla; foco não voltava ao botão de origem; botão "↑" com 24 px. | CORRIGIDO (aria-modal, Tab/Shift+Tab presos, foco restaurado, alvo 30 px) · `web-seletor-*.png` |
| UX11-03 | baixa | Desktop, lado a lado | Abas da request ("Params…Configurações") não cabem em 1000 px. | ACEITO: rolam na horizontal (`.subtabs{overflow-x:auto}`), nada sobrepõe a resposta |
| UX11-04 | baixa | Web, celular | A página exige ~800 px de largura (UI de desktop). Os diálogos cabem em 390 px. | LIMITAÇÃO documentada: use tablet/notebook |
| UX11-05 | baixa | Web | Ctrl+N e Ctrl+W pertencem ao navegador. | LIMITAÇÃO documentada em `docs/web-docker.md` |

## Verificações que passaram

| Recurso | Evidência |
|---|---|
| Ctrl+Enter | envia e **não** insere linha no JSON nem no editor de scripts |
| Ctrl+F | abre o painel no editor focado ou na resposta; fora do editor, foca o filtro da árvore; Esc fecha e o foco volta ao editor; painel em PT-BR |
| Contraste dos botões da busca | padrão 12.1:1, preto 15.2:1, branco 16.2:1 (mín. 4.5) · `busca-*.png` |
| Botão de layout | `aria-label` "Alternar layout request/resposta", operável por teclado, escolha persiste após recarregar |
| Multi-seleção | `aria-selected=true` nas linhas; Ctrl/Shift+clique, Esc limpa, Delete com confirmação (cancelar não apaga); pasta + filho selecionados movem só a pasta; soltar pasta nela mesma é recusado |
| Web: diálogo | `role=dialog`, `aria-modal`, nome; foco entra; Tab/Shift+Tab presos; Esc fecha e devolve o foco; todos os botões com nome |
| Web: temas | texto do diálogo 14.0 / 16.6 / 18.2:1; botão primário 10.4 / 10.4 / 5.4:1 |
| Erros de página | nenhum |

Como rodar: `cd apps/desktop && xvfb-run -a node ../../qa/e2e-v110-bordas.js && node ../../uxreview/ux-v110.js`
