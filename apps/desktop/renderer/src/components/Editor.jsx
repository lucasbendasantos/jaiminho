import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { yaml } from '@codemirror/lang-yaml';
import { EditorView, Decoration, ViewPlugin, MatchDecorator } from '@codemirror/view';
import { jaiminhoTheme } from '../editorTheme';

// destaca {{variáveis}} no editor
const varMatcher = new MatchDecorator({ regexp: /\{\{[^{}]+\}\}/g, decoration: Decoration.mark({ class: 'cm-jvar' }) });
const varPlugin = ViewPlugin.fromClass(class { constructor(v) { this.decorations = varMatcher.createDeco(v); } update(u) { this.decorations = varMatcher.updateDeco(u, this.decorations); } }, { decorations: (v) => v.decorations });


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
  const ext = useMemo(() => [...langFor(language), varPlugin, jaiminhoTheme, ...(wrap ? [EditorView.lineWrapping] : [])], [language, wrap]);
  return (
    <div className="cm-wrap" data-testid={testId} style={minHeight ? { minHeight } : undefined}>
      <CodeMirror value={value ?? ''} height="100%" theme="none" extensions={ext} editable={!readOnly} readOnly={!!readOnly}
        onChange={onChange} placeholder={placeholder} basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: true, searchKeymap: true }} />
    </div>
  );
}
