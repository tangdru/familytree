(() => {
  'use strict';

  const STORAGE_KEY = 'familytree.data.v1';
  const SUPABASE_ROW_ID = 'main';
  const MAX_EDIT_DIM = 1600; // cap the source image loaded into the crop editor
  const CROP_OUT_W = 450; // 3x the rendered card photo size, for crispness
  const CROP_OUT_H = 330; // matches the card photo's 150:110 aspect ratio
  const CROP_MIN_ZOOM = 1;
  const CROP_MAX_ZOOM = 3;

  // Matches the placeholder markup baked into #viewPhotoPlaceholder in
  // index.html -- needed again here so a couple card's dynamically-built
  // member photos (see buildCoupleMember) can show the same placeholder.
  const PERSON_PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';

  /** @type {{people: Object<string, Person>}} */
  let data = { people: {} };

  /** @typedef {{id:string,name:string,birthDate:string,deathDate:string,
   *  photo:string,notes:string,parents:string[],spouses:string[]}} Person */

  let supabaseClient = null;
  let usingSupabase = false;

  function isSupabaseConfigured() {
    const cfg = window.SUPABASE_CONFIG;
    return !!(cfg && cfg.url && cfg.anonKey);
  }

  function setSyncStatus(state) {
    const el = els.syncStatus;
    if (!el) return;
    const labels = {
      local: 'Local only',
      connecting: 'Connecting…',
      connected: 'Synced',
      saving: 'Saving…',
      error: 'Sync error',
    };
    el.title = labels[state] || labels.local;
    el.className = 'sync-dot ' + state;
  }

  // ---------- Persistence ----------

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.people) return parsed;
      }
    } catch (e) {
      console.warn('Failed to load saved family tree, starting fresh.', e);
    }
    return { people: {} };
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save family tree (storage may be full).', e);
      alert('Could not save changes — browser storage may be full (large photos take space).');
    }
  }

  async function loadRemote() {
    const { data: row, error } = await supabaseClient
      .from('family_tree')
      .select('data')
      .eq('id', SUPABASE_ROW_ID)
      .maybeSingle();
    if (error) throw error;
    return row ? row.data : null;
  }

  async function saveRemote() {
    const { error } = await supabaseClient
      .from('family_tree')
      .upsert({ id: SUPABASE_ROW_ID, data, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  async function saveData() {
    if (!usingSupabase) {
      saveLocal();
      return;
    }
    setSyncStatus('saving');
    try {
      await saveRemote();
      setSyncStatus('connected');
    } catch (e) {
      console.error('Failed to save to Supabase.', e);
      setSyncStatus('error');
      alert('Could not save your change to the shared tree. Check your connection and try again.');
    }
  }

  function subscribeRealtime() {
    supabaseClient
      .channel('family_tree_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'family_tree', filter: `id=eq.${SUPABASE_ROW_ID}` },
        (payload) => {
          if (!payload.new || !payload.new.data) return;
          data = payload.new.data;
          renderTree();
        }
      )
      .subscribe();
  }

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Mobile Safari can scroll the page to keep a focused input clear of the
  // on-screen keyboard, and doesn't always scroll back once the keyboard
  // dismisses — leaving the sticky header pushed above the visible area.
  // Force it back after any dialog with focusable inputs closes.
  function resetPageScroll() {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  // ---------- DOM refs ----------

  const els = {
    viewport: document.getElementById('treeViewport'),
    canvas: document.getElementById('treeCanvas'),
    content: document.getElementById('treeContent'),
    svg: document.getElementById('linesSvg'),
    emptyState: document.getElementById('emptyState'),
    viewModeSelect: document.getElementById('viewModeSelect'),
    chronoRuler: document.getElementById('chronoRuler'),
    chronoRulerInner: document.getElementById('chronoRulerInner'),
    searchInput: document.getElementById('searchInput'),
    searchWrap: document.getElementById('searchWrap'),
    searchToggleBtn: document.getElementById('searchToggleBtn'),
    syncStatus: document.getElementById('syncStatus'),

    addPersonBtn: document.getElementById('addPersonBtn'),
    exportBtn: document.getElementById('exportBtn'),

    modal: document.getElementById('personModal'),
    modalTitle: document.getElementById('modalTitle'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    form: document.getElementById('personForm'),
    personId: document.getElementById('personId'),
    nameInput: document.getElementById('nameInput'),
    birthInput: document.getElementById('birthInput'),
    deathInput: document.getElementById('deathInput'),
    birthDisplayText: document.querySelector('#birthDisplay .date-display-text'),
    deathDisplayText: document.querySelector('#deathDisplay .date-display-text'),
    locationInput: document.getElementById('locationInput'),
    locationSuggestions: document.getElementById('locationSuggestions'),
    notesInput: document.getElementById('notesInput'),
    photoInput: document.getElementById('photoInput'),
    photoPreview: document.getElementById('photoPreview'),
    photoImg: document.getElementById('photoImg'),
    photoPlaceholder: document.getElementById('photoPlaceholder'),
    updatePhotoLabel: document.getElementById('updatePhotoLabel'),
    removePhotoBtn: document.getElementById('removePhotoBtn'),
    deletePersonBtn: document.getElementById('deletePersonBtn'),

    cropModal: document.getElementById('cropModal'),
    cropViewport: document.getElementById('cropViewport'),
    cropImage: document.getElementById('cropImage'),
    cropZoom: document.getElementById('cropZoom'),
    cropCloseBtn: document.getElementById('cropCloseBtn'),
    cropCancelBtn: document.getElementById('cropCancelBtn'),
    cropApplyBtn: document.getElementById('cropApplyBtn'),

    viewModal: document.getElementById('personViewModal'),
    viewCloseModalBtn: document.getElementById('viewCloseModalBtn'),
    viewCloseBtn: document.getElementById('viewCloseBtn'),
    viewEditBtn: document.getElementById('viewEditBtn'),
    viewSwipeZone: document.getElementById('viewSwipeZone'),
    viewPersonSingle: document.getElementById('viewPersonSingle'),
    viewPhoto: document.getElementById('viewPhoto'),
    viewPhotoImg: document.getElementById('viewPhotoImg'),
    viewPhotoPlaceholder: document.getElementById('viewPhotoPlaceholder'),
    viewCouple: document.getElementById('viewCouple'),
    viewSpouseAvatars: document.getElementById('viewSpouseAvatars'),
    viewName: document.getElementById('viewName'),
    viewDates: document.getElementById('viewDates'),
    viewLocation: document.getElementById('viewLocation'),
    viewNotes: document.getElementById('viewNotes'),
    viewParentsSection: document.getElementById('viewParentsSection'),
    viewParentsList: document.getElementById('viewParentsList'),
    viewSiblingsSection: document.getElementById('viewSiblingsSection'),
    viewSiblingsList: document.getElementById('viewSiblingsList'),
    viewSpousesSection: document.getElementById('viewSpousesSection'),
    viewSpousesList: document.getElementById('viewSpousesList'),
    viewChildrenSection: document.getElementById('viewChildrenSection'),
    viewChildrenList: document.getElementById('viewChildrenList'),
  };

  let pendingPhoto = null; // dataURL currently staged in the form

  // ---------- Editable-text fields (Full name / Location) ----------
  // Plain contenteditable divs rather than <input> -- see .editable-text in
  // style.css for why. They don't participate in form.reset() or native
  // .value, so read/write goes through these helpers everywhere instead.

  function getEditableText(el) {
    return el.textContent.trim();
  }

  function updateEditablePlaceholder(el) {
    el.classList.toggle('is-empty', el.textContent.trim() === '');
  }

  function setEditableText(el, value) {
    el.textContent = value || '';
    updateEditablePlaceholder(el);
  }

  function setupEditableText(el) {
    updateEditablePlaceholder(el);
    el.addEventListener('input', () => updateEditablePlaceholder(el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  }

  setupEditableText(els.nameInput);
  setupEditableText(els.locationInput);

  // ---------- Searchable combo (parent / spouse pickers) ----------

  // Tapping the trigger opens a scrollable list immediately, with no
  // on-screen keyboard — the trigger is a <button>, not a text input. The
  // keyboard only appears if someone deliberately taps the filter field
  // inside the open dropdown to search a long list.
  function createCombo(rootEl, { multiple, placeholder, createLabel, onCreateNew }) {
    const trigger = rootEl.querySelector('.combo-trigger');
    const triggerText = trigger.querySelector('.combo-trigger-text');
    const dropdown = rootEl.querySelector('.combo-dropdown');
    const filterInput = dropdown.querySelector('.combo-filter');
    const optionsEl = dropdown.querySelector('.combo-options');
    const clearBtn = rootEl.querySelector('.combo-clear');
    const chipsEl = rootEl.querySelector('.combo-chips');

    let options = []; // [{id, name}]
    let selectedId = ''; // single mode
    let selectedIds = []; // multi mode

    const labelFor = (id) => (options.find(o => o.id === id) || {}).name || '';

    function setTriggerText(text, isPlaceholder) {
      triggerText.textContent = text;
      trigger.classList.toggle('placeholder', !!isPlaceholder);
    }

    function renderOptions(query) {
      const q = query.trim().toLowerCase();
      const available = options.filter(o => !multiple || !selectedIds.includes(o.id));
      const matches = q ? available.filter(o => o.name.toLowerCase().includes(q)) : available;
      optionsEl.innerHTML = '';
      // Pinned above the search results (and unaffected by the filter) so
      // "this person doesn't exist yet" is always one click away -- see
      // startAddSpouseFlow for what happens on click.
      if (onCreateNew) {
        const createItem = document.createElement('div');
        createItem.className = 'combo-option combo-option-create';
        createItem.textContent = createLabel || '+ Add new';
        createItem.addEventListener('click', (e) => {
          e.stopPropagation();
          closeDropdown();
          onCreateNew();
        });
        optionsEl.appendChild(createItem);
      }
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'combo-option-empty';
        empty.textContent = 'No matches';
        optionsEl.appendChild(empty);
      } else {
        for (const opt of matches.slice(0, 50)) {
          const item = document.createElement('div');
          item.className = 'combo-option';
          item.textContent = opt.name;
          item.addEventListener('click', (e) => {
            // Selecting an option (esp. in multi mode) rebuilds the options
            // list before this click finishes bubbling, detaching e.target
            // from the DOM — the document-level "click outside" listener
            // would then see a detached node and wrongly treat this as an
            // outside click. Stop it here; this click is unambiguously
            // inside the combo.
            e.stopPropagation();
            choose(opt);
          });
          optionsEl.appendChild(item);
        }
      }
    }

    function openDropdown() {
      filterInput.value = '';
      renderOptions('');
      dropdown.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    }

    function closeDropdown() {
      dropdown.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }

    function updateClearBtn() {
      if (clearBtn) clearBtn.hidden = !selectedId;
    }

    function renderChips() {
      chipsEl.innerHTML = '';
      for (const id of selectedIds) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = labelFor(id) || '(unknown)';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
          selectedIds = selectedIds.filter(x => x !== id);
          renderChips();
          if (!dropdown.hidden) renderOptions(filterInput.value);
        });
        chip.appendChild(removeBtn);
        chipsEl.appendChild(chip);
      }
    }

    function choose(opt) {
      if (multiple) {
        if (!selectedIds.includes(opt.id)) selectedIds.push(opt.id);
        renderChips();
        filterInput.value = '';
        renderOptions('');
      } else {
        selectedId = opt.id;
        setTriggerText(opt.name, false);
        updateClearBtn();
        closeDropdown();
      }
    }

    trigger.addEventListener('click', () => {
      if (dropdown.hidden) openDropdown();
      else closeDropdown();
    });
    filterInput.addEventListener('input', () => renderOptions(filterInput.value));
    filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDropdown();
    });
    document.addEventListener('click', (e) => {
      if (!dropdown.hidden && !rootEl.contains(e.target)) closeDropdown();
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        selectedId = '';
        setTriggerText(placeholder, true);
        updateClearBtn();
      });
    }

    return {
      setOptions(list) { options = list; },
      getValue() { return selectedId; },
      getValues() { return selectedIds.slice(); },
      setValue(id) {
        selectedId = id || '';
        setTriggerText(id ? labelFor(id) : placeholder, !id);
        updateClearBtn();
      },
      setValues(ids) {
        selectedIds = (ids || []).slice();
        renderChips();
      },
      clear() {
        selectedId = '';
        selectedIds = [];
        setTriggerText(placeholder, true);
        updateClearBtn();
        if (chipsEl) chipsEl.innerHTML = '';
        closeDropdown();
      },
    };
  }

  const parent1Combo = createCombo(document.getElementById('parent1Combo'), { multiple: false, placeholder: 'Select…' });
  const parent2Combo = createCombo(document.getElementById('parent2Combo'), { multiple: false, placeholder: 'Select…' });
  const spousesCombo = createCombo(document.getElementById('spousesCombo'), {
    multiple: true,
    placeholder: 'Add spouse/partner…',
    createLabel: '+ Add new spouse',
    onCreateNew: startAddSpouseFlow,
  });

  // ---------- Location autocomplete ----------
  // Free-text field backed by OpenStreetMap's Nominatim search API (no key
  // or signup needed — a good fit given a family tree app is used rarely
  // enough that a paid/keyed geocoding API would be overkill). Debounced,
  // and guarded against out-of-order responses with a request token, since
  // a slow earlier request could otherwise resolve after a newer one.

  function setupLocationAutocomplete() {
    const input = els.locationInput;
    const list = els.locationSuggestions;
    const optionsEl = list.querySelector('.combo-options');
    let debounceTimer = null;
    let requestToken = 0;

    function hideSuggestions() {
      list.hidden = true;
      optionsEl.innerHTML = '';
    }

    function showMessage(text) {
      optionsEl.innerHTML = '';
      const msg = document.createElement('div');
      msg.className = 'combo-option-empty';
      msg.textContent = text;
      optionsEl.appendChild(msg);
      list.hidden = false;
    }

    function renderSuggestions(names) {
      if (!names.length) { showMessage('No matches'); return; }
      optionsEl.innerHTML = '';
      for (const name of names) {
        const item = document.createElement('div');
        item.className = 'combo-option';
        item.textContent = name;
        item.addEventListener('click', () => {
          setEditableText(input, name);
          hideSuggestions();
        });
        optionsEl.appendChild(item);
      }
      list.hidden = false;
    }

    async function fetchSuggestions(query) {
      const token = ++requestToken;
      showMessage('Searching…');
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=6&q=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Nominatim request failed (${res.status})`);
        const results = await res.json();
        if (token !== requestToken) return; // superseded by a newer query
        renderSuggestions(results.map(r => r.display_name));
      } catch (e) {
        console.warn('Location lookup failed', e);
        if (token === requestToken) showMessage("Couldn't load suggestions — you can still type a location");
      }
    }

    input.addEventListener('input', () => {
      const q = getEditableText(input);
      clearTimeout(debounceTimer);
      if (q.length < 3) { hideSuggestions(); return; }
      debounceTimer = setTimeout(() => fetchSuggestions(q), 400);
    });
    input.addEventListener('blur', () => setTimeout(hideSuggestions, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideSuggestions();
    });
    document.addEventListener('click', (e) => {
      if (!list.hidden && !e.target.closest('.location-field')) hideSuggestions();
    });
  }

  setupLocationAutocomplete();

  // ---------- View state (pan/zoom) ----------

  // How far out pinch/wheel zoom and the initial auto-fit are allowed to
  // go. A big chronological tree (many decades at even a modest px/year)
  // can be far taller than any single screen, so this needs to go well
  // below a "normal" zoomed-out level to let the whole thing fit.
  const MIN_ZOOM = 0.05;
  const view = { x: 40, y: 20, scale: 1 };
  let viewMode = 'traditional'; // 'traditional' | 'chronological'

  function applyTransform() {
    els.canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    // The chrono ruler's labels live outside #treeCanvas (so horizontal pan
    // never moves them off the viewport's left edge) but still need to
    // track vertical pan/zoom exactly like the rows they label -- so they
    // get only the Y+scale portion of the same transform.
    if (viewMode === 'chronological') {
      els.chronoRulerInner.style.transform = `translateY(${view.y}px) scale(${view.scale})`;
    }
  }
  applyTransform();

  els.viewModeSelect.addEventListener('change', () => {
    viewMode = els.viewModeSelect.value;
    els.chronoRuler.hidden = viewMode !== 'chronological';
    renderTree();
    fitToView();
  });

  // Zoom/pan so the whole tree is visible, centered in the viewport. Called
  // once after the initial render (never on later re-renders, so it doesn't
  // yank the view out from under someone who's already panned/zoomed).
  function fitToView() {
    const vw = els.viewport.clientWidth;
    const vh = els.viewport.clientHeight;
    const cw = els.content.offsetWidth;
    const ch = els.content.offsetHeight;
    if (!vw || !vh || !cw || !ch) return;
    const padding = 24;
    const scale = Math.min((vw - padding * 2) / cw, (vh - padding * 2) / ch, 1);
    view.scale = Math.max(MIN_ZOOM, scale);
    view.x = (vw - cw * view.scale) / 2;
    view.y = (vh - ch * view.scale) / 2;
    applyTransform();
  }

  // Center a card in the viewport by adjusting our own pan transform.
  // Deliberately not the native el.scrollIntoView(): the tree isn't laid
  // out via normal document scroll, so scrollIntoView walks up the DOM
  // looking for a real scrollable ancestor and finds one anyway — overflow:
  // hidden blocks user scrolling but not programmatic scrolling — and ends
  // up scrolling the whole page (hiding the sticky header) instead of
  // panning the tree.
  function panToCard(id) {
    const card = els.content.querySelector(`[data-id="${id}"]`);
    if (!card) return;
    const vw = els.viewport.clientWidth;
    const vh = els.viewport.clientHeight;
    const cardCenterX = card.offsetLeft + card.offsetWidth / 2;
    const cardCenterY = card.offsetTop + card.offsetHeight / 2;
    view.x = vw / 2 - cardCenterX * view.scale;
    view.y = vh / 2 - cardCenterY * view.scale;
    applyTransform();
  }

  function setZoom(newScale, anchorClientX, anchorClientY) {
    newScale = Math.min(2, Math.max(MIN_ZOOM, newScale));
    const rect = els.viewport.getBoundingClientRect();
    const ax = anchorClientX !== undefined ? anchorClientX - rect.left : rect.width / 2;
    const ay = anchorClientY !== undefined ? anchorClientY - rect.top : rect.height / 2;
    const worldX = (ax - view.x) / view.scale;
    const worldY = (ay - view.y) / view.scale;
    view.scale = newScale;
    view.x = ax - worldX * view.scale;
    view.y = ay - worldY * view.scale;
    applyTransform();
  }

  els.viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setZoom(view.scale + delta, e.clientX, e.clientY);
  }, { passive: false });

  let isPanning = false, panStart = null;
  els.viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.person-card')) return;
    isPanning = true;
    panStart = { x: e.clientX - view.x, y: e.clientY - view.y };
    els.viewport.classList.add('grabbing');
  });
  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    view.x = e.clientX - panStart.x;
    view.y = e.clientY - panStart.y;
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    isPanning = false;
    els.viewport.classList.remove('grabbing');
  });

  // ---------- Touch (swipe to pan, pinch to zoom) ----------

  function touchDistance(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }
  function touchMidpoint(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }

  let touchMode = null; // 'pan' | 'pinch'
  let touchPanStart = null;
  let pinchStartDist = 0;
  let pinchStartScale = 1;

  els.viewport.addEventListener('touchstart', (e) => {
    if (e.target.closest('.person-card')) { touchMode = null; return; }
    if (e.touches.length === 1) {
      touchMode = 'pan';
      touchPanStart = { x: e.touches[0].clientX - view.x, y: e.touches[0].clientY - view.y };
    } else if (e.touches.length === 2) {
      touchMode = 'pinch';
      pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
      pinchStartScale = view.scale;
    }
  }, { passive: true });

  els.viewport.addEventListener('touchmove', (e) => {
    if (!touchMode) return;
    e.preventDefault();
    if (touchMode === 'pan' && e.touches.length === 1) {
      view.x = e.touches[0].clientX - touchPanStart.x;
      view.y = e.touches[0].clientY - touchPanStart.y;
      applyTransform();
    } else if (touchMode === 'pinch' && e.touches.length === 2) {
      const dist = touchDistance(e.touches[0], e.touches[1]);
      const mid = touchMidpoint(e.touches[0], e.touches[1]);
      setZoom(pinchStartScale * (dist / pinchStartDist), mid.x, mid.y);
    }
  }, { passive: false });

  els.viewport.addEventListener('touchend', (e) => {
    if (e.touches.length === 1) {
      touchMode = 'pan';
      touchPanStart = { x: e.touches[0].clientX - view.x, y: e.touches[0].clientY - view.y };
    } else {
      touchMode = null;
    }
  });
  els.viewport.addEventListener('touchcancel', () => { touchMode = null; });

  // ---------- Photo handling ----------

  function loadImageForCrop(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const scale = Math.min(1, MAX_EDIT_DIM / Math.max(img.naturalWidth, img.naturalHeight));
          if (scale === 1) {
            resolve({ src: reader.result, width: img.naturalWidth, height: img.naturalHeight });
            return;
          }
          const width = Math.round(img.naturalWidth * scale);
          const height = Math.round(img.naturalHeight * scale);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve({ src: canvas.toDataURL('image/jpeg', 0.9), width, height });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  els.photoInput.addEventListener('change', async () => {
    const file = els.photoInput.files[0];
    if (!file) return;
    try {
      const { src, width, height } = await loadImageForCrop(file);
      openCropper(src, width, height);
    } catch (e) {
      console.error(e);
      alert('Could not read that image.');
      els.photoInput.value = '';
    }
  });

  els.removePhotoBtn.addEventListener('click', () => {
    pendingPhoto = null;
    els.photoInput.value = '';
    showPhotoPreview(null);
  });

  function showPhotoPreview(dataUrl) {
    if (dataUrl) {
      els.photoImg.src = dataUrl;
      els.photoImg.hidden = false;
      els.photoPlaceholder.hidden = true;
      els.updatePhotoLabel.hidden = false;
      els.removePhotoBtn.hidden = false;
    } else {
      els.photoImg.hidden = true;
      els.photoImg.src = '';
      els.photoPlaceholder.hidden = false;
      els.updatePhotoLabel.hidden = true;
      els.removePhotoBtn.hidden = true;
    }
  }

  // ---------- Photo crop overlay ----------

  let cropNatural = { w: 0, h: 0 };
  let cropViewportSize = { w: 0, h: 0 };
  let cropScaleBase = 1;
  let cropZoomLevel = 1;
  let cropOffset = { x: 0, y: 0 };

  function currentCropScale() {
    return cropScaleBase * cropZoomLevel;
  }

  function clampCropOffset() {
    const scale = currentCropScale();
    const imgW = cropNatural.w * scale;
    const imgH = cropNatural.h * scale;
    cropOffset.x = Math.min(0, Math.max(cropViewportSize.w - imgW, cropOffset.x));
    cropOffset.y = Math.min(0, Math.max(cropViewportSize.h - imgH, cropOffset.y));
  }

  function applyCropTransform() {
    const scale = currentCropScale();
    els.cropImage.style.width = `${cropNatural.w * scale}px`;
    els.cropImage.style.height = `${cropNatural.h * scale}px`;
    els.cropImage.style.left = `${cropOffset.x}px`;
    els.cropImage.style.top = `${cropOffset.y}px`;
  }

  function setCropZoom(newZoom, anchorX, anchorY) {
    const ax = anchorX !== undefined ? anchorX : cropViewportSize.w / 2;
    const ay = anchorY !== undefined ? anchorY : cropViewportSize.h / 2;
    const oldScale = currentCropScale();
    const imgX = (ax - cropOffset.x) / oldScale;
    const imgY = (ay - cropOffset.y) / oldScale;
    cropZoomLevel = Math.min(CROP_MAX_ZOOM, Math.max(CROP_MIN_ZOOM, newZoom));
    const newScale = currentCropScale();
    cropOffset.x = ax - imgX * newScale;
    cropOffset.y = ay - imgY * newScale;
    clampCropOffset();
    applyCropTransform();
    els.cropZoom.value = String(cropZoomLevel);
  }

  function openCropper(src, naturalWidth, naturalHeight) {
    cropNatural = { w: naturalWidth, h: naturalHeight };
    els.cropImage.src = src;
    els.cropModal.hidden = false;
    requestAnimationFrame(() => {
      const rect = els.cropViewport.getBoundingClientRect();
      cropViewportSize = { w: rect.width, h: rect.height };
      cropScaleBase = Math.max(cropViewportSize.w / naturalWidth, cropViewportSize.h / naturalHeight);
      cropZoomLevel = 1;
      els.cropZoom.value = '1';
      cropOffset.x = (cropViewportSize.w - naturalWidth * cropScaleBase) / 2;
      cropOffset.y = (cropViewportSize.h - naturalHeight * cropScaleBase) / 2;
      applyCropTransform();
    });
  }

  function closeCropper() {
    els.cropModal.hidden = true;
    els.cropImage.src = '';
    cropDragging = false;
    cropTouchMode = null;
    resetPageScroll();
  }

  function cancelCropper() {
    closeCropper();
    els.photoInput.value = '';
  }

  els.cropZoom.addEventListener('input', () => setCropZoom(parseFloat(els.cropZoom.value)));
  els.cropCloseBtn.addEventListener('click', cancelCropper);
  els.cropCancelBtn.addEventListener('click', cancelCropper);
  els.cropModal.addEventListener('click', (e) => { if (e.target === els.cropModal) cancelCropper(); });

  els.cropApplyBtn.addEventListener('click', () => {
    const scale = currentCropScale();
    const sx = -cropOffset.x / scale;
    const sy = -cropOffset.y / scale;
    const sWidth = cropViewportSize.w / scale;
    const sHeight = cropViewportSize.h / scale;
    const canvas = document.createElement('canvas');
    canvas.width = CROP_OUT_W;
    canvas.height = CROP_OUT_H;
    canvas.getContext('2d').drawImage(els.cropImage, sx, sy, sWidth, sHeight, 0, 0, CROP_OUT_W, CROP_OUT_H);
    pendingPhoto = canvas.toDataURL('image/jpeg', 0.85);
    showPhotoPreview(pendingPhoto);
    closeCropper();
  });

  // Mouse drag to reposition
  let cropDragging = false;
  let cropDragStart = null;
  els.cropViewport.addEventListener('mousedown', (e) => {
    cropDragging = true;
    cropDragStart = { x: e.clientX - cropOffset.x, y: e.clientY - cropOffset.y };
    els.cropViewport.classList.add('grabbing');
  });
  window.addEventListener('mousemove', (e) => {
    if (!cropDragging) return;
    cropOffset.x = e.clientX - cropDragStart.x;
    cropOffset.y = e.clientY - cropDragStart.y;
    clampCropOffset();
    applyCropTransform();
  });
  window.addEventListener('mouseup', () => {
    cropDragging = false;
    els.cropViewport.classList.remove('grabbing');
  });

  // Touch: one-finger drag to reposition, two-finger pinch to zoom
  let cropTouchMode = null;
  let cropPanStart = null;
  let cropPinchStartDist = 0;
  let cropPinchStartZoom = 1;

  els.cropViewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      cropTouchMode = 'pan';
      cropPanStart = { x: e.touches[0].clientX - cropOffset.x, y: e.touches[0].clientY - cropOffset.y };
    } else if (e.touches.length === 2) {
      cropTouchMode = 'pinch';
      cropPinchStartDist = touchDistance(e.touches[0], e.touches[1]);
      cropPinchStartZoom = cropZoomLevel;
    }
  }, { passive: true });

  els.cropViewport.addEventListener('touchmove', (e) => {
    if (!cropTouchMode) return;
    e.preventDefault();
    if (cropTouchMode === 'pan' && e.touches.length === 1) {
      cropOffset.x = e.touches[0].clientX - cropPanStart.x;
      cropOffset.y = e.touches[0].clientY - cropPanStart.y;
      clampCropOffset();
      applyCropTransform();
    } else if (cropTouchMode === 'pinch' && e.touches.length === 2) {
      const rect = els.cropViewport.getBoundingClientRect();
      const dist = touchDistance(e.touches[0], e.touches[1]);
      const mid = touchMidpoint(e.touches[0], e.touches[1]);
      setCropZoom(cropPinchStartZoom * (dist / cropPinchStartDist), mid.x - rect.left, mid.y - rect.top);
    }
  }, { passive: false });

  els.cropViewport.addEventListener('touchend', (e) => {
    if (e.touches.length === 1) {
      cropTouchMode = 'pan';
      cropPanStart = { x: e.touches[0].clientX - cropOffset.x, y: e.touches[0].clientY - cropOffset.y };
    } else {
      cropTouchMode = null;
    }
  });
  els.cropViewport.addEventListener('touchcancel', () => { cropTouchMode = null; });

  // ---------- Date field display (custom-rendered, see .date-display in style.css) ----------

  function formatDateDisplay(value) {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
  }

  function updateDateDisplay(inputEl, textEl) {
    const formatted = formatDateDisplay(inputEl.value);
    textEl.textContent = formatted || 'mm/dd/yyyy';
    textEl.closest('.date-display').classList.toggle('placeholder', !formatted);
  }

  els.birthInput.addEventListener('change', () => updateDateDisplay(els.birthInput, els.birthDisplayText));
  els.deathInput.addEventListener('change', () => updateDateDisplay(els.deathInput, els.deathDisplayText));

  // ---------- Modal open/close ----------

  function openModalForAdd() {
    els.form.reset();
    els.personId.value = '';
    setEditableText(els.nameInput, '');
    setEditableText(els.locationInput, '');
    pendingPhoto = null;
    showPhotoPreview(null);
    updateDateDisplay(els.birthInput, els.birthDisplayText);
    updateDateDisplay(els.deathInput, els.deathDisplayText);
    els.modalTitle.textContent = 'Add Person';
    els.deletePersonBtn.hidden = true;
    populateSelectOptions(null);
    parent1Combo.clear();
    parent2Combo.clear();
    spousesCombo.clear();
    els.modal.hidden = false;
  }

  function openModalForEdit(personId) {
    const p = data.people[personId];
    if (!p) return;
    els.form.reset();
    els.personId.value = p.id;
    setEditableText(els.nameInput, p.name || '');
    els.birthInput.value = p.birthDate || '';
    els.deathInput.value = p.deathDate || '';
    updateDateDisplay(els.birthInput, els.birthDisplayText);
    updateDateDisplay(els.deathInput, els.deathDisplayText);
    setEditableText(els.locationInput, p.location || '');
    els.notesInput.value = p.notes || '';
    pendingPhoto = p.photo || null;
    showPhotoPreview(pendingPhoto);
    els.modalTitle.textContent = 'Edit Person';
    els.deletePersonBtn.hidden = false;
    populateSelectOptions(p.id);
    parent1Combo.setValue(p.parents[0] || '');
    parent2Combo.setValue(p.parents[1] || '');
    spousesCombo.setValues(p.spouses);
    els.modal.hidden = false;
  }

  // Set while the Add/Edit form is repurposed for a nested "add a brand new
  // spouse" sub-step (see startAddSpouseFlow) -- holds everything needed to
  // put the form back the way it was, so an in-progress edit isn't lost
  // just because the person being edited doesn't have their partner in the
  // tree yet.
  let pendingSpouseSnapshot = null;

  function snapshotPersonForm() {
    return {
      personId: els.personId.value,
      name: getEditableText(els.nameInput),
      birth: els.birthInput.value,
      death: els.deathInput.value,
      location: getEditableText(els.locationInput),
      notes: els.notesInput.value,
      photo: pendingPhoto,
      parent1: parent1Combo.getValue(),
      parent2: parent2Combo.getValue(),
      spouses: spousesCombo.getValues(),
      title: els.modalTitle.textContent,
      showDelete: !els.deletePersonBtn.hidden,
    };
  }

  function restorePersonForm(snap) {
    els.form.reset();
    els.personId.value = snap.personId;
    setEditableText(els.nameInput, snap.name);
    els.birthInput.value = snap.birth;
    els.deathInput.value = snap.death;
    updateDateDisplay(els.birthInput, els.birthDisplayText);
    updateDateDisplay(els.deathInput, els.deathDisplayText);
    setEditableText(els.locationInput, snap.location);
    els.notesInput.value = snap.notes;
    pendingPhoto = snap.photo;
    showPhotoPreview(pendingPhoto);
    els.modalTitle.textContent = snap.title;
    els.deletePersonBtn.hidden = !snap.showDelete;
    populateSelectOptions(snap.personId || null);
    parent1Combo.setValue(snap.parent1);
    parent2Combo.setValue(snap.parent2);
    spousesCombo.setValues(snap.spouses);
  }

  // Triggered by "+ Add new spouse" in the spouses combo (see createCombo):
  // stash the in-progress form, then repurpose the same modal for a normal
  // Add Person flow. Its own submit (below) restores the stashed form and
  // adds the new person as a spouse, rather than closing the modal.
  function startAddSpouseFlow() {
    pendingSpouseSnapshot = snapshotPersonForm();
    openModalForAdd();
    els.modalTitle.textContent = 'Add Spouse';
  }

  function closeModal() {
    if (pendingSpouseSnapshot) {
      const snap = pendingSpouseSnapshot;
      pendingSpouseSnapshot = null;
      restorePersonForm(snap);
      return;
    }
    if (document.activeElement && els.modal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    els.modal.hidden = true;
    resetPageScroll();
  }

  els.addPersonBtn.addEventListener('click', openModalForAdd);
  els.closeModalBtn.addEventListener('click', closeModal);
  els.cancelBtn.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.cropModal.hidden) cancelCropper();
    else if (!els.modal.hidden) closeModal();
    else if (!els.viewModal.hidden) closeViewModal();
  });

  // ---------- Person view (read-only detail) modal ----------

  // Age in whole years as of death (if deceased) or today (if living).
  function computeAge(person) {
    if (!person.birthDate) return null;
    const birth = new Date(person.birthDate);
    if (Number.isNaN(birth.getTime())) return null;
    const end = person.deathDate ? new Date(person.deathDate) : new Date();
    let age = end.getFullYear() - birth.getFullYear();
    const beforeBirthday = end.getMonth() < birth.getMonth() ||
      (end.getMonth() === birth.getMonth() && end.getDate() < birth.getDate());
    if (beforeBirthday) age--;
    return age >= 0 ? age : null;
  }

  // onNavigate defaults to a full reset (openViewModal); the Parents section
  // passes goToParents instead, so following a parent link extends the
  // vertical thread (and lands on a couple card) rather than discarding it.
  function buildRelationRow(personId, onNavigate) {
    const p = data.people[personId];
    if (!p) return null;
    const li = document.createElement('li');
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'view-relation-link';
    link.textContent = p.name || '(unnamed)';
    link.addEventListener('click', () => (onNavigate || openViewModal)(personId));
    const age = computeAge(p);
    const ageSpan = document.createElement('span');
    ageSpan.className = 'view-relation-age';
    ageSpan.textContent = age == null ? '' : p.deathDate ? `${age} (d. ${formatYear(p.deathDate)})` : `${age}`;
    li.appendChild(link);
    li.appendChild(ageSpan);
    return li;
  }

  function fillRelationSection(sectionEl, listEl, ids, onNavigate) {
    listEl.innerHTML = '';
    const valid = ids.filter(id => data.people[id]);
    if (!valid.length) { sectionEl.hidden = true; return; }
    valid
      .slice()
      .sort((a, b) => compareByBirth(data.people[a], data.people[b]))
      .forEach(id => {
        const row = buildRelationRow(id, onNavigate);
        if (row) listEl.appendChild(row);
      });
    sectionEl.hidden = false;
  }

  // Whoever's "selected" right now -- the person Edit/the sibling swipe/
  // relation links act on. On a couple card that's whichever of the two is
  // ringed.
  let currentViewId = null;

  // The vertical (up/down) navigation thread: the sequence of "positions"
  // visited by swiping up/down, oldest-explored-ancestor first, with
  // verticalIndex pointing at whoever's currently shown. Swiping down then
  // up (or vice versa) retraces this exactly, the way browser back/forward
  // does, instead of recomputing a generic default every time. Each position
  // is { ids, selected }: ids is the card shown there (a lone person, or a
  // couple -- someone's own recorded parents, shown together instead of
  // guessing which one the swipe "meant"), and selected is whichever of ids
  // drives further navigation from that position. See verticalGoUp/Down and
  // selectCoupleMember below.
  let verticalPath = [];
  let verticalIndex = 0;

  // The public entry point: anything that isn't a vertical (up/down) swipe
  // -- a sibling swipe, a spouse avatar, a relation-list link (other than a
  // Parents link, see goToParents), opening a card from the tree -- lands
  // here and starts a brand new vertical thread anchored on whoever it's
  // landing on. See verticalGoUp/Down below for the thread itself.
  function openViewModal(personId) {
    if (!data.people[personId]) return;
    verticalPath = [{ ids: coupleIdsFor(personId), selected: personId }];
    verticalIndex = 0;
    renderThreadPosition();
  }

  function renderThreadPosition() {
    const node = verticalPath[verticalIndex];
    if (!node) return;
    renderPersonView(node.ids, node.selected);
  }

  // A couple's shared location: shown once for both, since they usually live
  // together -- the selected member's location if the two differ or only one
  // is known, otherwise the (matching) value both share.
  function sharedLocation(ids, selectedId) {
    const selLoc = (data.people[selectedId] && data.people[selectedId].location) || '';
    const otherId = ids.find(id => id !== selectedId);
    const otherLoc = (otherId && data.people[otherId] && data.people[otherId].location) || '';
    return selLoc || otherLoc;
  }

  function personDatesText(p) {
    const born = formatDateDisplay(p.birthDate);
    const died = formatDateDisplay(p.deathDate);
    return born && died ? `${born} – ${died}` : born ? `Born ${born}` : died ? `Died ${died}` : '';
  }

  function personDatesAndAgeText(p) {
    const text = personDatesText(p);
    const age = computeAge(p);
    if (age == null) return text;
    return text ? `${text} · Age ${age}` : `Age ${age}`;
  }

  // One half of a couple card: photo, name, dates+age, ringed when selected.
  // Clicking a member switches which side of the couple drives navigation,
  // without touching the vertical thread itself -- see selectCoupleMember.
  function buildCoupleMember(personId, isSelected) {
    const p = data.people[personId];
    const wrap = document.createElement('div');
    wrap.className = 'view-couple-member';
    const photo = document.createElement('div');
    photo.className = 'view-couple-photo' + (isSelected ? ' selected' : '');
    if (p.photo) {
      const img = document.createElement('img');
      img.src = p.photo;
      img.alt = p.name || '';
      photo.appendChild(img);
    } else {
      photo.innerHTML = PERSON_PLACEHOLDER_SVG;
    }
    const name = document.createElement('div');
    name.className = 'view-couple-name';
    name.textContent = p.name || '(unnamed)';
    const dates = document.createElement('div');
    dates.className = 'view-couple-dates';
    dates.textContent = personDatesAndAgeText(p);
    wrap.appendChild(photo);
    wrap.appendChild(name);
    wrap.appendChild(dates);
    wrap.addEventListener('click', () => selectCoupleMember(personId));
    return wrap;
  }

  // Switches which half of the current couple card is "selected" -- i.e.
  // whose parents/siblings show and whose tree further swipes follow. This
  // is a lateral change within the current thread position, not a
  // navigation: it doesn't touch verticalPath/verticalIndex.
  function selectCoupleMember(personId) {
    const node = verticalPath[verticalIndex];
    if (!node || node.selected === personId || !node.ids.includes(personId)) return;
    node.selected = personId;
    renderThreadPosition();
  }

  // Following a link from the Parents section: instead of resetting to a
  // single-person view of just that parent (forcing a guess at which parent
  // "the" swipe-up-to-parent means), extend the vertical thread with BOTH of
  // the current person's recorded parents as a couple card, selecting
  // whichever one was actually clicked. An explicit choice like this
  // overwrites any previously-explored path above it, same as a browser
  // history navigation would.
  function goToParents(clickedParentId) {
    const node = verticalPath[verticalIndex];
    const fromId = node ? node.selected : currentViewId;
    const parentIds = parentIdsOf(fromId);
    if (!parentIds.length) { openViewModal(clickedParentId); return; }
    verticalPath = verticalPath.slice(0, verticalIndex + 1);
    verticalPath.push({ ids: parentIds, selected: clickedParentId });
    verticalIndex++;
    renderThreadPosition();
  }

  function renderPersonView(ids, selectedId) {
    const p = data.people[selectedId];
    if (!p) return;
    currentViewId = selectedId;

    const isCouple = ids.length > 1;
    els.viewPersonSingle.hidden = isCouple;
    els.viewCouple.hidden = !isCouple;

    if (isCouple) {
      els.viewCouple.innerHTML = '';
      ids.forEach(id => els.viewCouple.appendChild(buildCoupleMember(id, id === selectedId)));
    } else {
      if (p.photo) {
        els.viewPhotoImg.src = p.photo;
        els.viewPhotoImg.alt = p.name || '';
        els.viewPhotoImg.hidden = false;
        els.viewPhotoPlaceholder.hidden = true;
      } else {
        els.viewPhotoImg.hidden = true;
        els.viewPhotoImg.removeAttribute('src');
        els.viewPhotoPlaceholder.hidden = false;
      }
      els.viewName.textContent = p.name || '(unnamed)';
      els.viewDates.textContent = personDatesText(p);
      els.viewDates.hidden = !els.viewDates.textContent;
    }

    // Spouses already shown as the other half of a couple card don't need
    // repeating in the small avatar row -- that row is for reaching anyone
    // else the selected person married, e.g. a second marriage.
    els.viewSpouseAvatars.innerHTML = '';
    const spouseIds = (p.spouses || []).filter(sid => data.people[sid] && !ids.includes(sid));
    spouseIds.forEach(sid => els.viewSpouseAvatars.appendChild(buildSpouseAvatar(sid)));
    els.viewSpouseAvatars.hidden = !spouseIds.length;

    els.viewLocation.textContent = isCouple ? sharedLocation(ids, selectedId) : (p.location || '');
    els.viewLocation.hidden = !els.viewLocation.textContent;

    els.viewNotes.textContent = p.notes || '';
    els.viewNotes.hidden = !p.notes;

    fillRelationSection(els.viewParentsSection, els.viewParentsList, p.parents || [], goToParents);

    const siblingIds = Object.keys(data.people).filter(id => {
      if (id === selectedId) return false;
      return data.people[id].parents.some(pid => p.parents.includes(pid));
    });
    fillRelationSection(els.viewSiblingsSection, els.viewSiblingsList, siblingIds);

    // A couple card already shows both partners directly -- a Spouses list
    // repeating "the other one" underneath adds nothing.
    if (isCouple) {
      els.viewSpousesSection.hidden = true;
    } else {
      fillRelationSection(els.viewSpousesSection, els.viewSpousesList, p.spouses || []);
    }

    const childIds = Object.keys(data.people).filter(id => ids.some(pid => data.people[id].parents.includes(pid)));
    fillRelationSection(els.viewChildrenSection, els.viewChildrenList, childIds);

    els.viewModal.hidden = false;
  }

  function closeViewModal() {
    if (document.activeElement && els.viewModal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    els.viewModal.hidden = true;
    resetPageScroll();
  }

  els.viewCloseModalBtn.addEventListener('click', closeViewModal);
  els.viewCloseBtn.addEventListener('click', closeViewModal);
  els.viewModal.addEventListener('click', (e) => { if (e.target === els.viewModal) closeViewModal(); });
  els.viewEditBtn.addEventListener('click', () => {
    const id = currentViewId;
    closeViewModal();
    if (id) openModalForEdit(id);
  });

  function buildSpouseAvatar(spouseId) {
    const sp = data.people[spouseId];
    const el = document.createElement('div');
    el.className = 'view-spouse-avatar';
    el.title = sp.name || '(unnamed)';
    if (sp.photo) {
      const img = document.createElement('img');
      img.src = sp.photo;
      img.alt = sp.name || '';
      el.appendChild(img);
    } else {
      el.textContent = '🧑';
    }
    el.addEventListener('click', () => openViewModal(spouseId));
    return el;
  }

  // ---------- Person view: swipe navigation ----------
  //
  // Down/up move along one continuous vertical thread and remember it: the
  // first down goes to Parent 1, the first up goes to the first child by
  // birth order, but once you've stepped somewhere, retracing your steps
  // (down then up, or up then down) returns to exactly the person you came
  // from -- not just whatever's structurally "first" -- the way browser
  // back/forward works. Only stepping past the end you've already explored
  // computes a fresh default. Left/right step through the full sibling set
  // (anyone sharing a recorded parent) -- right toward older, left toward
  // younger -- anchored at this person's own position in it, and leaving
  // via a sibling starts an entirely new vertical thread on them, per
  // openViewModal(). A spouse married in from outside the lineage isn't on
  // this axis at all -- whoever's "selected" shows on the couple card
  // alongside them instead (see coupleIdsFor), and any additional spouse
  // beyond that first one is reached via the avatar row under the photo,
  // per the click handler in buildSpouseAvatar().

  // A person's current partner to pair them with on a couple card -- just
  // the first recorded spouse for now; see BACKLOG.md for more than one.
  function partnerIdOf(personId) {
    const p = data.people[personId];
    return ((p && p.spouses) || []).find(id => data.people[id]) || null;
  }

  // The ids to render for a single anchor person: paired with their partner
  // when they have one, so anyone with a recorded spouse always gets the
  // couple card, not just when viewed as "the parents" of someone else.
  // personId is always first, and the default selected.
  function coupleIdsFor(personId) {
    const partnerId = partnerIdOf(personId);
    return partnerId ? [personId, partnerId] : [personId];
  }

  // A person's recorded parents, filtered to ones that still exist. Two
  // recorded parents are shown together as-is; a single recorded parent is
  // still paired with THEIR partner if they have one (e.g. a step-parent),
  // per coupleIdsFor. Rendered by renderPersonView -- see
  // verticalGoDown/goToParents.
  function parentIdsOf(personId) {
    const p = data.people[personId];
    const recorded = ((p && p.parents) || []).filter(id => data.people[id]);
    return recorded.length === 1 ? coupleIdsFor(recorded[0]) : recorded;
  }

  function firstChildId(personId) {
    const kids = Object.keys(data.people)
      .filter(id => data.people[id].parents.includes(personId))
      .sort((a, b) => compareByBirth(data.people[a], data.people[b]));
    return kids.length ? kids[0] : null;
  }

  // The person's full sibling set (anyone sharing a recorded parent),
  // including themself, oldest to youngest -- so their own index in it
  // gives a stable anchor for stepping to the next/previous one.
  function siblingSet(personId) {
    const p = data.people[personId];
    if (!p || !p.parents.length) return [personId];
    const ids = Object.keys(data.people).filter(id =>
      id === personId || data.people[id].parents.some(pid => p.parents.includes(pid))
    );
    return ids.sort((a, b) => compareByBirth(data.people[a], data.people[b]));
  }

  function siblingNeighborId(personId, step) {
    const set = siblingSet(personId);
    const idx = set.indexOf(personId) + step;
    return idx >= 0 && idx < set.length ? set[idx] : null;
  }

  // Step toward a child: replay the remembered position if we've been this
  // way before, otherwise fall back to the default (first child by birth
  // order, shown alone) and extend the thread with it.
  function verticalGoUp() {
    if (!verticalPath.length) return;
    if (verticalIndex + 1 < verticalPath.length) {
      verticalIndex++;
      renderThreadPosition();
      return;
    }
    const childId = firstChildId(verticalPath[verticalIndex].selected);
    if (!childId) return;
    verticalPath.push({ ids: coupleIdsFor(childId), selected: childId });
    verticalIndex++;
    renderThreadPosition();
  }

  // Step toward a parent: replay the remembered position (i.e. undo the
  // last "up") if there is one, otherwise fall back to the default -- both
  // recorded parents as a couple card, Parent 1 selected -- and extend the
  // thread with it.
  function verticalGoDown() {
    if (!verticalPath.length) return;
    if (verticalIndex > 0) {
      verticalIndex--;
      renderThreadPosition();
      return;
    }
    const parentIds = parentIdsOf(verticalPath[0].selected);
    if (!parentIds.length) return;
    verticalPath.unshift({ ids: parentIds, selected: parentIds[0] });
    renderThreadPosition();
  }

  const SWIPE_THRESHOLD = 48;  // px; smaller drags are taps, not swipes
  const SWIPE_DEADZONE = 10;   // px moved before this counts as dragging at all
  let swipeStart = null;
  let swipeCaptured = false;
  let suppressNextClick = false;

  els.viewSwipeZone.addEventListener('pointerdown', (e) => {
    // A stale true here (a previous swipe whose compensating click never
    // fired -- not every browser sends one after a large drag) would wrongly
    // swallow this new, unrelated tap. Starting a fresh gesture is the one
    // moment we know for certain any earlier suppression is no longer valid.
    suppressNextClick = false;
    swipeStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swipeCaptured = false;
  });
  els.viewSwipeZone.addEventListener('pointermove', (e) => {
    if (!swipeStart || e.pointerId !== swipeStart.id || swipeCaptured) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_DEADZONE) return;
    // Only capture once we know this is an actual drag, not a tap: while
    // captured, the browser retargets the *compatibility click event* to
    // this zone too (per the Pointer Events spec), which would stop a
    // plain tap on the spouse avatar from ever reaching its own click
    // listener. A real swipe still needs capture, though -- it moves the
    // pointer beyond this fairly short zone, and without capture pointerup
    // would fire on whatever element the cursor ends up over instead.
    swipeCaptured = true;
    els.viewSwipeZone.setPointerCapture(e.pointerId);
  });
  els.viewSwipeZone.addEventListener('pointerup', (e) => {
    if (swipeCaptured && els.viewSwipeZone.hasPointerCapture(e.pointerId)) {
      els.viewSwipeZone.releasePointerCapture(e.pointerId);
    }
    if (!swipeStart || e.pointerId !== swipeStart.id) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;

    suppressNextClick = true;
    if (Math.abs(dx) > Math.abs(dy)) {
      const siblingId = siblingNeighborId(currentViewId, dx > 0 ? -1 : 1);
      if (siblingId) openViewModal(siblingId); // a fresh vertical thread, per spec
      else suppressNextClick = false; // no-op: nothing actually navigated, so don't eat the next tap
    } else if (dy < 0) {
      const before = currentViewId;
      verticalGoUp();
      if (currentViewId === before) suppressNextClick = false;
    } else {
      const before = currentViewId;
      verticalGoDown();
      if (currentViewId === before) suppressNextClick = false;
    }
  });
  els.viewSwipeZone.addEventListener('pointercancel', () => { swipeStart = null; swipeCaptured = false; });
  // A real swipe's pointerup can land on the spouse-avatar row underneath
  // the pointer's final position -- swallow that one click so it doesn't
  // also fire the avatar's own navigation on top of the swipe's.
  els.viewSwipeZone.addEventListener('click', (e) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  function populateSelectOptions(excludeId) {
    const people = Object.values(data.people)
      .filter(p => p.id !== excludeId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => ({ id: p.id, name: p.name || '(unnamed)' }));

    parent1Combo.setOptions(people);
    parent2Combo.setOptions(people);
    spousesCombo.setOptions(people);
  }

  // ---------- Form submit / delete ----------

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = getEditableText(els.nameInput);
    if (!name) { els.nameInput.focus(); return; }
    // Blur now (rather than waiting for closeModal) so the on-screen
    // keyboard has the whole saveData() round-trip to finish dismissing.
    if (document.activeElement) document.activeElement.blur();

    const id = els.personId.value || uid();
    const isNew = !els.personId.value;

    const parents = [parent1Combo.getValue(), parent2Combo.getValue()].filter(Boolean);
    if (parents.length === 2 && parents[0] === parents[1]) parents.pop();
    if (parents.includes(id)) { alert('A person cannot be their own parent.'); return; }

    const spouses = spousesCombo.getValues().filter(v => v && v !== id);

    // Prevent a parent cycle (ancestor being set as descendant)
    if (parents.some(pid => isDescendant(id, pid))) {
      alert('That would create a cycle (a descendant cannot be their own ancestor).');
      return;
    }

    const person = data.people[id] || { id, parents: [], spouses: [] };
    person.name = name;
    person.birthDate = els.birthInput.value || '';
    person.deathDate = els.deathInput.value || '';
    person.location = getEditableText(els.locationInput);
    person.notes = els.notesInput.value.trim();
    person.photo = pendingPhoto || '';
    person.parents = parents;

    data.people[id] = person;

    // Sync spouse relationships symmetrically
    const prevSpouses = new Set(person.spouses || []);
    const nextSpouses = new Set(spouses);
    for (const otherId of prevSpouses) {
      if (!nextSpouses.has(otherId) && data.people[otherId]) {
        data.people[otherId].spouses = data.people[otherId].spouses.filter(s => s !== id);
      }
    }
    for (const otherId of nextSpouses) {
      const other = data.people[otherId];
      if (other && !other.spouses.includes(id)) other.spouses.push(id);
    }
    person.spouses = Array.from(nextSpouses);

    await saveData();

    // Finishing the nested "+ Add new spouse" step: the new person is
    // already saved as their own record above, so just add them to the
    // stashed form's spouse chips and pick up the original edit where it
    // left off, instead of closing the whole modal.
    if (pendingSpouseSnapshot) {
      const snap = pendingSpouseSnapshot;
      pendingSpouseSnapshot = null;
      if (!snap.spouses.includes(id)) snap.spouses.push(id);
      renderTree();
      restorePersonForm(snap);
      return;
    }

    closeModal();
    renderTree();
    if (isNew) highlightPerson(id);
  });

  function isDescendant(ancestorCandidateId, personId) {
    // true if personId is a descendant of ancestorCandidateId (walking down via children)
    const stack = [ancestorCandidateId];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === personId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const p of Object.values(data.people)) {
        if (p.parents.includes(cur)) stack.push(p.id);
      }
    }
    return false;
  }

  els.deletePersonBtn.addEventListener('click', async () => {
    const id = els.personId.value;
    if (!id) return;
    const person = data.people[id];
    if (!confirm(`Delete ${person.name || 'this person'}? This cannot be undone.`)) return;

    for (const p of Object.values(data.people)) {
      p.parents = p.parents.filter(pid => pid !== id);
      p.spouses = p.spouses.filter(sid => sid !== id);
    }
    delete data.people[id];
    await saveData();
    closeModal();
    renderTree();
  });

  // ---------- Search ----------

  let highlightedId = null;
  function highlightPerson(id) {
    highlightedId = id;
    document.querySelectorAll('.person-card.highlight').forEach(el => el.classList.remove('highlight'));
    const card = els.content.querySelector(`[data-id="${id}"]`);
    if (card) {
      card.classList.add('highlight');
      panToCard(id);
    }
  }

  els.searchInput.addEventListener('input', () => {
    const q = els.searchInput.value.trim().toLowerCase();
    document.querySelectorAll('.person-card').forEach(el => el.classList.remove('highlight'));
    if (!q) return;
    const match = Object.values(data.people).find(p => (p.name || '').toLowerCase().includes(q));
    if (match) highlightPerson(match.id);
  });

  function openSearch() {
    els.searchWrap.classList.add('open');
    els.searchToggleBtn.setAttribute('aria-expanded', 'true');
    els.searchInput.focus();
  }

  function closeSearch() {
    els.searchWrap.classList.remove('open');
    els.searchToggleBtn.setAttribute('aria-expanded', 'false');
    els.searchInput.value = '';
    document.querySelectorAll('.person-card.highlight').forEach(el => el.classList.remove('highlight'));
  }

  els.searchToggleBtn.addEventListener('click', () => {
    if (els.searchWrap.classList.contains('open')) closeSearch();
    else openSearch();
  });
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
  });
  els.searchInput.addEventListener('blur', () => {
    if (!els.searchInput.value) closeSearch();
  });

  // ---------- Export ----------

  els.exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `family-tree-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // ---------- Layout ----------

  function computeLevels() {
    const people = data.people;
    const levelCache = {};
    const anchored = {}; // has explicit parents recorded (possibly transitively)
    const visiting = new Set();

    function baseLevel(id) {
      if (levelCache[id] !== undefined) return levelCache[id];
      if (visiting.has(id)) return 0; // cycle guard
      visiting.add(id);
      const p = people[id];
      let lvl = 0;
      let hasParent = false;
      for (const parentId of p.parents) {
        if (people[parentId]) {
          hasParent = true;
          lvl = Math.max(lvl, baseLevel(parentId) + 1);
        }
      }
      visiting.delete(id);
      anchored[id] = hasParent;
      levelCache[id] = lvl;
      return lvl;
    }

    for (const id of Object.keys(people)) baseLevel(id);

    // Relax: unanchored spouses inherit an anchored (or higher) spouse's level.
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const p of Object.values(people)) {
        if (anchored[p.id]) continue;
        for (const sid of p.spouses) {
          if (people[sid] && levelCache[sid] > levelCache[p.id]) {
            levelCache[p.id] = levelCache[sid];
            changed = true;
          }
        }
      }
      if (!changed) break;
    }

    return levelCache;
  }

  function familyKey(parentIds) {
    return parentIds.slice().sort().join('+') || '_none_';
  }

  // Siblings order oldest to youngest by birth date; undated people sort
  // after dated ones, falling back to name so the order stays stable.
  function compareByBirth(a, b) {
    if (a.birthDate && b.birthDate) return a.birthDate.localeCompare(b.birthDate);
    if (a.birthDate) return -1;
    if (b.birthDate) return 1;
    return a.name.localeCompare(b.name);
  }

  function computeOrder(levels) {
    const people = data.people;
    const maxLevel = Object.values(levels).reduce((m, v) => Math.max(m, v), 0);
    const rows = Array.from({ length: maxLevel + 1 }, () => []);
    const placed = new Set();

    function placeWithSpouses(id, row) {
      if (placed.has(id) || !people[id]) return;
      placed.add(id);
      row.push(id);
      for (const sid of people[id].spouses) {
        if (people[sid] && !placed.has(sid) && levels[sid] === levels[id]) {
          placed.add(sid);
          row.push(sid);
        }
      }
    }

    // Row 0: stable order by name for determinism
    const row0Candidates = Object.values(people).filter(p => levels[p.id] === 0).sort((a, b) => a.name.localeCompare(b.name));
    for (const p of row0Candidates) placeWithSpouses(p.id, rows[0]);

    for (let lvl = 1; lvl <= maxLevel; lvl++) {
      const row = rows[lvl];
      const prevRow = rows[lvl - 1];
      const seenFamilies = new Set();

      for (const parentId of prevRow) {
        const children = Object.values(people)
          .filter(p => levels[p.id] === lvl && p.parents.includes(parentId))
          .sort(compareByBirth);
        for (const child of children) {
          const fkey = familyKey(child.parents);
          if (seenFamilies.has(fkey)) continue;
          seenFamilies.add(fkey);
          const siblings = Object.values(people)
            .filter(p => levels[p.id] === lvl && familyKey(p.parents) === fkey)
            .sort(compareByBirth);
          for (const sib of siblings) placeWithSpouses(sib.id, row);
        }
      }
      // Leftovers at this level (no parent placed in previous row, e.g. married-in with unknown ancestry)
      const leftovers = Object.values(people)
        .filter(p => levels[p.id] === lvl && !placed.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const p of leftovers) placeWithSpouses(p.id, row);
    }

    return rows;
  }

  // ---------- Centered tree layout ----------

  const CARD_WIDTH = 150; // must match .person-card { width } in style.css
  const SPOUSE_GAP = 16; // gap between the two cards of a couple
  const SIBLING_GAP = 30; // gap between distinct sibling/couple clusters
  const ROW_GAP = 70; // vertical gap between generations
  const MARGIN = 60;

  // Groups each row into clusters (a lone person, or a spouse pair that must
  // render side by side), then gives each cluster a subtree width and an x
  // center so that every parent cluster sits centered above its children —
  // a couple's own width may be narrower than its children need, in which
  // case the couple is centered over the wider children span, and vice versa.
  function buildClusters(rows) {
    const personToCluster = {};
    const clustersByLevel = rows.map((row, level) => {
      const clusters = [];
      const used = new Set();
      for (let i = 0; i < row.length; i++) {
        const id = row[i];
        if (used.has(id)) continue;
        used.add(id);
        // placeWithSpouses() pushes a hub immediately followed by every
        // same-level spouse it has, so a remarriage (2+ spouses) needs a
        // 3+-member cluster here -- pairing only the first two would leave
        // later spouses in their own untethered, unpositioned cluster.
        const members = [id];
        while (true) {
          const next = row[i + members.length];
          if (!next || used.has(next) || !data.people[id].spouses.includes(next)) break;
          used.add(next);
          members.push(next);
        }
        const cluster = { members, level, children: [], width: 0, ownWidth: 0, x: 0 };
        clusters.push(cluster);
        for (const m of members) personToCluster[m] = cluster;
      }
      return clusters;
    });

    // Attach each child cluster to the cluster containing its first parent.
    for (let level = 1; level < rows.length; level++) {
      for (const id of rows[level]) {
        const firstParent = data.people[id].parents[0];
        if (!firstParent || !data.people[firstParent]) continue;
        const parentCluster = personToCluster[firstParent];
        const childCluster = personToCluster[id];
        if (parentCluster && !parentCluster.children.includes(childCluster)) {
          parentCluster.children.push(childCluster);
        }
      }
    }

    // Subtree widths, deepest generation first.
    for (let level = clustersByLevel.length - 1; level >= 0; level--) {
      for (const cluster of clustersByLevel[level]) {
        cluster.ownWidth = cluster.members.length * CARD_WIDTH + (cluster.members.length - 1) * SPOUSE_GAP;
        if (cluster.children.length === 0) {
          cluster.width = cluster.ownWidth;
        } else {
          const childrenWidth = cluster.children.reduce((sum, c) => sum + c.width, 0)
            + SIBLING_GAP * (cluster.children.length - 1);
          cluster.width = Math.max(cluster.ownWidth, childrenWidth);
        }
      }
    }

    // X centers, root generation first, then each cluster centers its children.
    let cursorX = MARGIN;
    for (const cluster of clustersByLevel[0] || []) {
      cluster.x = cursorX + cluster.width / 2;
      cursorX += cluster.width + SIBLING_GAP;
    }
    for (const row of clustersByLevel) {
      for (const cluster of row) {
        if (!cluster.children.length) continue;
        const childrenWidth = cluster.children.reduce((sum, c) => sum + c.width, 0)
          + SIBLING_GAP * (cluster.children.length - 1);
        let childX = cluster.x - childrenWidth / 2;
        for (const child of cluster.children) {
          child.x = childX + child.width / 2;
          childX += child.width + SIBLING_GAP;
        }
      }
    }

    return clustersByLevel;
  }

  // ---------- Rendering ----------

  function renderTree() {
    if (viewMode === 'chronological') renderChronological();
    else renderTraditional();
  }

  function renderTraditional() {
    const hasPeople = Object.keys(data.people).length > 0;
    els.emptyState.hidden = hasPeople;
    els.content.innerHTML = '';
    els.svg.innerHTML = '';
    if (!hasPeople) return;

    const levels = computeLevels();
    const rows = computeOrder(levels);
    const clustersByLevel = buildClusters(rows);

    const cardEls = {};
    for (const row of rows) {
      for (const id of row) {
        const card = buildCard(data.people[id]);
        els.content.appendChild(card);
        cardEls[id] = card;
      }
    }

    // Row heights depend on rendered card height (names can wrap), so
    // measure now that cards are in the DOM, before positioning them.
    const rowHeight = rows.map(row => row.reduce((max, id) => Math.max(max, cardEls[id].offsetHeight), 0));
    const rowY = [];
    let y = MARGIN;
    for (let i = 0; i < rows.length; i++) {
      rowY.push(y);
      y += rowHeight[i] + ROW_GAP;
    }

    let maxRight = 0;
    for (const row of clustersByLevel) {
      for (const cluster of row) {
        const leftEdge = cluster.x - cluster.ownWidth / 2;
        cluster.members.forEach((id, i) => {
          const left = leftEdge + i * (CARD_WIDTH + SPOUSE_GAP);
          cardEls[id].style.left = `${left}px`;
          cardEls[id].style.top = `${rowY[cluster.level]}px`;
          maxRight = Math.max(maxRight, left + CARD_WIDTH);
        });
      }
    }

    els.content.style.width = `${maxRight + MARGIN}px`;
    els.content.style.height = `${y - ROW_GAP + MARGIN}px`;

    // Draw connecting lines after layout so we can measure real positions.
    requestAnimationFrame(drawLines);
  }

  function formatYear(dateStr) {
    if (!dateStr) return '';
    const y = dateStr.split('-')[0];
    return y || '';
  }

  function buildCard(person, options) {
    const card = document.createElement('div');
    card.className = 'person-card';
    if (person.deathDate) card.classList.add('deceased');
    if (options && options.marriedIn) card.classList.add('married-in');
    card.dataset.id = person.id;

    const photo = document.createElement('div');
    photo.className = 'person-photo';
    if (person.photo) {
      const img = document.createElement('img');
      img.src = person.photo;
      img.alt = person.name;
      photo.appendChild(img);
    } else {
      photo.textContent = '🧑';
    }

    const info = document.createElement('div');
    info.className = 'person-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'person-name';
    nameEl.textContent = person.name || '(unnamed)';
    const datesEl = document.createElement('div');
    datesEl.className = 'person-dates';
    const born = formatYear(person.birthDate);
    const died = formatYear(person.deathDate);
    if (born && died) datesEl.textContent = `${born} – ${died}`;
    else if (born) datesEl.textContent = `b. ${born}`;
    else if (died) datesEl.textContent = `d. ${died}`;
    else datesEl.textContent = '';

    info.appendChild(nameEl);
    info.appendChild(datesEl);
    card.appendChild(photo);
    card.appendChild(info);

    card.addEventListener('click', () => openViewModal(person.id));
    return card;
  }

  function svgLine(x1, y1, x2, y2, color, width, dash) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', color || 'var(--line)');
    line.setAttribute('stroke-width', width || 2);
    if (dash) line.setAttribute('stroke-dasharray', dash);
    return line;
  }

  const CONNECTOR_CORNER_RADIUS = 12; // px, rounding at each elbow bend

  // A parent/child connector, drawn as one right-angle path (each
  // consecutive pair of points purely horizontal or vertical) with a
  // rounded corner at every interior bend, quadratic-curved through the
  // original corner point. A corner's radius shrinks to fit when either
  // adjacent segment is shorter than 2x radius, so short stubs never
  // overshoot past their own endpoint or the next bend.
  function svgElbowPath(rawPoints, radius, color, width) {
    // Collapse any zero-length segment (e.g. a child sitting exactly under
    // the parent's anchor X) so it doesn't produce a degenerate corner.
    const points = rawPoints.filter((pt, i) => i === 0 || pt.x !== rawPoints[i - 1].x || pt.y !== rawPoints[i - 1].y);
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1], cur = points[i], next = points[i + 1];
      const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
      const r = Math.min(radius, inLen / 2, outLen / 2);
      const before = { x: cur.x - Math.sign(cur.x - prev.x) * r, y: cur.y - Math.sign(cur.y - prev.y) * r };
      const after = { x: cur.x + Math.sign(next.x - cur.x) * r, y: cur.y + Math.sign(next.y - cur.y) * r };
      d += ` L ${before.x} ${before.y} Q ${cur.x} ${cur.y} ${after.x} ${after.y}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color || 'var(--line)');
    path.setAttribute('stroke-width', width || 2);
    return path;
  }

  function drawLines() {
    const svg = els.svg;
    svg.innerHTML = '';

    // Use layout coordinates (offsetLeft/Top/Width/Height), not
    // getBoundingClientRect(): the SVG lives inside the same panned/zoomed
    // #treeCanvas as the cards, so screen-space (post-transform) coordinates
    // would get scaled a second time when the browser paints the SVG,
    // squashing or exploding the lines away from the cards whenever
    // view.scale != 1. offsetLeft/Top are relative to #treeContent (the
    // nearest positioned ancestor) and are transform-independent, matching
    // how cards were positioned in the first place.
    const cardRect = (id) => {
      const el = els.content.querySelector(`[data-id="${id}"]`);
      if (!el) return null;
      return {
        left: el.offsetLeft,
        top: el.offsetTop,
        right: el.offsetLeft + el.offsetWidth,
        bottom: el.offsetTop + el.offsetHeight,
        centerX: el.offsetLeft + el.offsetWidth / 2,
        centerY: el.offsetTop + el.offsetHeight / 2,
      };
    };

    svg.setAttribute('width', els.content.scrollWidth);
    svg.setAttribute('height', els.content.scrollHeight);
    svg.style.width = els.content.scrollWidth + 'px';
    svg.style.height = els.content.scrollHeight + 'px';

    const people = data.people;
    const drawnSpousePairs = new Set();

    // Spouse lines
    for (const p of Object.values(people)) {
      for (const sid of p.spouses) {
        if (!people[sid]) continue;
        const key = [p.id, sid].sort().join('~');
        if (drawnSpousePairs.has(key)) continue;
        drawnSpousePairs.add(key);
        const r1 = cardRect(p.id), r2 = cardRect(sid);
        if (!r1 || !r2 || Math.abs(r1.centerY - r2.centerY) > 5) continue; // only same-row spouses
        const y = r1.centerY;
        const x1 = r1.right < r2.left ? r1.right : r2.right;
        const x2 = r1.right < r2.left ? r2.left : r1.left;
        // A hub with 2+ spouses (a remarriage) puts them in the same row --
        // only tie together cards that are actually next to each other, so
        // a tie to the far spouse doesn't draw straight through whoever
        // else's card sits in between.
        if (Math.abs(x2 - x1) > SPOUSE_GAP + 2) continue;
        svg.appendChild(svgLine(x1, y, x2, y));
      }
    }

    // Parent-child lines, grouped by family (parent set)
    const familyGroups = {};
    for (const p of Object.values(people)) {
      if (!p.parents.length) continue;
      const key = familyKey(p.parents);
      (familyGroups[key] = familyGroups[key] || { parents: p.parents, children: [] }).children.push(p.id);
    }

    for (const group of Object.values(familyGroups)) {
      const parentRects = group.parents.map(cardRect).filter(Boolean);
      const childRects = group.children.map(cardRect).filter(Boolean);
      if (!parentRects.length || !childRects.length) continue;

      const parentAnchorX = parentRects.reduce((s, r) => s + r.centerX, 0) / parentRects.length;
      const parentY = Math.max(...parentRects.map(r => r.bottom));
      const childTopY = Math.min(...childRects.map(r => r.top));
      const busY = parentY + (childTopY - parentY) / 2;

      // One elbow path per child -- from the shared parent trunk, along the
      // bus row, down to that child -- rather than a shared bus line plus
      // separate stubs, so every bend (trunk-to-bus, bus-to-child-stub) has
      // its own rounded corner. Overlapping trunk/bus segments between
      // children's paths draw identically on top of each other, so it
      // still reads as a single shared bus visually.
      for (const r of childRects) {
        svg.appendChild(svgElbowPath([
          { x: parentAnchorX, y: parentY },
          { x: parentAnchorX, y: busY },
          { x: r.centerX, y: busY },
          { x: r.centerX, y: r.top },
        ], CONNECTOR_CORNER_RADIUS));
      }
    }
  }

  window.addEventListener('resize', () => requestAnimationFrame(() => {
    if (viewMode === 'chronological') renderChronological();
    else drawLines();
  }));

  // ---------- Chronological view ----------
  //
  // X-axis, generation grouping, and sibling/spouse spacing are taken
  // wholesale from the traditional tree's own layout (computeLevels /
  // computeOrder / buildClusters) -- only the Y-axis differs. Each row
  // (generation level) sits at a Y derived from birth year instead of a
  // fixed row height, so the parent/child edge connecting it to the row
  // above lengthens to reflect real elapsed time, and never compresses
  // below the traditional tree's own row gap.
  //
  // Y = birth year, always, when it's known -- a married-in spouse (no
  // recorded parents in the tree) sits at their own age same as anyone
  // else. Only when a married-in spouse's OWN birth year is unknown do
  // they inherit their partner's year as a placeholder, since the timeline
  // otherwise has nothing to place them by.

  const CHRONO_PX_PER_YEAR = 12; // 120px per decade
  const CHRONO_Y_TOP = 60; // top margin above the earliest year
  // Just enough breathing room to keep a parent and child's cards from
  // visually touching -- NOT the traditional tree's generation gap (70px).
  // That would add a fixed cushion on top of every single edge, and over
  // a long lineage those fixed cushions compound into decades of drift
  // even when every real gap already comfortably clears a card's height.
  const CHRONO_MIN_GAP = 12;

  function chronoBirthYear(id) {
    const p = data.people[id];
    if (!p || !p.birthDate) return null;
    const y = parseInt(p.birthDate.split('-')[0], 10);
    return Number.isFinite(y) ? y : null;
  }

  // Resolves every person's chronological Y-year, plus two independent
  // flags per id: marriedIn (no recorded parents -- purely a relationship
  // fact, used for the dashed card styling) and yearFromSpouse (their Y
  // had to be borrowed from a partner because their OWN birth year is
  // unknown -- used to decide whether their position may be pulled to
  // align with that partner; see chronoResolvePositions). A married-in
  // spouse whose birth year IS known gets marriedIn without
  // yearFromSpouse, so their card sits at their own age, not their
  // partner's.
  function computeChronoYears() {
    const ids = Object.keys(data.people);
    const year = {};
    const marriedIn = {};
    const yearFromSpouse = {};
    for (const id of ids) {
      if (data.people[id].parents.length === 0 && data.people[id].spouses.length > 0) marriedIn[id] = true;
    }

    // Fixed-point pass: apply whichever rule is resolvable this round (own
    // birth year first and always, else average of already-resolved
    // parents, else inherit from an already-resolved spouse as a last
    // resort) until nothing changes. Order-independent by construction, so
    // it doesn't matter which rule "should" fire first.
    let changed = true;
    let guard = 0;
    while (changed && guard++ < ids.length * 3 + 10) {
      changed = false;
      for (const id of ids) {
        if (year[id] != null) continue;
        const p = data.people[id];
        const by = chronoBirthYear(id);
        if (by != null) { year[id] = by; changed = true; continue; }
        if (p.parents.length > 0) {
          const parentYears = p.parents.map(pid => year[pid]).filter(y => y != null);
          if (parentYears.length) {
            year[id] = Math.round(parentYears.reduce((a, b) => a + b, 0) / parentYears.length) + 25;
            changed = true;
            continue;
          }
        } else {
          for (const sid of p.spouses) {
            if (data.people[sid] && year[sid] != null) {
              year[id] = year[sid];
              yearFromSpouse[id] = true;
              changed = true;
              break;
            }
          }
        }
      }
    }

    // Any fully-mutual, unanchored spouse group left over (nobody in the
    // connected component resolved above -- i.e. no one in it has a known
    // birth year or recorded parents) gets anchored on whoever in it was
    // born earliest; everyone else in the group marries in to them.
    const visited = new Set();
    for (const id of ids) {
      if (year[id] != null || visited.has(id)) continue;
      const group = [];
      const queue = [id];
      visited.add(id);
      while (queue.length) {
        const cur = queue.shift();
        group.push(cur);
        for (const sid of data.people[cur].spouses || []) {
          if (data.people[sid] && !visited.has(sid) && year[sid] == null) {
            visited.add(sid);
            queue.push(sid);
          }
        }
      }
      let anchor = group[0];
      for (const gid of group) {
        const by = chronoBirthYear(gid);
        if (by != null && (chronoBirthYear(anchor) == null || by < chronoBirthYear(anchor))) anchor = gid;
      }
      const anchorYear = chronoBirthYear(anchor) != null ? chronoBirthYear(anchor) : new Date().getFullYear();
      for (const gid of group) {
        year[gid] = anchorYear;
        if (gid !== anchor) yearFromSpouse[gid] = true;
      }
    }

    // Absolute last resort (isolated, fully undated person) -- shouldn't
    // normally trigger.
    const thisYear = new Date().getFullYear();
    for (const id of ids) if (year[id] == null) year[id] = thisYear;

    return { year, marriedIn, yearFromSpouse };
  }

  function chronoYearRange(year) {
    const years = Object.values(year);
    years.push(new Date().getFullYear());
    const minRaw = Math.min(...years);
    const maxRaw = Math.max(...years);
    const minYear = Math.floor(minRaw / 10) * 10 - 10;
    const maxYear = Math.ceil((maxRaw + 5) / 10) * 10;
    return { minYear, maxYear };
  }

  function chronoYToPixel(yr, minYear) {
    return CHRONO_Y_TOP + (yr - minYear) * CHRONO_PX_PER_YEAR;
  }

  // Extra decade gridlines, drawn behind whatever drawLines() already put
  // in the SVG (it draws first and does not clear what's appended after
  // it). The ruler still marks "Today" as a label -- see renderChronoRuler.
  function drawChronoGridlines(minYear, maxYear, contentWidth) {
    const svg = els.svg;
    for (let y = minYear; y <= maxYear; y += 10) {
      const py = chronoYToPixel(y, minYear);
      svg.insertBefore(svgLine(0, py, contentWidth, py, 'var(--card-border)', 1), svg.firstChild);
    }
  }

  function renderChronoRuler(minYear, maxYear, contentHeight) {
    els.chronoRulerInner.innerHTML = '';
    els.chronoRulerInner.style.height = `${contentHeight}px`;
    for (let y = minYear; y <= maxYear; y += 10) {
      const label = document.createElement('div');
      label.className = 'chrono-year-label';
      label.style.top = `${chronoYToPixel(y, minYear)}px`;
      label.textContent = String(y);
      els.chronoRulerInner.appendChild(label);
    }
    const thisYear = new Date().getFullYear();
    if (thisYear >= minYear && thisYear <= maxYear) {
      const today = document.createElement('div');
      today.className = 'chrono-year-label today';
      today.style.top = `${chronoYToPixel(thisYear, minYear)}px`;
      today.textContent = 'Today';
      els.chronoRulerInner.appendChild(today);
    }
  }

  // Places each person at their own natural chronological Y (grouped by
  // exact resolved year, so a married-in couple -- which always shares one
  // -- moves together), nudging a group straight down, never sideways,
  // just enough to clear any earlier-placed card whose X-range it would
  // otherwise overlap. Processing oldest-year-first means a nudge is never
  // undone by a later group. Returns a top-position map.
  // A card's floor is driven by its ACTUAL recorded parents, not by
  // whatever else happens to sit nearby: different lineages never share X
  // (buildClusters reserves each cluster's own width), so the only cards
  // that can ever legitimately overlap are a parent and its own child.
  // Checking generic X-overlap against every other already-placed card
  // let one branch's push cascade into an unrelated branch, drifting later
  // generations further and further from their true birth year.
  function chronoResolvePositions(cardEls, year, yearFromSpouse, minYear) {
    const top = {};
    const height = {};
    const ids = Object.keys(cardEls);
    for (const id of ids) height[id] = cardEls[id].offsetHeight;
    const naturalTop = id => chronoYToPixel(year[id], minYear);

    // Process a person only once every recorded parent of theirs is
    // resolved, so a child's floor can look up its parents' final tops.
    const resolved = new Set();
    let changed = true;
    let guard = 0;
    while (changed && guard++ < ids.length + 5) {
      changed = false;
      for (const id of ids) {
        if (resolved.has(id)) continue;
        const parentIds = data.people[id].parents.filter(pid => cardEls[pid]);
        if (parentIds.some(pid => !resolved.has(pid))) continue;
        let t = naturalTop(id);
        for (const pid of parentIds) t = Math.max(t, top[pid] + height[pid] + CHRONO_MIN_GAP);
        top[id] = t;
        resolved.add(id);
        changed = true;
      }
    }
    // A parent-reference cycle (bad data) would otherwise loop forever --
    // fall back to each remaining person's own natural position.
    for (const id of ids) if (!resolved.has(id)) top[id] = naturalTop(id);

    // Only a spouse whose OWN birth year is unknown (so their Y is already
    // just a borrowed placeholder, not a real age) aligns to their
    // partner's final top -- anyone with a known birth year keeps their
    // own natural position, even if that puts them above or below their
    // partner.
    changed = true;
    guard = 0;
    while (changed && guard++ < ids.length + 5) {
      changed = false;
      for (const id of ids) {
        if (!yearFromSpouse[id]) continue;
        for (const sid of data.people[id].spouses || []) {
          if (cardEls[sid] && top[sid] > top[id]) { top[id] = top[sid]; changed = true; }
        }
      }
    }

    return top;
  }

  function renderChronological() {
    const hasPeople = Object.keys(data.people).length > 0;
    els.emptyState.hidden = hasPeople;
    els.content.innerHTML = '';
    els.svg.innerHTML = '';
    els.chronoRulerInner.innerHTML = '';
    if (!hasPeople) return;

    // Same X-layout as the traditional tree: identical generation grouping,
    // ordering, and sibling/spouse clustering. Y is independent of this --
    // each person sits at their own birth year, not a shared per-row Y.
    const levels = computeLevels();
    const rows = computeOrder(levels);
    const clustersByLevel = buildClusters(rows);

    const { year, marriedIn, yearFromSpouse } = computeChronoYears();
    const { minYear, maxYear } = chronoYearRange(year);

    const cardEls = {};
    for (const row of rows) {
      for (const id of row) {
        const card = buildCard(data.people[id], { marriedIn: !!marriedIn[id] });
        els.content.appendChild(card);
        cardEls[id] = card;
      }
    }

    // X first (fixed by generation/lineage), then measure real card heights
    // (names can wrap) before resolving Y.
    let maxRight = 0;
    for (const row of clustersByLevel) {
      for (const cluster of row) {
        const leftEdge = cluster.x - cluster.ownWidth / 2;
        cluster.members.forEach((id, i) => {
          const left = leftEdge + i * (CARD_WIDTH + SPOUSE_GAP);
          cardEls[id].style.left = `${left}px`;
          maxRight = Math.max(maxRight, left + CARD_WIDTH);
        });
      }
    }

    const topById = chronoResolvePositions(cardEls, year, yearFromSpouse, minYear);
    let maxBottom = 0;
    for (const id of Object.keys(cardEls)) {
      cardEls[id].style.top = `${topById[id]}px`;
      maxBottom = Math.max(maxBottom, topById[id] + cardEls[id].offsetHeight);
    }

    const contentHeight = Math.max(maxBottom, chronoYToPixel(maxYear, minYear)) + MARGIN;
    els.content.style.width = `${maxRight + MARGIN}px`;
    els.content.style.height = `${contentHeight}px`;

    // Connectors are drawn by the exact same function the traditional tree
    // uses (same X-layout means the same bus-line grouping works
    // unchanged); only the extra gridlines/ruler are chrono-specific.
    requestAnimationFrame(() => {
      drawLines();
      drawChronoGridlines(minYear, maxYear, maxRight + MARGIN);
      renderChronoRuler(minYear, maxYear, contentHeight);
    });
  }

  // ---------- Seed sample data on first run ----------

  function seedSampleData() {
    const gp1 = uid(), gp2 = uid(), parent1 = uid(), parent2 = uid(), child1 = uid(), child2 = uid();
    data.people = {
      [gp1]: { id: gp1, name: 'Eleanor Hart', birthDate: '1938-03-12', deathDate: '2015-11-02', photo: '', notes: '', parents: [], spouses: [gp2] },
      [gp2]: { id: gp2, name: 'Walter Hart', birthDate: '1935-07-04', deathDate: '2012-01-20', photo: '', notes: '', parents: [], spouses: [gp1] },
      [parent1]: { id: parent1, name: 'Susan Hart', birthDate: '1962-05-18', deathDate: '', photo: '', notes: '', parents: [gp1, gp2], spouses: [parent2] },
      [parent2]: { id: parent2, name: 'Michael Doe', birthDate: '1960-09-09', deathDate: '', photo: '', notes: '', parents: [], spouses: [parent1] },
      [child1]: { id: child1, name: 'Jane Doe', birthDate: '1990-02-14', deathDate: '', photo: '', notes: '', parents: [parent1, parent2], spouses: [] },
      [child2]: { id: child2, name: 'Tom Doe', birthDate: '1993-08-30', deathDate: '', photo: '', notes: '', parents: [parent1, parent2], spouses: [] },
    };
  }

  // ---------- Startup ----------

  async function init() {
    usingSupabase = isSupabaseConfigured() && typeof window.supabase !== 'undefined';

    if (usingSupabase) {
      setSyncStatus('connecting');
      try {
        supabaseClient = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
        const remote = await loadRemote();
        if (remote) {
          data = remote;
        } else {
          seedSampleData();
          await saveRemote();
        }
        setSyncStatus('connected');
        subscribeRealtime();
      } catch (e) {
        console.error('Could not reach Supabase, falling back to local-only mode.', e);
        usingSupabase = false;
      }
    }

    if (!usingSupabase) {
      setSyncStatus('local');
      data = loadLocal();
      if (Object.keys(data.people).length === 0) {
        seedSampleData();
        saveLocal();
      }
    }

    renderTree();
    fitToView();
  }

  // Re-fit when the page is restored from the browser's back-forward cache
  // (e.g. returning to an already-open tab on iOS Safari): bfcache resumes
  // the exact prior JS state rather than re-running this script, so without
  // this the view could still be wherever it was left panned/zoomed before.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) fitToView();
  });

  // Mobile Safari resizes the visual viewport when the on-screen keyboard
  // shows/hides, and that resize can leave the page scrolled even after our
  // own modal-close reset already ran — the keyboard's dismiss animation
  // finishes asynchronously, after that reset. Reacting to the resize event
  // itself (rather than guessing a delay) catches that trailing scroll
  // whenever it actually settles, as long as no dialog is open.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (els.modal.hidden && els.cropModal.hidden) resetPageScroll();
    });
  }

  init();
})();
