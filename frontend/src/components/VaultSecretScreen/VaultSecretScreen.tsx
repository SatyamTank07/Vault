import React, { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import styles from './VaultSecretScreen.module.css';
import { apiFetch, type CurrentUser } from '../../lib/api';
import {
  deriveKey,
  setVaultSecret,
  encryptNote,
} from '../../lib/crypto';

interface VaultSecretScreenProps {
  currentUser: CurrentUser;
  onUnlocked: (key: CryptoKey) => void;
  onUserUpdated: (user: CurrentUser) => void;
}

export function VaultSecretScreen({ currentUser, onUnlocked, onUserUpdated }: VaultSecretScreenProps) {
  const isFirstTime = !currentUser.has_set_vault;

  const [secret, setSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!secret.trim()) {
      setError('Please enter your vault secret.');
      return;
    }

    if (isFirstTime && secret !== confirmSecret) {
      setError('Secrets do not match.');
      return;
    }

    if (isFirstTime && secret.length < 4) {
      setError('Vault secret must be at least 4 characters.');
      return;
    }

    setBusy(true);

    try {
      // Derive encryption key from secret + user's created_at
      const salt = currentUser.created_at;
      const cryptoKey = await deriveKey(secret, salt);

      if (isFirstTime) {
        // ── First-time setup: migrate existing plaintext notes ──
        setMigrationStatus('Setting up vault...');

        // 1. Set vault flag on server
        await apiFetch('/api/auth/set-vault-flag', { method: 'POST' });

        // 2. Fetch all existing notes
        const notesResponse = await apiFetch('/notes/');
        if (notesResponse.ok) {
          const existingNotes = await notesResponse.json();

          if (existingNotes.length > 0) {
            setMigrationStatus(`Encrypting ${existingNotes.length} notes...`);

            // 3. Encrypt each note and PUT it back
            for (let i = 0; i < existingNotes.length; i++) {
              const note = existingNotes[i];
              setMigrationStatus(`Encrypting note ${i + 1} of ${existingNotes.length}...`);

              const encrypted = await encryptNote(
                { title: note.title || '', content: note.content || '' },
                cryptoKey,
              );

              await apiFetch(`/notes/${note.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  title: encrypted.title,
                  content: encrypted.content,
                }),
              });
            }
          }
        }

        setMigrationStatus(null);

        // Update user state so Root.tsx knows vault is set
        onUserUpdated({ ...currentUser, has_set_vault: true });
      }

      // Store secret in sessionStorage (ephemeral)
      setVaultSecret(secret);
      onUnlocked(cryptoKey);
    } catch (err) {
      console.error('Vault secret error:', err);
      setError('Something went wrong. Please try again.');
      setMigrationStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.lockIcon}>
          {isFirstTime ? <ShieldCheck size={48} /> : <Lock size={48} />}
        </div>

        <div className={styles.brand}>
          <h1>Vault</h1>
          <p>
            {isFirstTime
              ? 'Create a secret to encrypt your notes. This secret never leaves your device.'
              : 'Enter your vault secret to decrypt your notes.'}
          </p>
        </div>

        {error && <p className={`${styles.message} ${styles.error}`}>{error}</p>}

        {migrationStatus && (
          <p className={styles.migrationProgress}>
            <span className={styles.spinner} />
            {migrationStatus}
          </p>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="vault-secret">
              {isFirstTime ? 'Create Vault Secret' : 'Vault Secret'}
            </label>
            <input
              id="vault-secret"
              className={styles.input}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter vault secret"
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
          </div>

          {isFirstTime && (
            <>
              <div className={styles.field}>
                <label htmlFor="vault-secret-confirm">Confirm Vault Secret</label>
                <input
                  id="vault-secret-confirm"
                  className={styles.input}
                  type="password"
                  value={confirmSecret}
                  onChange={(e) => setConfirmSecret(e.target.value)}
                  placeholder="Re-enter vault secret"
                  autoComplete="off"
                  disabled={busy}
                />
              </div>

              <p className={styles.warning}>
                ⚠️ If you forget this secret, your notes cannot be recovered. secret key is never stored on our server.
              </p>
            </>
          )}

          <button className={styles.submit} disabled={busy} type="submit">
            {busy
              ? (migrationStatus ? 'Encrypting...' : 'Unlocking...')
              : (isFirstTime ? 'Create & Encrypt' : 'Unlock Vault')}
          </button>
        </form>
      </div>
    </div>
  );
}
