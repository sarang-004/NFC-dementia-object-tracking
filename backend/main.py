from fastapi import FastAPI
from pydantic import BaseModel


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