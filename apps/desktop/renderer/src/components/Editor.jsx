import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { yaml } from '@codemirror/lang-yaml';
import { EditorView, Decoration, ViewPlugin, MatchDecorator, keymap } from '@codemirror/view';
import { Prec, EditorState } from '@codemirror/state';
import { openSearchPanel } from '@codemirror/search';
import { jaiminhoTheme } from '../editorTheme';

// destaca {{variáveis}} no editor
const varMatcher = new MatchDecorator({ regexp: /\{\{[^{}]+\}\}/g, decoration: Decoration.mark({ class: 'cm-jvar' }) });
const varPlugin = ViewPlugin.fromClass(class { constructor(v) { this.decorations = varMatcher.createDeco(v); } update(u) { this.decorations = varMatcher.updateDeco(u, this.decorations); } }, { decorations: (v) => v.decorations });

// Ctrl/Cmd+Enter envia a request: o editor consome a tecla (senão o CodeMirror insere uma linha em branco);
// o evento continua subindo até o atalho global do App, que faz o envio.
// Textos do painel de busca em português
const ptPhrases = EditorState.phrases.of({ Find: 'Buscar', Replace: 'Substituir', next: 'próximo', previous: 'anterior', all: 'todos', 'match case': 'maiúsc./minúsc.', 'by word': 'palavra inteira', regexp: 'regex', replace: 'substituir', 'replace all': 'substituir tudo', close: 'fechar', 'current match': 'ocorrência atual', 'on line': 'na linha', 'replaced match on line $': 'trocada ocorrência na linha $', 'replaced $ matches': 'trocadas $ ocorrências', 'Go to line': 'Ir para a linha', go: 'ir' });
const sendKeys = Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => true }, { key: 'Mod-Shift-Enter', run: () => true }]));

/** Abre a busca (Ctrl+F) no editor focado ou, se não houver, no da resposta/corpo visível. Devolve true se abriu. */
export function openSearchInPane(root = document) {
  const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.cm-editor');
  const target = focused || root.querySelector('[data-testid="resp-body"] .cm-editor') || root.querySelector('.work .cm-editor');
  const view = target && EditorView.findFromDOM(target);
  if (!view) return false;
  view.focus(); openSearchPanel(view); return true;
}

export function langFor(language) {
  switch ((language || '').toLowerCase()) {
    case 'json': return [json()];
    case 'xml': case 'html': case 'soap': return [xml()];
    case 'javascript': case 'js': return [javascript()];
    case 'yaml': return [yaml()];
    default: return [];
  }
}

export default function Editor({ value, onChange, language, readOnly, placeholder, minHeight, testId, wrap = true }) {
  const ext = useMemo(() => [sendKeys, ptPhrases, ...langFor(language), varPlugin, jaiminhoTheme, ...(wrap ? [EditorView.lineWrapping] : [])], [language, wrap]);
  return (
    <div className="cm-wrap" data-testid={testId} style={minHeight ? { minHeight } : undefined}>
      <CodeMirror value={value ?? ''} height="100%" theme="none" extensions={ext} editable={!readOnly} readOnly={!!readOnly}
        onChange={onChange} placeholder={placeholder} basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: true, searchKeymap: true }} />
    </div>
  );
}
