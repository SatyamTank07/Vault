# Note Hierarchy & Visibility — Design

Date: 2026-10-13
Branch: `feature/note-hierarchy-visibility`

## Problem

The app has the right views (canvas mind map, calendar, stream/horizon), but two things make daily use unpleasant:

1. **Clutter.** Every note — including structural canvas nodes like "Fitness" or "Project X" — shows up in Grid and Calendar.
2. **One note per event.** A long-running event in the Stream is a single note. Real long-running work (e.g. "Learn Spanish, Oct–Dec") involves many notes, and there is no way to group them under the event.

## Decisions

| Question | Decision |
|---|---|
| What hides from Grid/Calendar? | A per-note `canvas_only` flag the user controls. |
| How do notes group under an event? | One `parent_note_id` on `Note`. The canvas tree becomes a view of it (replaces `canvas_nodes.parent_node_id`). |
| Flag default | Context-dependent: canvas-created notes and event children default to canvas-only; Grid/Calendar-created notes default to visible. Existing canvas notes migrate to canvas-only. |
| Flag scope | Hides from **Grid and Calendar only**. The **Stream always shows** dated notes, and the canvas always shows its nodes. |
| Stream UX for children | Children render as markers on the parent's bar; clicking a span bar opens an Event panel listing children with add/attach. |

## 1. Data model

### `notes` — new columns
- `parent_note_id VARCHAR NULL REFERENCES notes(id) ON DELETE SET NULL`, indexed. The single hierarchy for the app.
- `canvas_only BOOLEAN NOT NULL DEFAULT FALSE`. When true, the note is excluded from Grid and Calendar.

`models.Note` gains both columns plus `parent = relationship("Note", remote_side=[id], backref="children")`.

### `canvas_nodes`
- `parent_node_id` is **removed** from the model and dropped from the DB after backfill. A canvas node only records canvas membership and position.

### Invariant: no invisible notes
A note may have `canvas_only = true` only while it has a parent **or** at least one canvas node. A helper `crud._enforce_visibility(db, note)` sets `canvas_only = false` when neither holds. It runs after:
- clearing a note's parent,
- deleting a note (applied to its former children, after `SET NULL`),
- deleting a canvas node without deleting its note.

## 2. Migration (`database.run_schema_migrations`)

Appended statements, each idempotent:

1. `ALTER TABLE notes ADD COLUMN IF NOT EXISTS parent_note_id VARCHAR REFERENCES notes(id) ON DELETE SET NULL`
2. `CREATE INDEX IF NOT EXISTS ix_notes_parent_note_id ON notes (parent_note_id)`
3. `ALTER TABLE notes ADD COLUMN IF NOT EXISTS canvas_only BOOLEAN` (no default yet, so existing rows are NULL)
4. A `DO $$ ... $$` block guarded by `IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='canvas_nodes' AND column_name='parent_node_id')`:
   - `UPDATE notes n SET parent_note_id = pn.note_id FROM canvas_nodes c JOIN canvas_nodes pn ON c.parent_node_id = pn.id WHERE c.note_id = n.id AND n.parent_note_id IS NULL AND pn.note_id <> n.id;`
   - `ALTER TABLE canvas_nodes DROP COLUMN parent_node_id;`
5. `UPDATE notes SET canvas_only = EXISTS (SELECT 1 FROM canvas_nodes c WHERE c.note_id = notes.id) WHERE canvas_only IS NULL`
6. `ALTER TABLE notes ALTER COLUMN canvas_only SET DEFAULT FALSE`
7. `ALTER TABLE notes ALTER COLUMN canvas_only SET NOT NULL`

Ordering note: `Base.metadata.create_all()` runs first. Because `notes` already exists, it will not add the columns — the ALTERs do. On a fresh DB, `create_all` creates `canvas_only` with the ORM default and statement 5 is a no-op.

Re-running is safe: step 4 is skipped once the column is gone; step 5 finds no NULLs, so a user's later "make visible" choice is never reset.

Expected effect on current data: 8 parent links migrated, 10 notes set to canvas-only.

## 3. Backend API

### Schemas
- `NoteCreate`: `parent_note_id: Optional[str] = None`, `canvas_only: bool = False`.
- `NoteUpdate`: `canvas_only: Optional[bool] = None`. (Parent changes go through the dedicated endpoint, not `NoteUpdate`.)
- `NoteResponse`: `parent_note_id: Optional[str] = None`, `canvas_only: bool = False`.
- `CanvasNodeCreate`: drop `parent_node_id`; add `parent_note_id: Optional[str] = None`.
- `CanvasNodeUpdate`: drop `parent_node_id` / `clear_parent` (position only).
- `CanvasNodeResponse`: drop `parent_node_id`; the nested note now carries `parent_note_id` and `canvas_only`.
- New `NoteParentUpdate`: `parent_note_id: Optional[str] = None`, `clear_parent: bool = False`.

### Parent logic — `crud.set_note_parent(db, user_id, note_id, parent_note_id | None)`
- Validates the parent belongs to `user_id`, is not the note itself, and is not a descendant of the note (walk up from the parent via `parent_note_id`; if the walk reaches `note_id`, reject). Rejections raise a 400 in the route.
- **Canvas mirroring:** if the parent has a canvas node and the child has no node on that canvas, create one on the parent's canvas at `(parent.x, parent.y + 150)`.
- On clear: set `parent_note_id = NULL`, then `_enforce_visibility`.

### Routes
- **New** `PUT /api/notes/{note_id}/parent` → `crud.set_note_parent`. Returns `NoteResponse`. 404 if the note is missing, 400 on invalid parent.
- `POST /notes/` (`create_note`): if `parent_note_id` is set, validate it and apply canvas mirroring (same helper as above).
- `PUT /notes/{id}` (`update_note`): accepts `canvas_only`. Setting it to true is accepted only if the invariant holds; otherwise it is coerced to false.
- `POST /api/canvases/{id}/nodes/` and `.../branch`:
  - Notes created here (no `note_id`) get `canvas_only = true`.
  - When `parent_note_id` is given, it is validated (same owner, no cycle) and set directly on the note. No mirroring is needed, since the node is being created now.
  - For an existing `note_id`, `canvas_only` is left unchanged.
- `PUT /api/canvases/{id}/nodes/{node_id}`: position only.
- `DELETE /api/canvases/{id}/nodes/{node_id}`: after deleting the node, `_enforce_visibility` on its note.
- `DELETE /notes/{id}`: before deleting, collect the child ids; after the commit, run `_enforce_visibility` on each child.

### Timeline / Timestream
- `crud.get_timeline` filters `models.Note.canvas_only == False` on both queries, so hidden recurring notes are never expanded into `TaskOccurrence` rows.
- `crud.get_timestream` does **not** filter. Both endpoints add `parent_note_id` and `canvas_only` to each serialized `note` dict and add a top-level `parent_note_id` to each event.
- `get_timestream` keeps its rule: no `db.add` / `db.commit`.

## 4. Frontend

### Shared type (`NoteCard.tsx` `Note`)
Add `parent_note_id?: string | null` and `canvas_only?: boolean`. `App.handleCreateNote` / `handleUpdateNote` pass both through unencrypted. `encryptNote` / `decryptNote` touch only title/content, so no crypto changes.

### Grid (`App.tsx`)
- Render `notes.filter(n => !n.canvas_only)`, plus the existing Show Done filter.
- `NoteCard` gets an optional `parentTitle` prop. When set, it shows a "↳ {parentTitle}" chip; clicking the chip calls `onView(parent)`.

### Calendar (`TimelineView`)
No client change; the server excludes canvas-only notes.

### Note modal (`NoteModal.tsx`)
- New state `canvasOnly` (initial value from `initialData?.canvas_only`, or the `defaultCanvasOnly` prop for new notes) and `parentNoteId` (from `initialData?.parent_note_id`, or the `defaultParentId` prop).
- Popover gains:
  - A **"Show in Grid & Calendar"** toggle (inverse of `canvasOnly`).
  - A **Parent** row: a searchable picker over `allNotes` (a new prop), matched on decrypted title. It excludes the note and its descendants (computed client-side from `parent_note_id`). It has a clear (×) button.
- Both fields count toward the dirty check.
- Save: `canvas_only` goes in the note payload. For **new** notes, `parent_note_id` goes in the create payload. For **existing** notes whose parent changed, `App` calls `PUT /api/notes/{id}/parent` after the update.

### Canvas (`CanvasView.tsx`, `canvasUtils.ts`)
- `BackendCanvasNode`: drop `parent_node_id`; `note` gains `parent_note_id`, `canvas_only`.
- `convertToReactFlow`: build a `noteId → nodeId` map; for each node whose `note.parent_note_id` maps to a node on this canvas, emit the edge `parent node → child node`.
- `onConnect`: `PUT /api/notes/{targetNoteId}/parent` with the source node's note id, then refresh.
- Edge removal is not persisted today (there is no `onEdgesDelete` handler), and this design does not add one. Detaching is done through the modal's Parent row or the Event panel.
- Node creation via the modal (`handleSaveNewCanvasNode`) takes two calls:
  1. `POST /notes/` with `canvas_only: true` and **no** parent,
  2. `POST .../nodes/` with `note_id` and `parent_note_id` (the parent node's note).

  Sending the parent in call 2 rather than call 1 prevents canvas mirroring from creating a duplicate node. The branch button sends `parent_note_id` the same way.
- The canvas keeps receiving `notes` with the Show Done filter only — never the Grid filter.

### Stream (`TimeStreamView/`)
- `TimeStreamEvent` gains `parent_note_id?: string | null`.
- **Marker grouping** (in `TimeStreamCanvas` layout): build a map of span events by note id. A child event is drawn as a marker on its parent's bar instead of in its own lane when all of these hold:
  - it is not recurring,
  - it is not a span,
  - its parent is a span event present in `events`,
  - `parent.start_date <= child.start_date <= parent.end_date`.
- Markers are small dots positioned at the child date's x, inside the parent bar: hollow = todo, half = in_progress, ✓ = done. Hover shows the tooltip (child title + date). Click → `onOpenNote(child.note)`, with `stopPropagation`.
- All other children keep their normal lanes.
- **Click behavior:** a span bar calls a new `onOpenEvent(event)` prop, which opens the Event panel. Single-day bars and recurring markers keep calling `onOpenNote`.
- **Refetch** when the `notes` prop identity changes, so new or edited children appear immediately.

### Event panel (new `TimeStreamView/EventPanel.tsx` + `.module.css`)
Props: `event`, `allNotes`, `onClose`, `onOpenNote`, `onCreateChild(parentId)`, `onSetParent(noteId, parentId | null)`.

- **Layout:** a right-side drawer on desktop; a bottom sheet below the mobile breakpoint used by `NoteModal`.
- **Header:**
  - title,
  - date range,
  - status,
  - an **Open note** button,
  - progress "X / Y done", where Y counts direct children with a non-null status.
- **Children** = `allNotes.filter(n => n.parent_note_id === event.note.id)`. Dated children come first, sorted by `scheduled_date`, then undated ones. Each row shows the status icon, date or "—", and the title. Clicking a row → `onOpenNote`; × → `onSetParent(child.id, null)`.
- **+ New note** → `onCreateChild(event.note.id)`.
- **Attach** opens an inline search list over `allNotes`. It excludes the event note, its ancestors, and its current children. Choosing a note → `onSetParent(id, event.note.id)`. Attaching does not change the note's `canvas_only`.

### Wiring
- `App` gains `openCreateChildModal(parentId)`, which opens `NoteModal` with `defaultParentId = parentId` and `defaultCanvasOnly = true`.
- `App` gains `handleSetParent(noteId, parentId)`, which calls the endpoint and then `fetchNotes()`. Refetching is needed because canvas mirroring and visibility enforcement can change other rows.
- Both are passed App → `TimelineView` → `TimeStreamView` → `EventPanel`, along with `notes`.
- `EventPanel` state (the selected event) lives in `TimeStreamView`.

## 5. Error handling
- Parent endpoint: 404 when the note or parent is missing or belongs to another user; 400 on self or cycle. The frontend logs the error and refetches notes. The picker already filters invalid targets, so a 400 indicates a race.
- Migration failure aborts startup (it runs inside `engine.begin()`); the pre-migration `pg_dump` is the rollback.

## 6. Verification (no test suite exists)
1. `docker compose exec db pg_dump -U vault_user vault_db > <scratchpad>/vault_pre_hierarchy.sql` before the backend reloads with the migration.
2. After startup, check with psql:
   - `parent_node_id` is gone from `canvas_nodes`.
   - 8 notes have a `parent_note_id`.
   - 10 notes have `canvas_only = true`.
   - Restart the backend; the counts are unchanged.
3. `npm run lint` and `npm run build` pass.
4. Manual pass in the browser:
   - Grid and Calendar hide canvas notes; the toggle in the modal brings one back.
   - Connecting nodes on the canvas sets the parent, and the edge survives a reload.
   - A span event in the Stream shows child dots, and clicking it opens the panel.
   - "+ New note" creates a hidden child that appears in the panel, plus a dot if it is dated in range.
   - Attach and detach work.
   - Deleting a parent leaves its children visible in the Grid.
   - The chip on a visible child opens its parent.

## Out of scope
- Nested panels for grandchildren (only direct children are listed).
- Changing a child's status from inside the panel.
- Expandable sub-lanes in the Stream.
- A note on more than one canvas (current data has none; mirroring targets the parent's first canvas node).
