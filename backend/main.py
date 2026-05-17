import os
import shutil
import uuid
from datetime import date
from typing import List

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import crud
import models
import schemas
from database import engine, get_db, run_schema_migrations
from security import (
    create_access_token,
    get_current_user,
    hash_password,
    normalize_mobile_number,
    send_signup_otp,
    verify_password,
    verify_signup_otp,
)

models.Base.metadata.create_all(bind=engine)
run_schema_migrations()

app = FastAPI(title="Vault API")

frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")
origins = [url.strip() for url in frontend_url.split(",")] if frontend_url else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)


@app.get("/")
async def root():
    return {"message": "Welcome to Vault API"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/api/auth/send-signup-otp")
def send_signup_otp_endpoint(payload: schemas.SendOtpRequest, db: Session = Depends(get_db)):
    try:
        mobile_number = normalize_mobile_number(payload.mobile_number)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing_user = db.query(models.User).filter(models.User.mobile_number == mobile_number).first()
    if existing_user is not None:
        raise HTTPException(status_code=409, detail="Mobile number is already registered.")

    try:
        session_id = send_signup_otp(mobile_number)
    except RuntimeError as exc:
        detail = str(exc)
        error_status = 503 if "configured" in detail.lower() else 502
        raise HTTPException(status_code=error_status, detail=detail) from exc

    otp_session = (
        db.query(models.OtpSession)
        .filter(
            models.OtpSession.mobile_number == mobile_number,
            models.OtpSession.purpose == "signup",
        )
        .first()
    )
    if otp_session is None:
        otp_session = models.OtpSession(
            mobile_number=mobile_number,
            session_id=session_id,
            purpose="signup",
        )
        db.add(otp_session)
    else:
        otp_session.session_id = session_id

    db.commit()
    return {"message": "OTP sent successfully."}


@app.post("/api/auth/verify-signup-otp", response_model=schemas.AuthTokenResponse)
def verify_signup_otp_endpoint(
    payload: schemas.VerifySignupOtpRequest,
    db: Session = Depends(get_db),
):
    try:
        mobile_number = normalize_mobile_number(payload.mobile_number)
        password_hash = hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing_user = db.query(models.User).filter(models.User.mobile_number == mobile_number).first()
    if existing_user is not None:
        raise HTTPException(status_code=409, detail="Mobile number is already registered.")

    otp_session = (
        db.query(models.OtpSession)
        .filter(
            models.OtpSession.mobile_number == mobile_number,
            models.OtpSession.purpose == "signup",
        )
        .first()
    )
    if otp_session is None:
        raise HTTPException(status_code=400, detail="Please request an OTP first.")

    try:
        is_valid_otp = verify_signup_otp(otp_session.session_id, payload.otp)
    except RuntimeError as exc:
        detail = str(exc)
        error_status = 503 if "configured" in detail.lower() else 502
        raise HTTPException(status_code=error_status, detail=detail) from exc

    if not is_valid_otp:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP.")

    existing_user_count = db.query(models.User).count()
    user = models.User(
        mobile_number=mobile_number,
        password_hash=password_hash,
        is_mobile_verified=True,
    )
    db.add(user)
    db.flush()

    if existing_user_count == 0:
        crud.assign_legacy_data_to_user(db, user.id)

    db.delete(otp_session)
    db.commit()
    db.refresh(user)

    access_token = create_access_token({"sub": user.id, "mobile_number": user.mobile_number})
    return {"access_token": access_token, "token_type": "bearer", "user": user}


@app.post("/api/auth/login", response_model=schemas.AuthTokenResponse)
def login(payload: schemas.UserLogin, db: Session = Depends(get_db)):
    try:
        mobile_number = normalize_mobile_number(payload.mobile_number)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    user = db.query(models.User).filter(models.User.mobile_number == mobile_number).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid mobile number or password.")

    if not user.is_mobile_verified:
        raise HTTPException(status_code=403, detail="Mobile number is not verified.")

    access_token = create_access_token({"sub": user.id, "mobile_number": user.mobile_number})
    return {"access_token": access_token, "token_type": "bearer", "user": user}


@app.get("/api/auth/me", response_model=schemas.CurrentUserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user


@app.post("/api/auth/set-vault-flag")
def set_vault_flag(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    current_user.has_set_vault = True
    db.commit()
    return {"message": "Vault flag set."}


@app.post("/api/auth/master-seed")
def store_master_seed(
    payload: schemas.UpdateMasterSeed,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    current_user.encrypted_master_seed = payload.encrypted_master_seed
    if not current_user.has_set_vault:
        current_user.has_set_vault = True
    db.commit()
    return {"message": "Master seed stored."}


@app.post("/api/auth/send-reset-otp", status_code=status.HTTP_501_NOT_IMPLEMENTED)
def send_reset_otp():
    raise HTTPException(status_code=501, detail="Password reset OTP is not implemented yet.")


@app.post("/api/auth/reset-password", status_code=status.HTTP_501_NOT_IMPLEMENTED)
def reset_password():
    raise HTTPException(status_code=501, detail="Password reset is not implemented yet.")


@app.post("/api/upload")
async def upload_image(
    file: UploadFile = File(...),
    note_id: str = "misc",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    safe_note_id = os.path.basename(note_id.strip() or "misc")
    existing_note = db.query(models.Note).filter(models.Note.id == safe_note_id).first()
    if existing_note is not None and existing_note.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You cannot upload files to this note.")

    note_folder = os.path.join(UPLOAD_DIR, current_user.id, safe_note_id)
    os.makedirs(note_folder, exist_ok=True)

    file_extension = os.path.splitext(file.filename or "")[1]
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(note_folder, unique_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"url": f"/api/uploads/{safe_note_id}/{unique_filename}"}


@app.get("/api/uploads/{note_id}/{filename}")
def get_uploaded_file(
    note_id: str,
    filename: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    safe_note_id = os.path.basename(note_id)
    safe_filename = os.path.basename(filename)
    if safe_note_id != note_id or safe_filename != filename:
        raise HTTPException(status_code=400, detail="Invalid file path.")

    user_scoped_path = os.path.join(UPLOAD_DIR, current_user.id, safe_note_id, safe_filename)
    if os.path.exists(user_scoped_path):
        return FileResponse(user_scoped_path)

    note = db.query(models.Note).filter(models.Note.id == safe_note_id).first()
    if note is None or note.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="File not found.")

    legacy_path = os.path.join(UPLOAD_DIR, safe_note_id, safe_filename)
    if os.path.exists(legacy_path):
        return FileResponse(legacy_path)

    raise HTTPException(status_code=404, detail="File not found.")


@app.post("/notes/", response_model=schemas.NoteResponse)
def create_note(
    note: schemas.NoteCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return crud.create_note(db=db, user_id=current_user.id, note=note)


@app.get("/notes/", response_model=List[schemas.NoteResponse])
def read_notes(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return crud.get_notes(db, user_id=current_user.id, skip=skip, limit=limit)


@app.get("/notes/{note_id}", response_model=schemas.NoteResponse)
def read_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_note = crud.get_note(db, user_id=current_user.id, note_id=note_id)
    if db_note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return db_note


@app.put("/notes/{note_id}", response_model=schemas.NoteResponse)
def update_note(
    note_id: str,
    note: schemas.NoteUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_note = crud.update_note(db, user_id=current_user.id, note_id=note_id, note=note)
    if db_note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return db_note


@app.delete("/notes/{note_id}")
def delete_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    success = crud.delete_note(db, user_id=current_user.id, note_id=note_id)
    if not success:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted successfully"}


@app.put("/api/notes/{note_id}/schedule", response_model=schemas.NoteResponse)
def update_note_schedule(
    note_id: str,
    data: schemas.NoteScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_note = crud.update_note_schedule(db, user_id=current_user.id, note_id=note_id, data=data)
    if db_note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return db_note


@app.post("/api/canvases/", response_model=schemas.CanvasListResponse)
def create_canvas(
    canvas: schemas.CanvasCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return crud.create_canvas(db=db, user_id=current_user.id, canvas=canvas)


@app.get("/api/canvases/", response_model=List[schemas.CanvasListResponse])
def list_canvases(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return crud.get_canvases(db, user_id=current_user.id)


@app.get("/api/canvases/{canvas_id}", response_model=schemas.CanvasResponse)
def get_canvas(
    canvas_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_canvas = crud.get_canvas(db, user_id=current_user.id, canvas_id=canvas_id)
    if db_canvas is None:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return db_canvas


@app.put("/api/canvases/{canvas_id}", response_model=schemas.CanvasListResponse)
def update_canvas(
    canvas_id: str,
    canvas: schemas.CanvasUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_canvas = crud.update_canvas(db, user_id=current_user.id, canvas_id=canvas_id, canvas=canvas)
    if db_canvas is None:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return db_canvas


@app.delete("/api/canvases/{canvas_id}")
def delete_canvas(
    canvas_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    success = crud.delete_canvas(db, user_id=current_user.id, canvas_id=canvas_id)
    if not success:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return {"message": "Canvas deleted successfully"}


@app.post("/api/canvases/{canvas_id}/nodes/", response_model=schemas.CanvasNodeResponse)
def create_canvas_node(
    canvas_id: str,
    data: schemas.CanvasNodeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if crud.get_canvas(db, current_user.id, canvas_id) is None:
        raise HTTPException(status_code=404, detail="Canvas not found")

    db_node = crud.create_canvas_node(db, user_id=current_user.id, canvas_id=canvas_id, data=data)
    if db_node is None:
        raise HTTPException(status_code=404, detail="Note or parent node not found")
    return db_node


@app.put("/api/canvases/{canvas_id}/nodes/{node_id}", response_model=schemas.CanvasNodeResponse)
def update_canvas_node(
    canvas_id: str,
    node_id: str,
    data: schemas.CanvasNodeUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_node = crud.update_canvas_node(db, user_id=current_user.id, node_id=node_id, data=data)
    if db_node is None:
        raise HTTPException(status_code=404, detail="Canvas node not found")
    return db_node


@app.delete("/api/canvases/{canvas_id}/nodes/{node_id}")
def delete_canvas_node(
    canvas_id: str,
    node_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    success = crud.delete_canvas_node(db, user_id=current_user.id, node_id=node_id)
    if not success:
        raise HTTPException(status_code=404, detail="Canvas node not found")
    return {"message": "Node removed from canvas"}


@app.post("/api/canvases/{canvas_id}/nodes/{node_id}/branch", response_model=schemas.CanvasNodeResponse)
def create_branch(
    canvas_id: str,
    node_id: str,
    data: schemas.BranchCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_node = crud.create_branch(
        db,
        user_id=current_user.id,
        canvas_id=canvas_id,
        parent_node_id=node_id,
        data=data,
    )
    if db_node is None:
        raise HTTPException(status_code=404, detail="Parent node not found")
    return db_node


@app.get("/api/timeline/")
def get_timeline(
    start_date: date = Query(...),
    end_date: date = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return crud.get_timeline(db, current_user.id, start_date, end_date)


@app.put("/api/notes/{note_id}/recurrence", response_model=schemas.NoteResponse)
def update_recurrence(
    note_id: str,
    data: schemas.RecurrenceUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_note = crud.update_recurrence(db, user_id=current_user.id, note_id=note_id, data=data)
    if db_note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return db_note


@app.put("/api/occurrences/{occurrence_id}/status", response_model=schemas.OccurrenceResponse)
def update_occurrence_status(
    occurrence_id: str,
    data: schemas.OccurrenceStatusUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    occ = crud.update_occurrence_status(db, user_id=current_user.id, occurrence_id=occurrence_id, data=data)
    if occ is None:
        raise HTTPException(status_code=404, detail="Occurrence not found")
    return occ


@app.post("/api/feedback/", response_model=schemas.FeedbackResponse)
def create_feedback(
    feedback: schemas.FeedbackCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return crud.create_feedback(db=db, user_id=current_user.id, feedback=feedback)


@app.get("/api/feedback/", response_model=List[schemas.FeedbackResponse])
def read_feedbacks(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return crud.get_feedbacks(db, user_id=current_user.id, skip=skip, limit=limit)


@app.put("/api/feedback/{feedback_id}", response_model=schemas.FeedbackResponse)
def update_feedback(
    feedback_id: str,
    feedback: schemas.FeedbackUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_feedback = crud.update_feedback(
        db,
        user_id=current_user.id,
        feedback_id=feedback_id,
        feedback=feedback,
    )
    if db_feedback is None:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return db_feedback


@app.delete("/api/feedback/{feedback_id}")
def delete_feedback(
    feedback_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    success = crud.delete_feedback(db, user_id=current_user.id, feedback_id=feedback_id)
    if not success:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return {"message": "Feedback deleted successfully"}
