import React from 'react';
import ui from './ui.module.css';

interface ToolbarProps {
  /** Where you are: title, canvas selector, date navigation. */
  left: React.ReactNode;
  /** How you see it: filters, layout and scale switches. */
  right?: React.ReactNode;
}

/** The 52px row under the header. Same place and shape on every view. */
export const Toolbar: React.FC<ToolbarProps> = ({ left, right }) => (
  <div className={ui.tb}>
    <div className={ui.tbSide}>{left}</div>
    {right ? <div className={ui.tbSide}>{right}</div> : null}
  </div>
);
