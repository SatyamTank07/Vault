import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Plus, X } from 'lucide-react';
import styles from './MindMapNode.module.css';

interface MindMapNodeData {
  title: string;
  noteId: string;
  note: {
    id: string;
    title: string;
    content: string;
    created_at: string;
    updated_at: string;
  };
  onOpenNote?: (note: any) => void;
  onAddBranch?: (nodeId: string) => void;
  onRemoveNode?: (nodeId: string) => void;
}

const MindMapNode: React.FC<NodeProps> = ({ id, data }) => {
  const nodeData = data as unknown as MindMapNodeData;

  return (
    <div className={styles.node}>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      
      <div
        className={styles.titleArea}
        onClick={() => nodeData.onOpenNote?.(nodeData.note)}
        title="Click to view / edit note"
      >
        <span className={styles.icon}>📝</span>
        <span className={styles.title}>{nodeData.title}</span>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.branchBtn}
          onClick={(e) => {
            e.stopPropagation();
            nodeData.onAddBranch?.(id);
          }}
          title="Add branch"
        >
          <Plus size={14} />
        </button>
        <button
          className={styles.removeBtn}
          onClick={(e) => {
            e.stopPropagation();
            nodeData.onRemoveNode?.(id);
          }}
          title="Remove from canvas"
        >
          <X size={14} />
        </button>
      </div>

      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
};

export default memo(MindMapNode);
