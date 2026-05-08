import uuid

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import backref, relationship
from sqlalchemy.sql import func

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    mobile_number = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    is_mobile_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    notes = relationship("Note", back_populates="user")
    canvases = relationship("Canvas", back_populates="user")
    feedbacks = relationship("Feedback", back_populates="user")


class OtpSession(Base):
    __tablename__ = "otp_sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    mobile_number = Column(String, nullable=False, unique=True, index=True)
    session_id = Column(String, nullable=False)
    purpose = Column(String, nullable=False, default="signup")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Note(Base):
    __tablename__ = "notes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String, index=True)
    content = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    scheduled_date = Column(Date, nullable=True, index=True)
    status = Column(String, default="todo")
    recurrence_rule = Column(String, nullable=True)
    recurrence_interval = Column(Integer, default=1)
    recurrence_end_date = Column(Date, nullable=True)

    user = relationship("User", back_populates="notes")
    canvas_nodes = relationship("CanvasNode", back_populates="note")
    occurrences = relationship("TaskOccurrence", back_populates="note", cascade="all, delete-orphan")

    @property
    def canvas_name(self):
        if self.canvas_nodes and self.canvas_nodes[0].canvas:
            return self.canvas_nodes[0].canvas.name
        return "Independent Note"


class TaskOccurrence(Base):
    __tablename__ = "task_occurrences"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    note_id = Column(String, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    occurrence_date = Column(Date, nullable=False, index=True)
    status = Column(String, default="todo")
    skipped = Column(Boolean, default=False)

    note = relationship("Note", back_populates="occurrences")

    __table_args__ = (
        UniqueConstraint("note_id", "occurrence_date", name="uq_note_occurrence_date"),
    )


class Canvas(Base):
    __tablename__ = "canvases"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="canvases")
    nodes = relationship("CanvasNode", back_populates="canvas", cascade="all, delete-orphan")


class CanvasNode(Base):
    __tablename__ = "canvas_nodes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    canvas_id = Column(String, ForeignKey("canvases.id", ondelete="CASCADE"), nullable=False)
    note_id = Column(String, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    parent_node_id = Column(String, ForeignKey("canvas_nodes.id", ondelete="SET NULL"), nullable=True)
    position_x = Column(Float, default=0.0)
    position_y = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    canvas = relationship("Canvas", back_populates="nodes")
    note = relationship("Note", back_populates="canvas_nodes")
    children = relationship("CanvasNode", backref=backref("parent", remote_side=[id]))


class Feedback(Base):
    __tablename__ = "feedbacks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String, index=True)
    content = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="feedbacks")
