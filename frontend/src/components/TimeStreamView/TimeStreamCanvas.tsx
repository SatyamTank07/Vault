import React, { useRef, useState, useMemo, useEffect, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { Repeat } from 'lucide-react';
import type { Note } from '../NoteCard/NoteCard';
import { formatDateRange, normalizeStatus, STATUS_LABELS } from '../../lib/noteText';
import { StatusDot } from '../ui/StatusControl';
import styles from './TimeStreamView.module.css';

export interface TimeStreamEvent {
  id: string;
  note: Note;
  start_date: string;
  end_date: string;
  status: string;
  canvas_name: string | null;
  is_recurring?: boolean;
  is_span?: boolean;
  occurrence_id?: string | null;
  parent_note_id?: string | null;
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
  markersByParent: Map<string, TimeStreamEvent[]>;
  /** Done/total over each note's child notes that are tasks, keyed by note id. */
  childProgress: Map<string, { done: number; total: number }>;
  onOpenEvent: (event: TimeStreamEvent) => void;
}

interface Segment {
  id: string;
  left: number;
  width: number;
  label: string;
  /** Second line in the lower tier (weekday, "Week of"). */
  sub?: string;
  isToday?: boolean;
}

const DAY_MS = 86400000;
const LANE_H = 46;
const LANES_TOP = 16;
const statusMod = (status: string) =>
  ({ todo: '', in_progress: styles.stProgress, done: styles.stDone })[normalizeStatus(status)];

export const TimeStreamCanvas: React.FC<TimeStreamCanvasProps> = ({
  events,
  viewportStart,
  viewportEnd,
  zoomLevel,
  onOpenNote,
  onPan,
  onZoom,
  containerWidth,
  markersByParent,
  childProgress,
  onOpenEvent,
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
        onZoom(zoomDelta, e.clientX - rect.left);
      } else if (e.shiftKey) {
        e.preventDefault();
        // deltaY > 0 (scroll down/back) moves the timeline forward.
        onPan((e.deltaY > 0 ? 0.1 : -0.1) * viewportRangeMs);
      }
      // Without modifiers the lanes scroll vertically as usual.
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [onZoom, onPan, viewportRangeMs]);

  // --- Mouse handlers ---
  const handleMouseDown = (e: ReactMouseEvent) => {
    isDraggingRef.current = true;
    lastXRef.current = e.clientX;
    setIsDragging(true);
  };

  const handleMouseMove = (e: ReactMouseEvent) => {
    if (isDraggingRef.current) {
      const dx = e.clientX - lastXRef.current;
      onPan(-(dx / containerWidth) * viewportRangeMs);
      lastXRef.current = e.clientX;
      setHoveredEvent(null);
    } else if (hoveredEvent) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
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
      onPan(-(dx / containerWidth) * viewportRangeMs);
      lastXRef.current = e.touches[0].clientX;
    } else if (e.touches.length === 2 && lastTouchDistance !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const rect = containerRef.current?.getBoundingClientRect();
      const centerX = rect ? (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left : containerWidth / 2;
      onZoom(dist > lastTouchDistance ? 0.03 : -0.03, centerX);
      setLastTouchDistance(dist);
    }
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
    setLastTouchDistance(null);
  };

  // --- Layout ---
  const startMs = viewportStart.getTime();
  const endMs = viewportEnd.getTime();
  const scale = zoomLevel <= 0.25 ? 'day' : zoomLevel <= 0.5 ? 'week' : zoomLevel <= 0.75 ? 'month' : 'year';

  // Two-tier ruler: months over days or weeks, or years over months. The lower tier also
  // sets the grid lines.
  const { topSegments, bottomSegments } = useMemo(() => {
    const toX = (t: number) => ((t - startMs) / (endMs - startMs)) * containerWidth;
    const top: Segment[] = [];
    const bottom: Segment[] = [];
    const start = new Date(startMs);
    const end = new Date(endMs);

    const months = (target: Segment[], labelFor: (d: Date, width: number) => string) => {
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      for (let i = 0; cur <= end && i < 400; i++) {
        const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        const left = toX(cur.getTime());
        const width = toX(next.getTime()) - left;
        target.push({ id: `m-${cur.getTime()}`, left, width, label: labelFor(cur, width) });
        cur.setMonth(cur.getMonth() + 1);
      }
    };
    const years = (target: Segment[]) => {
      const cur = new Date(start.getFullYear(), 0, 1);
      for (let i = 0; cur <= end && i < 100; i++) {
        const next = new Date(cur.getFullYear() + 1, 0, 1);
        const left = toX(cur.getTime());
        target.push({ id: `y-${cur.getFullYear()}`, left, width: toX(next.getTime()) - left, label: String(cur.getFullYear()) });
        cur.setFullYear(cur.getFullYear() + 1);
      }
    };

    if (scale === 'day' || scale === 'week') {
      months(top, (d, width) => d.toLocaleDateString('en-US', { month: width >= 150 ? 'long' : 'short', year: 'numeric' }));
    } else {
      years(top);
    }

    if (scale === 'day') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cur = new Date(start);
      cur.setHours(0, 0, 0, 0);
      for (let i = 0; cur <= end && i < 200; i++) {
        const left = toX(cur.getTime());
        const width = toX(cur.getTime() + DAY_MS) - left;
        const daysFromToday = Math.round((cur.getTime() - today.getTime()) / DAY_MS);
        // Cells too narrow for every number (phones) keep today and the Mondays clear of it.
        const labelled = width >= 20 || daysFromToday === 0 || (cur.getDay() === 1 && Math.abs(daysFromToday) > 1);
        bottom.push({
          id: `d-${cur.getTime()}`,
          left,
          width,
          label: labelled ? String(cur.getDate()) : '',
          sub: width >= 34 ? cur.toLocaleDateString('en-US', { weekday: 'short' }) : undefined,
          isToday: daysFromToday === 0,
        });
        cur.setDate(cur.getDate() + 1);
      }
    } else if (scale === 'week') {
      const cur = new Date(start);
      cur.setHours(0, 0, 0, 0);
      cur.setDate(cur.getDate() + (cur.getDay() === 0 ? -6 : 1 - cur.getDay()));
      for (let i = 0; cur <= end && i < 300; i++) {
        const next = new Date(cur);
        next.setDate(next.getDate() + 7);
        const left = toX(cur.getTime());
        const width = toX(next.getTime()) - left;
        bottom.push({
          id: `w-${cur.getTime()}`,
          left,
          width,
          label: width >= 52 ? cur.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : String(cur.getDate()),
          sub: width >= 52 ? 'Week of' : undefined,
        });
        cur.setDate(cur.getDate() + 7);
      }
    } else {
      months(bottom, (d, width) => d.toLocaleDateString('en-US', { month: width >= 40 ? 'short' : 'narrow' }));
    }
    return { topSegments: top, bottomSegments: bottom };
  }, [startMs, endMs, containerWidth, scale]);

  // Lanes: spans and single-day notes pack greedily; each repeating note gets its own track.
  const { bars, tracks, laneCount } = useMemo(() => {
    const toX = (t: number) => ((t - startMs) / (endMs - startMs)) * containerWidth;
    const laneEnds: number[] = [];
    const placed: { event: TimeStreamEvent; x: number; width: number; lane: number }[] = [];

    const sorted = events
      .filter((e) => !e.is_recurring)
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || b.end_date.localeCompare(a.end_date));

    for (const ev of sorted) {
      const x = toX(new Date(ev.start_date + 'T00:00:00').getTime());
      const width = Math.max(toX(new Date(ev.end_date + 'T00:00:00').getTime() + DAY_MS) - x, 30);
      // Reserve room for the title so short bars don't overlap the next one's label.
      const reach = x + Math.max(width, Math.min(240, (ev.note.title || 'Untitled').length * 8 + 40));
      let lane = laneEnds.findIndex((endX) => endX + 6 <= x);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = reach;
      if (x + width > 0 && x < containerWidth) placed.push({ event: ev, x, width, lane });
    }

    const byNote = new Map<string, TimeStreamEvent[]>();
    for (const ev of events.filter((e) => e.is_recurring)) {
      byNote.set(ev.note.id, [...(byNote.get(ev.note.id) ?? []), ev]);
    }
    const trackList = [...byNote.values()].map((occurrences, i) => ({
      noteId: occurrences[0].note.id,
      title: occurrences[0].note.title || 'Untitled',
      note: occurrences[0].note,
      lane: laneEnds.length + i,
      dots: occurrences
        .map((ev) => ({ event: ev, x: toX(new Date(ev.start_date + 'T12:00:00').getTime()) }))
        .filter((d) => d.x >= -10 && d.x <= containerWidth + 10),
    }));

    return { bars: placed, tracks: trackList, laneCount: laneEnds.length + trackList.length };
  }, [events, startMs, endMs, containerWidth]);

  const timeToX = (date: Date) => ((date.getTime() - startMs) / viewportRangeMs) * containerWidth;
  const todayX = timeToX(new Date());
  const showToday = todayX >= 0 && todayX <= containerWidth;
  const lanesHeight = Math.max(300, LANES_TOP + laneCount * LANE_H + 24);

  const showTooltip = (e: ReactMouseEvent, ev: TimeStreamEvent) => {
    if (isDraggingRef.current) return;
    setHoveredEvent(ev);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.canvas} ${isDragging ? styles.canvasDragging : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className={styles.ruler}>
        <div className={`${styles.tier} ${styles.tierTop}`}>
          {topSegments.map((seg) => (
            <div key={seg.id} className={styles.seg} style={{ left: seg.left, width: seg.width }}>
              {/* Keep the label in view when its segment starts off-screen. */}
              <span style={{ transform: `translateX(${Math.max(0, Math.min(-seg.left, seg.width - 90))}px)` }}>{seg.label}</span>
            </div>
          ))}
        </div>
        <div className={`${styles.tier} ${styles.tierBot}`}>
          {bottomSegments.map((seg) => (
            <div
              key={seg.id}
              className={`${styles.seg} ${scale === 'day' ? '' : styles.segWide} ${seg.isToday ? styles.segToday : ''}`}
              style={{ left: seg.left, width: seg.width }}
            >
              {seg.sub && <small>{seg.sub}</small>}
              {seg.label && <b className="tnum">{seg.label}</b>}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.lanesScroll}>
        <div className={styles.lanes} style={{ height: lanesHeight }}>
          {bottomSegments.map((seg) => (
            <span key={`gl-${seg.id}`} className={styles.gridLine} style={{ left: seg.left }} />
          ))}
          {showToday && <span className={styles.todayLine} style={{ left: todayX }} />}

          {bars.map(({ event, x, width, lane }) => {
            const title = event.note.title || 'Untitled';
            const progress = childProgress.get(event.note.id);
            // Keep the title readable when the bar starts left of the viewport.
            const padLeft = x < 0 ? 10 - x : 10;
            // Too narrow for its title: show the title beside the bar instead (lane packing leaves room).
            const isShort = width < 110;
            return (
              <div
                key={`${event.id}-${event.start_date}`}
                data-bar
                className={`${styles.bar} ${statusMod(event.status)} ${isShort ? styles.barShort : ''}`}
                style={{ left: x, width, top: LANES_TOP + lane * LANE_H, paddingLeft: padLeft }}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (event.is_span) onOpenEvent(event);
                  else onOpenNote(event.note);
                }}
                onMouseEnter={(e) => showTooltip(e, event)}
                onMouseLeave={() => setHoveredEvent(null)}
              >
                <span className={styles.barInner}>
                  <StatusDot small status={event.status} />
                  <span className={styles.barTitle}>{title}</span>
                  {event.is_span && width > 220 && (
                    <span className={`${styles.barDates} tnum`}>{formatDateRange(event.start_date, event.end_date)}</span>
                  )}
                </span>
                {progress && progress.total > 0 && width > 180 && (
                  <span className={`${styles.barProgress} tnum`}>
                    {progress.done}/{progress.total} done
                  </span>
                )}
                {(markersByParent.get(event.note.id) ?? []).map((child) => (
                  <span
                    key={child.id}
                    className={`${styles.marker} ${statusMod(child.status)}`}
                    style={{ left: timeToX(new Date(child.start_date + 'T12:00:00')) - x }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenNote(child.note);
                    }}
                    onMouseEnter={(e) => showTooltip(e, child)}
                    onMouseLeave={(e) => showTooltip(e, event)}
                  />
                ))}
              </div>
            );
          })}

          {tracks.map((track) => {
            const top = LANES_TOP + track.lane * LANE_H;
            return (
              <div key={`track-${track.noteId}`} className={styles.track} style={{ top: top + 2 }}>
                <button
                  type="button"
                  className={styles.trackLabel}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onOpenNote(track.note)}
                >
                  <Repeat size={11} />
                  {track.title}
                </button>
                {track.dots.map(({ event, x }) => (
                  <span
                    key={`${event.id}-${event.start_date}`}
                    className={`${styles.trackDot} ${statusMod(event.status)}`}
                    style={{ left: x }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenNote(event.note);
                    }}
                    onMouseEnter={(e) => showTooltip(e, event)}
                    onMouseLeave={() => setHoveredEvent(null)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {hoveredEvent && !isDragging && (
        <div className={styles.tooltip} style={{ left: tooltipPos.x, top: tooltipPos.y - 8 }}>
          <div className={styles.tooltipTitle}>{hoveredEvent.note.title || 'Untitled'}</div>
          <div className={`${styles.tooltipDate} tnum`}>{formatDateRange(hoveredEvent.start_date, hoveredEvent.end_date)}</div>
          <div className={styles.tooltipMeta}>
            {[STATUS_LABELS[normalizeStatus(hoveredEvent.status)], hoveredEvent.is_recurring ? 'Repeats' : null, hoveredEvent.canvas_name]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      )}
    </div>
  );
};
