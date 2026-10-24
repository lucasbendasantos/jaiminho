import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import App from './App';

// aplica o último tema salvo antes do primeiro desenho (evita piscar)
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) return <div className="error-box" style={{ margin: 40 }}><b>Algo quebrou na tela.</b>{'\n'}{String(this.state.err.stack || this.state.err)}{'\n\n'}<button className="btn" onClick={() => this.setState({ err: null })}>Tentar de novo</button></div>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);
