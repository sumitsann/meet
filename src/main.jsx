import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// No <StrictMode>: its double-mounted effects would open two meeting sessions per tab.
createRoot(document.getElementById('root')).render(<App />);
