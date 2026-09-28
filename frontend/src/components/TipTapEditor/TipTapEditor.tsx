import React, { useEffect, useMemo } from 'react';
import {
  Editor,
  EditorContent,
  useEditor,
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Strikethrough,
  Image as ImageIcon,
} from 'lucide-react';
import {
  apiFetch,
  getErrorMessage,
  stripProtectedAssetTokens,
} from '../../lib/api';
import { encryptImageFile, getActiveVaultKey } from '../../lib/crypto';
import {
  cacheDecryptedBlobUrl,
  useDecryptedImageUrl,
} from '../../lib/imageDecryption';
import styles from './TipTapEditor.module.css';

interface MenuBarProps {
  editor: Editor | null;
  noteId: string;
  cryptoKey?: CryptoKey | null;
}

const EncryptedImageNodeView: React.FC<NodeViewProps> = ({ node, selected }) => {
  const src = node.attrs.src;
  const alt = node.attrs.alt;
  const title = node.attrs.title;

  const { blobUrl, loading, error } = useDecryptedImageUrl(src);

  return (
    <NodeViewWrapper className={styles.imageNodeWrapper}>
      {loading ? (
        <div className={styles.imagePlaceholder}>
          <span className={styles.spinner} />
          <span>Decrypting image...</span>
        </div>
      ) : error ? (
        <div className={styles.imageError}>
          <span>Failed to decrypt image</span>
        </div>
      ) : (
        <img
          src={blobUrl || src}
          alt={alt || ''}
          title={title || ''}
          className={`${styles.editorImage} ${selected ? styles.selectedImage : ''}`}
        />
      )}
    </NodeViewWrapper>
  );
};

const EncryptedImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EncryptedImageNodeView);
  },
});

const MenuBar: React.FC<MenuBarProps> = ({ editor, noteId, cryptoKey }) => {
  if (!editor) {
    return null;
  }

  return (
    <div className={styles.menuBar}>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={editor.isActive('bold') ? styles.isActive : ''}
        title="Bold"
      >
        <Bold size={18} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={editor.isActive('italic') ? styles.isActive : ''}
        title="Italic"
      >
        <Italic size={18} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().chain().focus().toggleStrike().run()}
        className={editor.isActive('strike') ? styles.isActive : ''}
        title="Strike"
      >
        <Strikethrough size={18} />
      </button>

      <div className={styles.divider} />

      <button
        type="button"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        className={editor.isActive('taskList') ? styles.isActive : ''}
        title="Task List"
      >
        <CheckSquare size={18} />
      </button>

      <div className={styles.divider} />

      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={editor.isActive('heading', { level: 1 }) ? styles.isActive : ''}
        title="Heading 1"
      >
        <Heading1 size={18} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={editor.isActive('heading', { level: 2 }) ? styles.isActive : ''}
        title="Heading 2"
      >
        <Heading2 size={18} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={editor.isActive('heading', { level: 3 }) ? styles.isActive : ''}
        title="Heading 3"
      >
        <Heading3 size={18} />
      </button>

      <div className={styles.divider} />

      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={editor.isActive('bulletList') ? styles.isActive : ''}
        title="Bullet List"
      >
        <List size={18} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive('orderedList') ? styles.isActive : ''}
        title="Ordered List"
      >
        <ListOrdered size={18} />
      </button>

      <div className={styles.divider} />

      <button
        type="button"
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async () => {
            if (input.files?.length) {
              const file = input.files[0];
              const url = await uploadImage(file, noteId, cryptoKey);
              if (url) {
                editor.chain().focus().setImage({ src: url }).run();
              }
            }
          };
          input.click();
        }}
        title="Upload Image"
      >
        <ImageIcon size={18} />
      </button>

      <div className={styles.divider} />

      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={editor.isActive('blockquote') ? styles.isActive : ''}
        title="Quote"
      >
        <Quote size={18} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={editor.isActive('codeBlock') ? styles.isActive : ''}
        title="Code Block"
      >
        <Code size={18} />
      </button>
    </div>
  );
};

const uploadImage = async (
  file: File,
  noteId: string,
  cryptoKey?: CryptoKey | null
): Promise<string | null> => {
  try {
    const key = cryptoKey || getActiveVaultKey();
    let fileToUpload: Blob = file;
    let filename = file.name || 'image.png';

    if (key) {
      fileToUpload = await encryptImageFile(file, key);
      filename = `${filename}.enc`;
    }

    const formData = new FormData();
    formData.append('file', fileToUpload, filename);

    const response = await apiFetch(`/api/upload?note_id=${encodeURIComponent(noteId)}`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      console.error('Upload failed:', await getErrorMessage(response, 'Upload failed.'));
      return null;
    }

    const data = await response.json();
    const serverUrl = data.url;

    // Immediately cache local decrypted blob URL so it displays instantly
    const localBlobUrl = URL.createObjectURL(file);
    cacheDecryptedBlobUrl(serverUrl, localBlobUrl);

    return serverUrl;
  } catch (error) {
    console.error('Upload failed:', error);
    return null;
  }
};

interface TipTapEditorProps {
  content: string;
  onChange: (content: string) => void;
  noteId: string;
  readOnly?: boolean;
  cryptoKey?: CryptoKey | null;
}

export const TipTapEditor: React.FC<TipTapEditorProps> = ({
  content,
  onChange,
  noteId,
  readOnly = false,
  cryptoKey,
}) => {
  const displayContent = useMemo(() => stripProtectedAssetTokens(content), [content]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder: 'Write your note here...',
      }),
      EncryptedImage.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: styles.editorImage,
        },
      }),
    ],
    editorProps: {
      handlePaste: (view, event) => {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find((item) => item.type.startsWith('image/'));

        if (imageItem) {
          const file = imageItem.getAsFile();
          if (file) {
            uploadImage(file, noteId, cryptoKey).then((url) => {
              if (url) {
                const { schema } = view.state;
                const node = schema.nodes.image.create({ src: url });
                const transaction = view.state.tr.replaceSelectionWith(node);
                view.dispatch(transaction);
              }
            });
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (!moved && event.dataTransfer?.files?.[0]) {
          const file = event.dataTransfer.files[0];
          if (file.type.startsWith('image/')) {
            uploadImage(file, noteId, cryptoKey).then((url) => {
              if (url) {
                const { schema } = view.state;
                const node = schema.nodes.image.create({ src: url });
                const transaction = view.state.tr.replaceSelectionWith(node);
                view.dispatch(transaction);
              }
            });
            return true;
          }
        }
        return false;
      },
    },
    content: displayContent,
    editable: !readOnly,
    onUpdate: ({ editor: activeEditor }) => {
      onChange(stripProtectedAssetTokens(activeEditor.getHTML()));
    },
  });

  useEffect(() => {
    if (editor && displayContent !== editor.getHTML()) {
      editor.commands.setContent(displayContent);
    }
  }, [editor, displayContent]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  if (!editor) {
    return null;
  }

  return (
    <div className={`${styles.editorContainer} ${readOnly ? styles.readOnly : ''}`}>
      {!readOnly && <MenuBar editor={editor} noteId={noteId} cryptoKey={cryptoKey} />}
      <EditorContent editor={editor} className={styles.editorContent} />
    </div>
  );
};
