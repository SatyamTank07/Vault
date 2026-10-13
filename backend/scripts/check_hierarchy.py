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
