// Minimal ChordPro-style parser. Supports the subset that matters for a
// chord-chart-with-lyrics view:
//   {title: ...} {artist: ...} {key: ...} {tempo: ...} {time: 4/4}
//   {start_of_chorus}/{soc} ... {end_of_chorus}/{eoc}, {comment: ...}/{c: ...}
//   inline chords: "Some [G]lyrics [D]here"
// Anything else is treated as plain lyric text rather than rejected, so a
// pasted real-world ChordPro file degrades gracefully instead of failing.

function parseChordPro(text) {
  const song = {
    title: '',
    artist: '',
    key: '',
    tempo: null,
    timeSig: '4/4',
    sections: [],
  };

  let current = { name: '', lines: [] };
  const pushSection = () => {
    if (current.lines.length) song.sections.push(current);
    current = { name: '', lines: [] };
  };

  const directiveRe = /^\{\s*([a-zA-Z_#]+)\s*:?\s*(.*?)\s*\}$/;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      pushSection();
      continue;
    }

    const m = line.match(directiveRe);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2];
      if (key === 'title' || key === 't') song.title = val;
      else if (key === 'artist' || key === 'subtitle' || key === 'st') song.artist = val;
      else if (key === 'key') song.key = val;
      else if (key === 'tempo') song.tempo = parseInt(val, 10) || null;
      else if (key === 'time') song.timeSig = val || '4/4';
      else if (key === 'start_of_chorus' || key === 'soc') {
        pushSection();
        current.name = 'Chorus';
      } else if (key === 'start_of_verse' || key === 'sov') {
        pushSection();
        current.name = 'Verse';
      } else if (key === 'end_of_chorus' || key === 'eoc' || key === 'end_of_verse' || key === 'eov') {
        pushSection();
      } else if (key === 'comment' || key === 'c') {
        pushSection();
        current.name = val || 'Note';
      }
      // Unrecognized directives are silently ignored (not rendered as lyrics).
      continue;
    }

    const chords = [];
    let lyricText = '';
    let i = 0;
    while (i < line.length) {
      if (line[i] === '[') {
        const end = line.indexOf(']', i);
        if (end !== -1) {
          chords.push({ sym: line.slice(i + 1, end).trim(), offset: lyricText.length });
          i = end + 1;
          continue;
        }
      }
      lyricText += line[i];
      i++;
    }
    current.lines.push({ chords, text: lyricText });
  }
  pushSection();

  if (!song.sections.length) song.sections.push({ name: '', lines: [] });
  return song;
}
