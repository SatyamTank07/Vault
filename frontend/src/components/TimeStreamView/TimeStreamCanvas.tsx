import React, { useRef, useState, useMemo, useEffect, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
import type { Note } from '../NoteCard/NoteCard';
import styles from './TimeStreamView.module.css';

export interface TimeStreamEvent {
  id: string;
  note: Note;
  start_date: string;
  end_date: string;
  status: string;
  canvas_name: string | null;
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

export function getEventDurationDays(startDate: string, endDate: string): number {
  const s = new Date(startDate + 'T00:00:00').getTime();
  const e = new Date(endDate + 'T00:00:00').getTime();
  return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
}

export function getEventBarStyle(event: TimeStreamEvent) {
  const duration = getEventDurationDays(event.start_date, event.end_date);

  // Day Task: Warm Sunset / Amber Coral (< 7 days)
  if (duration < 7) {
    return {
      background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
      boxShadow: '0 2px 8px rgba(249, 115, 22, 0.28)',
      border: '1px solid rgba(254, 215, 170, 0.4)',
      typeLabel: 'Day Task',
      color: '#f97316',
    };
  }
  // Week Task: Emerald Green (7–29 days)
  if (duration < 30) {
    return {
      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      boxShadow: '0 2px 8px rgba(16, 185, 129, 0.28)',
      border: '1px solid rgba(167, 243, 208, 0.4)',
      typeLabel: 'Week Task',
      color: '#10b981',
    };
  }
  // Month Project: Sky / Ocean Blue (30–364 days)
  if (duration < 365) {
    return {
      background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
      boxShadow: '0 2px 8px rgba(14, 165, 233, 0.28)',
      border: '1px solid rgba(186, 230, 253, 0.4)',
      typeLabel: 'Month Project',
      color: '#0ea5e9',
    };
  }
  // Year Project: Royal Purple / Violet (>= 365 days)
  return {
    background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
    boxShadow: '0 2px 8px rgba(139, 92, 246, 0.28)',
    border: '1px solid rgba(221, 214, 254, 0.4)',
    typeLabel: 'Year Project',
    color: '#8b5cf6',
  };
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

export function getISOWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

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

  // Multi-Tier Segments Generation:
  // 1. Year Segments (PURPLE) - shown in all views
  const yearSegments = useMemo(() => {
    const segments: { id: string; left: number; width: number; label: string; offset: number }[] = [];
    const curr = new Date(viewportStart.getFullYear(), 0, 1);
    let safety = 0;
    while (curr <= viewportEnd && safety < 100) {
      safety++;
      const next = new Date(curr.getFullYear() + 1, 0, 1);
      const left = timeToX(curr);
      const right = timeToX(next);
      const width = right - left;
      const offset = left < 0 ? Math.min(-left + 8, Math.max(8, width - 60)) : 8;
      segments.push({
        id: `year-${curr.getFullYear()}`,
        left,
        width,
        label: curr.getFullYear().toString(),
        offset,
      });
      curr.setFullYear(curr.getFullYear() + 1);
    }
    return segments;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportStart.getTime(), viewportEnd.getTime(), containerWidth, viewportRangeMs]);

  // 2. Month Segments (BLUE) - shown in Day, Week, and Month views
  const monthSegments = useMemo(() => {
    if (scale === 'year') return [];
    const segments: { id: string; left: number; width: number; label: string; offset: number }[] = [];
    const curr = new Date(viewportStart.getFullYear(), viewportStart.getMonth(), 1);
    let safety = 0;
    while (curr <= viewportEnd && safety < 200) {
      safety++;
      const next = new Date(curr.getFullYear(), curr.getMonth() + 1, 1);
      const left = timeToX(curr);
      const right = timeToX(next);
      const width = right - left;
      const monthLong = curr.toLocaleDateString('en-US', { month: 'long' });
      const monthShort = curr.toLocaleDateString('en-US', { month: 'short' });
      const label = width > 75 ? monthLong : monthShort;
      const offset = left < 0 ? Math.min(-left + 8, Math.max(8, width - 60)) : 8;
      segments.push({
        id: `month-${curr.getFullYear()}-${curr.getMonth()}`,
        left,
        width,
        label,
        offset,
      });
      curr.setMonth(curr.getMonth() + 1);
    }
    return segments;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportStart.getTime(), viewportEnd.getTime(), containerWidth, viewportRangeMs, scale]);

  // 3. Week Segments (EMERALD GREEN) - shown in Day and Week views
  const weekSegments = useMemo(() => {
    if (scale === 'month' || scale === 'year') return [];
    const segments: { id: string; left: number; width: number; label: string; offset: number }[] = [];
    const curr = new Date(viewportStart);
    curr.setHours(0, 0, 0, 0);
    const day = curr.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Align to Monday
    curr.setDate(curr.getDate() + diff);

    let safety = 0;
    while (curr <= viewportEnd && safety < 300) {
      safety++;
      const next = new Date(curr);
      next.setDate(next.getDate() + 7);
      const left = timeToX(curr);
      const right = timeToX(next);
      const width = right - left;
      const weekNum = getISOWeekNumber(curr);
      const label = width > 70 ? `Week ${weekNum}` : `W${weekNum}`;
      const offset = left < 0 ? Math.min(-left + 6, Math.max(6, width - 50)) : 6;
      segments.push({
        id: `week-${curr.getTime()}`,
        left,
        width,
        label,
        offset,
      });
      curr.setDate(curr.getDate() + 7);
    }
    return segments;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportStart.getTime(), viewportEnd.getTime(), containerWidth, viewportRangeMs, scale]);

  // 4. Day Segments (SLATE / NEUTRAL) - shown ONLY in Day view
  const daySegments = useMemo(() => {
    if (scale !== 'day') return [];
    const segments: {
      id: string;
      left: number;
      width: number;
      dayNum: string;
      dayName: string;
      isToday: boolean;
    }[] = [];
    const curr = new Date(viewportStart);
    curr.setHours(0, 0, 0, 0);
    const todayStr = new Date().toDateString();

    let safety = 0;
    while (curr <= viewportEnd && safety < 100) {
      safety++;
      const next = new Date(curr);
      next.setDate(next.getDate() + 1);
      const left = timeToX(curr);
      const right = timeToX(next);
      const width = right - left;
      const isToday = curr.toDateString() === todayStr;
      segments.push({
        id: `day-${curr.getTime()}`,
        left,
        width,
        dayNum: curr.getDate().toString(),
        dayName: curr.toLocaleDateString('en-US', { weekday: 'short' }),
        isToday,
      });
      curr.setDate(curr.getDate() + 1);
    }
    return segments;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportStart.getTime(), viewportEnd.getTime(), containerWidth, viewportRangeMs, scale]);

  const avgDayWidth = daySegments.length > 0 && containerWidth > 0 ? containerWidth / daySegments.length : 20;

  // Background Guide Lines
  const gridLines = useMemo(() => {
    const lines: { id: string; x: number; isMajor: boolean }[] = [];
    if (scale === 'day') {
      daySegments.forEach(seg => {
        lines.push({ id: `gl-${seg.id}`, x: seg.left, isMajor: seg.isToday || seg.dayName === 'Mon' });
      });
    } else if (scale === 'week') {
      weekSegments.forEach(seg => {
        lines.push({ id: `gl-${seg.id}`, x: seg.left, isMajor: true });
      });
    } else if (scale === 'month') {
      monthSegments.forEach(seg => {
        lines.push({ id: `gl-${seg.id}`, x: seg.left, isMajor: true });
      });
    } else {
      yearSegments.forEach(seg => {
        lines.push({ id: `gl-${seg.id}`, x: seg.left, isMajor: true });
      });
    }
    return lines;
  }, [daySegments, weekSegments, monthSegments, yearSegments, scale]);

  // 2. Events Lanes Allocation (Greedy)
  const startMs = viewportStart.getTime();
  const endMs = viewportEnd.getTime();
  const laidOutEvents = useMemo(() => {
    const lanes: { endX: number }[] = [];
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
        if (lanes[i].endX + bufferPx <= x) {
          lanes[i].endX = x + w;
          placedLane = i;
          break;
        }
      }

      if (placedLane === -1) {
        lanes.push({ endX: x + w });
        placedLane = lanes.length - 1;
      }

      // Only layout if it's within/overlapping viewport
      if (x + w > 0 && x < containerWidth) {
        eventLayouts.push({ event: ev, x, width: w, lane: placedLane });
      }
    });

    return eventLayouts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, startMs, endMs, containerWidth, viewportRangeMs]);

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
      {/* Background Guide Lines */}
      {gridLines.map(gl => (
        <div 
          key={gl.id} 
          className={`${styles.gridLine} ${gl.isMajor ? styles.majorGridLine : ''}`} 
          style={{ left: `${gl.x}px` }} 
        />
      ))}

      {/* Multi-Tier Time Ruler */}
      <div className={styles.timeRuler}>
        {/* Tier 1: Year (shown in all views) - PURPLE */}
        <div className={`${styles.rulerTier} ${styles.yearTier}`}>
          {yearSegments.map(seg => (
            <div
              key={seg.id}
              className={styles.yearSegment}
              style={{ left: `${seg.left}px`, width: `${seg.width}px` }}
            >
              <span className={styles.yearBadge} style={{ transform: `translateX(${seg.offset}px)` }}>
                {seg.label}
              </span>
            </div>
          ))}
        </div>

        {/* Tier 2: Month (shown in Day, Week, Month views) - BLUE */}
        {(scale === 'day' || scale === 'week' || scale === 'month') && (
          <div className={`${styles.rulerTier} ${styles.monthTier}`}>
            {monthSegments.map(seg => (
              <div
                key={seg.id}
                className={styles.monthSegment}
                style={{ left: `${seg.left}px`, width: `${seg.width}px` }}
              >
                <span className={styles.monthBadge} style={{ transform: `translateX(${seg.offset}px)` }}>
                  {seg.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Tier 3: Week (shown in Day and Week views) - EMERALD GREEN */}
        {(scale === 'day' || scale === 'week') && (
          <div className={`${styles.rulerTier} ${styles.weekTier}`}>
            {weekSegments.map(seg => (
              <div
                key={seg.id}
                className={styles.weekSegment}
                style={{ left: `${seg.left}px`, width: `${seg.width}px` }}
              >
                <span className={styles.weekBadge} style={{ transform: `translateX(${seg.offset}px)` }}>
                  {seg.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Tier 4: Day (shown ONLY when zoomed in enough that days have readable width) */}
        {scale === 'day' && avgDayWidth >= 14 && (
          <div className={`${styles.rulerTier} ${styles.dayTier}`}>
            {daySegments.map(seg => {
              const shouldShowNum = seg.width >= 22 || (seg.width >= 14 && (parseInt(seg.dayNum, 10) % 5 === 0 || seg.dayNum === '1')) || seg.isToday;
              return (
                <div
                  key={seg.id}
                  className={`${styles.daySegment} ${seg.isToday ? styles.dayToday : ''}`}
                  style={{ left: `${seg.left}px`, width: `${seg.width}px` }}
                >
                  {shouldShowNum && <span className={styles.dayNum}>{seg.dayNum}</span>}
                  {seg.width >= 32 && <span className={styles.dayName}>{seg.dayName}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Today Indicator */}
      {showToday && (
        <div className={styles.todayLine} style={{ left: `${todayX}px` }}>
          <div className={styles.todayBadge}>Today</div>
        </div>
      )}

      {/* Event Bars */}
      {laidOutEvents.map(({ event, x, width, lane }) => {
        const yPos = 20 + lane * 42;
        
        // Calculate offset to keep title visible on screen if bar starts off-screen
        const visibleStartX = Math.max(0, x);
        const offsetInsideBar = visibleStartX - x;
        const clampOffset = Math.min(offsetInsideBar, Math.max(0, width - 40));
        const barStyle = getEventBarStyle(event);

        return (
          <div
            key={`${event.id}-${event.start_date}`}
            className={styles.eventBar}
            style={{
              left: `${x}px`,
              width: `${width}px`,
              top: `${yPos}px`,
              background: barStyle.background,
              boxShadow: barStyle.boxShadow,
              border: barStyle.border,
              opacity: event.status === 'done' ? 0.72 : 1,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenNote(event.note);
            }}
            onMouseEnter={(e) => handleEventMouseEnter(e, event)}
            onMouseLeave={() => setHoveredEvent(null)}
          >
            <div 
              className={styles.eventBarText}
              style={{
                transform: `translateX(${clampOffset}px)`,
                maxWidth: `${Math.max(40, width - clampOffset - 12)}px`,
              }}
            >
              {event.status === 'done' && <span style={{ marginRight: '4px', fontWeight: 'bold' }}>✓</span>}
              {event.note.title || 'Untitled'}
            </div>
          </div>
        );
      })}

      {/* Tooltip */}
      {hoveredEvent && !isDragging && (() => {
        const barStyle = getEventBarStyle(hoveredEvent);
        return (
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
              <span style={{ fontWeight: 600, color: barStyle.color }}>
                · {barStyle.typeLabel}
              </span>
              {hoveredEvent.canvas_name && <span> · {hoveredEvent.canvas_name}</span>}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
