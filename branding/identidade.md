# Jaiminho — Identidade visual

> v2 · 2026-10-23 · autor: CLAUDE (a partir da arte do autor) · status: ativo

**Conceito:** o carteiro que entrega o seu request. Mascote com bicicleta e bolsa de couro, entregando um envelope `{ }` num fundo de "circuito" azul/violeta (APIs, nós, código). A arte é do Lucas. A v1 (envelope abstrato) ficou em `_v1_envelope\`, só como histórico.

> Direitos: o mascote remete a um personagem do Chaves. Para uso pessoal e entre amigos, tudo bem. Se um dia o Jaiminho for distribuído publicamente, rever o mascote (direitos do Grupo Chespirito/Televisa).

## Arquivos (`branding/`)
| Arquivo | Uso |
|---|---|
| `jaiminho-original.png` | arte original do autor (1320×1344), **fonte: não editar** |
| `jaiminho-icon-1024.png` | ícone completo, recorte quadrado com cantos arredondados (transparente) |
| `jaiminho-face-1024.png` | só o rosto, para tamanhos pequenos (o corpo inteiro não se lê abaixo de 48 px) |
| `jaiminho.ico` | Windows: 16–48 px = rosto, 64–256 px = ícone completo. Usado pelo `electron-builder` (`build/icon.ico`) |
| `jaiminho-{16,24,32,48}.png` | rosto (favicon, bandeja, abas) |
| `jaiminho-{64,128,256,512}.png` | ícone completo (atalhos, Linux, README) |
| `jaiminho-splash.png` | tela de abertura e "Sobre" |

## Paleta (medida na arte)
| Token | Hex | De onde vem | Uso na UI |
|---|---|---|---|
| `--noite-profunda` | `#03041F` | fundo externo | fundo do tema escuro (camada 0) |
| `--noite` | `#09132D` | fundo do quadro | painéis do tema escuro |
| `--azul-profundo` | `#214588` | circuito | barras, seleção |
| `--azul` | `#5D96DD` | moldura (lado esquerdo) | links, foco, PUT |
| `--violeta` | `#9040D8` | moldura (lado direito) e ondas | destaques, PATCH |
| `--brilho` | `#7ED9F1` | envelope e `{code}` brilhando | **ação principal** (botão Enviar, cursor do editor), gRPC |
| `--verde` | `#68A048` | bicicleta e lenço | sucesso, 2xx, gRPC `OK`, GET |
| `--dourado` | `#E0B050` | faixa do quepe | avisos, 3xx, POST |
| `--couro` | `#805030` | bolsa | SOAP/XML, ícones de pasta/coleção |
| `--farda` | `#707888` | uniforme e quepe | texto secundário, bordas |
| `--erro` | `#E05656` | complementar (não está na arte) | 4xx/5xx, DELETE, erro gRPC |

**Gradiente da marca:** `linear-gradient(135deg, #5D96DD 0%, #9040D8 100%)` (a moldura do ícone): cabeçalho da janela, splash, seleção ativa da árvore.
**Botão Enviar:** fundo `--brilho` com texto `--noite` (contraste alto); hover com o gradiente.

**Tema claro:** fundo `#F4F6FB`, painéis `#FFFFFF`, texto `#09132D`, os mesmos acentos escurecidos ~15% onde o contraste pedir (mín. 4.5:1 para texto).

### Cores de método e protocolo
| GET | POST | PUT | PATCH | DELETE | gRPC | SOAP |
|---|---|---|---|---|---|---|
| `#68A048` | `#E0B050` | `#5D96DD` | `#9040D8` | `#E05656` | `#7ED9F1` | `#B07850` |

## Onde o mascote aparece
- Ícone do app, instalador e atalho.
- Splash (1 s), "Sobre", tela de boas-vindas sem workspace.
- Estados vazios: "Caixa de saída vazia" (histórico), "Nenhuma carta por aqui" (coleção vazia).
- **Não** usar o mascote no fluxo de trabalho (barra de URL, resposta): ali a UI é sóbria, só com a paleta.

## Elementos de apoio
- Fundo de "circuito" (nós e linhas finas em `--azul-profundo` a 20% de opacidade) só no splash e nas telas vazias.
- Envelope com `{ }` como ícone pequeno de "Enviar" e do bundle `.jaiminho`.
- Cantos arredondados: 10 px nos painéis, 6 px nos botões, como a moldura do ícone.

## Tipografia (embutida no app, sem Google Fonts)
- UI: **Inter** (OFL) · Código/payload: **JetBrains Mono** (OFL).

## Tom de voz (microcopy)
Curto e com o tema de correio: "Enviar", "Entregue em 143 ms", "Não entregue: conexão recusada", "Caixa de saída" (histórico), "Correio" (partilha na LAN).
