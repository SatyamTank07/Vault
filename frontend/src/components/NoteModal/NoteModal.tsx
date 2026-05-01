import React, { useState, useEffect } from 'react';
import styles from './NoteModal.module.css';
import type { Note } from '../NoteCard/NoteCard';

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: Omit<Note, 'id' | 'created_at' | 'updated_at'>) => void;
  initialData?: Note | null;
}

export const NoteModal: React.FC<NoteModalProps> = ({ isOpen, onClose, onSave, initialData }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

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
    onSave({ title, content });
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
            <label htmlFor="note-title">Title</label>
            <input
              id="note-title"
              type="text"
              className={styles.input}
              placeholder="Enter title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          
          <div className={styles.inputGroup}>
            <label htmlFor="note-content">Content</label>
            <textarea
              id="note-content"
              className={styles.textarea}
              placeholder="Write your note here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
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
