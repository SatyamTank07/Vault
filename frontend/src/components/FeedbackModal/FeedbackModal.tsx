import React, { useState, useEffect, useRef, useId } from 'react';
import { X, CheckCircle2, Send } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import ui from '../ui/ui.module.css';
import styles from './FeedbackModal.module.css';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (isOpen) {
      setContent('');
      setIsSubmitting(false);
      setIsSuccess(false);
      setErrorMessage(null);
      // Give modal animation a brief moment to render before focusing
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await apiFetch('/api/feedback/', {
        method: 'POST',
        body: JSON.stringify({
          content: trimmed,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit feedback');
      }

      setIsSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setErrorMessage('Unable to send feedback right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={ui.scrim} onClick={() => !isSubmitting && onClose()}>
      <div
        className={`${ui.dialog} ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={ui.dialogHead}>
          <h2 id={titleId} className={ui.dialogTitle}>
            Feedback
          </h2>
          <button
            type="button"
            className={ui.iconBtn}
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {isSuccess ? (
          <div className={styles.successView} role="status">
            <span className={styles.successIcon}>
              <CheckCircle2 size={28} />
            </span>
            <h3 className={styles.successTitle}>Thank you!</h3>
            <p className={ui.dialogText}>Your feedback has been received. Thank you for helping us improve Vault!</p>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <p className={ui.dialogText}>Tell us what's working and what isn't.</p>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              placeholder="What can we improve?"
              aria-label="Feedback"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isSubmitting}
              rows={4}
              required
            />

            {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}

            <div className={ui.dialogActions}>
              <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={onClose} disabled={isSubmitting}>
                Cancel
              </button>
              <button
                type="submit"
                className={`${ui.btn} ${ui.primary}`}
                disabled={!content.trim() || isSubmitting}
              >
                <Send size={14} />
                {isSubmitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default FeedbackModal;
