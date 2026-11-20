// The jesters' taunts live in jester-lines.txt next to this file: plain text, one taunt per line, any characters.
// Blank lines are ignored. If the file cannot be read, these few stand in.
const FALLBACK = ["I've got you now!", "Trapped!", "Look at this fucking idiot!", "Back again, dumbass?", "Made you look, moron!"];
export async function loadJesterLines() {
  try {
    const r = await fetch('js/jester-lines.txt', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const l = (await r.text()).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return l.length ? l : FALLBACK;
  } catch (_) { return FALLBACK; }
}
