import React from 'react';
import styles from './NoteCard.module.css';

export interface Note {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
}

export const NoteCard: React.FC<NoteCardProps> = ({ note, onEdit, onDelete }) => {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };

  return (
    <div className={styles.card}>
      <div className={styles.actions}>
        <button 
          className={styles.actionBtn} 
          onClick={() => onEdit(note)}
          title="Edit"
        >
          ✎
        </button>
        <button 
          className={`${styles.actionBtn} ${styles.deleteBtn}`} 
          onClick={() => onDelete(note.id)}
          title="Delete"
        >
          ✕
        </button>
      </div>
      <h3 className={styles.title}>{note.title || 'Untitled'}</h3>
      <p className={styles.description}>{note.description}</p>
      <div className={styles.footer}>
        <span>{formatDate(note.createdAt)}</span>
        {note.updatedAt !== note.createdAt && (
          <span title="Edited">Edited</span>
        )}
      </div>
    </div>
  );
};
