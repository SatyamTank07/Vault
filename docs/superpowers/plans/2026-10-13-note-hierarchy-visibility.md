# Note Hierarchy & Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give notes a single parent/child hierarchy (shared by the canvas and the Stream) and a per-note `canvas_only` flag that keeps structural notes out of Grid and Calendar.

**Architecture:** Two new columns on `notes`: `parent_note_id` and `canvas_only`. `canvas_nodes.parent_node_id` is migrated into `parent_note_id` and then dropped, so the canvas draws its edges from the note hierarchy. The backend enforces the hierarchy rules (no cycles, canvas mirroring, no invisible notes) and filters the calendar. All grouping by title happens client-side, because titles are encrypted. This covers the grid filter, Stream child markers, and the Event panel.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Postgres (Docker), React 19 + TypeScript + Vite, CSS Modules, @xyflow/react.

**Spec:** `docs/superpowers/specs/2026-10-13-note-hierarchy-visibility-design.md`

## Global Constraints

- Backend and Postgres run only in Docker (`docker compose up --build -d`). Never run uvicorn on the host. The frontend runs with `npm run dev` in `frontend/`.
- `./backend` is bind-mounted and uvicorn runs with `--reload`: **every saved Python file reloads the server**. Follow the file-edit order given in each backend task.
- Never read, edit, stage, or reference `redesign-preview/`. Never stage `docker-compose.yml`, `CLAUDE.md`, or `Vault_Deep_Dive.md` (unrelated pre-existing changes). Stage files by explicit path only.
- There is no Alembic. Every new column on an existing table needs an idempotent statement in `database.run_schema_migrations()`.
- Note `title`/`content` stay end-to-end encrypted. `parent_note_id` and `canvas_only` are plaintext metadata and must never pass through `encryptNote`'s string encryption (they don't: it only touches title/content).
- `crud.get_timestream` must never call `db.add` or `db.commit`.
- Every `crud` function takes `user_id` and scopes its queries to it.
- Frontend lint baseline before this work: **39 errors, 2 warnings** (`npm run lint`). The count must not go up. New files must lint clean.
- `npm run build` (which runs `tsc -b`) must pass after every frontend task.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on branch `feature/note-hierarchy-visibility` (already created).

## Review Focus

1. **Leftover cycles in old canvas data** (A→B→A after migration). Every ancestor/descendant walk must terminate, both on the server (`_is_self_or_descendant`) and on the client (`noteTree.ts`). Pinned by `tolerates_existing_cycle_in_data` (Task 1) and the cycle asserts in `scripts/check-note-tree.ts` (Task 4).
2. **A note hidden everywhere.** A `canvas_only` note that has neither a parent nor a canvas node must become visible again. This applies after clearing a parent, deleting a parent, removing a canvas node, or creating/updating a lone note. Pinned by `canvas_only_requires_parent_or_canvas`, `deleting_parent_frees_children` (Task 1), and `removing_canvas_node_frees_top_level_note` (Task 2).
3. **Children that don't fit on a parent bar.** A child dated outside the parent span, a multi-day child, a recurring child, or a child whose parent isn't loaded must keep its own Stream lane and not vanish. Pinned in `scripts/check-stream-grouping.ts` (Task 7).
4. **Editing a note without touching its parent.** This must not call the parent endpoint or clear the parent. That holds even when the parent isn't in the loaded notes list. Pinned by a manual check in Task 9, step 5.
5. **Canvas node creation failing after the note was created.** The note must stay visible in the Grid (it's created with `canvas_only: false`, and the flag is only set by the node call). Pinned by `canvas_node_create_sets_parent_and_canvas_only` (Task 2), which shows a rejected node call leaves no hidden note, and by a manual check in Task 9, step 5.

---

## File Map

**Backend**
- `backend/database.py`: migration statements (Tasks 1, 2).
- `backend/models.py`: `Note.parent_note_id`, `Note.canvas_only`; removes `CanvasNode.parent_node_id` (Tasks 1, 2).
- `backend/schemas.py`: note, parent, and canvas schemas (Tasks 1, 2).
- `backend/crud.py`: hierarchy helpers, `set_note_parent`, note/canvas/timeline changes (Tasks 1–3).
- `backend/main.py`: `PUT /api/notes/{id}/parent`; 400 on an invalid parent in create (Task 1).
- `backend/scripts/check_hierarchy.py` (new): rolled-back DB checks for every backend rule (Tasks 1–3).

**Frontend**
- `frontend/src/lib/noteTree.ts` (new): pure tree helpers (Task 4).
- `frontend/scripts/check-note-tree.ts` (new): node assert script for `noteTree.ts` (Task 4).
- `frontend/src/components/NoteCard/NoteCard.tsx` + `.module.css`: `Note` type fields, parent chip (Task 4).
- `frontend/src/App.tsx`: grid filter, fetch limit, `handleSetParent`, child-create wiring (Tasks 4, 6, 8).
- `frontend/src/components/CanvasView/canvasUtils.ts`, `CanvasView.tsx`: edges from the hierarchy (Tasks 5, 6).
- `frontend/src/components/NotePicker/NotePicker.tsx` + `.module.css` (new): searchable note list (Task 6).
- `frontend/src/components/NoteModal/NoteModal.tsx` + `.module.css`: visibility and parent pills (Task 6).
- `frontend/src/components/TimeStreamView/streamGrouping.ts` (new) + `frontend/scripts/check-stream-grouping.ts` (new) (Task 7).
- `frontend/src/components/TimeStreamView/TimeStreamCanvas.tsx`, `TimeStreamView.tsx`, `TimeStreamView.module.css`: markers, span click (Tasks 7, 8).
- `frontend/src/components/TimeStreamView/EventPanel.tsx` + `.module.css` (new) (Task 8).
- `frontend/src/components/TimelineView/TimelineView.tsx`: pass-through props (Task 8).

---

### Task 1: Note hierarchy core (backend)

**Files:**
- Create: `backend/scripts/check_hierarchy.py`
- Modify: `backend/database.py` (`run_schema_migrations` statements list)
- Modify: `backend/models.py` (`class Note`)
- Modify: `backend/schemas.py` (`NoteCreate`, `NoteUpdate`, `NoteResponse`, new `NoteParentUpdate`)
- Modify: `backend/crud.py` (new helpers after `get_notes`; `create_note`, `update_note`, `delete_note`)
- Modify: `backend/main.py` (`create_note` route; new parent route after `update_note_schedule`)

**Interfaces:**
- Produces:
  - `crud.InvalidParentError(ValueError)`
  - `crud._validate_parent(db, user_id: str, note_id: str | None, parent_note_id: str) -> models.Note` (raises `InvalidParentError`)
  - `crud._mirror_onto_parent_canvas(db, parent: models.Note, child: models.Note) -> None`
  - `crud._enforce_visibility(note: models.Note) -> None`
  - `crud.set_note_parent(db, user_id: str, note_id: str, parent_note_id: str | None) -> models.Note | None`
  - `PUT /api/notes/{note_id}/parent`, body `{"parent_note_id": str}` or `{"clear_parent": true}` → `NoteResponse`; 404 when the note is missing, 400 on an invalid parent
  - `NoteResponse` now includes `parent_note_id: str | null` and `canvas_only: bool`
  - `NoteCreate` accepts `parent_note_id` and `canvas_only`; `NoteUpdate` accepts `canvas_only`
  - Check harness helpers: `check`, `make_user`, `make_note`, `put_on_new_canvas`, `reload`, `expect_invalid_parent`

- [ ] **Step 1: Back up the database and record the counts the migration must preserve**

From the repo root (bash):

```bash
docker compose exec -T db pg_dump -U vault_user vault_db > ../vault_pre_hierarchy_2026-10-13.sql
ls -l ../vault_pre_hierarchy_2026-10-13.sql
docker compose exec -T db psql -U vault_user -d vault_db -c "select count(*) filter (where parent_node_id is not null) as linked_nodes, count(distinct note_id) as canvas_notes from canvas_nodes;"
```

Expected: a non-empty `.sql` file outside the repo, and one row of counts (at plan time: `linked_nodes = 8`, `canvas_notes = 10`). **Write both numbers down.** Tasks 1 and 2 verify against them.

- [ ] **Step 2: Write the check harness with Task 1's checks**

Create `backend/scripts/check_hierarchy.py`:

```python
"""Checks for the note hierarchy and visibility rules.

Every check runs against the dev database inside one outer transaction that is
rolled back at the end, so nothing is left behind.

Run from the repo root:
    docker compose exec backend python -m scripts.check_hierarchy
"""
import uuid
from datetime import date, timedelta

from sqlalchemy import inspect
from sqlalchemy.orm import Session

import crud
import models
import schemas
from database import engine

CHECKS = []


def check(fn):
    CHECKS.append(fn)
    return fn


def make_user(db: Session) -> str:
    user = models.User(mobile_number=f"+00{uuid.uuid4().hex[:12]}", password_hash="x")
    db.add(user)
    db.commit()
    return user.id


def make_note(db: Session, user_id: str, title: str = "n", **fields):
    return crud.create_note(db, user_id, schemas.NoteCreate(title=title, **fields))


def put_on_new_canvas(db: Session, user_id: str, note_id: str) -> models.CanvasNode:
    canvas = models.Canvas(name="check", user_id=user_id)
    db.add(canvas)
    db.flush()
    node = models.CanvasNode(canvas_id=canvas.id, note_id=note_id, position_x=10.0, position_y=20.0)
    db.add(node)
    db.commit()
    return node


def reload(db: Session, user_id: str, note_id: str):
    db.expire_all()
    return crud.get_note(db, user_id, note_id)


def expect_invalid_parent(fn) -> None:
    try:
        fn()
    except crud.InvalidParentError:
        return
    raise AssertionError("expected InvalidParentError")


# --- Task 1: note hierarchy core -------------------------------------------


@check
def new_columns_exist(db, user_id):
    columns = {c["name"] for c in inspect(db.connection()).get_columns("notes")}
    assert {"parent_note_id", "canvas_only"} <= columns, columns


@check
def new_note_defaults_visible_and_top_level(db, user_id):
    note = make_note(db, user_id)
    assert note.canvas_only is False
    assert note.parent_note_id is None


@check
def set_and_clear_parent(db, user_id):
    parent = make_note(db, user_id, "parent")
    child = make_note(db, user_id, "child")
    assert crud.set_note_parent(db, user_id, child.id, parent.id).parent_note_id == parent.id
    assert crud.set_note_parent(db, user_id, child.id, None).parent_note_id is None


@check
def rejects_self_cycle_and_foreign_parent(db, user_id):
    grandparent = make_note(db, user_id, "gp")
    parent = make_note(db, user_id, "p", parent_note_id=grandparent.id)
    child = make_note(db, user_id, "c", parent_note_id=parent.id)
    expect_invalid_parent(lambda: crud.set_note_parent(db, user_id, child.id, child.id))
    expect_invalid_parent(lambda: crud.set_note_parent(db, user_id, grandparent.id, child.id))
    other_user = make_user(db)
    foreign = make_note(db, other_user, "foreign")
    expect_invalid_parent(lambda: crud.set_note_parent(db, user_id, child.id, foreign.id))
    expect_invalid_parent(lambda: make_note(db, user_id, "x", parent_note_id=foreign.id))
    expect_invalid_parent(lambda: crud.set_note_parent(db, user_id, child.id, "no-such-note"))
    assert crud.set_note_parent(db, user_id, "no-such-note", parent.id) is None


@check
def tolerates_existing_cycle_in_data(db, user_id):
    a = make_note(db, user_id, "a")
    b = make_note(db, user_id, "b")
    # Simulate a cycle left over from old canvas data, bypassing validation.
    a.parent_note_id = b.id
    b.parent_note_id = a.id
    db.commit()
    c = make_note(db, user_id, "c")
    assert crud.set_note_parent(db, user_id, c.id, a.id).parent_note_id == a.id
    expect_invalid_parent(lambda: crud.set_note_parent(db, user_id, a.id, b.id))


@check
def parent_on_canvas_pulls_child_onto_it(db, user_id):
    parent = make_note(db, user_id, "parent")
    parent_node = put_on_new_canvas(db, user_id, parent.id)
    canvas_id = parent_node.canvas_id
    child = make_note(db, user_id, "child")
    crud.set_note_parent(db, user_id, child.id, parent.id)
    child = reload(db, user_id, child.id)
    assert len(child.canvas_nodes) == 1
    node = child.canvas_nodes[0]
    assert node.canvas_id == canvas_id
    assert (node.position_x, node.position_y) == (10.0, 170.0)
    # Setting the same parent again must not add a second node.
    crud.set_note_parent(db, user_id, child.id, parent.id)
    assert len(reload(db, user_id, child.id).canvas_nodes) == 1


@check
def create_with_parent_sets_parent_and_mirrors(db, user_id):
    parent = make_note(db, user_id, "parent")
    put_on_new_canvas(db, user_id, parent.id)
    child = make_note(db, user_id, "child", parent_note_id=parent.id, canvas_only=True)
    child = reload(db, user_id, child.id)
    assert child.parent_note_id == parent.id
    assert child.canvas_only is True
    assert len(child.canvas_nodes) == 1


@check
def canvas_only_requires_parent_or_canvas(db, user_id):
    lonely = make_note(db, user_id, "lonely", canvas_only=True)
    assert lonely.canvas_only is False
    updated = crud.update_note(db, user_id, lonely.id, schemas.NoteUpdate(canvas_only=True))
    assert updated.canvas_only is False
    parent = make_note(db, user_id, "parent")
    child = make_note(db, user_id, "child", parent_note_id=parent.id, canvas_only=True)
    assert child.canvas_only is True
    cleared = crud.set_note_parent(db, user_id, child.id, None)
    assert cleared.canvas_only is False


@check
def deleting_parent_frees_children(db, user_id):
    parent = make_note(db, user_id, "parent")
    child = make_note(db, user_id, "child", parent_note_id=parent.id, canvas_only=True)
    child_id = child.id
    assert crud.delete_note(db, user_id, parent.id) is True
    child = reload(db, user_id, child_id)
    assert child.parent_note_id is None
    assert child.canvas_only is False


def main() -> None:
    connection = engine.connect()
    outer = connection.begin()
    # crud functions call db.commit(); with create_savepoint those commits only
    # release savepoints, and the outer rollback below discards everything.
    db = Session(bind=connection, join_transaction_mode="create_savepoint")
    failures = 0
    try:
        for fn in CHECKS:
            try:
                user_id = make_user(db)
                fn(db, user_id)
                print(f"PASS {fn.__name__}")
            except Exception as exc:
                failures += 1
                db.rollback()
                print(f"FAIL {fn.__name__}: {exc!r}")
    finally:
        db.close()
        outer.rollback()
        connection.close()
    print(f"{len(CHECKS) - failures}/{len(CHECKS)} checks passed")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the checks and confirm they fail**

Run: `docker compose exec backend python -m scripts.check_hierarchy`
Expected: exit code 1. `FAIL new_columns_exist` (columns missing), and most other checks FAIL with `AttributeError`/`TypeError`/`ProgrammingError` (e.g. no `set_note_parent`, unknown field `canvas_only`).

- [ ] **Step 4: Add the migration statements (edit this file FIRST, so the columns exist before the model references them)**

In `backend/database.py`, append these entries to the end of the `statements` list (after the existing `"UPDATE notes SET status = NULL ..."` line):

```python
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS parent_note_id VARCHAR REFERENCES notes(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS ix_notes_parent_note_id ON notes (parent_note_id)",
        # Added without a default so existing rows are NULL and get backfilled exactly once below.
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS canvas_only BOOLEAN",
        "UPDATE notes SET canvas_only = EXISTS (SELECT 1 FROM canvas_nodes c WHERE c.note_id = notes.id) WHERE canvas_only IS NULL",
        "ALTER TABLE notes ALTER COLUMN canvas_only SET DEFAULT FALSE",
        "ALTER TABLE notes ALTER COLUMN canvas_only SET NOT NULL",
```

Save. Check the reload succeeded: `docker compose logs --tail=20 backend` should show `Application startup complete.` with no traceback.

- [ ] **Step 5: Add the model columns**

In `backend/models.py`, inside `class Note`, add these after `recurrence_end_date = Column(Date, nullable=True)`:

```python
    parent_note_id = Column(String, ForeignKey("notes.id", ondelete="SET NULL"), nullable=True, index=True)
    canvas_only = Column(Boolean, nullable=False, default=False, server_default="false")
```

- [ ] **Step 6: Update the schemas**

In `backend/schemas.py`:

Append these fields to `class NoteCreate` (after `recurrence_end_date`):

```python
    parent_note_id: Optional[str] = None
    canvas_only: bool = False
```

Append this field to `class NoteUpdate` (after `recurrence_end_date`):

```python
    canvas_only: Optional[bool] = None
```

Append these fields to `class NoteResponse` (after `end_date`, before `class Config`):

```python
    parent_note_id: Optional[str] = None
    canvas_only: bool = False
```

Add a new class directly after `class NoteScheduleUpdate`:

```python
class NoteParentUpdate(BaseModel):
    parent_note_id: Optional[str] = None
    clear_parent: bool = False
```

- [ ] **Step 7: Add the hierarchy helpers to crud**

In `backend/crud.py`, insert directly after the `get_notes` function:

```python
class InvalidParentError(ValueError):
    pass


def _is_self_or_descendant(db: Session, user_id: str, candidate_id: str, ancestor_id: str) -> bool:
    """Walk up from candidate_id; True if the walk reaches ancestor_id. Stops on cycles."""
    seen = set()
    current_id = candidate_id
    while current_id and current_id not in seen:
        if current_id == ancestor_id:
            return True
        seen.add(current_id)
        current_id = (
            db.query(models.Note.parent_note_id)
            .filter(models.Note.id == current_id, models.Note.user_id == user_id)
            .scalar()
        )
    return False


def _validate_parent(db: Session, user_id: str, note_id: str | None, parent_note_id: str):
    parent = get_note(db, user_id, parent_note_id)
    if parent is None:
        raise InvalidParentError("Parent note not found")
    if note_id and _is_self_or_descendant(db, user_id, parent_note_id, note_id):
        raise InvalidParentError("A note cannot be placed under itself or its own descendant")
    return parent


def _mirror_onto_parent_canvas(db: Session, parent, child) -> None:
    """Keep the canvas a view of the hierarchy: put the child on the parent's canvas."""
    if not parent.canvas_nodes:
        return
    parent_node = parent.canvas_nodes[0]
    if any(node.canvas_id == parent_node.canvas_id for node in child.canvas_nodes):
        return
    db.add(
        models.CanvasNode(
            canvas_id=parent_node.canvas_id,
            note_id=child.id,
            position_x=parent_node.position_x,
            position_y=parent_node.position_y + 150,
        )
    )


def _enforce_visibility(note) -> None:
    """A note may be canvas-only only while it has a parent or a canvas node."""
    if note.canvas_only and note.parent_note_id is None and not note.canvas_nodes:
        note.canvas_only = False


def set_note_parent(db: Session, user_id: str, note_id: str, parent_note_id: str | None):
    db_note = get_note(db, user_id, note_id)
    if db_note is None:
        return None
    if parent_note_id is None:
        db_note.parent_note_id = None
        _enforce_visibility(db_note)
    else:
        parent = _validate_parent(db, user_id, note_id, parent_note_id)
        db_note.parent_note_id = parent.id
        _mirror_onto_parent_canvas(db, parent, db_note)
    db.commit()
    db.refresh(db_note)
    return db_note
```

- [ ] **Step 8: Wire the helpers into create/update/delete**

In `backend/crud.py` `create_note`, replace everything from `db_note = models.Note(` through the end of the function with:

```python
    db_note = models.Note(
        user_id=user_id,
        id=note.id if note.id else None,
        title=note.title,
        content=note.content,
        scheduled_date=scheduled_date,
        scheduled_time=scheduled_time,
        end_date=end_date,
        status=status,
        recurrence_rule=note.recurrence_rule,
        recurrence_interval=note.recurrence_interval if note.recurrence_interval is not None else 1,
        recurrence_end_date=note.recurrence_end_date,
        canvas_only=note.canvas_only,
    )
    parent = None
    if note.parent_note_id:
        parent = _validate_parent(db, user_id, note.id, note.parent_note_id)
        db_note.parent_note_id = parent.id
    db.add(db_note)
    db.flush()
    if parent is not None:
        _mirror_onto_parent_canvas(db, parent, db_note)
    _enforce_visibility(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note
```

In `update_note`, replace:

```python
        update_data = note.dict(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_note, key, value)
```

with:

```python
        update_data = note.dict(exclude_unset=True)
        if update_data.get("canvas_only") is None:
            update_data.pop("canvas_only", None)
        for key, value in update_data.items():
            setattr(db_note, key, value)
        _enforce_visibility(db_note)
```

In `delete_note`, add this as the first statement inside `if db_note:` (before `import shutil`):

```python
        child_ids = [
            child_id
            for (child_id,) in db.query(models.Note.id).filter(
                models.Note.user_id == user_id, models.Note.parent_note_id == note_id
            )
        ]
```

and replace the function's closing lines:

```python
        db.delete(db_note)
        db.commit()
        return True
    return False
```

with:

```python
        db.delete(db_note)
        db.commit()

        # ON DELETE SET NULL detached the children; a detached child that is
        # not on any canvas must become visible again.
        for child_id in child_ids:
            child = get_note(db, user_id, child_id)
            if child is not None:
                _enforce_visibility(child)
        db.commit()
        return True
    return False
```

- [ ] **Step 9: Add the parent route and the 400 on create**

In `backend/main.py`, replace the body of the `create_note` route:

```python
    return crud.create_note(db=db, user_id=current_user.id, note=note)
```

with:

```python
    try:
        return crud.create_note(db=db, user_id=current_user.id, note=note)
    except crud.InvalidParentError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
```

Then insert this route directly after the `update_note_schedule` route:

```python
@app.put("/api/notes/{note_id}/parent", response_model=schemas.NoteResponse)
def update_note_parent(
    note_id: str,
    data: schemas.NoteParentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not data.clear_parent and not data.parent_note_id:
        raise HTTPException(status_code=400, detail="Provide parent_note_id or clear_parent")
    parent_note_id = None if data.clear_parent else data.parent_note_id
    try:
        db_note = crud.set_note_parent(db, user_id=current_user.id, note_id=note_id, parent_note_id=parent_note_id)
    except crud.InvalidParentError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if db_note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return db_note
```

- [ ] **Step 10: Run the checks and confirm they pass**

Run: `docker compose exec backend python -m scripts.check_hierarchy`
Expected: all lines `PASS ...`, final line `9/9 checks passed`, exit code 0.

Then confirm the backfill and the startup log:

```bash
docker compose logs --tail=20 backend
docker compose exec -T db psql -U vault_user -d vault_db -c "select count(*) filter (where canvas_only) as canvas_only, count(*) as total from notes;"
```

Expected: no traceback in the log; `canvas_only` equals the `canvas_notes` count from Step 1.

Restart once to prove the migration is idempotent: `docker compose restart backend`, then rerun the psql query. Expected: same numbers.

- [ ] **Step 11: Commit**

```bash
git add backend/scripts/check_hierarchy.py backend/database.py backend/models.py backend/schemas.py backend/crud.py backend/main.py
git commit -m "feat(backend): add note parent hierarchy and canvas_only visibility

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Canvas reads the note hierarchy (backend)

**Files:**
- Modify: `backend/scripts/check_hierarchy.py` (append Task 2 checks before `def main`)
- Modify: `backend/models.py` (`class CanvasNode`, imports)
- Modify: `backend/schemas.py` (`CanvasNodeCreate`, `CanvasNodeUpdate`, `CanvasNodeResponse`)
- Modify: `backend/crud.py` (`create_canvas_node`, `update_canvas_node`, `delete_canvas_node`, `create_branch`)
- Modify: `backend/database.py` (append the backfill-and-drop block LAST)

**Interfaces:**
- Consumes: `crud._validate_parent`, `crud.InvalidParentError`, `crud._enforce_visibility` (Task 1)
- Produces:
  - `POST /api/canvases/{id}/nodes/` body `{note_id?, title?, parent_note_id?, canvas_only?, position_x, position_y}`
  - `PUT /api/canvases/{id}/nodes/{node_id}` body `{position_x?, position_y?}` (position only)
  - `CanvasNodeResponse` = `{id, canvas_id, note: NoteResponse, position_x, position_y}` (no `parent_node_id`)

> Between this task and Task 5, canvas edges won't render in the running frontend (it still reads `parent_node_id`). That's expected on this branch.

- [ ] **Step 1: Append the Task 2 checks**

In `backend/scripts/check_hierarchy.py`, insert before `def main() -> None:`:

```python
# --- Task 2: canvas reads the note hierarchy ---------------------------------


@check
def canvas_nodes_no_longer_store_parents(db, user_id):
    columns = {c["name"] for c in inspect(db.connection()).get_columns("canvas_nodes")}
    assert "parent_node_id" not in columns, columns


@check
def canvas_node_create_sets_parent_and_canvas_only(db, user_id):
    canvas = crud.create_canvas(db, user_id, schemas.CanvasCreate(name="c"))
    root = crud.create_canvas_node(db, user_id, canvas.id, schemas.CanvasNodeCreate(title="root"))
    root_note_id = root.note.id
    assert root.note.canvas_only is True
    assert root.note.parent_note_id is None

    existing = make_note(db, user_id, "existing")
    node = crud.create_canvas_node(
        db,
        user_id,
        canvas.id,
        schemas.CanvasNodeCreate(note_id=existing.id, parent_note_id=root_note_id, canvas_only=True),
    )
    assert node.note.parent_note_id == root_note_id
    assert node.note.canvas_only is True

    untouched = make_note(db, user_id, "untouched")
    node = crud.create_canvas_node(db, user_id, canvas.id, schemas.CanvasNodeCreate(note_id=untouched.id))
    assert node.note.canvas_only is False

    # A rejected parent must not leave a half-created note behind.
    other_user = make_user(db)
    foreign = make_note(db, other_user, "foreign")
    before = db.query(models.Note).filter(models.Note.user_id == user_id).count()
    bad = crud.create_canvas_node(
        db, user_id, canvas.id, schemas.CanvasNodeCreate(title="x", parent_note_id=foreign.id)
    )
    assert bad is None
    assert db.query(models.Note).filter(models.Note.user_id == user_id).count() == before


@check
def branch_sets_parent(db, user_id):
    canvas = crud.create_canvas(db, user_id, schemas.CanvasCreate(name="c"))
    root = crud.create_canvas_node(db, user_id, canvas.id, schemas.CanvasNodeCreate(title="root"))
    branch = crud.create_branch(db, user_id, canvas.id, root.id, schemas.BranchCreate(title="leaf"))
    assert branch.note.parent_note_id == root.note.id
    assert branch.note.canvas_only is True


@check
def removing_canvas_node_frees_top_level_note(db, user_id):
    canvas = crud.create_canvas(db, user_id, schemas.CanvasCreate(name="c"))
    root = crud.create_canvas_node(db, user_id, canvas.id, schemas.CanvasNodeCreate(title="root"))
    child = crud.create_canvas_node(
        db, user_id, canvas.id, schemas.CanvasNodeCreate(title="child", parent_note_id=root.note.id)
    )
    root_node_id, root_note_id = root.id, root.note.id
    child_node_id, child_note_id = child.id, child.note.id
    assert crud.delete_canvas_node(db, user_id, root_node_id) is True
    assert crud.delete_canvas_node(db, user_id, child_node_id) is True
    assert reload(db, user_id, root_note_id).canvas_only is False
    # The child still has a parent, so it may stay canvas-only (it lives in its parent's event panel).
    assert reload(db, user_id, child_note_id).canvas_only is True


@check
def position_update_still_works(db, user_id):
    canvas = crud.create_canvas(db, user_id, schemas.CanvasCreate(name="c"))
    root = crud.create_canvas_node(db, user_id, canvas.id, schemas.CanvasNodeCreate(title="root"))
    moved = crud.update_canvas_node(db, user_id, root.id, schemas.CanvasNodeUpdate(position_x=5.0, position_y=6.0))
    assert (moved.position_x, moved.position_y) == (5.0, 6.0)
```

- [ ] **Step 2: Run the checks and confirm the new ones fail**

Run: `docker compose exec backend python -m scripts.check_hierarchy`
Expected: Task 1 checks PASS. `canvas_nodes_no_longer_store_parents` FAILs, and so do `canvas_node_create_sets_parent_and_canvas_only` / `branch_sets_parent` (e.g. `ValidationError` on unknown fields, or `canvas_only` False). Exit code 1.

- [ ] **Step 3: Remove the column from the model (edit order: models → schemas → crud → database)**

In `backend/models.py`, in `class CanvasNode`, delete these two lines:

```python
    parent_node_id = Column(String, ForeignKey("canvas_nodes.id", ondelete="SET NULL"), nullable=True)
```

```python
    children = relationship("CanvasNode", backref=backref("parent", remote_side=[id]))
```

and change the import line `from sqlalchemy.orm import backref, relationship` to:

```python
from sqlalchemy.orm import relationship
```

- [ ] **Step 4: Update the canvas schemas**

In `backend/schemas.py`, replace `class CanvasNodeCreate`, `class CanvasNodeUpdate`, and `class CanvasNodeResponse` with:

```python
class CanvasNodeCreate(BaseModel):
    note_id: Optional[str] = None
    parent_note_id: Optional[str] = None
    canvas_only: Optional[bool] = None
    position_x: float = 0.0
    position_y: float = 0.0
    title: Optional[str] = None
    scheduled_date: Optional[date] = None


class CanvasNodeUpdate(BaseModel):
    position_x: Optional[float] = None
    position_y: Optional[float] = None


class CanvasNodeResponse(BaseModel):
    id: str
    canvas_id: str
    note: NoteResponse
    position_x: float
    position_y: float

    class Config:
        from_attributes = True
```

- [ ] **Step 5: Rewrite the canvas crud functions**

In `backend/crud.py`, replace the whole `create_canvas_node` function with:

```python
def create_canvas_node(db: Session, user_id: str, canvas_id: str, data: schemas.CanvasNodeCreate):
    canvas = get_canvas(db, user_id, canvas_id)
    if not canvas:
        return None

    if data.note_id:
        db_note = get_note(db, user_id, data.note_id)
        if not db_note:
            return None
        if data.canvas_only is not None:
            db_note.canvas_only = data.canvas_only
    else:
        db_note = models.Note(
            title=data.title or "Untitled",
            user_id=user_id,
            canvas_only=True if data.canvas_only is None else data.canvas_only,
        )
        db.add(db_note)
        db.flush()

    if data.parent_note_id:
        try:
            _validate_parent(db, user_id, db_note.id, data.parent_note_id)
        except InvalidParentError:
            db.rollback()
            return None
        db_note.parent_note_id = data.parent_note_id

    db_node = models.CanvasNode(
        canvas_id=canvas_id,
        note_id=db_note.id,
        position_x=data.position_x,
        position_y=data.position_y,
    )
    db.add(db_node)
    db.commit()
    db.refresh(db_node)
    db.refresh(db_node, ["note"])
    return db_node
```

Replace the whole `update_canvas_node` function with:

```python
def update_canvas_node(db: Session, user_id: str, node_id: str, data: schemas.CanvasNodeUpdate):
    db_node = (
        db.query(models.CanvasNode)
        .join(models.Canvas, models.CanvasNode.canvas_id == models.Canvas.id)
        .filter(models.CanvasNode.id == node_id, models.Canvas.user_id == user_id)
        .first()
    )
    if db_node:
        if data.position_x is not None:
            db_node.position_x = data.position_x
        if data.position_y is not None:
            db_node.position_y = data.position_y
        db.commit()
        db.refresh(db_node)
    return db_node
```

In `delete_canvas_node`, replace:

```python
    if db_node:
        db.delete(db_node)
        db.commit()
        return True
    return False
```

with:

```python
    if db_node:
        note_id = db_node.note_id
        db.delete(db_node)
        db.commit()
        db_note = get_note(db, user_id, note_id)
        if db_note is not None:
            _enforce_visibility(db_note)
            db.commit()
        return True
    return False
```

In `create_branch`, replace:

```python
    new_note = models.Note(title=data.title, user_id=user_id)
    db.add(new_note)
    db.flush()

    db_node = models.CanvasNode(
        canvas_id=canvas_id,
        note_id=new_note.id,
        parent_node_id=parent_node_id,
        position_x=parent.position_x,
        position_y=parent.position_y + 150,
    )
```

with:

```python
    new_note = models.Note(
        title=data.title,
        user_id=user_id,
        canvas_only=True,
        parent_note_id=parent.note_id,
    )
    db.add(new_note)
    db.flush()

    db_node = models.CanvasNode(
        canvas_id=canvas_id,
        note_id=new_note.id,
        position_x=parent.position_x,
        position_y=parent.position_y + 150,
    )
```

- [ ] **Step 6: Add the one-time backfill-and-drop migration (edit LAST)**

In `backend/database.py`, append this entry to the end of the `statements` list:

```python
        # One-time: move canvas parent links onto notes, then drop the old column.
        # Guarded by the column's existence, so it is a no-op on every later startup.
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'canvas_nodes' AND column_name = 'parent_node_id'
            ) THEN
                UPDATE notes n
                SET parent_note_id = pn.note_id
                FROM canvas_nodes c
                JOIN canvas_nodes pn ON c.parent_node_id = pn.id
                WHERE c.note_id = n.id
                  AND n.parent_note_id IS NULL
                  AND pn.note_id <> n.id;
                ALTER TABLE canvas_nodes DROP COLUMN parent_node_id;
            END IF;
        END $$;
        """,
```

Save, then check `docker compose logs --tail=20 backend` shows `Application startup complete.` with no traceback.

- [ ] **Step 7: Run the checks and confirm they pass**

Run: `docker compose exec backend python -m scripts.check_hierarchy`
Expected: `14/14 checks passed`, exit code 0.

Then verify the migrated data:

```bash
docker compose exec -T db psql -U vault_user -d vault_db -c "select count(*) filter (where parent_note_id is not null) as with_parent, count(*) filter (where canvas_only) as canvas_only from notes;"
docker compose exec -T db psql -U vault_user -d vault_db -c "\d canvas_nodes"
```

Expected: `with_parent` equals `linked_nodes` from Task 1 Step 1. It may be lower only if a node's parent pointed at its own note. `canvas_only` is unchanged from Task 1. `\d canvas_nodes` lists no `parent_node_id`.

Then run `docker compose restart backend` and repeat the first query. Expected: identical numbers.

- [ ] **Step 8: Commit**

```bash
git add backend/scripts/check_hierarchy.py backend/models.py backend/schemas.py backend/crud.py backend/database.py
git commit -m "feat(backend): derive canvas tree from note parent links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Calendar hides canvas-only notes; payloads carry hierarchy (backend)

**Files:**
- Modify: `backend/scripts/check_hierarchy.py` (append Task 3 checks before `def main`)
- Modify: `backend/crud.py` (`get_timeline`, `get_timestream`, new `_hierarchy_fields`)

**Interfaces:**
- Consumes: `Note.parent_note_id`, `Note.canvas_only` (Task 1)
- Produces:
  - Every `note` dict in `/api/timeline/` and `/api/timestream/` includes `parent_note_id` and `canvas_only`
  - Every `/api/timestream/` event has a top-level `parent_note_id`
  - `/api/timeline/` excludes notes where `canvas_only` is true

- [ ] **Step 1: Append the Task 3 checks**

In `backend/scripts/check_hierarchy.py`, insert before `def main() -> None:`:

```python
# --- Task 3: calendar visibility and payload fields --------------------------


@check
def calendar_hides_canvas_only_but_stream_keeps_it(db, user_id):
    today = date.today()
    parent = make_note(db, user_id, "event", scheduled_date=today, end_date=today + timedelta(days=30))
    hidden = make_note(db, user_id, "hidden", scheduled_date=today, parent_note_id=parent.id, canvas_only=True)
    visible = make_note(db, user_id, "visible", scheduled_date=today)
    parent_id, hidden_id, visible_id = parent.id, hidden.id, visible.id

    timeline = crud.get_timeline(db, user_id, today, today)
    timeline_ids = {entry["id"] for entries in timeline.values() for entry in entries}
    assert visible_id in timeline_ids and parent_id in timeline_ids, timeline_ids
    assert hidden_id not in timeline_ids
    for entries in timeline.values():
        for entry in entries:
            assert "parent_note_id" in entry["note"] and "canvas_only" in entry["note"]

    stream = {ev["id"]: ev for ev in crud.get_timestream(db, user_id, today, today)}
    assert hidden_id in stream
    assert stream[hidden_id]["parent_note_id"] == parent_id
    assert stream[hidden_id]["note"]["canvas_only"] is True
    assert stream[parent_id]["parent_note_id"] is None


@check
def calendar_does_not_materialize_hidden_recurrences(db, user_id):
    today = date.today()
    parent = make_note(db, user_id, "parent")
    routine = make_note(
        db,
        user_id,
        "routine",
        scheduled_date=today,
        recurrence_rule="daily",
        parent_note_id=parent.id,
        canvas_only=True,
    )
    routine_id = routine.id
    crud.get_timeline(db, user_id, today, today + timedelta(days=6))
    count = db.query(models.TaskOccurrence).filter(models.TaskOccurrence.note_id == routine_id).count()
    assert count == 0, count

    stream = crud.get_timestream(db, user_id, today, today + timedelta(days=6))
    routine_events = [ev for ev in stream if ev["note"]["id"] == routine_id]
    assert len(routine_events) == 7
    assert all(ev["parent_note_id"] == parent.id for ev in routine_events)
```

- [ ] **Step 2: Run the checks and confirm the new ones fail**

Run: `docker compose exec backend python -m scripts.check_hierarchy`
Expected: both new checks FAIL (hidden note present in the timeline / `KeyError: 'parent_note_id'`). Exit code 1.

- [ ] **Step 3: Add the payload helper**

In `backend/crud.py`, insert directly above `def get_timeline`:

```python
def _hierarchy_fields(note) -> dict:
    return {"parent_note_id": note.parent_note_id, "canvas_only": bool(note.canvas_only)}
```

- [ ] **Step 4: Filter and enrich `get_timeline`**

In `get_timeline`:

1. In the `one_off_notes` query filter, add `models.Note.canvas_only.is_(False),` directly after `models.Note.user_id == user_id,`.
2. In the `recurring_notes` query filter, add `models.Note.canvas_only.is_(False),` directly after `models.Note.user_id == user_id,`.
3. In the one-off `note_dict = { ... }`, add `**_hierarchy_fields(note),` as the last entry (after `"canvas_name": note.canvas_name,`).
4. In the recurring loop's nested `"note": { ... }` dict, add `**_hierarchy_fields(note),` as the last entry (after the `"recurrence_end_date": ...` line).

- [ ] **Step 5: Enrich `get_timestream` (no filtering, no writes)**

In `get_timestream`:

1. In the non-recurring `result.append({...})`, inside the nested `"note": { ... }` dict add `**_hierarchy_fields(note),` after `"end_date": ...`. Add `"parent_note_id": note.parent_note_id,` at the top level after `"occurrence_id": None,`.
2. In the recurring `result.append({...})`, inside the nested `"note": { ... }` dict add `**_hierarchy_fields(note),` after `"end_date": None,`. Add `"parent_note_id": note.parent_note_id,` at the top level after `"occurrence_id": occ_id,`.

- [ ] **Step 6: Run the checks and confirm they pass**

Run: `docker compose exec backend python -m scripts.check_hierarchy`
Expected: `16/16 checks passed`, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/check_hierarchy.py backend/crud.py
git commit -m "feat(backend): hide canvas-only notes from calendar, expose hierarchy in timeline payloads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend foundation (types, tree helpers, Grid, parent chip)

**Files:**
- Create: `frontend/src/lib/noteTree.ts`
- Create: `frontend/scripts/check-note-tree.ts`
- Modify: `frontend/src/components/NoteCard/NoteCard.tsx` (`Note` interface, props, badge row)
- Modify: `frontend/src/components/NoteCard/NoteCard.module.css` (append `.parentChip`)
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `PUT /api/notes/{id}/parent`, the `NoteResponse` fields (Task 1)
- Produces:
  - `Note.parent_note_id?: string | null`, `Note.canvas_only?: boolean`
  - `noteTree.ts`:
    - `getChildren<T>(notes, parentId): T[]`
    - `getAncestorIds(notes, noteId): string[]`
    - `getDescendantIds(notes, noteId): Set<string>`
    - `getParentCandidates<T>(notes, noteId | null): T[]`
    - `getAttachCandidates<T>(notes, parentId): T[]`
    - `sortByScheduleThenTitle<T>(notes): T[]`
  - `App.handleSetParent(noteId: string, parentId: string | null): Promise<void>` (always refetches notes)
  - `NoteCard` prop `parentNote?: Note`

- [ ] **Step 1: Write the failing tree check script**

Create `frontend/scripts/check-note-tree.ts`:

```ts
// Run from frontend/: node scripts/check-note-tree.ts
import assert from 'node:assert/strict';
import {
  getAncestorIds,
  getAttachCandidates,
  getChildren,
  getDescendantIds,
  getParentCandidates,
  sortByScheduleThenTitle,
} from '../src/lib/noteTree.ts';

const notes = [
  { id: 'root', parent_note_id: null },
  { id: 'a', parent_note_id: 'root' },
  { id: 'b', parent_note_id: 'root' },
  { id: 'a1', parent_note_id: 'a' },
  { id: 'loose', parent_note_id: null },
  // A cycle left over from old canvas data must not hang anything.
  { id: 'x', parent_note_id: 'y' },
  { id: 'y', parent_note_id: 'x' },
];
const ids = (list: { id: string }[]) => list.map((n) => n.id).sort();

assert.deepEqual(ids(getChildren(notes, 'root')), ['a', 'b']);
assert.deepEqual(getAncestorIds(notes, 'a1'), ['a', 'root']);
assert.deepEqual(getAncestorIds(notes, 'root'), []);
assert.deepEqual([...getDescendantIds(notes, 'root')].sort(), ['a', 'a1', 'b']);
assert.deepEqual(ids(getParentCandidates(notes, 'a')), ['b', 'loose', 'root', 'x', 'y']);
assert.deepEqual(ids(getParentCandidates(notes, null)), ids(notes));
assert.deepEqual(ids(getAttachCandidates(notes, 'a')), ['b', 'loose', 'x', 'y']);
assert.deepEqual(getAncestorIds(notes, 'x'), ['y']);
assert.deepEqual([...getDescendantIds(notes, 'x')].sort(), ['y']);

const sorted = sortByScheduleThenTitle([
  { id: '1', title: 'Zeta', scheduled_date: null },
  { id: '2', title: 'Later', scheduled_date: '2026-11-02' },
  { id: '3', title: 'Alpha', scheduled_date: null },
  { id: '4', title: 'Sooner', scheduled_date: '2026-10-12' },
]);
assert.deepEqual(sorted.map((n) => n.id), ['4', '2', '3', '1']);

console.log('note tree checks passed');
```

- [ ] **Step 2: Run it and confirm it fails**

Run (in `frontend/`): `node scripts/check-note-tree.ts`
Expected: fails with `ERR_MODULE_NOT_FOUND` for `src/lib/noteTree.ts`.

- [ ] **Step 3: Implement the tree helpers**

Create `frontend/src/lib/noteTree.ts`:

```ts
import type { Note } from '../components/NoteCard/NoteCard';

type TreeNote = Pick<Note, 'id' | 'parent_note_id'>;

/** Direct children of `parentId`. */
export function getChildren<T extends TreeNote>(notes: T[], parentId: string): T[] {
  return notes.filter((note) => note.parent_note_id === parentId);
}

/** Ids of every note above `noteId`, nearest first. Stops on cycles. */
export function getAncestorIds(notes: TreeNote[], noteId: string): string[] {
  const parentById = new Map(notes.map((note) => [note.id, note.parent_note_id ?? null]));
  const ancestors: string[] = [];
  let current = parentById.get(noteId) ?? null;
  while (current && current !== noteId && !ancestors.includes(current)) {
    ancestors.push(current);
    current = parentById.get(current) ?? null;
  }
  return ancestors;
}

/** Ids of every note below `noteId`. Stops on cycles. */
export function getDescendantIds(notes: TreeNote[], noteId: string): Set<string> {
  const childrenById = new Map<string, string[]>();
  for (const note of notes) {
    if (!note.parent_note_id) continue;
    const list = childrenById.get(note.parent_note_id) ?? [];
    list.push(note.id);
    childrenById.set(note.parent_note_id, list);
  }
  const descendants = new Set<string>();
  const stack = [...(childrenById.get(noteId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === noteId || descendants.has(id)) continue;
    descendants.add(id);
    stack.push(...(childrenById.get(id) ?? []));
  }
  return descendants;
}

/** Notes that may become the parent of `noteId`: not itself and not below it. */
export function getParentCandidates<T extends TreeNote>(notes: T[], noteId: string | null): T[] {
  if (!noteId) return notes;
  const blocked = getDescendantIds(notes, noteId);
  blocked.add(noteId);
  return notes.filter((note) => !blocked.has(note.id));
}

/** Notes that may be attached under `parentId`: not itself, its ancestors, or its current children. */
export function getAttachCandidates<T extends TreeNote>(notes: T[], parentId: string): T[] {
  const ancestors = new Set(getAncestorIds(notes, parentId));
  return notes.filter(
    (note) => note.id !== parentId && !ancestors.has(note.id) && note.parent_note_id !== parentId,
  );
}

/** Dated notes first (earliest first), then undated notes by title. */
export function sortByScheduleThenTitle<T extends Pick<Note, 'title' | 'scheduled_date'>>(notes: T[]): T[] {
  return [...notes].sort((a, b) => {
    if (a.scheduled_date && b.scheduled_date) return a.scheduled_date.localeCompare(b.scheduled_date);
    if (a.scheduled_date) return -1;
    if (b.scheduled_date) return 1;
    return (a.title || '').localeCompare(b.title || '');
  });
}
```

- [ ] **Step 4: Add the fields to the `Note` type**

In `frontend/src/components/NoteCard/NoteCard.tsx`, add these fields to `export interface Note` after `end_date?: string | null;`:

```ts
  parent_note_id?: string | null;
  canvas_only?: boolean;
```

- [ ] **Step 5: Run the tree check and confirm it passes**

Run (in `frontend/`): `node scripts/check-note-tree.ts`
Expected: prints `note tree checks passed`, exit code 0. A Node "type stripping" ExperimentalWarning is fine.

- [ ] **Step 6: Add the parent chip to NoteCard**

In `NoteCard.tsx`:

Add `parentNote?: Note;` to `interface NoteCardProps` (after `cryptoKey?: CryptoKey | null;`), and add `parentNote,` to the destructured props (after `cryptoKey,`).

Change the badge-row condition and add the chip. Replace:

```tsx
            {(note.canvas_name || isTask) && (
              <div className={styles.badgeRow}>
                {note.canvas_name ? (
                  <span className={styles.canvasName}>{note.canvas_name}</span>
                ) : null}
```

with:

```tsx
            {(note.canvas_name || isTask || parentNote) && (
              <div className={styles.badgeRow}>
                {note.canvas_name ? (
                  <span className={styles.canvasName}>{note.canvas_name}</span>
                ) : null}
                {parentNote && (
                  <button
                    type="button"
                    className={styles.parentChip}
                    onClick={(event) => {
                      event.stopPropagation();
                      onView(parentNote);
                    }}
                    title={`Part of: ${parentNote.title || 'Untitled'}`}
                  >
                    ↳ {parentNote.title || 'Untitled'}
                  </button>
                )}
```

Append to `NoteCard.module.css`:

```css
.parentChip {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--primary-purple);
  background: rgba(139, 92, 246, 0.08);
  border: 1px solid rgba(139, 92, 246, 0.2);
  border-radius: 9999px;
  padding: 1px 8px;
  cursor: pointer;
}

.parentChip:hover {
  background: rgba(139, 92, 246, 0.16);
}
```

- [ ] **Step 7: Update App (fetch limit, payloads, `handleSetParent`, Grid filter, chip)**

In `frontend/src/App.tsx`:

1. Change the React import to include `useMemo`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

2. In `fetchNotes`, change `apiFetch('/notes/')` to `apiFetch('/notes/?limit=1000')`. The backend defaults to 100, and the Event panel needs every child.

3. In **both** `handleCreateNote` and `handleUpdateNote`, add two entries to the `payload` object after `recurrence_end_date: noteData.recurrence_end_date || null,`. `canvas_only` is sent only when the caller set it. Otherwise an edit from a caller that doesn't know the flag (e.g. before Task 6) would unhide canvas notes. On update, `PUT /notes/{id}` ignores `parent_note_id`; parent changes go through `handleSetParent`.

```ts
        parent_note_id: noteData.parent_note_id || null,
        ...(noteData.canvas_only !== undefined ? { canvas_only: noteData.canvas_only } : {}),
```

4. In `handleCreateNote`, inside `if (response.ok) { ... }`, add this after `setNotes((prev) => [decrypted, ...prev]);`. The server may have mirrored the child onto a canvas.

```ts
        if (payload.parent_note_id) {
          fetchNotes();
        }
```

5. Add `handleSetParent` directly above `const handleUpdateNote`:

```ts
  const handleSetParent = useCallback(
    async (noteId: string, parentId: string | null) => {
      try {
        const response = await apiFetch(`/api/notes/${noteId}/parent`, {
          method: 'PUT',
          body: JSON.stringify(parentId ? { parent_note_id: parentId } : { clear_parent: true }),
        });
        if (!response.ok) {
          console.error('Failed to set parent:', await response.text());
        }
      } catch (error) {
        console.error('Failed to set parent:', error);
      } finally {
        // Parent changes can mirror canvas nodes and flip visibility on other rows.
        fetchNotes();
      }
    },
    [fetchNotes],
  );
```

6. In `handleUpdateNote`, inside `if (response.ok) { ... }`, add this after the `setNotes((prev) => prev.map(...))` call:

```ts
        // `undefined` means the caller doesn't manage parents; never treat that as "clear".
        if (noteData.parent_note_id !== undefined) {
          const previousParent = notes.find((n) => n.id === noteData.id)?.parent_note_id ?? null;
          const nextParent = noteData.parent_note_id ?? null;
          if (previousParent !== nextParent) {
            await handleSetParent(noteData.id, nextParent);
          }
        }
```

7. Directly above the `// Null-key guard` comment, add:

```ts
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const gridNotes = notes.filter((note) => !note.canvas_only && (showCompleted || note.status !== 'done'));
```

8. In the Grid JSX, replace `{(showCompleted ? notes : notes.filter(n => n.status !== 'done')).map((note) => (` with `{gridNotes.map((note) => (`. Then add this prop to `<NoteCard ... />` after `cryptoKey={cryptoKey}`:

```tsx
                  parentNote={note.parent_note_id ? notesById.get(note.parent_note_id) : undefined}
```

- [ ] **Step 8: Build, lint, and check in the browser**

Run (in `frontend/`): `npm run build`
Expected: `✓ built`.

Run: `npm run lint`
Expected: at most 39 errors and 2 warnings. Then run `npx eslint src/lib/noteTree.ts scripts/check-note-tree.ts`. Expected: no output.

With `npm run dev` running, open http://localhost:5173 → Grid. Expected: notes that sit on a canvas (the migrated canvas-only ones) are gone from the Grid, and other notes still show.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/noteTree.ts frontend/scripts/check-note-tree.ts frontend/src/components/NoteCard/NoteCard.tsx frontend/src/components/NoteCard/NoteCard.module.css frontend/src/App.tsx
git commit -m "feat(frontend): note tree helpers, hide canvas-only notes from grid, parent chip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Canvas edges from the note hierarchy (frontend)

**Files:**
- Modify: `frontend/src/components/CanvasView/canvasUtils.ts`
- Modify: `frontend/src/components/CanvasView/CanvasView.tsx` (`handleSaveNewCanvasNode`, `handleRemoveNode`, `onConnect`)

**Interfaces:**
- Consumes: `POST /api/canvases/{id}/nodes/` with `parent_note_id`/`canvas_only` (Task 2); `PUT /api/notes/{id}/parent` (Task 1); `Note.parent_note_id`/`canvas_only` (Task 4)
- Produces: `BackendCanvasNode.note.parent_note_id` / `canvas_only`; edges derived from `parent_note_id`

- [ ] **Step 1: Derive edges from the hierarchy**

In `canvasUtils.ts`, in `interface BackendCanvasNode`:
- Delete the line `parent_node_id: string | null;`.
- Add these lines inside the `note: { ... }` type, after `recurrence_end_date?: string | null;`:

```ts
    parent_note_id?: string | null;
    canvas_only?: boolean;
```

Replace the `const edges: Edge[] = backendNodes ... ;` block in `convertToReactFlow` with:

```ts
  const nodeIdByNoteId = new Map(backendNodes.map((bn) => [bn.note.id, bn.id]));
  const edges: Edge[] = backendNodes.flatMap((bn) => {
    const parentNodeId = bn.note.parent_note_id ? nodeIdByNoteId.get(bn.note.parent_note_id) : undefined;
    if (!parentNodeId || parentNodeId === bn.id) return [];
    return [
      {
        id: `e-${parentNodeId}-${bn.id}`,
        source: parentNodeId,
        target: bn.id,
        type: 'default',
        animated: false,
        style: { stroke: '#8B5CF6', strokeWidth: 2 },
      },
    ];
  });
```

- [ ] **Step 2: Send the parent and the flag with the node call when creating a note**

In `CanvasView.tsx` `handleSaveNewCanvasNode`, replace:

```ts
      // Encrypt note before sending
      const dataToSend = cryptoKey ? await encryptNote(noteData, cryptoKey) : noteData;
```

with:

```ts
      // The parent and canvas_only go with the node call, not the note call: the
      // note call would mirror a duplicate node, and the visibility rule would
      // reset canvas_only before the node exists.
      const parentNodeData = parentNodeIdForNewNote
        ? (nodes.find((n) => n.id === parentNodeIdForNewNote)?.data as { noteId?: string } | undefined)
        : undefined;
      const parentNoteId = parentNodeData?.noteId ?? noteData.parent_note_id ?? null;
      const notePayload = { ...noteData, parent_note_id: null, canvas_only: false };

      // Encrypt note before sending
      const dataToSend = cryptoKey ? await encryptNote(notePayload, cryptoKey) : notePayload;
```

and in the node `POST` body, replace `parent_node_id: parentNodeIdForNewNote,` with:

```ts
            parent_note_id: parentNoteId,
            canvas_only: noteData.canvas_only ?? true,
```

- [ ] **Step 3: Refresh notes after removing a node**

In `handleRemoveNode`, replace:

```ts
          if (response.ok) {
            fetchCanvasData(activeCanvasId);
          }
```

with:

```ts
          if (response.ok) {
            fetchCanvasData(activeCanvasId);
            fetchNotes();
          }
```

- [ ] **Step 4: Connecting two nodes sets the note parent**

Replace the whole `onConnect` `useCallback` with:

```ts
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!activeCanvasId) return;
      if (connection.source === connection.target) return;

      const noteIdOf = (nodeId: string | null) =>
        (nodes.find((n) => n.id === nodeId)?.data as { noteId?: string } | undefined)?.noteId;
      const sourceNoteId = noteIdOf(connection.source);
      const targetNoteId = noteIdOf(connection.target);
      if (!sourceNoteId || !targetNoteId) return;

      setEdges((prevEdges) =>
        addEdge(
          {
            ...connection,
            type: 'default',
            animated: false,
          } as Edge,
          prevEdges,
        ),
      );

      try {
        const response = await apiFetch(`/api/notes/${targetNoteId}/parent`, {
          method: 'PUT',
          body: JSON.stringify({ parent_note_id: sourceNoteId }),
        });
        if (!response.ok) {
          console.error('Failed to connect nodes:', await response.text());
        }
      } catch (error) {
        console.error('Failed to connect nodes:', error);
      } finally {
        // Re-derive edges from the hierarchy (a note has one parent, so an old edge may disappear).
        fetchCanvasData(activeCanvasId);
        fetchNotes();
      }
    },
    [activeCanvasId, fetchCanvasData, fetchNotes, nodes, setEdges],
  );
```

- [ ] **Step 5: Build, lint, and check in the browser**

Run (in `frontend/`): `npm run build`. Expected: `✓ built`.
Run: `npm run lint`. Expected: at most 39 errors.

In the browser, Canvas view:
- Migrated edges are back.
- Drag a connection from node A to node B: the edge stays after a page reload, and `docker compose exec -T db psql -U vault_user -d vault_db -c "select title is not null, parent_note_id from notes where parent_note_id is not null;"` shows one more row.
- Connecting a node to its own descendant snaps back (the server rejects it with a 400, which is logged in the console).
- "Add Note" and the branch "+" create nodes with edges.
- Removing a root node makes that note reappear in the Grid.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CanvasView/canvasUtils.ts frontend/src/components/CanvasView/CanvasView.tsx
git commit -m "feat(canvas): draw edges from note parent links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Note picker and note-modal visibility/parent pills (frontend)

**Files:**
- Create: `frontend/src/components/NotePicker/NotePicker.tsx`
- Create: `frontend/src/components/NotePicker/NotePicker.module.css`
- Modify: `frontend/src/components/NoteModal/NoteModal.tsx`
- Modify: `frontend/src/components/NoteModal/NoteModal.module.css` (append)
- Modify: `frontend/src/App.tsx` (NoteModal props)
- Modify: `frontend/src/components/CanvasView/CanvasView.tsx` (NoteModal props)

**Interfaces:**
- Consumes: `getParentCandidates` (Task 4); `Note.parent_note_id`/`canvas_only` (Task 4)
- Produces:
  - `<NotePicker notes: Note[] onPick(note) onClose() placeholder? />`
  - `NoteModal` new props `allNotes?: Note[]`, `defaultParentId?: string | null`, `defaultCanvasOnly?: boolean`
  - `NoteModal` `onSave` payload now includes `parent_note_id` and `canvas_only`

- [ ] **Step 1: Create NotePicker**

Create `frontend/src/components/NotePicker/NotePicker.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Note } from '../NoteCard/NoteCard';
import styles from './NotePicker.module.css';

interface NotePickerProps {
  notes: Note[];
  onPick: (note: Note) => void;
  onClose: () => void;
  placeholder?: string;
}

const MAX_RESULTS = 50;

export const NotePicker: React.FC<NotePickerProps> = ({ notes, onPick, onClose, placeholder = 'Search notes…' }) => {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? notes.filter((note) => (note.title || 'Untitled').toLowerCase().includes(needle))
      : notes;
    return matches.slice(0, MAX_RESULTS);
  }, [notes, query]);

  return (
    <div className={styles.picker} onClick={(event) => event.stopPropagation()}>
      <div className={styles.searchRow}>
        <Search size={14} className={styles.searchIcon} />
        <input
          autoFocus
          className={styles.searchInput}
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // Keep the surrounding modal's Escape handler from also firing.
              event.preventDefault();
              event.stopPropagation();
              onClose();
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (results[0]) onPick(results[0]);
            }
          }}
        />
      </div>
      <ul className={styles.results} role="listbox">
        {results.length === 0 ? (
          <li className={styles.empty}>No matching notes</li>
        ) : (
          results.map((note) => (
            <li key={note.id}>
              <button type="button" className={styles.result} onClick={() => onPick(note)}>
                <span className={styles.resultTitle}>{note.title || 'Untitled'}</span>
                {note.scheduled_date && <span className={styles.resultMeta}>{note.scheduled_date}</span>}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
};
```

Create `frontend/src/components/NotePicker/NotePicker.module.css`:

```css
.picker {
  width: min(320px, calc(100vw - 32px));
  background: var(--surface-color);
  border: 1px solid var(--surface-hover);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.searchRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--surface-hover);
}

.searchIcon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.searchInput {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 0.85rem;
  color: var(--text-main);
}

.results {
  list-style: none;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
}

.result {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--text-main);
  font-size: 0.85rem;
}

.result:hover {
  background: rgba(139, 92, 246, 0.08);
}

.resultTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resultMeta {
  flex-shrink: 0;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.empty {
  padding: 10px 8px;
  font-size: 0.8rem;
  color: var(--text-muted);
}
```

- [ ] **Step 2: Add the props, state, and save fields to NoteModal**

In `NoteModal.tsx`:

1. Change the lucide import to:

```ts
import { Calendar, Repeat, X, Clock, ArrowRight, CheckSquare, Eye, EyeOff, CornerDownRight } from 'lucide-react';
```

and add these imports after the `ConfirmModal` import:

```ts
import { NotePicker } from '../NotePicker/NotePicker';
import { getParentCandidates } from '../../lib/noteTree';
```

2. Add these props to `interface NoteModalProps` (after `cryptoKey?: CryptoKey | null;`):

```ts
  allNotes?: Note[];
  defaultParentId?: string | null;
  defaultCanvasOnly?: boolean;
```

and change the component's destructuring to:

```ts
export const NoteModal: React.FC<NoteModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  cryptoKey,
  allNotes = [],
  defaultParentId = null,
  defaultCanvasOnly = false,
}) => {
```

3. After `const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);`, add:

```ts
  const [parentNoteId, setParentNoteId] = useState<string | null>(null);
  const [canvasOnly, setCanvasOnly] = useState(false);
  const [isParentPickerOpen, setIsParentPickerOpen] = useState(false);
  const parentPickerRef = useRef<HTMLDivElement>(null);
```

4. After `const tomorrowStr = getTomorrowString();`, add:

```ts
  const isExistingNote = Boolean(initialData?.id);
  const initialParentId = isExistingNote ? initialData?.parent_note_id ?? null : defaultParentId;
  const initialCanvasOnly = isExistingNote ? Boolean(initialData?.canvas_only) : defaultCanvasOnly;
  // Hiding only sticks while the note has a parent or lives on a canvas (the server enforces this too).
  const canHide = Boolean(parentNoteId || initialData?.canvas_name || defaultCanvasOnly);
  const effectiveCanvasOnly = canHide && canvasOnly;
  const parentCandidates = useMemo(
    () => getParentCandidates(allNotes, initialData?.id ?? null),
    [allNotes, initialData],
  );
  const parentNote = parentNoteId ? allNotes.find((note) => note.id === parentNoteId) : undefined;
```

5. In the open-reset `useEffect` (the one that starts `if (isOpen) {`), add these after `setRecurrenceEndDate(initialData?.recurrence_end_date || null);`:

```ts
      setParentNoteId(initialData?.id ? initialData.parent_note_id ?? null : defaultParentId);
      setCanvasOnly(initialData?.id ? Boolean(initialData.canvas_only) : defaultCanvasOnly);
      setIsParentPickerOpen(false);
```

and change that effect's dependency array from `[isOpen, initialData]` to `[isOpen, initialData, defaultParentId, defaultCanvasOnly]`.

6. In `hasUnsavedChanges`, add these before the final `return false;`:

```ts
    if (parentNoteId !== initialParentId) return true;
    if (effectiveCanvasOnly !== initialCanvasOnly) return true;
```

and add `parentNoteId, effectiveCanvasOnly, initialParentId, initialCanvasOnly,` to its dependency array.

7. Add a click-outside effect for the picker directly after the existing "Click-outside listener for the scheduling popover" effect:

```ts
  useEffect(() => {
    if (!isParentPickerOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (parentPickerRef.current && !parentPickerRef.current.contains(e.target as Node)) {
        setIsParentPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isParentPickerOpen]);
```

8. In `handleSubmit`'s `onSave({ ... })`, add these after `recurrence_end_date: recurrenceEndDate,`:

```ts
      parent_note_id: parentNoteId,
      canvas_only: effectiveCanvasOnly,
```

- [ ] **Step 3: Add the two pills to the metadata strip**

In `NoteModal.tsx`, insert this JSX directly after the closing `</button>` of the Task toggle pill (the button with `className={`${styles.taskTogglePill} ...`}` and the `CheckSquare` icon), before `{scheduledDate ? (`:

```tsx
              <button
                type="button"
                className={`${styles.taskTogglePill} ${!effectiveCanvasOnly ? styles.taskTogglePillActive : ''}`}
                onClick={() => setCanvasOnly((prev) => !prev)}
                disabled={!canHide}
                title={
                  !canHide
                    ? 'Add a parent or place this note on a canvas to hide it from Grid & Calendar'
                    : effectiveCanvasOnly
                      ? 'Hidden from Grid & Calendar (click to show)'
                      : 'Shown in Grid & Calendar (click to hide)'
                }
              >
                {effectiveCanvasOnly ? (
                  <EyeOff size={13} className={styles.pillIcon} />
                ) : (
                  <Eye size={13} className={styles.pillIcon} />
                )}
                <span>{effectiveCanvasOnly ? 'Hidden from Grid' : 'Grid & Calendar'}</span>
              </button>

              <div className={styles.parentPillWrapper} ref={parentPickerRef}>
                <button
                  type="button"
                  className={`${styles.taskTogglePill} ${parentNoteId ? styles.parentPillActive : ''}`}
                  onClick={() => setIsParentPickerOpen((prev) => !prev)}
                  title="Group this note under another note"
                >
                  <CornerDownRight size={13} className={styles.pillIcon} />
                  <span className={styles.parentPillLabel}>
                    {parentNoteId ? parentNote?.title || 'Untitled' : 'Add parent'}
                  </span>
                </button>
                {parentNoteId && (
                  <button
                    type="button"
                    className={styles.parentClearBtn}
                    onClick={() => setParentNoteId(null)}
                    aria-label="Remove parent"
                    title="Remove parent"
                  >
                    <X size={12} />
                  </button>
                )}
                {isParentPickerOpen && (
                  <div className={styles.parentPickerPopover}>
                    <NotePicker
                      notes={parentCandidates}
                      placeholder="Search for a parent note…"
                      onPick={(note) => {
                        setParentNoteId(note.id);
                        setIsParentPickerOpen(false);
                      }}
                      onClose={() => setIsParentPickerOpen(false)}
                    />
                  </div>
                )}
              </div>
```

Append to `NoteModal.module.css`:

```css
.taskTogglePill:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.parentPillWrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

.parentPillActive {
  background: rgba(139, 92, 246, 0.08);
  color: var(--primary-purple);
  border-color: rgba(139, 92, 246, 0.4);
  font-weight: 600;
}

.parentPillLabel {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.parentClearBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 9999px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.parentClearBtn:hover {
  background: var(--surface-hover);
  color: var(--text-main);
}

.parentPickerPopover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 210;
}
```

- [ ] **Step 4: Pass notes into both NoteModal call sites**

In `App.tsx`, add `allNotes={notes}` to the `<NoteModal ... />` props (after `cryptoKey={cryptoKey}`).

In `CanvasView.tsx`, add these to its `<NoteModal ... />` props (after `cryptoKey={cryptoKey}`):

```tsx
        allNotes={notes}
        defaultCanvasOnly={true}
```

- [ ] **Step 5: Build, lint, and check in the browser**

Run (in `frontend/`): `npm run build`. Expected: `✓ built`.
Run: `npm run lint`. Expected: at most 39 errors. Then run `npx eslint src/components/NotePicker`. Expected: no output.

In the browser:
1. Open a top-level Grid note. The visibility pill reads "Grid & Calendar" and is disabled, with an explanatory tooltip.
2. Click "Add parent" and type part of a title. Only matching notes are listed, and the note itself and its descendants are absent. Pick one, then click Save Note. The note now shows a "↳ Parent" chip in the Grid.
3. Reopen it. The pill shows the parent's title, and the visibility pill is enabled. Toggle "Hidden from Grid" and save. The note disappears from the Grid.
4. Press Escape inside the picker search. Only the picker closes, and the note modal stays open.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/NotePicker/NotePicker.tsx frontend/src/components/NotePicker/NotePicker.module.css frontend/src/components/NoteModal/NoteModal.tsx frontend/src/components/NoteModal/NoteModal.module.css frontend/src/App.tsx frontend/src/components/CanvasView/CanvasView.tsx
git commit -m "feat(note-modal): parent picker and grid/calendar visibility toggle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Stream child markers (frontend)

**Files:**
- Create: `frontend/src/components/TimeStreamView/streamGrouping.ts`
- Create: `frontend/scripts/check-stream-grouping.ts`
- Modify: `frontend/src/components/TimeStreamView/TimeStreamCanvas.tsx`
- Modify: `frontend/src/components/TimeStreamView/TimeStreamView.tsx`
- Modify: `frontend/src/components/TimeStreamView/TimeStreamView.module.css` (append)

**Interfaces:**
- Consumes: the timestream `parent_note_id` field (Task 3)
- Produces:
  - `TimeStreamEvent.parent_note_id?: string | null`
  - `groupChildMarkers(events): { laneEvents: TimeStreamEvent[]; markersByParent: Map<string, TimeStreamEvent[]> }`
  - `TimeStreamCanvas` new required props: `markersByParent: Map<string, TimeStreamEvent[]>` and `onOpenEvent: (event: TimeStreamEvent) => void` (called for span bars)

- [ ] **Step 1: Write the failing grouping check script**

Create `frontend/scripts/check-stream-grouping.ts`:

```ts
// Run from frontend/: node scripts/check-stream-grouping.ts
import assert from 'node:assert/strict';
import { groupChildMarkers } from '../src/components/TimeStreamView/streamGrouping.ts';
import type { TimeStreamEvent } from '../src/components/TimeStreamView/TimeStreamCanvas.tsx';

function ev(id: string, start: string, end: string, extra: Partial<TimeStreamEvent> = {}): TimeStreamEvent {
  return {
    id,
    start_date: start,
    end_date: end,
    status: 'todo',
    canvas_name: null,
    is_span: start !== end,
    is_recurring: false,
    parent_note_id: null,
    note: { id } as TimeStreamEvent['note'],
    ...extra,
  };
}

const events = [
  ev('spanish', '2026-10-01', '2026-12-31'),
  ev('grammar', '2026-10-12', '2026-10-12', { parent_note_id: 'spanish' }),
  ev('outside', '2027-01-05', '2027-01-05', { parent_note_id: 'spanish' }),
  ev('podcast', '2026-11-01', '2026-11-20', { parent_note_id: 'spanish' }),
  ev('drill_2026-10-14', '2026-10-14', '2026-10-14', {
    parent_note_id: 'spanish',
    is_recurring: true,
    note: { id: 'drill' } as TimeStreamEvent['note'],
  }),
  ev('orphan', '2026-10-15', '2026-10-15', { parent_note_id: 'not-loaded' }),
  ev('solo', '2026-10-16', '2026-10-16'),
];

const { laneEvents, markersByParent } = groupChildMarkers(events);
assert.deepEqual(
  laneEvents.map((e) => e.id),
  ['spanish', 'outside', 'podcast', 'drill_2026-10-14', 'orphan', 'solo'],
);
assert.deepEqual([...markersByParent.keys()], ['spanish']);
assert.deepEqual(markersByParent.get('spanish')!.map((e) => e.id), ['grammar']);

// Edge dates are inside the span.
const edges = groupChildMarkers([
  ev('p', '2026-10-01', '2026-10-31'),
  ev('first', '2026-10-01', '2026-10-01', { parent_note_id: 'p' }),
  ev('last', '2026-10-31', '2026-10-31', { parent_note_id: 'p' }),
]);
assert.deepEqual(edges.markersByParent.get('p')!.map((e) => e.id), ['first', 'last']);

// A single-day parent is not a span, so its children keep their own lanes.
const flat = groupChildMarkers([
  ev('day', '2026-10-01', '2026-10-01'),
  ev('kid', '2026-10-01', '2026-10-01', { parent_note_id: 'day' }),
]);
assert.equal(flat.markersByParent.size, 0);
assert.equal(flat.laneEvents.length, 2);

console.log('stream grouping checks passed');
```

- [ ] **Step 2: Run it and confirm it fails**

Run (in `frontend/`): `node scripts/check-stream-grouping.ts`
Expected: `ERR_MODULE_NOT_FOUND` for `streamGrouping.ts`.

- [ ] **Step 3: Implement the grouping and the event field**

In `TimeStreamCanvas.tsx`, add `parent_note_id?: string | null;` to `export interface TimeStreamEvent` after `occurrence_id?: string | null;`.

Create `frontend/src/components/TimeStreamView/streamGrouping.ts`:

```ts
import type { TimeStreamEvent } from './TimeStreamCanvas';

export interface StreamGroups {
  /** Events that keep their own lane. */
  laneEvents: TimeStreamEvent[];
  /** Child events drawn as dots on their parent's bar, keyed by parent note id. */
  markersByParent: Map<string, TimeStreamEvent[]>;
}

/**
 * Pull single-day, non-recurring children that fall inside their parent's span
 * onto the parent's bar. Every other event keeps its own lane.
 */
export function groupChildMarkers(events: TimeStreamEvent[]): StreamGroups {
  const spansByNoteId = new Map<string, TimeStreamEvent>();
  for (const ev of events) {
    if (ev.is_span && !ev.is_recurring) spansByNoteId.set(ev.note.id, ev);
  }

  const laneEvents: TimeStreamEvent[] = [];
  const markersByParent = new Map<string, TimeStreamEvent[]>();
  for (const ev of events) {
    const parent = ev.parent_note_id ? spansByNoteId.get(ev.parent_note_id) : undefined;
    if (
      parent &&
      !ev.is_recurring &&
      !ev.is_span &&
      ev.start_date >= parent.start_date &&
      ev.start_date <= parent.end_date
    ) {
      const list = markersByParent.get(parent.note.id) ?? [];
      list.push(ev);
      markersByParent.set(parent.note.id, list);
    } else {
      laneEvents.push(ev);
    }
  }
  return { laneEvents, markersByParent };
}
```

- [ ] **Step 4: Run the check and confirm it passes**

Run (in `frontend/`): `node scripts/check-stream-grouping.ts`
Expected: `stream grouping checks passed`.

- [ ] **Step 5: Render markers and route span clicks in TimeStreamCanvas**

In `TimeStreamCanvas.tsx`:

1. Add these to `interface TimeStreamCanvasProps` (after `containerWidth: number;`):

```ts
  markersByParent: Map<string, TimeStreamEvent[]>;
  onOpenEvent: (event: TimeStreamEvent) => void;
```

and add `markersByParent,` and `onOpenEvent,` to the component's destructured props (after `containerWidth,`).

2. In the non-recurring bar (`className={styles.eventBar}`), replace its `onClick`:

```tsx
            onClick={(e) => {
              e.stopPropagation();
              onOpenNote(event.note);
            }}
```

with:

```tsx
            onClick={(e) => {
              e.stopPropagation();
              if (event.is_span) {
                onOpenEvent(event);
              } else {
                onOpenNote(event.note);
              }
            }}
```

3. Inside that same bar `<div>`, after the closing `</div>` of `styles.eventBarText`, add:

```tsx
            {(markersByParent.get(event.note.id) ?? []).map((child) => {
              const markerX = timeToX(new Date(child.start_date + 'T12:00:00')) - x;
              const isDone = child.status === 'done';
              const isInProgress = child.status === 'in_progress';
              return (
                <span
                  key={child.id}
                  className={`${styles.childMarker} ${
                    isDone
                      ? styles.childMarkerDone
                      : isInProgress
                        ? styles.childMarkerProgress
                        : styles.childMarkerTodo
                  }`}
                  style={{ left: `${markerX - 6}px` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenNote(child.note);
                  }}
                  onMouseEnter={(e) => handleEventMouseEnter(e, child)}
                  onMouseLeave={(e) => handleEventMouseEnter(e, event)}
                >
                  {isDone ? '✓' : null}
                </span>
              );
            })}
```

Append to `TimeStreamView.module.css`:

```css
.childMarker {
  position: absolute;
  top: 10px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: bold;
  color: white;
  cursor: pointer;
  z-index: 2;
  transition: transform 0.15s ease;
}

.childMarker:hover {
  transform: scale(1.35);
}

.childMarkerTodo {
  background: rgba(255, 255, 255, 0.25);
  border: 2px solid rgba(255, 255, 255, 0.95);
}

.childMarkerProgress {
  background: linear-gradient(90deg, #ffffff 50%, rgba(255, 255, 255, 0.25) 50%);
  border: 2px solid rgba(255, 255, 255, 0.95);
}

.childMarkerDone {
  background: #10b981;
  border: 1.5px solid #a7f3d0;
}
```

- [ ] **Step 6: Group in TimeStreamView before the zoom filter**

In `TimeStreamView.tsx`:

1. Change the React import to include `useMemo`:

```ts
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
```

and add the import after the `TimeStreamCanvas` import:

```ts
import { groupChildMarkers } from './streamGrouping';
```

2. Directly above `if (!cryptoKey) {` (hooks must run before that early return), add:

```ts
  // Group before the zoom filter so markers stay on a visible parent bar even
  // when single-day events are hidden at this zoom level.
  const { laneEvents, markersByParent } = useMemo(() => groupChildMarkers(events), [events]);
```

3. Change `const visibleEvents = events.filter((e) => {` to `const visibleEvents = laneEvents.filter((e) => {`.

4. Add these props to `<TimeStreamCanvas ... />` (after `containerWidth={containerWidth}`). Task 8 replaces the temporary `onOpenEvent`.

```tsx
        markersByParent={markersByParent}
        onOpenEvent={(event) => onOpenNote(event.note)}
```

- [ ] **Step 7: Build, lint, and check in the browser**

Run (in `frontend/`): `npm run build`. Expected: `✓ built`.
Run: `npm run lint`. Expected: at most 39 errors. Then run `npx eslint src/components/TimeStreamView/streamGrouping.ts scripts/check-stream-grouping.ts`. Expected: no output.

In the browser:
1. Create a multi-day note (e.g. 30 days from today) and a single-day note dated inside it, with its parent set to the multi-day note.
2. Schedule → Horizon. The child appears as a white dot on the parent's bar, not in its own lane.
3. Hover the dot. The tooltip shows the child's title.
4. Click the dot. The child note opens.
5. Zoom out to the Week scale. The dot is still on the bar.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/TimeStreamView/streamGrouping.ts frontend/scripts/check-stream-grouping.ts frontend/src/components/TimeStreamView/TimeStreamCanvas.tsx frontend/src/components/TimeStreamView/TimeStreamView.tsx frontend/src/components/TimeStreamView/TimeStreamView.module.css
git commit -m "feat(stream): show child notes as markers on their parent's bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Event panel with add/attach/detach (frontend)

**Files:**
- Create: `frontend/src/components/TimeStreamView/EventPanel.tsx`
- Create: `frontend/src/components/TimeStreamView/EventPanel.module.css`
- Modify: `frontend/src/components/TimeStreamView/TimeStreamView.tsx`
- Modify: `frontend/src/components/TimelineView/TimelineView.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes:
  - `getChildren`, `getAttachCandidates`, `sortByScheduleThenTitle` (Task 4)
  - `NotePicker` (Task 6)
  - `onOpenEvent` (Task 7)
  - `App.handleSetParent` (Task 4)
  - `NoteModal.defaultParentId` / `defaultCanvasOnly` (Task 6)
- Produces:
  - `<EventPanel event allNotes onClose onOpenNote onCreateChild(parentId) onSetParent(noteId, parentId|null) />`
  - `TimeStreamView` / `TimelineView` optional props `onCreateChild?: (parentId: string) => void` and `onSetParent?: (noteId: string, parentId: string | null) => void`
  - `App.openCreateChildModal(parentId: string)`

- [ ] **Step 1: Create EventPanel**

Create `frontend/src/components/TimeStreamView/EventPanel.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { Check, FileText, Link2, Plus, X } from 'lucide-react';
import type { Note } from '../NoteCard/NoteCard';
import { NotePicker } from '../NotePicker/NotePicker';
import { getAttachCandidates, getChildren, sortByScheduleThenTitle } from '../../lib/noteTree';
import type { TimeStreamEvent } from './TimeStreamCanvas';
import styles from './EventPanel.module.css';

interface EventPanelProps {
  event: TimeStreamEvent;
  allNotes: Note[];
  onClose: () => void;
  onOpenNote: (note: Note) => void;
  onCreateChild: (parentId: string) => void;
  onSetParent: (noteId: string, parentId: string | null) => void;
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

function formatShortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const EventPanel: React.FC<EventPanelProps> = ({
  event,
  allNotes,
  onClose,
  onOpenNote,
  onCreateChild,
  onSetParent,
}) => {
  const [isAttaching, setIsAttaching] = useState(false);

  // Prefer the live note from App so edits made while the panel is open show up.
  const eventNote = allNotes.find((note) => note.id === event.note.id) ?? event.note;
  const startDate = eventNote.scheduled_date ?? event.start_date;
  const endDate = eventNote.end_date ?? event.end_date;
  const status = eventNote.status ?? event.status;

  const children = useMemo(
    () => sortByScheduleThenTitle(getChildren(allNotes, eventNote.id)),
    [allNotes, eventNote.id],
  );
  const attachCandidates = useMemo(() => getAttachCandidates(allNotes, eventNote.id), [allNotes, eventNote.id]);
  const tracked = children.filter((child) => child.status);
  const doneCount = tracked.filter((child) => child.status === 'done').length;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <aside
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Event: ${eventNote.title || 'Untitled'}`}
      >
        <div className={styles.dragHandle} aria-hidden="true" />

        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 className={styles.title}>{eventNote.title || 'Untitled'}</h2>
            <p className={styles.meta}>
              {formatShortDate(startDate)} → {formatShortDate(endDate)} · {STATUS_LABELS[status] || 'To Do'}
            </p>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </header>

        <div className={styles.actionsRow}>
          <button type="button" className={styles.secondaryBtn} onClick={() => onOpenNote(eventNote)}>
            <FileText size={14} />
            Open note
          </button>
          {tracked.length > 0 && (
            <span className={styles.progressLabel}>
              {doneCount} / {tracked.length} done
            </span>
          )}
        </div>
        {tracked.length > 0 && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${(doneCount / tracked.length) * 100}%` }} />
          </div>
        )}

        <div className={styles.sectionLabel}>Notes in this event</div>
        {children.length === 0 ? (
          <p className={styles.empty}>No notes yet. Add one to start tracking this event.</p>
        ) : (
          <ul className={styles.childList}>
            {children.map((child) => (
              <li key={child.id} className={styles.childRow}>
                <button type="button" className={styles.childMain} onClick={() => onOpenNote(child)}>
                  <span
                    className={`${styles.statusIcon} ${
                      child.status ? styles[`status_${child.status}`] : styles.status_none
                    }`}
                  >
                    {child.status === 'done' ? <Check size={10} /> : null}
                  </span>
                  <span className={styles.childDate}>
                    {child.scheduled_date ? formatShortDate(child.scheduled_date) : '—'}
                  </span>
                  <span className={styles.childTitle}>{child.title || 'Untitled'}</span>
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => onSetParent(child.id, null)}
                  aria-label={`Remove ${child.title || 'Untitled'} from this event`}
                  title="Remove from this event"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.footer}>
          <button type="button" className={styles.primaryBtn} onClick={() => onCreateChild(eventNote.id)}>
            <Plus size={14} />
            New note
          </button>
          <div className={styles.attachWrapper}>
            <button type="button" className={styles.secondaryBtn} onClick={() => setIsAttaching((prev) => !prev)}>
              <Link2 size={14} />
              Attach
            </button>
            {isAttaching && (
              <div className={styles.attachPopover}>
                <NotePicker
                  notes={attachCandidates}
                  placeholder="Attach an existing note…"
                  onPick={(note) => {
                    onSetParent(note.id, eventNote.id);
                    setIsAttaching(false);
                  }}
                  onClose={() => setIsAttaching(false)}
                />
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};
```

Create `frontend/src/components/TimeStreamView/EventPanel.module.css`:

```css
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgba(17, 24, 39, 0.18);
}

.panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(380px, 100vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  background: var(--surface-color);
  border-left: 1px solid var(--surface-hover);
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
  overflow-y: auto;
  animation: slideIn 0.2s ease-out;
}

@keyframes slideIn {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.dragHandle {
  display: none;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.headerText {
  min-width: 0;
}

.title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-main);
  overflow-wrap: anywhere;
}

.meta {
  margin-top: 2px;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.iconBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.iconBtn:hover {
  background: var(--surface-hover);
  color: var(--text-main);
}

.actionsRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.progressLabel {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
}

.progressBar {
  height: 6px;
  border-radius: 9999px;
  background: var(--surface-hover);
  overflow: hidden;
}

.progressFill {
  height: 100%;
  border-radius: 9999px;
  background: #10b981;
  transition: width 0.2s ease;
}

.sectionLabel {
  margin-top: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.empty {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.childList {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.childRow {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
}

.childRow:hover {
  background: var(--surface-hover);
}

.childMain {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--text-main);
  font-size: 0.875rem;
}

.statusIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  color: white;
}

.status_none {
  border: 1.5px dashed var(--text-muted);
}

.status_todo {
  border: 2px solid var(--primary-purple);
}

.status_in_progress {
  border: 2px solid #f59e0b;
  background: linear-gradient(90deg, #f59e0b 50%, transparent 50%);
}

.status_done {
  background: #10b981;
}

.childDate {
  flex-shrink: 0;
  width: 48px;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.childTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer {
  margin-top: auto;
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--surface-hover);
}

.primaryBtn,
.secondaryBtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.primaryBtn {
  border: none;
  background: var(--primary-purple);
  color: white;
}

.primaryBtn:hover {
  background: var(--primary-purple-hover);
}

.secondaryBtn {
  border: 1px solid rgba(139, 92, 246, 0.25);
  background: transparent;
  color: var(--primary-purple);
}

.secondaryBtn:hover {
  background: rgba(139, 92, 246, 0.08);
}

.attachWrapper {
  position: relative;
}

.attachPopover {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 10;
}

@media (max-width: 600px) {
  .panel {
    top: auto;
    left: 0;
    width: 100%;
    max-height: 80vh;
    border-left: none;
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.15);
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
    animation: slideUp 0.2s ease-out;
  }

  .dragHandle {
    display: block;
    width: 36px;
    height: 4px;
    margin: -8px auto 0;
    border-radius: 9999px;
    background: var(--surface-hover);
  }

  .attachPopover {
    right: auto;
    left: 0;
  }
}

@keyframes slideUp {
  from {
    transform: translateY(24px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
```

- [ ] **Step 2: Open the panel from TimeStreamView**

In `TimeStreamView.tsx`:

1. Add the import after the `streamGrouping` import:

```ts
import { EventPanel } from './EventPanel';
```

2. Add these props to `interface TimeStreamViewProps` (after `hideControls?: boolean;`):

```ts
  onCreateChild?: (parentId: string) => void;
  onSetParent?: (noteId: string, parentId: string | null) => void;
```

and add `onCreateChild,` and `onSetParent,` to the destructured props (after `hideControls = false,`).

3. After `const [isLoading, setIsLoading] = useState<boolean>(false);`, add:

```ts
  const [openEvent, setOpenEvent] = useState<TimeStreamEvent | null>(null);
```

4. Replace the temporary `onOpenEvent={(event) => onOpenNote(event.note)}` prop on `<TimeStreamCanvas>` with:

```tsx
        onOpenEvent={(event) => (onCreateChild && onSetParent ? setOpenEvent(event) : onOpenNote(event.note))}
```

5. Directly after the closing `/>` of `<TimeStreamCanvas ... />` (still inside the outer container `<div>`), add:

```tsx
      {openEvent && onCreateChild && onSetParent && (
        <EventPanel
          event={openEvent}
          allNotes={notes}
          onClose={() => setOpenEvent(null)}
          onOpenNote={onOpenNote}
          onCreateChild={onCreateChild}
          onSetParent={onSetParent}
        />
      )}
```

- [ ] **Step 3: Pass the callbacks through TimelineView**

In `TimelineView.tsx`, add these to `interface TimelineViewProps` (after `showCompleted?: boolean;`):

```ts
  onCreateChild?: (parentId: string) => void;
  onSetParent?: (noteId: string, parentId: string | null) => void;
```

Add `onCreateChild` and `onSetParent` to the component's destructured props, then add these to the `<TimeStreamView ... />` element (after `showCompleted={showCompleted}`):

```tsx
            onCreateChild={onCreateChild}
            onSetParent={onSetParent}
```

- [ ] **Step 4: Wire child creation in App**

In `App.tsx`:

1. After `const [recurrenceNote, setRecurrenceNote] = useState<Note | null>(null);`, add:

```ts
  const [childParentId, setChildParentId] = useState<string | null>(null);
```

2. Add `setChildParentId(null);` as the first line inside each of `openCreateModal`, `openEditModal`, and `openViewModal`.

3. Add this after `openViewModal`:

```ts
  const openCreateChildModal = (parentId: string) => {
    setEditingNote(null);
    setChildParentId(parentId);
    setIsViewMode(false);
    setIsModalOpen(true);
  };
```

4. Add these props to `<NoteModal ... />` (after `allNotes={notes}`). A new child of an event lives inside the event, so it starts hidden from the Grid.

```tsx
        defaultParentId={childParentId}
        defaultCanvasOnly={childParentId !== null}
```

5. Change the `<TimelineView ... />` element to:

```tsx
        <TimelineView
          onOpenNote={openViewModal}
          notes={notes}
          fetchNotes={fetchNotes}
          cryptoKey={cryptoKey}
          showCompleted={showCompleted}
          onCreateChild={openCreateChildModal}
          onSetParent={handleSetParent}
        />
```

- [ ] **Step 5: Build, lint, and check in the browser**

Run (in `frontend/`): `npm run build`. Expected: `✓ built`.
Run: `npm run lint`. Expected: at most 39 errors. Then run `npx eslint src/components/TimeStreamView/EventPanel.tsx`. Expected: no output.

In the browser, Schedule → Horizon:
1. Click a multi-day bar. The panel slides in from the right, showing the title, the date range, and "Notes in this event". Single-day bars still open the note directly.
2. Click "New note", type a title, give it a date inside the span, and save. The note appears in the panel list. A dot appears on the bar. The note is **not** in the Grid. Its visibility pill showed "Hidden from Grid".
3. Click "Attach", pick an existing Grid note. It appears in the list. It stays in the Grid, because attaching doesn't change visibility.
4. Mark a child as done (open it, then set the status). The progress line reads "1 / N done" and the dot turns green.
5. Click × on a child row. It leaves the list. If it was hidden, it reappears in the Grid.
6. Narrow the window to under 600px. The panel becomes a bottom sheet.
7. With the panel open, click "Open note". The note modal opens above the panel.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/TimeStreamView/EventPanel.tsx frontend/src/components/TimeStreamView/EventPanel.module.css frontend/src/components/TimeStreamView/TimeStreamView.tsx frontend/src/components/TimelineView/TimelineView.tsx frontend/src/App.tsx
git commit -m "feat(stream): event panel to add, attach, and detach notes in a long-running event

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end verification

**Files:** none (fix-ups only, if a check fails)

- [ ] **Step 1: All automated checks**

From the repo root:

```bash
docker compose exec backend python -m scripts.check_hierarchy
cd frontend && node scripts/check-note-tree.ts && node scripts/check-stream-grouping.ts && npm run build && npm run lint
```

Expected:
- `16/16 checks passed`
- `note tree checks passed`
- `stream grouping checks passed`
- `✓ built`
- lint shows at most 39 errors and 2 warnings

- [ ] **Step 2: Migration is stable across restarts**

```bash
docker compose restart backend
docker compose logs --tail=20 backend
docker compose exec -T db psql -U vault_user -d vault_db -c "select count(*) filter (where parent_note_id is not null) as with_parent, count(*) filter (where canvas_only) as canvas_only from notes;"
```

Expected: no traceback, and the counts are unchanged from Task 2 Step 7, apart from notes you created or edited while testing.

- [ ] **Step 3: Calendar hides canvas-only notes**

In Schedule → Day/Week, navigate to a date with a hidden child (from Task 8). Expected: the child is absent, while its visible parent span is present. In Horizon the child is a dot on the parent's bar.

- [ ] **Step 4: Deleting a parent leaves its children visible**

Delete the event note used in Task 8 from the Grid or the note modal. Expected: its formerly hidden children appear in the Grid with no parent chip.

- [ ] **Step 5: Review Focus manual checks**

1. **Edit without touching the parent.** Open a child note and change only its title, then save. In DevTools → Network, there is a `PUT /notes/{id}` and **no** `PUT /api/notes/{id}/parent`. The parent chip is still there.
2. **Canvas node failure leaves the note visible.** In DevTools, block the request URL pattern `*/api/canvases/*/nodes/`. Then add a note on the canvas with "Add Note". Expected: the node call fails, and the note appears in the Grid (not hidden). Unblock afterwards and delete the test note.

- [ ] **Step 6: Report**

Summarize which checks passed, any fix-ups made (each committed separately with a `fix:` message), and anything that failed. Fix-ups use the same commit trailer as above.
