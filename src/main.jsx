import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

function boot() {
  try {
    const root = document.getElementById('root');
    if (!root) { document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;">Error: #root no encontrado</div>'; return; }
    createRoot(root).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
  } catch (e) {
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:red;"><h2>Error al iniciar</h2><pre>' + e.stack + '</pre><button onclick="location.reload()">Recargar</button></div>';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
