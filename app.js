import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, onSnapshot,
  addDoc, setDoc, updateDoc, deleteDoc, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=8";

const app = document.getElementById("app");

const STATUSES = [
  { key: "yes", label: "Attending" },
  { key: "maybe", label: "Maybe" },
  { key: "no", label: "Not attending" },
];

// Live data from Firestore, plus a bit of UI state.
let players = [];
let games = [];
let view = "games";
let editingGameId = null;
let adding = false; // "Add game" form open
let selected = null; // { gameId, playerId } — the player whose status is being changed
let renderPending = false;

// "Remember me": which player uses this device, saved on this device only
const ME_KEY = "soccer-me";
let me = null; // player id, or "skip" if they chose not to pick
try { me = localStorage.getItem(ME_KEY); } catch {}
let choosingMe = false; // "Who are you?" picker reopened to switch names
function saveMe(value) {
  me = value;
  try { localStorage.setItem(ME_KEY, value); } catch {}
}
const myPlayer = () => players.find((p) => p.id === me);

// Installable app: register the service worker and show "Install app" when the browser offers it
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
const installBtn = document.getElementById("install");
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  installBtn.hidden = true;
  await installPrompt?.prompt();
  installPrompt = null;
});

if (firebaseConfig.apiKey.startsWith("PASTE")) {
  app.innerHTML = `<div class="card"><h2>Almost there</h2>
    <p>Add your Firebase settings to <code>firebase-config.js</code>. See the README for the steps.</p></div>`;
} else {
  const db = getFirestore(initializeApp(firebaseConfig));
  const playersCol = collection(db, "players");
  const gamesCol = collection(db, "games");
  const onError = (err) => {
    app.innerHTML = `<div class="card"><h2>Can't reach the database</h2><p>${esc(err.message)}</p></div>`;
  };

  onSnapshot(playersCol, (snap) => {
    players = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    render();
  }, onError);

  let synced = false;
  onSnapshot(gamesCol, (snap) => {
    games = snap.docs.map((d) => ({ id: d.id, attendance: {}, ...d.data() }));
    render();
    if (!synced) { synced = true; syncCalendar(db); }
  }, onError);

  // Tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      view = tab.dataset.view;
      render(true);
    });
  });

  // Button clicks
  app.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, game, player, status } = btn.dataset;

    if (action === "pick") {
      const same = selected && selected.gameId === game && selected.playerId === player;
      selected = same ? null : { gameId: game, playerId: player };
      render(true);
    } else if (action === "set-status") {
      const { gameId, playerId } = selected;
      selected = null;
      await updateDoc(doc(db, "games", gameId), {
        [`attendance.${playerId}`]: status === "clear" ? deleteField() : status,
      });
    } else if (action === "my-status") {
      await updateDoc(doc(db, "games", game), { [`attendance.${me}`]: status });
    } else if (action === "change-me") {
      choosingMe = true;
      view = "games";
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === "games"));
      render(true);
      window.scrollTo(0, 0);
    } else if (action === "cancel-me") {
      choosingMe = false;
      render(true);
    } else if (action === "skip-me") {
      saveMe("skip");
      choosingMe = false;
      render(true);
    } else if (action === "edit-game") {
      editingGameId = game;
      render(true);
    } else if (action === "remind") {
      const text = reminderText(games.find((g) => g.id === game));
      try {
        if (navigator.share) await navigator.share({ text });
        else {
          await navigator.clipboard.writeText(text);
          btn.textContent = "Copied! Paste it in your group chat.";
        }
      } catch (err) {
        if (err.name !== "AbortError") prompt("Copy this reminder:", text);
      }
    } else if (action === "show-add") {
      adding = true;
      render(true);
    } else if (action === "cancel-edit") {
      editingGameId = null;
      adding = false;
      render(true);
    } else if (action === "delete-game") {
      if (confirm("Delete this game?")) {
        editingGameId = null;
        await deleteDoc(doc(db, "games", game));
      }
    } else if (action === "delete-player") {
      const p = players.find((x) => x.id === player);
      if (confirm(`Remove ${p.name} from the team?`)) await deleteDoc(doc(db, "players", player));
    }
  });

  // Form submits
  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));

    if (form.id === "add-player") {
      const name = data.name.trim();
      if (name) await addDoc(playersCol, { name });
      render(true);
      app.querySelector("#add-player input").focus();
    } else if (form.id === "add-game") {
      await addDoc(gamesCol, { date: data.date, time: data.time, note: data.note.trim(), attendance: {} });
      adding = false;
      render(true);
    } else if (form.id === "edit-game") {
      await updateDoc(doc(db, "games", editingGameId), { date: data.date, time: data.time, note: data.note.trim() });
      editingGameId = null;
      render(true);
    }
  });

  // Rename a player when their name box loses focus (or Enter is pressed)
  app.addEventListener("change", async (e) => {
    const input = e.target;
    if (input.id === "me-select") {
      if (input.value) { saveMe(input.value); choosingMe = false; render(true); }
      return;
    }
    if (!input.dataset.rename) return;
    const name = input.value.trim();
    if (name) await updateDoc(doc(db, "players", input.dataset.rename), { name });
  });

  // If someone else's update arrived while typing, redraw once typing is done
  app.addEventListener("focusout", () => {
    setTimeout(() => { if (renderPending) render(); });
  });
}

// Add games from the league calendar (games.json, updated by a GitHub Action).
// Only writes date/time/note, so attendance is never touched.
async function syncCalendar(db) {
  let list;
  try {
    const res = await fetch("games.json?t=" + Date.now());
    if (!res.ok) return;
    list = await res.json();
  } catch { return; }

  for (const { id, start, note } of list) {
    const date = start.length === 10 ? start : localDate(new Date(start));
    const time = start.length === 10 ? "" : new Date(start).toTimeString().slice(0, 5);
    const g = games.find((x) => x.id === id);
    if (!g || g.date !== date || g.time !== time || g.note !== note) {
      await setDoc(doc(db, "games", id), { date, time, note }, { merge: true });
    }
  }
}

function localDate(d) {
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function render(force = false) {
  // Don't wipe out a text box someone is typing in
  if (!force && app.contains(document.activeElement) && document.activeElement.tagName === "INPUT") {
    renderPending = true;
    return;
  }
  renderPending = false;
  app.innerHTML = view === "games" ? gamesView() : playersView();
}

function gamesView() {
  const today = localDate(new Date());
  const upcoming = games.filter((g) => g.date >= today).sort(byDate);
  const past = games.filter((g) => g.date < today).sort(byDate).reverse();

  return `
    <div class="toolbar">
      <h2>Upcoming</h2>
      ${adding ? "" : `<button class="btn primary" data-action="show-add">+ Add game</button>`}
    </div>
    ${adding ? gameForm("add-game") : ""}
    ${players.length ? meBar() : `<p class="muted">No players yet. Add them on the Players tab.</p>`}
    ${upcoming.length ? upcoming.map(gameCard).join("") : `<p class="muted">No upcoming games.</p>`}
    ${past.length ? `<details class="past"><summary>Past games (${past.length})</summary>${past.map(gameCard).join("")}</details>` : ""}
  `;
}

// Asks "Who are you?" until this device has picked a player (or skipped)
function meBar() {
  if (!choosingMe && (myPlayer() || me === "skip")) return "";
  return `
    <div class="card me-bar">
      <label for="me-select">Who are you?</label>
      <select id="me-select">
        <option value="">Pick your name</option>
        ${players.map((p) => `<option value="${p.id}"${p.id === me ? " selected" : ""}>${esc(p.name)}</option>`).join("")}
      </select>
      <div class="me-foot">
        <span class="hint">So you can reply with one tap. Saved on this device only.</span>
        <button class="link" data-action="${choosingMe && myPlayer() ? "cancel-me" : "skip-me"}">${choosingMe && myPlayer() ? "Cancel" : "Skip"}</button>
      </div>
    </div>`;
}

// One-tap reply for the player using this device
function quickRsvp(g) {
  const p = myPlayer();
  if (!p || g.date < localDate(new Date())) return "";
  const mine = g.attendance[p.id];
  const labels = { yes: "I'm in", maybe: "Maybe", no: "Out" };
  return `
    <div class="quick">
      <div class="quick-head">
        <span>${esc(p.name)}, are you in?</span>
        <button class="link" data-action="change-me">Not ${esc(p.name)}?</button>
      </div>
      <div class="segmented">
        ${STATUSES.map((s) => `<button class="${s.key}${mine === s.key ? " active" : ""}" data-action="my-status" data-game="${g.id}" data-status="${s.key}">${labels[s.key]}</button>`).join("")}
      </div>
    </div>`;
}

function gameForm(id, g = {}) {
  return `
    <form id="${id}" class="card game-form">
      <label>Date <input type="date" name="date" value="${esc(g.date)}" required></label>
      <label>Time <input type="time" name="time" value="${esc(g.time)}"></label>
      <label class="wide">Opponent / field <input name="note" value="${esc(g.note)}" placeholder="e.g. vs The Anglers · Red Field"></label>
      <div class="form-actions">
        <button class="btn primary">${id === "add-game" ? "Add game" : "Save"}</button>
        <button type="button" class="btn" data-action="cancel-edit">Cancel</button>
        ${id === "edit-game" ? `<button type="button" class="btn danger" data-action="delete-game" data-game="${g.id}">Delete game</button>` : ""}
      </div>
    </form>`;
}

function gameCard(g) {
  if (g.id === editingGameId) return gameForm("edit-game", g);

  const groups = { yes: [], maybe: [], no: [], none: [] };
  players.forEach((p) => groups[g.attendance[p.id] || "none"].push(p));

  const group = (key, label) => groups[key].length ? `
    <div class="group">
      <h3><span class="dot ${key}"></span>${label}</h3>
      <div class="chips">
        ${groups[key].map((p) => {
          const isSel = selected && selected.gameId === g.id && selected.playerId === p.id;
          return `<button class="chip ${key}${isSel ? " selected" : ""}" data-action="pick" data-game="${g.id}" data-player="${p.id}">${esc(p.name)}</button>`;
        }).join("")}
      </div>
      ${key === "none" ? `
        <div class="none-foot">
          <span class="hint">Tap a name to change status</span>
          ${g.date >= localDate(new Date()) ? `<button class="link" data-action="remind" data-game="${g.id}">Send reminder</button>` : ""}
        </div>` : ""}
    </div>` : "";

  const sel = selected && selected.gameId === g.id && players.find((p) => p.id === selected.playerId);
  const note = cleanNote(g);

  return `
    <article class="card game">
      <div class="game-head">
        <h2 class="when">${formatDate(g.date)}${g.time ? " · " + formatTime(g.time) : ""}</h2>
        <button class="link" data-action="edit-game" data-game="${g.id}">Edit</button>
      </div>
      ${note ? `<p class="note">${esc(note)}</p>` : ""}
      ${quickRsvp(g)}
      <p class="tally">
        <span><span class="dot yes"></span>${groups.yes.length} in</span>
        <span><span class="dot maybe"></span>${groups.maybe.length} maybe</span>
        <span><span class="dot no"></span>${groups.no.length} out</span>
        <span><span class="dot none"></span>${groups.none.length} no reply</span>
      </p>
      ${STATUSES.map((s) => group(s.key, s.label)).join("")}
      ${group("none", "No reply")}
      ${sel ? `
        <div class="picker">
          <div class="picker-head">
            <span class="picker-name">${esc(sel.name)}</span>
            <button class="link" data-action="set-status" data-status="clear">Clear</button>
          </div>
          <div class="segmented">
            ${STATUSES.map((s) => `<button class="${s.key}" data-action="set-status" data-status="${s.key}">${s.label}</button>`).join("")}
          </div>
        </div>` : ""}
    </article>`;
}

// Hide a street address ending in a ZIP code, e.g. "Red Field 6501 Changepoint Dr Anchorage AK 99518"
function cleanNote(g) {
  return (g.note || "").replace(/\s+\d+\s.*\d{5}(-\d{4})?$/, "");
}

function reminderText(g) {
  const waiting = players.filter((p) => !g.attendance[p.id]).map((p) => p.name);
  return `RSVP for ${formatDate(g.date)}: ${waiting.join(", ")}\n` + location.origin + location.pathname;
}

function playersView() {
  return `
    <div class="toolbar"><h2>Players <span class="count">${players.length}</span></h2></div>
    <form id="add-player" class="add-player">
      <input name="name" placeholder="Add a player" aria-label="Player name" required>
      <button class="btn primary">Add</button>
    </form>
    ${players.length ? `
      <div class="card list">
        ${players.map((p) => `
          <div class="player-row">
            <input value="${esc(p.name)}" data-rename="${p.id}" aria-label="Player name">
            <button class="link danger" data-action="delete-player" data-player="${p.id}">Remove</button>
          </div>`).join("")}
      </div>
      <p class="hint">Edit a name and tap outside the box to save.</p>
      <p class="hint">On this device you are: <strong>${myPlayer() ? esc(myPlayer().name) : "not set"}</strong>
        <button class="link" data-action="change-me">${myPlayer() ? "Change" : "Pick your name"}</button></p>` : `<p class="muted">No players yet.</p>`}`;
}

const byDate = (a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""));

function formatDate(d) {
  const date = new Date(d + "T00:00");
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : "numeric";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year });
}

function formatTime(t) {
  return new Date("2000-01-01T" + t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
