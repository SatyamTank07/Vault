import React, { useMemo, useState } from 'react';
import { Check, FileText, Link2, Plus, X } from 'lucide-react';
import type { Note } from '../NoteCard/NoteCard';
import { NotePicker } from '../NotePicker/NotePicker';
import { getAttachCandidates, getChildren, sortByScheduleThenTitle } from '../../lib/noteTree';
import type { TimeStreamEvent } from './TimeStreamCanvas';
import styles from './EventPanel.module.css';

interface EventPanelProps {
  event: TimeStreamEvent;
  allNotes: Note[];
  onClose: () => void;
  onOpenNote: (note: Note) => void;
  onCreateChild: (parentId: string) => void;
  onSetParent: (noteId: string, parentId: string | null) => void;
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

function formatShortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const EventPanel: React.FC<EventPanelProps> = ({
  event,
  allNotes,
  onClose,
  onOpenNote,
  onCreateChild,
  onSetParent,
}) => {
  const [isAttaching, setIsAttaching] = useState(false);

  // Prefer the live note from App so edits made while the panel is open show up.
  const eventNote = allNotes.find((note) => note.id === event.note.id) ?? event.note;
  const startDate = eventNote.scheduled_date ?? event.start_date;
  const endDate = eventNote.end_date ?? event.end_date;
  const status = eventNote.status ?? event.status;

  const children = useMemo(
    () => sortByScheduleThenTitle(getChildren(allNotes, eventNote.id)),
    [allNotes, eventNote.id],
  );
  const attachCandidates = useMemo(() => getAttachCandidates(allNotes, eventNote.id), [allNotes, eventNote.id]);
  const tracked = children.filter((child) => child.status);
  const doneCount = tracked.filter((child) => child.status === 'done').length;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <aside
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Event: ${eventNote.title || 'Untitled'}`}
      >
        <div className={styles.dragHandle} aria-hidden="true" />

        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 className={styles.title}>{eventNote.title || 'Untitled'}</h2>
            <p className={styles.meta}>
              {formatShortDate(startDate)} → {formatShortDate(endDate)} · {STATUS_LABELS[status] || 'To Do'}
            </p>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </header>

        <div className={styles.actionsRow}>
          <button type="button" className={styles.secondaryBtn} onClick={() => onOpenNote(eventNote)}>
            <FileText size={14} />
            Open note
          </button>
          {tracked.length > 0 && (
            <span className={styles.progressLabel}>
              {doneCount} / {tracked.length} done
            </span>
          )}
        </div>
        {tracked.length > 0 && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${(doneCount / tracked.length) * 100}%` }} />
          </div>
        )}

        <div className={styles.sectionLabel}>Notes in this event</div>
        {children.length === 0 ? (
          <p className={styles.empty}>No notes yet. Add one to start tracking this event.</p>
        ) : (
          <ul className={styles.childList}>
            {children.map((child) => (
              <li key={child.id} className={styles.childRow}>
                <button type="button" className={styles.childMain} onClick={() => onOpenNote(child)}>
                  <span
                    className={`${styles.statusIcon} ${
                      child.status ? styles[`status_${child.status}`] : styles.status_none
                    }`}
                  >
                    {child.status === 'done' ? <Check size={10} /> : null}
                  </span>
                  <span className={styles.childDate}>
                    {child.scheduled_date ? formatShortDate(child.scheduled_date) : '—'}
                  </span>
                  <span className={styles.childTitle}>{child.title || 'Untitled'}</span>
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => onSetParent(child.id, null)}
                  aria-label={`Remove ${child.title || 'Untitled'} from this event`}
                  title="Remove from this event"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.footer}>
          <button type="button" className={styles.primaryBtn} onClick={() => onCreateChild(eventNote.id)}>
            <Plus size={14} />
            New note
          </button>
          <div className={styles.attachWrapper}>
            <button type="button" className={styles.secondaryBtn} onClick={() => setIsAttaching((prev) => !prev)}>
              <Link2 size={14} />
              Attach
            </button>
            {isAttaching && (
              <div className={styles.attachPopover}>
                <NotePicker
                  notes={attachCandidates}
                  placeholder="Attach an existing note…"
                  onPick={(note) => {
                    onSetParent(note.id, eventNote.id);
                    setIsAttaching(false);
                  }}
                  onClose={() => setIsAttaching(false)}
                />
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};
