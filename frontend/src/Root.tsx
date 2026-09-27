import { useEffect, useState } from 'react';
import App from './App';
import FeedbackApp from './FeedbackApp';
import { AuthScreen } from './components/AuthScreen/AuthScreen';
import { VaultSecretScreen } from './components/VaultSecretScreen/VaultSecretScreen';
import {
  apiFetch,
  clearAuthToken,
  getAuthToken,
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

export default function Root() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearAuthToken();
      clearVaultSecret();
      setActiveVaultKey(null);
      clearDecryptedImageCache();
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
        const response = await apiFetch('/api/auth/me', { method: 'GET' }, { suppressUnauthorizedEvent: true });
        if (!response.ok) {
          clearAuthToken();
          clearVaultSecret();
          setLoading(false);
          return;
        }

        const user: CurrentUser = await response.json();
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
        clearAuthToken();
        clearVaultSecret();
        setActiveVaultKey(null);
        clearDecryptedImageCache();
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const handleAuthenticated = (payload: AuthResponse) => {
    setAuthToken(payload.access_token);
    setCurrentUser(payload.user);
    setActiveVaultKey(null);
    clearDecryptedImageCache();
    setVaultKey(null); // Force vault secret entry after login
    setAuthMessage(null);
  };

  const handleLogout = () => {
    clearAuthToken();
    clearVaultSecret();
    setActiveVaultKey(null);
    clearDecryptedImageCache();
    setCurrentUser(null);
    setVaultKey(null);
    setAuthMessage(null);
  };

  const handleVaultUnlocked = (key: CryptoKey) => {
    setActiveVaultKey(key);
    setVaultKey(key);
  };

  const handleUserUpdated = (user: CurrentUser) => {
    setCurrentUser(user);
  };

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
  const isFeedbackRoute = window.location.pathname === '/feedback' || window.location.pathname === '/feedback/';
  return isFeedbackRoute ? (
    <FeedbackApp currentUser={currentUser} onLogout={handleLogout} />
  ) : (
    <App currentUser={currentUser} onLogout={handleLogout} cryptoKey={vaultKey} />
  );
}
