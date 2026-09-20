// Baritone ukulele is tuned D3 G3 B3 E4 -- the same pitches as a guitar's
// top 4 strings, but *not* interchangeable with standard guitar chord
// diagrams, because a shape that relies on the guitar's low E/A strings for
// its root or character tone comes out wrong once those two strings are
// gone (e.g. the open "Cmaj7" guitar shape has no C at all on strings D-G-B-e).
//
// Rather than hand-type a fingering chart that can't be verified by ear
// here, fingerings are computed from chord-tone theory: search fret
// positions 0-4 (falling back to 0-7) on each of the 4 strings for a
// combination whose sounded pitch classes are all valid chord tones and
// include both the root and the third/sus tone, then pick the lowest,
// most-open voicing. This is correct by construction rather than by
// transcription.

const ROOT_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

const CHORD_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
};

// Open strings low to high: D, G, B, e.
const STRING_OPEN_PC = [2, 7, 11, 4];
const STRING_LABELS = ['D', 'G', 'B', 'e'];

function parseChordSymbol(sym) {
  if (!sym) return null;
  const cleaned = sym.replace(/\(.*?\)/g, '').split('/')[0].trim();
  const m = cleaned.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return null;
  const rootKey = m[1].toUpperCase() + m[2];
  const rootPc = ROOT_PC[rootKey];
  if (rootPc === undefined) return null;

  const rest = m[3].toLowerCase();
  let quality = 'major';
  if (/^(maj7|maj9|Δ)/.test(rest)) quality = 'maj7';
  else if (/^maj/.test(rest)) quality = 'major';
  else if (/^(dim|°)/.test(rest)) quality = 'dim';
  else if (/^(aug|\+)/.test(rest)) quality = 'aug';
  else if (/^sus4/.test(rest)) quality = 'sus4';
  else if (/^sus2/.test(rest)) quality = 'sus2';
  else if (/^(m6|min6)/.test(rest)) quality = 'm6';
  else if (/^(m7|min7|m9|min9)/.test(rest)) quality = 'm7';
  else if (/^(m|min)(?!aj)/.test(rest)) quality = 'minor';
  else if (/^(7|9|11|13)/.test(rest)) quality = '7';
  else if (/^6/.test(rest)) quality = '6';

  return { rootPc, quality, label: cleaned };
}

const fingeringCache = new Map();

function computeFingering(sym) {
  if (fingeringCache.has(sym)) return fingeringCache.get(sym);

  const parsed = parseChordSymbol(sym);
  if (!parsed) {
    fingeringCache.set(sym, null);
    return null;
  }
  const { rootPc, quality } = parsed;
  const intervals = CHORD_INTERVALS[quality] || CHORD_INTERVALS.major;
  const allowed = new Set(intervals.map((iv) => (rootPc + iv) % 12));
  const characterInterval = intervals.find((iv) => iv === 2 || iv === 3 || iv === 4 || iv === 5);
  const characterPc = characterInterval !== undefined ? (rootPc + characterInterval) % 12 : null;
  // A 4-tone chord (7, maj7, m7, 6, m6) is defined by its 4th tone -- without
  // it, the fingering is indistinguishable from the plain triad, so it's
  // required, not just preferred.
  const extraPc = intervals.length === 4 ? (rootPc + intervals[3]) % 12 : null;

  let best = null;
  for (const maxFret of [4, 7]) {
    for (let a = 0; a <= maxFret; a++) {
      for (let b = 0; b <= maxFret; b++) {
        for (let c = 0; c <= maxFret; c++) {
          for (let d = 0; d <= maxFret; d++) {
            const frets = [a, b, c, d];
            const pcs = frets.map((f, i) => (STRING_OPEN_PC[i] + f) % 12);
            if (!pcs.every((pc) => allowed.has(pc))) continue;
            if (!pcs.includes(rootPc)) continue;
            if (characterPc !== null && !pcs.includes(characterPc)) continue;
            if (extraPc !== null && !pcs.includes(extraPc)) continue;

            const sum = frets.reduce((s, f) => s + f, 0);
            const openCount = frets.filter((f) => f === 0).length;
            const score = sum * 10 - openCount * 3;
            if (!best || score < best.score) best = { frets, score, pcs };
          }
        }
      }
    }
    if (best) break;
  }

  const result = best ? { frets: best.frets, root: rootPc, label: parsed.label } : null;
  fingeringCache.set(sym, result);
  return result;
}

function renderChordDiagram(container, sym) {
  const fingering = computeFingering(sym);
  container.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'chord-diagram-title';
  title.textContent = sym;
  container.appendChild(title);

  if (!fingering) {
    const unknown = document.createElement('div');
    unknown.className = 'chord-diagram-unknown';
    unknown.textContent = "Couldn't work out a fingering for this chord.";
    container.appendChild(unknown);
    return;
  }

  const { frets } = fingering;
  const maxFret = Math.max(...frets, 1);
  const topFret = maxFret <= 4 ? 0 : Math.min(...frets.filter((f) => f > 0)) - 1;
  const numFretsShown = 4;

  const width = 120;
  const height = 140;
  const nutY = 20;
  const fretGap = (height - nutY - 10) / numFretsShown;
  const stringGap = (width - 20) / 3;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'chord-diagram-svg');

  // Strings
  for (let s = 0; s < 4; s++) {
    const x = 10 + s * stringGap;
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('y1', nutY);
    line.setAttribute('y2', height - 10);
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '1.5');
    svg.appendChild(line);

    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', x);
    label.setAttribute('y', nutY - 6);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'chord-diagram-string-label');
    label.textContent = STRING_LABELS[s];
    svg.appendChild(label);
  }

  // Frets
  for (let f = 0; f <= numFretsShown; f++) {
    const y = nutY + f * fretGap;
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', 10);
    line.setAttribute('x2', width - 10);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', f === 0 && topFret === 0 ? '3' : '1');
    svg.appendChild(line);
  }

  if (topFret > 0) {
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', 4);
    label.setAttribute('y', nutY + fretGap);
    label.setAttribute('class', 'chord-diagram-fret-label');
    label.textContent = `${topFret + 1}fr`;
    svg.appendChild(label);
  }

  // Finger dots / open circles
  frets.forEach((fret, s) => {
    const x = 10 + s * stringGap;
    if (fret === 0) {
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', nutY - 10);
      circle.setAttribute('r', 4);
      circle.setAttribute('class', 'chord-diagram-open');
      svg.appendChild(circle);
      return;
    }
    const relativeFret = fret - topFret;
    const y = nutY + (relativeFret - 0.5) * fretGap;
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', 6);
    dot.setAttribute('class', 'chord-diagram-dot');
    svg.appendChild(dot);
  });

  container.appendChild(svg);
}
