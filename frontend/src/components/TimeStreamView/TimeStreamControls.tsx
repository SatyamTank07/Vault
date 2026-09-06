import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getISOWeekNumber } from './TimeStreamCanvas';
import styles from './TimeStreamView.module.css';

interface TimeStreamControlsProps {
  zoomLevel: number;
  onZoomChange: (zoom: number) => void;
  onGoToToday: () => void;
  viewportStart: Date;
  viewportEnd: Date;
  onPanByScreen: (direction: 1 | -1) => void;
}

export const TimeStreamControls: React.FC<TimeStreamControlsProps> = ({
  zoomLevel,
  onZoomChange,
  onGoToToday,
  viewportStart,
  viewportEnd,
  onPanByScreen,
}) => {
  const scale = zoomLevel <= 0.25 ? 'day' : zoomLevel <= 0.5 ? 'week' : zoomLevel <= 0.75 ? 'month' : 'year';

  // Format the date range for the center label according to scale:
  // - Day: Day, Week, Month, Year all appear
  // - Week: Week, Month, Year appear
  // - Month: Month, Year appear
  // - Year: Year only appears
  const formatDateRange = () => {
    if (scale === 'day') {
      const startDay = viewportStart.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
      const endDay = viewportEnd.toLocaleDateString('en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const startWeek = getISOWeekNumber(viewportStart);
      const endWeek = getISOWeekNumber(viewportEnd);
      const weekStr = startWeek === endWeek ? `W${startWeek}` : `W${startWeek}–W${endWeek}`;
      return `${startDay} – ${endDay} · ${weekStr}`;
    }

    if (scale === 'week') {
      const startWeek = getISOWeekNumber(viewportStart);
      const endWeek = getISOWeekNumber(viewportEnd);
      const startMonthYear = viewportStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const endMonthYear = viewportEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const monthYearStr = startMonthYear === endMonthYear ? startMonthYear : `${startMonthYear} – ${endMonthYear}`;
      return `W${startWeek} – W${endWeek} · ${monthYearStr}`;
    }

    if (scale === 'month') {
      const startMonth = viewportStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const endMonth = viewportEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      return startMonth === endMonth ? startMonth : `${startMonth} – ${endMonth}`;
    }

    // Year scale: Year only
    const startYear = viewportStart.getFullYear();
    const endYear = viewportEnd.getFullYear();
    return startYear === endYear ? `${startYear}` : `${startYear} – ${endYear}`;
  };

  return (
    <div className={styles.controls}>
      <div className={styles.leftControls}>
        <button onClick={() => onPanByScreen(-1)} className={styles.navBtn} title="Previous">
          <ChevronLeft size={18} />
        </button>
        <button onClick={onGoToToday} className={styles.todayBtn}>
          Today
        </button>
        <button onClick={() => onPanByScreen(1)} className={styles.navBtn} title="Next">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className={styles.dateRange}>
        {formatDateRange()}
      </div>

      <div className={styles.rightControls}>
        <div className={styles.zoomLabels}>
          <button
            type="button"
            className={`${styles.zoomLabelBtn} ${scale === 'day' ? styles.zoomLabelBtnActive : ''}`}
            onClick={() => onZoomChange(0.1)}
            title="Day View (Day, Week, Month, Year)"
          >
            Day
          </button>
          <button
            type="button"
            className={`${styles.zoomLabelBtn} ${scale === 'week' ? styles.zoomLabelBtnActive : ''}`}
            onClick={() => onZoomChange(0.35)}
            title="Week View (Week, Month, Year)"
          >
            Week
          </button>
          <button
            type="button"
            className={`${styles.zoomLabelBtn} ${scale === 'month' ? styles.zoomLabelBtnActive : ''}`}
            onClick={() => onZoomChange(0.6)}
            title="Month View (Month, Year)"
          >
            Month
          </button>
          <button
            type="button"
            className={`${styles.zoomLabelBtn} ${scale === 'year' ? styles.zoomLabelBtnActive : ''}`}
            onClick={() => onZoomChange(0.9)}
            title="Year View (Year Only)"
          >
            Year
          </button>
        </div>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.01" 
          value={zoomLevel} 
          onChange={(e) => onZoomChange(parseFloat(e.target.value))}
          className={styles.zoomSlider}
          title="Zoom Level"
        />
      </div>
    </div>
  );
};
