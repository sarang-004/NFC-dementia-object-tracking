// =====================================================
// NFC SMART OBJECT TRACKING SYSTEM
// CAREGIVER PORTAL
// =====================================================


// =====================================================
// CONFIGURATION
// =====================================================

const API_BASE = "http://10.125.99.82:8000";


// =====================================================
// APPLICATION STATE
// =====================================================

let objects = [];
let selected = null;
let currentPage = "dashboard";

let dashboardRefreshTimer = null;
let isRefreshing = false;


// =====================================================
// SHORT DOM HELPER
// =====================================================

const $ = selector =>
  document.querySelector(selector);


// =====================================================
// OBJECT HELPERS
// =====================================================

function getObject(uid) {

  if (!uid) {
    return null;
  }

  const normalized =
    uid.trim().toUpperCase();

  return objects.find(
    object =>
      object.id.toUpperCase() === normalized
  ) || null;
}


function getObjectIcon(name) {

  if (!name) {
    return "🏷️";
  }

  const lower =
    name.toLowerCase();

  if (
    lower.includes("key")
  ) {
    return "🔑";
  }

  if (
    lower.includes("glass")
  )
  {
    return "👓";
  }

  if (
    lower.includes("medicine") ||
    lower.includes("tablet") ||
    lower.includes("pill")
  ) {
    return "💊";
  }

  if (
    lower.includes("wallet") ||
    lower.includes("purse")
  ) {
    return "👛";
  }

  if (
    lower.includes("phone") ||
    lower.includes("mobile")
  ) {
    return "📱";
  }

  if (
    lower.includes("watch")
  ) {
    return "⌚";
  }

  if (
    lower.includes("remote")
  ) {
    return "🎮";
  }

  if (
    lower.includes("bottle")
  ) {
    return "🍼";
  }

  if (
    lower.includes("bag")
  ) {
    return "👜";
  }

  return "🏷️";
}


// =====================================================
// HTML SAFETY
// =====================================================

function escapeHtml(value) {

  if (value === null ||
      value === undefined) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


// =====================================================
// TOAST
// =====================================================

function toast(message) {

  const t =
    $("#toast");

  if (!t) {
    return;
  }

  t.textContent =
    "✓ " + message;

  t.style.display =
    "block";

  clearTimeout(
    toast.timeout
  );

  toast.timeout =
    setTimeout(() => {

      t.style.display =
        "none";

    }, 2500);
}


// =====================================================
// DATE / TIME
// =====================================================

function formatTimestamp(timestamp) {

  if (!timestamp) {
    return "—";
  }

  const date =
    new Date(timestamp);

  if (
    isNaN(
      date.getTime()
    )
  ) {
    return timestamp;
  }

  return date.toLocaleString(
    "en-IN",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }
  );
}


function isToday(timestamp) {

  if (!timestamp) {
    return false;
  }

  const date =
    new Date(timestamp);

  if (
    isNaN(
      date.getTime()
    )
  ) {
    return false;
  }

  const today =
    new Date();

  return (
    date.getDate() ===
      today.getDate() &&
    date.getMonth() ===
      today.getMonth() &&
    date.getFullYear() ===
      today.getFullYear()
  );
}


// =====================================================
// BACKEND API
// =====================================================


// -----------------------------------------------------
// GET ALL REGISTERED OBJECTS
// -----------------------------------------------------

async function getRegisteredObjects() {

  try {

    const response =
      await fetch(
        `${API_BASE}/objects`
      );

    if (!response.ok) {
      throw new Error(
        `Objects request failed (${response.status})`
      );
    }

    const data =
      await response.json();

    if (
      data.status !==
      "success"
    ) {
      throw new Error(
        data.message ||
        "Could not load objects"
      );
    }

    return (
      data.objects || []
    ).map(object => ({

      id:
        object.nfc_uid,

      name:
        object.name ||
        "Unnamed Object",

      icon:
        getObjectIcon(
          object.name
        ),

      registeredAt:
        object.registered_at,

      building:
        "—",

      floor:
        "—",

      room:
        "—",

      reader:
        "—",

      time:
        "—",

      timestamp:
        null,

      status:
        "Not detected"

    }));

  } catch (error) {

    console.error(
      "Object loading error:",
      error
    );

    return [];

  }
}


// -----------------------------------------------------
// REFRESH OBJECT LIST
// -----------------------------------------------------

async function refreshObjects(
  showError = true
) {

  try {

    const loaded =
      await getRegisteredObjects();

    objects =
      loaded;

    /*
     * Keep selected object valid.
     */
    if (selected) {

      selected =
        getObject(
          selected.id
        );

    }

    if (
      !selected &&
      objects.length > 0
    ) {

      selected =
        objects[0];

    }

    return objects;

  } catch (error) {

    console.error(
      error
    );

    if (showError) {

      toast(
        "Could not load objects"
      );

    }

    return objects;

  }
}


// -----------------------------------------------------
// GET LATEST DETECTION
// -----------------------------------------------------

async function getLatestDetection(
  uid,
  showError = false
) {

  try {

    const response =
      await fetch(
        `${API_BASE}/object/${encodeURIComponent(uid)}/latest`
      );

    if (!response.ok) {

      if (
        response.status === 404
      ) {
        return null;
      }

      throw new Error(
        `Detection request failed (${response.status})`
      );

    }

    const data =
      await response.json();

    if (
      data.status !==
      "success"
    ) {
      return null;
    }

    return data;

  } catch (error) {

    console.error(
      `Detection error for ${uid}:`,
      error
    );

    if (showError) {

      toast(
        "Could not connect to backend"
      );

    }

    return null;
  }
}


// -----------------------------------------------------
// GET READER LOCATION
// -----------------------------------------------------

async function getReaderLocation(
  readerId,
  showError = false
) {

  if (!readerId) {
    return null;
  }

  try {

    const response =
      await fetch(
        `${API_BASE}/reader/${encodeURIComponent(readerId)}/location`
      );

    if (!response.ok) {

      if (
        response.status === 404
      ) {
        return null;
      }

      throw new Error(
        `Location request failed (${response.status})`
      );

    }

    const data =
      await response.json();

    if (
      data.status !==
      "success"
    ) {
      return null;
    }

    return data;

  } catch (error) {

    console.error(
      `Location error for ${readerId}:`,
      error
    );

    if (showError) {

      toast(
        "Could not load reader location"
      );

    }

    return null;
  }
}


// -----------------------------------------------------
// REGISTER OBJECT
// -----------------------------------------------------

async function registerObject(
  name,
  uid
) {

  const response =
    await fetch(
      `${API_BASE}/objects/register`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            nfc_uid:
              uid,

            name:
              name
          })
      }
    );


  let data = null;

  try {

    data =
      await response.json();

  } catch {

    data = null;

  }


if (!response.ok) {

  let message = `Registration failed (${response.status})`;

  if (data) {

    if (typeof data.detail === "string") {
      message = data.detail;
    }

    else if (Array.isArray(data.detail)) {

      message = data.detail
        .map(error => {

          if (typeof error === "string") {
            return error;
          }

          return error.msg || JSON.stringify(error);

        })
        .join(", ");

    }

    else if (data.message) {

      message =
        typeof data.message === "string"
          ? data.message
          : JSON.stringify(data.message);

    }

  }

  throw new Error(message);
}


  if (
    data &&
    data.status !==
    "success"
  ) {

    throw new Error(
      data.message ||
      "Registration failed"
    );

  }


  return data;

}


// =====================================================
// UPDATE OBJECT WITH LATEST DETECTION
// =====================================================

async function updateObjectDetectionInfo() {

  if (
    objects.length === 0
  ) {
    return;
  }


  /*
   * Fetch latest detection for
   * every registered object.
   */

  await Promise.all(

    objects.map(
      async object => {

        const detection =
          await getLatestDetection(
            object.id
          );


        if (
          !detection
        ) {

          object.status =
            "Not detected";

          object.reader =
            "—";

          object.building =
            "—";

          object.floor =
            "—";

          object.room =
            "—";

          object.time =
            "—";

          object.timestamp =
            null;

          return;

        }


        object.reader =
          detection.reader_id;

        object.timestamp =
          detection.timestamp;

        object.time =
          formatTimestamp(
            detection.timestamp
          );

        object.status =
          "Detected";


        /*
         * Resolve reader → location.
         */

        const location =
          await getReaderLocation(
            detection.reader_id
          );


        if (
          location
        ) {

          object.building =
            location.building ||
            "—";

          object.floor =
            location.floor ||
            "—";

          object.room =
            location.room ||
            "—";

        }

      }
    )

  );

}


// =====================================================
// NAVIGATION
// =====================================================

function nav(page) {

  currentPage =
    page;


  /*
   * Update sidebar active state.
   */

  document
    .querySelectorAll(".nav")
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.page ===
          page
      );

    });


  const titles = {

    dashboard:
      "Dashboard",

    find:
      "Find Object",

    voice:
      "Voice Interaction",

    objects:
      "Tagged Objects",

    history:
      "Activity History",

    locations:
      "Locations",

    alerts:
      "Alerts"

  };


  const pageTitle =
    $("#pageTitle");


  if (pageTitle) {

    pageTitle.textContent =
      titles[page] ||
      "Dashboard";

  }


  render();

}


// -----------------------------------------------------
// NAV BUTTONS
// -----------------------------------------------------

document
  .querySelectorAll(".nav")
  .forEach(
    button => {

      button.onclick =
        () =>
          nav(
            button.dataset.page
          );

    }
  );


// -----------------------------------------------------
// NOTIFICATION BUTTON
// -----------------------------------------------------

const bell =
  $("#bell");

if (bell) {

  bell.onclick =
    () =>
      toast(
        "No new notifications"
      );

}


// =====================================================
// RENDER
// =====================================================

function render() {

  const container =
    $("#content");


  if (!container) {
    return;
  }


  switch (
    currentPage
  ) {

    case "dashboard":

      container.innerHTML =
        dashboard();

      break;


    case "find":

      container.innerHTML =
        findPage();

      break;


    case "voice":

      container.innerHTML =
        voicePage();

      break;


    case "objects":

      container.innerHTML =
        objectsPage();

      break;


    case "history":

      container.innerHTML =
        historyPage();

      break;


    case "locations":

      container.innerHTML =
        locationsPage();

      break;


    case "alerts":

      container.innerHTML =
        alertsPage();

      break;


    default:

      currentPage =
        "dashboard";

      container.innerHTML =
        dashboard();

  }


  bind();


  /*
   * Page-specific asynchronous
   * data loading.
   */

  hydrateCurrentPage();

}


// =====================================================
// PAGE HYDRATION
// =====================================================

async function hydrateCurrentPage() {

  switch (
    currentPage
  ) {

    case "dashboard":

      await loadDashboardDetections();

      break;


    case "objects":

      await loadObjectsPageData();

      break;


    case "history":

      await loadInitialHistory();

      break;


    case "locations":

      await loadLocationsPageData();

      break;


    case "alerts":

      await loadAlertsPageData();

      break;

  }

}


// =====================================================
// STAT CARD
// =====================================================

function stat(
  icon,
  title,
  value,
  sub
) {

  return `

    <div class="stat">

      <div class="ico">
        ${icon}
      </div>

      <div>

        <span>
          ${title}
        </span>

        <strong>
          ${value}
        </strong>

        <small>
          ${sub}
        </small>

      </div>

    </div>

  `;

}


// =====================================================
// DASHBOARD
// =====================================================

function dashboard() {

  return `

    <section class="welcome">

      <div>

        <h2>
          Good evening, Caregiver 👋
        </h2>

        <p>
          Find a tagged object and see its
          last known location.
        </p>

      </div>


      <button
        class="primary"
        onclick="nav('find')"
      >
        🔎 Find an object
      </button>

    </section>


    <section class="stats">

      ${stat(
        "🏷️",
        "Tagged Objects",
        objects.length,
        "Registered NFC objects"
      )}


      ${stat(
        "✓",
        "Detected Today",
        "—",
        "Latest detections today"
      )}


      ${stat(
        "⌖",
        "Locations",
        "—",
        "Active reader locations"
      )}


      ${stat(
        "⚠",
        "Attention Needed",
        "—",
        "Objects without detection"
      )}

    </section>


    <div class="grid2">


      <!-- ========================================= -->
      <!-- RECENT ACTIVITY -->
      <!-- ========================================= -->

      <section class="panel">

        <div class="panel-head">

          <div>

            <h3>
              Recently detected
            </h3>

            <p>
              Latest NFC events
            </p>

          </div>


          <button
            class="text"
            onclick="nav('history')"
          >
            View history →
          </button>

        </div>


        <div class="activity">

          <div
            style="
              padding:20px;
              text-align:center;
              color:#718096
            "
          >
            Loading NFC detections...
          </div>

        </div>

      </section>


      <!-- ========================================= -->
      <!-- QUICK FIND -->
      <!-- ========================================= -->

      <section class="panel">

        <div class="panel-head">

          <div>

            <h3>
              Quick find
            </h3>

            <p>
              Select an object to locate it
            </p>

          </div>

        </div>


        <div class="quick">

          ${
            objects.length === 0

              ? `

                <div
                  style="
                    padding:20px;
                    color:#718096
                  "
                >
                  No registered objects.
                </div>

              `

              :

                objects
                  .slice(0, 5)
                  .map(
                    object => `

                      <button
                        data-object="${escapeHtml(
                          object.id
                        )}"
                      >

                        <span class="objicon">
                          ${object.icon}
                        </span>


                        <span class="grow">

                          <b>
                            ${escapeHtml(
                              object.name
                            )}
                          </b>

                          <small>
                            ${
                              object.room !==
                              "—"
                                ? escapeHtml(
                                    object.room
                                  )
                                : `NFC: ${escapeHtml(
                                    object.id
                                  )}`
                            }
                          </small>

                        </span>


                        →

                      </button>

                    `
                  )
                  .join("")

          }

        </div>


        <button
          class="secondary full"
          id="scan"
        >
          Simulate NFC scan
        </button>

      </section>

    </div>


    <!-- =========================================== -->
    <!-- SYSTEM WORKFLOW -->
    <!-- =========================================== -->

    <section class="workflow">

      <div class="step">

        <div class="stepnum">
          01
        </div>

        <b>
          NFC Tag
        </b>

        <small>
          Object identity
        </small>

      </div>


      <div class="arrow">
        →
      </div>


      <div class="step">

        <div class="stepnum">
          02
        </div>

        <b>
          PN532
        </b>

        <small>
          Reads tag
        </small>

      </div>


      <div class="arrow">
        →
      </div>


      <div class="step">

        <div class="stepnum">
          03
        </div>

        <b>
          ESP32
        </b>

        <small>
          Sends data
        </small>

      </div>


      <div class="arrow">
        →
      </div>


      <div class="step">

        <div class="stepnum">
          04
        </div>

        <b>
          Backend
        </b>

        <small>
          Stores event
        </small>

      </div>


      <div class="arrow">
        →
      </div>


      <div class="step">

        <div class="stepnum">
          05
        </div>

        <b>
          Web App
        </b>

        <small>
          Caregiver view
        </small>

      </div>

    </section>

  `;

}


// =====================================================
// DASHBOARD LIVE DATA
// =====================================================

async function loadDashboardDetections() {

  if (currentPage !== "dashboard") {
    return;
  }

  const results = [];

  // Get the latest detection for every registered object
  for (const object of objects) {

    const data = await getLatestDetection(object.id);

    if (
      data &&
      data.status === "success" &&
      data.found === true &&
      data.detection
    ) {

      results.push({
        object: object,
        detection: data.detection
      });
    }
  }

  // Sort newest first
  results.sort(
    (a, b) =>
      new Date(b.detection.timestamp) -
      new Date(a.detection.timestamp)
  );

  console.log(
    "Latest NFC detections:",
    results
  );

  const activity =
    document.querySelector(".activity");

  if (!activity) {
    return;
  }

  // Nothing detected yet
  if (results.length === 0) {

    activity.innerHTML = `
      <div
        style="
          padding:20px;
          text-align:center;
          color:#718096
        "
      >
        No NFC detections recorded yet.
      </div>
    `;

    return;
  }

  // Display detections
  activity.innerHTML = results
    .map(item => {

      const object = item.object;
      const detection = item.detection;

      return `
        <div class="row">

          <div class="objicon">
            ${object.icon || "🏷️"}
          </div>

          <div class="grow">

            <b>
              ${object.name}
            </b>

            <small>
              Reader ${detection.reader_id}
              • ${detection.nfc_uid}
            </small>

          </div>

          <time>
            ${formatTimestamp(
              detection.timestamp
            )}
          </time>

        </div>
      `;

    })
    .join("");
}


// =====================================================
// FIND OBJECT PAGE
// =====================================================

function findPage() {

  return `

    <div class="find-grid">


      <!-- ========================================= -->
      <!-- SEARCH -->
      <!-- ========================================= -->

      <section>

        <div class="search">

          <span>
            ⌕
          </span>

          <input
            id="search"
            placeholder="Enter NFC UID or object name..."
            value="${
              escapeHtml(
                window.findTerm ||
                ""
              )
            }"
          >

        </div>


        <div
          class="panel"
          style="
            margin-top:12px;
            padding:15px
          "
        >

          <div class="panel-head">

            <div>

              <h3>
                NFC Object Lookup
              </h3>

              <p>
                Enter an NFC UID or object name
                to find its last known location.
              </p>

            </div>

          </div>


          <button
            class="primary full"
            id="lookupNFC"
          >
            🔎 Find Object
          </button>


          <div
            id="lookupResult"
            style="
              margin-top:15px
            "
          ></div>


          <!-- Registered objects -->

          <div
            style="
              margin-top:18px
            "
          >

            <p
              style="
                font-size:9px;
                font-weight:700;
                color:#718096;
                margin-bottom:8px
              "
            >
              REGISTERED OBJECTS
            </p>


            <div>

              ${
                objects.length === 0

                  ? `
                    <small>
                      No registered objects.
                    </small>
                  `

                  :

                    objects
                      .map(
                        object => `

                          <button
                            class="secondary full"
                            style="
                              margin-bottom:6px;
                              text-align:left
                            "
                            data-object="${
                              escapeHtml(
                                object.id
                              )
                            }"
                          >

                            ${object.icon}

                            ${
                              escapeHtml(
                                object.name
                              )
                            }

                          </button>

                        `
                      )
                      .join("")

              }

            </div>

          </div>

        </div>

      </section>


      ${locationCard()}

    </div>

  `;

}


// =====================================================
// LOCATION CARD
// =====================================================

function locationCard() {

  return `

    <section class="location-card">


      <div class="map">

        <span class="pin">
          ●
        </span>

        <span
          class="maplabel"
          id="mapLabel"
        >
          Search for an NFC tag
        </span>

      </div>


      <div class="locbody">

        <span class="label">
          LAST KNOWN LOCATION
        </span>


        <h2
          id="locationObject"
        >
          🏷️ NFC Tag
        </h2>


        <div class="highlight">

          <span>
            ⌖
          </span>


          <div>

            <b
              id="locationRoom"
            >
              —
            </b>


            <small
              id="locationDetails"
            >
              Building — • Floor — • Reader —
            </small>

          </div>

        </div>


        <div class="timebox">

          <span>
            Last detected
          </span>


          <b
            id="locationTime"
          >
            —
          </b>


          <small
            id="locationUID"
          >
            NFC UID: —
          </small>

        </div>


        <button
          class="primary full"
          id="route"
        >
          📍 Show location
        </button>


        <p
          style="
            font-size:8px;
            color:#9aa5b1;
            text-align:center
          "
        >
          Location is the most recent NFC
          detection point.
        </p>

      </div>

    </section>

  `;

}


// =====================================================
// PERFORM OBJECT LOOKUP
// =====================================================

async function performLookup(
  searchValue
) {

  const value =
    searchValue
      .trim();


  if (!value) {

    toast(
      "Enter an NFC UID or object name"
    );

    return;

  }


  const lower =
    value.toLowerCase();


  /*
   * First search the locally
   * registered objects.
   */

  let object =
    objects.find(
      item =>
        item.id.toUpperCase() ===
        value.toUpperCase()
    );


  /*
   * If not a UID, search by name.
   */

  if (!object) {

    object =
      objects.find(
        item =>
          item.name
            .toLowerCase()
            .includes(lower)
      );

  }


  /*
   * If object doesn't exist in
   * registration database, still
   * allow UID lookup against
   * the detection endpoint.
   */

  const uid =
    object
      ? object.id
      : value.toUpperCase();


  const result =
    $("#lookupResult");


  if (result) {

    result.innerHTML = `

      <p
        style="
          color:#718096;
          font-size:10px
        "
      >
        Searching...
      </p>

    `;

  }


  const detection =
    await getLatestDetection(
      uid,
      true
    );


  if (
    !detection
  ) {

    if (result) {

      result.innerHTML = `

        <p
          style="
            color:#c05621;
            font-size:10px
          "
        >
          No detection found for this NFC tag.
        </p>

      `;

    }

    clearLocationCard();

    return;

  }


  /*
   * Resolve reader location.
   */

  const location =
    await getReaderLocation(
      detection.reader_id,
      true
    );


  /*
   * Display lookup result.
   */

  if (result) {

    result.innerHTML = `

      <div class="highlight">

        <span>
          ${
            object
              ? object.icon
              : "🏷️"
          }
        </span>


        <div>

          <b>
            ${
              object
                ? escapeHtml(
                    object.name
                  )
                : "NFC Tag Detected"
            }
          </b>


          <small>
            UID:
            ${escapeHtml(
              detection.nfc_uid
            )}
          </small>

        </div>

      </div>


      <div
        class="timebox"
        style="
          margin-top:10px
        "
      >

        <span>
          Last detected by
        </span>


        <b>
          Reader
          ${escapeHtml(
            detection.reader_id
          )}
        </b>


        <small>
          ${formatTimestamp(
            detection.timestamp
          )}
        </small>

      </div>

    `;

  }


  /*
   * Update location card.
   */

  updateLocationCard(
    object,
    detection,
    location
  );

}


// =====================================================
// UPDATE LOCATION CARD
// =====================================================

function updateLocationCard(
  object,
  detection,
  location
) {

  const mapLabel =
    $("#mapLabel");

  const locationObject =
    $("#locationObject");

  const locationRoom =
    $("#locationRoom");

  const locationDetails =
    $("#locationDetails");

  const locationTime =
    $("#locationTime");

  const locationUID =
    $("#locationUID");


  const icon =
    object
      ? object.icon
      : "🏷️";


  const name =
    object
      ? object.name
      : "NFC Tag";


  if (
    mapLabel
  ) {

    mapLabel.textContent =
      location
        ? `${location.room} • ${location.reader_id}`
        : `Reader ${detection.reader_id}`;

  }


  if (
    locationObject
  ) {

    locationObject.textContent =
      `${icon} ${name}`;

  }


  if (
    location
  ) {

    if (
      locationRoom
    ) {

      locationRoom.textContent =
        location.room ||
        "Unknown room";

    }


    if (
      locationDetails
    ) {

      locationDetails.textContent =
        `${location.building || "—"} • ${
          location.floor || "—"
        } • Reader ${
          location.reader_id ||
          detection.reader_id
        }`;

    }

  } else {

    if (
      locationRoom
    ) {

      locationRoom.textContent =
        "Location unavailable";

    }


    if (
      locationDetails
    ) {

      locationDetails.textContent =
        `Reader ${detection.reader_id}`;

    }

  }


  if (
    locationTime
  ) {

    locationTime.textContent =
      formatTimestamp(
        detection.timestamp
      );

  }


  if (
    locationUID
  ) {

    locationUID.textContent =
      `NFC UID: ${detection.nfc_uid}`;

  }

}


// =====================================================
// CLEAR LOCATION CARD
// =====================================================

function clearLocationCard() {

  const elements = {

    mapLabel:
      "Search for an NFC tag",

    locationObject:
      "🏷️ NFC Tag",

    locationRoom:
      "—",

    locationDetails:
      "Building — • Floor — • Reader —",

    locationTime:
      "—",

    locationUID:
      "NFC UID: —"

  };


  Object.entries(
    elements
  ).forEach(
    ([id, value]) => {

      const element =
        $(`#${id}`);

      if (element) {

        element.textContent =
          value;

      }

    }
  );

}


// =====================================================
// OBJECTS PAGE
// =====================================================

function objectsPage() {

  return `

    <div class="intro">


      <div>

        <h2>
          Tagged Objects
        </h2>

        <p>
          Registered NFC stickers and their
          last detection details.
        </p>

      </div>


      <button
        class="primary"
        id="addObjectBtn"
      >
        ＋ Add object
      </button>

    </div>


    <section class="table">


      <div class="thead">

        <span>
          Object
        </span>

        <span>
          NFC ID
        </span>

        <span>
          Location
        </span>

        <span>
          Last detected
        </span>

        <span>
          Status
        </span>

      </div>


      ${
        objects.length === 0

          ? `

            <div
              style="
                padding:25px;
                text-align:center;
                color:#718096
              "
            >

              No registered objects.

            </div>

          `

          :

            objects
              .map(
                object => `

                  <div class="tr">

                    <span>

                      <b>
                        ${object.icon}

                        ${escapeHtml(
                          object.name
                        )}
                      </b>

                    </span>


                    <span>

                      ${escapeHtml(
                        object.id
                      )}

                    </span>


                    <span>

                      ${
                        object.building !==
                        "—"

                          ? `
                            ${escapeHtml(
                              object.building
                            )},
                            ${escapeHtml(
                              object.floor
                            )}

                            <small>
                              ${escapeHtml(
                                object.room
                              )}
                              •
                              ${escapeHtml(
                                object.reader
                              )}
                            </small>
                          `

                          : `
                            Not detected yet
                          `
                      }

                    </span>


                    <span>

                      ${escapeHtml(
                        object.time
                      )}

                    </span>


                    <span
                      class="${
                        object.status ===
                        "Detected"
                          ? "success"
                          : "warning"
                      }"
                    >

                      ${escapeHtml(
                        object.status
                      )}

                    </span>

                  </div>

                `
              )
              .join("")

      }

    </section>

  `;

}


// =====================================================
// OBJECTS PAGE LIVE DATA
// =====================================================

async function loadObjectsPageData() {

  if (
    currentPage !==
    "objects"
  ) {
    return;
  }


  await updateObjectDetectionInfo();


  /*
   * Re-render the table with
   * updated location information.
   *
   * Do not call render(), because
   * that would bind everything again.
   */

  const container =
    $("#content");


  if (
    container
  ) {

    container.innerHTML =
      objectsPage();

    bind();

  }

}


// =====================================================
// ADD OBJECT MODAL
// =====================================================

function showAddObjectForm() {

  const existing =
    $("#addObjectModal");


  if (existing) {

    existing.remove();

  }


  document.body.insertAdjacentHTML(
    "beforeend",
    `

      <div
        id="addObjectModal"
        style="
          position:fixed;
          inset:0;
          background:rgba(0,0,0,.35);
          display:flex;
          align-items:center;
          justify-content:center;
          z-index:9999;
        "
      >

        <div
          style="
            background:white;
            width:400px;
            max-width:90%;
            border-radius:14px;
            padding:24px;
            box-shadow:
              0 20px 50px
              rgba(0,0,0,.2);
          "
        >

          <h2
            style="
              margin-bottom:6px;
            "
          >
            Add Tagged Object
          </h2>


          <p
            style="
              color:#718096;
              font-size:10px;
              margin-bottom:20px;
            "
          >
            Register an NFC sticker with an
            everyday object.
          </p>


          <!-- OBJECT NAME -->

          <label
            style="
              display:block;
              font-size:11px;
              font-weight:600;
              margin-bottom:6px;
            "
          >
            Object Name
          </label>


          <input
            id="newObjectName"
            type="text"
            placeholder="e.g. House Keys"
            autocomplete="off"
            style="
              width:100%;
              padding:11px;
              border:
                1px solid #d9e1e8;
              border-radius:8px;
              margin-bottom:15px;
              box-sizing:border-box;
            "
          />


          <!-- NFC UID -->

          <label
            style="
              display:block;
              font-size:11px;
              font-weight:600;
              margin-bottom:6px;
            "
          >
            NFC UID
          </label>


          <input
            id="newObjectUID"
            type="text"
            placeholder="e.g. 53090BF5130001"
            autocomplete="off"
            style="
              width:100%;
              padding:11px;
              border:
                1px solid #d9e1e8;
              border-radius:8px;
              margin-bottom:8px;
              box-sizing:border-box;
              text-transform:uppercase;
            "
          />


          <small
            style="
              display:block;
              color:#718096;
              font-size:9px;
              margin-bottom:20px;
            "
          >
            The UID must match the UID printed/read
            from the NFC tag.
          </small>


          <!-- BUTTONS -->

          <div
            style="
              display:flex;
              gap:10px;
            "
          >

            <button
              id="cancelAddObject"
              class="secondary"
              style="
                flex:1;
              "
            >
              Cancel
            </button>


            <button
              id="saveObject"
              class="primary"
              style="
                flex:1;
              "
            >
              Save Object
            </button>

          </div>

        </div>

      </div>

    `
  );


  /*
   * Cancel
   */

  const cancel =
    $("#cancelAddObject");


  if (cancel) {

    cancel.onclick =
      () => {

        $("#addObjectModal")
          ?.remove();

      };

  }


  /*
   * Save
   */

  const save =
    $("#saveObject");


  if (save) {

    save.onclick =
      registerNewObject;

  }


  /*
   * Allow Enter key.
   */

  const nameInput =
    $("#newObjectName");

  const uidInput =
    $("#newObjectUID");


  [nameInput, uidInput]
    .forEach(input => {

      if (!input) {
        return;
      }

      input.addEventListener(
        "keydown",
        event => {

          if (
            event.key ===
            "Enter"
          ) {

            registerNewObject();

          }

        }
      );

    });


  /*
   * Focus object name.
   */

  if (nameInput) {

    setTimeout(
      () =>
        nameInput.focus(),
      50
    );

  }

}


// =====================================================
// REGISTER NEW OBJECT FROM UI
// =====================================================

async function registerNewObject() {

  const nameInput =
    $("#newObjectName");

  const uidInput =
    $("#newObjectUID");


  if (
    !nameInput ||
    !uidInput
  ) {
    return;
  }


  const name =
    nameInput.value.trim();


  const uid =
    uidInput.value
      .trim()
      .toUpperCase();


  /*
   * Validate name.
   */

  if (!name) {

    toast(
      "Enter an object name"
    );

    nameInput.focus();

    return;

  }


  /*
   * Validate UID.
   */

  if (!uid) {

    toast(
      "Enter the NFC UID"
    );

    uidInput.focus();

    return;

  }


  /*
   * NFC UIDs returned by
   * the PN532 are hexadecimal.
   */

  if (
    !/^[0-9A-F]+$/i.test(
      uid
    )
  ) {

    toast(
      "NFC UID must contain only 0-9 and A-F"
    );

    uidInput.focus();

    return;

  }


  /*
   * Check duplicate locally.
   */

  const existing =
    getObject(uid);


  if (existing) {

    const replace =
      confirm(
        `${existing.name} is already registered with this UID.\n\nReplace its name with "${name}"?`
      );


    if (!replace) {
      return;
    }

  }


  const saveButton =
    $("#saveObject");


  if (saveButton) {

    saveButton.disabled =
      true;

    saveButton.textContent =
      "Saving...";

  }


  try {

    await registerObject(
      name,
      uid
    );


    /*
     * Reload backend data.
     */

    await refreshObjects(
      false
    );


    /*
     * Close modal.
     */

    $("#addObjectModal")
      ?.remove();


    /*
     * Update detection information.
     */

    await updateObjectDetectionInfo();


    /*
     * Refresh page.
     */

    render();


    toast(
      `${name} registered successfully`
    );


  } catch (error) {

    console.error(
      "Registration error:",
      error
    );


    toast(
      error.message ||
      "Could not register object"
    );


    if (saveButton) {

      saveButton.disabled =
        false;

      saveButton.textContent =
        "Save Object";

    }

  }

}


// =====================================================
// HISTORY PAGE
// =====================================================

function historyPage() {

  return `

    <div class="intro">


      <div>

        <h2>
          Activity History
        </h2>

        <p>
          Real NFC detection events from
          the backend.
        </p>

      </div>


      <select
        id="historyTag"
        class="secondary"
      >

        ${
          objects.length === 0

            ? `

              <option value="">
                No objects registered
              </option>

            `

            :

              objects
                .map(
                  object => `

                    <option
                      value="${escapeHtml(
                        object.id
                      )}"
                      ${
                        selected &&
                        selected.id ===
                          object.id
                          ? "selected"
                          : ""
                      }
                    >

                      ${escapeHtml(
                        object.name
                      )}

                      —
                      ${escapeHtml(
                        object.id
                      )}

                    </option>

                  `
                )
                .join("")

        }

      </select>

    </div>


    <section
      class="table timeline"
    >

      <div
        id="historyResults"
        style="
          padding:20px;
          text-align:center;
          color:#718096
        "
      >
        Loading detection history...
      </div>

    </section>

  `;

}


// =====================================================
// INITIAL HISTORY
// =====================================================

async function loadInitialHistory() {

  if (
    currentPage !==
    "history"
  ) {
    return;
  }


  const select =
    $("#historyTag");


  if (!select ||
      !select.value) {

    return;

  }


  await loadHistory(
    select.value
  );

}


// =====================================================
// LOAD HISTORY
// =====================================================

async function loadHistory(
  uid
) {

  const container =
    $("#historyResults");


  if (
    !container ||
    !uid
  ) {
    return;
  }


  container.innerHTML = `

    <div
      style="
        padding:20px;
        text-align:center;
        color:#718096
      "
    >
      Loading...
    </div>

  `;


  try {

    const response =
      await fetch(
        `${API_BASE}/object/${encodeURIComponent(uid)}/history`
      );


    if (!response.ok) {

      throw new Error(
        "History request failed"
      );

    }


    const data =
      await response.json();


    if (
      data.status !==
      "success" ||
      !data.history ||
      data.history.length === 0
    ) {

      container.innerHTML = `

        <p
          style="
            padding:20px;
            color:#718096
          "
        >
          No detection history found.
        </p>

      `;

      return;

    }


    const object =
      getObject(uid);


    container.innerHTML =
      data.history
        .map(
          event => `

            <div class="tr">


              <span>

                ${formatTimestamp(
                  event.timestamp
                )}

              </span>


              <span class="dot"></span>


              <span>

                <b>

                  ${
                    object
                      ? escapeHtml(
                          object.name
                        )
                      : "NFC Object"
                  }

                </b>


                <small>

                  Reader
                  ${escapeHtml(
                    event.reader_id
                  )}

                  •
                  ${escapeHtml(
                    event.nfc_uid
                  )}

                </small>

              </span>


            </div>

          `
        )
        .join("");


  } catch (error) {

    console.error(
      "History error:",
      error
    );


    container.innerHTML = `

      <p
        style="
          padding:20px;
          color:#c05621
        "
      >
        Could not load detection history.
      </p>

    `;

  }

}


// =====================================================
// LOCATIONS PAGE
// =====================================================

function locationsPage() {

  return `

    <div class="intro">

      <div>

        <h2>
          Location Hierarchy
        </h2>

        <p>
          Objects are located through the
          reader that last detected them.
        </p>

      </div>

    </div>


    <section
      class="location-hierarchy"
      id="locationHierarchy"
    >

      <div
        style="
          padding:20px;
          text-align:center;
          color:#718096
        "
      >
        Loading reader locations...
      </div>

    </section>


    <div
      class="panel"
      style="
        margin-top:15px
      "
    >

      <h3>
        How location tracking works
      </h3>

      <p
        style="
          font-size:10px;
          color:#718096;
          line-height:1.6
        "
      >

        When an NFC tag is detected,
        the ESP32 sends the tag UID and
        reader ID to the backend.

        The backend then maps the reader
        to its configured Building, Floor
        and Room.

        The caregiver sees the object's
        last known location.

      </p>

    </div>

  `;

}


// =====================================================
// LOAD LOCATION PAGE DATA
// =====================================================

async function loadLocationsPageData() {

  if (
    currentPage !==
    "locations"
  ) {
    return;
  }


  const container =
    $("#locationHierarchy");


  if (!container) {
    return;
  }


  /*
   * Find all reader IDs that have
   * actually detected an object.
   */

  const readerIds =
    [
      ...new Set(
        objects
          .map(
            object =>
              object.reader
          )
          .filter(
            reader =>
              reader &&
              reader !== "—"
          )
      )
    ];


  if (
    readerIds.length ===
    0
  ) {

    container.innerHTML = `

      <div
        style="
          padding:25px;
          text-align:center;
          color:#718096
        "
      >
        No reader detections available yet.
      </div>

    `;

    return;

  }


  const locations =
    [];


  for (
    const readerId of
    readerIds
  ) {

    const location =
      await getReaderLocation(
        readerId
      );


    if (
      location
    ) {

      locations.push(
        location
      );

    }

  }


  if (
    locations.length ===
    0
  ) {

    container.innerHTML = `

      <div
        style="
          padding:25px;
          text-align:center;
          color:#718096
        "
      >
        No configured reader locations found.
      </div>

    `;

    return;

  }


  container.innerHTML =
    locations
      .map(
        location => `

          <div class="hier">

            <b>
              Building
            </b>

            <span>
              ${escapeHtml(
                location.building ||
                "—"
              )}
            </span>

          </div>


          <div class="hier">

            <b>
              Floor
            </b>

            <span>
              ${escapeHtml(
                location.floor ||
                "—"
              )}
            </span>

          </div>


          <div class="hier">

            <b>
              Room
            </b>

            <span>
              ${escapeHtml(
                location.room ||
                "—"
              )}
            </span>

          </div>


          <div class="hier">

            <b>
              Reader ID
            </b>

            <span>
              ${escapeHtml(
                location.reader_id
              )}
            </span>

          </div>

        `
      )
      .join("");

}


// =====================================================
// ALERTS PAGE
// =====================================================

function alertsPage() {

  const attentionObjects =
    objects.filter(
      object =>
        !object.timestamp
    );


  return `

    <div class="intro">

      <div>

        <h2>
          Alerts
        </h2>

        <p>
          Objects that may need caregiver
          attention.
        </p>

      </div>

    </div>


    <div id="alertsContainer">

      ${
        attentionObjects.length ===
        0

          ? `

            <section class="panel">

              <h3>
                ✓ No attention needed
              </h3>

              <p
                style="
                  font-size:10px;
                  color:#718096;
                  margin-top:6px
                "
              >

                All registered objects have
                at least one recorded NFC
                detection.

              </p>

            </section>

          `

          :

            attentionObjects
              .map(
                object => `

                  <section
                    class="alert"
                  >

                    <div
                      class="alert-icon"
                    >
                      ⚠
                    </div>


                    <div class="grow">

                      <span
                        class="warning"
                        style="
                          font-size:8px;
                          font-weight:800
                        "
                      >
                        ATTENTION NEEDED
                      </span>


                      <h3>

                        ${escapeHtml(
                          object.name
                        )}

                        has not been detected

                      </h3>


                      <p>

                        No NFC detection has
                        been recorded for this
                        object yet.

                      </p>

                    </div>


                    <button
                      class="primary"
                      data-object="${
                        escapeHtml(
                          object.id
                        )
                      }"
                    >
                      Find object
                    </button>

                  </section>

                `
              )
              .join("")

      }

    </div>


    <section
      class="panel"
      style="
        margin-top:15px
      "
    >

      <h3>
        How alerts work
      </h3>

      <p
        style="
          font-size:10px;
          color:#718096;
          line-height:1.6
        "
      >

        Currently, an object is marked for
        attention when it has no recorded
        detection.

        A future version can use time-based
        rules, such as alerting when an object
        has not been detected for a defined
        period.

      </p>

    </section>

  `;

}


// =====================================================
// ALERT PAGE REFRESH
// =====================================================

async function loadAlertsPageData() {

  if (
    currentPage !==
    "alerts"
  ) {
    return;
  }


  await updateObjectDetectionInfo();


  const container =
    $("#alertsContainer");


  if (!container) {
    return;
  }


  const attentionObjects =
    objects.filter(
      object =>
        !object.timestamp
    );


  if (
    attentionObjects.length ===
    0
  ) {

    container.innerHTML = `

      <section class="panel">

        <h3>
          ✓ No attention needed
        </h3>

        <p
          style="
            font-size:10px;
            color:#718096;
            margin-top:6px
          "
        >

          All registered objects have
          at least one recorded NFC
          detection.

        </p>

      </section>

    `;

    return;

  }


  container.innerHTML =
    attentionObjects
      .map(
        object => `

          <section
            class="alert"
          >

            <div class="alert-icon">
              ⚠
            </div>


            <div class="grow">

              <span
                class="warning"
                style="
                  font-size:8px;
                  font-weight:800
                "
              >
                ATTENTION NEEDED
              </span>


              <h3>
                ${escapeHtml(
                  object.name
                )}
                has not been detected
              </h3>


              <p>
                No NFC detection has
                been recorded for this object.
              </p>

            </div>


            <button
              class="primary"
              data-object="${
                escapeHtml(
                  object.id
                )
              }"
            >
              Find object
            </button>

          </section>

        `
      )
      .join("");

}


// =====================================================
// VOICE PAGE
// =====================================================

function voicePage() {

  return `

    <section class="voice-card">

      <span class="voice-label">
        VOICE-ASSISTED OBJECT SEARCH
      </span>


      <h2>
        Ask where an object is
      </h2>


      <p>
        Use your microphone or try the
        demo phrase below.
      </p>


      <button
        class="mic"
        id="mic"
      >
        🎙
      </button>


      <div
        class="transcript"
        id="transcript"
      >
        Tap the microphone and say:

        <b>
          "Where are my keys?"
        </b>

      </div>


      <div
        class="answer"
        id="answer"
      ></div>


      <button
        class="secondary"
        id="demoVoice"
      >
        Try demo phrase
      </button>

    </section>

  `;

}


// =====================================================
// VOICE OBJECT MATCHING
// =====================================================

function findObjectFromSpeech(
  text
) {

  const lower =
    text.toLowerCase();


  /*
   * Exact / partial registered
   * object name matching.
   */

  let object =
    objects.find(
      item =>
        lower.includes(
          item.name.toLowerCase()
        )
    );


  if (object) {
    return object;
  }


  /*
   * Common natural-language
   * aliases.
   */

  const aliases = {

    keys:
      [
        "key",
        "keys"
      ],

    glasses:
      [
        "glass",
        "glasses",
        "spectacles"
      ],

    medicine:
      [
        "medicine",
        "medicines",
        "tablet",
        "tablets",
        "pills",
        "medicine box"
      ],

    wallet:
      [
        "wallet",
        "purse"
      ]

  };


  for (
    const [
      type,
      words
    ]
    of Object.entries(
      aliases
    )
  ) {

    const matched =
      words.some(
        word =>
          lower.includes(
            word
          )
      );


    if (!matched) {
      continue;
    }


    object =
      objects.find(
        item =>
          item.name
            .toLowerCase()
            .includes(
              type
            )
      );


    if (object) {
      return object;
    }

  }


  return null;

}


// =====================================================
// VOICE ANSWER
// =====================================================

async function showVoiceAnswer(
  text
) {

  const transcript =
    $("#transcript");

  const answer =
    $("#answer");


  if (
    transcript
  ) {

    transcript.innerHTML =
      `<b>“${escapeHtml(
        text
      )}”</b>`;

  }


  const object =
    findObjectFromSpeech(
      text
    );


  if (!object) {

    if (answer) {

      answer.style.display =
        "block";


      answer.innerHTML = `

        <b>
          🏷️ Object not found
        </b>


        <small>

          I could not identify a
          registered object from
          that request.

        </small>

      `;

    }

    return;

  }


  /*
   * Get fresh backend data.
   */

  const detection =
    await getLatestDetection(
      object.id,
      true
    );


  if (!detection) {

    if (answer) {

      answer.style.display =
        "block";


      answer.innerHTML = `

        <b>
          ${object.icon}
          ${escapeHtml(
            object.name
          )}
        </b>


        <small>

          No detection has been
          recorded for this object yet.

        </small>

      `;

    }

    return;

  }


  const location =
    await getReaderLocation(
      detection.reader_id,
      true
    );


  if (answer) {

    answer.style.display =
      "block";


    if (location) {

      answer.innerHTML = `

        <b>

          ${object.icon}

          ${escapeHtml(
            object.name
          )}

        </b>


        <small>

          Last detected at

          <strong>
            ${escapeHtml(
              location.room
            )}
          </strong>

          •
          ${escapeHtml(
            location.building
          )}

          •
          ${escapeHtml(
            location.floor
          )}

          • Reader
          ${escapeHtml(
            location.reader_id
          )}

          •
          ${formatTimestamp(
            detection.timestamp
          )}

        </small>

      `;

    } else {

      answer.innerHTML = `

        <b>

          ${object.icon}

          ${escapeHtml(
            object.name
          )}

        </b>


        <small>

          Last detected by Reader
          ${escapeHtml(
            detection.reader_id
          )}

          •

          ${formatTimestamp(
            detection.timestamp
          )}

        </small>

      `;

    }

  }

}


// =====================================================
// DEMO VOICE
// =====================================================

function simulateVoice() {

  if (
    objects.length ===
    0
  ) {

    toast(
      "No registered objects available"
    );

    return;

  }


  /*
   * Prefer House Keys if
   * registered, otherwise
   * use the first object.
   */

  const keys =
    objects.find(
      object =>
        object.name
          .toLowerCase()
          .includes(
            "key"
          )
    );


  const phrase =
    keys
      ? "Where are my keys?"
      : `Where is my ${objects[0].name}?`;


  showVoiceAnswer(
    phrase
  );

}


// =====================================================
// REAL BROWSER SPEECH RECOGNITION
// =====================================================

function listen() {

  const Recognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;


  if (!Recognition) {

    toast(
      "Speech recognition is not supported here"
    );

    simulateVoice();

    return;

  }


  const recognition =
    new Recognition();


  recognition.lang =
    "en-US";


  recognition.interimResults =
    false;


  recognition.maxAlternatives =
    1;


  const transcript =
    $("#transcript");


  if (
    transcript
  ) {

    transcript.innerHTML =
      "🎙 Listening...";

  }


  recognition.onresult =
    event => {

      const text =
        event
          .results[0][0]
          .transcript;


      showVoiceAnswer(
        text
      );

    };


  recognition.onerror =
    event => {

      console.error(
        "Speech recognition error:",
        event.error
      );


      toast(
        "Could not understand voice input"
      );

    };


  recognition.onend =
    () => {

      if (
        transcript &&
        transcript.textContent ===
          "🎙 Listening..."
      ) {

        transcript.textContent =
          "Tap the microphone and try again.";

      }

    };


  recognition.start();

}


// =====================================================
// SIMULATED NFC SCAN
// =====================================================

async function simulateNFCScan() {

  if (
    objects.length ===
    0
  ) {

    toast(
      "No registered objects"
    );

    return;

  }


  /*
   * This is intentionally a UI simulation.
   *
   * The browser cannot directly read the
   * PN532 connected to the ESP32.
   */

  const object =
    objects[0];


  toast(
    `Demo scan: ${object.name}`
  );


  /*
   * Take the user to Find Object
   * and populate the UID.
   */

  selected =
    object;


  currentPage =
    "find";


  window.findTerm =
    object.id;


  render();


  /*
   * Automatically perform lookup.
   */

  setTimeout(
    () =>
      performLookup(
        object.id
      ),
    100
  );

}


// =====================================================
// BIND ALL PAGE EVENTS
// =====================================================

function bind() {


  // ===================================================
  // ADD OBJECT
  // ===================================================

  const addObjectBtn =
    $("#addObjectBtn");


  if (
    addObjectBtn
  ) {

    addObjectBtn.onclick =
      showAddObjectForm;

  }


  // ===================================================
  // DASHBOARD
  // ===================================================

  const scan =
    $("#scan");


  if (
    scan
  ) {

    scan.onclick =
      simulateNFCScan;

  }


  // ===================================================
  // OBJECT BUTTONS
  // ===================================================

  document
    .querySelectorAll(
      "[data-object]"
    )
    .forEach(
      button => {

        button.onclick =
          () => {

            const object =
              getObject(
                button.dataset.object
              );


            if (!object) {
              return;
            }


            selected =
              object;


            window.findTerm =
              object.id;


            nav(
              "find"
            );

          };

      }
    );


  // ===================================================
  // FIND / SEARCH
  // ===================================================

  const search =
    $("#search");


  if (
    search
  ) {

    search.addEventListener(
      "input",
      () => {

        window.findTerm =
          search.value;

      }
    );


    search.addEventListener(
      "keydown",
      event => {

        if (
          event.key ===
          "Enter"
        ) {

          performLookup(
            search.value
          );

        }

      }
    );

  }


  // ===================================================
  // LOOKUP BUTTON
  // ===================================================

  const lookupNFC =
    $("#lookupNFC");


  if (
    lookupNFC
  ) {

    lookupNFC.onclick =
      () => {

        const value =
          $("#search")
            ?.value ||
          "";


        performLookup(
          value
        );

      };

  }


  // ===================================================
  // ROUTE / LOCATION
  // ===================================================

  const route =
    $("#route");


  if (
    route
  ) {

    route.onclick =
      () => {

        const room =
          $("#locationRoom")
            ?.textContent;


        if (
          room &&
          room !== "—" &&
          room !==
            "Location unavailable"
        ) {

          toast(
            `Last known location: ${room}`
          );

        } else {

          toast(
            "Find an NFC tag first"
          );

        }

      };

  }


  // ===================================================
  // HISTORY
  // ===================================================

  const historyTag =
    $("#historyTag");


  if (
    historyTag
  ) {

    historyTag.onchange =
      () => {

        loadHistory(
          historyTag.value
        );

      };

  }


  // ===================================================
  // VOICE
  // ===================================================

  const mic =
    $("#mic");


  if (
    mic
  ) {

    mic.onclick =
      listen;

  }


  const demoVoice =
    $("#demoVoice");


  if (
    demoVoice
  ) {

    demoVoice.onclick =
      simulateVoice;

  }


}


// =====================================================
// AUTOMATIC LIVE REFRESH
// =====================================================

function startLiveRefresh() {

  if (
    dashboardRefreshTimer
  ) {

    clearInterval(
      dashboardRefreshTimer
    );

  }


  /*
   * Refresh backend data every
   * 15 seconds.
   *
   * This is enough for an MVP without
   * constantly hammering the backend.
   */

  dashboardRefreshTimer =
    setInterval(
      async () => {

        if (
          currentPage ===
          "dashboard"
        ) {

          await loadDashboardDetections();

        }

      },
      15000
    );

}


// =====================================================
// INITIALIZATION
// =====================================================

async function initializeApp() {

  /*
   * Load objects from backend FIRST.
   */

  await refreshObjects(
    false
  );


  /*
   * Then render the application.
   */

  render();


  /*
   * Start live dashboard updates.
   */

  startLiveRefresh();

}


// =====================================================
// START APPLICATION
// =====================================================

initializeApp();