// Ajuda e tutoriais: 100% offline (texto embutido no app).
import React, { useState, useMemo } from 'react';
import { Modal } from './Modals';
import { openModal, closeModal } from '../store';

const K = ({ children }) => <span className="kbd">{children}</span>;
const Code = ({ children }) => <pre className="help-code mono">{children}</pre>;
const Tip = ({ children }) => <div className="help-tip">{children}</div>;
const Warn = ({ children }) => <div className="help-tip warn">{children}</div>;

export const SHORTCUTS = [['Ctrl+Enter', 'Enviar / invocar'], ['Ctrl+S', 'Salvar'], ['Ctrl+Shift+S', 'Salvar como (cópia)'], ['Ctrl+N', 'Nova request'], ['Ctrl+O', 'Abrir workspace'], ['Ctrl+W', 'Fechar aba'], ['Ctrl+Tab / Ctrl+Shift+Tab', 'Próxima / anterior aba'], ['Ctrl+L', 'Ir para a URL'], ['Ctrl+F', 'Buscar no corpo/resposta (no painel esquerdo, filtra a árvore)'], ['Ctrl+I', 'Importar'], ['Ctrl+E', 'Variáveis efetivas'], ['Ctrl+,', 'Configurações'], ['Ctrl+R', 'Runner da seleção'], ['F1', 'Tutoriais e ajuda'], ['F2', 'Renomear item da árvore'], ['Del', 'Apagar item da árvore (ou os selecionados)'], ['Ctrl+clique / Shift+clique', 'Selecionar várias requests na árvore (arraste para mover todas)'], ['↑ ↓ ← →', 'Navegar na árvore'], ['Shift+F10', 'Menu de contexto'], ['Esc', 'Cancelar envio / fechar modal']];

export const SECTIONS = [
  {
    id: 'inicio', titulo: 'Primeiros passos', kw: 'workspace coleção request enviar começar inicio criar pasta',
    corpo: () => <>
      <p>O Jaiminho guarda tudo numa <b>pasta de workspace</b> (arquivos YAML). Dá para pôr essa pasta no git ou numa pasta de rede e partilhar com os amigos. Segredos ficam fora dela.</p>
      <ol>
        <li><b>Crie um workspace</b> na tela inicial (<i>Criar workspace…</i>) e escolha onde a pasta vai ficar. Para só experimentar, use <i>Experimentar com os servidores mock…</i>: ele cria um workspace de exemplo já ligado aos mocks locais.</li>
        <li>No painel da esquerda, clique em <b>+</b> para criar uma <b>coleção</b> e, dentro dela, pastas e requests.</li>
        <li>Escolha o tipo (HTTP, SOAP ou gRPC), digite a URL e aperte <K>Ctrl+Enter</K> para enviar.</li>
        <li>A resposta aparece embaixo (ou ao lado, em <i>Configurações → Este PC</i>), com corpo, headers, tempos e testes.</li>
      </ol>
      <Tip>Colou um cURL? Use <K>Ctrl+I</K> → <i>Colar texto</i>: a request é criada e aberta sozinha.</Tip>
      <p>Salvar é <K>Ctrl+S</K>. Uma request não salva fica com um ponto na aba; ao fechar a janela o Jaiminho pergunta antes de descartar.</p>
    </>,
  },
  {
    id: 'variaveis', titulo: 'Variáveis e ambientes', kw: 'variavel ambiente env global segredo secreto escopo precedencia {{ dinamica random guid timestamp local',
    corpo: () => <>
      <p>Escreva <code>{'{{nome}}'}</code> em qualquer campo (URL, headers, body, auth). Na URL, variáveis definidas ficam destacadas; as que faltam avisam com o nome da variável.</p>
      <h4>Onde a variável pode morar (da mais fraca para a mais forte)</h4>
      <ol>
        <li><b>Globais</b> (só neste PC)</li>
        <li><b>Coleção</b></li>
        <li><b>Ambiente</b> (Dev, QUA, Prod… escolha no seletor do topo)</li>
        <li><b>Pasta</b> e depois a <b>própria request</b></li>
        <li><b>Dados do runner</b> (linha do CSV/JSON)</li>
        <li><b>Valor local</b> (o que um script definiu com <code>pm.environment.set</code>)</li>
      </ol>
      <Tip>Ctrl+E abre o painel de <b>variáveis efetivas</b>: mostra o valor final de cada uma e de onde ele veio.</Tip>
      <h4>Valor partilhado × valor local × segredo</h4>
      <ul>
        <li><b>Partilhado</b> vai no YAML do workspace (todos os amigos veem).</li>
        <li><b>Local</b> vale só no seu PC (ex.: a porta do seu serviço) e nunca vai para o git.</li>
        <li><b>Segredo</b> (marque a caixa da coluna <i>Segredo</i>): o valor é cifrado no seu PC (DPAPI no Windows) e <b>não</b> vai para o workspace. Quem recebe o workspace precisa preencher o próprio valor.</li>
      </ul>
      <h4>Variáveis dinâmicas</h4>
      <p>Funcionam como no Postman: <code>{'{{$guid}}'}</code>, <code>{'{{$timestamp}}'}</code>, <code>{'{{$isoTimestamp}}'}</code>, <code>{'{{$randomInt}}'}</code>, <code>{'{{$randomEmail}}'}</code>… (são mais de 100). Variáveis do sistema: <code>{'{{$env.NOME}}'}</code>.</p>
    </>,
  },
  {
    id: 'http', titulo: 'Requests HTTP / JSON', kw: 'http json body auth header params form urlencoded multipart script teste pm bearer basic oauth digest apikey',
    corpo: () => <>
      <p>As abas da request: <b>Params</b> (query e variáveis de caminho <code>:id</code>), <b>Autorização</b>, <b>Headers</b>, <b>Body</b>, <b>Scripts</b>, <b>Variáveis</b> e <b>Configurações</b>.</p>
      <ul>
        <li><b>Body:</b> JSON, XML, texto, x-www-form-urlencoded, form-data (com arquivos), binário e GraphQL.</li>
        <li><b>Auth:</b> Basic, Bearer, API Key, Digest, OAuth 2 (busca o token sozinha), AWS, Hawk, NTLM e outras. Em pastas/coleções, <i>Herdar do pai</i> usa a auth de cima (a tela diz de onde vem).</li>
        <li><b>Headers automáticos:</b> o Jaiminho mostra os que ele manda sozinho (User-Agent, Content-Type, Content-Length…); para trocar um, crie o header com o mesmo nome.</li>
        <li><b>Scripts:</b> <i>Antes da request</i> e <i>Depois da resposta (testes)</i> com a API <code>pm</code> do Postman.</li>
      </ul>
      <Code>{`pm.test("200 e tem id", () => {
  pm.response.to.have.status(200);
  pm.expect(pm.response.json().id).to.exist;
  pm.environment.set("ultimoId", pm.response.json().id);
});`}</Code>
      <p>Na resposta há abas de <b>Corpo</b> (<i>Formatado</i> e <i>Bruto</i>), <b>Headers</b>, <b>Cookies</b>, <b>Testes</b>, <b>Console</b> e <b>Tempos e request</b> (DNS, conexão, TLS, primeiro byte).</p>
    </>,
  },
  {
    id: 'xml', titulo: 'XML e SOAP', kw: 'xml soap wsdl xsd xpath envelope soapaction fault',
    corpo: () => <>
      <p>Para SOAP, o jeito mais fácil é importar o <b>WSDL</b>: <K>Ctrl+I</K> → <i>URL</i> (ex.: <code>http://servico/ws?wsdl</code>) ou <i>Arquivo</i>. O Jaiminho cria uma request por operação, com o envelope pronto, o <code>SOAPAction</code> certo e o schema (XSD) guardado na pasta <code>wsdl/</code> do workspace.</p>
      <ul>
        <li>Suporta SOAP 1.1 e 1.2.</li>
        <li>Um <b>SOAP Fault</b> aparece destacado na resposta, com código e mensagem.</li>
        <li>O XML do body pode ser <b>validado contra o XSD</b> antes de enviar (<i>Configurações da request → Validar request e resposta contra o XSD do WSDL</i>).</li>
        <li>Na resposta XML, o filtro aceita <b>XPath</b> (os prefixos de namespace do documento são reconhecidos sozinhos).</li>
      </ul>
      <Tip>XML puro (sem SOAP)? Escolha <i>Body → XML</i>; o Content-Type <code>application/xml</code> é posto para você.</Tip>
    </>,
  },
  {
    id: 'grpc', titulo: 'gRPC', kw: 'grpc reflection proto protoset stream streaming bidi metadata tls plaintext servico metodo schema deadline',
    corpo: () => <>
      <p>Crie uma request do tipo <b>gRPC</b> e digite o endereço: <code>grpc://host:50051</code> (sem TLS) ou <code>grpcs://host:443</code> (com TLS). Escolha o método na lista e edite a mensagem em JSON; <K>Ctrl+Enter</K> invoca.</p>
      <h4>De onde vem o schema (aba <i>Schema</i>)</h4>
      <ul>
        <li><b>Reflection</b> (padrão): o Jaiminho pergunta ao servidor quais serviços e mensagens existem (tenta v1 e depois v1alpha). Nada para configurar.</li>
        <li><b>Arquivos .proto:</b> <i>Adicionar .proto/.protoset</i> copia o arquivo <b>e os imports</b> para a pasta <code>protos/</code> do workspace, e todos os amigos passam a ter o mesmo schema.</li>
        <li><b>Protoset</b> (<code>.pb</code> gerado com <code>protoc --descriptor_set_out</code>) e <b>Congelar schema</b>: guarda o que a reflection devolveu para usar depois sem o servidor.</li>
      </ul>
      <h4>Tipos de chamada</h4>
      <p>Unary, server streaming, client streaming e bidirecional. Nos que enviam várias mensagens, use a barra do stream: <i>Enviar mensagem</i> a cada uma e <i>Finalizar envio</i> no fim; <i>Cancelar</i> interrompe a qualquer momento.</p>
      <h4>Metadata, scripts e erros</h4>
      <ul>
        <li>Metadata são os “headers” do gRPC (aba <i>Metadata</i>); aceitam variáveis.</li>
        <li>Scripts: <i>Antes de invocar</i>, <i>A cada mensagem</i> e <i>Depois da resposta</i>, com <code>pm.test</code>, <code>pm.expect</code> e <code>pm.response.messages</code>.</li>
        <li>Erros com detalhes (<code>grpc-status-details-bin</code>) são decodificados na aba <i>Detalhes do erro</i>.</li>
        <li>Mensagens são validadas antes de enviar (tipos, enums, int64, oneof, Timestamp).</li>
      </ul>
      <Warn>Erro <code>UNAVAILABLE</code> logo ao conectar? Quase sempre é TLS trocado: servidor com TLS pede <code>grpcs://</code>; servidor sem TLS pede <code>grpc://</code>. A mensagem de erro diz qual dos dois parece ser.</Warn>
    </>,
  },
  {
    id: 'importar', titulo: 'Importar (Swagger, cURL, Postman…)', kw: 'importar swagger openapi curl postman grpcurl wsdl bundle url arquivo colar springdoc',
    corpo: () => <>
      <p><K>Ctrl+I</K> abre o importador. O tipo é detectado sozinho, em três jeitos: <i>Colar texto</i>, <i>Arquivo</i> e <i>URL</i>.</p>
      <table className="help-table"><tbody>
        <tr><td><b>Swagger / OpenAPI</b> 2, 3 e 3.1</td><td>URL do JSON/YAML (<code>/v3/api-docs</code>), da página do Swagger UI/springdoc ou arquivo. Cria uma coleção com pastas por tag, parâmetros, exemplos de body e um ambiente por servidor. Depois, clique direito na coleção → <i>Sincronizar com o Swagger…</i> mostra o que mudou. Se você só tem a página do Swagger UI salva como HTML, importe o arquivo: o Jaiminho tenta baixar a especificação original (precisa de rede/VPN) e, sem rede, cria só método e caminho de cada operação.</td></tr>
        <tr><td><b>cURL</b></td><td>Cole o comando (bash, cmd do Windows ou PowerShell). Vira uma request com método, headers, body, auth e flags como <code>-k</code> (desliga SSL) e <code>--cert</code>.</td></tr>
        <tr><td><b>grpcurl</b></td><td>Cole o comando; vira uma request gRPC com endereço, método, mensagem e metadata.</td></tr>
        <tr><td><b>Postman</b></td><td>Coleções v2.0/2.1, ambientes, globais e o backup completo (<i>Importar do Postman</i> na tela inicial).</td></tr>
        <tr><td><b>WSDL</b></td><td>Ver o guia de XML e SOAP.</td></tr>
        <tr><td><b>.jaiminho</b></td><td>Pacote de workspace/coleções que um amigo exportou.</td></tr>
      </tbody></table>
      <Tip>O download da URL passa pelo proxy, pelas CAs e pelos certificados do workspace, então funciona na VPN com serviços internos.</Tip>
    </>,
  },
  {
    id: 'exportar', titulo: 'Exportar e compartilhar', kw: 'exportar compartilhar partilhar curl codigo postman bundle git amigos grpcurl',
    corpo: () => <>
      <ul>
        <li><b>Request → cURL / grpcurl / código:</b> botão <b>{'</>'}</b> da request (cURL, grpcurl e código em várias linguagens) ou clique direito na request → <i>Copiar como cURL</i> / <i>Copiar como grpcurl</i>. Auth e Content-Type vão junto.</li>
        <li><b>Coleção → Postman:</b> clique direito na coleção → <i>Exportar para Postman (v2.1)…</i>; requests gRPC levam um campo extra que o Jaiminho reconhece ao reimportar.</li>
        <li><b>Workspace inteiro → arquivo .jaiminho:</b> botão <i>Exportar workspace…</i> no topo (ou, só de uma coleção, <i>Exportar .jaiminho</i> no clique direito). Vai sem segredos e sem dados locais. Quem importa escolhe: manter as duas versões, sobrescrever ou pular o que já existe.</li>
        <li><b>Git ou pasta de rede:</b> é só a pasta do workspace. O <code>.gitignore</code> já deixa de fora a pasta <code>.jaiminho/</code> (segredos, histórico, valores locais).</li>
      </ul>
      <Warn>Segredos nunca viajam. Depois de abrir um workspace de outra pessoa, o Jaiminho avisa quais segredos estão sem valor no seu PC para você preencher nos ambientes.</Warn>
    </>,
  },
  {
    id: 'tls', titulo: 'SSL, CA, mTLS e proxy', kw: 'ssl tls certificado ca mtls pfx p12 pem cliente verificar proxy vpn autoassinado',
    corpo: () => <>
      <p>Tudo em <b>Configurações</b> (<K>Ctrl+,</K>):</p>
      <ul>
        <li><b>Desligar a verificação de SSL:</b> global em <i>Workspace</i>, ou só numa request em <i>Configurações da request</i>. Use só em ambiente de teste.</li>
        <li><b>CA própria da empresa:</b> em <i>Certificados</i>, adicione o arquivo .pem/.crt da CA. As CAs do Windows (VPN) já são usadas por padrão.</li>
        <li><b>mTLS (certificado de cliente):</b> em <i>Certificados</i>, informe o host (com ou sem porta; <code>*.empresa.com</code> também vale) e o certificado + chave (PEM) <b>ou</b> um .pfx/.p12. A senha do PFX fica cifrada no seu PC. Vale para HTTP, SOAP e gRPC.</li>
        <li><b>Proxy:</b> padrão é o do sistema (lê PAC/WPAD do Windows). Dá para fixar um manual, com usuário e senha, ou desligar.</li>
      </ul>
      <Tip>Os caminhos de CA/certificados no workspace partilhado podem ser relativos (ex.: <code>certs/ca.pem</code>), assim funcionam no PC de todos.</Tip>
      <p>Erro de certificado? A mensagem diz se faltou a CA, se o servidor exige certificado de cliente ou se a senha do PFX está errada.</p>
    </>,
  },
  {
    id: 'runner', titulo: 'Runner e testes em lote', kw: 'runner csv json iteracao dados junit lote testes colecao',
    corpo: () => <>
      <p><K>Ctrl+R</K> (ou clique direito na coleção/pasta → <i>Rodar (Runner)</i>) executa todas as requests em ordem, mostrando passou/falhou por teste.</p>
      <ul>
        <li><b>Arquivo de dados:</b> CSV (vírgula, <code>;</code> ou tab; aceita aspas com quebra de linha) ou JSON. Cada linha vira uma iteração e as colunas viram variáveis.</li>
        <li><b>Relatório JUnit:</b> exporte o resultado em XML para CI.</li>
        <li>Funciona também para requests gRPC (cada iteração invoca o método).</li>
      </ul>
    </>,
  },
  {
    id: 'mocks', titulo: 'Servidores mock', kw: 'mock servidor teste exemplo porta 4010 50051',
    corpo: () => <>
      <p>O botão <b>Mocks</b> (topo) liga servidores locais para treinar sem depender de nada:</p>
      <ul>
        <li>HTTP/JSON e XML/SOAP (com WSDL) em <code>http://localhost:4010</code></li>
        <li>HTTPS em <code>4443</code> e HTTPS com mTLS em <code>4444</code> (a CA e os certificados de cliente são gerados para você)</li>
        <li>gRPC em <code>50051</code> (plaintext, com reflection), <code>50052</code> (TLS) e <code>50053</code> (mTLS)</li>
        <li>Swagger/OpenAPI em <code>/v3/api-docs</code> para treinar o import</li>
      </ul>
    </>,
  },
  {
    id: 'temas', titulo: 'Temas e aparência', kw: 'tema escuro claro preto branco padrao aparencia layout lado a lado embaixo resposta',
    corpo: () => <>
      <p>Três temas: <b>Padrão</b> (azul-marinho da identidade do Jaiminho), <b>Preto</b> (preto puro, bom para telas OLED e ambientes escuros) e <b>Branco</b> (claro, alto contraste). Troque pelo botão da paleta no topo (cada clique passa para o próximo) ou em <i>Configurações → Este PC</i>; a escolha fica salva.</p>
      <p>A posição da resposta (embaixo ou ao lado da request) alterna pelo botão de colunas/linhas ao lado de <i>Salvar</i>, em cada request. Arraste a borda do painel esquerdo para mudar a largura.</p>
    </>,
  },
  {
    id: 'atalhos', titulo: 'Atalhos de teclado', kw: 'atalho teclado ctrl shortcut tecla',
    corpo: () => <table className="help-table"><tbody>
      {SHORTCUTS.map(([k, l]) => <tr key={k}><td><K>{k}</K></td><td>{l}</td></tr>)}
    </tbody></table>,
  },
  {
    id: 'postman', titulo: 'Vindo do Postman', kw: 'postman collection environment pm script equivalente migrar importar vindo',
    corpo: () => <>
      <table className="help-table"><tbody>
        <tr><td><b>Collection</b></td><td>Coleção (pasta no workspace). Pastas dentro dela funcionam igual.</td></tr>
        <tr><td><b>Environment</b></td><td>Ambiente (seletor no topo). Variáveis <i>Segredo</i> não vão para o workspace.</td></tr>
        <tr><td><b>Globals</b></td><td>Variáveis globais, menor prioridade na resolução.</td></tr>
        <tr><td><b>Pre-request / Tests</b></td><td>Scripts <i>Antes da request</i> e <i>Depois da resposta (testes)</i>, com <code>pm.*</code>.</td></tr>
        <tr><td><b>Collection Runner</b></td><td>Runner (Ctrl+R), com arquivo CSV/JSON de dados.</td></tr>
        <tr><td><b>Cookie jar</b></td><td>Cookies, no menu do topo.</td></tr>
      </tbody></table>
      <p>Para trazer seu material: <i>Importar → Postman</i> (collection v2.x e environments). Suporte a <code>pm.*</code>: <code>pm.variables</code>, <code>pm.environment</code>, <code>pm.collectionVariables</code>, <code>pm.globals</code>, <code>pm.request</code>, <code>pm.response</code>, <code>pm.test</code>, <code>pm.expect</code>, <code>pm.sendRequest</code>, <code>pm.cookies</code>. Chamadas ao serviço em nuvem do Postman não existem aqui (tudo é local).</p>
    </>,
  },
  {
    id: 'historico', titulo: 'Histórico, cookies e console', kw: 'historico cookies cookie console log reenviar',
    corpo: () => <>
      <ul>
        <li><b>Histórico:</b> cada envio fica salvo no seu PC (não no workspace compartilhado). Abra pelo menu do topo para reenviar uma chamada antiga.</li>
        <li><b>Cookies:</b> o Jaiminho guarda os cookies recebidos e reenvia nas próximas chamadas ao mesmo domínio. Dá para ver e apagar na janela de cookies.</li>
        <li><b>Console:</b> na resposta, aba <i>Console</i> mostra <code>console.log</code> dos scripts e os avisos da execução.</li>
      </ul>
    </>,
  },
  {
    id: 'problemas', titulo: 'Problemas comuns', kw: 'erro problema faq nao funciona variavel nao definida unavailable certificado timeout cancelado conexao recusada segredo',
    corpo: () => <>
      <table className="help-table"><tbody>
        <tr><td><b>“Variável não definida: x”</b></td><td>Falta escolher o ambiente no topo, ou a variável não existe nele. Ctrl+E mostra onde ela está definida.</td></tr>
        <tr><td><b>Certificado não confiável</b></td><td>Adicione a CA em <i>Configurações → Certificados</i> ou desligue a verificação SSL (só em teste).</td></tr>
        <tr><td><b>Servidor exige certificado de cliente</b></td><td>Cadastre o certificado (mTLS) para aquele host.</td></tr>
        <tr><td><b>gRPC UNAVAILABLE</b></td><td>Confira host/porta e <code>grpc://</code> × <code>grpcs://</code>; veja se o servidor está no ar.</td></tr>
        <tr><td><b>gRPC sem serviços na lista</b></td><td>O servidor não tem reflection: adicione o .proto (ou protoset) na aba Schema.</td></tr>
        <tr><td><b>Import de .proto: “Import não encontrado”</b></td><td>Use <i>+ Adicionar .proto</i> (copia os imports) ou indique a pasta raiz em <i>Import paths</i>.</td></tr>
        <tr><td><b>Segredo vazio num workspace recebido</b></td><td>É o esperado: segredos não viajam. Preencha o valor no ambiente.</td></tr>
        <tr><td><b>Workspace com arquivo YAML inválido</b></td><td>O Jaiminho ignora o arquivo e avisa qual é (muitas vezes é conflito de git). Corrija o arquivo e reabra.</td></tr>
        <tr><td><b>Request demora e não volta</b></td><td>Esc ou o botão Cancelar interrompe na hora. O tempo limite fica em <i>Configurações</i> (padrão) e na aba <i>Configurações</i> de cada request.</td></tr>
      </tbody></table>
    </>,
  },
];

const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// sinônimos em inglês / termos do Postman para a busca
const SYN = {
  variaveis: 'variable variables environment ambiente scope escopo',
  inicio: 'start begin comecar primeiros passos',
  postman: 'postman collection environment cookie jar',
  historico: 'history cookies cookie console historico',
};

export default function HelpModal({ section }) {
  const [id, setId] = useState(section && SECTIONS.some((s) => s.id === section) ? section : 'inicio');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return words.length ? SECTIONS.filter((s) => { const hay = norm(`${s.titulo} ${s.kw} ${SYN[s.id] || ''}`); return words.every((w) => hay.includes(w)); }) : SECTIONS;
  }, [q]);
  const cur = SECTIONS.find((s) => s.id === id) || SECTIONS[0];
  const idx = SECTIONS.indexOf(cur);
  return <Modal title="Tutoriais e ajuda" wide testId="modal-help" footer={<>
    <span className="hint grow">Tudo aqui funciona offline. <K>F1</K> abre esta janela em qualquer lugar.</span>
    <button className="btn" onClick={closeModal}>Fechar</button>
  </>}>
    <div className="help">
      <nav className="help-nav" aria-label="Tópicos da ajuda">
        <input className="in" placeholder="Buscar na ajuda…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="help-search" aria-label="Buscar na ajuda" />
        {list.map((s) => <button key={s.id} className={s.id === cur.id ? 'on' : ''} onClick={() => setId(s.id)} data-testid={`help-${s.id}`}>{s.titulo}</button>)}
        {!list.length && <div className="hint">Nada encontrado para “{q}”. Tente: variável, gRPC, importar, certificado, tema, atalho.</div>}
      </nav>
      <article className="help-body" data-testid="help-body">
        <h3>{cur.titulo}</h3>
        {cur.corpo()}
        <div className="help-pager">
          {idx > 0 ? <button className="btn sm ghost" onClick={() => setId(SECTIONS[idx - 1].id)}>← {SECTIONS[idx - 1].titulo}</button> : <span />}
          {idx < SECTIONS.length - 1 && <button className="btn sm ghost" onClick={() => setId(SECTIONS[idx + 1].id)}>{SECTIONS[idx + 1].titulo} →</button>}
        </div>
      </article>
    </div>
  </Modal>;
}

/** Atalho para botões "?" ao lado de coisas complicadas. */
export function HelpLink({ section, children = 'Ver tutorial' }) {
  return <button className="linkbtn" onClick={() => openModal('help', { section })} data-testid={`helplink-${section}`}>{children}</button>;
}
