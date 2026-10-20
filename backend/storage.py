"""Versioned metadata and atomic, checksummed artifacts; no executable checkpoints."""
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone
import uuid

from sqlalchemy import create_engine, String, Text, Integer, select, update
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class Record(Base):
    __tablename__ = "records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    status: Mapped[str] = mapped_column(String(30), default="saved")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    payload: Mapped[str] = mapped_column(Text)
    created: Mapped[str] = mapped_column(String(40))


class Store:
    def __init__(self, root, database_url=None, initialize=True):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.url = database_url or os.getenv("DATABASE_URL") or f"sqlite:///{self.root/'crisis.db'}"
        self.engine = create_engine(self.url, connect_args={"timeout": 30} if self.url.startswith("sqlite") else {},
                                   pool_pre_ping=True)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        if initialize:
            # Local bootstrap only; deployment uses Alembic before API startup.
            Base.metadata.create_all(self.engine)

    @staticmethod
    def serialize(row):
        return {"id": row.id, "kind": row.kind, "status": row.status, "revision": row.revision,
                "created": row.created, **json.loads(row.payload)}

    def create(self, kind, payload, status="saved", identifier=None):
        with self.sessions.begin() as session:
            row = Record(id=identifier or str(uuid.uuid4()), kind=kind, status=status,
                         created=datetime.now(timezone.utc).isoformat(),
                         payload=json.dumps(payload, allow_nan=False))
            session.add(row)
            session.flush()
            return self.serialize(row)

    def get(self, identifier, kind=None):
        with self.sessions() as session:
            row = session.get(Record, identifier)
            if row is None or (kind and row.kind != kind):
                raise KeyError(identifier)
            return self.serialize(row)

    def create_scenarios(self, configs):
        """Import validated configs atomically, not partially on database errors."""
        with self.sessions.begin() as session:
            rows = [Record(id=str(uuid.uuid4()), kind="scenario", status="saved",
                           created=datetime.now(timezone.utc).isoformat(),
                           payload=json.dumps({"config": c}, allow_nan=False)) for c in configs]
            session.add_all(rows)
            session.flush()
            return [self.serialize(row) for row in rows]

    def list(self, kind):
        with self.sessions() as session:
            return [self.serialize(r) for r in session.scalars(
                select(Record).where(Record.kind == kind).order_by(Record.created.desc())).all()]

    def update(self, identifier, payload=None, status=None, expected_revision=None):
        for _ in range(10):
            with self.sessions.begin() as session:
                row = session.get(Record, identifier)
                if row is None:
                    raise KeyError(identifier)
                revision = row.revision
                if expected_revision is not None and revision != expected_revision:
                    raise ValueError("record revision changed; reload before editing")
                values = {"revision": revision+1}
                if payload:
                    values["payload"] = json.dumps(json.loads(row.payload) | payload, allow_nan=False)
                if status:
                    values["status"] = status
                changed = session.execute(update(Record).where(
                    Record.id == identifier, Record.revision == revision).values(**values))
                if changed.rowcount == 1:
                    session.expire(row)
                    return self.serialize(row)
        raise RuntimeError("concurrent metadata update did not settle")

    def claim(self, identifier):
        with self.sessions.begin() as session:
            result = session.execute(update(Record).where(
                Record.id == identifier, Record.status == "queued").values(status="running", revision=Record.revision+1))
            return result.rowcount == 1

    def artifact(self, run_id, name):
        # IDs are opaque UUIDs; names must be a single safe filename.
        uuid.UUID(run_id)
        if Path(name).name != name or name.startswith("."):
            raise ValueError("invalid artifact name")
        directory = self.root/"artifacts"/run_id
        directory.mkdir(parents=True, exist_ok=True)
        return directory/name

    def write_json(self, run_id, name, payload):
        encoded = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode()
        target = self.artifact(run_id, name)
        temporary = target.with_name(target.name+f".{uuid.uuid4().hex}.tmp")
        temporary.write_bytes(encoded)
        os.replace(temporary, target)
        return hashlib.sha256(encoded).hexdigest()

    def read_json(self, run_id, name):
        return json.loads(self.artifact(run_id, name).read_text())
