from sqlalchemy.orm import Session
from datetime import datetime
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
    return db.query(models.Note).filter(models.Note.id == note_id).first()

def get_notes(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Note).offset(skip).limit(limit).all()

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
