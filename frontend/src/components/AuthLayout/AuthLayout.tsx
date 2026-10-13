import React from 'react';
import { Lock } from 'lucide-react';
import styles from './AuthLayout.module.css';

interface AuthLayoutProps {
  children: React.ReactNode;
  /** Wider card for content like the recovery phrase grid. */
  wide?: boolean;
}

/** Shared shell for the sign-in and vault-secret screens: brand, card, encryption note. */
export function AuthLayout({ children, wide }: AuthLayoutProps) {
  return (
    <div className={styles.page}>
      <div className={styles.column}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <Lock size={16} />
          </span>
          <span className={styles.brandName}>Vault</span>
        </div>
        <main className={`${styles.card} ${wide ? styles.cardWide : ''}`}>{children}</main>
        <p className={styles.footnote}>
          <Lock size={12} />
          Notes are encrypted on this device before they're sent.
        </p>
      </div>
    </div>
  );
}
