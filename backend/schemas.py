from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class NoteBase(BaseModel):
    title: str
    content: Optional[str] = None

class NoteCreate(NoteBase):
    id: Optional[str] = None

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None

class NoteResponse(NoteBase):
    id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        orm_mode = True
        from_attributes = True # Pydantic v2 support


# ── Canvas Schemas ──────────────────────────────────────────

class CanvasCreate(BaseModel):
    name: str

class CanvasUpdate(BaseModel):
    name: Optional[str] = None

class CanvasListResponse(BaseModel):
    """Lightweight response for listing canvases (no nodes)."""
    id: str
    name: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Canvas Node Schemas ─────────────────────────────────────

class CanvasNodeCreate(BaseModel):
    note_id: Optional[str] = None         # existing note id, or None to create new
    parent_node_id: Optional[str] = None  # null = root / standalone
    position_x: float = 0.0
    position_y: float = 0.0
    title: Optional[str] = None           # used when creating a new note inline

class CanvasNodeUpdate(BaseModel):
    position_x: Optional[float] = None
    position_y: Optional[float] = None
    parent_node_id: Optional[str] = None
    clear_parent: Optional[bool] = False

class CanvasNodeResponse(BaseModel):
    id: str
    canvas_id: str
    note: NoteResponse
    parent_node_id: Optional[str] = None
    position_x: float
    position_y: float

    class Config:
        from_attributes = True

class CanvasResponse(BaseModel):
    id: str
    name: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    nodes: list[CanvasNodeResponse] = []

    class Config:
        from_attributes = True

class BranchCreate(BaseModel):
    title: str = "Untitled"

