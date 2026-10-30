import type { LocalNote, LocalOccurrence, Snapshot } from './localDb';

/**
 * Client-side ports of crud.get_timeline and crud.get_timestream, run against the local copy so
 * the schedule works without the server. They return the same JSON shapes as those endpoints
 * (note title/content still encrypted). Dates are ISO `YYYY-MM-DD` strings throughout.
 */

function parseDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = parseDay(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDay(date);
}

function addMonths(iso: string, months: number): string {
  const source = parseDay(iso);
  const monthIndex = source.getUTCMonth() + months;
  const year = source.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatDay(new Date(Date.UTC(year, month, Math.min(source.getUTCDate(), lastDay))));
}

function daysBetween(start: string, end: string): number {
  return Math.round((parseDay(end).getTime() - parseDay(start).getTime()) / 86_400_000);
}

const maxDay = (a: string, b: string) => (a > b ? a : b);
const minDay = (a: string, b: string) => (a < b ? a : b);

/** Extra days a multi-day note covers after its start (0 for a single-day note). */
function spanDays(note: LocalNote): number {
  if (note.scheduled_date && note.end_date && note.end_date > note.scheduled_date) {
    return daysBetween(note.scheduled_date, note.end_date);
  }
  return 0;
}

export function expandRecurrence(note: LocalNote, start: string, end: string): string[] {
  if (!note.recurrence_rule || !note.scheduled_date) return [];

  const dates: string[] = [];
  const interval = note.recurrence_interval || 1;
  let current = note.scheduled_date;
  while (current <= end) {
    if (note.recurrence_end_date && current > note.recurrence_end_date) break;
    if (current >= start) dates.push(current);

    if (note.recurrence_rule === 'daily') current = addDays(current, interval);
    else if (note.recurrence_rule === 'weekly') current = addDays(current, interval * 7);
    else if (note.recurrence_rule === 'monthly') current = addMonths(current, interval);
    else break;
  }
  return dates;
}

function overlapsRange(note: LocalNote, start: string, end: string): boolean {
  if (!note.scheduled_date || note.recurrence_rule) return false;
  const isSpan = !!note.end_date && note.end_date > note.scheduled_date;
  if (!isSpan) return note.scheduled_date >= start && note.scheduled_date <= end;
  return note.scheduled_date <= end && note.end_date! >= start;
}

function recurringInRange(note: LocalNote, start: string, end: string): boolean {
  if (!note.recurrence_rule || !note.scheduled_date || note.scheduled_date > end) return false;
  return !note.recurrence_end_date || addDays(note.recurrence_end_date, spanDays(note)) >= start;
}

function occurrenceIndex(occurrences: LocalOccurrence[]): Map<string, LocalOccurrence> {
  return new Map(occurrences.map((occ) => [`${occ.note_id}_${occ.occurrence_date}`, occ]));
}

function firstCanvasIds(snapshot: Snapshot): Map<string, string> {
  const result = new Map<string, string>();
  for (const node of snapshot.canvas_nodes) {
    if (!result.has(node.note_id)) result.set(node.note_id, node.canvas_id);
  }
  return result;
}

const hierarchy = (note: LocalNote) => ({ parent_note_id: note.parent_note_id, canvas_only: !!note.canvas_only });

const baseNote = (note: LocalNote) => ({
  id: note.id,
  title: note.title,
  content: note.content,
  created_at: note.created_at,
  updated_at: note.updated_at,
});

/** Same as GET /api/timeline/, except repeats never get materialized: unseen ones have occurrence_id null. */
export function buildTimeline(snapshot: Snapshot, start: string, end: string): Record<string, unknown[]> {
  const result: Record<string, Record<string, unknown>[]> = {};
  const push = (day: string, entry: Record<string, unknown>) => (result[day] ??= []).push(entry);
  const canvasIds = firstCanvasIds(snapshot);
  const occurrences = occurrenceIndex(snapshot.occurrences);
  const visible = snapshot.notes.filter((note) => !note.canvas_only);

  const oneOffs = visible
    .filter((note) => overlapsRange(note, start, end))
    .sort((a, b) => a.scheduled_date!.localeCompare(b.scheduled_date!));

  for (const note of oneOffs) {
    const scheduled = note.scheduled_date!;
    const isSpan = !!note.end_date && note.end_date > scheduled;
    const noteDict = {
      ...baseNote(note),
      scheduled_date: scheduled,
      scheduled_time: note.scheduled_time,
      end_date: note.end_date,
      status: note.status,
      canvas_name: note.canvas_name,
      ...hierarchy(note),
    };
    const entry = (day: string) => ({
      id: note.id,
      canvas_id: canvasIds.get(note.id) ?? '',
      canvas_name: note.canvas_name,
      note: noteDict,
      scheduled_date: day,
      scheduled_time: note.scheduled_time,
      status: note.status || 'todo',
      is_recurring: false,
      occurrence_id: null,
      recurrence_rule: null,
      is_span: isSpan,
      start_date: scheduled,
      end_date: isSpan ? note.end_date : scheduled,
    });

    if (isSpan) {
      for (let day = maxDay(scheduled, start); day <= minDay(note.end_date!, end); day = addDays(day, 1)) {
        push(day, entry(day));
      }
    } else {
      push(scheduled, entry(scheduled));
    }
  }

  for (const note of visible.filter((n) => recurringInRange(n, start, end))) {
    const span = spanDays(note);
    for (const occStart of expandRecurrence(note, addDays(start, -span), end)) {
      const occ = occurrences.get(`${note.id}_${occStart}`);
      if (occ?.skipped) continue;

      const occEnd = addDays(occStart, span);
      const status = occ?.status || 'todo';
      const noteDict = {
        ...baseNote(note),
        scheduled_date: occStart,
        scheduled_time: note.scheduled_time,
        end_date: span ? occEnd : null,
        status,
        canvas_name: note.canvas_name,
        recurrence_rule: note.recurrence_rule,
        recurrence_interval: note.recurrence_interval,
        recurrence_end_date: note.recurrence_end_date,
        ...hierarchy(note),
      };
      for (let day = maxDay(occStart, start); day <= minDay(occEnd, end); day = addDays(day, 1)) {
        push(day, {
          id: note.id,
          canvas_id: canvasIds.get(note.id) ?? '',
          canvas_name: note.canvas_name,
          note: noteDict,
          scheduled_date: day,
          scheduled_time: note.scheduled_time,
          status,
          is_recurring: true,
          occurrence_id: occ?.id ?? null,
          recurrence_rule: note.recurrence_rule,
          is_span: span > 0,
          start_date: occStart,
          end_date: occEnd,
        });
      }
    }
  }

  for (const day of Object.keys(result)) {
    result[day].sort((a, b) => {
      const spanOrder = Number(!a.is_span) - Number(!b.is_span);
      if (spanOrder !== 0) return spanOrder;
      return String(a.scheduled_time || '23:59').localeCompare(String(b.scheduled_time || '23:59'));
    });
  }
  return result;
}

/** Same as GET /api/timestream/. */
export function buildTimestream(snapshot: Snapshot, start: string, end: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const occurrences = occurrenceIndex(snapshot.occurrences);

  for (const note of snapshot.notes.filter((n) => overlapsRange(n, start, end))) {
    const scheduled = note.scheduled_date!;
    result.push({
      id: note.id,
      note: {
        ...baseNote(note),
        scheduled_date: scheduled,
        scheduled_time: note.scheduled_time,
        status: note.status || 'todo',
        canvas_name: note.canvas_name,
        recurrence_rule: null,
        recurrence_interval: note.recurrence_interval,
        recurrence_end_date: null,
        end_date: note.end_date,
        ...hierarchy(note),
      },
      start_date: scheduled,
      end_date: note.end_date || scheduled,
      status: note.status || 'todo',
      canvas_name: note.canvas_name,
      is_recurring: false,
      is_span: !!note.end_date && note.end_date > scheduled,
      occurrence_id: null,
      parent_note_id: note.parent_note_id,
    });
  }

  for (const note of snapshot.notes.filter((n) => recurringInRange(n, start, end))) {
    const span = spanDays(note);
    for (const occDate of expandRecurrence(note, addDays(start, -span), end)) {
      const occ = occurrences.get(`${note.id}_${occDate}`);
      if (occ?.skipped) continue;

      const status = occ?.status || note.status || 'todo';
      const occEnd = addDays(occDate, span);
      result.push({
        id: `${note.id}_${occDate}`,
        note: {
          ...baseNote(note),
          scheduled_date: occDate,
          scheduled_time: note.scheduled_time,
          status,
          canvas_name: note.canvas_name,
          recurrence_rule: note.recurrence_rule,
          recurrence_interval: note.recurrence_interval,
          recurrence_end_date: note.recurrence_end_date,
          end_date: span ? occEnd : null,
          ...hierarchy(note),
        },
        start_date: occDate,
        end_date: occEnd,
        status,
        canvas_name: note.canvas_name,
        is_recurring: true,
        is_span: span > 0,
        occurrence_id: occ?.id ?? null,
        parent_note_id: note.parent_note_id,
      });
    }
  }

  result.sort((a, b) => {
    const byStart = String(a.start_date).localeCompare(String(b.start_date));
    if (byStart !== 0) return byStart;
    return Number(a.start_date === a.end_date) - Number(b.start_date === b.end_date);
  });
  return result;
}
