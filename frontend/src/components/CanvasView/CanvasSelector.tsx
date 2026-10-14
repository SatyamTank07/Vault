import React, { useCallback, useState } from 'react';
import { Check, ChevronDown, Network, Pencil, Plus, Trash2 } from 'lucide-react';
import { Menu, MenuSeparator } from '../ui/Menu';
import ui from '../ui/ui.module.css';
import type { CanvasListItem } from './canvasUtils';
import styles from './CanvasSelector.module.css';

interface CanvasSelectorProps {
  canvases: CanvasListItem[];
  activeCanvasId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  /** Asks for confirmation itself (CanvasView shows the dialog). */
  onDelete: (id: string) => void;
}

export const CanvasSelector: React.FC<CanvasSelectorProps> = ({
  canvases,
  activeCanvasId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const activeCanvas = canvases.find((c) => c.id === activeCanvasId);

  const close = useCallback(() => {
    setAnchor(null);
    setRenamingId(null);
    setNewName('');
  }, []);

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    close();
  };

  const handleRename = (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) onRename(id, trimmed);
    setRenamingId(null);
  };

  return (
    <>
      <button
        type="button"
        className={styles.selector}
        onClick={(event) => {
          const target = event.currentTarget;
          if (anchor) close();
          else setAnchor(target);
        }}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
      >
        <Network size={15} className={styles.selectorIcon} />
        <span className={styles.selectorLabel}>{activeCanvas ? activeCanvas.name : 'Select a canvas'}</span>
        <ChevronDown size={14} />
      </button>

      <Menu anchor={anchor} open={anchor !== null} onClose={close} label="Canvases" minWidth={240}>
        {canvases.length === 0 && <div className={styles.empty}>No canvases yet</div>}

        {canvases.map((canvas) =>
          renamingId === canvas.id ? (
            <div key={canvas.id} className={styles.inputRow}>
              <input
                className={styles.input}
                value={renameValue}
                aria-label="Canvas name"
                data-escape-local
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(canvas.id);
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setRenamingId(null);
                  }
                }}
                autoFocus
              />
              <button
                type="button"
                className={`${ui.iconBtn} ${ui.iconSm}`}
                onClick={() => handleRename(canvas.id)}
                aria-label="Save name"
              >
                <Check size={14} />
              </button>
            </div>
          ) : (
            <div key={canvas.id} className={styles.row}>
              <button
                type="button"
                className={`${ui.menuItem} ${canvas.id === activeCanvasId ? ui.menuItemSel : ''} ${styles.rowName}`}
                onClick={() => {
                  onSelect(canvas.id);
                  close();
                }}
              >
                <span className={styles.rowLabel}>{canvas.name}</span>
                {canvas.id === activeCanvasId && <Check size={14} className={ui.menuCheck} />}
              </button>
              <span className={styles.rowTools}>
                <button
                  type="button"
                  className={`${ui.iconBtn} ${ui.iconSm}`}
                  onClick={() => {
                    setRenamingId(canvas.id);
                    setRenameValue(canvas.name);
                  }}
                  aria-label={`Rename ${canvas.name}`}
                  title="Rename"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className={`${ui.iconBtn} ${ui.iconSm} ${ui.iconDanger}`}
                  onClick={() => {
                    close();
                    onDelete(canvas.id);
                  }}
                  aria-label={`Delete ${canvas.name}`}
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
          ),
        )}

        {canvases.length > 0 && <MenuSeparator />}
        <div className={styles.inputRow}>
          <input
            className={styles.input}
            placeholder="New canvas name"
            aria-label="New canvas name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
          />
          <button
            type="button"
            className={`${ui.iconBtn} ${ui.iconSm}`}
            onClick={handleCreate}
            disabled={!newName.trim()}
            aria-label="Create canvas"
            title="Create canvas"
          >
            <Plus size={14} />
          </button>
        </div>
      </Menu>
    </>
  );
};
