import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  KeyRound,
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  Radio,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { formatFirebaseAuthError } from '../lib/firebase';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const AuthGate: React.FC = () => {
  const {
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    resetPassword,
    authError,
    clearAuthError,
    firebaseProjectInfo,
  } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [providerHelp, setProviderHelp] = useState(false);
  const [domainHelp, setDomainHelp] = useState(false);
  const [popupHelp, setPopupHelp] = useState(false);

  const clearFeedback = () => {
    setError(null);
    clearAuthError();
    setInfoNotice(null);
    setProviderHelp(false);
    setDomainHelp(false);
    setPopupHelp(false);
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    clearFeedback();
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const formatted = formatFirebaseAuthError(err);
      setError(formatted.message);
      setProviderHelp(formatted.isProviderDisabled);
      setDomainHelp(formatted.isUnauthorizedDomain);
      setPopupHelp(formatted.isPopupIssue);
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    clearFeedback();
    const trimmed = email.trim();
    if (!trimmed || !EMAIL_PATTERN.test(trimmed)) {
      setError('Enter your operator email address first, then click Forgot password.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(trimmed);
      setInfoNotice(`Password reset link sent to ${trimmed}. Check your inbox and spam folder.`);
    } catch (err: unknown) {
      const formatted = formatFirebaseAuthError(err);
      setError(formatted.message);
      setProviderHelp(formatted.isProviderDisabled);
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
      setError('Please enter a valid Gmail or operator email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }
    if (authMode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters for operator security compliance.');
      return;
    }

    setBusy(true);
    try {
      if (authMode === 'login') {
        await signInWithEmail(trimmedEmail, password);
      } else {
        await registerWithEmail(trimmedEmail, password, displayName || trimmedEmail.split('@')[0]);
      }
    } catch (err: unknown) {
      const formatted = formatFirebaseAuthError(err);
      setError(formatted.message);
      setProviderHelp(formatted.isProviderDisabled);
      setDomainHelp(formatted.isUnauthorizedDomain);
      setPopupHelp(formatted.isPopupIssue);
    } finally {
      setBusy(false);
    }
  };

  const activeError = error || authError;
  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const consoleBase = `https://console.firebase.google.com/project/${firebaseProjectInfo.projectId}/authentication`;

  return (
    <div className="min-h-screen w-full bg-[#CBD5DF] text-[#1E293B] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-4xl bg-[#EEF2F6] border border-[#B8C4D0] rounded-xl shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left Engineering & Cybersecurity Posture Column */}
        <div className="lg:col-span-5 bg-[#2D3744] text-[#F1F5F9] p-5 sm:p-8 flex flex-col justify-between space-y-4 sm:space-y-6">
          <div className="space-y-2.5 sm:space-y-4">
            <div className="flex items-center gap-2 text-[#34D399] text-xs font-mono uppercase tracking-widest">
              <Radio className="w-4 h-4" />
              IEEE 1451.1.6 Cyber-Physical Twin
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Bio-Solar Swarm Studio
            </h1>
            <p className="text-xs leading-relaxed text-[#CBD5E1]">
              Decentralized urban air remediation simulation &amp; hardware control gateway. Access to the 3D digital twin, engineering dashboard, telemetry logs, and individual pod actuation is strictly restricted to authenticated operators.
            </p>
          </div>

          <div className="space-y-2.5 border-t border-[#435060] pt-4 text-xs">
            <div className="font-semibold text-white uppercase tracking-wider text-[11px]">
              Zero-Trust Security Architecture
            </div>
            <div className="flex items-start gap-2.5 text-[#CBD5E1]">
              <ShieldCheck className="w-4 h-4 text-[#34D399] shrink-0 mt-0.5" />
              <span>Firebase ID Token verification (firebase-admin) enforced on all REST &amp; WebSocket streams.</span>
            </div>
            <div className="flex items-start gap-2.5 text-[#CBD5E1]">
              <Lock className="w-4 h-4 text-[#38BDF8] shrink-0 mt-0.5" />
              <span>Individual pod activation/deactivation requires operator re-authentication &amp; audit rationale.</span>
            </div>
            <div className="flex items-start gap-2.5 text-[#CBD5E1]">
              <CheckCircle2 className="w-4 h-4 text-[#FBBF24] shrink-0 mt-0.5" />
              <span>SHA-256 hash-chained SQLite audit ledger + Zero-Trust Firestore security rules.</span>
            </div>
          </div>
        </div>

        {/* Right Credential Gate Column */}
        <div className="lg:col-span-7 p-5 sm:p-8 flex flex-col justify-center space-y-3.5 sm:space-y-5 bg-[#F4F7FA]">
          <div>
            <h2 className="text-lg font-semibold text-[#0F172A]">Operator Authentication Required</h2>
            <p className="text-xs text-[#475569] mt-0.5">
              Sign in with Google or Gmail/Email credentials to launch the simulation and telemetry console.
            </p>
          </div>

          {activeError && (
            <div
              role="alert"
              data-testid="auth-error-banner"
              className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FCA5A5] text-xs text-[#991B1B] flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div>{activeError}</div>
                {providerHelp && (
                  <div className="text-[11px] text-[#7F1D1D]">
                    Enable Email/Password in{' '}
                    <a
                      href={`${consoleBase}/providers`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-semibold"
                    >
                      Firebase Console → Authentication → Sign-in method
                    </a>
                    , or click <strong>Sign in with Google Account</strong> below.
                  </div>
                )}
                {domainHelp && currentHostname && (
                  <div className="text-[11px] text-[#7F1D1D]">
                    Add <span className="font-mono font-semibold">{currentHostname}</span> under{' '}
                    <a
                      href={`${consoleBase}/settings`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-semibold"
                    >
                      Firebase Console → Authentication → Settings → Authorized domains
                    </a>
                    .
                  </div>
                )}
                {popupHelp && currentUrl && (
                  <div className="text-[11px] text-[#7F1D1D]">
                    If the preview iframe blocks Google Sign-In popups,{' '}
                    <a
                      href={currentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-semibold"
                    >
                      open Bio-Solar Swarm Studio in a standalone tab
                    </a>{' '}
                    and sign in there.
                  </div>
                )}
              </div>
            </div>
          )}

          {infoNotice && (
            <div
              role="status"
              data-testid="auth-info-banner"
              className="p-3 rounded-lg bg-[#ECFDF5] border border-[#6EE7B7] text-xs text-[#065F46] flex items-start gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{infoNotice}</span>
            </div>
          )}

          {/* Primary Google Sign-In Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className="w-full py-2.5 px-4 rounded-lg bg-[#2D3744] hover:bg-[#1E293B] disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2.5 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M12 10.2v3.9h5.5c-.24 1.25-.96 2.31-2.04 3.02l3.3 2.56c1.92-1.77 3.04-4.38 3.04-7.48 0-.72-.06-1.41-.19-2.08H12z"
              />
              <path
                fill="#4285F4"
                d="M12 22c2.7 0 4.96-.89 6.62-2.41l-3.3-2.56c-.91.61-2.08.97-3.32.97-2.55 0-4.71-1.72-5.48-4.04H3.1v2.64C4.75 19.87 8.11 22 12 22z"
              />
              <path
                fill="#FBBC05"
                d="M6.52 13.96A5.99 5.99 0 0 1 6.2 12c0-.68.12-1.34.32-1.96V7.4H3.1A9.99 9.99 0 0 0 2 12c0 1.61.39 3.13 1.1 4.6l3.42-2.64z"
              />
              <path
                fill="#34A853"
                d="M12 6c1.47 0 2.79.5 3.83 1.5l2.87-2.87C16.95 2.99 14.7 2 12 2 8.11 2 4.75 4.13 3.1 7.4l3.42 2.64C7.29 7.72 9.45 6 12 6z"
              />
            </svg>
            Sign in with Google Account
          </button>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-[#CBD5E1]" />
            <span className="shrink mx-3 text-[11px] font-mono uppercase text-[#64748B]">
              Or Email &amp; Password
            </span>
            <div className="flex-grow border-t border-[#CBD5E1]" />
          </div>

          {/* Mode Switch */}
          <div className="grid grid-cols-2 gap-1 bg-[#DCE4EC] p-1 rounded-lg text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                clearFeedback();
              }}
              className={`py-1.5 rounded-md transition-colors ${
                authMode === 'login' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              Operator Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                clearFeedback();
              }}
              className={`py-1.5 rounded-md transition-colors ${
                authMode === 'register' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleEmailSubmit} noValidate className="space-y-3 text-xs">
            {authMode === 'register' && (
              <label className="block space-y-1">
                <span className="font-medium text-[#334155]">Operator Full Name</span>
                <div className="relative">
                  <UserPlus className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Dr. A. Sharma"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-white border border-[#CBD5E1] text-[#0F172A] focus:outline-none focus:border-[#059669]"
                  />
                </div>
              </label>
            )}

            <label className="block space-y-1">
              <span className="font-medium text-[#334155]">Gmail / Engineering Email</span>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="operator@gmail.com"
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-white border border-[#CBD5E1] text-[#0F172A] focus:outline-none focus:border-[#059669]"
                />
              </div>
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="auth-password-input" className="font-medium text-[#334155]">
                  Password
                </label>
                {authMode === 'login' && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={busy}
                    className="text-[11px] font-medium text-[#0F766E] hover:underline disabled:opacity-50"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <KeyRound className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-password-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Minimum 8 characters"
                  className="w-full pl-9 pr-9 py-2 rounded-lg bg-white border border-[#CBD5E1] text-[#0F172A] focus:outline-none focus:border-[#059669]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 rounded-lg bg-[#059669] hover:bg-[#047857] disabled:opacity-60 text-white font-semibold transition-colors"
            >
              {busy
                ? 'Verifying Credentials...'
                : authMode === 'login'
                ? 'Sign In with Email & Password'
                : 'Register & Send Verification Email'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
