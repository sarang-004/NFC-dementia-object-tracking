const objects=[
 {id:"NFC-001",name:"House Keys",icon:"🔑",building:"Building A",floor:"Floor 2",room:"Entrance",reader:"R01",time:"8:42 PM",status:"Detected"},
 {id:"NFC-002",name:"Medicine Box",icon:"💊",building:"Building A",floor:"Floor 1",room:"Kitchen",reader:"R02",time:"9:15 AM",status:"Detected"},
 {id:"NFC-003",name:"Wallet",icon:"👛",building:"Building A",floor:"Floor 2",room:"Bedroom",reader:"R03",time:"7:36 PM",status:"Detected"},
 {id:"NFC-004",name:"Reading Glasses",icon:"👓",building:"Building A",floor:"Floor 1",room:"Living Room",reader:"R04",time:"6:18 PM",status:"Not recently detected"},
 {id:"NFC-005",name:"Phone Pouch",icon:"📱",building:"Building A",floor:"Floor 2",room:"Study Room",reader:"R05",time:"4:05 PM",status:"Detected"}
];
const events=[
 ["8:42 PM","House Keys","Entrance","Object detected"],["7:36 PM","Wallet","Bedroom","Object detected"],
 ["6:18 PM","Reading Glasses","Living Room","Last detection"],["4:05 PM","Phone Pouch","Study Room","Object detected"],
 ["9:15 AM","Medicine Box","Kitchen","Object detected"],["8:30 AM","Medicine Box","Bedroom","Previous detection"]
];
let selected=objects[0],currentPage="dashboard";

const $=s=>document.querySelector(s);
function toast(msg){const t=$("#toast");t.textContent="✓ "+msg;t.style.display="block";setTimeout(()=>t.style.display="none",2200)}
function nav(page){currentPage=page;document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.page===page));const titles={dashboard:"Dashboard",find:"Find Object",voice:"Voice Interaction",objects:"Tagged Objects",history:"Activity History",locations:"Locations",alerts:"Alerts"};$("#pageTitle").textContent=titles[page];render()}
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>nav(b.dataset.page));$("#bell").onclick=()=>toast("No new notifications");

function render(){
 const c=$("#content");
 if(currentPage==="dashboard") c.innerHTML=dashboard();
 if(currentPage==="find") c.innerHTML=findPage();
 if(currentPage==="voice") c.innerHTML=voicePage();
 if(currentPage==="objects") c.innerHTML=objectsPage();
 if(currentPage==="history") c.innerHTML=historyPage();
 if(currentPage==="locations") c.innerHTML=locationsPage();
 if(currentPage==="alerts") c.innerHTML=alertsPage();
 bind();
}
function stat(icon,title,value,sub){return `<div class="stat"><div class="ico">${icon}</div><div><span>${title}</span><strong>${value}</strong><small>${sub}</small></div></div>`}
function dashboard(){
 return `<section class="welcome"><div><h2>Good evening, Caregiver 👋</h2><p>Find a tagged object and see its last known location.</p></div><button class="primary" onclick="nav('find')">🔎 Find an object</button></section>
 <section class="stats">${stat("🏷️","Tagged Objects","5","All registered")}${stat("✓","Detected Today","4","Recently active")}${stat("⌖","Locations","5","Monitored zones")}${stat("⚠","Attention Needed","1","Needs checking")}</section>
 <div class="grid2"><section class="panel"><div class="panel-head"><div><h3>Recently detected</h3><p>Latest NFC events</p></div><button class="text" onclick="nav('history')">View history →</button></div><div class="activity">${events.slice(0,5).map(e=>`<div class="row"><div class="objicon">${objects.find(o=>o.name===e[1])?.icon||"🏷️"}</div><div class="grow"><b>${e[1]}</b><small>${e[3]} • ${e[2]}</small></div><time>${e[0]}</time></div>`).join("")}</div></section>
 <section class="panel"><div class="panel-head"><div><h3>Quick find</h3><p>Select an object to locate it</p></div></div><div class="quick">${objects.slice(0,4).map(o=>`<button data-object="${o.id}"><span class="objicon">${o.icon}</span><span class="grow"><b>${o.name}</b><small>${o.room}</small></span>→</button>`).join("")}</div><button class="secondary full" id="scan">Simulate NFC scan</button></section></div>
 <section class="workflow"><div class="step"><div class="stepnum">01</div><b>NFC Tag</b><small>Object identity</small></div><div class="arrow">→</div><div class="step"><div class="stepnum">02</div><b>PN532</b><small>Reads tag</small></div><div class="arrow">→</div><div class="step"><div class="stepnum">03</div><b>ESP32</b><small>Sends data</small></div><div class="arrow">→</div><div class="step"><div class="stepnum">04</div><b>Backend</b><small>Stores event</small></div><div class="arrow">→</div><div class="step"><div class="stepnum">05</div><b>Web App</b><small>Caregiver view</small></div></section>`;
}
function findPage(){
 return `<div class="find-grid"><section><div class="search"><span>⌕</span><input id="search" placeholder="Search object name or NFC ID..." value="${window.findTerm||""}"></div><div class="panel" style="margin-top:12px;padding:15px"><div class="panel-head"><div><h3>Tagged objects</h3><p>Building → Floor → Room → Reader</p></div></div><div id="results" class="object-list">${objectCards(objects)}</div></div></section>${locationCard()}</div>`;
}
function objectCards(list){return list.length?list.map(o=>`<button class="object-card ${selected.id===o.id?"selected":""}" data-object="${o.id}"><span class="objicon">${o.icon}</span><span class="grow"><b>${o.name}</b><small>${o.id} • ${o.reader}</small></span><span><b>${o.room}</b><small>${o.floor}</small></span><span class="tag ${o.status==="Detected"?"success":"warning"}">${o.status==="Detected"?"● Active":"● Check"}</span></button>`).join(""):`<div style="padding:25px;text-align:center;color:#718096;font-size:10px">No matching object.</div>`}
function locationCard(){
 return `<section class="location-card"><div class="map"><span class="pin">●</span><span class="maplabel">${selected.room} • ${selected.reader}</span></div><div class="locbody"><span class="label">LAST KNOWN LOCATION</span><h2>${selected.icon} ${selected.name}</h2><div class="highlight"><span>⌖</span><div><b>${selected.room}</b><small>${selected.building} • ${selected.floor} • Reader ${selected.reader}</small></div></div><div class="timebox"><span>Last detected</span><b>${selected.time}</b><small>NFC ID: ${selected.id}</small></div><button class="primary full" id="route">📍 Show location</button><p style="font-size:8px;color:#9aa5b1;text-align:center">Location is the most recent NFC detection point.</p></div></section>`;
}
function voicePage(){
 return `<section class="voice-card"><span class="voice-label">VOICE-ASSISTED OBJECT SEARCH</span><h2>Ask where an object is</h2><p>Use your microphone or try the demo phrase below.</p><button class="mic" id="mic">🎙</button><div class="transcript" id="transcript">Tap the microphone and say: <b>"Where are my keys?"</b></div><div class="answer" id="answer"></div><button class="secondary" id="demoVoice">Try demo phrase</button></section>`;
}
function objectsPage(){return `<div class="intro"><div><h2>Tagged Objects</h2><p>Registered NFC stickers and their last detection details.</p></div><button class="primary" onclick="toast('Add-object form will connect to the backend later')">＋ Add object</button></div><section class="table"><div class="thead"><span>Object</span><span>NFC ID</span><span>Location</span><span>Last detected</span><span>Status</span></div>${objects.map(o=>`<div class="tr"><span><b>${o.icon} ${o.name}</b></span><span>${o.id}</span><span>${o.building}, ${o.floor}<small>${o.room} • ${o.reader}</small></span><span>${o.time}</span><span class="${o.status==="Detected"?"success":"warning"}">${o.status}</span></div>`).join("")}</section>`}
function historyPage(){return `<div class="intro"><div><h2>Activity History</h2><p>Timestamped object detections.</p></div><button class="secondary">Today ▾</button></div><section class="table timeline">${events.map(e=>`<div class="tr"><span>${e[0]}</span><span class="dot"></span><span><b>${e[1]}</b><small>${e[3]} at ${e[2]}</small></span></div>`).join("")}</section>`}
function locationsPage(){return `<div class="intro"><div><h2>Location Hierarchy</h2><p>The updated system identifies an object through its reader location.</p></div></div><section class="location-hierarchy">${["Building","Floor","Room","Reader ID"].map((x,i)=>`<div class="hier"><b>${x}</b><span>${["Building A","Floor 2","Bedroom","R03"][i]}</span></div>`).join("")}</section><div class="panel" style="margin-top:15px"><h3>Example detection</h3><p style="font-size:10px;color:#718096">🔑 House Keys → Building A → Floor 2 → Entrance → Reader R01 → <b>8:42 PM</b></p></div>`}
function alertsPage(){let o=objects[3];return `<div class="intro"><div><h2>Alerts</h2><p>Items that may need caregiver attention.</p></div></div><section class="alert"><div class="alert-icon">⚠</div><div class="grow"><span class="warning" style="font-size:8px;font-weight:800">ATTENTION NEEDED</span><h3>${o.name} has not been recently detected</h3><p>Last known location: <b>${o.room}</b> at ${o.time}. Consider checking this location.</p></div><button class="primary" onclick="selected=objects[3];nav('find')">Find object</button></section><section class="panel" style="margin-top:15px"><h3>How alerts work</h3><p style="font-size:10px;color:#718096;line-height:1.6">In the final system, the backend can compare the latest NFC timestamp with expected activity and generate alerts for objects that have not been detected recently.</p></section>`}

function bind(){
 document.querySelectorAll("[data-object]").forEach(b=>b.onclick=()=>{selected=objects.find(o=>o.id===b.dataset.object);nav("find")});
 const search=$("#search");if(search){search.oninput=()=>{window.findTerm=search.value;const q=search.value.toLowerCase();$("#results").innerHTML=objectCards(objects.filter(o=>(o.name+" "+o.id+" "+o.room).toLowerCase().includes(q)));document.querySelectorAll("[data-object]").forEach(b=>b.onclick=()=>{selected=objects.find(o=>o.id===b.dataset.object);nav("find")})}}
 const scan=$("#scan");if(scan)scan.onclick=()=>toast("Demo NFC scan received — House Keys detected at Entrance");
 const route=$("#route");if(route)route.onclick=()=>toast("Showing route to "+selected.room);
 const demo=$("#demoVoice");if(demo)demo.onclick=()=>simulateVoice();
 const mic=$("#mic");if(mic)mic.onclick=()=>listen();
}
function showVoiceAnswer(text){$("#transcript").innerHTML=`<b>“${text}”</b>`;const o=text.toLowerCase().includes("medicine")?objects[1]:objects[0];$("#answer").style.display="block";$("#answer").innerHTML=`<b>${o.icon} ${o.name}</b><small>Last detected at <strong>${o.room}</strong> • ${o.building} • ${o.floor} • Reader ${o.reader} • ${o.time}</small>`}
function simulateVoice(){showVoiceAnswer("Where are my keys?");toast("Voice query processed")}
function listen(){
 if(!("webkitSpeechRecognition" in window||"SpeechRecognition" in window)){simulateVoice();return}
 const R=window.SpeechRecognition||window.webkitSpeechRecognition,r=new R();r.lang="en-US";$("#transcript").innerHTML="🎙 Listening...";r.onresult=e=>showVoiceAnswer(e.results[0][0].transcript);r.onerror=()=>simulateVoice();r.start();
}
render();
