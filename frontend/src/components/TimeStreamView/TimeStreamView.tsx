import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Lock } from 'lucide-react';
import { getView, useReplica } from '../../lib/replica';
import { buildTimestream } from '../../lib/schedule';
import { decryptNote } from '../../lib/crypto';
import type { Note } from '../NoteCard/NoteCard';
import ui from '../ui/ui.module.css';
import { TimeStreamCanvas, type TimeStreamEvent } from './TimeStreamCanvas';
import { groupChildMarkers } from './streamGrouping';
import { EventPanel } from './EventPanel';
import styles from './TimeStreamView.module.css';

interface TimeStreamViewProps {
  onOpenNote: (note: Note) => void;
  notes?: Note[];
  cryptoKey: CryptoKey | null;
  showCompleted?: boolean;
  centerDate: Date;
  onCenterDateChange: (date: Date) => void;
  zoomLevel: number;
  onZoomChange: (zoom: number) => void;
  onCreateChild?: (parentId: string) => void;
  onSetParent?: (noteId: string, parentId: string | null) => void;
}

function toISODateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Continuous zoom (0..1) to visible days: 14 (day scale) .. 56 .. 180 .. 365 .. 1095 (year scale).
function getRangeDays(z: number): number {
  if (z <= 0.25) return 14 + (z / 0.25) * (56 - 14);
  if (z <= 0.5) return 56 + ((z - 0.25) / 0.25) * (180 - 56);
  if (z <= 0.75) return 180 + ((z - 0.5) / 0.25) * (365 - 180);
  return 365 + ((z - 0.75) / 0.25) * (1095 - 365);
}

export const TimeStreamView: React.FC<TimeStreamViewProps> = ({
  onOpenNote,
  notes = [],
  cryptoKey,
  showCompleted = true,
  centerDate,
  onCenterDateChange,
  zoomLevel,
  onZoomChange,
  onCreateChild,
  onSetParent,
}) => {
  const [events, setEvents] = useState<TimeStreamEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [openEvent, setOpenEvent] = useState<TimeStreamEvent | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1000);
  const containerRef = useRef<HTMLDivElement>(null);
  const decryptedNotesCache = useRef<Map<string, { note: Note; updatedAt: string | null }>>(new Map());
  const replica = useReplica();

  // Measure the timeline card's inner width.
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const rangeDays = getRangeDays(zoomLevel);
  const halfRangeMs = (rangeDays / 2) * 24 * 60 * 60 * 1000;
  const viewportStart = new Date(centerDate.getTime() - halfRangeMs);
  const viewportEnd = new Date(centerDate.getTime() + halfRangeMs);

  // Fetch Events
  useEffect(() => {
    if (!cryptoKey) return;

    let isMounted = true;
    const fetchDebounce = setTimeout(async () => {
      try {
        setIsLoading(true);
        // Add a buffer so panning feels smoother before refetching
        const bufferMs = halfRangeMs * 0.5;
        const fetchStart = toISODateString(new Date(viewportStart.getTime() - bufferMs));
        const fetchEnd = toISODateString(new Date(viewportEnd.getTime() + bufferMs));

        if (isMounted) {
          const data = buildTimestream(getView(), fetchStart, fetchEnd) as unknown as TimeStreamEvent[];

          // Decrypt each note once per version so panning stays smooth.
          const distinctNotesToDecrypt = new Map<string, Note>();
          for (const ev of data) {
            const cached = decryptedNotesCache.current.get(ev.note.id);
            if (!cached || cached.updatedAt !== ev.note.updated_at) {
              distinctNotesToDecrypt.set(ev.note.id, ev.note);
            }
          }

          if (distinctNotesToDecrypt.size > 0) {
            await Promise.all(
              Array.from(distinctNotesToDecrypt.entries()).map(async ([noteId, rawNote]) => {
                const { note: decrypted } = await decryptNote(rawNote, cryptoKey);
                decryptedNotesCache.current.set(noteId, {
                  note: decrypted,
                  updatedAt: rawNote.updated_at,
                });
              }),
            );
          }

          const decryptedEvents: TimeStreamEvent[] = data.map((ev: TimeStreamEvent) => {
            const cached = decryptedNotesCache.current.get(ev.note.id);
            return {
              ...ev,
              note: cached ? cached.note : ev.note,
            };
          });

          setEvents(showCompleted ? decryptedEvents : decryptedEvents.filter((e) => e.status !== 'done'));
        }
      } catch (err) {
        console.error('Failed to fetch timestream events', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(fetchDebounce);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerDate.getTime(), zoomLevel, cryptoKey, showCompleted, notes, replica]);

  const handleZoomFromCanvas = useCallback(
    (delta: number) => onZoomChange(Math.max(0, Math.min(1, zoomLevel + delta))),
    [onZoomChange, zoomLevel],
  );

  const handlePan = useCallback(
    (deltaMs: number) => onCenterDateChange(new Date(centerDate.getTime() + deltaMs)),
    [centerDate, onCenterDateChange],
  );

  // Group before the zoom filter so markers stay on a visible parent bar even
  // when single-day events are hidden at this zoom level.
  const { laneEvents, markersByParent } = useMemo(() => groupChildMarkers(events), [events]);

  // "2/3 done" on a bar counts every child note that is a task, not only the visible markers.
  const childProgress = useMemo(() => {
    const progress = new Map<string, { done: number; total: number }>();
    for (const note of notes) {
      if (!note.parent_note_id || note.status == null) continue;
      const entry = progress.get(note.parent_note_id) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (note.status === 'done') entry.done += 1;
      progress.set(note.parent_note_id, entry);
    }
    return progress;
  }, [notes]);

  if (!cryptoKey) {
    return (
      <div className={styles.wrap}>
        <div className={ui.empty}>
          <Lock size={32} />
          <strong>Vault locked</strong>
        </div>
      </div>
    );
  }

  // Each scale shows notes at least as long as its unit: all at Day, 7+ days at Week,
  // 30+ at Month, 365+ at Year.
  const minDays = zoomLevel <= 0.25 ? 1 : zoomLevel <= 0.5 ? 7 : zoomLevel <= 0.75 ? 30 : 365;
  const visibleEvents = laneEvents.filter((e) => {
    const start = new Date(e.start_date + 'T00:00:00').getTime();
    const end = new Date(e.end_date + 'T00:00:00').getTime();
    const durationDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
    return durationDays >= minDays;
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.hz} ref={containerRef}>
        <TimeStreamCanvas
          events={visibleEvents}
          viewportStart={viewportStart}
          viewportEnd={viewportEnd}
          zoomLevel={zoomLevel}
          onOpenNote={onOpenNote}
          onPan={handlePan}
          onZoom={handleZoomFromCanvas}
          containerWidth={containerWidth}
          markersByParent={markersByParent}
          childProgress={childProgress}
          onOpenEvent={(event) => (onCreateChild && onSetParent ? setOpenEvent(event) : onOpenNote(event.note))}
        />
        {visibleEvents.length === 0 && (
          <div className={styles.overlayMsg}>
            {isLoading ? (
              <div className={ui.empty}>Loading timeline…</div>
            ) : (
              <div className={ui.empty}>
                <strong>Nothing at this scale</strong>
                {minDays > 1 ? 'Switch to Day to see shorter notes.' : 'Notes with a date show up here.'}
              </div>
            )}
          </div>
        )}
      </div>
      <p className={styles.hint}>Drag sideways to move through time. Click a bar to see the notes inside it.</p>

      {openEvent && onCreateChild && onSetParent && (
        <EventPanel
          event={openEvent}
          allNotes={notes}
          onClose={() => setOpenEvent(null)}
          onOpenNote={onOpenNote}
          onCreateChild={onCreateChild}
          onSetParent={onSetParent}
        />
      )}
    </div>
  );
};
