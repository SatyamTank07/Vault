import uuid
from sqlalchemy import Column, String, DateTime, Date, Float, ForeignKey
from sqlalchemy.orm import relationship, backref
from sqlalchemy.sql import func
from database import Base

class Note(Base):
    __tablename__ = "notes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    title = Column(String, index=True)
    content = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    scheduled_date = Column(Date, nullable=True, index=True)
    status = Column(String, default="todo")

    canvas_nodes = relationship("CanvasNode", back_populates="note")

    @property
    def canvas_name(self):
        if self.canvas_nodes and self.canvas_nodes[0].canvas:
            return self.canvas_nodes[0].canvas.name
        return "Independent Note"


class Canvas(Base):
    __tablename__ = "canvases"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

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
    note = relationship("Note")
    children = relationship("CanvasNode", backref=backref("parent", remote_side=[id]))
