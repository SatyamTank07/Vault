import React, { useState } from 'react';
import { Lock, ShieldCheck, KeyRound, TriangleAlert, ArrowLeft } from 'lucide-react';
import { AuthLayout } from '../AuthLayout/AuthLayout';
import shell from '../AuthLayout/AuthLayout.module.css';
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

  const errorMessage = error && <p className={`${shell.message} ${shell.error}`}>{error}</p>;

  // ─── Phase: Show Recovery Phrase ───
  if (phase === 'show-phrase') {
    return (
      <AuthLayout wide>
        <div className={shell.heading}>
          <span className={shell.iconTile}>
            <KeyRound size={22} />
          </span>
          <h1 className={shell.title}>Recovery phrase</h1>
          <p className={shell.lead}>
            Write down these 12 words in order. Because your vault secret never leaves your device, this is the{' '}
            <strong>only way</strong> to recover your vault if you forget your secret.
          </p>
        </div>

        <ol className={styles.phraseGrid}>
          {recoveryPhrase.map((word, i) => (
            <li key={i} className={styles.phraseWord}>
              <span className={styles.wordNumber}>{i + 1}</span>
              <span className={styles.wordText}>{word}</span>
            </li>
          ))}
        </ol>

        <p className={styles.warning}>
          <TriangleAlert size={16} />
          <span>
            This phrase will not be shown again. Store it somewhere safe and offline. Anyone with this phrase can
            decrypt your notes.
          </span>
        </p>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={phraseConfirmed}
            onChange={(e) => setPhraseConfirmed(e.target.checked)}
          />
          <span>I've written down my recovery phrase</span>
        </label>

        <button className={shell.submit} disabled={!phraseConfirmed} onClick={handlePhraseConfirmed}>
          Continue to vault
        </button>
      </AuthLayout>
    );
  }

  // ─── Phase: Reset Secret (after recovery) ───
  if (phase === 'reset-secret') {
    return (
      <AuthLayout>
        <div className={shell.heading}>
          <span className={shell.iconTile}>
            <ShieldCheck size={22} />
          </span>
          <h1 className={shell.title}>Set a new secret</h1>
          <p className={shell.lead}>
            Your recovery phrase was verified. Now set a new vault secret so you can unlock quickly next time.
          </p>
        </div>

        {errorMessage}

        <form className={shell.form} onSubmit={handleResetSecret}>
          <div className={shell.field}>
            <label htmlFor="new-secret">New vault secret</label>
            <input
              id="new-secret"
              className={shell.input}
              type="password"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              placeholder="Enter new vault secret"
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
          </div>

          <div className={shell.field}>
            <label htmlFor="confirm-new-secret">Confirm new secret</label>
            <input
              id="confirm-new-secret"
              className={shell.input}
              type="password"
              value={confirmNewSecret}
              onChange={(e) => setConfirmNewSecret(e.target.value)}
              placeholder="Re-enter new vault secret"
              autoComplete="off"
              disabled={busy}
            />
          </div>

          <button className={shell.submit} disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save & unlock vault'}
          </button>
        </form>
      </AuthLayout>
    );
  }

  // ─── Phase: Recovery Mode ───
  if (isRecoveryMode) {
    return (
      <AuthLayout>
        <div className={shell.heading}>
          <span className={shell.iconTile}>
            <KeyRound size={22} />
          </span>
          <h1 className={shell.title}>Recover your vault</h1>
          <p className={shell.lead}>Enter your 12-word recovery phrase to unlock your notes.</p>
        </div>

        {errorMessage}

        <form className={shell.form} onSubmit={handleRecoverySubmit}>
          <div className={shell.field}>
            <label htmlFor="recovery-phrase">Recovery phrase</label>
            <textarea
              id="recovery-phrase"
              className={`${shell.input} ${styles.recoveryInput}`}
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              placeholder="Enter your 12 words separated by spaces"
              autoComplete="off"
              autoFocus
              disabled={busy}
              rows={3}
            />
          </div>

          <button className={shell.submit} disabled={busy} type="submit">
            {busy ? 'Recovering…' : 'Recover vault'}
          </button>
        </form>

        <button
          type="button"
          className={shell.linkBtn}
          onClick={() => {
            setIsRecoveryMode(false);
            setError(null);
          }}
        >
          <ArrowLeft size={13} className={styles.linkIcon} />
          Back to secret entry
        </button>
      </AuthLayout>
    );
  }

  // ─── Phase: Input (default) ───
  return (
    <AuthLayout>
      <div className={shell.heading}>
        <span className={shell.iconTile}>{isFirstTime ? <ShieldCheck size={22} /> : <Lock size={22} />}</span>
        <h1 className={shell.title}>{isFirstTime ? 'Set your vault secret' : 'Unlock your vault'}</h1>
        <p className={shell.lead}>
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
            <KeyRound size={18} className={styles.narrativeIcon} />
            <div className={styles.narrativeText}>
              <strong>Your account password</strong> signs you in.
            </div>
          </div>
          <div className={styles.narrativeItem}>
            <ShieldCheck size={18} className={styles.narrativeIcon} />
            <div className={styles.narrativeText}>
              <strong>Your vault secret</strong> generates the private key that encrypts your thoughts on this
              device. We can never see or reset your secret.
            </div>
          </div>
        </div>
      )}

      {errorMessage}

      {migrationStatus && (
        <p className={styles.migrationProgress} role="status">
          <span className={styles.spinner} />
          {migrationStatus}
        </p>
      )}

      <form className={shell.form} onSubmit={handleSubmit}>
        <div className={shell.field}>
          <label htmlFor="vault-secret">{isFirstTime ? 'Create vault secret' : 'Vault secret'}</label>
          <input
            id="vault-secret"
            className={shell.input}
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
            <div className={shell.field}>
              <label htmlFor="vault-secret-confirm">Confirm vault secret</label>
              <input
                id="vault-secret-confirm"
                className={shell.input}
                type="password"
                value={confirmSecret}
                onChange={(e) => setConfirmSecret(e.target.value)}
                placeholder="Re-enter vault secret"
                autoComplete="off"
                disabled={busy}
              />
            </div>

            <p className={styles.warning}>
              <TriangleAlert size={16} />
              <span>
                After this step you'll get a 12-word recovery phrase. Store it safely: because we never store your
                secret, this phrase is the only way to recover your notes if you forget it.
              </span>
            </p>
          </>
        )}

        <button className={shell.submit} disabled={busy} type="submit">
          {busy
            ? migrationStatus
              ? 'Encrypting…'
              : 'Unlocking…'
            : isFirstTime
              ? 'Create secret & continue'
              : needsMigration
                ? 'Unlock & set up recovery'
                : 'Unlock vault'}
        </button>
      </form>

      {!isFirstTime && !needsMigration && (
        <button type="button" className={shell.linkBtn} onClick={() => setIsRecoveryMode(true)}>
          Forgot your secret? Recover with phrase
        </button>
      )}
    </AuthLayout>
  );
}
