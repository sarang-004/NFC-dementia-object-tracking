from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
import logging
import re
import sqlite3

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "nfc_tracking.db"

# Your original code seeded these demo rows (INSERT OR IGNORE).
# Set to False to stop seeding. Existing rows are never deleted.
SEED_DEMO_DATA = True

# If the ESP32 sends timestamps WITHOUT a UTC offset (e.g. 2026-10-20T15:45:00),
# they are interpreted using this offset. 0 = UTC. Use 330 for IST (+05:30).
NAIVE_TIMESTAMP_UTC_OFFSET_MINUTES = 0

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("caretrack")


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="NFC Dementia Object Tracking API",
    description="Backend for NFC-based smart object tracking system",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:5501",
        "http://localhost:5501",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(sqlite3.Error)
async def sqlite_error_handler(request, exc):
    # Technical details go to the log, not to the user.
    logger.exception("SQLite error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Database error. See backend log."})


# ============================================================
# MODELS
# ============================================================

class DetectionEvent(BaseModel):
    nfc_uid: str
    reader_id: str
    timestamp: Optional[str] = None  # optional now; server time is used if missing/invalid


class ObjectRegistration(BaseModel):
    nfc_uid: str
    name: str


class ReaderLocation(BaseModel):
    reader_id: str
    building: str
    floor: str
    room: str
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)


# ============================================================
# DATABASE
# ============================================================

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def db():
    """Connection with commit-on-success / rollback-on-error."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def column_names(conn, table):
    return [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def init_db():
    with db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS detections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nfc_uid TEXT NOT NULL,
                reader_id TEXT NOT NULL,
                timestamp TEXT NOT NULL)"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS reader_locations (
                reader_id TEXT PRIMARY KEY,
                building TEXT NOT NULL,
                floor TEXT NOT NULL,
                room TEXT NOT NULL)"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS objects (
                nfc_uid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                registered_at TEXT NOT NULL)"""
        )

        # ---- existing migration: objects.name
        if "name" not in column_names(conn, "objects"):
            conn.execute("ALTER TABLE objects ADD COLUMN name TEXT")
            conn.execute("UPDATE objects SET name = 'Unnamed Object' WHERE name IS NULL")

        # ---- NEW migrations (additive, no data is touched)
        reader_cols = column_names(conn, "reader_locations")
        if "latitude" not in reader_cols:
            conn.execute("ALTER TABLE reader_locations ADD COLUMN latitude REAL")
        if "longitude" not in reader_cols:
            conn.execute("ALTER TABLE reader_locations ADD COLUMN longitude REAL")
        if "received_at" not in column_names(conn, "detections"):
            conn.execute("ALTER TABLE detections ADD COLUMN received_at TEXT")

        conn.execute("CREATE INDEX IF NOT EXISTS idx_det_uid ON detections(nfc_uid, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_det_reader ON detections(reader_id, id)")

        if SEED_DEMO_DATA:
            for uid, name, at in [
                ("53090BF5130001", "House Keys", "2026-10-07T18:00:00+05:30"),
                ("530B0BF5130001", "Reading Glasses", "2026-10-07T18:05:00+05:30"),
                ("530A0BF5130001", "Medicine Box", "2026-10-07T18:06:00+05:30"),
                ("530C0BF5130001", "Wallet", "2026-10-07T18:07:00+05:30"),
            ]:
                conn.execute(
                    "INSERT OR IGNORE INTO objects (nfc_uid, name, registered_at) VALUES (?, ?, ?)",
                    (uid, name, at),
                )
            conn.execute(
                "INSERT OR IGNORE INTO reader_locations (reader_id, building, floor, room) VALUES (?, ?, ?, ?)",
                ("R01", "Building A", "Floor 1", "Entrance"),
            )


init_db()


# ============================================================
# HELPERS
# ============================================================

def normalize_uid(uid: str) -> str:
    return uid.strip().upper()


def get_current_timestamp():
    return datetime.now(timezone.utc).isoformat()


def normalize_timestamp(value: Optional[str]) -> str:
    """Return an ISO 8601 UTC timestamp. Falls back to server time if the
    device timestamp is missing, unparseable or implausible (e.g. an ESP32
    without NTP reporting 1970/2000)."""
    now = datetime.now(timezone.utc)
    if value:
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(
                    tzinfo=timezone(timedelta(minutes=NAIVE_TIMESTAMP_UTC_OFFSET_MINUTES))
                )
            parsed = parsed.astimezone(timezone.utc)
            if datetime(2024, 1, 1, tzinfo=timezone.utc) <= parsed <= now + timedelta(days=1):
                return parsed.isoformat()
        except ValueError:
            pass
        logger.warning("Device timestamp %r rejected; using server time", value)
    return now.isoformat()


def coords_valid(lat, lng) -> bool:
    return (
        lat is not None
        and lng is not None
        and -90 <= lat <= 90
        and -180 <= lng <= 180
    )


def reader_payload(reader_id, building, floor, room, lat, lng):
    ok = coords_valid(lat, lng)
    return {
        "reader_id": reader_id,
        "building": building,
        "floor": floor,
        "room": room,
        "latitude": lat if ok else None,
        "longitude": lng if ok else None,
        "has_coordinates": ok,
    }


def natural_key(text):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", text or "")]


OBJECT_STATUS_SQL = """
SELECT o.nfc_uid, o.name, o.registered_at,
       d.id AS det_id, d.timestamp AS det_ts, d.reader_id AS det_reader,
       r.reader_id AS r_id, r.building, r.floor, r.room, r.latitude, r.longitude
FROM objects o
LEFT JOIN detections d ON d.id = (SELECT MAX(id) FROM detections WHERE nfc_uid = o.nfc_uid)
LEFT JOIN reader_locations r ON r.reader_id = d.reader_id
"""


def build_entry(row):
    detection = None
    location = None
    if row["det_id"] is not None:
        detection = {
            "id": row["det_id"],
            "nfc_uid": row["nfc_uid"],
            "reader_id": row["det_reader"],
            "timestamp": row["det_ts"],
        }
        if row["r_id"] is not None:
            location = reader_payload(
                row["r_id"], row["building"], row["floor"], row["room"],
                row["latitude"], row["longitude"],
            )
    return {
        "object": {
            "nfc_uid": row["nfc_uid"],
            "name": row["name"],
            "registered_at": row["registered_at"],
        },
        "latest_detection": detection,
        "location": location,
        "state": {
            "registered": True,
            "detected": detection is not None,
            "reader_configured": location is not None,
            "coordinates_configured": bool(location and location["has_coordinates"]),
        },
    }


def reader_summaries(conn):
    readers = conn.execute(
        "SELECT reader_id, building, floor, room, latitude, longitude FROM reader_locations"
    ).fetchall()
    counts = {
        r["reader_id"]: r["n"]
        for r in conn.execute("SELECT reader_id, COUNT(*) AS n FROM detections GROUP BY reader_id")
    }
    last = {
        r["reader_id"]: r
        for r in conn.execute(
            """SELECT d.reader_id, d.id, d.nfc_uid, d.timestamp, o.name
               FROM detections d LEFT JOIN objects o ON o.nfc_uid = d.nfc_uid
               WHERE d.id IN (SELECT MAX(id) FROM detections GROUP BY reader_id)"""
        )
    }
    here = defaultdict(list)
    for r in conn.execute(
        """SELECT d.reader_id, d.id, d.nfc_uid, d.timestamp, o.name
           FROM detections d JOIN objects o ON o.nfc_uid = d.nfc_uid
           WHERE d.id IN (SELECT MAX(id) FROM detections GROUP BY nfc_uid)
           ORDER BY d.id DESC"""
    ):
        here[r["reader_id"]].append(
            {"nfc_uid": r["nfc_uid"], "name": r["name"], "timestamp": r["timestamp"], "detection_id": r["id"]}
        )

    out = []
    for r in readers:
        item = reader_payload(
            r["reader_id"], r["building"], r["floor"], r["room"], r["latitude"], r["longitude"]
        )
        l = last.get(r["reader_id"])
        item["total_detections"] = counts.get(r["reader_id"], 0)
        item["last_detection"] = (
            {"id": l["id"], "timestamp": l["timestamp"], "nfc_uid": l["nfc_uid"], "name": l["name"]}
            if l else None
        )
        item["objects"] = here.get(r["reader_id"], [])
        out.append(item)
    return sorted(out, key=lambda x: natural_key(x["reader_id"]))


# ============================================================
# ROOT / HEALTH
# ============================================================

@app.get("/")
def root():
    return {"status": "success", "message": "NFC Dementia Object Tracking Backend is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy", "database": str(DB_PATH), "timestamp": get_current_timestamp()}


# ============================================================
# POST DETECTION (ESP32) - request contract unchanged
# ============================================================

@app.post("/detection")
def post_detection(event: DetectionEvent):
    nfc_uid = normalize_uid(event.nfc_uid)
    reader_id = event.reader_id.strip().upper()
    stored_ts = normalize_timestamp(event.timestamp)

    with db() as conn:
        if conn.execute(
            "SELECT 1 FROM reader_locations WHERE reader_id = ?", (reader_id,)
        ).fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Reader '{reader_id}' is not registered")

        if conn.execute("SELECT 1 FROM objects WHERE nfc_uid = ?", (nfc_uid,)).fetchone() is None:
            raise HTTPException(status_code=404, detail=f"NFC object '{nfc_uid}' is not registered")

        cur = conn.execute(
            "INSERT INTO detections (nfc_uid, reader_id, timestamp, received_at) VALUES (?, ?, ?, ?)",
            (nfc_uid, reader_id, stored_ts, get_current_timestamp()),
        )
        detection_id = cur.lastrowid

    return {
        "status": "success",
        "message": "Detection recorded",
        "detection_id": detection_id,
        "nfc_uid": nfc_uid,
        "reader_id": reader_id,
        "timestamp": stored_ts,
    }


@app.get("/detections/latest-id")
def latest_detection_id():
    """Cheap endpoint the frontend polls to learn whether anything changed."""
    with db() as conn:
        row = conn.execute("SELECT id, timestamp FROM detections ORDER BY id DESC LIMIT 1").fetchone()
    return {
        "status": "success",
        "latest_detection_id": row["id"] if row else None,
        "latest_timestamp": row["timestamp"] if row else None,
    }


@app.get("/detections/recent")
def recent_detections(limit: int = Query(20, ge=1, le=200)):
    with db() as conn:
        rows = conn.execute(
            """SELECT d.id, d.nfc_uid, d.reader_id, d.timestamp, o.name
               FROM detections d LEFT JOIN objects o ON o.nfc_uid = d.nfc_uid
               ORDER BY d.id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return {"status": "success", "count": len(rows), "detections": [dict(r) for r in rows]}


# ============================================================
# OBJECTS
# ============================================================

@app.get("/objects")
def get_objects():
    with db() as conn:
        rows = conn.execute(
            "SELECT nfc_uid, name, registered_at FROM objects ORDER BY registered_at ASC"
        ).fetchall()
    objects = [
        {"nfc_uid": r["nfc_uid"], "name": r["name"], "registered_at": r["registered_at"]}
        for r in rows
    ]
    return {"status": "success", "count": len(objects), "objects": objects}


@app.get("/objects/status")
def get_objects_status():
    """Every object with its latest detection and reader location in one call."""
    with db() as conn:
        rows = conn.execute(OBJECT_STATUS_SQL + " ORDER BY o.registered_at ASC").fetchall()
    entries = [build_entry(r) for r in rows]
    return {"status": "success", "count": len(entries), "objects": entries}


@app.get("/objects/search")
def search_objects(q: str = Query(..., min_length=1, max_length=100)):
    """Exact UID / exact name first; otherwise case-insensitive partial name match."""
    term = q.strip()
    if not term:
        raise HTTPException(status_code=400, detail="Search term cannot be empty")
    uid = normalize_uid(term)
    lowered = term.lower()
    like = "%" + lowered.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

    with db() as conn:
        rows = conn.execute(
            OBJECT_STATUS_SQL
            + """ WHERE o.nfc_uid = ? OR LOWER(o.name) LIKE ? ESCAPE '\\'
                  ORDER BY o.registered_at ASC""",
            (uid, like),
        ).fetchall()

    entries = [build_entry(r) for r in rows]
    exact = [
        e for e in entries
        if e["object"]["nfc_uid"] == uid or (e["object"]["name"] or "").lower() == lowered
    ]
    matches = exact or entries
    return {"status": "success", "query": term, "count": len(matches), "matches": matches}


@app.post("/objects/register")
def register_object(object_data: ObjectRegistration):
    nfc_uid = normalize_uid(object_data.nfc_uid)
    name = object_data.name.strip()

    if not nfc_uid:
        raise HTTPException(status_code=400, detail="NFC UID cannot be empty")
    if not name:
        raise HTTPException(status_code=400, detail="Object name cannot be empty")

    registered_at = get_current_timestamp()

    with db() as conn:
        existing = conn.execute("SELECT * FROM objects WHERE nfc_uid = ?", (nfc_uid,)).fetchone()
        if existing is not None:
            conn.execute("UPDATE objects SET name = ? WHERE nfc_uid = ?", (name, nfc_uid))
            return {
                "status": "success",
                "message": "Object updated successfully",
                "nfc_uid": nfc_uid,
                "name": name,
                "registered_at": existing["registered_at"],
            }
        conn.execute(
            "INSERT INTO objects (nfc_uid, name, registered_at) VALUES (?, ?, ?)",
            (nfc_uid, name, registered_at),
        )

    return {
        "status": "success",
        "message": "Object registered successfully",
        "nfc_uid": nfc_uid,
        "name": name,
        "registered_at": registered_at,
    }


@app.get("/object/{nfc_uid}/latest")
def get_latest_detection(nfc_uid: str):
    nfc_uid = normalize_uid(nfc_uid)
    with db() as conn:
        d = conn.execute(
            "SELECT id, nfc_uid, reader_id, timestamp FROM detections WHERE nfc_uid = ? ORDER BY id DESC LIMIT 1",
            (nfc_uid,),
        ).fetchone()

    if d is None:
        return {
            "status": "success",
            "found": False,
            "message": "No detection found for this object",
            "detection": None,
        }
    return {
        "status": "success",
        "found": True,
        "detection": {
            "id": d["id"], "nfc_uid": d["nfc_uid"],
            "reader_id": d["reader_id"], "timestamp": d["timestamp"],
        },
    }


@app.get("/object/{nfc_uid}/history")
def get_object_history(nfc_uid: str):
    nfc_uid = normalize_uid(nfc_uid)
    with db() as conn:
        rows = conn.execute(
            "SELECT id, nfc_uid, reader_id, timestamp FROM detections WHERE nfc_uid = ? ORDER BY id DESC",
            (nfc_uid,),
        ).fetchall()
    history = [
        {"id": r["id"], "nfc_uid": r["nfc_uid"], "reader_id": r["reader_id"], "timestamp": r["timestamp"]}
        for r in rows
    ]
    return {"status": "success", "count": len(history), "history": history}


@app.get("/object/{nfc_uid}")
def get_object_details(nfc_uid: str):
    """Object + latest detection + reader location (now incl. coordinates)."""
    nfc_uid = normalize_uid(nfc_uid)
    with db() as conn:
        row = conn.execute(OBJECT_STATUS_SQL + " WHERE o.nfc_uid = ?", (nfc_uid,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Object not found")
    return {"status": "success", **build_entry(row)}


# ============================================================
# READERS / LOCATIONS
# ============================================================

@app.get("/reader/{reader_id}/location")
def get_reader_location(reader_id: str):
    reader_id = reader_id.strip().upper()
    with db() as conn:
        r = conn.execute(
            "SELECT reader_id, building, floor, room, latitude, longitude FROM reader_locations WHERE reader_id = ?",
            (reader_id,),
        ).fetchone()
    if r is None:
        raise HTTPException(status_code=404, detail=f"Reader '{reader_id}' not found")
    return {
        "status": "success",
        "reader": reader_payload(
            r["reader_id"], r["building"], r["floor"], r["room"], r["latitude"], r["longitude"]
        ),
    }


@app.get("/readers")
def list_readers():
    with db() as conn:
        readers = reader_summaries(conn)
    return {"status": "success", "count": len(readers), "readers": readers}


@app.post("/readers")
def save_reader(data: ReaderLocation):
    """Create or update a reader's logical (building/floor/room) and
    geographic (latitude/longitude) location."""
    reader_id = data.reader_id.strip().upper()
    building, floor, room = data.building.strip(), data.floor.strip(), data.room.strip()

    if not re.fullmatch(r"[A-Z0-9_-]{1,32}", reader_id):
        raise HTTPException(status_code=400, detail="Reader ID must be 1-32 characters: letters, digits, - or _")
    if not building or not floor or not room:
        raise HTTPException(status_code=400, detail="Building, floor and room are required")
    if (data.latitude is None) != (data.longitude is None):
        raise HTTPException(status_code=400, detail="Provide both latitude and longitude, or neither")

    with db() as conn:
        existed = conn.execute(
            "SELECT 1 FROM reader_locations WHERE reader_id = ?", (reader_id,)
        ).fetchone() is not None
        conn.execute(
            """INSERT INTO reader_locations (reader_id, building, floor, room, latitude, longitude)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(reader_id) DO UPDATE SET
                 building = excluded.building, floor = excluded.floor, room = excluded.room,
                 latitude = excluded.latitude, longitude = excluded.longitude""",
            (reader_id, building, floor, room, data.latitude, data.longitude),
        )

    return {
        "status": "success",
        "message": "Reader updated" if existed else "Reader created",
        "reader": reader_payload(reader_id, building, floor, room, data.latitude, data.longitude),
    }


@app.get("/readers/map")
def readers_for_map():
    with db() as conn:
        readers = [r for r in reader_summaries(conn) if r["has_coordinates"]]
    return {"status": "success", "count": len(readers), "readers": readers}


@app.get("/locations/hierarchy")
def location_hierarchy():
    """Building -> Floor -> Room -> Reader -> Objects (last seen there)."""
    with db() as conn:
        summaries = reader_summaries(conn)
        undetected = [
            {"nfc_uid": r["nfc_uid"], "name": r["name"]}
            for r in conn.execute(
                "SELECT nfc_uid, name FROM objects WHERE nfc_uid NOT IN (SELECT DISTINCT nfc_uid FROM detections)"
            )
        ]
        unconfigured = [
            r["reader_id"]
            for r in conn.execute(
                "SELECT DISTINCT reader_id FROM detections WHERE reader_id NOT IN (SELECT reader_id FROM reader_locations)"
            )
        ]

    tree = {}
    for s in summaries:
        tree.setdefault(s["building"], {}).setdefault(s["floor"], {}).setdefault(s["room"], []).append(s)

    buildings = []
    for b in sorted(tree, key=natural_key):
        floors = []
        for f in sorted(tree[b], key=natural_key):
            rooms = [
                {"room": rm, "readers": tree[b][f][rm]}
                for rm in sorted(tree[b][f], key=natural_key)
            ]
            floors.append({"floor": f, "rooms": rooms})
        buildings.append({"building": b, "floors": floors})

    return {
        "status": "success",
        "reader_count": len(summaries),
        "buildings": buildings,
        "undetected_objects": undetected,
        "unconfigured_readers_with_detections": unconfigured,
    }