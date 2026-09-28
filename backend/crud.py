import os
import re
from datetime import date, timedelta

from sqlalchemy.orm import Session, joinedload

import models
import schemas

UPLOAD_DIR = "uploads"
UPLOAD_URL_PATTERN = re.compile(
    r'(?:https?://[^"\']+)?/(?:api/uploads|uploads)/([a-zA-Z0-9-]+)/([a-zA-Z0-9._-]+)(?:\?[^"\']*)?'
)


def extract_image_refs(content: str):
    if not content:
        return []
    return UPLOAD_URL_PATTERN.findall(content)


def _upload_candidate_paths(user_id: str | None, note_id: str, filename: str) -> list[str]:
    paths = []
    if user_id:
        paths.append(os.path.join(UPLOAD_DIR, user_id, note_id, filename))
    paths.append(os.path.join(UPLOAD_DIR, note_id, filename))
    return paths


def _cleanup_empty_directories(path: str) -> None:
    current_path = os.path.dirname(path)
    for _ in range(2):
        if os.path.exists(current_path) and os.path.isdir(current_path) and not os.listdir(current_path):
            os.rmdir(current_path)
            current_path = os.path.dirname(current_path)


def delete_unused_images(image_refs: list[tuple[str, str]], user_id: str | None):
    for note_id, filename in image_refs:
        for file_path in _upload_candidate_paths(user_id, note_id, filename):
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    _cleanup_empty_directories(file_path)
                except Exception as exc:
                    print(f"Error during cleanup of {file_path}: {exc}")


def get_note(db: Session, user_id: str, note_id: str):
    return (
        db.query(models.Note)
        .options(joinedload(models.Note.canvas_nodes).joinedload(models.CanvasNode.canvas))
        .filter(models.Note.id == note_id, models.Note.user_id == user_id)
        .first()
    )


def get_notes(db: Session, user_id: str, skip: int = 0, limit: int = 100):
    return (
        db.query(models.Note)
        .options(joinedload(models.Note.canvas_nodes).joinedload(models.CanvasNode.canvas))
        .filter(models.Note.user_id == user_id)
        .offset(skip)
        .limit(limit)
        .all()
    )


def create_note(db: Session, user_id: str, note: schemas.NoteCreate):
    scheduled_date = note.scheduled_date
    scheduled_time = note.scheduled_time if scheduled_date else None
    end_date = note.end_date if scheduled_date else None
    if scheduled_date and end_date and scheduled_date > end_date:
        end_date = scheduled_date

    db_note = models.Note(
        user_id=user_id,
        id=note.id if note.id else None,
        title=note.title,
        content=note.content,
        scheduled_date=scheduled_date,
        scheduled_time=scheduled_time,
        end_date=end_date,
        status=note.status or "todo",
        recurrence_rule=note.recurrence_rule,
        recurrence_interval=note.recurrence_interval if note.recurrence_interval is not None else 1,
        recurrence_end_date=note.recurrence_end_date,
    )
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note


def update_note(db: Session, user_id: str, note_id: str, note: schemas.NoteUpdate):
    db_note = get_note(db, user_id, note_id)
    if db_note:
        if note.content is not None:
            old_refs = set(extract_image_refs(db_note.content))
            new_refs = set(extract_image_refs(note.content))
            delete_unused_images(list(old_refs - new_refs), db_note.user_id)

        update_data = note.dict(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_note, key, value)

        if not db_note.scheduled_date:
            db_note.scheduled_time = None
            db_note.end_date = None
        elif db_note.end_date and db_note.scheduled_date > db_note.end_date:
            db_note.end_date = db_note.scheduled_date

        db.commit()
        db.refresh(db_note)
    return db_note


def delete_note(db: Session, user_id: str, note_id: str):
    db_note = get_note(db, user_id, note_id)
    if db_note:
        import shutil

        for note_folder in [
            os.path.join(UPLOAD_DIR, user_id, note_id),
            os.path.join(UPLOAD_DIR, note_id),
        ]:
            if os.path.exists(note_folder):
                try:
                    shutil.rmtree(note_folder)
                except Exception as exc:
                    print(f"Error deleting folder {note_folder}: {exc}")

        db.delete(db_note)
        db.commit()
        return True
    return False


def get_canvases(db: Session, user_id: str):
    return (
        db.query(models.Canvas)
        .filter(models.Canvas.user_id == user_id)
        .order_by(models.Canvas.created_at.desc())
        .all()
    )


def get_canvas(db: Session, user_id: str, canvas_id: str):
    return (
        db.query(models.Canvas)
        .options(joinedload(models.Canvas.nodes).joinedload(models.CanvasNode.note))
        .filter(models.Canvas.id == canvas_id, models.Canvas.user_id == user_id)
        .first()
    )


def create_canvas(db: Session, user_id: str, canvas: schemas.CanvasCreate):
    db_canvas = models.Canvas(name=canvas.name, user_id=user_id)
    db.add(db_canvas)
    db.commit()
    db.refresh(db_canvas)
    return db_canvas


def update_canvas(db: Session, user_id: str, canvas_id: str, canvas: schemas.CanvasUpdate):
    db_canvas = (
        db.query(models.Canvas)
        .filter(models.Canvas.id == canvas_id, models.Canvas.user_id == user_id)
        .first()
    )
    if db_canvas:
        if canvas.name is not None:
            db_canvas.name = canvas.name
        db.commit()
        db.refresh(db_canvas)
    return db_canvas


def delete_canvas(db: Session, user_id: str, canvas_id: str):
    db_canvas = (
        db.query(models.Canvas)
        .options(joinedload(models.Canvas.nodes))
        .filter(models.Canvas.id == canvas_id, models.Canvas.user_id == user_id)
        .first()
    )
    if db_canvas:
        note_ids_to_delete = [node.note_id for node in db_canvas.nodes]
        db.delete(db_canvas)
        db.commit()

        for note_id in set(note_ids_to_delete):
            delete_note(db, user_id, note_id)

        return True
    return False


def create_canvas_node(db: Session, user_id: str, canvas_id: str, data: schemas.CanvasNodeCreate):
    canvas = get_canvas(db, user_id, canvas_id)
    if not canvas:
        return None

    note_id = data.note_id
    if not note_id:
        new_note = models.Note(title=data.title or "Untitled", user_id=user_id)
        db.add(new_note)
        db.flush()
        note_id = new_note.id
    else:
        note = get_note(db, user_id, note_id)
        if not note:
            return None

    if data.parent_node_id:
        parent = (
            db.query(models.CanvasNode)
            .join(models.Canvas, models.CanvasNode.canvas_id == models.Canvas.id)
            .filter(
                models.CanvasNode.id == data.parent_node_id,
                models.Canvas.id == canvas_id,
                models.Canvas.user_id == user_id,
            )
            .first()
        )
        if not parent:
            return None

    db_node = models.CanvasNode(
        canvas_id=canvas_id,
        note_id=note_id,
        parent_node_id=data.parent_node_id,
        position_x=data.position_x,
        position_y=data.position_y,
    )
    db.add(db_node)
    db.commit()
    db.refresh(db_node)
    db.refresh(db_node, ["note"])
    return db_node


def update_canvas_node(db: Session, user_id: str, node_id: str, data: schemas.CanvasNodeUpdate):
    db_node = (
        db.query(models.CanvasNode)
        .join(models.Canvas, models.CanvasNode.canvas_id == models.Canvas.id)
        .filter(models.CanvasNode.id == node_id, models.Canvas.user_id == user_id)
        .first()
    )
    if db_node:
        if data.parent_node_id is not None:
            parent = (
                db.query(models.CanvasNode)
                .join(models.Canvas, models.CanvasNode.canvas_id == models.Canvas.id)
                .filter(
                    models.CanvasNode.id == data.parent_node_id,
                    models.Canvas.user_id == user_id,
                    models.CanvasNode.canvas_id == db_node.canvas_id,
                )
                .first()
            )
            if parent is None:
                return None

        if data.position_x is not None:
            db_node.position_x = data.position_x
        if data.position_y is not None:
            db_node.position_y = data.position_y
        if data.clear_parent:
            db_node.parent_node_id = None
        elif data.parent_node_id is not None:
            db_node.parent_node_id = data.parent_node_id

        db.commit()
        db.refresh(db_node)
    return db_node


def update_note_schedule(db: Session, user_id: str, note_id: str, data: schemas.NoteScheduleUpdate):
    db_note = get_note(db, user_id, note_id)
    if not db_note:
        return None

    if data.scheduled_date is not None:
        db_note.scheduled_date = data.scheduled_date
    if data.clear_date:
        db_note.scheduled_date = None
    if data.scheduled_time is not None:
        db_note.scheduled_time = data.scheduled_time
    if data.clear_time:
        db_note.scheduled_time = None
    if data.end_date is not None:
        db_note.end_date = data.end_date
    if data.clear_end_date:
        db_note.end_date = None
    if data.status:
        db_note.status = data.status

    db.commit()
    db.refresh(db_note)
    return db_note


def delete_canvas_node(db: Session, user_id: str, node_id: str):
    db_node = (
        db.query(models.CanvasNode)
        .join(models.Canvas, models.CanvasNode.canvas_id == models.Canvas.id)
        .filter(models.CanvasNode.id == node_id, models.Canvas.user_id == user_id)
        .first()
    )
    if db_node:
        db.delete(db_node)
        db.commit()
        return True
    return False


def create_branch(db: Session, user_id: str, canvas_id: str, parent_node_id: str, data: schemas.BranchCreate):
    parent = (
        db.query(models.CanvasNode)
        .join(models.Canvas, models.CanvasNode.canvas_id == models.Canvas.id)
        .filter(
            models.CanvasNode.id == parent_node_id,
            models.CanvasNode.canvas_id == canvas_id,
            models.Canvas.user_id == user_id,
        )
        .first()
    )
    if not parent:
        return None

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
    db.add(db_node)
    db.commit()
    db.refresh(db_node)
    db.refresh(db_node, ["note"])
    return db_node


def _add_months(source_date: date, months: int) -> date:
    month = source_date.month - 1 + months
    year = source_date.year + month // 12
    month = month % 12 + 1
    import calendar

    day = min(source_date.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def expand_recurrence(note, start_date: date, end_date: date) -> list[date]:
    if not note.recurrence_rule or not note.scheduled_date:
        return []

    dates = []
    current = note.scheduled_date
    interval = note.recurrence_interval or 1
    rule = note.recurrence_rule

    while current <= end_date:
        if note.recurrence_end_date and current > note.recurrence_end_date:
            break

        if current >= start_date:
            dates.append(current)

        if rule == "daily":
            current += timedelta(days=interval)
        elif rule == "weekly":
            current += timedelta(weeks=interval)
        elif rule == "monthly":
            current = _add_months(current, interval)
        else:
            break

    return dates


def ensure_occurrences(db: Session, note, dates: list[date]) -> list:
    if not dates:
        return []

    existing = (
        db.query(models.TaskOccurrence)
        .filter(
            models.TaskOccurrence.note_id == note.id,
            models.TaskOccurrence.occurrence_date.in_(dates),
        )
        .all()
    )
    existing_dates = {occ.occurrence_date for occ in existing}

    new_occs = []
    for occurrence_date in dates:
        if occurrence_date not in existing_dates:
            occ = models.TaskOccurrence(note_id=note.id, occurrence_date=occurrence_date)
            db.add(occ)
            new_occs.append(occ)

    if new_occs:
        db.commit()
        for occ in new_occs:
            db.refresh(occ)

    return existing + new_occs


def get_timeline(db: Session, user_id: str, start_date: date, end_date: date):
    one_off_notes = (
        db.query(models.Note)
        .options(joinedload(models.Note.canvas_nodes).joinedload(models.CanvasNode.canvas))
        .filter(
            models.Note.user_id == user_id,
            models.Note.scheduled_date >= start_date,
            models.Note.scheduled_date <= end_date,
            models.Note.recurrence_rule == None,
        )
        .order_by(models.Note.scheduled_date)
        .all()
    )

    recurring_notes = (
        db.query(models.Note)
        .options(joinedload(models.Note.canvas_nodes).joinedload(models.CanvasNode.canvas))
        .filter(
            models.Note.user_id == user_id,
            models.Note.recurrence_rule != None,
            models.Note.scheduled_date <= end_date,
        )
        .all()
    )
    recurring_notes = [
        note
        for note in recurring_notes
        if note.recurrence_end_date is None or note.recurrence_end_date >= start_date
    ]

    result: dict[str, list] = {}

    for note in one_off_notes:
        date_key = note.scheduled_date.isoformat()
        result.setdefault(date_key, [])
        canvas_id = note.canvas_nodes[0].canvas_id if note.canvas_nodes else ""
        result[date_key].append(
            {
                "id": note.id,
                "canvas_id": canvas_id,
                "canvas_name": note.canvas_name,
                "note": {
                    "id": note.id,
                    "title": note.title,
                    "content": note.content,
                    "created_at": note.created_at.isoformat() if note.created_at else None,
                    "updated_at": note.updated_at.isoformat() if note.updated_at else None,
                    "scheduled_time": note.scheduled_time,
                },
                "scheduled_date": note.scheduled_date.isoformat(),
                "scheduled_time": note.scheduled_time,
                "status": note.status or "todo",
                "is_recurring": False,
                "occurrence_id": None,
                "recurrence_rule": None,
            }
        )

    for note in recurring_notes:
        occurrence_dates = expand_recurrence(note, start_date, end_date)
        occurrences = ensure_occurrences(db, note, occurrence_dates)
        canvas_id = note.canvas_nodes[0].canvas_id if note.canvas_nodes else ""

        for occ in occurrences:
            if occ.skipped:
                continue

            date_key = occ.occurrence_date.isoformat()
            result.setdefault(date_key, [])
            result[date_key].append(
                {
                    "id": note.id,
                    "canvas_id": canvas_id,
                    "canvas_name": note.canvas_name,
                    "note": {
                        "id": note.id,
                        "title": note.title,
                        "content": note.content,
                        "created_at": note.created_at.isoformat() if note.created_at else None,
                        "updated_at": note.updated_at.isoformat() if note.updated_at else None,
                        "scheduled_time": note.scheduled_time,
                    },
                    "scheduled_date": occ.occurrence_date.isoformat(),
                    "scheduled_time": note.scheduled_time,
                    "status": occ.status or "todo",
                    "is_recurring": True,
                    "occurrence_id": occ.id,
                    "recurrence_rule": note.recurrence_rule,
                }
            )

    for date_key in result:
        result[date_key].sort(key=lambda x: x["scheduled_time"] or "23:59")

    return result


def get_timestream(db: Session, user_id: str, start_date: date, end_date: date):
    """Get all notes that overlap the given date range for the Time Stream view.
    An event overlaps if its [scheduled_date, note.end_date] range intersects [start_date, end_date].
    Events without end_date are treated as single-day events.
    """
    from sqlalchemy import or_, and_

    notes = (
        db.query(models.Note)
        .options(joinedload(models.Note.canvas_nodes).joinedload(models.CanvasNode.canvas))
        .filter(
            models.Note.user_id == user_id,
            models.Note.scheduled_date != None,
            or_(
                # Single-day events (no end_date): scheduled_date falls within range
                and_(
                    models.Note.end_date == None,
                    models.Note.scheduled_date >= start_date,
                    models.Note.scheduled_date <= end_date,
                ),
                # Multi-day events: their [scheduled_date, end_date] overlaps [start_date, end_date]
                and_(
                    models.Note.end_date != None,
                    models.Note.scheduled_date <= end_date,
                    models.Note.end_date >= start_date,
                ),
            ),
        )
        .all()
    )

    result = []
    for note in notes:
        event_start = note.scheduled_date
        event_end = note.end_date if note.end_date else note.scheduled_date

        result.append({
            "id": note.id,
            "note": {
                "id": note.id,
                "title": note.title,
                "content": note.content,
                "created_at": note.created_at.isoformat() if note.created_at else None,
                "updated_at": note.updated_at.isoformat() if note.updated_at else None,
                "scheduled_date": note.scheduled_date.isoformat() if note.scheduled_date else None,
                "scheduled_time": note.scheduled_time,
                "status": note.status or "todo",
                "canvas_name": note.canvas_name,
                "recurrence_rule": note.recurrence_rule,
                "recurrence_interval": note.recurrence_interval,
                "recurrence_end_date": note.recurrence_end_date.isoformat() if note.recurrence_end_date else None,
                "end_date": note.end_date.isoformat() if note.end_date else None,
            },
            "start_date": event_start.isoformat(),
            "end_date": event_end.isoformat(),
            "status": note.status or "todo",
            "canvas_name": note.canvas_name,
        })

    # Sort by start_date, then by duration (longer events first for better visual stacking)
    result.sort(key=lambda x: (x["start_date"], x["start_date"] == x["end_date"]))
    return result


def update_recurrence(db: Session, user_id: str, note_id: str, data: schemas.RecurrenceUpdate):
    db_note = get_note(db, user_id, note_id)
    if not db_note:
        return None

    if data.clear_recurrence:
        db_note.recurrence_rule = None
        db_note.recurrence_interval = 1
        db_note.recurrence_end_date = None
        from datetime import date as date_type

        db.query(models.TaskOccurrence).filter(
            models.TaskOccurrence.note_id == note_id,
            models.TaskOccurrence.occurrence_date >= date_type.today(),
        ).delete(synchronize_session=False)
    else:
        if data.recurrence_rule is not None:
            db_note.recurrence_rule = data.recurrence_rule
        if data.recurrence_interval is not None:
            db_note.recurrence_interval = data.recurrence_interval
        if data.clear_end_date:
            db_note.recurrence_end_date = None
        elif data.recurrence_end_date is not None:
            db_note.recurrence_end_date = data.recurrence_end_date

    db.commit()
    db.refresh(db_note)
    return db_note


def update_occurrence_status(db: Session, user_id: str, occurrence_id: str, data: schemas.OccurrenceStatusUpdate):
    occ = (
        db.query(models.TaskOccurrence)
        .join(models.Note, models.TaskOccurrence.note_id == models.Note.id)
        .filter(models.TaskOccurrence.id == occurrence_id, models.Note.user_id == user_id)
        .first()
    )
    if not occ:
        return None

    occ.status = data.status
    if data.skipped is not None:
        occ.skipped = data.skipped

    db.commit()
    db.refresh(occ)
    return occ


def create_feedback(db: Session, user_id: str, feedback: schemas.FeedbackCreate):
    title = feedback.title.strip() if feedback.title else None
    content = feedback.content.strip() if feedback.content else None

    # If title and content are both the same, strip title so it does not duplicate
    if title and content and title.casefold() == content.casefold():
        title = None

    db_feedback = models.Feedback(
        user_id=user_id,
        title=title,
        content=content,
    )
    db.add(db_feedback)
    db.commit()
    db.refresh(db_feedback)
    return db_feedback


def delete_user(db: Session, user_id: str) -> bool:
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        return False

    import shutil

    user_upload_folder = os.path.join(UPLOAD_DIR, user_id)
    if os.path.exists(user_upload_folder):
        try:
            shutil.rmtree(user_upload_folder)
        except Exception as exc:
            print(f"Error deleting user upload folder {user_upload_folder}: {exc}")

    db.delete(user)
    db.commit()
    return True
