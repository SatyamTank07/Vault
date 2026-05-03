from sqlalchemy.orm import Session, joinedload
from datetime import datetime, date, timedelta
import models
import schemas
import re
import os

UPLOAD_DIR = "uploads"

def extract_image_urls(content: str):
    if not content:
        return []
    # Find all /uploads/{note_id}/{filename} patterns
    return re.findall(r'/uploads/[a-zA-Z0-9-]+/[a-zA-Z0-9.-]+', content)

def delete_unused_images(urls: list):
    for url in urls:
        # url is /uploads/{note_id}/{filename}
        parts = url.split('/')
        if len(parts) >= 4:
            note_id = parts[2]
            filename = parts[3]
            note_folder = os.path.join(UPLOAD_DIR, note_id)
            file_path = os.path.join(note_folder, filename)
            
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    
                    # If the folder is now empty, delete the folder itself
                    if os.path.exists(note_folder) and not os.listdir(note_folder):
                        os.rmdir(note_folder)
                except Exception as e:
                    print(f"Error during cleanup of {file_path}: {e}")

def get_note(db: Session, note_id: str):
    return db.query(models.Note).options(joinedload(models.Note.canvas_nodes).joinedload(models.CanvasNode.canvas)).filter(models.Note.id == note_id).first()

def get_notes(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Note).options(joinedload(models.Note.canvas_nodes).joinedload(models.CanvasNode.canvas)).offset(skip).limit(limit).all()

def create_note(db: Session, note: schemas.NoteCreate):
    db_note = models.Note(
        id=note.id if note.id else None, 
        title=note.title, 
        content=note.content
    )
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note

def update_note(db: Session, note_id: str, note: schemas.NoteUpdate):
    db_note = get_note(db, note_id)
    if db_note:
        # Cleanup images if they were removed
        if note.content is not None:
            old_urls = set(extract_image_urls(db_note.content))
            new_urls = set(extract_image_urls(note.content))
            removed_urls = old_urls - new_urls
            delete_unused_images(list(removed_urls))

        update_data = note.dict(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_note, key, value)
        
        db.commit()
        db.refresh(db_note)
    return db_note

def delete_note(db: Session, note_id: str):
    db_note = get_note(db, note_id)
    if db_note:
        # Delete the entire folder for this note
        note_folder = os.path.join(UPLOAD_DIR, note_id)
        if os.path.exists(note_folder):
            import shutil
            try:
                shutil.rmtree(note_folder)
            except Exception as e:
                print(f"Error deleting folder {note_folder}: {e}")
        
        db.delete(db_note)
        db.commit()
        return True
    return False


# ── Canvas CRUD ─────────────────────────────────────────────

def get_canvases(db: Session):
    """List all canvases (lightweight, no nodes)."""
    return db.query(models.Canvas).order_by(models.Canvas.created_at.desc()).all()

def get_canvas(db: Session, canvas_id: str):
    """Get a canvas with all its nodes and their notes (eager-loaded)."""
    return (
        db.query(models.Canvas)
        .options(joinedload(models.Canvas.nodes).joinedload(models.CanvasNode.note))
        .filter(models.Canvas.id == canvas_id)
        .first()
    )

def create_canvas(db: Session, canvas: schemas.CanvasCreate):
    db_canvas = models.Canvas(name=canvas.name)
    db.add(db_canvas)
    db.commit()
    db.refresh(db_canvas)
    return db_canvas

def update_canvas(db: Session, canvas_id: str, canvas: schemas.CanvasUpdate):
    db_canvas = db.query(models.Canvas).filter(models.Canvas.id == canvas_id).first()
    if db_canvas:
        if canvas.name is not None:
            db_canvas.name = canvas.name
        db.commit()
        db.refresh(db_canvas)
    return db_canvas

def delete_canvas(db: Session, canvas_id: str):
    db_canvas = db.query(models.Canvas).filter(models.Canvas.id == canvas_id).first()
    if db_canvas:
        # Collect note IDs before deleting the canvas
        note_ids_to_delete = [node.note_id for node in db_canvas.nodes]
        
        # This will cascade and delete the CanvasNode rows
        db.delete(db_canvas)
        db.commit()
        
        # Completely delete all associated notes and their image folders
        for note_id in set(note_ids_to_delete):
            delete_note(db, note_id)
            
        return True
    return False


# ── Canvas Node CRUD ────────────────────────────────────────

def create_canvas_node(db: Session, canvas_id: str, data: schemas.CanvasNodeCreate):
    """Add a note to a canvas. If note_id is None and title is given, create a new note first."""
    note_id = data.note_id

    if not note_id:
        # Create a new note inline
        new_note = models.Note(title=data.title or "Untitled")
        db.add(new_note)
        db.flush()  # get the id without committing
        note_id = new_note.id

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
    # Eager-load the note relationship for the response
    db.refresh(db_node, ["note"])
    return db_node

def update_canvas_node(db: Session, node_id: str, data: schemas.CanvasNodeUpdate):
    db_node = db.query(models.CanvasNode).filter(models.CanvasNode.id == node_id).first()
    if db_node:
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

def update_note_schedule(db: Session, note_id: str, data: schemas.NoteScheduleUpdate):
    db_note = get_note(db, note_id)
    if not db_note:
        return None
    
    if data.scheduled_date is not None:
        db_note.scheduled_date = data.scheduled_date
    if data.clear_date:
        db_note.scheduled_date = None
    if data.status:
        db_note.status = data.status
        
    db.commit()
    db.refresh(db_note)
    return db_note

def delete_canvas_node(db: Session, node_id: str):
    db_node = db.query(models.CanvasNode).filter(models.CanvasNode.id == node_id).first()
    if db_node:
        db.delete(db_node)
        db.commit()
        return True
    return False

def create_branch(db: Session, canvas_id: str, parent_node_id: str, data: schemas.BranchCreate):
    """Convenience: create a new note AND place it as a child of parent_node_id on the canvas."""
    # Verify parent node exists
    parent = db.query(models.CanvasNode).filter(models.CanvasNode.id == parent_node_id).first()
    if not parent:
        return None

    # Create the note
    new_note = models.Note(title=data.title)
    db.add(new_note)
    db.flush()

    # Place on canvas as child — position relative to parent
    # (frontend will auto-layout, these are just defaults)
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


# ── Timeline CRUD ───────────────────────────────────────────

def _add_months(source_date: date, months: int) -> date:
    """Add N months to a date, clamping to last day of month if needed."""
    month = source_date.month - 1 + months
    year = source_date.year + month // 12
    month = month % 12 + 1
    import calendar
    day = min(source_date.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)

def expand_recurrence(note, start_date: date, end_date: date) -> list[date]:
    """Generate all occurrence dates for a recurring note within a date range."""
    if not note.recurrence_rule or not note.scheduled_date:
        return []
    
    dates = []
    current = note.scheduled_date
    interval = note.recurrence_interval or 1
    rule = note.recurrence_rule
    
    # Don't generate dates before the recurrence start
    # but we need to iterate from the start to maintain correct intervals
    while current <= end_date:
        # Check against recurrence end date
        if note.recurrence_end_date and current > note.recurrence_end_date:
            break
        
        if current >= start_date:
            dates.append(current)
        
        # Advance based on rule
        if rule == "daily":
            current += timedelta(days=interval)
        elif rule == "weekly":
            current += timedelta(weeks=interval)
        elif rule == "monthly":
            current = _add_months(current, interval)
        else:
            break  # unknown rule, stop
    
    return dates

def ensure_occurrences(db: Session, note, dates: list[date]) -> list:
    """Lazy-materialize occurrence rows for the given dates. Returns all occurrences."""
    if not dates:
        return []
    
    # Fetch existing occurrences for these dates
    existing = (
        db.query(models.TaskOccurrence)
        .filter(
            models.TaskOccurrence.note_id == note.id,
            models.TaskOccurrence.occurrence_date.in_(dates),
        )
        .all()
    )
    existing_dates = {occ.occurrence_date for occ in existing}
    
    # Create missing occurrences
    new_occs = []
    for d in dates:
        if d not in existing_dates:
            occ = models.TaskOccurrence(note_id=note.id, occurrence_date=d)
            db.add(occ)
            new_occs.append(occ)
    
    if new_occs:
        db.commit()
        for occ in new_occs:
            db.refresh(occ)
    
    return existing + new_occs


def get_timeline(db: Session, start_date: date, end_date: date):
    """Get all scheduled notes within a date range, including recurring occurrences."""
    
    # 1. One-off notes (no recurrence) — existing behavior
    one_off_notes = (
        db.query(models.Note)
        .options(
            joinedload(models.Note.canvas_nodes).joinedload(models.CanvasNode.canvas)
        )
        .filter(
            models.Note.scheduled_date >= start_date,
            models.Note.scheduled_date <= end_date,
            models.Note.recurrence_rule == None,
        )
        .order_by(models.Note.scheduled_date)
        .all()
    )
    
    # 2. Recurring notes whose range overlaps the query window
    recurring_notes = (
        db.query(models.Note)
        .options(
            joinedload(models.Note.canvas_nodes).joinedload(models.CanvasNode.canvas)
        )
        .filter(
            models.Note.recurrence_rule != None,
            models.Note.scheduled_date <= end_date,  # recurrence started before window ends
        )
        .all()
    )
    # Further filter: recurrence_end_date is null (infinite) or >= start_date
    recurring_notes = [
        n for n in recurring_notes
        if n.recurrence_end_date is None or n.recurrence_end_date >= start_date
    ]
    
    # Build the result dict
    result: dict[str, list] = {}
    
    # Add one-off notes
    for note in one_off_notes:
        date_key = note.scheduled_date.isoformat()
        if date_key not in result:
            result[date_key] = []
        
        canvas_id = note.canvas_nodes[0].canvas_id if note.canvas_nodes else ""
        
        result[date_key].append({
            "id": note.id,
            "canvas_id": canvas_id,
            "canvas_name": note.canvas_name,
            "note": {
                "id": note.id,
                "title": note.title,
                "content": note.content,
                "created_at": note.created_at.isoformat() if note.created_at else None,
                "updated_at": note.updated_at.isoformat() if note.updated_at else None,
            },
            "scheduled_date": note.scheduled_date.isoformat(),
            "status": note.status or "todo",
            "is_recurring": False,
            "occurrence_id": None,
            "recurrence_rule": None,
        })
    
    # Add recurring note occurrences
    for note in recurring_notes:
        occurrence_dates = expand_recurrence(note, start_date, end_date)
        occurrences = ensure_occurrences(db, note, occurrence_dates)
        
        canvas_id = note.canvas_nodes[0].canvas_id if note.canvas_nodes else ""
        
        for occ in occurrences:
            if occ.skipped:
                continue
            
            date_key = occ.occurrence_date.isoformat()
            if date_key not in result:
                result[date_key] = []
            
            result[date_key].append({
                "id": note.id,
                "canvas_id": canvas_id,
                "canvas_name": note.canvas_name,
                "note": {
                    "id": note.id,
                    "title": note.title,
                    "content": note.content,
                    "created_at": note.created_at.isoformat() if note.created_at else None,
                    "updated_at": note.updated_at.isoformat() if note.updated_at else None,
                },
                "scheduled_date": occ.occurrence_date.isoformat(),
                "status": occ.status or "todo",
                "is_recurring": True,
                "occurrence_id": occ.id,
                "recurrence_rule": note.recurrence_rule,
            })
    
    return result


# ── Recurrence CRUD ─────────────────────────────────────────

def update_recurrence(db: Session, note_id: str, data: schemas.RecurrenceUpdate):
    """Set or clear recurrence on a note."""
    db_note = get_note(db, note_id)
    if not db_note:
        return None
    
    if data.clear_recurrence:
        db_note.recurrence_rule = None
        db_note.recurrence_interval = 1
        db_note.recurrence_end_date = None
        # Delete all future occurrences when clearing recurrence
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


# ── Occurrence CRUD ─────────────────────────────────────────

def update_occurrence_status(db: Session, occurrence_id: str, data: schemas.OccurrenceStatusUpdate):
    """Update status of a single occurrence."""
    occ = db.query(models.TaskOccurrence).filter(models.TaskOccurrence.id == occurrence_id).first()
    if not occ:
        return None
    
    occ.status = data.status
    if data.skipped is not None:
        occ.skipped = data.skipped
    
    db.commit()
    db.refresh(occ)
    return occ

