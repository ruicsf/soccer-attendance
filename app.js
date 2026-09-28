import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, onSnapshot,
  addDoc, setDoc, updateDoc, deleteDoc, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=3";

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
let selected = null; // { gameId, playerId } — the player whose status is being changed
let renderPending = false;

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
    } else if (action === "edit-game") {
      editingGameId = game;
      render(true);
    } else if (action === "cancel-edit") {
      editingGameId = null;
      render(true);
    } else if (action === "delete-game") {
      if (confirm("Delete this game?")) await deleteDoc(doc(db, "games", game));
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
    <form id="add-game" class="card form-row">
      <input type="date" name="date" required>
      <input type="time" name="time">
      <input name="note" placeholder="Opponent / field (optional)">
      <button class="btn primary">Add game</button>
    </form>
    ${players.length ? "" : `<p class="muted">No players yet — add some on the Players tab.</p>`}
    ${upcoming.length ? upcoming.map(gameCard).join("") : `<p class="muted">No upcoming games.</p>`}
    ${past.length ? `<details><summary>Past games (${past.length})</summary>${past.map(gameCard).join("")}</details>` : ""}
  `;
}

function gameCard(g) {
  if (g.id === editingGameId) {
    return `
      <form id="edit-game" class="card form-row">
        <input type="date" name="date" value="${esc(g.date)}" required>
        <input type="time" name="time" value="${esc(g.time)}">
        <input name="note" value="${esc(g.note)}" placeholder="Opponent / field (optional)">
        <button class="btn primary">Save</button>
        <button type="button" class="btn" data-action="cancel-edit">Cancel</button>
      </form>`;
  }

  const groups = { yes: [], maybe: [], no: [], none: [] };
  players.forEach((p) => groups[g.attendance[p.id] || "none"].push(p));

  const column = (key, label) => `
    <div class="col ${key}">
      <h3>${label} (${groups[key].length})</h3>
      ${groups[key].map((p) => {
        const isSel = selected && selected.gameId === g.id && selected.playerId === p.id;
        return `<button class="chip ${isSel ? "selected" : ""}" data-action="pick" data-game="${g.id}" data-player="${p.id}">${esc(p.name)}</button>`;
      }).join("")}
    </div>`;

  const sel = selected && selected.gameId === g.id && players.find((p) => p.id === selected.playerId);

  return `
    <div class="card">
      <div class="game-head">
        <div>
          <h2>${formatDate(g.date)}${g.time ? " · " + formatTime(g.time) : ""}</h2>
          ${g.note ? `<div class="note">${esc(g.note)}</div>` : ""}
        </div>
        <div class="actions">
          <button class="btn" data-action="edit-game" data-game="${g.id}">Edit</button>
          <button class="btn danger" data-action="delete-game" data-game="${g.id}">Delete</button>
        </div>
      </div>
      <div class="columns">
        ${STATUSES.map((s) => column(s.key, s.label)).join("")}
        ${column("none", "No reply")}
      </div>
      ${sel ? `
        <div class="picker">
          <strong>${esc(sel.name)}:</strong>
          ${STATUSES.map((s) => `<button class="btn ${s.key}" data-action="set-status" data-status="${s.key}">${s.label}</button>`).join("")}
          <button class="btn" data-action="set-status" data-status="clear">Clear</button>
        </div>` : `<p class="muted">Tap a name to change their status.</p>`}
    </div>`;
}

function playersView() {
  return `
    <form id="add-player" class="card form-row">
      <input name="name" placeholder="Player name" required>
      <button class="btn primary">Add player</button>
    </form>
    <div class="card">
      ${players.length ? players.map((p) => `
        <div class="player-row">
          <input value="${esc(p.name)}" data-rename="${p.id}" aria-label="Player name">
          <button class="btn danger" data-action="delete-player" data-player="${p.id}">Remove</button>
        </div>`).join("") : `<p class="muted">No players yet.</p>`}
      ${players.length ? `<p class="muted">Edit a name and tap outside the box to save.</p>` : ""}
    </div>`;
}

const byDate = (a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""));

function formatDate(d) {
  return new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatTime(t) {
  return new Date("2000-01-01T" + t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
