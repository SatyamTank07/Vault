from fastapi import FastAPI, Depends, HTTPException, File, UploadFile
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
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

