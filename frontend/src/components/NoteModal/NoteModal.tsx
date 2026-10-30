import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Calendar, Repeat, X, Clock, ArrowRight, CheckSquare, Eye, EyeOff, CornerDownRight, Lock } from 'lucide-react';
import styles from './NoteModal.module.css';
import type { Note } from '../NoteCard/NoteCard';
import { TipTapEditor } from '../TipTapEditor/TipTapEditor';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { NotePicker } from '../NotePicker/NotePicker';
import { referencedUploads } from '../../lib/api';
import { extractUploadKey } from '../../lib/imageDecryption';
import { discardUpload } from '../../lib/replica';
import { getParentCandidates } from '../../lib/noteTree';
import { normalizeStatus, STATUS_LABELS } from '../../lib/noteText';
import { statusClass } from '../ui/statusClass';
import ui from '../ui/ui.module.css';

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: Omit<Note, 'created_at' | 'updated_at'>) => void;
  initialData?: Note | null;
  cryptoKey?: CryptoKey | null;
  allNotes?: Note[];
  defaultParentId?: string | null;
  defaultCanvasOnly?: boolean;
  /** New notes only: start scheduled on this day (YYYY-MM-DD) as a to-do. */
  defaultScheduledDate?: string | null;
  /** Open with the schedule popover showing (used by the repeat buttons). */
  initialPopover?: 'schedule' | null;
  /** New notes created on a canvas: shown as the canvas chip in the header. */
  canvasName?: string | null;
}

function getTodayString(): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getTomorrowString(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatSchedulePill({
  date,
  time,
  endDate,
  rule,
  interval,
}: {
  date: string;
  time: string | null;
  endDate: string | null;
  rule: string | null;
  interval: number;
}): string {
  const [sYear, sMonth, sDay] = date.split('-').map(Number);
  const startDateObj = new Date(sYear, sMonth - 1, sDay);
  const currentYear = new Date().getFullYear();
  const showYear = sYear !== currentYear;

  const formattedStart = startDateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(showYear ? { year: 'numeric' } : {}),
  });

  let datePart = formattedStart;
  if (endDate && endDate !== date) {
    const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
    const endDateObj = new Date(eYear, eMonth - 1, eDay);
    const formattedEnd = endDateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(eYear !== currentYear ? { year: 'numeric' } : {}),
    });
    datePart = `${formattedStart} – ${formattedEnd}`;
  }

  let timePart = '';
  if (time) {
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    timePart = `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
  }

  let recPart = '';
  if (rule) {
    if (rule === 'daily') {
      recPart = interval > 1 ? `Every ${interval} days` : 'Daily';
    } else if (rule === 'weekly') {
      recPart = interval > 1 ? `Every ${interval} weeks` : 'Weekly';
    } else if (rule === 'monthly') {
      recPart = interval > 1 ? `Every ${interval} months` : 'Monthly';
    }
  }

  const parts = [datePart];
  if (timePart) parts.push(timePart);
  if (recPart) parts.push(recPart);

  return parts.join(' · ');
}

export const NoteModal: React.FC<NoteModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  cryptoKey,
  allNotes = [],
  defaultParentId = null,
  defaultCanvasOnly = false,
  defaultScheduledDate = null,
  initialPopover = null,
  canvasName = null,
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(1);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);
  const [parentNoteId, setParentNoteId] = useState<string | null>(null);
  const [canvasOnly, setCanvasOnly] = useState(false);
  const [isParentPickerOpen, setIsParentPickerOpen] = useState(false);
  const parentPickerRef = useRef<HTMLDivElement>(null);

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);

  const popoverAnchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Generate a temporary ID for new notes to use as a folder name
  const [generatedId, setGeneratedId] = useState(() => crypto.randomUUID());
  const currentNoteId = initialData?.id || generatedId;
  // Images uploaded while the modal is open; deleted again if the edit is discarded.
  const sessionUploadsRef = useRef<string[]>([]);

  const todayStr = getTodayString();
  const tomorrowStr = getTomorrowString();

  const isExistingNote = Boolean(initialData?.id);
  const initialParentId = isExistingNote ? initialData?.parent_note_id ?? null : defaultParentId;
  const initialCanvasOnly = isExistingNote ? Boolean(initialData?.canvas_only) : defaultCanvasOnly;
  // A new note opened from a day in the schedule starts on that day as a to-do.
  const initialScheduledDate = isExistingNote ? initialData?.scheduled_date || null : defaultScheduledDate;
  const initialStatus = isExistingNote ? initialData?.status ?? null : defaultScheduledDate ? 'todo' : null;
  // Hiding only sticks while the note has a parent or lives on a canvas (the server enforces this too).
  const canHide = Boolean(parentNoteId || initialData?.canvas_name || defaultCanvasOnly);
  const effectiveCanvasOnly = canHide && canvasOnly;
  const parentCandidates = useMemo(
    () => getParentCandidates(allNotes, initialData?.id ?? null),
    [allNotes, initialData],
  );
  const parentNote = parentNoteId ? allNotes.find((note) => note.id === parentNoteId) : undefined;

  useEffect(() => {
    if (isOpen) {
      if (!initialData?.id) {
        setGeneratedId(crypto.randomUUID());
      }
      setTitle(initialData?.title || '');
      setContent(initialData?.content || '');
      setStatus(initialData?.id ? initialData.status ?? null : defaultScheduledDate ? 'todo' : null);
      setScheduledDate(initialData?.id ? initialData.scheduled_date || null : defaultScheduledDate);
      setScheduledTime(initialData?.scheduled_time || null);
      setEndDate(initialData?.end_date || null);
      setRecurrenceRule(initialData?.recurrence_rule || null);
      setRecurrenceInterval(initialData?.recurrence_interval || 1);
      setRecurrenceEndDate(initialData?.recurrence_end_date || null);
      setParentNoteId(initialData?.id ? initialData.parent_note_id ?? null : defaultParentId);
      setCanvasOnly(initialData?.id ? Boolean(initialData.canvas_only) : defaultCanvasOnly);
      setIsParentPickerOpen(false);
      setIsPopoverOpen(initialPopover === 'schedule');
      setShowConfirmDiscard(false);
      sessionUploadsRef.current = [];
    }
  }, [isOpen, initialData, defaultParentId, defaultCanvasOnly, defaultScheduledDate, initialPopover]);

  // Check if current form values differ from initial values
  const hasUnsavedChanges = useMemo(() => {
    const normalizeContent = (html: string) => {
      return html
        .replace(/<p>\s*<\/p>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
    };

    const initialTitle = (initialData?.title || '').trim();
    const currentTitle = title.trim();
    if (currentTitle !== initialTitle) return true;

    const initialNormalized = normalizeContent(initialData?.content || '');
    const currentNormalized = normalizeContent(content || '');
    if (currentNormalized !== initialNormalized) return true;

    if ((status || null) !== initialStatus) return true;
    if ((scheduledDate || null) !== initialScheduledDate) return true;

    const initialScheduledTime = initialData?.scheduled_time || null;
    if ((scheduledTime || null) !== initialScheduledTime) return true;

    const initialEndDate = initialData?.end_date || null;
    if ((endDate || null) !== initialEndDate) return true;

    const initialRecurrenceRule = initialData?.recurrence_rule || null;
    if ((recurrenceRule || null) !== initialRecurrenceRule) return true;

    const initialRecurrenceInterval = initialData?.recurrence_interval || 1;
    if ((recurrenceInterval || 1) !== initialRecurrenceInterval) return true;

    const initialRecurrenceEndDate = initialData?.recurrence_end_date || null;
    if ((recurrenceEndDate || null) !== initialRecurrenceEndDate) return true;

    if (parentNoteId !== initialParentId) return true;
    if (effectiveCanvasOnly !== initialCanvasOnly) return true;

    return false;
  }, [
    title,
    content,
    status,
    scheduledDate,
    scheduledTime,
    endDate,
    recurrenceRule,
    recurrenceInterval,
    recurrenceEndDate,
    parentNoteId,
    effectiveCanvasOnly,
    initialParentId,
    initialCanvasOnly,
    initialStatus,
    initialScheduledDate,
    initialData,
  ]);

  // Prevent browser reload/navigation when editing with unsaved changes
  useEffect(() => {
    if (!isOpen || !hasUnsavedChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isOpen, hasUnsavedChanges]);

  // Click-outside listener for the scheduling popover
  useEffect(() => {
    if (!isPopoverOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (backdropRef.current && backdropRef.current.contains(target)) {
        setIsPopoverOpen(false);
        return;
      }
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        popoverAnchorRef.current &&
        !popoverAnchorRef.current.contains(target)
      ) {
        setIsPopoverOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isPopoverOpen]);

  useEffect(() => {
    if (!isParentPickerOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (parentPickerRef.current && !parentPickerRef.current.contains(e.target as Node)) {
        setIsParentPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isParentPickerOpen]);

  // Close without saving: drop the images this edit uploaded that the saved note doesn't use.
  const savedContent = initialData?.id ? initialData.content : null;
  const discardAndClose = useCallback(() => {
    const kept = new Set(referencedUploads(savedContent, currentNoteId));
    for (const url of sessionUploadsRef.current) {
      const filename = url.split('/').pop();
      if (filename && !kept.has(filename)) {
        discardUpload(extractUploadKey(url)).catch((error) => console.error('Failed to delete upload:', error));
      }
    }
    sessionUploadsRef.current = [];
    onClose();
  }, [savedContent, currentNoteId, onClose]);

  // Escape key handler: dismiss popover first, then prompt if unsaved changes exist
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showConfirmDiscard) {
          setShowConfirmDiscard(false);
          return;
        }
        if (isPopoverOpen) {
          e.preventDefault();
          setIsPopoverOpen(false);
          return;
        }
        if (hasUnsavedChanges) {
          e.preventDefault();
          setShowConfirmDiscard(true);
        } else {
          discardAndClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasUnsavedChanges, isPopoverOpen, showConfirmDiscard, discardAndClose]);

  const handleOverlayClick = () => {
    if (isPopoverOpen) {
      setIsPopoverOpen(false);
      return;
    }
    if (hasUnsavedChanges) {
      setShowConfirmDiscard(true);
      return;
    }
    discardAndClose();
  };

  const handleCloseClick = () => {
    if (isPopoverOpen) {
      setIsPopoverOpen(false);
    }
    if (hasUnsavedChanges) {
      setShowConfirmDiscard(true);
    } else {
      discardAndClose();
    }
  };

  const handleCancelClick = () => {
    if (isPopoverOpen) {
      setIsPopoverOpen(false);
    }
    if (hasUnsavedChanges) {
      setShowConfirmDiscard(true);
    } else {
      discardAndClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowConfirmDiscard(false);
    setIsPopoverOpen(false);
    discardAndClose();
  };

  const handleClearSchedule = () => {
    setScheduledDate(null);
    setScheduledTime(null);
    setEndDate(null);
    setRecurrenceRule(null);
    setRecurrenceInterval(1);
    setRecurrenceEndDate(null);
    setIsPopoverOpen(false);
  };

  const handleToggleTask = () => {
    if (status !== null) {
      setStatus(null);
    } else {
      setStatus('todo');
    }
  };

  const handleCycleStatus = () => {
    setStatus((prev) => (prev === 'todo' ? 'in_progress' : prev === 'in_progress' ? 'done' : 'todo'));
  };

  const handleAddDateClick = () => {
    if (!scheduledDate) {
      setScheduledDate(todayStr);
    }
    if (status === null) {
      setStatus('todo');
    }
    // Opens even when already open: after clearing the date inside the popover, this pill replaces the date one.
    setIsPopoverOpen(true);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!title.trim() && !content.trim()) return;
    if (isPopoverOpen) {
      setIsPopoverOpen(false);
    }
    onSave({ 
      id: currentNoteId, 
      title, 
      content,
      status: status || (scheduledDate ? 'todo' : null),
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      end_date: endDate,
      recurrence_rule: recurrenceRule,
      recurrence_interval: recurrenceInterval,
      recurrence_end_date: recurrenceEndDate,
      parent_note_id: parentNoteId,
      canvas_only: effectiveCanvasOnly,
    });
    onClose();
  };

  if (!isOpen) return null;

  const formattedSchedule = scheduledDate
    ? formatSchedulePill({
        date: scheduledDate,
        time: scheduledTime,
        endDate,
        rule: recurrenceRule,
        interval: recurrenceInterval,
      })
    : '';

  return (
    <>
      <div className={styles.overlay} onClick={handleOverlayClick}>
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-label={initialData?.id ? 'Edit note' : 'New note'}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.header}>
            <span className={styles.kind}>
              {(initialData?.canvas_name || canvasName) && (
                <span className={`${ui.chip} ${ui.chipCanvas}`} title={`In canvas: ${initialData?.canvas_name || canvasName}`}>
                  {initialData?.canvas_name || canvasName}
                </span>
              )}
              {initialData?.id ? 'Edit note' : 'New note'}
            </span>
            <button
              type="button"
              className={ui.iconBtn}
              onClick={handleCloseClick}
              aria-label="Close"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>

          <form id="note-modal-form" className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.body}>
            <div className={styles.titleSection}>
              <input
                id="note-title"
                type="text"
                className={styles.titleInput}
                placeholder="Note title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus={!initialData?.title}
              />
            </div>

            <div className={styles.metadataStrip} ref={popoverAnchorRef}>
              <button
                type="button"
                className={`${styles.taskTogglePill} ${status ? styles.taskTogglePillActive : ''}`}
                onClick={handleToggleTask}
                title={status ? 'Marked as task (click to convert to pure note)' : 'Convert to actionable task'}
              >
                <CheckSquare size={13} className={styles.pillIcon} />
                <span>{status ? 'Task' : 'Make task'}</span>
              </button>

              {status && (
                <button
                  type="button"
                  className={`${ui.pill} ${ui.pillLg} ${statusClass(status)}`}
                  onClick={handleCycleStatus}
                  title="Change status"
                  aria-label={`Status: ${STATUS_LABELS[normalizeStatus(status)]}. Change status`}
                >
                  <span className={ui.pillDot} />
                  {STATUS_LABELS[normalizeStatus(status)]}
                </button>
              )}

              <button
                type="button"
                className={`${styles.taskTogglePill} ${!effectiveCanvasOnly ? styles.taskTogglePillActive : ''}`}
                onClick={() => setCanvasOnly((prev) => !prev)}
                disabled={!canHide}
                title={
                  !canHide
                    ? 'Add a parent or place this note on a canvas to hide it'
                    : effectiveCanvasOnly
                      ? 'Hidden from Grid and Schedule (click to show)'
                      : 'Shown in Grid and Schedule (click to hide)'
                }
              >
                {effectiveCanvasOnly ? (
                  <EyeOff size={13} className={styles.pillIcon} />
                ) : (
                  <Eye size={13} className={styles.pillIcon} />
                )}
                <span>{effectiveCanvasOnly ? 'Canvas only' : 'Grid & Schedule'}</span>
              </button>

              <div className={styles.parentPillWrapper} ref={parentPickerRef}>
                <button
                  type="button"
                  className={`${styles.taskTogglePill} ${parentNoteId ? styles.parentPillActive : ''}`}
                  onClick={() => setIsParentPickerOpen((prev) => !prev)}
                  title="Group this note under another note"
                >
                  <CornerDownRight size={13} className={styles.pillIcon} />
                  <span className={styles.parentPillLabel}>
                    {parentNoteId ? parentNote?.title || 'Untitled' : 'Add parent'}
                  </span>
                </button>
                {parentNoteId && (
                  <button
                    type="button"
                    className={styles.parentClearBtn}
                    onClick={() => setParentNoteId(null)}
                    aria-label="Remove parent"
                    title="Remove parent"
                  >
                    <X size={12} />
                  </button>
                )}
                {isParentPickerOpen && (
                  <div className={styles.parentPickerPopover}>
                    <NotePicker
                      notes={parentCandidates}
                      placeholder="Search for a parent note…"
                      onPick={(note) => {
                        setParentNoteId(note.id);
                        setIsParentPickerOpen(false);
                      }}
                      onClose={() => setIsParentPickerOpen(false)}
                    />
                  </div>
                )}
              </div>

              {scheduledDate ? (
                <button
                  type="button"
                  className={`${styles.scheduledPill} ${isPopoverOpen ? styles.pillActive : ''}`}
                  onClick={() => setIsPopoverOpen((prev) => !prev)}
                  title="Edit schedule"
                >
                  <Calendar size={13} className={styles.pillIcon} />
                  <span>{formattedSchedule}</span>
                  {recurrenceRule && <Repeat size={12} className={styles.pillRecurrenceIcon} />}
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.addDatePill} ${isPopoverOpen ? styles.pillActive : ''}`}
                  onClick={handleAddDateClick}
                  title="Add schedule"
                >
                  <Calendar size={13} className={styles.pillIcon} />
                  <span>Add date</span>
                </button>
              )}

              {isPopoverOpen && (
                <>
                  <div
                    ref={backdropRef}
                    className={styles.popoverBackdrop}
                    onClick={() => setIsPopoverOpen(false)}
                    aria-hidden="true"
                  />
                  <div className={styles.popover} ref={popoverRef}>
                    <div className={styles.dragHandle} aria-hidden="true" />
                    <div className={styles.popoverHeader}>
                    <div className={styles.popoverHeaderTitle}>
                      <Calendar size={14} className={styles.popoverIcon} />
                      <span>Schedule</span>
                    </div>
                    <button
                      type="button"
                      className={styles.popoverCloseBtn}
                      onClick={() => setIsPopoverOpen(false)}
                      title="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {/* Date section */}
                  <div className={styles.popoverSection}>
                    <div className={styles.presetRow}>
                      <button
                        type="button"
                        className={`${styles.presetBtn} ${scheduledDate === todayStr ? styles.presetBtnActive : ''}`}
                        onClick={() => {
                          setScheduledDate(todayStr);
                          if (status === null) setStatus('todo');
                          if (endDate && todayStr > endDate) setEndDate(todayStr);
                        }}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        className={`${styles.presetBtn} ${scheduledDate === tomorrowStr ? styles.presetBtnActive : ''}`}
                        onClick={() => {
                          setScheduledDate(tomorrowStr);
                          if (status === null) setStatus('todo');
                          if (endDate && tomorrowStr > endDate) setEndDate(tomorrowStr);
                        }}
                      >
                        Tomorrow
                      </button>
                    </div>

                    <div className={styles.inputGroup}>
                      <label className={styles.popoverLabel}>Date</label>
                      <input
                        type="date"
                        className={styles.popoverInput}
                        value={scheduledDate || ''}
                        onChange={(e) => {
                          const newDate = e.target.value || null;
                          setScheduledDate(newDate);
                          if (!newDate) {
                            setScheduledTime(null);
                            setEndDate(null);
                            setRecurrenceRule(null);
                            setRecurrenceEndDate(null);
                          } else {
                            if (status === null) setStatus('todo');
                            if (endDate && newDate > endDate) {
                              setEndDate(newDate);
                            }
                          }
                        }}
                      />
                    </div>
                  </div>

                  {/* Time section */}
                  {scheduledDate && (
                    <div className={styles.popoverSection}>
                      <div className={styles.sectionHeader}>
                        <label className={styles.popoverLabel}>Time</label>
                        {scheduledTime !== null && (
                          <button
                            type="button"
                            className={styles.removeOptionBtn}
                            onClick={() => setScheduledTime(null)}
                            title="Remove time"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      {scheduledTime !== null ? (
                        <div className={styles.timeInputWrapper}>
                          <Clock size={14} className={styles.inputIcon} />
                          <input
                            type="time"
                            className={styles.popoverInput}
                            value={scheduledTime || ''}
                            onChange={(e) => setScheduledTime(e.target.value || null)}
                            autoFocus
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.popoverAddOptionBtn}
                          onClick={() => setScheduledTime('09:00')}
                        >
                          + Add time
                        </button>
                      )}
                    </div>
                  )}

                  {/* Multi-day section */}
                  {scheduledDate && (
                    <div className={styles.popoverSection}>
                      <div className={styles.sectionHeader}>
                        <label className={styles.popoverLabel}>End date (multi-day)</label>
                        {endDate !== null && (
                          <button
                            type="button"
                            className={styles.removeOptionBtn}
                            onClick={() => setEndDate(null)}
                            title="Remove end date"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      {endDate !== null ? (
                        <div className={styles.endDateWrapper}>
                          <ArrowRight size={14} className={styles.inputIcon} />
                          <input
                            type="date"
                            className={styles.popoverInput}
                            value={endDate || ''}
                            min={scheduledDate}
                            onChange={(e) => setEndDate(e.target.value || null)}
                            autoFocus
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.popoverAddOptionBtn}
                          onClick={() => setEndDate(scheduledDate)}
                        >
                          + End date
                        </button>
                      )}
                    </div>
                  )}

                  {/* Recurrence section */}
                  {scheduledDate && (
                    <div className={styles.popoverSection}>
                      <div className={styles.sectionHeader}>
                        <label className={styles.popoverLabel}>Recurrence</label>
                        {recurrenceRule && (
                          <button
                            type="button"
                            className={styles.removeOptionBtn}
                            onClick={() => {
                              setRecurrenceRule(null);
                              setRecurrenceInterval(1);
                              setRecurrenceEndDate(null);
                            }}
                            title="Remove recurrence"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <select
                        className={styles.popoverSelect}
                        value={recurrenceRule || ''}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          setRecurrenceRule(val);
                          if (!val) {
                            setRecurrenceInterval(1);
                            setRecurrenceEndDate(null);
                          }
                        }}
                      >
                        <option value="">Does not repeat</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>

                      {recurrenceRule && (
                        <div className={styles.recurrenceDetails}>
                          <div className={styles.intervalRow}>
                            <span className={styles.subLabel}>Every</span>
                            <input
                              type="number"
                              className={styles.intervalInput}
                              value={recurrenceInterval}
                              min={1}
                              max={99}
                              onChange={(e) => setRecurrenceInterval(Math.min(99, Math.max(1, parseInt(e.target.value) || 1)))}
                            />
                            <span className={styles.intervalUnit}>
                              {recurrenceRule === 'daily'
                                ? recurrenceInterval === 1
                                  ? 'day'
                                  : 'days'
                                : recurrenceRule === 'weekly'
                                ? recurrenceInterval === 1
                                  ? 'week'
                                  : 'weeks'
                                : recurrenceInterval === 1
                                ? 'month'
                                : 'months'}
                            </span>
                          </div>

                          <div className={styles.repeatUntilSection}>
                            <span className={styles.subLabel}>Ends</span>
                            <div className={styles.endTypeToggle}>
                              <button
                                type="button"
                                className={`${styles.togglePill} ${!recurrenceEndDate ? styles.togglePillActive : ''}`}
                                onClick={() => setRecurrenceEndDate(null)}
                              >
                                Forever
                              </button>
                              <button
                                type="button"
                                className={`${styles.togglePill} ${recurrenceEndDate ? styles.togglePillActive : ''}`}
                                onClick={() => {
                                  if (!recurrenceEndDate) {
                                    setRecurrenceEndDate(endDate || scheduledDate || todayStr);
                                  }
                                }}
                              >
                                On date
                              </button>
                            </div>

                            {recurrenceEndDate && (
                              <input
                                type="date"
                                className={styles.popoverInput}
                                value={recurrenceEndDate}
                                min={scheduledDate}
                                onChange={(e) => setRecurrenceEndDate(e.target.value || null)}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Popover footer */}
                  <div className={styles.popoverFooter}>
                    {scheduledDate && (
                      <button
                        type="button"
                        className={styles.popoverClearAllBtn}
                        onClick={handleClearSchedule}
                      >
                        Clear schedule
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.popoverDoneBtn}
                      onClick={() => setIsPopoverOpen(false)}
                    >
                      Done
                    </button>
                  </div>
                </div>
              </>
            )}
            </div>

            <div className={styles.contentGroup}>
              <TipTapEditor
                content={content}
                onChange={setContent}
                noteId={currentNoteId}
                readOnly={false}
                cryptoKey={cryptoKey}
                onUpload={(url) => sessionUploadsRef.current.push(url)}
              />
            </div>
            </div>

            <div className={styles.footer}>
              <span className={styles.footMeta}>
                <Lock size={13} />
                Encrypted before it leaves this device
              </span>
              <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={handleCancelClick}>
                {hasUnsavedChanges ? 'Cancel' : 'Close'}
              </button>
              <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={!title.trim() && !content.trim()}>
                Save note
              </button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmModal
        isOpen={showConfirmDiscard}
        title="Discard changes?"
        message="Your edits to this note haven't been saved."
        confirmText="Discard"
        cancelText="Keep editing"
        isDestructive={true}
        onConfirm={handleConfirmDiscard}
        onCancel={() => setShowConfirmDiscard(false)}
      />
    </>
  );
};
