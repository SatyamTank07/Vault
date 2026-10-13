import React, { useEffect, useId } from 'react';
import ui from '../ui/ui.module.css';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isDestructive = true,
}) => {
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className={ui.scrim} onClick={onCancel}>
      <div
        className={ui.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className={ui.dialogTitle}>
          {title}
        </h2>
        <p id={messageId} className={ui.dialogText}>
          {message}
        </p>
        <div className={ui.dialogActions}>
          {/* Focus starts on the safe choice. */}
          <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={onCancel} autoFocus>
            {cancelText}
          </button>
          <button
            type="button"
            className={`${ui.btn} ${isDestructive ? ui.danger : ui.primary}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
