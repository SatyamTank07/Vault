import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Lock } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { decryptNote } from '../../lib/crypto';
import type { Note } from '../NoteCard/NoteCard';
import { TimeStreamControls } from './TimeStreamControls';
import { TimeStreamCanvas, type TimeStreamEvent } from './TimeStreamCanvas';
import styles from './TimeStreamView.module.css';

interface TimeStreamViewProps {
  onOpenNote: (note: Note) => void;
  notes?: Note[];
  fetchNotes?: () => void;
  cryptoKey: CryptoKey | null;
  showCompleted?: boolean;
  centerDate?: Date;
  onCenterDateChange?: (date: Date) => void;
  zoomLevel?: number;
  onZoomChange?: (zoom: number) => void;
  hideControls?: boolean;
}

function toISODateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const TimeStreamView: React.FC<TimeStreamViewProps> = ({
  onOpenNote,
  notes = [],
  cryptoKey,
  showCompleted = true,
  centerDate: controlledCenterDate,
  onCenterDateChange,
  zoomLevel: controlledZoomLevel,
  onZoomChange,
  hideControls = false,
}) => {
  const [internalZoomLevel, setInternalZoomLevel] = useState<number>(0.1);
  const [internalCenterDate, setInternalCenterDate] = useState<Date>(new Date());

  const zoomLevel = controlledZoomLevel !== undefined ? controlledZoomLevel : internalZoomLevel;
  const centerDate = controlledCenterDate !== undefined ? controlledCenterDate : internalCenterDate;
  
  const [events, setEvents] = useState<TimeStreamEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [containerWidth, setContainerWidth] = useState<number>(1000);
  const containerRef = useRef<HTMLDivElement>(null);
  const decryptedNotesCache = useRef<Map<string, { note: Note; updatedAt: string | null }>>(new Map());

  // Measure container width
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

  // Compute viewport bounds based on zoomLevel and centerDate
  // Continuous interpolation between scales:
  // 0.0 -> 14 days (Day scale)
  // 0.25 -> 56 days (Week scale) 
  // 0.5 -> 180 days (Month scale)
  // 0.75 -> 365 days
  // 1.0 -> 1095 days (Year scale / 3 years)
  const getRangeDays = useCallback((z: number) => {
    if (z <= 0.25) return 14 + (z / 0.25) * (56 - 14);
    if (z <= 0.5) return 56 + ((z - 0.25) / 0.25) * (180 - 56);
    if (z <= 0.75) return 180 + ((z - 0.5) / 0.25) * (365 - 180);
    return 365 + ((z - 0.75) / 0.25) * (1095 - 365);
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

        const res = await apiFetch(`/api/timestream/?start_date=${fetchStart}&end_date=${fetchEnd}`);
        if (res.ok && isMounted) {
          const data = await res.json();

          // Refinement #2: Memoized decryption cache to ensure 60fps panning
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
              })
            );
          }

          const decryptedEvents: TimeStreamEvent[] = data.map((ev: TimeStreamEvent) => {
            const cached = decryptedNotesCache.current.get(ev.note.id);
            return {
              ...ev,
              note: cached ? cached.note : ev.note,
            };
          });
          
          let filtered = decryptedEvents;
          if (!showCompleted) {
            filtered = filtered.filter(e => e.status !== 'done');
          }
          
          setEvents(filtered);
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
  }, [centerDate.getTime(), zoomLevel, cryptoKey, showCompleted, notes]);

  const handleZoomChange = useCallback((newZoom: number) => {
    const clamped = Math.max(0, Math.min(1, newZoom));
    if (onZoomChange) {
      onZoomChange(clamped);
    } else {
      setInternalZoomLevel(clamped);
    }
  }, [onZoomChange]);

  const handleZoomFromCanvas = useCallback((delta: number) => {
    handleZoomChange(zoomLevel + delta);
  }, [handleZoomChange, zoomLevel]);

  const handlePan = useCallback((deltaMs: number) => {
    const nextDate = new Date(centerDate.getTime() + deltaMs);
    if (onCenterDateChange) {
      onCenterDateChange(nextDate);
    } else {
      setInternalCenterDate(nextDate);
    }
  }, [centerDate, onCenterDateChange]);

  const handlePanByScreen = useCallback((direction: 1 | -1) => {
    const shiftMs = halfRangeMs * 0.75 * direction;
    const nextDate = new Date(centerDate.getTime() + shiftMs);
    if (onCenterDateChange) {
      onCenterDateChange(nextDate);
    } else {
      setInternalCenterDate(nextDate);
    }
  }, [halfRangeMs, centerDate, onCenterDateChange]);

  const handleGoToToday = useCallback(() => {
    const today = new Date();
    if (onCenterDateChange) {
      onCenterDateChange(today);
    } else {
      setInternalCenterDate(today);
    }
  }, [onCenterDateChange]);

  if (!cryptoKey) {
    return (
      <div className={styles.container}>
        <div className={styles.lockedState}>
          <Lock className={styles.lockedIcon} />
          <span>Vault locked</span>
        </div>
      </div>
    );
  }

  const visibleEvents = events.filter((e) => {
    const start = new Date(e.start_date + 'T00:00:00').getTime();
    const end = new Date(e.end_date + 'T00:00:00').getTime();
    const durationDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);

    // 1. Day view: all day, week, month, year tasks appear
    if (zoomLevel <= 0.25) {
      return true;
    }

    // 2. Week view: week, month, year tasks appear (day tasks hidden)
    if (zoomLevel <= 0.5) {
      return durationDays >= 7;
    }

    // 3. Month view: month, year tasks appear (day and week tasks hidden)
    if (zoomLevel <= 0.75) {
      return durationDays >= 30;
    }

    // 4. Year view: year only tasks appear (day, week, month tasks hidden)
    return durationDays >= 365;
  });

  return (
    <div className={`${styles.container} ${hideControls ? styles.containerNoControls : ''}`} ref={containerRef}>
      {!hideControls && (
        <TimeStreamControls 
          zoomLevel={zoomLevel}
          onZoomChange={handleZoomChange}
          onGoToToday={handleGoToToday}
          viewportStart={viewportStart}
          viewportEnd={viewportEnd}
          onPanByScreen={handlePanByScreen}
        />
      )}
      
      {isLoading && visibleEvents.length === 0 && (
        <div className={styles.loadingState}>
          <div className={styles.loadingSpinner} />
          <p>Loading timeline...</p>
        </div>
      )}

      {!isLoading && visibleEvents.length === 0 && (
        <div className={styles.emptyState}>
          <p>No events found for this time scale.</p>
          <p style={{ fontSize: '13px', marginTop: '4px' }}>Zoom in/out to see notes with different durations.</p>
        </div>
      )}

      <TimeStreamCanvas 
        events={visibleEvents}
        viewportStart={viewportStart}
        viewportEnd={viewportEnd}
        zoomLevel={zoomLevel}
        onOpenNote={onOpenNote}
        onPan={handlePan}
        onZoom={handleZoomFromCanvas}
        containerWidth={containerWidth}
      />
    </div>
  );
};
