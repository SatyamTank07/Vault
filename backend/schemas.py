from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class UserCreate(BaseModel):
    mobile_number: str
    password: str


class UserLogin(BaseModel):
    mobile_number: str
    password: str


class SendOtpRequest(BaseModel):
    mobile_number: str


class VerifySignupOtpRequest(BaseModel):
    mobile_number: str
    otp: str
    password: str


class CurrentUserResponse(BaseModel):
    id: str
    mobile_number: str
    is_mobile_verified: bool
    created_at: Optional[datetime] = None
    has_set_vault: bool = False

    class Config:
        from_attributes = True


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: CurrentUserResponse


class NoteBase(BaseModel):
    title: str
    content: Optional[str] = None


class NoteCreate(NoteBase):
    id: Optional[str] = None


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class NoteScheduleUpdate(BaseModel):
    scheduled_date: Optional[date] = None
    scheduled_time: Optional[str] = None
    clear_date: Optional[bool] = False
    clear_time: Optional[bool] = False
    status: Optional[str] = None


class NoteResponse(NoteBase):
    id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    scheduled_date: Optional[date] = None
    scheduled_time: Optional[str] = None
    status: Optional[str] = "todo"
    canvas_name: Optional[str] = "Independent Note"
    recurrence_rule: Optional[str] = None
    recurrence_interval: Optional[int] = 1
    recurrence_end_date: Optional[date] = None

    class Config:
        from_attributes = True


class CanvasCreate(BaseModel):
    name: str


class CanvasUpdate(BaseModel):
    name: Optional[str] = None


class CanvasListResponse(BaseModel):
    id: str
    name: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CanvasNodeCreate(BaseModel):
    note_id: Optional[str] = None
    parent_node_id: Optional[str] = None
    position_x: float = 0.0
    position_y: float = 0.0
    title: Optional[str] = None
    scheduled_date: Optional[date] = None


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


class RecurrenceUpdate(BaseModel):
    recurrence_rule: Optional[str] = None
    recurrence_interval: Optional[int] = 1
    recurrence_end_date: Optional[date] = None
    clear_end_date: Optional[bool] = False
    clear_recurrence: Optional[bool] = False


class OccurrenceStatusUpdate(BaseModel):
    status: str
    skipped: Optional[bool] = None


class OccurrenceResponse(BaseModel):
    id: str
    note_id: str
    occurrence_date: date
    status: str
    skipped: bool

    class Config:
        from_attributes = True


class TimelineEntry(BaseModel):
    id: str
    canvas_id: str
    canvas_name: str
    note: NoteResponse
    scheduled_date: date
    scheduled_time: Optional[str] = None
    status: Optional[str] = "todo"

    class Config:
        from_attributes = True


class FeedbackBase(BaseModel):
    title: str
    content: Optional[str] = None


class FeedbackCreate(FeedbackBase):
    pass


class FeedbackUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class FeedbackResponse(FeedbackBase):
    id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
