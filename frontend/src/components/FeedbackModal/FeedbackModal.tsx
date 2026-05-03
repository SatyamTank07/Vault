import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import styles from './FeedbackModal.module.css';

export interface Feedback {
  id: string;
  title: string;
  content: string | null;
  created_at?: string;
  updated_at?: string;
}

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (feedback: Omit<Feedback, 'id' | 'created_at' | 'updated_at'>) => void;
  initialData?: Feedback | null;
  isViewMode?: boolean;
}

export function FeedbackModal({ isOpen, onClose, onSave, initialData, isViewMode = false }: FeedbackModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTitle(initialData?.title || '');
      setContent(initialData?.content || '');
    } else {
      setTitle('');
      setContent('');
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    
    onSave({
      title: title.trim(),
      content: content.trim() || null,
    });
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{isViewMode ? 'View Feedback' : initialData ? 'Edit Feedback' : 'New Feedback'}</h2>
          <button className={styles.closeBtn} onClick={onClose} type="button">
            <X size={24} />
          </button>
        </div>

        {isViewMode ? (
          <div className={styles.form}>
            <h3 className={styles.viewTitle}>{title}</h3>
            <div className={styles.viewContent}>{content}</div>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.inputGroup}>
              <label htmlFor="feedback-title">Title</label>
              <input
                id="feedback-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Feedback subject..."
                className={styles.input}
                autoFocus
              />
            </div>
            
            <div className={`${styles.inputGroup} ${styles.contentGroup}`}>
              <label htmlFor="feedback-content">Content</label>
              <textarea
                id="feedback-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your feedback here..."
                className={`${styles.input} ${styles.textarea}`}
              />
            </div>

            <div className={styles.footer}>
              <button type="button" className={styles.cancelBtn} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={styles.saveBtn} disabled={!title.trim()}>
                Save Feedback
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
