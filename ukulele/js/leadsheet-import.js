// Best-effort conversion of an uploaded PDF or Word lead sheet into the
// same ChordPro-ish text the rest of the app already understands.
//
// Neither format tells us which words are "chords" vs "lyrics" -- we only
// get flat text (Word, via mammoth.js) or positioned text fragments (PDF,
// via pdf.js). So this reconstructs a monospace-ish page layout from
// character positions, then applies a simple, well-known lead-sheet
// convention: a line made up entirely of chord symbols (optionally with
// barlines) sitting directly above a line of lyrics means those chords
// align to that lyric line by column. That covers the common case; odd
// layouts (chords inside a table, scanned/image PDFs with no real text
// layer, lyrics wrapped mid-chord) won't convert cleanly -- the result is
// shown for review/edit before loading, never auto-loaded silently.

const BARLINE_TOKENS = new Set(['|', '||', ':|', '|:', ':||', '||:', '%', '/']);
const NO_CHORD_TOKENS = new Set(['n.c.', 'nc', 'tacet']);

// parseChordSymbol (chords-baritone.js) is deliberately lenient -- it's
// meant to fingerprint a symbol that's *already known* to be a chord (one
// written inside [brackets] in a ChordPro file). It'll happily parse
// "Amazing" as "Am" (root A, and "azing" satisfies its minor-quality
// regex) or "Grace" as a plain "G" (unrecognized suffix falls back to
// major). That leniency is wrong here, where the whole job is deciding
// *whether* a plain-text word is a chord at all -- so standalone-token
// detection uses its own strict whitelist of real chord suffixes instead.
const CHORD_TOKEN_RE = /^[A-G](#|b)?(maj7|maj9|maj13|maj|m7b5|m7|m9|m6|madd9|m|min7|min9|min6|min|dim7|dim|aug|sus2|sus4|sus|add9|add11|6\/9|6|7sus4|7|9|11|13|\+)?(\/[A-G](#|b)?)?$/i;

function isChordLikeToken(tok) {
  const lower = tok.toLowerCase();
  if (BARLINE_TOKENS.has(tok) || NO_CHORD_TOKENS.has(lower)) return 'divider';
  if (CHORD_TOKEN_RE.test(tok) && parseChordSymbol(tok)) return 'chord';
  return null;
}

function classifyLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'blank' };
  const tokenRe = /\S+/g;
  const tokens = [];
  let m;
  while ((m = tokenRe.exec(line))) tokens.push({ text: m[0], offset: m.index });
  let chordCount = 0;
  for (const t of tokens) {
    const kind = isChordLikeToken(t.text);
    if (!kind) return { kind: 'text', tokens };
    if (kind === 'chord') chordCount++;
  }
  if (chordCount === 0) return { kind: 'text', tokens };
  return { kind: 'chords', tokens: tokens.filter((t) => isChordLikeToken(t.text) === 'chord') };
}

function mergeChordAndLyricLines(rawText) {
  const lines = rawText.split(/\r?\n/);
  const out = [];
  let i = 0;
  let titleGuessed = false;
  let title = '';

  if (lines.length) {
    const first = lines[0].trim();
    if (first && first.length <= 60 && classifyLine(first).kind === 'text' && !/^\d/.test(first)) {
      title = first;
      titleGuessed = true;
      i = 1;
      while (i < lines.length && !lines[i].trim()) i++;
    }
  }

  for (; i < lines.length; i++) {
    const info = classifyLine(lines[i]);
    if (info.kind === 'blank') {
      out.push('');
      continue;
    }
    if (info.kind === 'chords') {
      // Look at the very next line, or -- since Word's paragraph-per-line
      // export puts a blank line between every paragraph, including
      // between a chord line and the lyric line it belongs to -- one line
      // past a single blank, but no further (two+ blanks means it's a
      // real gap, not paragraph-separator noise).
      let lookaheadIdx = i + 1;
      let skippedBlank = false;
      if (lookaheadIdx < lines.length && !lines[lookaheadIdx].trim()) {
        skippedBlank = true;
        lookaheadIdx++;
      }
      const next = lookaheadIdx < lines.length ? lines[lookaheadIdx] : '';
      const nextInfo = classifyLine(next);
      if (nextInfo.kind === 'text') {
        out.push(buildChordLyricLine(info.tokens, next));
        i = lookaheadIdx;
      } else {
        out.push(buildChordLyricLine(info.tokens, ''));
        if (skippedBlank) out.push(''); // preserve the gap we peeked past but didn't use
      }
      continue;
    }
    // plain text line, no chords recognized
    out.push(lines[i]);
  }

  let result = '';
  if (titleGuessed) result += `{title: ${title}}\n`;
  result += '{key: }\n{tempo: }\n\n';
  result += out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return result;
}

function buildChordLyricLine(chordTokens, lyricLine) {
  let maxLen = lyricLine.length;
  for (const t of chordTokens) maxLen = Math.max(maxLen, t.offset + t.text.length);
  const chars = lyricLine.padEnd(maxLen, ' ').split('');
  // Insert from rightmost chord first so earlier insertions don't shift
  // later offsets.
  const sorted = [...chordTokens].sort((a, b) => b.offset - a.offset);
  for (const t of sorted) {
    chars.splice(t.offset, 0, `[${t.text}]`);
  }
  return chars.join('').replace(/ +$/, '') || `${chordTokens.map((t) => `[${t.text}]`).join(' ')}`;
}

// ---------- PDF text-layer extraction with column reconstruction ----------

async function extractLinesFromPdf(arrayBuffer) {
  if (!window.pdfjsLib) throw new Error('PDF support failed to load.');
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => it.str !== undefined)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width || Math.abs(it.transform[0]) * it.str.length * 0.5,
      }));
    if (!items.length) continue;

    const medianOf = (nums) => {
      if (!nums.length) return null;
      const sorted = [...nums].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const pageCharWidth = Math.max(
      medianOf(items.filter((it) => it.str.trim().length > 0).map((it) => it.width / it.str.length)) || 5,
      2
    );

    // Group into lines by y (rows), tolerant of small jitter.
    const rows = [];
    for (const it of items) {
      let row = rows.find((r) => Math.abs(r.y - it.y) < 2.5);
      if (!row) {
        row = { y: it.y, items: [] };
        rows.push(row);
      }
      row.items.push(it);
    }
    rows.sort((a, b) => b.y - a.y); // top of page first

    const minX = Math.min(...items.map((it) => it.x));
    const lines = rows.map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      // A row's own font size can differ from the page median (a bigger
      // title line, a smaller chord annotation) -- using the page-wide
      // char width for such a row mis-places its columns, so prefer this
      // row's own measured width when it has one.
      const rowCharWidth = Math.max(
        medianOf(row.items.filter((it) => it.str.trim().length > 0).map((it) => it.width / it.str.length)) ||
          pageCharWidth,
        2
      );
      const chars = [];
      for (const it of row.items) {
        const col = Math.max(0, Math.round((it.x - minX) / rowCharWidth));
        while (chars.length < col) chars.push(' ');
        for (const ch of it.str) chars.push(ch);
      }
      return chars.join('');
    });
    pageTexts.push(lines.join('\n'));
  }

  return pageTexts.join('\n\n');
}

async function extractTextFromDocx(arrayBuffer) {
  if (!window.mammoth) throw new Error('Word document support failed to load.');
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function importLeadSheetFile(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  let rawText;
  if (name.endsWith('.pdf')) {
    rawText = await extractLinesFromPdf(buf);
  } else if (name.endsWith('.docx')) {
    rawText = await extractTextFromDocx(buf);
  } else if (name.endsWith('.doc')) {
    throw new Error("Old-format .doc isn't supported, only .docx -- try re-saving from Word as .docx.");
  } else {
    throw new Error('Unsupported file type.');
  }
  if (!rawText || !rawText.trim()) {
    throw new Error("Couldn't find any text in that file (a scanned/image-only PDF has no text layer to read).");
  }
  return mergeChordAndLyricLines(rawText);
}
