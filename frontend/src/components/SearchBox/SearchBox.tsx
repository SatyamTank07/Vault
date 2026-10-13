import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Note } from '../NoteCard/NoteCard';
import { formatNoteDate, isTask, plainText } from '../../lib/noteText';
import styles from './SearchBox.module.css';

interface SearchBoxProps {
  notes: Note[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (note: Note) => void;
}

const MAX_RESULTS = 8;

/** Header search over the decrypted notes. The server only holds ciphertext, so this runs here. */
export const SearchBox: React.FC<SearchBoxProps> = ({ notes, query, onQueryChange, onOpen }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);

  const index = useMemo(
    () => notes.map((note) => ({ note, text: `${note.title} ${plainText(note.content || '')}`.toLowerCase() })),
    [notes],
  );

  const q = query.trim().toLowerCase();
  const hits = useMemo(
    () => (q ? index.filter((entry) => entry.text.includes(q)).slice(0, MAX_RESULTS).map((entry) => entry.note) : []),
    [index, q],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const open = (note: Note) => {
    inputRef.current?.blur();
    onOpen(note);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && hits.length) {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === 'ArrowUp' && hits.length) {
      event.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter' && hits.length) {
      event.preventDefault();
      open(hits[Math.min(active, hits.length - 1)]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      inputRef.current?.blur();
    }
  };

  const showResults = focused && q.length > 0;
  const activeIndex = Math.min(active, Math.max(hits.length - 1, 0));

  return (
    <div className={styles.search}>
      <Search size={16} className={styles.icon} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        placeholder="Search notes"
        autoComplete="off"
        aria-label="Search notes"
        aria-expanded={showResults}
        aria-controls="search-results"
        role="combobox"
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value);
          setActive(0);
        }}
        onFocus={() => setFocused(true)}
        // Delay so a click on a result lands before the list unmounts.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={onKeyDown}
      />
      <kbd className={styles.kbd}>Ctrl K</kbd>
      {showResults && (
        <div className={styles.results} id="search-results" role="listbox">
          {hits.length ? (
            hits.map((note, i) => {
              const where = [note.canvas_name, note.scheduled_date ? formatNoteDate(note) : isTask(note) ? 'Task' : 'Note']
                .filter(Boolean)
                .join(' · ');
              return (
                <button
                  key={note.id}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`${styles.item} ${i === activeIndex ? styles.itemOn : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => open(note)}
                >
                  <span className={styles.title}>{note.title || 'Untitled'}</span>
                  <span className={styles.where}>{where}</span>
                </button>
              );
            })
          ) : (
            <div className={styles.none}>No notes match “{query.trim()}”.</div>
          )}
        </div>
      )}
    </div>
  );
};
