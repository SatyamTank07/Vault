import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Link2, Plus, X } from 'lucide-react';
import type { Note } from '../NoteCard/NoteCard';
import { NotePicker } from '../NotePicker/NotePicker';
import { getAttachCandidates, getChildren, sortByScheduleThenTitle } from '../../lib/noteTree';
import { formatDateRange, formatShortDate } from '../../lib/noteText';
import { StatusDot, StatusPill } from '../ui/StatusControl';
import ui from '../ui/ui.module.css';
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

export const EventPanel: React.FC<EventPanelProps> = ({
  event,
  allNotes,
  onClose,
  onOpenNote,
  onCreateChild,
  onSetParent,
}) => {
  const [isAttaching, setIsAttaching] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  // Prefer the live note from App so edits made while the panel is open show up.
  const eventNote = allNotes.find((note) => note.id === event.note.id) ?? event.note;
  const startDate = eventNote.scheduled_date ?? event.start_date;
  const endDate = eventNote.end_date ?? event.end_date;
  const status = eventNote.status ?? event.status;
  const title = eventNote.title || 'Untitled';

  const children = useMemo(
    () => sortByScheduleThenTitle(getChildren(allNotes, eventNote.id)),
    [allNotes, eventNote.id],
  );
  const attachCandidates = useMemo(() => getAttachCandidates(allNotes, eventNote.id), [allNotes, eventNote.id]);
  const tracked = children.filter((child) => child.status);
  const doneCount = tracked.filter((child) => child.status === 'done').length;

  // Escape closes the drawer, unless focus is in something layered over it (the note editor).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement;
      if (active && active !== document.body && !panelRef.current?.contains(active)) return;
      onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <aside ref={panelRef} className={styles.drawer} aria-label={`Event: ${title}`}>
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.meta}>
              <span className="tnum">{formatDateRange(startDate, endDate)}</span>
              <StatusPill status={status} />
            </p>
          </div>
          <button type="button" className={ui.iconBtn} onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.actionsRow}>
            <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.sm}`} onClick={() => onOpenNote(eventNote)}>
              <FileText size={14} />
              Open note
            </button>
            {tracked.length > 0 && (
              <span className={`${styles.progressLabel} tnum`}>
                {doneCount}/{tracked.length} done
              </span>
            )}
          </div>
          {tracked.length > 0 && (
            <div
              className={styles.pbar}
              role="progressbar"
              aria-label="Notes done"
              aria-valuemin={0}
              aria-valuemax={tracked.length}
              aria-valuenow={doneCount}
            >
              <i style={{ width: `${(doneCount / tracked.length) * 100}%` }} />
            </div>
          )}

          <div className={ui.sectionLabel}>Notes in this event</div>
          {children.length === 0 ? (
            <p className={styles.empty}>No notes yet. Add one to start tracking this event.</p>
          ) : (
            <ul className={styles.childList}>
              {children.map((child) => (
                <li key={child.id} className={styles.childRow}>
                  <button type="button" className={styles.childMain} onClick={() => onOpenNote(child)}>
                    {child.status ? (
                      <StatusDot small status={child.status} />
                    ) : (
                      <FileText size={14} className={styles.noteIcon} aria-label="Note" />
                    )}
                    <span className={`${styles.childDate} tnum`}>
                      {child.scheduled_date ? formatShortDate(child.scheduled_date) : '—'}
                    </span>
                    <span className={`${styles.childTitle} ${child.status === 'done' ? styles.childDone : ''}`}>
                      {child.title || 'Untitled'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`${ui.iconBtn} ${ui.iconSm} ${ui.iconDanger}`}
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
        </div>

        <footer className={styles.foot}>
          <button type="button" className={`${ui.btn} ${ui.primary}`} onClick={() => onCreateChild(eventNote.id)}>
            <Plus size={15} />
            New note
          </button>
          <button
            type="button"
            className={`${ui.btn} ${ui.ghost} ${isAttaching ? ui.on : ''}`}
            onClick={() => setIsAttaching((prev) => !prev)}
            aria-expanded={isAttaching}
          >
            <Link2 size={15} />
            Attach
          </button>
          {isAttaching && (
            <div className={styles.attachPop}>
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
        </footer>
      </aside>
    </>
  );
};
