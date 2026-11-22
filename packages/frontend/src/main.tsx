import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomsPage } from './pages/RoomsPage';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <RoomsPage />
  </StrictMode>,
);
