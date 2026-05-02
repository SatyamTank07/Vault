import React from 'react';
import styles from './NoteCard.module.css';

export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
  onView: (note: Note) => void;
}

export const NoteCard: React.FC<NoteCardProps> = ({ note, onEdit, onDelete, onView }) => {
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
    <div className={styles.card} onClick={() => onView(note)}>
      <div className={styles.actions}>
        <button 
          className={styles.actionBtn} 
          onClick={(e) => {
            e.stopPropagation();
            onEdit(note);
          }}
          title="Edit"
        >
          ✎
        </button>
        <button 
          className={`${styles.actionBtn} ${styles.deleteBtn}`} 
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
          title="Delete"
        >
          ✕
        </button>
      </div>
      <h3 className={styles.title}>{note.title || 'Untitled'}</h3>
      <div 
        className={styles.description}
        dangerouslySetInnerHTML={{ __html: note.content }}
      />
      <div className={styles.footer}>
        <span>{formatDate(note.created_at)}</span>
        {note.updated_at && note.updated_at !== note.created_at && (
          <span title="Edited">Edited</span>
        )}
      </div>
    </div>
  );
};
