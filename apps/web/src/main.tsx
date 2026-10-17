import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './AccountApp.js';
import '@mudd/ui/styles.css';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
