import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { App } from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
