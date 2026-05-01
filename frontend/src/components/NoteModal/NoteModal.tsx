import React, { useState, useEffect, useMemo } from 'react';
import styles from './NoteModal.module.css';
import type { Note } from '../NoteCard/NoteCard';
import { TipTapEditor } from '../TipTapEditor/TipTapEditor';

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: Omit<Note, 'created_at' | 'updated_at'>) => void;
  initialData?: Note | null;
}

export const NoteModal: React.FC<NoteModalProps> = ({ isOpen, onClose, onSave, initialData }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  
  // Generate a temporary ID for new notes to use as a folder name
  const generatedId = useMemo(() => crypto.randomUUID(), [isOpen, initialData]);
  const currentNoteId = initialData?.id || generatedId;

  useEffect(() => {
    if (isOpen) {
      setTitle(initialData?.title || '');
      setContent(initialData?.content || '');
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !content.trim()) return;
    onSave({ id: currentNoteId, title, content });
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{initialData ? 'Edit Note' : 'Create Note'}</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.inputGroup}>
            <input
              id="note-title"
              type="text"
              className={styles.input}
              placeholder="Enter Title ..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className={`${styles.inputGroup} ${styles.contentGroup}`}>
            <TipTapEditor content={content} onChange={setContent} noteId={currentNoteId} />
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.saveBtn}>
              Save Note
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
