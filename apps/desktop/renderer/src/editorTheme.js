// Tema do CodeMirror com a paleta do Jaiminho (sem o bloco cinza do one-dark).
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const base = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-content': { caretColor: 'var(--brilho)' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--line)', color: 'var(--faint)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--azul-profundo) 22%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in srgb, var(--azul) 35%, transparent) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--brilho)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--violeta) 30%, transparent)', outline: 'none' },
  '.cm-tooltip, .cm-panels': { backgroundColor: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--line)' },
  '.cm-placeholder': { color: 'var(--faint)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg3)', border: 'none', color: 'var(--muted)' },
  '.cm-jvar': { color: 'var(--dourado)', fontWeight: '600' },
});

const hl = HighlightStyle.define([
  { tag: [t.propertyName, t.attributeName], color: 'var(--azul)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--verde)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--dourado)' },
  { tag: [t.tagName, t.typeName, t.className], color: 'var(--violeta)' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: 'var(--violeta)', fontWeight: '600' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--brilho)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.bracket, t.angleBracket], color: 'var(--muted)' },
  { tag: t.invalid, color: 'var(--erro)' },
]);

export const jaiminhoTheme = [base, syntaxHighlighting(hl)];
