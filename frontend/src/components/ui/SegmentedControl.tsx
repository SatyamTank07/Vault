import React from 'react';
import ui from './ui.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  count?: number;
  /** Class applied to the label text, e.g. to hide it on narrow screens. */
  labelClassName?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: 'md' | 'sm';
  iconOnly?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  iconOnly,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`${ui.seg} ${size === 'sm' ? ui.segSm : ''} ${iconOnly ? ui.segIcons : ''} ${className ?? ''}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={opt.value === value ? ui.segOn : undefined}
          aria-pressed={opt.value === value}
          title={opt.title}
          aria-label={iconOnly ? opt.title : undefined}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon}
          {opt.label !== undefined && <span className={opt.labelClassName}>{opt.label}</span>}
          {opt.count !== undefined && <span className={ui.segCount}>{opt.count}</span>}
        </button>
      ))}
    </div>
  );
}
