from datetime import datetime, timezone
from pathlib import Path
import sqlite3

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "nfc_tracking.db"


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="NFC Dementia Object Tracking API",
    description="Backend for NFC-based smart object tracking system",
    version="1.0.0"
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:5501",
        "http://localhost:5501",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# PYDANTIC MODELS
# ============================================================

class DetectionEvent(BaseModel):
    nfc_uid: str
    reader_id: str
    timestamp: str


class ObjectRegistration(BaseModel):
    nfc_uid: str
    name: str


# ============================================================
# DATABASE CONNECTION
# ============================================================

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ============================================================
# DATABASE INITIALIZATION
# ============================================================

def init_db():

    conn = get_connection()
    cursor = conn.cursor()

    # --------------------------------------------------------
    # DETECTIONS
    # --------------------------------------------------------

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS detections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nfc_uid TEXT NOT NULL,
            reader_id TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
        """
    )

    # --------------------------------------------------------
    # READER LOCATIONS
    # --------------------------------------------------------

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS reader_locations (
            reader_id TEXT PRIMARY KEY,
            building TEXT NOT NULL,
            floor TEXT NOT NULL,
            room TEXT NOT NULL
        )
        """
    )

    # --------------------------------------------------------
    # OBJECTS
    # --------------------------------------------------------

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS objects (
            nfc_uid TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            registered_at TEXT NOT NULL
        )
        """
    )

    # --------------------------------------------------------
    # DATABASE MIGRATION
    #
    # If the old objects table exists without a name column,
    # add it.
    # --------------------------------------------------------

    cursor.execute("PRAGMA table_info(objects)")
    columns = [row["name"] for row in cursor.fetchall()]

    if "name" not in columns:

        cursor.execute(
            """
            ALTER TABLE objects
            ADD COLUMN name TEXT
            """
        )

        # Fill old rows with a temporary name.
        cursor.execute(
            """
            UPDATE objects
            SET name = 'Unnamed Object'
            WHERE name IS NULL
            """
        )

    # --------------------------------------------------------
    # SEED DEMO OBJECTS
    #
    # Only inserted if they don't already exist.
    # --------------------------------------------------------

    demo_objects = [
        (
            "53090BF5130001",
            "House Keys",
            "2026-10-07T18:00:00+05:30"
        ),
        (
            "530B0BF5130001",
            "Reading Glasses",
            "2026-10-07T18:05:00+05:30"
        ),
        (
            "530A0BF5130001",
            "Medicine Box",
            "2026-10-07T18:06:00+05:30"
        ),
        (
            "530C0BF5130001",
            "Wallet",
            "2026-10-07T18:07:00+05:30"
        ),
    ]

    for nfc_uid, name, registered_at in demo_objects:

        cursor.execute(
            """
            INSERT OR IGNORE INTO objects
            (nfc_uid, name, registered_at)
            VALUES (?, ?, ?)
            """,
            (
                nfc_uid,
                name,
                registered_at
            )
        )

    # --------------------------------------------------------
    # SEED CURRENT READER
    # --------------------------------------------------------

    cursor.execute(
        """
        INSERT OR IGNORE INTO reader_locations
        (reader_id, building, floor, room)
        VALUES (?, ?, ?, ?)
        """,
        (
            "R01",
            "Building A",
            "Floor 1",
            "Entrance"
        )
    )

    conn.commit()
    conn.close()


# Initialize database when backend starts
init_db()


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def normalize_uid(uid: str) -> str:
    """
    Normalize NFC UID so that:
    53090bf5130001
    53090BF5130001

    are treated as the same UID.
    """
    return uid.strip().upper()


def get_current_timestamp():
    """
    Return current UTC timestamp in ISO 8601 format.
    """
    return datetime.now(timezone.utc).isoformat()


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {
        "status": "success",
        "message": "NFC Dementia Object Tracking Backend is running"
    }


# ============================================================
# POST DETECTION
# ============================================================

@app.post("/detection")
def post_detection(event: DetectionEvent):

    nfc_uid = normalize_uid(event.nfc_uid)
    reader_id = event.reader_id.strip().upper()

    conn = get_connection()
    cursor = conn.cursor()

    # --------------------------------------------------------
    # Check whether reader exists
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT *
        FROM reader_locations
        WHERE reader_id = ?
        """,
        (reader_id,)
    )

    reader = cursor.fetchone()

    if reader is None:

        conn.close()

        raise HTTPException(
            status_code=404,
            detail=f"Reader '{reader_id}' is not registered"
        )

    # --------------------------------------------------------
    # Check whether object exists
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT *
        FROM objects
        WHERE nfc_uid = ?
        """,
        (nfc_uid,)
    )

    obj = cursor.fetchone()

    if obj is None:

        conn.close()

        raise HTTPException(
            status_code=404,
            detail=f"NFC object '{nfc_uid}' is not registered"
        )

    # --------------------------------------------------------
    # Store detection
    # --------------------------------------------------------

    cursor.execute(
        """
        INSERT INTO detections
        (nfc_uid, reader_id, timestamp)
        VALUES (?, ?, ?)
        """,
        (
            nfc_uid,
            reader_id,
            event.timestamp
        )
    )

    conn.commit()
    conn.close()

    return {
        "status": "success",
        "message": "Detection recorded",
        "nfc_uid": nfc_uid,
        "reader_id": reader_id,
        "timestamp": event.timestamp
    }


# ============================================================
# GET ALL OBJECTS
# ============================================================

@app.get("/objects")
def get_objects():

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT
            nfc_uid,
            name,
            registered_at
        FROM objects
        ORDER BY registered_at ASC
        """
    )

    rows = cursor.fetchall()

    conn.close()

    objects = []

    for row in rows:

        objects.append(
            {
                "nfc_uid": row["nfc_uid"],
                "name": row["name"],
                "registered_at": row["registered_at"]
            }
        )

    return {
        "status": "success",
        "count": len(objects),
        "objects": objects
    }


# ============================================================
# REGISTER NEW OBJECT
# ============================================================

@app.post("/objects/register")
def register_object(object_data: ObjectRegistration):

    nfc_uid = normalize_uid(object_data.nfc_uid)
    name = object_data.name.strip()

    # --------------------------------------------------------
    # Validation
    # --------------------------------------------------------

    if not nfc_uid:

        raise HTTPException(
            status_code=400,
            detail="NFC UID cannot be empty"
        )

    if not name:

        raise HTTPException(
            status_code=400,
            detail="Object name cannot be empty"
        )

    # --------------------------------------------------------
    # Generate registration timestamp on backend
    # --------------------------------------------------------

    registered_at = get_current_timestamp()

    conn = get_connection()
    cursor = conn.cursor()

    # --------------------------------------------------------
    # Check if UID already exists
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT *
        FROM objects
        WHERE nfc_uid = ?
        """,
        (nfc_uid,)
    )

    existing = cursor.fetchone()

    # --------------------------------------------------------
    # Update existing object
    # --------------------------------------------------------

    if existing is not None:

        cursor.execute(
            """
            UPDATE objects
            SET name = ?
            WHERE nfc_uid = ?
            """,
            (
                name,
                nfc_uid
            )
        )

        conn.commit()
        conn.close()

        return {
            "status": "success",
            "message": "Object updated successfully",
            "nfc_uid": nfc_uid,
            "name": name,
            "registered_at": existing["registered_at"]
        }

    # --------------------------------------------------------
    # Insert new object
    # --------------------------------------------------------

    cursor.execute(
        """
        INSERT INTO objects
        (
            nfc_uid,
            name,
            registered_at
        )
        VALUES (?, ?, ?)
        """,
        (
            nfc_uid,
            name,
            registered_at
        )
    )

    conn.commit()
    conn.close()

    return {
        "status": "success",
        "message": "Object registered successfully",
        "nfc_uid": nfc_uid,
        "name": name,
        "registered_at": registered_at
    }


# ============================================================
# GET LATEST DETECTION
# ============================================================

@app.get("/object/{nfc_uid}/latest")
def get_latest_detection(nfc_uid: str):

    nfc_uid = normalize_uid(nfc_uid)

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT
            id,
            nfc_uid,
            reader_id,
            timestamp
        FROM detections
        WHERE nfc_uid = ?
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        (nfc_uid,)
    )

    detection = cursor.fetchone()

    conn.close()

    if detection is None:

        return {
            "status": "success",
            "found": False,
            "message": "No detection found for this object",
            "detection": None
        }

    return {
        "status": "success",
        "found": True,
        "detection": {
            "id": detection["id"],
            "nfc_uid": detection["nfc_uid"],
            "reader_id": detection["reader_id"],
            "timestamp": detection["timestamp"]
        }
    }


# ============================================================
# GET OBJECT HISTORY
# ============================================================

@app.get("/object/{nfc_uid}/history")
def get_object_history(nfc_uid: str):

    nfc_uid = normalize_uid(nfc_uid)

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT
            id,
            nfc_uid,
            reader_id,
            timestamp
        FROM detections
        WHERE nfc_uid = ?
        ORDER BY timestamp DESC
        """,
        (nfc_uid,)
    )

    rows = cursor.fetchall()

    conn.close()

    history = []

    for row in rows:

        history.append(
            {
                "id": row["id"],
                "nfc_uid": row["nfc_uid"],
                "reader_id": row["reader_id"],
                "timestamp": row["timestamp"]
            }
        )

    return {
        "status": "success",
        "count": len(history),
        "history": history
    }


# ============================================================
# GET READER LOCATION
# ============================================================

@app.get("/reader/{reader_id}/location")
def get_reader_location(reader_id: str):

    reader_id = reader_id.strip().upper()

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT
            reader_id,
            building,
            floor,
            room
        FROM reader_locations
        WHERE reader_id = ?
        """,
        (reader_id,)
    )

    reader = cursor.fetchone()

    conn.close()

    if reader is None:

        raise HTTPException(
            status_code=404,
            detail=f"Reader '{reader_id}' not found"
        )

    return {
        "status": "success",
        "reader": {
            "reader_id": reader["reader_id"],
            "building": reader["building"],
            "floor": reader["floor"],
            "room": reader["room"]
        }
    }


# ============================================================
# GET OBJECT + LATEST LOCATION
#
# This is useful for future frontend functions.
# ============================================================

@app.get("/object/{nfc_uid}")
def get_object_details(nfc_uid: str):

    nfc_uid = normalize_uid(nfc_uid)

    conn = get_connection()
    cursor = conn.cursor()

    # --------------------------------------------------------
    # Object
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT
            nfc_uid,
            name,
            registered_at
        FROM objects
        WHERE nfc_uid = ?
        """,
        (nfc_uid,)
    )

    obj = cursor.fetchone()

    if obj is None:

        conn.close()

        raise HTTPException(
            status_code=404,
            detail="Object not found"
        )

    # --------------------------------------------------------
    # Latest detection
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT
            id,
            nfc_uid,
            reader_id,
            timestamp
        FROM detections
        WHERE nfc_uid = ?
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        (nfc_uid,)
    )

    detection = cursor.fetchone()

    location = None

    if detection is not None:

        cursor.execute(
            """
            SELECT
                reader_id,
                building,
                floor,
                room
            FROM reader_locations
            WHERE reader_id = ?
            """,
            (detection["reader_id"],)
        )

        reader = cursor.fetchone()

        if reader is not None:

            location = {
                "reader_id": reader["reader_id"],
                "building": reader["building"],
                "floor": reader["floor"],
                "room": reader["room"]
            }

    conn.close()

    detection_data = None

    if detection is not None:

        detection_data = {
            "id": detection["id"],
            "nfc_uid": detection["nfc_uid"],
            "reader_id": detection["reader_id"],
            "timestamp": detection["timestamp"]
        }

    return {
        "status": "success",
        "object": {
            "nfc_uid": obj["nfc_uid"],
            "name": obj["name"],
            "registered_at": obj["registered_at"]
        },
        "latest_detection": detection_data,
        "location": location
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health_check():

    return {
        "status": "healthy",
        "database": str(DB_PATH),
        "timestamp": get_current_timestamp()
    }