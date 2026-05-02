import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Pencil, Trash2 } from 'lucide-react';
import type { CanvasListItem } from './canvasUtils';
import styles from './CanvasSelector.module.css';

interface CanvasSelectorProps {
  canvases: CanvasListItem[];
  activeCanvasId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
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
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeCanvas = canvases.find((c) => c.id === activeCanvasId);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as HTMLElement)) {
        setIsOpen(false);
        setIsCreating(false);
        setRenamingId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Focus input when creating
  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (trimmed) {
      onCreate(trimmed);
      setNewName('');
      setIsCreating(false);
    }
  };

  const handleRename = (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      onRename(id, trimmed);
      setRenamingId(null);
    }
  };

  return (
    <div className={styles.wrapper} ref={dropdownRef}>
      <button className={styles.trigger} onClick={() => setIsOpen(!isOpen)}>
        <span className={styles.triggerLabel}>
          {activeCanvas ? activeCanvas.name : 'Select Canvas'}
        </span>
        <ChevronDown size={16} className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} />
      </button>

      {isOpen && (
        <div className={styles.dropdown}>
          {canvases.length === 0 && !isCreating && (
            <div className={styles.empty}>No canvases yet</div>
          )}

          {canvases.map((canvas) => (
            <div
              key={canvas.id}
              className={`${styles.item} ${canvas.id === activeCanvasId ? styles.itemActive : ''}`}
            >
              {renamingId === canvas.id ? (
                <input
                  className={styles.renameInput}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(canvas.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onBlur={() => handleRename(canvas.id)}
                  autoFocus
                />
              ) : (
                <>
                  <button
                    className={styles.itemName}
                    onClick={() => {
                      onSelect(canvas.id);
                      setIsOpen(false);
                    }}
                  >
                    {canvas.name}
                  </button>
                  <div className={styles.itemActions}>
                    <button
                      className={styles.itemActionBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(canvas.id);
                        setRenameValue(canvas.name);
                      }}
                      title="Rename"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className={`${styles.itemActionBtn} ${styles.deleteBtn}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete canvas "${canvas.name}"?`)) {
                          onDelete(canvas.id);
                        }
                      }}
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {isCreating ? (
            <div className={styles.createForm}>
              <input
                ref={inputRef}
                className={styles.createInput}
                placeholder="Canvas name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') setIsCreating(false);
                }}
              />
            </div>
          ) : (
            <button
              className={styles.createBtn}
              onClick={() => setIsCreating(true)}
            >
              <Plus size={14} />
              New Canvas
            </button>
          )}
        </div>
      )}
    </div>
  );
};
