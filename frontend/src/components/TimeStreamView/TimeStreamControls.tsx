import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  // Format the date range for the center label
  const formatDateRange = () => {
    const startOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const endOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    
    // If zoom is very high (year scale), show months/years
    if (zoomLevel > 0.75) {
      startOpts.day = undefined;
      endOpts.day = undefined;
    }
    
    const startStr = viewportStart.toLocaleDateString(undefined, startOpts);
    const endStr = viewportEnd.toLocaleDateString(undefined, endOpts);
    
    return `${startStr} – ${endStr}`;
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
          <span>Day</span>
          <span>Week</span>
          <span>Month</span>
          <span>Year</span>
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
