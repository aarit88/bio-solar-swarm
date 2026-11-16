import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import './index.css';

// Google Maps Platform Case A Quota Defense:
// Capture global auth/quota failures and OverQuotaMapError before React mounts.
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const joined = args.map((a) => String(a ?? '')).join(' ');
  if (/OverQuotaMapError|QuotaExceededError|BillingNotEnabledMapError/i.test(joined)) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
  origConsoleError.apply(console, args);
};

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
