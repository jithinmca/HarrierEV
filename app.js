// app.js — Firebase + UI with caching
// ------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  deleteDoc,
  query,
  orderBy,
  limit,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ------------------- Firebase config -------------------
const firebaseConfig = {
  apiKey: "AIzaSyBOI43lUwdCGG97SR1LTCFG-XjJSkqTP50",
  authDomain: "harrier-ev-57d86.firebaseapp.com",
  projectId: "harrier-ev-57d86",
  storageBucket: "harrier-ev-57d86.firebasestorage.app",
  messagingSenderId: "447412914935",
  appId: "1:447412914935:web:7ddf229b5987c9f5c761f2",
  measurementId: "G-FXV4FQV3LN"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
try { enableIndexedDbPersistence(db); } catch (e) { console.warn("IndexedDB persistence not enabled:", e.message); }

// ------------------- Helpers -------------------
const el = id => document.getElementById(id);
function showAlert(msg) { alert(msg); }
function confirmYes(q) { return confirm(q); }
function col(path) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  return collection(db, `users/${uid}/${path}`);
}

// ------------------- Cache -------------------
let cache = {
  dailyLogs: [],
  evExpenses: [],
  iceExpenses: [],
  masterData: []
};

async function fetchCollection(name, order = "desc") {
  const q = query(col(name), orderBy("date", order));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data(), date: new Date(d.data().date) }));
}

// ------------------- Auth UI -------------------
el("loginBtn").addEventListener("click", async () => {
  try { await signInWithPopup(auth, provider); }
  catch (e) { showAlert("Login failed: " + e.message); }
});
el("logoutBtn").addEventListener("click", async () => { await signOut(auth); });

onAuthStateChanged(auth, (user) => {
  if (user) {
    el("loginBtn").classList.add("d-none");
    el("logoutBtn").classList.remove("d-none");
    if (el("user")) el("user").textContent = "👋 " + (user.displayName?.split(" ")[0] || user.email);
    loadAll();
  } else {
    el("loginBtn").classList.remove("d-none");
    el("logoutBtn").classList.add("d-none");
    if (el("user")) el("user").textContent = "Not signed in";
    el("history").innerHTML = "";
    el("evHistory").innerHTML = "";
    el("iceHistory").innerHTML = "";
    el("masterHistory").innerHTML = "";
    el("savingsSummary").textContent = "Sign in to load data.";
  }
});

// ------------------- Charging: Save / Suggest -------------------
el("chargedChk")?.addEventListener("change", function () {
  el("chargeTypeWrap").style.display = this.checked ? "block" : "none";
});

el("saveInputsBtn")?.addEventListener("click", async () => {
  try {
    const soc = parseInt(el("soc").value);
    const odo = parseInt(el("odo").value);
    const charged = el("chargedChk").checked;
    let chargeType = null;
    if (charged) {
      chargeType = el("acRadio").checked ? "AC" : (el("dcRadio").checked ? "DC" : null);
      if (!chargeType) { showAlert("Select AC/DC when Charged is ticked."); return; }
    }
    if (Number.isNaN(soc) || Number.isNaN(odo)) { showAlert("Enter valid SoC and Odo."); return; }

    await addDoc(col("dailyLogs"), { date: new Date().toISOString(), soc, odo, charged, chargeType });
    cache.dailyLogs = await fetchCollection("dailyLogs", "asc");
    renderDailyLogs();
    updateSavingsSummary();
  } catch (e) { showAlert("Save failed: " + e.message); }
});

el("suggestBtn")?.addEventListener("click", () => {
  const upcoming = parseInt(el("upcoming")?.value);
  const soc = parseInt(el("sochidden")?.value);
  if (Number.isNaN(upcoming)) return showAlert("Enter upcoming km.");
  if (Number.isNaN(soc)) return showAlert("Add a log first.");
  let msg = "";
  if (soc >= 100) msg = "✅ Already 100%.";
  else if (upcoming > 250) msg = "🔋 Charge to 100% (long trip).";
  else if (soc < 30) msg = "🔋 Charge to 80–90%.";
  else if (soc < 50 && upcoming > 100) msg = "🔋 Charge to ~90% for buffer.";
  else if (soc > 80 && upcoming < 50) msg = "✅ No charge needed.";
  else msg = "🔋 Charge to ~80% for daily use.";
  showAlert(msg);
});

// ------------------- Render Functions -------------------
function renderDailyLogs() {
  let html = "";
  const logs = [...cache.dailyLogs].slice(-20).reverse();
  const now = Date.now(), weekAgo = now - 7*24*3600*1000, monthAgo = now - 30*24*3600*1000;
  let hasFull7 = false, hasFullAC30 = false, lastChargeTypes = [];

  logs.forEach(x => {
    let badge = `<span class="badge bg-secondary">No charge</span>`;
    if (x.charged) {
      if (x.soc === 100 && x.chargeType === "AC") badge = `<span class="badge bg-success">100% AC</span>`;
      else if (x.soc === 100 && x.chargeType === "DC") badge = `<span class="badge bg-primary">100% DC</span>`;
      else if (x.chargeType === "AC") badge = `<span class="badge bg-info text-dark">AC</span>`;
      else if (x.chargeType === "DC") badge = `<span class="badge bg-warning text-dark">DC</span>`;
    }
    html += `
      <div class="border rounded p-2 mb-2 small bg-white">
        <div class="d-flex justify-content-between align-items-center">
          <div><b>${x.date.toLocaleDateString()} ${x.date.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</b></div>
          <div>${badge}<button class="btn btn-sm btn-outline-danger ms-2" data-del-log="${x.id}">🗑️</button></div>
        </div>
        <div>Odo: ${x.odo} km</div>
        <div>SoC: ${x.soc}%</div>
      </div>`;
    if (x.charged && x.soc === 100 && x.date >= weekAgo) hasFull7 = true;
    if (x.charged && x.soc === 100 && x.chargeType === "AC" && x.date >= monthAgo) hasFullAC30 = true;
    if (x.charged && x.chargeType) {
      lastChargeTypes.push(x.chargeType);
      if (lastChargeTypes.length > 5) lastChargeTypes.shift();
    }
  });
  el("history").innerHTML = html || `<span class="text-muted">No logs</span>`;
  document.querySelectorAll("[data-del-log]").forEach(btn => btn.addEventListener("click", async e => {
    if (!confirmYes("Delete log?")) return;
    await deleteDoc(doc(col("dailyLogs"), e.currentTarget.dataset.delLog));
    cache.dailyLogs = await fetchCollection("dailyLogs","asc");
    renderDailyLogs(); updateSavingsSummary();
  }));

  // Prefill inputs
  if (cache.dailyLogs.length > 0) {
    const latest = cache.dailyLogs[cache.dailyLogs.length-1];
    el("soc").value = latest.soc; el("sochidden").value = latest.soc; el("odo").value = latest.odo;
    if (latest.charged) {
      el("chargedChk").checked = true; el("chargeTypeWrap").style.display = "block";
      if (latest.chargeType==="AC") el("acRadio").checked=true;
      else if (latest.chargeType==="DC") el("dcRadio").checked=true;
    }
  }
  // Banners
  if (!hasFull7) { el("chargeBanner").classList.remove("d-none"); el("chargeBanner").textContent="⚠️ No 100% charge in last 7d"; }
  else el("chargeBanner").classList.add("d-none");
  if (!hasFullAC30) { el("acBanner").classList.remove("d-none"); el("acBanner").textContent="⚠️ No 100% AC in last 30d"; }
  else el("acBanner").classList.add("d-none");
  if (lastChargeTypes.length===5 && lastChargeTypes.every(t=>t==="DC")) {
    el("acBanner").classList.remove("d-none");
    el("acBanner").textContent="⚠️ Last 5 charges were DC. Use AC slow charge next.";
  }
}

function renderEvExpenses() {
  let total = 0, html="";
  cache.evExpenses.forEach(x => {
    total+=Number(x.amount)||0;
    html+=`
    <div class="border rounded p-2 mb-2 small bg-white">
      <div class="d-flex justify-content-between">
        <div><b>${x.category}</b><div class="text-muted small">${x.date.toLocaleDateString()}</div></div>
        <div>₹${x.amount}<button class="btn btn-sm btn-outline-danger ms-2" data-del-ev="${x.id}">🗑️</button></div>
      </div>
    </div>`;
  });
  el("evHistory").innerHTML=html||`<span class="text-muted">No EV expenses</span>`;
  el("evTotal").textContent="Total: ₹"+Math.round(total);
  document.querySelectorAll("[data-del-ev]").forEach(btn=>btn.addEventListener("click", async e=>{
    if(!confirmYes("Delete EV expense?")) return;
    await deleteDoc(doc(col("evExpenses"), e.currentTarget.dataset.delEv));
    cache.evExpenses=await fetchCollection("evExpenses");
    renderEvExpenses(); updateSavingsSummary();
  }));
}

function renderIceExpenses() {
  let manualTotal=0, html="";
  cache.iceExpenses.forEach(x=>{
    manualTotal+=Number(x.amount)||0;
    html+=`
    <div class="border rounded p-2 mb-2 small bg-white">
      <div class="d-flex justify-content-between">
        <div><b>${x.category}</b><div class="text-muted small">${x.date.toLocaleDateString()}</div></div>
        <div>₹${x.amount}<button class="btn btn-sm btn-outline-danger ms-2" data-del-ice="${x.id}">🗑️</button></div>
      </div>
    </div>`;
  });
  el("iceHistory").innerHTML=html||`<span class="text-muted">No ICE expenses</span>`;
  document.querySelectorAll("[data-del-ice]").forEach(btn=>btn.addEventListener("click",async e=>{
    if(!confirmYes("Delete ICE expense?")) return;
    await deleteDoc(doc(col("iceExpenses"), e.currentTarget.dataset.delIce));
    cache.iceExpenses=await fetchCollection("iceExpenses");
    renderIceExpenses(); updateSavingsSummary();
  }));

  // Fuel cost
  const fuelCost=calcFuelCostDynamic();
  let total=manualTotal+fuelCost;
  if(fuelCost>0){
    el("iceFuelExpenses").innerHTML=`
      <div class="border rounded p-2 mb-2 small bg-light">
        <div><b>Fuel cost (calculated)</b></div>
        <div class="mt-1">₹${fuelCost.toFixed(0)}</div>
      </div>`;
  } else el("iceFuelExpenses").innerHTML="";
  el("iceTotal").textContent="Total: ₹"+Math.round(total);
}

function renderMasterData() {
  let html="";
  cache.masterData.slice().reverse().forEach(x=>{
    html+=`
    <div class="border rounded p-2 mb-2 small bg-white">
      <div class="d-flex justify-content-between">
        <div><b>₹${x.fuelPrice}/L • ${x.mileage} km/L</b><div class="text-muted small">${x.date.toLocaleDateString()}</div></div>
        <div><button class="btn btn-sm btn-outline-danger" data-del-master="${x.id}">🗑️</button></div>
      </div>
    </div>`;
  });
  el("masterHistory").innerHTML=html||`<span class="text-muted">No master data</span>`;
  document.querySelectorAll("[data-del-master]").forEach(btn=>btn.addEventListener("click",async e=>{
    if(!confirmYes("Delete master entry?")) return;
    await deleteDoc(doc(col("masterData"), e.currentTarget.dataset.delMaster));
    cache.masterData=await fetchCollection("masterData","asc");
    renderMasterData(); updateSavingsSummary();
  }));
}

// ------------------- Dynamic fuel cost calc -------------------
function calcFuelCostDynamic() {
  if(!cache.masterData.length || !cache.dailyLogs.length) return 0;
  const masters=[...cache.masterData], logs=[...cache.dailyLogs];
  let total=0;
  for(let i=1;i<masters.length;i++){
    const prevM=masters[i-1], currM=masters[i];
    const startOdo=logs.find(l=>l.date<=prevM.date)?.odo||0;
    const endOdo=logs.find(l=>l.date<=currM.date)?.odo||logs[logs.length-1].odo;
    const dist=endOdo-startOdo;
    if(dist>0 && prevM.mileage>0) total+=(dist/prevM.mileage)*prevM.fuelPrice;
  }
  // Add last segment
  const lastM=masters[masters.length-1];
  const startOdo=logs.find(l=>l.date<=lastM.date)?.odo||0;
  const endOdo=logs[logs.length-1].odo;
  const dist=endOdo-startOdo;
  if(dist>0 && lastM.mileage>0) total+=(dist/lastM.mileage)*lastM.fuelPrice;
  return total;
}

// ------------------- Savings summary -------------------
function updateSavingsSummary() {
  const evTotal=cache.evExpenses.reduce((a,b)=>a+(Number(b.amount)||0),0);
  const iceManual=cache.iceExpenses.reduce((a,b)=>a+(Number(b.amount)||0),0);
  const iceFuel=calcFuelCostDynamic();
  const iceTotal=iceManual+iceFuel;
  const savings=iceTotal-evTotal;
  el("savingsSummary").innerHTML=`
    <div><small class="text-muted">EV</small> <b>₹${Math.round(evTotal)}</b> | 
    <small class="text-muted">ICE</small> <b>₹${Math.round(iceTotal)}</b> | 
    <small class="text-muted">Net</small> <b class="${savings>=0?"text-success":"text-danger"}">₹${Math.round(savings)}</b></div>`;
  el("evTotal").textContent="Total: ₹"+Math.round(evTotal);
  el("iceTotal").textContent="Total: ₹"+Math.round(iceTotal);
}

// ------------------- Save Buttons -------------------
el("addEvExpenseBtn")?.addEventListener("click", async ()=>{
  const cat=el("evCategory").value||"Other";
  const amt=parseFloat(el("evAmount").value);
  if(!(amt>0)) return showAlert("Enter EV amount");
  await addDoc(col("evExpenses"),{date:new Date().toISOString(), category:cat, amount:amt});
  cache.evExpenses=await fetchCollection("evExpenses");
  renderEvExpenses(); updateSavingsSummary();
  el("evAmount").value="";
});
el("addIceExpenseBtn")?.addEventListener("click", async ()=>{
  const cat=el("iceCategory").value||"Other";
  const amt=parseFloat(el("iceAmount").value);
  if(!(amt>0)) return showAlert("Enter ICE amount");
  await addDoc(col("iceExpenses"),{date:new Date().toISOString(), category:cat, amount:amt});
  cache.iceExpenses=await fetchCollection("iceExpenses");
  renderIceExpenses(); updateSavingsSummary();
  el("iceAmount").value="";
});
el("saveMasterBtn")?.addEventListener("click", async ()=>{
  const fuelType=el("fuelType").value||"Diesel";
  const fuelPrice=parseFloat(el("fuelPrice").value);
  const mileage=parseFloat(el("mileage").value);
  const fuelDateVal=el("fuelDate").value;
  if(!(fuelPrice>0)&&!(mileage>0)) return showAlert("Enter valid values");
  const dateISO=fuelDateVal?new Date(fuelDateVal+"T00:00:00").toISOString():new Date().toISOString();
  await addDoc(col("masterData"),{fuelType,fuelPrice,mileage,date:dateISO});
  cache.masterData=await fetchCollection("masterData","asc");
  renderMasterData(); updateSavingsSummary();
});

// ------------------- loadAll -------------------
async function loadAll() {
  [cache.dailyLogs,cache.evExpenses,cache.iceExpenses,cache.masterData] = await Promise.all([
    fetchCollection("dailyLogs","asc"),
    fetchCollection("evExpenses","desc"),
    fetchCollection("iceExpenses","desc"),
    fetchCollection("masterData","asc")
  ]);
  renderDailyLogs();
  renderEvExpenses();
  renderIceExpenses();
  renderMasterData();
  updateSavingsSummary();
}
