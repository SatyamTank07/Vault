import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Note } from '../NoteCard/NoteCard';
import { formatShortDate } from '../../lib/noteText';
import styles from './NotePicker.module.css';

interface NotePickerProps {
  notes: Note[];
  onPick: (note: Note) => void;
  onClose: () => void;
  placeholder?: string;
}

const MAX_RESULTS = 50;

export const NotePicker: React.FC<NotePickerProps> = ({ notes, onPick, onClose, placeholder = 'Search notes…' }) => {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? notes.filter((note) => (note.title || 'Untitled').toLowerCase().includes(needle))
      : notes;
    return matches.slice(0, MAX_RESULTS);
  }, [notes, query]);

  return (
    <div className={styles.picker} onClick={(event) => event.stopPropagation()}>
      <div className={styles.searchRow}>
        <Search size={14} className={styles.searchIcon} />
        <input
          autoFocus
          className={styles.searchInput}
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // Keep the surrounding modal's Escape handler from also firing.
              event.preventDefault();
              event.stopPropagation();
              onClose();
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (results[0]) onPick(results[0]);
            }
          }}
        />
      </div>
      <ul className={styles.results} role="listbox">
        {results.length === 0 ? (
          <li className={styles.empty}>No matching notes</li>
        ) : (
          results.map((note) => (
            <li key={note.id}>
              <button type="button" className={styles.result} onClick={() => onPick(note)}>
                <span className={styles.resultTitle}>{note.title || 'Untitled'}</span>
                {note.scheduled_date && (
                  <span className={`${styles.resultMeta} tnum`}>{formatShortDate(note.scheduled_date)}</span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
};
