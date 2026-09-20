(function () {
  let audioCtx = null;
  let analyser = null;
  let micStream = null;
  let micSource = null;

  let currentSong = null;
  let metronome = null;
  let tuner = null;
  let rhythmCoach = null;
  let keyDetector = null;

  let flatLines = []; // { el, index } across the whole rendered song
  let scrollActive = false;
  let scrollRafId = null;
  let lineStartTimes = [];
  let scrollStartTime = 0;
  let activeLineIndex = -1;

  const $ = (id) => document.getElementById(id);

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  function showError(msg, durationMs = 6000) {
    const el = $('appError');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (el._hideTimer) clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.add('hidden'), durationMs);
  }
  const showMicError = showError;

  async function ensureMic() {
    if (micStream) return true;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micSource = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      micSource.connect(analyser);
      metronome = metronome || new Metronome(audioCtx);
      return true;
    } catch (err) {
      showMicError('Microphone access is needed for this feature: ' + (err.message || err));
      return false;
    }
  }

  function ensureMetronome() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!metronome) metronome = new Metronome(audioCtx);
    return metronome;
  }

  // ---------- Song loading & rendering ----------

  function populateDemoSongs() {
    const select = $('demoSongSelect');
    Object.keys(DEMO_SONGS).forEach((title) => {
      const opt = document.createElement('option');
      opt.value = title;
      opt.textContent = title;
      select.appendChild(opt);
    });
  }

  function loadSong(chordproText) {
    const song = parseChordPro(chordproText);
    currentSong = song;
    renderSong(song);
    $('songTitle').textContent = song.title || 'Untitled';
    $('songArtist').textContent = song.artist || '';
    $('keyDisplay').textContent = song.key || '—';
    $('timeSigDisplay').textContent = song.timeSig || '4/4';
    if (song.tempo) $('tempoInput').value = song.tempo;
    stopScroll();
  }

  function renderSong(song) {
    const view = $('songView');
    view.innerHTML = '';
    flatLines = [];
    let idx = 0;

    song.sections.forEach((section) => {
      if (section.name) {
        const header = document.createElement('div');
        header.className = 'section-header';
        header.textContent = section.name;
        view.appendChild(header);
      }
      section.lines.forEach((line) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'song-line';
        lineEl.dataset.index = String(idx);

        const chordRow = document.createElement('div');
        chordRow.className = 'chord-row';
        const lyricRow = document.createElement('div');
        lyricRow.className = 'lyric-row';
        lyricRow.textContent = line.text || ' ';

        line.chords.forEach((c) => {
          const span = document.createElement('span');
          span.className = 'chord-sym';
          span.textContent = c.sym;
          span.style.left = c.offset + 'ch';
          span.addEventListener('click', () => showChordDiagram(c.sym));
          chordRow.appendChild(span);
        });
        if (!line.chords.length) chordRow.innerHTML = ' ';

        lineEl.appendChild(chordRow);
        lineEl.appendChild(lyricRow);
        lineEl.addEventListener('click', () => jumpToLine(idx));
        view.appendChild(lineEl);

        flatLines.push(lineEl);
        idx++;
      });
    });

    if (!flatLines.length) {
      view.innerHTML = '<p class="empty-hint">This song has no lines to show.</p>';
    }
  }

  function showChordDiagram(sym) {
    const modal = $('chordModal');
    const content = $('chordModalContent');
    renderChordDiagram(content, sym);
    modal.classList.remove('hidden');
  }

  $('chordModal').addEventListener('click', (e) => {
    if (e.target.id === 'chordModal' || e.target.classList.contains('chord-modal-backdrop')) {
      $('chordModal').classList.add('hidden');
    }
  });

  // ---------- Auto-scroll playback ----------

  function beatsPerLine() {
    const sig = ($('timeSigDisplay').textContent || '4/4').split('/');
    return parseInt(sig[0], 10) || 4;
  }

  function startScroll() {
    if (!flatLines.length) return;
    ensureMetronome();
    const bpm = parseInt($('tempoInput').value, 10) || 90;
    const secondsPerLine = (beatsPerLine() * 60) / bpm;

    metronome.start(bpm, beatsPerLine());

    scrollStartTime = audioCtx.currentTime + 0.1;
    lineStartTimes = flatLines.map((_, i) => scrollStartTime + i * secondsPerLine);
    activeLineIndex = -1;
    scrollActive = true;
    highlightLoop();
  }

  function highlightLoop() {
    if (!scrollActive) return;
    const now = audioCtx.currentTime;
    let idx = activeLineIndex;
    while (idx + 1 < lineStartTimes.length && lineStartTimes[idx + 1] <= now) idx++;
    if (idx !== activeLineIndex) {
      if (activeLineIndex >= 0 && flatLines[activeLineIndex]) {
        flatLines[activeLineIndex].classList.remove('active-line');
      }
      activeLineIndex = idx;
      if (flatLines[activeLineIndex]) {
        flatLines[activeLineIndex].classList.add('active-line');
        if ($('autoScrollToggle').checked) {
          flatLines[activeLineIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
    if (idx >= lineStartTimes.length - 1 && now > lineStartTimes[lineStartTimes.length - 1] + 2) {
      stopScroll();
      return;
    }
    scrollRafId = requestAnimationFrame(highlightLoop);
  }

  function stopScroll() {
    scrollActive = false;
    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    if (metronome) metronome.stop();
    flatLines.forEach((el) => el.classList.remove('active-line'));
    activeLineIndex = -1;
  }

  function jumpToLine(idx) {
    flatLines.forEach((el) => el.classList.remove('active-line'));
    if (flatLines[idx]) {
      flatLines[idx].classList.add('active-line');
      flatLines[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (scrollActive) {
      // Re-anchor the schedule so playback continues from this line.
      const bpm = parseInt($('tempoInput').value, 10) || 90;
      const secondsPerLine = (beatsPerLine() * 60) / bpm;
      const now = audioCtx.currentTime;
      scrollStartTime = now - idx * secondsPerLine;
      lineStartTimes = flatLines.map((_, i) => scrollStartTime + i * secondsPerLine);
      activeLineIndex = idx - 1;
    }
  }

  $('playBtn').addEventListener('click', startScroll);
  $('stopBtn').addEventListener('click', stopScroll);

  // ---------- Tap tempo ----------

  let tapTimes = [];
  $('tapTempoBtn').addEventListener('click', () => {
    const now = performance.now();
    tapTimes = tapTimes.filter((t) => now - t < 3000);
    tapTimes.push(now);
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
      const avgMs = intervals.reduce((s, x) => s + x, 0) / intervals.length;
      const bpm = Math.round(60000 / avgMs);
      if (bpm >= 30 && bpm <= 240) $('tempoInput').value = bpm;
    }
  });

  // ---------- Tabs ----------

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      $('tab-' + btn.dataset.tab).classList.remove('hidden');

      if (btn.dataset.tab !== 'tuner' && tuner) tuner.stop();
      if (btn.dataset.tab !== 'rhythm' && rhythmCoach) {
        rhythmCoach.stop();
        $('rhythmToggleBtn').textContent = '🎤 Start Rhythm Coach';
      }
    });
  });

  // ---------- Tuner ----------

  let tunerRunning = false;
  $('tunerToggleBtn').addEventListener('click', async () => {
    if (tunerRunning) {
      tuner.stop();
      tunerRunning = false;
      $('tunerToggleBtn').textContent = '🎤 Start Tuner';
      return;
    }
    const ok = await ensureMic();
    if (!ok) return;
    tuner = tuner || new Tuner(audioCtx, analyser);
    tuner.onUpdate = (info) => {
      if (!info) {
        $('tunerNote').textContent = '—';
        $('tunerCents').textContent = '';
        $('tunerString').textContent = '';
        $('tunerNeedle').style.transform = 'translateX(-50%) rotate(0deg)';
        return;
      }
      $('tunerNote').textContent = `${info.noteName}${info.octave}`;
      $('tunerCents').textContent = (info.cents > 0 ? '+' : '') + info.cents + ' cents';
      $('tunerString').textContent = `Nearest baritone string: ${info.nearestString.name}`;
      const angle = Math.max(-45, Math.min(45, info.cents * 0.9));
      $('tunerNeedle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
      $('tunerNeedle').classList.toggle('in-tune', Math.abs(info.cents) <= 5);
    };
    tuner.start();
    tunerRunning = true;
    $('tunerToggleBtn').textContent = '⏹ Stop Tuner';
  });

  // ---------- Key detection ----------

  $('detectKeyBtn').addEventListener('click', async () => {
    const ok = await ensureMic();
    if (!ok) return;
    keyDetector = keyDetector || new KeyDetector(audioCtx, analyser);
    const btn = $('detectKeyBtn');
    btn.disabled = true;
    keyDetector.onProgress = (frac) => {
      btn.textContent = `Listening… ${Math.round(frac * 100)}%`;
    };
    const result = await keyDetector.start(6);
    btn.disabled = false;
    btn.textContent = 'Detect from mic';
    if (result) {
      $('keyDisplay').textContent = result.key;
      if (currentSong) currentSong.key = result.key;
    } else {
      showMicError("Couldn't detect a key — try playing/strumming more during the 6 seconds.");
    }
  });

  // ---------- Rhythm coach ----------

  let rhythmRunning = false;
  $('rhythmToggleBtn').addEventListener('click', async () => {
    if (rhythmRunning) {
      rhythmCoach.stop();
      ensureMetronome().stop();
      rhythmRunning = false;
      $('rhythmToggleBtn').textContent = '🎤 Start Rhythm Coach';
      return;
    }
    const ok = await ensureMic();
    if (!ok) return;
    const bpm = parseInt($('tempoInput').value, 10) || 90;
    metronome.start(bpm, beatsPerLine());
    rhythmCoach = rhythmCoach || new RhythmCoach(audioCtx, analyser, metronome);
    rhythmCoach.onHit = renderBeatHit;
    rhythmCoach.start();
    rhythmRunning = true;
    $('rhythmToggleBtn').textContent = '⏹ Stop Rhythm Coach';
    rhythmStatsLoop();
  });

  function renderBeatHit(hit) {
    const track = $('beatTrack');
    const dot = document.createElement('span');
    dot.className = 'beat-dot rating-' + hit.rating;
    dot.title = `${Math.round(hit.deltaMs)} ms`;
    track.appendChild(dot);
    while (track.children.length > 40) track.removeChild(track.firstChild);
    track.scrollLeft = track.scrollWidth;
  }

  function rhythmStatsLoop() {
    if (!rhythmRunning) return;
    const stats = rhythmCoach.stats();
    $('statOnTime').textContent = stats.count ? Math.round(stats.onTimePct) + '%' : '—';
    $('statAvgMs').textContent = stats.count ? Math.round(stats.avgAbsMs) + ' ms' : '—';
    $('statCount').textContent = String(rhythmCoach.hits.length);
    setTimeout(rhythmStatsLoop, 400);
  }

  // ---------- Loading UI ----------

  $('demoSongSelect').addEventListener('change', (e) => {
    const title = e.target.value;
    if (title && DEMO_SONGS[title]) loadSong(DEMO_SONGS[title]);
  });

  $('togglePasteBtn').addEventListener('click', () => {
    $('pasteArea').classList.toggle('hidden');
  });

  $('loadPastedBtn').addEventListener('click', () => {
    const text = $('pasteText').value.trim();
    if (text) loadSong(text);
  });

  function setImportStatus(msg) {
    const el = $('importStatus');
    if (!msg) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  $('chordproFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const name = file.name.toLowerCase();

    if (name.endsWith('.pdf') || name.endsWith('.docx') || name.endsWith('.doc')) {
      setImportStatus(`Converting ${file.name}…`);
      try {
        const converted = await importLeadSheetFile(file);
        $('pasteText').value = converted;
        $('pasteArea').classList.remove('hidden');
        $('pasteAreaHint').textContent =
          `Converted from ${file.name} — chord placement is a best-effort guess, so check it over (and fill in Key/Tempo above) before Load.`;
        setImportStatus('');
        $('pasteText').focus();
      } catch (err) {
        setImportStatus('');
        showError(`Couldn't convert ${file.name}: ${err.message || err}`, 9000);
      }
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => loadSong(String(reader.result));
    reader.readAsText(file);
    e.target.value = '';
  });

  populateDemoSongs();
})();
