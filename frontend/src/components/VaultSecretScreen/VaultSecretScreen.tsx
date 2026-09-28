import React, { useState } from 'react';
import { Lock, ShieldCheck, KeyRound } from 'lucide-react';
import styles from './VaultSecretScreen.module.css';
import { apiFetch, type CurrentUser } from '../../lib/api';
import {
  deriveKey,
  deriveNoteKey,
  setVaultSecret,
  encryptNote,
  decryptNote,
  generateMasterSeed,
  seedToPhrase,
  phraseToSeed,
  wrapMasterSeed,
  unwrapMasterSeed,
} from '../../lib/crypto';

interface VaultSecretScreenProps {
  currentUser: CurrentUser;
  onUnlocked: (key: CryptoKey) => void;
  onUserUpdated: (user: CurrentUser) => void;
}

type Phase = 'input' | 'migrating' | 'show-phrase' | 'reset-secret' | 'done';

const PENDING_PHRASE_KEY = 'vault_pending_phrase';
const PENDING_SECRET_KEY = 'vault_pending_secret';

export function VaultSecretScreen({ currentUser, onUnlocked, onUserUpdated }: VaultSecretScreenProps) {
  const isFirstTime = !currentUser.has_set_vault;
  const needsMigration = currentUser.has_set_vault && !currentUser.encrypted_master_seed;

  // Restore pending phrase if user refreshed during the phrase confirmation step
  const savedPendingPhrase = (() => {
    try {
      const raw = sessionStorage.getItem(PENDING_PHRASE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      return null;
    }
  })();
  const savedPendingSecret = sessionStorage.getItem(PENDING_SECRET_KEY) || '';

  const [phase, setPhase] = useState<Phase>(savedPendingPhrase ? 'show-phrase' : 'input');
  const [secret, setSecret] = useState(savedPendingSecret);
  const [confirmSecret, setConfirmSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<string | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string[]>(savedPendingPhrase || []);
  const [phraseConfirmed, setPhraseConfirmed] = useState(false);
  const [pendingNoteKey, setPendingNoteKey] = useState<CryptoKey | null>(null);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveredSeed, setRecoveredSeed] = useState<Uint8Array | null>(null);
  const [newSecret, setNewSecret] = useState('');
  const [confirmNewSecret, setConfirmNewSecret] = useState('');

  React.useEffect(() => {
    if (savedPendingPhrase && savedPendingPhrase.length === 12 && !pendingNoteKey) {
      try {
        const seed = phraseToSeed(savedPendingPhrase);
        deriveNoteKey(seed).then((key) => {
          setPendingNoteKey(key);
        });
      } catch (err) {
        console.error('Failed to restore pending note key from phrase:', err);
      }
    }
  }, [savedPendingPhrase, pendingNoteKey]);

  // ─── Submit: Vault Secret ───
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
      const salt = currentUser.created_at;

      if (isFirstTime || needsMigration) {
        // ── First-time or migration: generate master seed ──
        setPhase('migrating');

        // 1. Generate master seed
        const seed = generateMasterSeed();
        const noteKey = await deriveNoteKey(seed);

        // 2. If migration, re-encrypt all existing notes
        if (needsMigration) {
          setMigrationStatus('Decrypting notes with old key...');
          const oldKey = await deriveKey(secret, salt);

          const notesResponse = await apiFetch('/notes/');
          if (notesResponse.ok) {
            const existingNotes = await notesResponse.json();

            if (existingNotes.length > 0) {
              // Decrypt with old key, re-encrypt with new key
              for (let i = 0; i < existingNotes.length; i++) {
                setMigrationStatus(`Re-encrypting note ${i + 1} of ${existingNotes.length}...`);
                const note = existingNotes[i];

                // Decrypt with old key
                const { note: decrypted, failed } = await decryptNote(note, oldKey);
                if (failed) {
                  setError('Failed to decrypt notes. Wrong vault secret?');
                  setBusy(false);
                  setPhase('input');
                  setMigrationStatus(null);
                  return;
                }

                // Re-encrypt with new note key
                const encrypted = await encryptNote(
                  { title: decrypted.title || '', content: decrypted.content || '' },
                  noteKey,
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
        } else {
          // First-time: encrypt any existing plaintext notes
          setMigrationStatus('Setting up vault...');
          const notesResponse = await apiFetch('/notes/');
          if (notesResponse.ok) {
            const existingNotes = await notesResponse.json();
            if (existingNotes.length > 0) {
              setMigrationStatus(`Encrypting ${existingNotes.length} notes...`);
              for (let i = 0; i < existingNotes.length; i++) {
                const note = existingNotes[i];
                setMigrationStatus(`Encrypting note ${i + 1} of ${existingNotes.length}...`);
                const encrypted = await encryptNote(
                  { title: note.title || '', content: note.content || '' },
                  noteKey,
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
        }

        // 3. Wrap seed with vault secret and store on server
        setMigrationStatus('Securing recovery key...');
        const encryptedSeed = await wrapMasterSeed(seed, secret, salt);
        await apiFetch('/api/auth/master-seed', {
          method: 'POST',
          body: JSON.stringify({ encrypted_master_seed: encryptedSeed }),
        });

        // 4. Generate recovery phrase
        const phrase = await seedToPhrase(seed);

        // 5. Update state and show phrase
        setMigrationStatus(null);
        setRecoveryPhrase(phrase);
        setPendingNoteKey(noteKey);
        setPhase('show-phrase');

        sessionStorage.setItem(PENDING_PHRASE_KEY, JSON.stringify(phrase));
        sessionStorage.setItem(PENDING_SECRET_KEY, secret);

        onUserUpdated({
          ...currentUser,
          has_set_vault: true,
          encrypted_master_seed: encryptedSeed,
        });
      } else {
        // ── Returning user: unwrap master seed ──
        const seed = await unwrapMasterSeed(
          currentUser.encrypted_master_seed!,
          secret,
          salt,
        );
        const noteKey = await deriveNoteKey(seed);

        setVaultSecret(secret);
        onUnlocked(noteKey);
      }
    } catch (err) {
      console.error('Vault secret error:', err);
      setError('Wrong vault secret or something went wrong. Please try again.');
      setPhase('input');
      setMigrationStatus(null);
    } finally {
      setBusy(false);
    }
  };

  // ─── Submit: Recovery Phrase ───
  const handleRecoverySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const words = recoveryInput
      .trim()
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);

    if (words.length !== 12) {
      setError('Please enter all 12 words of your recovery phrase.');
      return;
    }

    setBusy(true);

    try {
      const seed = phraseToSeed(words);
      // Verify the seed works by deriving a key (will throw if invalid)
      await deriveNoteKey(seed);
      // Store seed and move to reset-secret phase
      setRecoveredSeed(seed);
      setPhase('reset-secret');
    } catch (err) {
      console.error('Recovery error:', err);
      setError('Invalid recovery phrase. Please check your words and try again.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Submit: Reset Secret (after recovery) ───
  const handleResetSecret = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!newSecret.trim()) {
      setError('Please enter a new vault secret.');
      return;
    }
    if (newSecret.length < 4) {
      setError('Vault secret must be at least 4 characters.');
      return;
    }
    if (newSecret !== confirmNewSecret) {
      setError('Secrets do not match.');
      return;
    }
    if (!recoveredSeed) {
      setError('Recovery data lost. Please try again.');
      return;
    }

    setBusy(true);

    try {
      const salt = currentUser.created_at;

      // Re-wrap the master seed with the new secret
      const encryptedSeed = await wrapMasterSeed(recoveredSeed, newSecret, salt);
      await apiFetch('/api/auth/master-seed', {
        method: 'POST',
        body: JSON.stringify({ encrypted_master_seed: encryptedSeed }),
      });

      // Derive note key and unlock
      const noteKey = await deriveNoteKey(recoveredSeed);

      onUserUpdated({
        ...currentUser,
        encrypted_master_seed: encryptedSeed,
      });

      setVaultSecret(newSecret);
      onUnlocked(noteKey);
    } catch (err) {
      console.error('Reset secret error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Confirm phrase and proceed ───
  const handlePhraseConfirmed = () => {
    sessionStorage.removeItem(PENDING_PHRASE_KEY);
    sessionStorage.removeItem(PENDING_SECRET_KEY);
    if (secret) {
      setVaultSecret(secret);
    }
    if (pendingNoteKey) {
      onUnlocked(pendingNoteKey);
    }
  };

  // ─── Phase: Show Recovery Phrase ───
  if (phase === 'show-phrase') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.lockIcon}>
            <KeyRound size={48} />
          </div>

          <div className={styles.brand}>
            <h1>Recovery Phrase</h1>
            <p>
              Write down these 12 words in order. Because your Vault Secret never leaves your device, this is the <strong>only way</strong> to recover your vault if you forget your secret.
            </p>
          </div>

          <div className={styles.phraseGrid}>
            {recoveryPhrase.map((word, i) => (
              <div key={i} className={styles.phraseWord}>
                <span className={styles.wordNumber}>{i + 1}</span>
                <span className={styles.wordText}>{word}</span>
              </div>
            ))}
          </div>

          <p className={styles.warning}>
            ⚠️ This phrase will NOT be shown again. Store it somewhere safe and offline. Anyone with
            this phrase can decrypt your notes.
          </p>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={phraseConfirmed}
              onChange={(e) => setPhraseConfirmed(e.target.checked)}
            />
            <span>I've written down my recovery phrase</span>
          </label>

          <button
            className={styles.submit}
            disabled={!phraseConfirmed}
            onClick={handlePhraseConfirmed}
          >
            Continue to Vault
          </button>
        </div>
      </div>
    );
  }

  // ─── Phase: Reset Secret (after recovery) ───
  if (phase === 'reset-secret') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.lockIcon}>
            <ShieldCheck size={48} />
          </div>

          <div className={styles.brand}>
            <h1>Set New Secret</h1>
            <p>Your recovery phrase was verified. Now set a new vault secret so you can unlock quickly next time.</p>
          </div>

          {error && <p className={`${styles.message} ${styles.error}`}>{error}</p>}

          <form className={styles.form} onSubmit={handleResetSecret}>
            <div className={styles.field}>
              <label htmlFor="new-secret">New Vault Secret</label>
              <input
                id="new-secret"
                className={styles.input}
                type="password"
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                placeholder="Enter new vault secret"
                autoComplete="off"
                autoFocus
                disabled={busy}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="confirm-new-secret">Confirm New Secret</label>
              <input
                id="confirm-new-secret"
                className={styles.input}
                type="password"
                value={confirmNewSecret}
                onChange={(e) => setConfirmNewSecret(e.target.value)}
                placeholder="Re-enter new vault secret"
                autoComplete="off"
                disabled={busy}
              />
            </div>

            <button className={styles.submit} disabled={busy} type="submit">
              {busy ? 'Saving...' : 'Save & Unlock Vault'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── Phase: Recovery Mode ───
  if (isRecoveryMode) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.lockIcon}>
            <KeyRound size={48} />
          </div>

          <div className={styles.brand}>
            <h1>Recover Vault</h1>
            <p>Enter your 12-word recovery phrase to unlock your notes.</p>
          </div>

          {error && <p className={`${styles.message} ${styles.error}`}>{error}</p>}

          <form className={styles.form} onSubmit={handleRecoverySubmit}>
            <div className={styles.field}>
              <label htmlFor="recovery-phrase">Recovery Phrase</label>
              <textarea
                id="recovery-phrase"
                className={styles.recoveryInput}
                value={recoveryInput}
                onChange={(e) => setRecoveryInput(e.target.value)}
                placeholder="Enter your 12 words separated by spaces"
                autoComplete="off"
                autoFocus
                disabled={busy}
                rows={3}
              />
            </div>

            <button className={styles.submit} disabled={busy} type="submit">
              {busy ? 'Recovering...' : 'Recover Vault'}
            </button>
          </form>

          <button
            className={styles.recoverLink}
            onClick={() => {
              setIsRecoveryMode(false);
              setError(null);
            }}
          >
            ← Back to secret entry
          </button>
        </div>
      </div>
    );
  }

  // ─── Phase: Input (default) ───
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.lockIcon}>
          {isFirstTime ? <ShieldCheck size={48} /> : <Lock size={48} />}
        </div>

        <div className={styles.brand}>
          <h1>{isFirstTime ? 'Set Your Vault Secret' : 'Vault'}</h1>
          <p>
            {isFirstTime
              ? 'Vault uses zero-knowledge encryption to keep your notes completely private.'
              : needsMigration
                ? "Enter your vault secret. We'll set up recovery for your account."
                : 'Enter your vault secret to decrypt your notes.'}
          </p>
        </div>

        {isFirstTime && (
          <div className={styles.narrativeBox}>
            <div className={styles.narrativeItem}>
              <KeyRound size={20} className={styles.narrativeIcon} />
              <div className={styles.narrativeText}>
                <strong>Your account password</strong> signs you in.
              </div>
            </div>
            <div className={styles.narrativeItem}>
              <ShieldCheck size={20} className={styles.narrativeIcon} />
              <div className={styles.narrativeText}>
                <strong>Your Vault Secret</strong> generates the private key that encrypts your thoughts on this device. We can never see or reset your secret.
              </div>
            </div>
          </div>
        )}

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
              placeholder={isFirstTime ? 'Choose a vault secret' : 'Enter vault secret'}
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
                ⚠️ After this step, you will receive a 12-word recovery phrase. Store it safely—because we never store your secret, this phrase is the only way to recover your notes if forgotten.
              </p>
            </>
          )}

          <button className={styles.submit} disabled={busy} type="submit">
            {busy
              ? (migrationStatus ? 'Encrypting...' : 'Unlocking...')
              : (isFirstTime ? 'Create Secret & Continue' : needsMigration ? 'Unlock & Setup Recovery' : 'Unlock Vault')}
          </button>
        </form>

        {!isFirstTime && !needsMigration && (
          <button
            className={styles.recoverLink}
            onClick={() => setIsRecoveryMode(true)}
          >
            Forgot your secret? Recover with phrase
          </button>
        )}
      </div>
    </div>
  );
}
