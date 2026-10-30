from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, field_validator

MAX_RECURRENCE_INTERVAL = 99


def _clamp_interval(value: Optional[int]) -> Optional[int]:
    if value is None:
        return None
    return min(MAX_RECURRENCE_INTERVAL, max(1, value))


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
    encrypted_master_seed: Optional[str] = None
    seed_verifier: Optional[str] = None

    class Config:
        from_attributes = True


class UpdateMasterSeed(BaseModel):
    encrypted_master_seed: str
    seed_verifier: Optional[str] = None


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: CurrentUserResponse


class NoteBase(BaseModel):
    title: str
    content: Optional[str] = None


class NoteCreate(NoteBase):
    id: Optional[str] = None
    scheduled_date: Optional[date] = None
    scheduled_time: Optional[str] = None
    end_date: Optional[date] = None
    status: Optional[str] = None
    recurrence_rule: Optional[str] = None
    recurrence_interval: Optional[int] = 1
    recurrence_end_date: Optional[date] = None
    parent_note_id: Optional[str] = None
    canvas_only: bool = False
    # Filenames in this note's upload folder that the content still uses; see crud.prune_note_uploads.
    referenced_uploads: Optional[list[str]] = None

    _clamp_recurrence_interval = field_validator("recurrence_interval")(_clamp_interval)


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    scheduled_date: Optional[date] = None
    scheduled_time: Optional[str] = None
    end_date: Optional[date] = None
    status: Optional[str] = None
    recurrence_rule: Optional[str] = None
    recurrence_interval: Optional[int] = None
    recurrence_end_date: Optional[date] = None
    canvas_only: Optional[bool] = None
    referenced_uploads: Optional[list[str]] = None

    _clamp_recurrence_interval = field_validator("recurrence_interval")(_clamp_interval)


class NoteScheduleUpdate(BaseModel):
    scheduled_date: Optional[date] = None
    scheduled_time: Optional[str] = None
    end_date: Optional[date] = None
    clear_date: Optional[bool] = False
    clear_time: Optional[bool] = False
    clear_end_date: Optional[bool] = False
    status: Optional[str] = None


class NoteParentUpdate(BaseModel):
    parent_note_id: Optional[str] = None
    clear_parent: bool = False


class NoteResponse(NoteBase):
    id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    scheduled_date: Optional[date] = None
    scheduled_time: Optional[str] = None
    status: Optional[str] = None
    canvas_name: Optional[str] = None
    recurrence_rule: Optional[str] = None
    recurrence_interval: Optional[int] = 1
    recurrence_end_date: Optional[date] = None
    end_date: Optional[date] = None
    parent_note_id: Optional[str] = None
    canvas_only: bool = False
    content_version: int = 1

    class Config:
        from_attributes = True


class CanvasCreate(BaseModel):
    id: Optional[str] = None
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
    id: Optional[str] = None
    note_id: Optional[str] = None
    parent_note_id: Optional[str] = None
    canvas_only: Optional[bool] = None
    position_x: float = 0.0
    position_y: float = 0.0
    title: Optional[str] = None
    scheduled_date: Optional[date] = None


class CanvasNodeUpdate(BaseModel):
    position_x: Optional[float] = None
    position_y: Optional[float] = None


class CanvasNodeResponse(BaseModel):
    id: str
    canvas_id: str
    note: NoteResponse
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

    _clamp_recurrence_interval = field_validator("recurrence_interval")(_clamp_interval)


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


class OccurrenceDateUpdate(BaseModel):
    status: Optional[str] = None
    skipped: Optional[bool] = None


class SyncOp(BaseModel):
    """One change made on a device, possibly while offline. `payload` depends on `type`; see crud.apply_sync_op."""

    op_id: str
    type: str
    payload: dict


class SyncPushRequest(BaseModel):
    # Random id of the browser that made the changes, so its own edits never count as conflicts.
    client_id: str
    ops: list[SyncOp]


class SyncOpResult(BaseModel):
    op_id: str
    # applied | conflict | not_found | error
    result: str
    detail: Optional[str] = None
    # For conflicts: the note as the server has it, including the other device's title/content.
    note: Optional[NoteResponse] = None


class SyncPushResponse(BaseModel):
    results: list[SyncOpResult]


class SnapshotCanvasNode(BaseModel):
    id: str
    canvas_id: str
    note_id: str
    position_x: float
    position_y: float
    mirrored: bool = False

    class Config:
        from_attributes = True


class SnapshotResponse(BaseModel):
    """Everything the user owns, so the client can keep an offline copy."""

    server_time: datetime
    notes: list[NoteResponse]
    canvases: list[CanvasListResponse]
    canvas_nodes: list[SnapshotCanvasNode]
    occurrences: list[OccurrenceResponse]
    # URLs of the user's uploaded (encrypted) images, so a device can keep them offline.
    uploads: list[str] = []


class TimelineEntry(BaseModel):
    id: str
    canvas_id: str
    canvas_name: Optional[str] = None
    note: NoteResponse
    scheduled_date: date
    scheduled_time: Optional[str] = None
    status: Optional[str] = None
    is_recurring: Optional[bool] = False
    is_span: Optional[bool] = False
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    occurrence_id: Optional[str] = None
    recurrence_rule: Optional[str] = None

    class Config:
        from_attributes = True


class TimeStreamEntry(BaseModel):
    id: str
    note: NoteResponse
    start_date: date
    end_date: date
    status: Optional[str] = None
    canvas_name: Optional[str] = None
    is_recurring: Optional[bool] = False
    is_span: Optional[bool] = False
    occurrence_id: Optional[str] = None

    class Config:
        from_attributes = True


class FeedbackBase(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class FeedbackCreate(FeedbackBase):
    pass


class FeedbackResponse(FeedbackBase):
    id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

