import React, { useRef, useState, useMemo, useEffect, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
import type { Note } from '../NoteCard/NoteCard';
import styles from './TimeStreamView.module.css';

export interface TimeStreamEvent {
  id: string;
  note: Note;
  start_date: string;
  end_date: string;
  status: string;
  canvas_name: string;
}

interface TimeStreamCanvasProps {
  events: TimeStreamEvent[];
  viewportStart: Date;
  viewportEnd: Date;
  zoomLevel: number;
  onOpenNote: (note: Note) => void;
  onPan: (deltaMs: number) => void;
  onZoom: (delta: number, centerX: number) => void;
  containerWidth: number;
}

const STATUS_COLORS: Record<string, string> = {
  todo: 'rgba(139, 92, 246, 0.85)',
  in_progress: 'rgba(245, 158, 11, 0.85)',
  done: 'rgba(16, 185, 129, 0.85)',
};

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

export const TimeStreamCanvas: React.FC<TimeStreamCanvasProps> = ({
  events,
  viewportStart,
  viewportEnd,
  zoomLevel,
  onOpenNote,
  onPan,
  onZoom,
  containerWidth,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Interaction State
  const isDraggingRef = useRef(false);
  const lastXRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [lastTouchDistance, setLastTouchDistance] = useState<number | null>(null);
  
  // Hover Tooltip State
  const [hoveredEvent, setHoveredEvent] = useState<TimeStreamEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const viewportRangeMs = viewportEnd.getTime() - viewportStart.getTime();

  // --- Wheel handler (needs native event for preventDefault) ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const zoomDelta = e.deltaY > 0 ? 0.03 : -0.03;
        const rect = el.getBoundingClientRect();
        const centerX = e.clientX - rect.left;
        onZoom(zoomDelta, centerX);
      } else if (e.shiftKey) {
        e.preventDefault();
        // deltaY > 0 (scroll down/back) -> move timeline forward
        // Use a pan ratio relative to the viewport size for smooth panning
        const panRatio = e.deltaY > 0 ? 0.1 : -0.1;
        const deltaMs = panRatio * viewportRangeMs;
        onPan(deltaMs);
      }
      // If no modifiers, allow standard browser scrolling
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [onZoom, containerWidth]);

  // --- Mouse handlers ---
  const handleMouseDown = (e: ReactMouseEvent) => {
    isDraggingRef.current = true;
    lastXRef.current = e.clientX;
    setIsDragging(true);
  };

  const handleMouseMove = (e: ReactMouseEvent) => {
    if (isDraggingRef.current) {
      const dx = e.clientX - lastXRef.current;
      const deltaMs = -(dx / containerWidth) * viewportRangeMs;
      onPan(deltaMs);
      lastXRef.current = e.clientX;
      setHoveredEvent(null);
    } else if (hoveredEvent) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
    setHoveredEvent(null);
  };

  // --- Touch handlers ---
  const handleTouchStart = (e: ReactTouchEvent) => {
    if (e.touches.length === 1) {
      isDraggingRef.current = true;
      lastXRef.current = e.touches[0].clientX;
      setIsDragging(true);
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      setLastTouchDistance(Math.sqrt(dx * dx + dy * dy));
    }
  };

  const handleTouchMove = (e: ReactTouchEvent) => {
    if (isDraggingRef.current && e.touches.length === 1) {
      const dx = e.touches[0].clientX - lastXRef.current;
      const deltaMs = -(dx / containerWidth) * viewportRangeMs;
      onPan(deltaMs);
      lastXRef.current = e.touches[0].clientX;
    } else if (e.touches.length === 2 && lastTouchDistance !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = dist > lastTouchDistance ? 0.03 : -0.03;
      
      const rect = containerRef.current?.getBoundingClientRect();
      const centerX = rect ? (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left : containerWidth / 2;
      
      onZoom(delta, centerX);
      setLastTouchDistance(dist);
    }
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
    setLastTouchDistance(null);
  };

  // --- Layout Calculations ---
  const timeToX = (date: Date) => {
    return ((date.getTime() - viewportStart.getTime()) / viewportRangeMs) * containerWidth;
  };

  // Determine scale from zoom level
  const scale = zoomLevel <= 0.25 ? 'day' : zoomLevel <= 0.5 ? 'week' : zoomLevel <= 0.75 ? 'month' : 'year';

  // 1. Ticks and Labels
  const ticks = useMemo(() => {
    const result: { id: number; x: number; label: string; isMajor: boolean }[] = [];
    
    const curr = new Date(viewportStart);
    curr.setHours(0, 0, 0, 0);

    // Initial alignment
    if (scale === 'week') {
      const day = curr.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      curr.setDate(curr.getDate() + diff);
    } else if (scale === 'month') {
      curr.setDate(1);
    } else if (scale === 'year') {
      curr.setMonth(0, 1);
    }

    let safety = 0;
    while (curr <= viewportEnd && safety < 500) {
      safety++;
      if (curr >= viewportStart) {
        const x = timeToX(curr);
        let label = '';
        let isMajor = false;

        if (scale === 'day') {
          label = curr.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
          isMajor = curr.getDate() === 1;
        } else if (scale === 'week') {
          label = curr.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
          isMajor = curr.getDate() <= 7;
        } else if (scale === 'month') {
          label = curr.toLocaleDateString('en-US', { month: 'short', year: zoomLevel > 0.6 ? 'numeric' : undefined });
          isMajor = curr.getMonth() === 0;
        } else {
          label = curr.getFullYear().toString();
          isMajor = true;
        }

        result.push({ id: curr.getTime(), x, label, isMajor });
      }

      // Advance
      if (scale === 'day') curr.setDate(curr.getDate() + 1);
      else if (scale === 'week') curr.setDate(curr.getDate() + 7);
      else if (scale === 'month') curr.setMonth(curr.getMonth() + 1);
      else curr.setFullYear(curr.getFullYear() + 1);
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportStart.getTime(), viewportEnd.getTime(), zoomLevel, containerWidth]);

  // 2. Events Lanes Allocation (Greedy)
  const laidOutEvents = useMemo(() => {
    const lanes: { endTime: number }[] = [];
    const eventLayouts: { event: TimeStreamEvent; x: number; width: number; lane: number }[] = [];

    // Sort by start date, then longer events first
    const sorted = [...events].sort((a, b) => {
      const aStart = new Date(a.start_date).getTime();
      const bStart = new Date(b.start_date).getTime();
      if (aStart !== bStart) return aStart - bStart;
      const aDur = new Date(a.end_date).getTime() - aStart;
      const bDur = new Date(b.end_date).getTime() - bStart;
      return bDur - aDur; // longer first
    });

    sorted.forEach((ev) => {
      const sDate = new Date(ev.start_date + 'T00:00:00');
      const eDate = new Date(ev.end_date + 'T23:59:59');
      
      let x = timeToX(sDate);
      let w = timeToX(eDate) - x;

      // Min width for visibility
      if (w < 40) w = 40;

      // Find lane (greedy)
      let placedLane = -1;
      const bufferPx = 6;
      for (let i = 0; i < lanes.length; i++) {
        if (timeToX(new Date(lanes[i].endTime)) + bufferPx <= x) {
          lanes[i].endTime = eDate.getTime();
          placedLane = i;
          break;
        }
      }

      if (placedLane === -1) {
        lanes.push({ endTime: eDate.getTime() });
        placedLane = lanes.length - 1;
      }

      // Only layout if it's within/overlapping viewport
      if (x + w > 0 && x < containerWidth) {
        eventLayouts.push({ event: ev, x, width: w, lane: placedLane });
      }
    });

    return eventLayouts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, viewportStart.getTime(), viewportEnd.getTime(), containerWidth, viewportRangeMs]);

  // Today line
  const now = new Date();
  const todayX = timeToX(now);
  const showToday = todayX >= 0 && todayX <= containerWidth;

  const handleEventMouseEnter = (e: ReactMouseEvent, ev: TimeStreamEvent) => {
    if (isDraggingRef.current) return;
    setHoveredEvent(ev);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  };

  const formatEventDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div 
      ref={containerRef}
      className={`${styles.canvasContainer} ${isDragging ? styles.canvasDragging : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Axis & Ticks */}
      <div className={styles.axis} />
      {ticks.map(t => (
        <React.Fragment key={t.id}>
          <div 
            className={`${styles.tick} ${t.isMajor ? styles.majorTick : ''}`}
            style={{ left: `${t.x}px` }} 
          />
          <div 
            className={`${styles.tickLabel} ${t.isMajor ? styles.majorTickLabel : ''}`}
            style={{ left: `${t.x}px` }}
          >
            {t.label}
          </div>
        </React.Fragment>
      ))}

      {/* Today Indicator */}
      {showToday && (
        <div className={styles.todayLine} style={{ left: `${todayX}px` }}>
          <div className={styles.todayBadge}>Today</div>
        </div>
      )}

      {/* Event Bars */}
      {laidOutEvents.map(({ event, x, width, lane }) => {
        const yPos = 20 + lane * 42;
        
        return (
          <div
            key={`${event.id}-${event.start_date}`}
            className={styles.eventBar}
            style={{
              left: `${x}px`,
              width: `${width}px`,
              top: `${yPos}px`,
              backgroundColor: STATUS_COLORS[event.status] || STATUS_COLORS.todo,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenNote(event.note);
            }}
            onMouseEnter={(e) => handleEventMouseEnter(e, event)}
            onMouseLeave={() => setHoveredEvent(null)}
          >
            <div className={styles.eventBarText}>
              {event.note.title || 'Untitled'}
            </div>
          </div>
        );
      })}

      {/* Tooltip */}
      {hoveredEvent && !isDragging && (
        <div 
          className={styles.tooltip}
          style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y - 8}px` }}
        >
          <div className={styles.tooltipTitle}>{hoveredEvent.note.title || 'Untitled'}</div>
          <div className={styles.tooltipDate}>
            {formatEventDate(hoveredEvent.start_date)}
            {hoveredEvent.start_date !== hoveredEvent.end_date && ` → ${formatEventDate(hoveredEvent.end_date)}`}
          </div>
          <div className={styles.tooltipMeta}>
            <span>{STATUS_LABELS[hoveredEvent.status] || 'To Do'}</span>
            {hoveredEvent.canvas_name && <span> · {hoveredEvent.canvas_name}</span>}
          </div>
        </div>
      )}
    </div>
  );
};
