// Pitch detection: autocorrelation-based fundamental frequency estimator
// (the standard ACF2+ approach: trim silence at the edges, autocorrelate,
// find the first strong peak after the initial downslope, then refine it
// with parabolic interpolation) plus frequency<->note-name conversion.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;

  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.008) return -1; // too quiet / silence

  // Trim leading/trailing near-zero samples so the autocorrelation window
  // is centered on signal rather than silence.
  const threshold = 0.2;
  let start = 0;
  while (start < SIZE / 2 && Math.abs(buf[start]) < threshold) start++;
  let end = SIZE - 1;
  while (end > SIZE / 2 && Math.abs(buf[end]) < threshold) end--;
  const trimmed = buf.slice(start, end);
  const n = trimmed.length;
  if (n < 8) return -1;

  const c = new Float32Array(n);
  for (let lag = 0; lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += trimmed[i] * trimmed[i + lag];
    c[lag] = sum;
  }

  // Skip the initial downslope from lag 0 so we don't lock onto it.
  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) d++;

  let maxVal = -1;
  let maxPos = -1;
  for (let i = d; i < n; i++) {
    if (c[i] > maxVal) {
      maxVal = c[i];
      maxPos = i;
    }
  }
  if (maxPos <= 0) return -1;

  // Parabolic interpolation around the peak for sub-sample precision.
  const x1 = c[maxPos - 1] ?? c[maxPos];
  const x2 = c[maxPos];
  const x3 = c[maxPos + 1] ?? c[maxPos];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const refinedLag = a ? maxPos - b / (2 * a) : maxPos;

  if (refinedLag <= 0) return -1;
  const freq = sampleRate / refinedLag;
  if (freq < 60 || freq > 1500) return -1; // outside a baritone uke's useful range
  return freq;
}

function noteFromFrequency(freq) {
  const midi = 69 + 12 * Math.log2(freq / 440);
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const pitchClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return {
    midi: rounded,
    noteName: NOTE_NAMES[pitchClass],
    octave,
    cents,
    pitchClass,
  };
}

function frequencyFromMidi(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
