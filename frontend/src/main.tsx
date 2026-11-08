import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { session } from './auth/session';
import './styles.css';

/**
 * Entry point of the SPA (RF-18 .. RF-24).
 *
 * The stored session is restored before the first render, so a reload lands on
 * the same screen instead of flashing the login form (RF-20).
 */
const container = document.getElementById('root');
if (container === null) {
  throw new Error('The root container is missing from index.html');
}

void session.initialize();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
