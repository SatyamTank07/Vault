import React from 'react';
import styles from './FloatingActionButton.module.css';

interface FloatingActionButtonProps {
  onClick: () => void;
}

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({ onClick }) => {
  return (
    <button className={styles.fab} onClick={onClick} aria-label="Create Note">
      <span className={styles.icon}>+</span>
    </button>
  );
};
