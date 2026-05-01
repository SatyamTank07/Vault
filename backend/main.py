from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List

import models
import schemas
import crud
from database import engine, get_db

# Create the database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Vault API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Welcome to Vault API"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/notes/", response_model=schemas.NoteResponse)
def create_note(note: schemas.NoteCreate, db: Session = Depends(get_db)):
    return crud.create_note(db=db, note=note)

@app.get("/notes/", response_model=List[schemas.NoteResponse])
def read_notes(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    notes = crud.get_notes(db, skip=skip, limit=limit)
    return notes

@app.get("/notes/{note_id}", response_model=schemas.NoteResponse)
def read_note(note_id: str, db: Session = Depends(get_db)):
    db_note = crud.get_note(db, note_id=note_id)
    if db_note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return db_note

@app.put("/notes/{note_id}", response_model=schemas.NoteResponse)
def update_note(note_id: str, note: schemas.NoteUpdate, db: Session = Depends(get_db)):
    db_note = crud.update_note(db, note_id=note_id, note=note)
    if db_note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return db_note

@app.delete("/notes/{note_id}")
def delete_note(note_id: str, db: Session = Depends(get_db)):
    success = crud.delete_note(db, note_id=note_id)
    if not success:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted successfully"}
