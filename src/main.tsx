import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { LegalPages } from './components/LegalPages';
import './index.css';

const isLegalPage = ['/terms', '/privacy', '/refunds'].includes(window.location.pathname);
createRoot(document.getElementById('root')!).render(isLegalPage ? <LegalPages /> : <App />);
