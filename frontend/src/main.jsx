import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n/index';          // initialize i18next before rendering
import './styles/globals.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
