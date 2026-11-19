import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  inMemoryPersistence,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, Firestore, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export interface FirebaseConfigValidation {
  valid: boolean;
  missingKeys: string[];
  projectId: string;
  authDomain: string;
  firestoreDatabaseId: string;
}

export function validateFirebaseConfig(cfg = firebaseConfig): FirebaseConfigValidation {
  const required = ['projectId', 'appId', 'apiKey', 'authDomain', 'firestoreDatabaseId'] as const;
  const missingKeys: string[] = [];
  for (const key of required) {
    const val = cfg[key];
    if (typeof val !== 'string' || !val.trim() || /remixed-project-id|MY_/i.test(val)) {
      missingKeys.push(key);
    }
  }
  return {
    valid: missingKeys.length === 0,
    missingKeys,
    projectId: cfg.projectId || '',
    authDomain: cfg.authDomain || '',
    firestoreDatabaseId: cfg.firestoreDatabaseId || '(default)',
  };
}

export function getOrInitFirebaseApp(): FirebaseApp {
  const validation = validateFirebaseConfig(firebaseConfig);
  if (!validation.valid) {
    throw new Error(
      `Firebase configuration in firebase-applet-config.json is incomplete (missing: ${validation.missingKeys.join(', ')}).`
    );
  }
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export const app: FirebaseApp = getOrInitFirebaseApp();
export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth: Auth = getAuth(app);
auth.useDeviceLanguage();

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

let persistencePromise: Promise<void> | null = null;

/**
 * Ensures Firebase Auth persistence works even inside embedded preview iframes
 * where third-party localStorage/IndexedDB may be restricted.
 */
export function ensureAuthPersistence(authInstance: Auth = auth): Promise<void> {
  if (!persistencePromise) {
    persistencePromise = setPersistence(authInstance, browserLocalPersistence)
      .catch(() => setPersistence(authInstance, browserSessionPersistence))
      .catch(() => setPersistence(authInstance, inMemoryPersistence))
      .catch(() => undefined);
  }
  return persistencePromise;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export interface FormattedAuthError {
  code: string;
  message: string;
  isProviderDisabled: boolean;
  isUnauthorizedDomain: boolean;
  isPopupIssue: boolean;
}

export function formatFirebaseAuthError(error: unknown): FormattedAuthError {
  const errObj = error as { code?: unknown; message?: unknown } | null;
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof errObj?.message === 'string'
      ? errObj.message
      : String(error || 'Authentication failed.');

  let code = typeof errObj?.code === 'string' ? errObj.code : '';
  if (!code) {
    const match = rawMessage.match(/\((auth\/[a-z0-9-]+)\)/i);
    if (match?.[1]) code = match[1].toLowerCase();
  }
  if (!code && /CONFIGURATION_NOT_FOUND|OPERATION_NOT_ALLOWED/i.test(rawMessage)) {
    code = 'auth/operation-not-allowed';
  }
  if (!code && /INVALID_LOGIN_CREDENTIALS/i.test(rawMessage)) {
    code = 'auth/invalid-credential';
  }

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        code,
        message:
          'Invalid email or password. Double-check your credentials, reset your password, or use Sign in with Google Account.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/invalid-email':
      return {
        code,
        message: 'Please enter a valid email address (for example, operator@gmail.com).',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/missing-password':
      return {
        code,
        message: 'Please enter your operator password.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/email-already-in-use':
      return {
        code,
        message:
          'An operator account already exists for this email. Switch to Operator Sign In or sign in with Google.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/weak-password':
      return {
        code,
        message: 'Password is too weak. Choose at least 8 characters with letters and numbers.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return {
        code,
        message:
          'Email/Password sign-in is not enabled yet in Firebase Console. Use Sign in with Google Account below or enable Email/Password in Firebase Console.',
        isProviderDisabled: true,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/unauthorized-domain':
      {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'this app host';
      return {
        code,
        message:
          `Firebase Authentication is rejecting "${host}". Add this host under Firebase Console → Authentication → Settings → Authorized domains, then retry Google sign-in.`,
        isProviderDisabled: false,
        isUnauthorizedDomain: true,
        isPopupIssue: false,
      };
      }
    case 'auth/popup-closed-by-user':
      return {
        code,
        message:
          'Google sign-in popup was closed before completing. Retry or open the app in a standalone tab if your preview blocks popups.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: true,
      };
    case 'auth/cancelled-popup-request':
      return {
        code,
        message: 'A previous sign-in popup was superseded. Please complete the active sign-in window.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: true,
      };
    case 'auth/popup-blocked':
      return {
        code,
        message:
          'Your browser or preview iframe blocked the Google sign-in popup. Allow popups or open in a standalone tab.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: true,
      };
    case 'auth/account-exists-with-different-credential':
      return {
        code,
        message:
          'An account already exists for this email with another sign-in method. Verify that account first, then link Google sign-in.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/credential-already-in-use':
      return {
        code,
        message:
          'This Google account is already linked to another operator account. Sign in with that account or choose a different Google account.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/too-many-requests':
      return {
        code,
        message:
          'Firebase has temporarily rate-limited this request. Wait a few minutes, then retry the sign-in or verification email.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/user-disabled':
      return {
        code,
        message: 'This operator account has been disabled in Firebase Authentication.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/requires-recent-login':
    case 'auth/user-token-expired':
      return {
        code,
        message: 'Your session needs fresh authentication. Please sign in again to continue.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
      return {
        code,
        message:
          'Firebase API key or App ID in firebase-applet-config.json is unauthorized for this project.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    case 'auth/web-storage-unsupported':
    case 'auth/internal-error':
      return {
        code,
        message:
          'Browser storage or popup relay was blocked by the embedded frame. Open the app in a standalone tab or enable cookies/storage.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: true,
      };
    case 'auth/network-request-failed':
      return {
        code,
        message: 'Network error connecting to Firebase Authentication. Check your internet connection and retry.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
    default:
      return {
        code: code || 'auth/unknown',
        message: rawMessage.replace(/^Firebase:\s*/i, '').trim() || 'Authentication failed.',
        isProviderDisabled: false,
        isUnauthorizedDomain: false,
        isPopupIssue: false,
      };
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration (Firestore offline).');
      return false;
    }
    return true;
  }
}

export {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  updateProfile,
};
