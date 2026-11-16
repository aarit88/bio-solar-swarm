import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  createUserWithEmailAndPassword,
  db,
  EmailAuthProvider,
  ensureAuthPersistence,
  formatFirebaseAuthError,
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
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
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

  const clearAuthError = useCallback(() => {
    setAuthError(null);
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
      .then(() => {
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
  }, [authInstance, configValidation.missingKeys, syncOperatorProfile]);

  const requireAuthInstance = useCallback(() => {
    if (!authInstance) {
      throw new Error('Firebase Auth is not configured. Check firebase-applet-config.json.');
    }
    return authInstance;
  }, [authInstance]);

  const signInWithGoogle = useCallback(async () => {
    const a = requireAuthInstance();
    await ensureAuthPersistence(a);
    setAuthError(null);
    await signInWithPopup(a, googleProvider);
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
      await sendEmailVerification(cred.user).catch(() => {});
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
    if (a.currentUser && !a.currentUser.emailVerified) {
      await sendEmailVerification(a.currentUser);
    }
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
        signInWithEmail,
        registerWithEmail,
        resetPassword,
        resendVerificationEmail,
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
