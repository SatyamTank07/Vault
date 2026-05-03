from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, Query
from datetime import date
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import uuid
import shutil
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
# Read FRONTEND_URL from environment, fallback to localhost for development
frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")
origins = [url.strip() for url in frontend_url.split(",")] if frontend_url else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure uploads directory exists
UPLOAD_DIR = "uploads"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

# Mount static files to serve images
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

@app.get("/")
async def root():
    return {"message": "Welcome to Vault API"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/api/upload")
async def upload_image(
    file: UploadFile = File(...), 
    note_id: str = "misc"
):
    # Create subfolder for the note
    note_folder = os.path.join(UPLOAD_DIR, note_id)
    if not os.path.exists(note_folder):
        os.makedirs(note_folder)

    # Create unique filename
    file_extension = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(note_folder, unique_filename)
    
    # Save the file
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Return the URL including the note_id subfolder
    return {"url": f"/uploads/{note_id}/{unique_filename}"}

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

@app.put("/api/notes/{note_id}/schedule", response_model=schemas.NoteResponse)
def update_note_schedule(note_id: str, data: schemas.NoteScheduleUpdate, db: Session = Depends(get_db)):
    db_note = crud.update_note_schedule(db, note_id=note_id, data=data)
    if db_note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return db_note


# ── Canvas Endpoints ────────────────────────────────────────

@app.post("/api/canvases/", response_model=schemas.CanvasListResponse)
def create_canvas(canvas: schemas.CanvasCreate, db: Session = Depends(get_db)):
    return crud.create_canvas(db=db, canvas=canvas)

@app.get("/api/canvases/", response_model=List[schemas.CanvasListResponse])
def list_canvases(db: Session = Depends(get_db)):
    return crud.get_canvases(db)

@app.get("/api/canvases/{canvas_id}", response_model=schemas.CanvasResponse)
def get_canvas(canvas_id: str, db: Session = Depends(get_db)):
    db_canvas = crud.get_canvas(db, canvas_id=canvas_id)
    if db_canvas is None:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return db_canvas

@app.put("/api/canvases/{canvas_id}", response_model=schemas.CanvasListResponse)
def update_canvas(canvas_id: str, canvas: schemas.CanvasUpdate, db: Session = Depends(get_db)):
    db_canvas = crud.update_canvas(db, canvas_id=canvas_id, canvas=canvas)
    if db_canvas is None:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return db_canvas

@app.delete("/api/canvases/{canvas_id}")
def delete_canvas(canvas_id: str, db: Session = Depends(get_db)):
    success = crud.delete_canvas(db, canvas_id=canvas_id)
    if not success:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return {"message": "Canvas deleted successfully"}


# ── Canvas Node Endpoints ───────────────────────────────────

@app.post("/api/canvases/{canvas_id}/nodes/", response_model=schemas.CanvasNodeResponse)
def create_canvas_node(canvas_id: str, data: schemas.CanvasNodeCreate, db: Session = Depends(get_db)):
    # Verify canvas exists
    if crud.get_canvas(db, canvas_id) is None:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return crud.create_canvas_node(db, canvas_id=canvas_id, data=data)

@app.put("/api/canvases/{canvas_id}/nodes/{node_id}", response_model=schemas.CanvasNodeResponse)
def update_canvas_node(canvas_id: str, node_id: str, data: schemas.CanvasNodeUpdate, db: Session = Depends(get_db)):
    db_node = crud.update_canvas_node(db, node_id=node_id, data=data)
    if db_node is None:
        raise HTTPException(status_code=404, detail="Canvas node not found")
    return db_node

@app.delete("/api/canvases/{canvas_id}/nodes/{node_id}")
def delete_canvas_node(canvas_id: str, node_id: str, db: Session = Depends(get_db)):
    success = crud.delete_canvas_node(db, node_id=node_id)
    if not success:
        raise HTTPException(status_code=404, detail="Canvas node not found")
    return {"message": "Node removed from canvas"}

@app.post("/api/canvases/{canvas_id}/nodes/{node_id}/branch", response_model=schemas.CanvasNodeResponse)
def create_branch(canvas_id: str, node_id: str, data: schemas.BranchCreate, db: Session = Depends(get_db)):
    db_node = crud.create_branch(db, canvas_id=canvas_id, parent_node_id=node_id, data=data)
    if db_node is None:
        raise HTTPException(status_code=404, detail="Parent node not found")
    return db_node


# ── Timeline Endpoints ──────────────────────────────────────

@app.get("/api/timeline/")
def get_timeline(
    start_date: date = Query(...),
    end_date: date = Query(...),
    db: Session = Depends(get_db),
):
    # crud.get_timeline now handles both one-off and recurring notes,
    # returning a pre-built dict of { date_string: [task, ...] }
    return crud.get_timeline(db, start_date, end_date)


# ── Recurrence Endpoints ────────────────────────────────────

@app.put("/api/notes/{note_id}/recurrence", response_model=schemas.NoteResponse)
def update_recurrence(note_id: str, data: schemas.RecurrenceUpdate, db: Session = Depends(get_db)):
    db_note = crud.update_recurrence(db, note_id=note_id, data=data)
    if db_note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return db_note


# ── Occurrence Endpoints ────────────────────────────────────

@app.put("/api/occurrences/{occurrence_id}/status", response_model=schemas.OccurrenceResponse)
def update_occurrence_status(occurrence_id: str, data: schemas.OccurrenceStatusUpdate, db: Session = Depends(get_db)):
    occ = crud.update_occurrence_status(db, occurrence_id=occurrence_id, data=data)
    if occ is None:
        raise HTTPException(status_code=404, detail="Occurrence not found")
    return occ


# ── Feedback Endpoints ──────────────────────────────────────

@app.post("/api/feedback/", response_model=schemas.FeedbackResponse)
def create_feedback(feedback: schemas.FeedbackCreate, db: Session = Depends(get_db)):
    return crud.create_feedback(db=db, feedback=feedback)

@app.get("/api/feedback/", response_model=List[schemas.FeedbackResponse])
def read_feedbacks(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return crud.get_feedbacks(db, skip=skip, limit=limit)

@app.put("/api/feedback/{feedback_id}", response_model=schemas.FeedbackResponse)
def update_feedback(feedback_id: str, feedback: schemas.FeedbackUpdate, db: Session = Depends(get_db)):
    db_feedback = crud.update_feedback(db, feedback_id=feedback_id, feedback=feedback)
    if db_feedback is None:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return db_feedback

@app.delete("/api/feedback/{feedback_id}")
def delete_feedback(feedback_id: str, db: Session = Depends(get_db)):
    success = crud.delete_feedback(db, feedback_id=feedback_id)
    if not success:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return {"message": "Feedback deleted successfully"}

