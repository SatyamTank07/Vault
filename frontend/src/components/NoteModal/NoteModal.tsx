import React, { useState, useEffect, useMemo } from 'react';
import styles from './NoteModal.module.css';
import type { Note } from '../NoteCard/NoteCard';
import { TipTapEditor } from '../TipTapEditor/TipTapEditor';

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: Omit<Note, 'created_at' | 'updated_at' | 'status'>) => void;
  initialData?: Note | null;
  isViewMode?: boolean;
}

export const NoteModal: React.FC<NoteModalProps> = ({ isOpen, onClose, onSave, initialData, isViewMode = false }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isEditing, setIsEditing] = useState(!isViewMode);

  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  
  // Generate a temporary ID for new notes to use as a folder name
  const generatedId = useMemo(() => crypto.randomUUID(), [isOpen, initialData]);
  const currentNoteId = initialData?.id || generatedId;

  useEffect(() => {
    if (isOpen) {
      setTitle(initialData?.title || '');
      setContent(initialData?.content || '');
      setScheduledDate(initialData?.scheduled_date || null);
      setScheduledTime(initialData?.scheduled_time || null);
      setEndDate(initialData?.end_date || null);
      setIsEditing(!isViewMode);
    }
  }, [isOpen, initialData, isViewMode]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !content.trim()) return;
    onSave({ 
      id: currentNoteId, 
      title, 
      content,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      end_date: endDate,
    });
    
    if (isViewMode) {
      setIsEditing(false);
    } else {
      onClose();
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitleArea}>
            <h2>{isEditing ? (initialData ? 'Edit Note' : 'Create Note') : 'View Note'}</h2>
            
            <div className={styles.dateSection}>
              {isEditing ? (
                <div className={styles.editDateControls}>
                  <div className={styles.primaryDateWrapper}>
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={scheduledDate || ''}
                      onChange={(e) => {
                        const newStart = e.target.value || null;
                        setScheduledDate(newStart);
                        if (!newStart) {
                          setScheduledTime(null);
                          setEndDate(null);
                        } else if (endDate && newStart > endDate) {
                          setEndDate(newStart);
                        }
                      }}
                      title="Schedule Date"
                    />
                    {scheduledDate && (
                      <button
                        type="button"
                        className={styles.clearDateBtn}
                        onClick={() => {
                          setScheduledDate(null);
                          setScheduledTime(null);
                          setEndDate(null);
                        }}
                        title="Remove date"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {scheduledDate && (
                    <div className={styles.optionalDateControls}>
                      {scheduledTime !== null ? (
                        <div className={styles.subDateWrapper}>
                          <input
                            type="time"
                            className={styles.timeInput}
                            value={scheduledTime || ''}
                            onChange={(e) => setScheduledTime(e.target.value || null)}
                            title="Time"
                            autoFocus
                          />
                          <button
                            type="button"
                            className={styles.subClearBtn}
                            onClick={() => setScheduledTime(null)}
                            title="Remove time"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.addOptionBtn}
                          onClick={() => setScheduledTime('09:00')}
                          title="Add specific time"
                        >
                          + Add Time
                        </button>
                      )}

                      {endDate !== null ? (
                        <div className={styles.subDateWrapper}>
                          <span className={styles.arrow}>→</span>
                          <input
                            type="date"
                            className={styles.dateInput}
                            value={endDate || ''}
                            min={scheduledDate}
                            onChange={(e) => setEndDate(e.target.value || null)}
                            title="End Date"
                            autoFocus
                          />
                          <button
                            type="button"
                            className={styles.subClearBtn}
                            onClick={() => setEndDate(null)}
                            title="Remove end date"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.addOptionBtn}
                          onClick={() => setEndDate(scheduledDate)}
                          title="Add end date for multi-day task"
                        >
                          + Multi-day
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                scheduledDate && (
                  <div className={styles.dateDisplay}>
                    <span>📅 {new Date(scheduledDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {scheduledTime && <span> at {scheduledTime}</span>}
                    {endDate && endDate !== scheduledDate && (
                      <span> → {new Date(endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    )}
                  </div>
                )
              )}
            </div>
          </div>

          <div className={styles.headerActions}>
            {!isEditing && (
              <button 
                type="button" 
                className={styles.editBtn} 
                onClick={() => setIsEditing(true)}
                title="Edit Note"
              >
                ✎
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.inputGroup}>
            {isEditing ? (
              <input
                id="note-title"
                type="text"
                className={styles.input}
                placeholder="Enter Title ..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            ) : (
              <h1 className={styles.viewTitle}>{title || 'Untitled'}</h1>
            )}
          </div>

          <div className={`${styles.inputGroup} ${styles.contentGroup}`}>
            <TipTapEditor 
              content={content} 
              onChange={setContent} 
              noteId={currentNoteId} 
              readOnly={!isEditing} 
            />
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              {isEditing ? 'Cancel' : 'Close'}
            </button>
            {isEditing && (
              <button type="submit" className={styles.saveBtn}>
                Save Note
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
