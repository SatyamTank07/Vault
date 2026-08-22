import React, { useState, useEffect } from 'react';
import { Repeat, X } from 'lucide-react';
import styles from './RecurrenceModal.module.css';

interface RecurrenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rule: string | null, interval: number, endDate: string | null) => void;
  initialRule?: string | null;
  initialInterval?: number;
  initialEndDate?: string | null;
  scheduledDate?: string | null;
}

export const RecurrenceModal: React.FC<RecurrenceModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialRule = null,
  initialInterval = 1,
  initialEndDate = null,
  scheduledDate = null,
}) => {
  const [rule, setRule] = useState<string>(initialRule || '');
  const [interval, setInterval] = useState<number>(initialInterval || 1);
  const [endDate, setEndDate] = useState<string>(initialEndDate || '');

  useEffect(() => {
    if (isOpen) {
      setRule(initialRule || '');
      setInterval(initialInterval || 1);
      setEndDate(initialEndDate || '');
    }
  }, [isOpen, initialRule, initialInterval, initialEndDate]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(rule || null, interval, endDate || null);
    onClose();
  };

  const handleClear = () => {
    onSave(null, 1, null);
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Repeat size={18} />
            <h3>Recurrence</h3>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.label}>Repeat</label>
            <select
              className={styles.select}
              value={rule}
              onChange={(e) => setRule(e.target.value)}
            >
              <option value="">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          {rule && (
            <>
              <div className={styles.field}>
                <label className={styles.label}>Every</label>
                <div className={styles.intervalRow}>
                  <input
                    type="number"
                    className={styles.intervalInput}
                    value={interval}
                    onChange={(e) => setInterval(Math.max(1, parseInt(e.target.value) || 1))}
                    min={1}
                    max={99}
                  />
                  <span className={styles.intervalUnit}>
                    {rule === 'daily' ? (interval === 1 ? 'day' : 'days') :
                     rule === 'weekly' ? (interval === 1 ? 'week' : 'weeks') :
                     (interval === 1 ? 'month' : 'months')}
                  </span>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Repeat until</label>
                <div className={styles.endTypeToggle}>
                  <button
                    type="button"
                    className={`${styles.togglePill} ${!endDate ? styles.togglePillActive : ''}`}
                    onClick={() => setEndDate('')}
                  >
                    Forever
                  </button>
                  <button
                    type="button"
                    className={`${styles.togglePill} ${endDate ? styles.togglePillActive : ''}`}
                    onClick={() => {
                      if (!endDate) {
                        setEndDate(scheduledDate || new Date().toISOString().split('T')[0]);
                      }
                    }}
                  >
                    On Date
                  </button>
                </div>

                {endDate ? (
                  <div className={styles.endDateRow}>
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={scheduledDate || ''}
                      autoFocus
                    />
                    <button
                      type="button"
                      className={styles.clearDateBtn}
                      onClick={() => setEndDate('')}
                      title="Switch to Repeat Forever"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <span className={styles.hint}>Repeats indefinitely without an expiration date.</span>
                )}
              </div>
            </>
          )}
        </div>

        <div className={styles.footer}>
          {initialRule && (
            <button className={styles.clearBtn} onClick={handleClear}>
              Remove recurrence
            </button>
          )}
          <div className={styles.footerRight}>
            <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button className={styles.saveBtn} onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};
