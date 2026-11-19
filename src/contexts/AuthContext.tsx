import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  linkWithRedirect,
  onAuthStateChanged,
  reload,
  User,
} from 'firebase/auth';
import type { AuthCredential } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  createUserWithEmailAndPassword,
  db,
  EmailAuthProvider,
  ensureAuthPersistence,
  formatFirebaseAuthError,
  getRedirectResult,
  getOrInitFirebaseApp,
  googleProvider,
  handleFirestoreError,
  OperationType,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  testFirestoreConnection,
  updateProfile,
  validateFirebaseConfig,
} from '../lib/firebase';

export interface FirebaseProjectMetadata {
  projectId: string;
  authDomain: string;
  databaseId: string;
  configured: boolean;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  firestoreReady: boolean;
  authError: string | null;
  clearAuthError: () => void;
  firebaseProjectInfo: FirebaseProjectMetadata;
  signInWithGoogle: () => Promise<void>;
  linkGoogleToCurrentAccount: () => Promise<void>;
  googleLinkEmail: string | null;
  completeGoogleAccountLink: (password: string) => Promise<void>;
  cancelGoogleAccountLink: () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<boolean>;
  checkEmailVerification: () => Promise<boolean>;
  logout: () => Promise<void>;
  getFreshIdToken: (forceRefresh?: boolean) => Promise<string>;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  reauthenticateForPodControl: (password?: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [firestoreReady, setFirestoreReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [googleLinkEmail, setGoogleLinkEmail] = useState<string | null>(null);
  const [, setUserRefreshVersion] = useState(0);
  const pendingGoogleCredential = useRef<AuthCredential | null>(null);

  const configValidation = useMemo(() => validateFirebaseConfig(firebaseConfig), []);

  // Explicitly ensure Firebase App + Auth are initialized from firebase-applet-config.json
  const authInstance = useMemo(() => {
    try {
      const app = getOrInitFirebaseApp();
      const instance = getAuth(app);
      instance.useDeviceLanguage();
      return instance;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize Firebase Authentication.';
      console.error('Firebase Auth initialization error:', msg);
      return null;
    }
  }, []);

  const firebaseProjectInfo: FirebaseProjectMetadata = useMemo(
    () => ({
      projectId: configValidation.projectId,
      authDomain: configValidation.authDomain,
      databaseId: configValidation.firestoreDatabaseId,
      configured: configValidation.valid && authInstance !== null,
    }),
    [configValidation, authInstance]
  );

  const requireAuthInstance = useCallback(() => {
    if (!authInstance) {
      throw new Error('Firebase Auth is not configured. Check firebase-applet-config.json.');
    }
    return authInstance;
  }, [authInstance]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const captureGoogleLinkError = useCallback((error: unknown) => {
    const authError = error as { code?: string; customData?: { email?: string } };
    const email = authError?.customData?.email;
    if (authError?.code !== 'auth/account-exists-with-different-credential' || !email) {
      return false;
    }
    const credential = GoogleAuthProvider.credentialFromError(
      error as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]
    );
    if (!credential) {
      return false;
    }
    pendingGoogleCredential.current = credential;
    setGoogleLinkEmail(email);
    setAuthError(null);
    return true;
  }, []);

  const completeGoogleAccountLink = useCallback(async (password: string) => {
    const a = requireAuthInstance();
    const credential = pendingGoogleCredential.current;
    const email = googleLinkEmail;
    if (!credential || !email) {
      throw new Error('The Google sign-in attempt expired. Please try Google sign-in again.');
    }
    const existingAccount = await signInWithEmailAndPassword(a, email, password);
    try {
      await linkWithCredential(existingAccount.user, credential);
      await reload(existingAccount.user);
      await existingAccount.user.getIdToken(true);
    } catch (error) {
      await signOut(a).catch(() => {});
      throw error;
    }
    pendingGoogleCredential.current = null;
    setGoogleLinkEmail(null);
    setAuthError(null);
    setUserRefreshVersion((version) => version + 1);
  }, [googleLinkEmail, requireAuthInstance]);

  const cancelGoogleAccountLink = useCallback(() => {
    pendingGoogleCredential.current = null;
    setGoogleLinkEmail(null);
  }, []);

  const syncOperatorProfile = useCallback(async (u: User) => {
    if (!u.emailVerified) return;
    const safeName = (u.displayName || u.email?.split('@')[0] || 'Operator').slice(0, 80);
    const userPath = `users/${u.uid}`;
    const privatePath = `users/${u.uid}/private/security`;

    try {
      const userRef = doc(db, 'users', u.uid);
      const existingSnap = await getDoc(userRef);
      if (!existingSnap.exists()) {
        await setDoc(userRef, {
          uid: u.uid,
          displayName: safeName,
          role: 'operator',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(userRef, {
          displayName: safeName,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, userPath);
      } catch {
        // Structured error logged via handleFirestoreError
      }
    }

    try {
      const privateRef = doc(db, 'users', u.uid, 'private', 'security');
      const existingPrivate = await getDoc(privateRef);
      const safeEmail = (u.email || 'operator@biosolarswarm.local').slice(0, 160);
      if (!existingPrivate.exists()) {
        await setDoc(privateRef, {
          uid: u.uid,
          email: safeEmail,
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email: safeEmail,
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, privatePath);
      } catch {
        // Structured error logged via handleFirestoreError
      }
    }
  }, []);

  useEffect(() => {
    if (!authInstance) {
      setAuthError(
        `Firebase credentials in firebase-applet-config.json could not be initialized (missing: ${
          configValidation.missingKeys.join(', ') || 'unknown'
        }).`
      );
      setLoading(false);
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // Configure resilient persistence before subscribing to auth state
    ensureAuthPersistence(authInstance)
      .then(async () => {
        if (cancelled) return;
        // Complete any Google OAuth redirect before attaching the auth state listener.
        // This is the reliable fallback when an embedded browser blocks popups.
        try {
          await getRedirectResult(authInstance);
        } catch (err) {
          if (!cancelled && !captureGoogleLinkError(err)) {
            setAuthError(formatFirebaseAuthError(err).message);
          }
        }
        if (cancelled) return;
        // Boot-time Firestore connectivity verification (non-blocking)
        testFirestoreConnection()
          .then((ok) => {
            if (!cancelled) setFirestoreReady(ok);
          })
          .catch(() => {});

        unsubscribe = onAuthStateChanged(
          authInstance,
          async (nextUser) => {
            if (cancelled) return;
            setUser(nextUser);
            setAuthError(null);
            setLoading(false);
            if (nextUser) {
              try {
                const ok = await testFirestoreConnection();
                if (!cancelled) setFirestoreReady(ok);
                await syncOperatorProfile(nextUser);
              } catch {
                if (!cancelled) setFirestoreReady(false);
              }
            }
          },
          (err) => {
            if (cancelled) return;
            const formatted = formatFirebaseAuthError(err);
            setAuthError(formatted.message);
            setLoading(false);
          }
        );
      })
      .catch((err) => {
        if (cancelled) return;
        const formatted = formatFirebaseAuthError(err);
        setAuthError(formatted.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [authInstance, captureGoogleLinkError, configValidation.missingKeys, syncOperatorProfile]);

  const signInWithGoogle = useCallback(async () => {
    const a = requireAuthInstance();
    await ensureAuthPersistence(a);
    setAuthError(null);
    try {
      await signInWithPopup(a, googleProvider);
    } catch (err) {
      const formatted = formatFirebaseAuthError(err);
      if (captureGoogleLinkError(err)) return;
      if (formatted.code === 'auth/popup-blocked' || formatted.code === 'auth/web-storage-unsupported') {
        await signInWithRedirect(a, googleProvider);
        return;
      }
      throw err;
    }
  }, [captureGoogleLinkError, requireAuthInstance]);

  const linkGoogleToCurrentAccount = useCallback(async () => {
    const a = requireAuthInstance();
    const current = a.currentUser;
    if (!current) throw new Error('Sign in with your email and password before connecting Google.');
    if (current.providerData.some((provider) => provider.providerId === 'google.com')) return;

    try {
      await linkWithPopup(current, googleProvider);
      await reload(current);
      await current.getIdToken(true);
      setUserRefreshVersion((version) => version + 1);
    } catch (error) {
      const formatted = formatFirebaseAuthError(error);
      if (formatted.code === 'auth/popup-blocked' || formatted.code === 'auth/web-storage-unsupported') {
        await linkWithRedirect(current, googleProvider);
        return;
      }
      throw error;
    }
  }, [requireAuthInstance]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const a = requireAuthInstance();
      await ensureAuthPersistence(a);
      setAuthError(null);
      await signInWithEmailAndPassword(a, email.trim(), password);
    },
    [requireAuthInstance]
  );

  const registerWithEmail = useCallback(
    async (email: string, password: string, displayName: string) => {
      const a = requireAuthInstance();
      await ensureAuthPersistence(a);
      setAuthError(null);
      const cred = await createUserWithEmailAndPassword(a, email.trim(), password);
      if (displayName.trim()) {
        await updateProfile(cred.user, { displayName: displayName.trim().slice(0, 80) }).catch(() => {});
      }
      await sendEmailVerification(cred.user);
    },
    [requireAuthInstance]
  );

  const resetPassword = useCallback(
    async (email: string) => {
      const a = requireAuthInstance();
      await sendPasswordResetEmail(a, email.trim());
    },
    [requireAuthInstance]
  );

  const resendVerificationEmail = useCallback(async () => {
    const a = requireAuthInstance();
    const current = a.currentUser;
    if (!current) throw new Error('Sign in before requesting a verification email.');
    await reload(current);
    if (current.emailVerified) {
      setUserRefreshVersion((version) => version + 1);
      return false;
    }
    await sendEmailVerification(current);
    return true;
  }, [requireAuthInstance]);

  const checkEmailVerification = useCallback(async () => {
    const a = requireAuthInstance();
    const current = a.currentUser;
    if (!current) throw new Error('Sign in before checking email verification.');
    await reload(current);
    await current.getIdToken(true);
    setUserRefreshVersion((version) => version + 1);
    return current.emailVerified;
  }, [requireAuthInstance]);

  const logout = useCallback(async () => {
    const a = requireAuthInstance();
    await signOut(a);
  }, [requireAuthInstance]);

  const getFreshIdToken = useCallback(
    async (forceRefresh = false) => {
      const a = requireAuthInstance();
      if (!a.currentUser) {
        throw new Error('Operator is not authenticated.');
      }
      return a.currentUser.getIdToken(forceRefresh);
    },
    [requireAuthInstance]
  );

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers || {});
      if (!headers.has('Authorization')) {
        const token = await getFreshIdToken(false);
        headers.set('Authorization', `Bearer ${token}`);
      }
      if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(input, { ...init, headers });
      if (response.status === 401 && authInstance?.currentUser) {
        const refreshed = await getFreshIdToken(true);
        const retryHeaders = new Headers(headers);
        retryHeaders.set('Authorization', `Bearer ${refreshed}`);
        return fetch(input, { ...init, headers: retryHeaders });
      }
      return response;
    },
    [authInstance, getFreshIdToken]
  );

  const reauthenticateForPodControl = useCallback(
    async (password?: string) => {
      const a = requireAuthInstance();
      const current = a.currentUser;
      if (!current) throw new Error('Authentication required.');

      const hasPasswordProvider = current.providerData.some((p) => p.providerId === 'password');
      if (hasPasswordProvider) {
        if (!password) {
          throw new Error('Please enter your account password to authorize pod state change.');
        }
        if (!current.email) {
          throw new Error('Operator email is unavailable for password re-authentication.');
        }
        const credential = EmailAuthProvider.credential(current.email, password);
        await reauthenticateWithCredential(current, credential);
      } else {
        await reauthenticateWithPopup(current, googleProvider);
      }
      return current.getIdToken(true);
    },
    [requireAuthInstance]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        firestoreReady,
        authError,
        clearAuthError,
        firebaseProjectInfo,
        signInWithGoogle,
        linkGoogleToCurrentAccount,
        googleLinkEmail,
        completeGoogleAccountLink,
        cancelGoogleAccountLink,
        signInWithEmail,
        registerWithEmail,
        resetPassword,
        resendVerificationEmail,
        checkEmailVerification,
        logout,
        getFreshIdToken,
        authFetch,
        reauthenticateForPodControl,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
