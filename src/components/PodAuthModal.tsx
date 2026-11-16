import React, { useState } from 'react';
import { Lock, Power, ShieldCheck, X, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { formatFirebaseAuthError } from '../lib/firebase';

interface PodAuthModalProps {
  nodeId: string;
  targetEnabled: boolean;
  onConfirmSuccess: (nodeId: string, enabled: boolean, auditHash: string) => void;
  onCancel: () => void;
}

export const PodAuthModal: React.FC<PodAuthModalProps> = ({
  nodeId,
  targetEnabled,
  onConfirmSuccess,
  onCancel,
}) => {
  const { user, reauthenticateForPodControl, authFetch } = useAuth();
  const hasPasswordProvider = Boolean(user?.providerData.some((p) => p.providerId === 'password'));

  const [password, setPassword] = useState('');
  const [reason, setReason] = useState(
    targetEnabled ? 'Scheduled street remediation activation' : 'Maintenance / safety isolation'
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasPasswordProvider && !password) {
      setError('Please enter your account password to authorize pod state change.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const freshToken = await reauthenticateForPodControl(hasPasswordProvider ? password : undefined);
      const resp = await authFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/power`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${freshToken}`,
        },
        body: JSON.stringify({
          enabled: targetEnabled,
          reason: reason.trim() || 'Operator authenticated state toggle',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      onConfirmSuccess(nodeId, targetEnabled, String(data.auditEntry?.entry_hash || 'verified'));
    } catch (err) {
      const formatted = formatFirebaseAuthError(err);
      setError(formatted.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Authenticate Pod Power Action"
      className="fixed inset-0 z-50 bg-[#1E293B]/60 flex items-center justify-center p-4"
    >
      <div className="bg-[#EEF2F6] text-[#1E293B] border border-[#B8C4D0] rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-3.5 bg-[#2D3744] text-white flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="w-4 h-4 text-[#FBBF24]" />
            Authorize Pod State Change
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel Pod Authorization"
            className="text-[#CBD5E1] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div className="p-3 rounded-lg bg-[#DCE4EC] border border-[#CBD5E1] space-y-1">
            <div className="font-mono font-semibold text-[#0F172A]">
              Target Node: {nodeId}
            </div>
            <div className="text-[#334155]">
              Requested Command:{' '}
              <strong className={targetEnabled ? 'text-[#059669]' : 'text-[#DC2626]'}>
                {targetEnabled ? 'ACTIVATE POD' : 'DEACTIVATE POD'}
              </strong>
            </div>
            <div className="text-[11px] text-[#475569]">
              Operator: {user?.email || user?.uid}
            </div>
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-[#FEE2E2] border border-[#FCA5A5] text-[#991B1B] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <label className="block space-y-1">
            <span className="font-medium text-[#334155]">Audit Reason (Logged to SHA-256 Ledger)</span>
            <input
              type="text"
              required
              maxLength={180}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white border border-[#CBD5E1] text-[#0F172A]"
            />
          </label>

          {hasPasswordProvider ? (
            <label className="block space-y-1">
              <span className="font-medium text-[#334155]">Confirm Operator Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password to authorize"
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#CBD5E1] text-[#0F172A]"
              />
            </label>
          ) : (
            <div className="p-2.5 rounded-lg bg-[#F4F7FA] border border-[#CBD5E1] text-[#475569] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#059669] shrink-0" />
              <span>Clicking Confirm will verify your Google session via Firebase re-authentication.</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-2 rounded-lg bg-white border border-[#CBD5E1] text-[#334155] font-medium hover:bg-[#F8FAFC]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className={`px-4 py-2 rounded-lg text-white font-semibold inline-flex items-center gap-1.5 ${
                targetEnabled
                  ? 'bg-[#059669] hover:bg-[#047857]'
                  : 'bg-[#DC2626] hover:bg-[#B91C1C]'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              {busy ? 'Authorizing...' : targetEnabled ? 'Verify & Activate' : 'Verify & Deactivate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
