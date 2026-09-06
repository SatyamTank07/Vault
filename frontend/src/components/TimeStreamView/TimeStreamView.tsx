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
  notes: Note[];
  fetchNotes: () => void;
  cryptoKey: CryptoKey | null;
  showCompleted?: boolean;
}

function toISODateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const TimeStreamView: React.FC<TimeStreamViewProps> = ({
  onOpenNote,
  cryptoKey,
  showCompleted = true,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(0.1);
  const [centerDate, setCenterDate] = useState<Date>(new Date());
  
  const [events, setEvents] = useState<TimeStreamEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [containerWidth, setContainerWidth] = useState<number>(1000);
  const containerRef = useRef<HTMLDivElement>(null);

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
          const decryptedEvents: TimeStreamEvent[] = await Promise.all(
            data.map(async (ev: any) => {
              const { note: decryptedNote } = await decryptNote(ev.note as unknown as Note, cryptoKey);
              return {
                ...ev,
                note: decryptedNote,
              };
            })
          );
          
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
  }, [centerDate.getTime(), zoomLevel, cryptoKey, showCompleted]);

  const handleZoomChange = useCallback((newZoom: number) => {
    setZoomLevel(Math.max(0, Math.min(1, newZoom)));
  }, []);

  const handleZoomFromCanvas = useCallback((delta: number, _centerX: number) => {
    setZoomLevel(prev => Math.max(0, Math.min(1, prev + delta)));
  }, []);

  const handlePan = useCallback((deltaMs: number) => {
    setCenterDate(prev => new Date(prev.getTime() + deltaMs));
  }, []);

  const handlePanByScreen = useCallback((direction: 1 | -1) => {
    const shiftMs = halfRangeMs * 0.75 * direction;
    setCenterDate(prev => new Date(prev.getTime() + shiftMs));
  }, [halfRangeMs]);

  const handleGoToToday = useCallback(() => {
    setCenterDate(new Date());
  }, []);

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
    <div className={styles.container} ref={containerRef}>
      <TimeStreamControls 
        zoomLevel={zoomLevel}
        onZoomChange={handleZoomChange}
        onGoToToday={handleGoToToday}
        viewportStart={viewportStart}
        viewportEnd={viewportEnd}
        onPanByScreen={handlePanByScreen}
      />
      
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
