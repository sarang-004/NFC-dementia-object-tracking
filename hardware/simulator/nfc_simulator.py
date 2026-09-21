from datetime import datetime, timezone
import json
import time

# --------------------------------
# Reader configuration
# --------------------------------

READER_ID = "R03"


# --------------------------------
# Simulated NFC tags
# --------------------------------

OBJECTS = {
    "1": {
        "name": "Keys",
        "uid": "04A3B291"
    },
    "2": {
        "name": "Glasses",
        "uid": "039812AF"
    },
    "3": {
        "name": "Medicine",
        "uid": "A1B2947C"
    }
}


# --------------------------------
# Duplicate detection protection
# --------------------------------

last_uid = None
last_detection_time = 0


# --------------------------------
# Generate detection event
# --------------------------------

def generate_detection(object_data):

    event = {
        "nfc_uid": object_data["uid"],
        "reader_id": READER_ID,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    return event


# --------------------------------
# Main reader loop
# --------------------------------

while True:

    print("\n==============================")
    print("       NFC SIMULATOR")
    print("==============================")

    print(f"Reader ID: {READER_ID}")
    print("Waiting for NFC tag...")

    print("\nAvailable simulated tags:")

    for key, obj in OBJECTS.items():
        print(f"{key}. {obj['name']}")

    print("0. Exit")

    choice = input("\nSimulate tag scan: ")

    if choice == "0":
        print("Stopping reader...")
        break

    if choice not in OBJECTS:
        print("Unknown tag.")
        continue

    object_data = OBJECTS[choice]

    print("\nTag detected!")

    # --------------------------------
    # Duplicate detection check
    # --------------------------------

    current_time = time.time()

    if (
        object_data["uid"] == last_uid
        and current_time - last_detection_time < 5
    ):
        print("Duplicate detection ignored.")
        continue

    # Update last detection information
    last_uid = object_data["uid"]
    last_detection_time = current_time

    time.sleep(0.5)

    # --------------------------------
    # Generate event
    # --------------------------------

    event = generate_detection(object_data)

    print("\nDetection event:")
    print(json.dumps(event, indent=4))