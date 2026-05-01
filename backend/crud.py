from sqlalchemy.orm import Session
from datetime import datetime
import models
import schemas

def get_note(db: Session, note_id: str):
    return db.query(models.Note).filter(models.Note.id == note_id).first()

def get_notes(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Note).offset(skip).limit(limit).all()

def create_note(db: Session, note: schemas.NoteCreate):
    db_note = models.Note(title=note.title, content=note.content)
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note

def update_note(db: Session, note_id: str, note: schemas.NoteUpdate):
    db_note = get_note(db, note_id)
    if db_note:
        update_data = note.dict(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_note, key, value)
        
        db.commit()
        db.refresh(db_note)
    return db_note

def delete_note(db: Session, note_id: str):
    db_note = get_note(db, note_id)
    if db_note:
        db.delete(db_note)
        db.commit()
        return True
    return False
