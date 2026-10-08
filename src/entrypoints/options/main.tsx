// Before any other import: zod must be in its interpreted mode before a schema is built.
import '@/wiring/configure-zod';
import '@/styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('options root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
