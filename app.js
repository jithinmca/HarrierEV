// app.js — full application logic (Firebase + UI)
// ------------------------------------------------
// Firebase SDK imports (ESM)
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
  enableIndexedDbPersistence,
  setDoc
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

// Collections helper for current user
function col(path) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  return collection(db, `users/${uid}/${path}`);
}

// Small UI helpers
function showAlert(msg) { alert(msg); }
function confirmYes(q) { return confirm(q); }

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
    if (el("user")) {
      el("user").textContent = "👋 " + (user.displayName?.split(" ")[0] || user.email);
    }
    loadAll(); // load everything when signed in
  } else {
    el("loginBtn").classList.remove("d-none");
    el("logoutBtn").classList.add("d-none");
    if (el("user")) {
      el("user").textContent = "Not signed in";
    }
    // clear UI
    el("history").innerHTML = "";
    el("evHistory").innerHTML = "";
    el("iceHistory").innerHTML = "";
    el("masterHistory").innerHTML = "";
    el("savingsSummary").textContent = "Sign in to load data.";
  }
});

// ------------------- Charging: Save / Suggest / History / Banners -------------------

el("chargedChk")?.addEventListener("change", function () {
  if (this.checked) el("chargeTypeWrap").style.display = "block";
  else el("chargeTypeWrap").style.display = "none";
});

el("saveInputsBtn")?.addEventListener("click", async () => {
  try {
    const soc = parseInt(el("soc").value);
    const odo = parseInt(el("odo").value);
    const charged = el("chargedChk").checked;
    let chargeType = null;
    if (charged) {
      chargeType = el("acRadio").checked ? "AC" : (el("dcRadio").checked ? "DC" : null);
      if (!chargeType) { showAlert("Please select AC or DC when 'Charged' is checked."); return; }
    }
    if (Number.isNaN(soc) || Number.isNaN(odo)) { showAlert("Enter valid SoC and Odometer."); return; }

    await addDoc(col("dailyLogs"), {
      date: new Date().toISOString(),
      soc, odo, charged, chargeType
    });
    await loadDailyLogs();
    await updateSavingsSummary();
  } catch (e) {
    showAlert("Save failed: " + e.message);
  }
});

el("suggestBtn")?.addEventListener("click", () => {
  const soc = parseInt(el("soc").value);
  const upcoming = parseInt(el("upcoming").value);
  if (Number.isNaN(soc) || Number.isNaN(upcoming)) { showAlert("Fill SoC and upcoming ride km."); return; }

  let msg = "";
  if (upcoming > 250) msg = "🔋 Charge to 100% (long trip ahead)";
  else if (soc < 30) msg = "🔋 Charge to 80–90% tonight";
  else if (soc < 50 && upcoming > 100) msg = "🔋 Charge to ~90% (extra buffer needed)";
  else if (soc > 80 && upcoming < 50) msg = "✅ No charge needed tonight";
  else msg = "🔋 Charge to ~80% for daily use";
  showAlert(msg);
});

// Load last 20 daily logs, render history, attach delete handlers, banners, prefill inputs
async function loadDailyLogs() {
  try {
    const q = query(col("dailyLogs"), orderBy("date", "desc"), limit(20));
    const snap = await getDocs(q);
    let html = "";

    // Banner checks
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
    let hasFull7 = false;
    let hasFullAC30 = false;
    const lastChargeTypes = [];

    snap.forEach(d => {
      const x = d.data();
      const id = d.id;
      const date = new Date(x.date);
      // badge
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
            <div><b>${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b></div>
            <div>
              ${badge}
              <button class="btn btn-sm btn-outline-danger ms-2" data-del-log="${id}">🗑️</button>
            </div>
          </div>
          <div>Odo: ${x.odo} km</div>
          <div>SoC: ${x.soc}%</div>
        </div>`;

      // banners detection
      if (x.charged && x.soc === 100 && date.getTime() >= weekAgo) hasFull7 = true;
      if (x.charged && x.soc === 100 && x.chargeType === "AC" && date.getTime() >= monthAgo) hasFullAC30 = true;
      if (x.charged && x.chargeType) {
        lastChargeTypes.push(x.chargeType);
        if (lastChargeTypes.length > 5) lastChargeTypes.shift();
      }
    });

    el("history").innerHTML = html || `<span class="text-muted">No logs yet</span>`;

    // Attach delete handlers
    document.querySelectorAll("[data-del-log]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const id = e.currentTarget.dataset.delLog;
        if (!confirmYes("Delete this log?")) return;
        try {
          await deleteDoc(doc(col("dailyLogs"), id));
          await loadDailyLogs();
          await updateSavingsSummary();
        } catch (err) {
          showAlert("Delete failed: " + err.message);
        }
      });
    });

    // Prefill latest values into inputs (use the very latest doc from DB separate query)
    try {
      const qLatest = query(col("dailyLogs"), orderBy("date", "desc"), limit(1));
      const latestSnap = await getDocs(qLatest);
      if (!latestSnap.empty) {
        const latest = latestSnap.docs[0].data();
        el("soc").value = latest.soc;
        el("odo").value = latest.odo;
        if (latest.charged) {
          el("chargedChk").checked = true;
          el("chargeTypeWrap").style.display = "block";
          if (latest.chargeType === "AC") el("acRadio").checked = true;
          else if (latest.chargeType === "DC") el("dcRadio").checked = true;
        } else {
          el("chargedChk").checked = false;
          el("chargeTypeWrap").style.display = "none";
          el("acRadio").checked = false; el("dcRadio").checked = false;
        }
      }
    } catch (_) { /* ignore */ }

    // Weekly banner (7-day full any-type)
    const chargeBannerEl = el("chargeBanner");
    if (!hasFull7) {
      chargeBannerEl.classList.remove("d-none");
      chargeBannerEl.textContent = "⚠️ No 100% charge in the last 7 days. Please do a full slow charge.";
    } else chargeBannerEl.classList.add("d-none");

    // Monthly banner (30-day full AC only)
    const acBannerEl = el("acBanner");
    if (!hasFullAC30) {
      acBannerEl.classList.remove("d-none");
      acBannerEl.textContent = "⚠️ No 100% AC slow charge in the last 30 days. Do this soon for battery balancing.";
    } else acBannerEl.classList.add("d-none");

    // Banner for consecutive DC (last 5 charges are DC)
    if (lastChargeTypes.length === 5 && lastChargeTypes.every(t => t === "DC")) {
      acBannerEl.classList.remove("d-none");
      acBannerEl.textContent = "⚠️ Last 5 charges were DC. Please use AC slow charging next for battery health.";
    }
  } catch (e) {
    el("history").innerHTML = "Failed to load logs: " + e.message;
  }
}

// ------------------- EV Expenses (add, list, total, delete) -------------------
el("addEvExpenseBtn")?.addEventListener("click", async () => {
  try {
    const cat = el("evCategory").value || "Other";
    const amt = parseFloat(el("evAmount").value);
    if (!(amt > 0)) { showAlert("Enter valid EV expense amount."); return; }
    await addDoc(col("evExpenses"), { date: new Date().toISOString(), category: cat, amount: amt });
    el("evAmount").value = "";
    await loadEvExpenses();
    await updateSavingsSummary();
  } catch (e) { showAlert("Failed to add EV expense: " + e.message); }
});

async function loadEvExpenses() {
  try {
    const q = query(col("evExpenses"), orderBy("date", "desc"), limit(200));
    const snap = await getDocs(q);
    let total = 0, html = "";
    snap.forEach(d => {
      const x = d.data(); const id = d.id;
      total += Number(x.amount) || 0;
      const date = new Date(x.date);
      html += `
        <div class="border rounded p-2 mb-2 small bg-white">
          <div class="d-flex justify-content-between">
            <div><b>${x.category}</b><div class="text-muted small">${date.toLocaleDateString()}</div></div>
            <div>₹${x.amount}<button class="btn btn-sm btn-outline-danger ms-2" data-del-ev="${id}">🗑️</button></div>
          </div>
        </div>`;
    });
    el("evHistory").innerHTML = html || `<span class="text-muted">No EV expenses yet</span>`;
    el("evTotal").textContent = "Total: ₹" + Math.round(total);

    // delete handlers
    document.querySelectorAll("[data-del-ev]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        if (!confirmYes("Delete this EV expense?")) return;
        try {
          await deleteDoc(doc(col("evExpenses"), e.currentTarget.dataset.delEv));
          await loadEvExpenses();
          await updateSavingsSummary();
        } catch (err) { showAlert("Delete failed: " + err.message); }
      });
    });
    return total;
  } catch (e) {
    el("evHistory").innerHTML = "Failed to load EV expenses: " + e.message;
    return 0;
  }
}

// ------------------- ICE Expenses (manual + fuel cost calc + delete) -------------------
el("addIceExpenseBtn")?.addEventListener("click", async () => {
  try {
    const cat = el("iceCategory").value || "Other";
    const amt = parseFloat(el("iceAmount").value);
    if (!(amt > 0)) { showAlert("Enter valid ICE expense amount."); return; }
    await addDoc(col("iceExpenses"), { date: new Date().toISOString(), category: cat, amount: amt });
    el("iceAmount").value = "";
    await loadIceExpenses();
    await updateSavingsSummary();
  } catch (e) { showAlert("Failed to add ICE expense: " + e.message); }
});

async function loadIceExpenses() {
  try {
    const q = query(col("iceExpenses"), orderBy("date", "desc"), limit(200));
    const snap = await getDocs(q);
    let manualTotal = 0, html = "";
    snap.forEach(d => {
      const x = d.data(); const id = d.id;
      manualTotal += Number(x.amount) || 0;
      const date = new Date(x.date);
      html += `
        <div class="border rounded p-2 mb-2 small bg-white">
          <div class="d-flex justify-content-between">
            <div><b>${x.category}</b><div class="text-muted small">${date.toLocaleDateString()}</div></div>
            <div>₹${x.amount}<button class="btn btn-sm btn-outline-danger ms-2" data-del-ice="${id}">🗑️</button></div>
          </div>
        </div>`;
    });

    // Delete handlers
    el("iceHistory").innerHTML = html || `<span class="text-muted">No ICE expenses yet</span>`;
    document.querySelectorAll("[data-del-ice]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        if (!confirmYes("Delete this ICE expense?")) return;
        try {
          await deleteDoc(doc(col("iceExpenses"), e.currentTarget.dataset.delIce));
          await loadIceExpenses();
          await updateSavingsSummary();
        } catch (err) { showAlert("Delete failed: " + err.message); }
      });
    });

    // Calculate dynamic fuel cost
    const fuelCost = await calcFuelCostDynamic();
    let total = manualTotal + fuelCost;
    let fuelHtml = "";
    if (fuelCost > 0) {
      fuelHtml = `
        <div class="border rounded p-2 mb-2 small bg-light">
          <div><b>Fuel cost (calculated)</b></div>
          <div class="text-muted small d-none">Based on odo logs & master price history</div>
          <div class="mt-1">₹${fuelCost.toFixed(0)}</div>
        </div>`;
    }
    el("iceFuelExpenses").innerHTML = fuelHtml;
    el("iceTotal").textContent = "Total: ₹" + Math.round(total);
    return total;
  } catch (e) {
    el("iceHistory").innerHTML = "Failed to load ICE expenses: " + e.message;
    return 0;
  }
}

// ------------------- Master Data (fuel price history) -------------------
el("saveMasterBtn")?.addEventListener("click", async () => {
  try {
    const fuelType = el("fuelType").value || "Diesel";
    const fuelPrice = parseFloat(el("fuelPrice").value);
    const mileage = parseFloat(el("mileage").value);
    const fuelDateVal = el("fuelDate").value;
    if (!(fuelPrice > 0) || !(mileage > 0)) { showAlert("Enter valid price and mileage."); return; }

    const dateISO = fuelDateVal ? new Date(fuelDateVal + "T00:00:00").toISOString() : new Date().toISOString();
    await addDoc(col("masterData"), { fuelType, fuelPrice, mileage, date: dateISO });
    showAlert("Master data saved.");
    await loadMasterHistory();
    await updateSavingsSummary();
  } catch (e) {
    showAlert("Failed to save master data: " + e.message);
  }
});

async function loadMasterHistory() {
  try {
    const q = query(col("masterData"), orderBy("date", "desc"), limit(200));
    const snap = await getDocs(q);
    let html = "";
    snap.forEach(d => {
      const x = d.data(); const id = d.id;
      const date = new Date(x.date);
      html += `
        <div class="border rounded p-2 mb-2 small bg-white">
          <div class="d-flex justify-content-between">
            <div><b>₹${x.fuelPrice}/L • ${x.mileage} km/L</b><div class="text-muted small">${date.toLocaleDateString()}</div></div>
            <div><button class="btn btn-sm btn-outline-danger" data-del-master="${id}">🗑️</button></div>
          </div>
        </div>`;
    });
    el("masterHistory").innerHTML = html || `<span class="text-muted">No master data yet</span>`;

    document.querySelectorAll("[data-del-master]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        if (!confirmYes("Delete this master entry?")) return;
        try {
          await deleteDoc(doc(col("masterData"), e.currentTarget.dataset.delMaster));
          await loadMasterHistory();
          await updateSavingsSummary();
        } catch (err) { showAlert("Delete failed: " + err.message); }
      });
    });
  } catch (e) {
    el("masterHistory").innerHTML = "Failed to load master data: " + e.message;
  }
}

// ------------------- Dynamic fuel cost calculation (segment by masterData date) -------------------
async function calcFuelCostDynamic() {
  try {
    // Get master price history sorted ascending by date
    const mSnap = await getDocs(query(col("masterData"), orderBy("date", "asc")));
    const masters = mSnap.docs.map(d => d.data()).map(m => ({
      fuelPrice: Number(m.fuelPrice),
      mileage: Number(m.mileage),
      date: new Date(m.date)
    }));
    if (!masters.length) return 0;

    // Get daily logs sorted ascending by date
    const logsSnap = await getDocs(query(col("dailyLogs"), orderBy("date", "asc")));
    const logs = logsSnap.docs.map(d => d.data()).map(l => ({
      date: new Date(l.date),
      odo: Number(l.odo)
    }));

    if (logs.length === 0) return 0;

    // If only one log exists, assume previous odo = 0
    if (logs.length === 1) {
      const curr = logs[0];
      const dist = curr.odo;  // since prev = 0
      if (dist <= 0) return 0;

      // find applicable master record
      let applicable = masters[0];
      for (let j = 0; j < masters.length; j++) {
        if (masters[j].date.getTime() <= curr.date.getTime()) applicable = masters[j];
        else break;
      }

      if (applicable && applicable.mileage > 0 && applicable.fuelPrice > 0) {
        const litres = dist / applicable.mileage;
        return litres * applicable.fuelPrice;
      }
      return 0;
    }

    // If 2 or more logs, do normal segment-by-segment calculation
    let totalFuelCost = 0;
    for (let i = 1; i < logs.length; i++) {
      const prev = logs[i - 1];
      const curr = logs[i];
      const dist = curr.odo - prev.odo;
      if (!(dist > 0)) continue;

      // find applicable master record: last one with date <= curr.date
      let applicable = null;
      for (let j = 0; j < masters.length; j++) {
        if (masters[j].date.getTime() <= curr.date.getTime()) applicable = masters[j];
        else break;
      }
      if (!applicable) applicable = masters[0];

      if (applicable && applicable.mileage > 0 && applicable.fuelPrice > 0) {
        const litres = dist / applicable.mileage;
        totalFuelCost += litres * applicable.fuelPrice;
      }
    }
    return totalFuelCost;
  } catch (e) {
    console.warn("Fuel cost calc failed:", e.message);
    return 0;
  }
}


// ------------------- Savings summary (EV total, ICE total, Net savings) -------------------
async function updateSavingsSummary() {
  try {
    // EV manual total
    const evSnap = await getDocs(query(col("evExpenses"), orderBy("date", "desc")));
    let evTotal = 0;
    evSnap.forEach(d => evTotal += Number(d.data().amount) || 0);

    // ICE manual total
    const iceSnap = await getDocs(query(col("iceExpenses"), orderBy("date", "desc")));
    let iceManual = 0;
    iceSnap.forEach(d => iceManual += Number(d.data().amount) || 0);

    // ICE dynamic fuel cost
    const iceFuel = await calcFuelCostDynamic();
    const iceTotal = iceManual + iceFuel;

    // Display summary in Charging tab top
    const savings = iceTotal - evTotal;
    const summaryEl = el("savingsSummary");
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div><small class="text-muted">EV total</small> <b>₹${Math.round(evTotal)}</b> &nbsp; | &nbsp;
        <small class="text-muted">ICE total</small> <b>₹${Math.round(iceTotal)}</b> &nbsp; | &nbsp;
        <small class="text-muted">Net savings</small> <b class="${savings>=0 ? 'text-success' : 'text-danger'}">₹${Math.round(savings)}</b></div>
      `;
    }

    // Show EV total inside EV tab
    if (el("evTotal")) el("evTotal").textContent = "Total: ₹" + Math.round(evTotal);

    // Show ICE total inside ICE tab
    if (el("iceTotal")) el("iceTotal").textContent = "Total: ₹" + Math.round(iceTotal);

    // also refresh expense lists
    await loadEvExpenses();
    await loadIceExpenses();
    await loadMasterHistory();
    await loadDailyLogs();
  } catch (e) {
    console.warn("Update savings failed:", e.message);
  }
}

// ------------------- loadAll: called on sign-in -------------------
async function loadAll() {
  // load everything in parallel where possible
  await Promise.all([
    loadDailyLogs(),
    loadEvExpenses(),
    loadIceExpenses(),
    loadMasterHistory()
  ]);
  await updateSavingsSummary();
}

// ------------------- PWA service worker -------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(err => console.warn("SW reg failed:", err));
  });
}

// ------------------- Initial: if user already signed-in, load data (on page reload) -------------------
if (auth.currentUser) {
  loadAll();
}
