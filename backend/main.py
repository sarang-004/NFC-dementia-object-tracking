from fastapi import FastAPI
from pydantic import BaseModel
import sqlite3


# --------------------------------
# Create FastAPI application
# --------------------------------

app = FastAPI(
    title="NFC Dementia Object Tracking API"
)


# --------------------------------
# Detection event structure
# --------------------------------

class DetectionEvent(BaseModel):
    nfc_uid: str
    reader_id: str
    timestamp: str


# --------------------------------
# Database setup
# --------------------------------

def init_db():

    connection = sqlite3.connect("nfc_tracking.db")

    cursor = connection.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS detections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nfc_uid TEXT NOT NULL,
            reader_id TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)

    connection.commit()
    connection.close()


init_db()


# --------------------------------
# Basic test endpoint
# --------------------------------

@app.get("/")
def home():

    return {
        "status": "success",
        "message": "NFC Tracking Backend is running"
    }


# --------------------------------
# NFC Detection endpoint
# --------------------------------

@app.post("/detection")
def receive_detection(event: DetectionEvent):

    connection = sqlite3.connect("nfc_tracking.db")

    cursor = connection.cursor()

    cursor.execute("""
        INSERT INTO detections
        (nfc_uid, reader_id, timestamp)
        VALUES (?, ?, ?)
    """, (
        event.nfc_uid,
        event.reader_id,
        event.timestamp
    ))

    connection.commit()
    connection.close()

    print("\n==============================")
    print("      NFC DETECTION RECEIVED")
    print("==============================")

    print(f"NFC UID   : {event.nfc_uid}")
    print(f"Reader ID : {event.reader_id}")
    print(f"Timestamp : {event.timestamp}")

    return {
        "status": "success",
        "message": "Detection recorded"
    }