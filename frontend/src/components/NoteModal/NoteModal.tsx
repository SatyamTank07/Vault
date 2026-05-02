import React, { useState, useEffect, useMemo } from 'react';
import styles from './NoteModal.module.css';
import type { Note } from '../NoteCard/NoteCard';
import { TipTapEditor } from '../TipTapEditor/TipTapEditor';

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: Omit<Note, 'created_at' | 'updated_at'>) => void;
  initialData?: Note | null;
  isViewMode?: boolean;
}

export const NoteModal: React.FC<NoteModalProps> = ({ isOpen, onClose, onSave, initialData, isViewMode = false }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isEditing, setIsEditing] = useState(!isViewMode);
  
  // Generate a temporary ID for new notes to use as a folder name
  const generatedId = useMemo(() => crypto.randomUUID(), [isOpen, initialData]);
  const currentNoteId = initialData?.id || generatedId;

  useEffect(() => {
    if (isOpen) {
      setTitle(initialData?.title || '');
      setContent(initialData?.content || '');
      setIsEditing(!isViewMode);
    }
  }, [isOpen, initialData, isViewMode]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !content.trim()) return;
    onSave({ id: currentNoteId, title, content });
    
    if (isViewMode) {
      setIsEditing(false);
    } else {
      onClose();
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{isEditing ? (initialData ? 'Edit Note' : 'Create Note') : 'View Note'}</h2>
          <div className={styles.headerActions}>
            {!isEditing && (
              <button 
                type="button" 
                className={styles.editBtn} 
                onClick={() => setIsEditing(true)}
                title="Edit Note"
              >
                ✎
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.inputGroup}>
            {isEditing ? (
              <input
                id="note-title"
                type="text"
                className={styles.input}
                placeholder="Enter Title ..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            ) : (
              <h1 className={styles.viewTitle}>{title || 'Untitled'}</h1>
            )}
          </div>

          <div className={`${styles.inputGroup} ${styles.contentGroup}`}>
            <TipTapEditor 
              content={content} 
              onChange={setContent} 
              noteId={currentNoteId} 
              readOnly={!isEditing} 
            />
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              {isEditing ? 'Cancel' : 'Close'}
            </button>
            {isEditing && (
              <button type="submit" className={styles.saveBtn}>
                Save Note
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
