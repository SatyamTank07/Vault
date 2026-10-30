import { useEffect, useState } from 'react';
import { SYNC_CONFLICT_EVENT } from '../../lib/replica';
import ui from '../ui/ui.module.css';
import styles from './SyncNotice.module.css';

const MESSAGES = {
  copy: 'A note was changed on another device too. Both versions are kept; look for “conflicted copy”.',
  kept: 'A note you deleted was changed on another device, so it was kept.',
};
const VISIBLE_MS = 10_000;

/** Tells the user when sync had to keep two versions of a note. */
export function SyncNotice() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleConflict = (event: Event) => {
      const kind = (event as CustomEvent<{ kind: keyof typeof MESSAGES }>).detail?.kind ?? 'copy';
      setMessage(MESSAGES[kind]);
    };
    window.addEventListener(SYNC_CONFLICT_EVENT, handleConflict);
    return () => window.removeEventListener(SYNC_CONFLICT_EVENT, handleConflict);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;

  return (
    <div className={styles.toast} role="status">
      <span>{message}</span>
      <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.sm}`} onClick={() => setMessage(null)}>
        OK
      </button>
    </div>
  );
}
