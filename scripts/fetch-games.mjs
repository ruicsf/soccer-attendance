// Downloads the league calendar (iCal) and writes upcoming games to games.json.
// Run by .github/workflows/sync-games.yml. The app adds these games to Firestore.
import { readFileSync, writeFileSync } from "node:fs";

const source = (process.env.CALENDAR_URL || "").trim().replace(/^webcal:/, "https:");
if (!source) {
  console.log("No CALENDAR_URL set; skipping.");
  process.exit(0);
}

const text = source.startsWith("http")
  ? await (await fetch(source)).text()
  : readFileSync(source, "utf8"); // local file, for testing

if (!text.includes("BEGIN:VCALENDAR")) {
  console.error("That link didn't return a calendar. First 200 characters:\n" + text.slice(0, 200));
  process.exit(1);
}

// iCal wraps long lines by starting the next line with a space
const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);

const events = [];
let ev = null;
for (const line of lines) {
  if (line === "BEGIN:VEVENT") ev = {};
  else if (line === "END:VEVENT") { events.push(ev); ev = null; }
  else if (ev) {
    const i = line.indexOf(":");
    const [name, ...params] = line.slice(0, i).split(";");
    ev[name] = { value: line.slice(i + 1), params: params.join(";") };
  }
}

const unescape = (s = "") => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

// "20260929T210000Z" -> "2026-09-29T21:00:00Z" (UTC); without Z it's local time; "20260929" -> "2026-09-29"
function toStart({ value }) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z?))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, z] = m;
  return h ? `${y}-${mo}-${d}T${h}:${mi}:00${z}` : `${y}-${mo}-${d}`;
}

const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const games = events
  .filter((e) => e.UID && e.DTSTART && e.STATUS?.value !== "CANCELLED")
  .map((e) => ({
    id: "cal-" + e.UID.value.replace(/[^A-Za-z0-9_-]/g, "_"),
    start: toStart(e.DTSTART),
    // Drop the street address: "The Dome on Red Field 6501 Changepoint Drive ..." -> "The Dome on Red Field"
    note: [unescape(e.SUMMARY?.value), unescape(e.LOCATION?.value).replace(/\s+\d+\s.*\d{5}(-\d{4})?$/, "")].filter(Boolean).join(" · "),
  }))
  .filter((g) => g.start && g.start.slice(0, 10) >= yesterday)
  .sort((a, b) => a.start.localeCompare(b.start));

writeFileSync("games.json", JSON.stringify(games, null, 2) + "\n");
console.log(`Saved ${games.length} upcoming games to games.json`);
