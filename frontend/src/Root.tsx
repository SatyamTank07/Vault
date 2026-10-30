import { useEffect, useState } from 'react';
import App from './App';
import { AuthScreen } from './components/AuthScreen/AuthScreen';
import { UpdatePrompt } from './components/UpdatePrompt/UpdatePrompt';
import { VaultSecretScreen } from './components/VaultSecretScreen/VaultSecretScreen';
import {
  apiFetch,
  clearAuthToken,
  getAuthToken,
  isServerUnreachable,
  setAuthToken,
  UNAUTHORIZED_EVENT,
  type AuthResponse,
  type CurrentUser,
} from './lib/api';
import {
  clearVaultSecret,
  deriveKey,
  deriveNoteKey,
  getVaultSecret,
  setActiveVaultKey,
  unwrapMasterSeed,
} from './lib/crypto';
import { clearDecryptedImageCache } from './lib/imageDecryption';
import { clearCachedUser, getCachedUser, setCachedUser } from './lib/localDb';
import { closeReplica, forgetLocalCopy } from './lib/replica';

/**
 * End the session but keep this device's copy, including changes not yet synced, so signing in
 * again as the same user picks up where they left off.
 */
function signOutKeepingCopy() {
  clearAuthToken();
  clearVaultSecret();
  setActiveVaultKey(null);
  clearDecryptedImageCache();
  closeReplica();
}

/** Remove everything this device keeps for the signed-in user. */
function forgetDevice() {
  const cached = getCachedUser();
  clearAuthToken();
  clearCachedUser();
  clearVaultSecret();
  setActiveVaultKey(null);
  clearDecryptedImageCache();
  if (cached) void forgetLocalCopy(cached.id);
}

/** The signed-in user from the server, or the saved profile when the server can't be reached. */
async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const response = await apiFetch('/api/auth/me', { method: 'GET' }, { suppressUnauthorizedEvent: true });
    if (response.ok) {
      const user: CurrentUser = await response.json();
      setCachedUser(user);
      return user;
    }
    if (!isServerUnreachable(response)) return null;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  return getCachedUser();
}

export default function Root() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.pathname === '/feedback' || window.location.pathname === '/feedback/') {
      window.history.replaceState({}, '', '/');
    }

    const handleUnauthorized = () => {
      signOutKeepingCopy();
      setCurrentUser(null);
      setVaultKey(null);
      setAuthMessage('Your session expired. Please log in again.');
    };

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  useEffect(() => {
    const restoreSession = async () => {
      const token = getAuthToken();
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const user = await fetchCurrentUser();
        if (!user) {
          signOutKeepingCopy();
          setAuthMessage('Your session expired. Please log in again.');
          return;
        }
        setCurrentUser(user);

        // If we still have the vault secret in sessionStorage (same tab),
        // re-derive the key automatically
        const existingSecret = getVaultSecret();
        if (existingSecret && user.has_set_vault) {
          try {
            if (user.encrypted_master_seed) {
              // New architecture: unwrap master seed → derive note key
              const seed = await unwrapMasterSeed(
                user.encrypted_master_seed,
                existingSecret,
                user.created_at,
              );
              const key = await deriveNoteKey(seed);
              setActiveVaultKey(key);
              setVaultKey(key);
            } else {
              // Legacy fallback: direct key derivation (pre-migration user)
              const key = await deriveKey(existingSecret, user.created_at);
              setActiveVaultKey(key);
              setVaultKey(key);
            }
          } catch {
            // Secret derivation failed — force re-entry
            clearVaultSecret();
            setActiveVaultKey(null);
            clearDecryptedImageCache();
          }
        }
      } catch {
        signOutKeepingCopy();
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const handleAuthenticated = (payload: AuthResponse) => {
    const previous = getCachedUser();
    if (previous && previous.id !== payload.user.id) void forgetLocalCopy(previous.id);
    setAuthToken(payload.access_token);
    setCachedUser(payload.user);
    setCurrentUser(payload.user);
    clearVaultSecret();
    setActiveVaultKey(null);
    clearDecryptedImageCache();
    setVaultKey(null); // Force vault secret entry after login
    setAuthMessage(null);
  };

  const handleLogout = () => {
    forgetDevice();
    setCurrentUser(null);
    setVaultKey(null);
    setAuthMessage(null);
  };

  const handleSignInAgain = () => {
    signOutKeepingCopy();
    setCurrentUser(null);
    setVaultKey(null);
    setAuthMessage('Sign in again to sync the changes saved on this device.');
  };

  const handleVaultUnlocked = (key: CryptoKey) => {
    setActiveVaultKey(key);
    setVaultKey(key);
  };

  const handleUserUpdated = (user: CurrentUser) => {
    setCachedUser(user);
    setCurrentUser(user);
  };

  return (
    <>
      {renderScreen()}
      <UpdatePrompt />
    </>
  );

  function renderScreen() {
    if (loading) {
      return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
    }

    // State 1: Not authenticated → show auth screen
    if (!currentUser) {
      return <AuthScreen onAuthenticated={handleAuthenticated} initialMessage={authMessage} />;
    }

    // State 2: Authenticated but no vault key → show vault secret screen
    if (!vaultKey) {
      return (
        <VaultSecretScreen
          currentUser={currentUser}
          onUnlocked={handleVaultUnlocked}
          onUserUpdated={handleUserUpdated}
        />
      );
    }

    // State 3: Fully authenticated + vault unlocked → show app
    return (
      <App currentUser={currentUser} onLogout={handleLogout} onSignInAgain={handleSignInAgain} cryptoKey={vaultKey} />
    );
  }
}
