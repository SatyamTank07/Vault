from sqlalchemy.orm import Session, joinedload
from datetime import datetime, date
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

def get_timeline(db: Session, start_date: date, end_date: date):
    """Get all scheduled notes within a date range."""
    return (
        db.query(models.Note)
        .options(
            joinedload(models.Note.canvas_nodes).joinedload(models.CanvasNode.canvas)
        )
        .filter(models.Note.scheduled_date >= start_date)
        .filter(models.Note.scheduled_date <= end_date)
        .order_by(models.Note.scheduled_date)
        .all()
    )
