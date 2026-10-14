import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import ui from './ui.module.css';

interface MenuProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  /** Line the menu up with the anchor's left edge (start) or right edge (end). */
  align?: 'start' | 'end';
  minWidth?: number;
  label?: string;
  children: React.ReactNode;
}

/**
 * A popover menu rendered in a portal with fixed positioning, so it escapes clipped
 * containers (day columns, the horizon, XYFlow's transformed canvas). It closes on an
 * outside press, Escape, scroll or resize.
 */
export const Menu: React.FC<MenuProps> = ({ anchor, open, onClose, align = 'start', minWidth, label, children }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!open || !anchor || !el) return;
    const r = anchor.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    let left = align === 'end' ? r.right - mw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [open, anchor, align]);

  useEffect(() => {
    if (!open) return;
    const onPress = (event: Event) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Fields marked data-escape-local (e.g. an inline rename) cancel themselves on Escape.
      const target = event.target as HTMLElement;
      if (menuRef.current?.contains(target) && target.closest('[data-escape-local]')) return;
      event.stopPropagation();
      onClose();
    };
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;

  // React events bubble through portals to the anchor's ancestors (cards, canvas nodes),
  // so stop them here; otherwise picking an item would also open the card.
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return createPortal(
    <div
      ref={menuRef}
      className={`${ui.menu} nodrag nopan nowheel`}
      role="menu"
      aria-label={label}
      style={{ minWidth }}
      onClick={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onDoubleClick={stop}
      onKeyDown={stop}
    >
      {children}
    </div>,
    document.body,
  );
};

interface MenuItemProps {
  icon?: React.ReactNode;
  selected?: boolean;
  danger?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}

export const MenuItem: React.FC<MenuItemProps> = ({ icon, selected, danger, onSelect, children }) => (
  <button
    type="button"
    role="menuitem"
    className={`${ui.menuItem} ${selected ? ui.menuItemSel : ''} ${danger ? ui.menuItemDanger : ''}`}
    onClick={onSelect}
  >
    {icon}
    <span>{children}</span>
    {selected && <Check size={14} className={ui.menuCheck} />}
  </button>
);

export const MenuSeparator: React.FC = () => <hr className={ui.menuSep} />;
