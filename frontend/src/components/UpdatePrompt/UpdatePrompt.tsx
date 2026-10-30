import { useRegisterSW } from 'virtual:pwa-register/react';
import ui from '../ui/ui.module.css';
import styles from './UpdatePrompt.module.css';

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Registers the service worker and offers a reload once a new version of Vault has downloaded. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Long-lived tabs and installed apps should still notice new deploys.
      if (registration) setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_MS);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className={styles.toast} role="status">
      <span>A new version of Vault is ready.</span>
      <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.sm}`} onClick={() => setNeedRefresh(false)}>
        Later
      </button>
      <button type="button" className={`${ui.btn} ${ui.primary} ${ui.sm}`} onClick={() => updateServiceWorker(true)}>
        Reload
      </button>
    </div>
  );
}
