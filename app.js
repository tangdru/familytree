(() => {
  'use strict';

  const STORAGE_KEY = 'familytree.data.v1';
  const SUPABASE_ROW_ID = 'main';
  const PHOTO_BUCKET = 'photos'; // Supabase Storage bucket -- see supabase-schema.sql
  const MAX_EDIT_DIM = 1600; // cap the source image loaded into the crop editor
  const CROP_OUT_W = 450; // 3x the rendered card photo size, for crispness
  const CROP_OUT_H = 330; // matches the card photo's 150:110 aspect ratio
  const CROP_MIN_ZOOM = 1;
  const CROP_MAX_ZOOM = 3;

  // Matches the placeholder markup baked into #viewPhotoPlaceholder in
  // index.html -- needed again here so a couple card's dynamically-built
  // member photos (see buildCoupleMember) can show the same placeholder.
  const PERSON_PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';

  // A six-dot grip, for the location-row drag handle (see addLocationRow).
  const DRAG_HANDLE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"></circle><circle cx="9" cy="12" r="1.6"></circle><circle cx="9" cy="18" r="1.6"></circle><circle cx="15" cy="6" r="1.6"></circle><circle cx="15" cy="12" r="1.6"></circle><circle cx="15" cy="18" r="1.6"></circle></svg>';

  // Icons painted on the Person View / Couple View contact chips -- see
  // buildContactChip().
  const PHONE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';
  const MAIL_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z" opacity="0"></path><path d="M22 6 12 13 2 6"></path><path d="M2 6h20v12H2z"></path></svg>';

  // Matches the emoji baked into #zodiacInput's <option> labels in
  // index.html -- needed again here to show the same emoji on the
  // read-only Person View card.
  const ZODIAC_EMOJI = {
    Rat: '🐀', Ox: '🐂', Tiger: '🐅', Rabbit: '🐇', Dragon: '🐉', Snake: '🐍',
    Horse: '🐎', Goat: '🐐', Monkey: '🐒', Rooster: '🐓', Dog: '🐕', Pig: '🐖',
  };
  const ZODIAC_CYCLE = Object.keys(ZODIAC_EMOJI); // insertion order above == the 12-year cycle order

  // Simple by-birth-year inference (2020 -> Rat, matching the well-known
  // reference years like 1984/1996/2008/2020) -- not the real, more precise
  // rule, which flips on the lunar Chinese New Year date (roughly Jan 21 -
  // Feb 20) rather than Jan 1, so anyone born in that window is off by one
  // animal here. Deliberately deferred; this is just a starting default.
  function inferZodiacFromBirthYear(birthDate) {
    const year = birthDate ? parseInt(birthDate.slice(0, 4), 10) : NaN;
    if (!Number.isFinite(year)) return '';
    return ZODIAC_CYCLE[((year - 4) % 12 + 12) % 12];
  }

  // For recognizing a US state name inside an already-saved full address
  // string -- see shortenLocationText.
  const US_STATE_NAMES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
    'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana',
    'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
    'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
    'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma',
    'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee',
    'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
    'District of Columbia'];

  // Best-effort country-name -> ISO 3166-1 alpha-2 lookup, for guessing a
  // default country for the Contact field's phone formatting from a
  // person's location instead of always assuming US. Not exhaustive --
  // covers common countries likely to actually show up in a family tree;
  // an unmapped or oddly-spelled name just falls back to no guess (caller
  // defaults to US, same as before this existed).
  const COUNTRY_NAME_TO_ISO = {
    'United States': 'US', 'United States of America': 'US', 'USA': 'US',
    'United Kingdom': 'GB', 'UK': 'GB', 'Great Britain': 'GB', 'England': 'GB', 'Scotland': 'GB', 'Wales': 'GB', 'Northern Ireland': 'GB',
    'Canada': 'CA', 'Mexico': 'MX',
    'France': 'FR', 'Germany': 'DE', 'Italy': 'IT', 'Spain': 'ES', 'Portugal': 'PT',
    'Netherlands': 'NL', 'Belgium': 'BE', 'Switzerland': 'CH', 'Austria': 'AT', 'Ireland': 'IE',
    'Sweden': 'SE', 'Norway': 'NO', 'Denmark': 'DK', 'Finland': 'FI', 'Iceland': 'IS',
    'Poland': 'PL', 'Czech Republic': 'CZ', 'Czechia': 'CZ', 'Hungary': 'HU', 'Romania': 'RO',
    'Bulgaria': 'BG', 'Greece': 'GR', 'Croatia': 'HR', 'Serbia': 'RS', 'Ukraine': 'UA', 'Russia': 'RU',
    'Turkey': 'TR', 'Israel': 'IL', 'Saudi Arabia': 'SA', 'United Arab Emirates': 'AE', 'Egypt': 'EG',
    'China': 'CN', 'Japan': 'JP', 'South Korea': 'KR', 'Korea': 'KR', 'North Korea': 'KP',
    'Taiwan': 'TW', 'Hong Kong': 'HK', 'Vietnam': 'VN', 'Viet Nam': 'VN', 'Thailand': 'TH',
    'Philippines': 'PH', 'Indonesia': 'ID', 'Malaysia': 'MY', 'Singapore': 'SG',
    'India': 'IN', 'Pakistan': 'PK', 'Bangladesh': 'BD', 'Sri Lanka': 'LK', 'Nepal': 'NP',
    'South Africa': 'ZA', 'Nigeria': 'NG', 'Kenya': 'KE', 'Ethiopia': 'ET', 'Ghana': 'GH',
    'Morocco': 'MA', 'Algeria': 'DZ',
    'Brazil': 'BR', 'Argentina': 'AR', 'Chile': 'CL', 'Colombia': 'CO', 'Peru': 'PE',
    'Venezuela': 'VE', 'Ecuador': 'EC', 'Cuba': 'CU', 'Dominican Republic': 'DO', 'Haiti': 'HT',
    'Jamaica': 'JM', 'Puerto Rico': 'PR',
    'Australia': 'AU', 'New Zealand': 'NZ', 'Luxembourg': 'LU',
  };

  // Guesses a default country from a location string ("City, State" for a
  // US location per shortenLocationText, "City, Country" otherwise) by
  // matching its last comma-separated segment. Returns null (caller
  // defaults to US) when nothing recognizable is found.
  function guessCountryFromLocationText(text) {
    if (!text) return null;
    const parts = text.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const last = parts[parts.length - 1];
    if (US_STATE_NAMES.includes(last)) return 'US';
    return COUNTRY_NAME_TO_ISO[last] || null;
  }

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

  // ---------- Photo storage ----------
  // Photos used to be embedded as base64 directly in `data.people[id].photo`,
  // which meant every single save -- even a one-letter name fix -- re-wrote
  // every photo in the whole tree as part of that one big JSON blob. Now a
  // freshly-cropped photo is uploaded to its own Supabase Storage object
  // (see PHOTO_BUCKET / supabase-schema.sql) and only its public URL string
  // goes in the JSON, so an edit's save size no longer scales with however
  // many photos anyone has ever added. Local-only mode (no Supabase) has
  // nowhere to upload to, so it keeps embedding data URLs as before.

  function isDataUrl(value) {
    return typeof value === 'string' && value.startsWith('data:');
  }

  function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mime = (header.match(/data:(.*?);base64/) || [])[1] || 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function uploadPhoto(personId, dataUrl) {
    const blob = dataUrlToBlob(dataUrl);
    const path = `${personId}-${Date.now()}.jpg`;
    const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: true,
    });
    if (error) throw error;
    return supabaseClient.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  // Best-effort cleanup of a photo this app previously uploaded -- silently
  // does nothing for a local data URL, an already-deleted object, or
  // anything outside our own bucket. Failures are logged, not surfaced:
  // a stray leftover file in Storage is harmless and not worth blocking or
  // alarming the user over.
  async function deletePhotoIfStored(url) {
    if (!usingSupabase || !url) return;
    const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const path = url.slice(idx + marker.length);
    try {
      const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).remove([path]);
      if (error) throw error;
    } catch (e) {
      console.warn('Failed to delete an old photo from storage (leaving it orphaned).', e);
    }
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
    saveBtn: document.querySelector('#personForm button[type="submit"]'),
    form: document.getElementById('personForm'),
    personId: document.getElementById('personId'),
    nameInput: document.getElementById('nameInput'),
    birthInput: document.getElementById('birthInput'),
    deathInput: document.getElementById('deathInput'),
    birthDisplayText: document.querySelector('#birthDisplay .date-display-text'),
    deathDisplayText: document.querySelector('#deathDisplay .date-display-text'),
    birthLocationInput: document.getElementById('birthLocationInput'),
    birthLocationSuggestions: document.getElementById('birthLocationSuggestions'),
    locationsList: document.getElementById('locationsList'),
    addLocationBtn: document.getElementById('addLocationBtn'),
    zodiacInput: document.getElementById('zodiacInput'),
    contactsList: document.getElementById('contactsList'),
    addContactBtn: document.getElementById('addContactBtn'),
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
    viewModalCard: document.getElementById('personViewCard'),
    viewCloseBtn: document.getElementById('viewCloseBtn'),
    viewEditBtn: document.getElementById('viewEditBtn'),
    viewSwipeZone: document.getElementById('viewSwipeZone'),
    viewPersonSingle: document.getElementById('viewPersonSingle'),
    viewPhoto: document.getElementById('viewPhoto'),
    viewPhotoImg: document.getElementById('viewPhotoImg'),
    viewPhotoPlaceholder: document.getElementById('viewPhotoPlaceholder'),
    swipeHintUp: document.getElementById('swipeHintUp'),
    swipeHintDown: document.getElementById('swipeHintDown'),
    swipeHintLeft: document.getElementById('swipeHintLeft'),
    swipeHintRight: document.getElementById('swipeHintRight'),
    viewCouple: document.getElementById('viewCouple'),
    viewCoupleContacts: document.getElementById('viewCoupleContacts'),
    viewSpouseAvatars: document.getElementById('viewSpouseAvatars'),
    viewName: document.getElementById('viewName'),
    viewDates: document.getElementById('viewDates'),
    viewBirthLocation: document.getElementById('viewBirthLocation'),
    viewZodiac: document.getElementById('viewZodiac'),
    viewContact: document.getElementById('viewContact'),
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
    viewLocationsSection: document.getElementById('viewLocationsSection'),
    viewLocationsList: document.getElementById('viewLocationsList'),
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
  setupEditableText(els.birthLocationInput);

  // ---------- Searchable combo (parent / spouse pickers) ----------

  // Tapping the trigger opens a scrollable list immediately, with no
  // on-screen keyboard — the trigger is a <button>, not a text input. The
  // keyboard only appears if someone deliberately taps the filter field
  // inside the open dropdown to search a long list.
  function createCombo(rootEl, { multiple, placeholder, createLabel, onCreateNew, chipDecorator, onSelect, onOpen }) {
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
      // Resets any stray state left behind by an abandoned onSelect
      // confirmation (e.g. the user tapped away mid-confirm last time),
      // so a fresh open always starts from the normal filter+options view.
      if (onOpen) onOpen();
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
        const nameEl = document.createElement('span');
        nameEl.className = 'chip-name';
        nameEl.textContent = labelFor(id) || '(unknown)';
        chip.appendChild(nameEl);
        // Extra per-chip content (e.g. a current/former toggle) that the
        // caller owns entirely -- it manages its own state and re-renders
        // itself, independent of this combo's own add/remove/filter cycle.
        if (chipDecorator) {
          const extra = chipDecorator(id);
          if (extra) chip.appendChild(extra);
        }
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'chip-remove';
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

    function commitAdd(opt) {
      if (!selectedIds.includes(opt.id)) selectedIds.push(opt.id);
      renderChips();
      filterInput.value = '';
      renderOptions('');
    }

    function choose(opt) {
      if (multiple) {
        // onSelect can defer the actual add (e.g. to ask "current or
        // former?" first) -- it decides when/whether to call commitAdd.
        if (onSelect) onSelect(opt, () => commitAdd(opt));
        else commitAdd(opt);
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

  const parentsCombo = createCombo(document.getElementById('parentsCombo'), { multiple: true, placeholder: 'Add parent…' });

  // Per-open-form-session draft of each spouse chip's relationship status,
  // keyed by spouse id -- 'current' or 'former'. Populated when the form
  // opens (see openModalForEdit/restorePersonForm) and read at submit
  // time; unset means 'current', the default both for a newly-added
  // spouse and for pre-existing data saved before this field existed.
  let spouseStatusDraft = {};

  function buildSpouseStatusToggle(spouseId) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-status';
    function render() {
      const isFormer = spouseStatusDraft[spouseId] === 'former';
      btn.textContent = isFormer ? 'Former' : 'Current';
      btn.classList.toggle('chip-status-former', isFormer);
    }
    render();
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      spouseStatusDraft[spouseId] = spouseStatusDraft[spouseId] === 'former' ? 'current' : 'former';
      render();
    });
    return btn;
  }

  // Asks "current or former?" right when a spouse is picked or created,
  // in the spouses dropdown's own panel -- Current pre-highlighted as the
  // common case, but the choice is never assumed silently. onChoose is
  // called with the picked status once the user answers; nothing else
  // happens (no chip, no draft entry) until they do.
  function showSpouseConfirm(name, onChoose) {
    const dropdown = document.getElementById('spousesDropdown');
    const filterWrap = dropdown.querySelector('.combo-filter-wrap');
    const optionsEl = dropdown.querySelector('.combo-options');
    const confirmEl = document.getElementById('spousesConfirm');
    const trigger = document.querySelector('#spousesCombo .combo-trigger');

    document.getElementById('spousesConfirmName').textContent = name;
    filterWrap.hidden = true;
    optionsEl.hidden = true;
    confirmEl.hidden = false;
    dropdown.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');

    function pick(status) {
      filterWrap.hidden = false;
      optionsEl.hidden = false;
      confirmEl.hidden = true;
      onChoose(status);
    }
    document.getElementById('spousesConfirmCurrent').onclick = () => pick('current');
    document.getElementById('spousesConfirmFormer').onclick = () => pick('former');
  }

  const spousesCombo = createCombo(document.getElementById('spousesCombo'), {
    multiple: true,
    placeholder: 'Add spouse/partner…',
    createLabel: '+ Add new spouse',
    onCreateNew: startAddSpouseFlow,
    chipDecorator: buildSpouseStatusToggle,
    onSelect: (opt, commit) => {
      showSpouseConfirm(opt.name, (status) => {
        spouseStatusDraft[opt.id] = status;
        commit();
      });
    },
    onOpen: () => {
      // Reset any confirm panel left showing from an abandoned pick.
      const dropdown = document.getElementById('spousesDropdown');
      dropdown.querySelector('.combo-filter-wrap').hidden = false;
      dropdown.querySelector('.combo-options').hidden = false;
      document.getElementById('spousesConfirm').hidden = true;
    },
  });

  // ---------- Location autocomplete ----------
  // Free-text field backed by OpenStreetMap's Nominatim search API (no key
  // or signup needed — a good fit given a family tree app is used rarely
  // enough that a paid/keyed geocoding API would be overkill). Debounced,
  // and guarded against out-of-order responses with a request token, since
  // a slow earlier request could otherwise resolve after a newer one.

  // Nominatim's own display_name spells out the full address hierarchy
  // (county, zip, etc.) -- too long for a location field. Show just
  // "City, State" for US results (state reads better than the country
  // here) and "City, Country" everywhere else.
  function formatLocationSuggestion(result) {
    const addr = result.address || {};
    const city = addr.city || addr.town || addr.village || addr.hamlet || addr.municipality || addr.county || '';
    const region = addr.country_code === 'us' ? (addr.state || '') : (addr.country || '');
    return [city, region].filter(Boolean).join(', ') || result.display_name;
  }

  // Cleans up a location string saved before the shortening above existed
  // (or one a suggestion click filled in before that point), so records
  // saved with the old full Nominatim address self-heal on next display --
  // no structured address fields to work from here, just heuristics over
  // the comma-separated text: first segment is the city, last is (loosely)
  // the country, and a US state is recognized by name among the segments
  // in between. Left untouched if it doesn't look like a full address
  // (fewer than 3 comma-separated segments) or no state can be found.
  function shortenLocationText(text) {
    const parts = (text || '').split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) return text || '';
    const city = parts[0];
    const country = parts[parts.length - 1];
    if (/united states/i.test(country)) {
      const state = parts.find(p => US_STATE_NAMES.includes(p));
      return state ? `${city}, ${state}` : text;
    }
    return `${city}, ${country}`;
  }

  // A contact value renders as a tel:/mailto: link on the read-only card
  // when it unambiguously looks like one or the other; anything else (or
  // an unset value) just shows as plain text, per whatever mode it was
  // last saved in -- see the Contact field's live phone/email detection.
  function contactHref(value, defaultCountry) {
    if (!value) return null;
    if (value.includes('@') && /[a-zA-Z]/.test(value)) return `mailto:${value}`;
    if (/\d/.test(value) && !/[a-zA-Z]/.test(value)) {
      // Prefer libphonenumber-js's own E.164 number (e.g. "+16175551234")
      // over just stripping punctuation -- it's the properly normalized,
      // always-dialable form regardless of which country's grouping the
      // display text is in. defaultCountry only matters when `value` has
      // no leading "+" (a domestic-style number) -- with one, the library
      // infers the country from the calling code regardless.
      if (window.libphonenumber && window.libphonenumber.parsePhoneNumberFromString) {
        try {
          const parsed = window.libphonenumber.parsePhoneNumberFromString(value, defaultCountry || 'US');
          if (parsed) return `tel:${parsed.number}`;
        } catch (e) {
          console.warn('libphonenumber-js parsing failed, falling back to plain digits.', e);
        }
      }
      return `tel:${value.replace(/[^\d+]/g, '')}`;
    }
    return null;
  }

  // The short text painted on a contact chip (see buildContactChip) --
  // just enough to recognize which contact it is, not the full value.
  // The full value is still always reachable via the chip's title
  // attribute and its tel:/mailto: target.
  function contactChipLabel(value) {
    if (!value) return '';
    if (value.includes('@') && /[a-zA-Z]/.test(value)) {
      return value.replace(/\.[a-zA-Z]{2,}$/, '');
    }
    if (/\d/.test(value)) {
      const digits = value.replace(/\D/g, '');
      return `•${digits.slice(-4)}`;
    }
    return value;
  }

  // A compact, tappable pill for one contact value -- used on both the
  // single Person View and, grouped per person, the Couple View. Renders
  // as a real tel:/mailto: link when contactHref recognizes the value,
  // otherwise as a plain (non-clickable) chip.
  function buildContactChip(value, countryHint) {
    const isEmail = value.includes('@') && /[a-zA-Z]/.test(value);
    const href = contactHref(value, countryHint);
    const chip = document.createElement(href ? 'a' : 'span');
    chip.className = 'contact-chip';
    chip.title = value;
    if (href) chip.href = href;
    const icon = document.createElement('span');
    icon.className = 'contact-chip-icon';
    icon.innerHTML = isEmail ? MAIL_ICON_SVG : PHONE_ICON_SVG;
    const label = document.createElement('span');
    label.textContent = contactChipLabel(value);
    chip.appendChild(icon);
    chip.appendChild(label);
    return chip;
  }

  function setupLocationAutocomplete(input, list) {
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
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Nominatim request failed (${res.status})`);
        const results = await res.json();
        if (token !== requestToken) return; // superseded by a newer query
        // Different results (e.g. two zip codes in the same city) can format
        // to the same short label -- dedupe while keeping relevance order.
        renderSuggestions([...new Set(results.map(formatLocationSuggestion))]);
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
  }

  // Closes any open location-suggestions dropdown when a click lands outside
  // every location field. Registered once (not inside setupLocationAutocomplete
  // itself) since location fields come and go dynamically -- the birth
  // location field plus a variable number of location rows -- and a
  // per-field listener would pile up a stale one every time a row is added.
  document.addEventListener('click', (e) => {
    if (e.target.closest('.location-field')) return;
    document.querySelectorAll('.location-suggestions:not([hidden])').forEach(list => {
      list.hidden = true;
      list.querySelector('.combo-options').innerHTML = '';
    });
  });

  setupLocationAutocomplete(els.birthLocationInput, els.birthLocationSuggestions);

  // ---------- Location(s) list (repeatable, drag-to-reorder rows) ----------
  // An ordered list of free-text locations -- index 0 is "current" (order
  // decides that, not dates; see locationsOf/currentLocationOf below and
  // BACKLOG.md for the still-deferred per-location date range).

  function addLocationRow(value) {
    const row = document.createElement('div');
    row.className = 'location-row';

    const handle = document.createElement('span');
    handle.className = 'location-row-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = DRAG_HANDLE_SVG;
    setupLocationRowDrag(row, handle);

    const field = document.createElement('div');
    field.className = 'location-field';
    const input = document.createElement('div');
    input.className = 'editable-text location-row-input';
    input.contentEditable = 'true';
    input.setAttribute('role', 'textbox');
    input.setAttribute('data-placeholder', 'City, Country');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    const suggestions = document.createElement('div');
    suggestions.className = 'combo-dropdown location-suggestions';
    suggestions.hidden = true;
    const optionsEl = document.createElement('div');
    optionsEl.className = 'combo-options';
    suggestions.appendChild(optionsEl);
    field.appendChild(input);
    field.appendChild(suggestions);

    const tag = document.createElement('span');
    tag.className = 'location-current-tag';
    tag.textContent = 'Current';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'location-row-remove';
    removeBtn.setAttribute('aria-label', 'Remove location');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      row.remove();
      refreshLocationCurrentTags();
    });

    row.appendChild(handle);
    row.appendChild(field);
    row.appendChild(tag);
    row.appendChild(removeBtn);
    els.locationsList.appendChild(row);

    setupEditableText(input);
    setEditableText(input, value || '');
    setupLocationAutocomplete(input, suggestions);
    refreshLocationCurrentTags();
    return row;
  }

  function refreshLocationCurrentTags() {
    els.locationsList.querySelectorAll('.location-row').forEach((row, i) => {
      row.querySelector('.location-current-tag').hidden = i !== 0;
    });
  }

  // Drag-to-reorder for one location row, driven from its grip handle.
  // "Current" is just whichever row ends up first (see refreshLocationCurrentTags),
  // so this is the only way to change which location is current.
  //
  // The row is nudged purely with a CSS transform while dragging -- its real
  // DOM position (and thus layout top) only changes when it's swapped past a
  // neighbor. Reading the row's rest position fresh (with the transform
  // briefly cleared) after every such swap means the visual offset needed
  // to keep it under the pointer can be recomputed from scratch each time,
  // rather than having to track an accumulating correction by hand.
  function setupLocationRowDrag(row, handle) {
    let pointerId = null;
    let grabOffset = 0; // pointer's distance below the row's rest top, at grab time

    function restTop() {
      const prevTransform = row.style.transform;
      row.style.transform = '';
      const top = row.getBoundingClientRect().top;
      row.style.transform = prevTransform;
      return top;
    }

    function reorderPast(desiredTop) {
      const rowCenter = desiredTop + row.offsetHeight / 2;
      const rows = Array.from(els.locationsList.querySelectorAll('.location-row'));
      const rowIndex = rows.indexOf(row);
      for (let i = 0; i < rows.length; i++) {
        const sib = rows[i];
        if (sib === row) continue;
        const sibRect = sib.getBoundingClientRect();
        const sibCenter = sibRect.top + sibRect.height / 2;
        if (i < rowIndex && rowCenter < sibCenter) { els.locationsList.insertBefore(row, sib); return; }
        if (i > rowIndex && rowCenter > sibCenter) { els.locationsList.insertBefore(row, sib.nextSibling); return; }
      }
    }

    function onPointerMove(e) {
      if (pointerId === null) return;
      const desiredTop = e.clientY - grabOffset;
      reorderPast(desiredTop);
      row.style.transform = `translateY(${desiredTop - restTop()}px)`;
      refreshLocationCurrentTags();
    }

    function endDrag() {
      if (pointerId === null) return;
      pointerId = null;
      row.style.transform = '';
      row.classList.remove('dragging');
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', endDrag);
      handle.removeEventListener('pointercancel', endDrag);
    }

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointerId = e.pointerId;
      handle.setPointerCapture(pointerId);
      grabOffset = e.clientY - row.getBoundingClientRect().top;
      row.classList.add('dragging');
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
    });
  }

  function setLocationRows(values) {
    els.locationsList.innerHTML = '';
    (values && values.length ? values : ['']).forEach(v => addLocationRow(v));
  }

  function getLocationsFromForm() {
    return Array.from(els.locationsList.querySelectorAll('.location-row-input'))
      .map(getEditableText)
      .filter(Boolean);
  }

  els.addLocationBtn.addEventListener('click', () => {
    addLocationRow('');
    const inputs = els.locationsList.querySelectorAll('.location-row-input');
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  });

  // ---------- View state (pan/zoom) ----------

  // How far out pinch/wheel zoom and the initial auto-fit are allowed to
  // go. A big chronological tree (many decades at even a modest px/year)
  // can be far taller than any single screen, so this needs to go well
  // below a "normal" zoomed-out level to let the whole thing fit.
  const MIN_ZOOM = 0.05;
  const view = { x: 40, y: 20, scale: 1 };
  let viewMode = 'traditional'; // 'traditional' | 'chronological'

  // The chrono ruler's own year labels, kept separately from the DOM so
  // their vertical spacing can be rescaled on every pan/zoom without a
  // full re-render -- see repositionChronoRulerLabels. { el, year } pairs,
  // rebuilt by renderChronoRuler(); chronoMinYear is whatever minYear that
  // same render used (chronoYToPixel needs it to place a given year).
  let chronoRulerLabels = [];
  let chronoMinYear = 0;

  // Rescales each label's *position* (so it lines up with the row/decade
  // it labels, same as the zoomed tree) without rescaling its rendered
  // size -- unlike the tree canvas, the ruler's own text should always
  // read at one comfortable, constant size, never microscopic zoomed out
  // or oversized (and overflowing its 56px column) zoomed in.
  function repositionChronoRulerLabels() {
    for (const { el, year } of chronoRulerLabels) {
      el.style.top = `${chronoYToPixel(year, chronoMinYear) * view.scale}px`;
    }
  }

  function applyTransform() {
    els.canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    // The chrono ruler's labels live outside #treeCanvas (so horizontal pan
    // never moves them off the viewport's left edge) but still need to
    // track vertical pan/zoom like the rows they label -- just not by
    // literally scaling the label text itself (see
    // repositionChronoRulerLabels): only translateY here, and each
    // label's own top does the scaled positioning individually.
    if (viewMode === 'chronological') {
      els.chronoRulerInner.style.transform = `translateY(${view.y}px)`;
      repositionChronoRulerLabels();
    }
  }
  applyTransform();

  els.viewModeSelect.addEventListener('change', () => {
    viewMode = els.viewModeSelect.value;
    // Fades in/out via its own opacity transition (see .chrono-ruler.visible
    // in style.css) rather than the hidden attribute, which can't animate.
    els.chronoRuler.classList.toggle('visible', viewMode === 'chronological');
    renderTree();
    // Deliberately NOT fitToView() here -- switching modes should feel like
    // the same content rearranging itself under a still camera, not a new
    // scene: pan/zoom (view.x/y/scale) stay exactly where the user left
    // them, and only the tree layout animates underneath (see
    // animateLayoutIn). Still need applyTransform() though, since the
    // chrono ruler's own transform is only kept in sync with view.{x,y,
    // scale} while chronological mode is actually active (see
    // applyTransform) -- it can otherwise go stale while panning/zooming
    // in traditional mode with the ruler faded out.
    applyTransform();
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

  // Auto-fills the zodiac dropdown from the birth year as a starting
  // default, but only until the user actually touches that dropdown
  // themselves -- from then on (for the rest of this modal session) their
  // choice wins, even if they go back and adjust the birth date.
  let zodiacManuallySet = false;

  function maybeAutoSetZodiac() {
    if (zodiacManuallySet) return;
    els.zodiacInput.value = inferZodiacFromBirthYear(els.birthInput.value);
  }

  els.zodiacInput.addEventListener('change', () => { zodiacManuallySet = true; });

  els.birthInput.addEventListener('change', () => {
    updateDateDisplay(els.birthInput, els.birthDisplayText);
    maybeAutoSetZodiac();
  });
  els.deathInput.addEventListener('change', () => updateDateDisplay(els.deathInput, els.deathDisplayText));

  // ---------- Contact field (phone or email, free text) ----------
  // One field for either, since most people only ever record one anyway --
  // it watches what's actually being typed and adapts: digits get grouped
  // with dashes as you type (like a phone keypad entry), letters get a
  // quick "+ @gmail.com" button (hidden again once an @ has been typed, on
  // the assumption you're now typing a different domain yourself).

  // Crude digit grouping used only if libphonenumber-js failed to load (no
  // network, CDN blocked, etc.) -- always US-style, no real awareness of
  // other countries' conventions. See formatPhoneLive below.
  function groupPhoneDigitsFallback(digits) {
    const len = digits.length;
    if (len <= 3) return digits;
    if (len <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    if (len <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    const rest = digits.slice(len - 10);
    return `${digits.slice(0, len - 10)}-${rest.slice(0, 3)}-${rest.slice(3, 6)}-${rest.slice(6)}`;
  }

  // Proper live phone formatting via libphonenumber-js's AsYouType (loaded
  // from CDN in index.html): a leading "+" plus country calling code picks
  // the right country's own grouping (e.g. "+44 20 7946 0958") regardless
  // of defaultCountry; without a "+" it groups a plain domestic number per
  // defaultCountry (guessed from the person's location -- see
  // guessCountryFromLocationText -- falling back to US). `cleaned` is
  // digits with an optional leading "+" only -- any dashes/spaces/parens
  // already in the field are stripped first so AsYouType re-derives the
  // grouping from scratch each time rather than compounding old formatting
  // with new.
  function formatPhoneLive(cleaned, defaultCountry) {
    if (window.libphonenumber && window.libphonenumber.AsYouType) {
      try {
        return new window.libphonenumber.AsYouType(defaultCountry || 'US').input(cleaned);
      } catch (e) {
        console.warn('libphonenumber-js formatting failed, falling back to simple grouping.', e);
      }
    }
    return groupPhoneDigitsFallback(cleaned.replace(/\D/g, ''));
  }

  // Best guess at the person-being-edited's country, from whatever's
  // currently in the form: current location (first Location(s) row) takes
  // priority since it's more likely to match where their phone number is
  // from, falling back to birth location. Read live from the DOM rather
  // than cached, since the user could still be editing those fields too.
  function currentFormLocationHint() {
    const firstRow = els.locationsList.querySelector('.location-row-input');
    const current = firstRow ? getEditableText(firstRow) : '';
    return current || getEditableText(els.birthLocationInput);
  }

  // Reformats a contenteditable's digits(+leading "+")-only content in
  // place, keeping the caret sitting after the same digit it was after
  // before -- otherwise re-writing textContent on every keystroke would
  // bounce the caret to the end and make typing in the middle of a number
  // unusable.
  function reformatPhoneField(el, defaultCountry) {
    const sel = window.getSelection();
    const caretOffset = (sel.rangeCount && el.contains(sel.anchorNode)) ? sel.getRangeAt(0).startOffset : el.textContent.length;
    const raw = el.textContent;
    const isSignificant = (ch) => /[\d+]/.test(ch);
    const sigBeforeCaret = (raw.slice(0, caretOffset).match(/[\d+]/g) || []).length;
    const formatted = formatPhoneLive(raw.replace(/[^\d+]/g, ''), defaultCountry);
    el.textContent = formatted;
    let newPos = formatted.length;
    let seen = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (isSignificant(formatted[i])) {
        seen++;
        if (seen === sigBeforeCaret) { newPos = i + 1; break; }
      }
    }
    if (sigBeforeCaret === 0) newPos = 0;
    const textNode = el.firstChild || el.appendChild(document.createTextNode(''));
    const range = document.createRange();
    range.setStart(textNode, Math.min(newPos, textNode.length));
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function updateContactGmailBtn(input, gmailBtn) {
    const value = getEditableText(input);
    const looksLikeEmail = /[a-zA-Z]/.test(value) && !value.includes('@');
    gmailBtn.hidden = !looksLikeEmail;
  }

  // Wires the phone/email live-detection behavior onto one contact row's
  // input + its own "+ @gmail.com" button -- shared by every row, since a
  // person can now record more than one (see addContactRow below).
  function setupContactRowBehavior(input, gmailBtn) {
    input.addEventListener('input', () => {
      const value = getEditableText(input);
      if (value && !/[a-zA-Z]/.test(value) && /\d/.test(value)) {
        const country = guessCountryFromLocationText(currentFormLocationHint()) || 'US';
        reformatPhoneField(input, country);
      }
      updateContactGmailBtn(input, gmailBtn);
    });

    gmailBtn.addEventListener('click', () => {
      const current = getEditableText(input);
      if (current.includes('@')) return;
      setEditableText(input, current + '@gmail.com');
      input.focus();
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      updateContactGmailBtn(input, gmailBtn);
    });
  }

  // ---------- Contact(s) list (repeatable rows) ----------
  // A person can record more than one (home phone, cell, personal email,
  // work email, ...) -- unlike Location(s), order carries no meaning here,
  // so there's no "current" tag or drag-to-reorder, just add/remove.

  function addContactRow(value) {
    const row = document.createElement('div');
    row.className = 'contact-row';

    const field = document.createElement('div');
    field.className = 'contact-field';
    const input = document.createElement('div');
    input.className = 'editable-text contact-row-input';
    input.contentEditable = 'true';
    input.setAttribute('role', 'textbox');
    input.setAttribute('data-placeholder', 'Phone or email');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    field.appendChild(input);

    const gmailBtn = document.createElement('button');
    gmailBtn.type = 'button';
    gmailBtn.className = 'contact-gmail-btn';
    gmailBtn.hidden = true;
    gmailBtn.textContent = '+ @gmail.com';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'contact-row-remove';
    removeBtn.setAttribute('aria-label', 'Remove contact');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(field);
    row.appendChild(gmailBtn);
    row.appendChild(removeBtn);
    els.contactsList.appendChild(row);

    setupEditableText(input);
    setEditableText(input, value || '');
    setupContactRowBehavior(input, gmailBtn);
    return row;
  }

  function setContactRows(values) {
    els.contactsList.innerHTML = '';
    (values && values.length ? values : ['']).forEach(v => addContactRow(v));
  }

  function getContactsFromForm() {
    return Array.from(els.contactsList.querySelectorAll('.contact-row-input'))
      .map(getEditableText)
      .filter(Boolean);
  }

  els.addContactBtn.addEventListener('click', () => {
    addContactRow('');
    const inputs = els.contactsList.querySelectorAll('.contact-row-input');
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  });

  // ---------- Modal open/close ----------

  function openModalForAdd() {
    els.form.reset();
    els.personId.value = '';
    setEditableText(els.nameInput, '');
    setEditableText(els.birthLocationInput, '');
    setLocationRows([]);
    setContactRows([]);
    pendingPhoto = null;
    showPhotoPreview(null);
    updateDateDisplay(els.birthInput, els.birthDisplayText);
    updateDateDisplay(els.deathInput, els.deathDisplayText);
    zodiacManuallySet = false;
    els.modalTitle.textContent = 'Add Person';
    els.deletePersonBtn.hidden = true;
    populateSelectOptions(null);
    parentsCombo.clear();
    spousesCombo.clear();
    spouseStatusDraft = {};
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
    setEditableText(els.birthLocationInput, shortenLocationText(p.birthLocation || ''));
    setLocationRows(locationsOf(p));
    els.zodiacInput.value = p.zodiac || '';
    zodiacManuallySet = false;
    setContactRows(contactsOf(p));
    els.notesInput.value = p.notes || '';
    pendingPhoto = p.photo || null;
    showPhotoPreview(pendingPhoto);
    els.modalTitle.textContent = 'Edit Person';
    els.deletePersonBtn.hidden = false;
    populateSelectOptions(p.id);
    parentsCombo.setValues(p.parents);
    // Populate the status draft BEFORE setValues() below: setValues()
    // renders the chips immediately, and each chip's status toggle reads
    // this draft as it's built -- setting it after would render every
    // chip with stale (or default) status first.
    spouseStatusDraft = {};
    for (const sid of p.spouses) spouseStatusDraft[sid] = spouseStatusOf(p, sid);
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
      birthLocation: getEditableText(els.birthLocationInput),
      locations: getLocationsFromForm(),
      zodiac: els.zodiacInput.value,
      zodiacManuallySet,
      contacts: getContactsFromForm(),
      notes: els.notesInput.value,
      photo: pendingPhoto,
      parents: parentsCombo.getValues(),
      spouses: spousesCombo.getValues(),
      spouseStatusDraft: { ...spouseStatusDraft },
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
    setEditableText(els.birthLocationInput, snap.birthLocation);
    setLocationRows(snap.locations);
    els.zodiacInput.value = snap.zodiac;
    zodiacManuallySet = snap.zodiacManuallySet;
    setContactRows(snap.contacts);
    els.notesInput.value = snap.notes;
    pendingPhoto = snap.photo;
    showPhotoPreview(pendingPhoto);
    els.modalTitle.textContent = snap.title;
    els.deletePersonBtn.hidden = !snap.showDelete;
    populateSelectOptions(snap.personId || null);
    parentsCombo.setValues(snap.parents);
    // Same ordering requirement as openModalForEdit: populate the draft
    // before setValues() renders the chips off of it.
    spouseStatusDraft = { ...snap.spouseStatusDraft };
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

  function firstNameOf(person) {
    const trimmed = (person.name || '').trim();
    return trimmed ? trimmed.split(/\s+/)[0] : '(unnamed)';
  }

  // onNavigate defaults to a full reset (openViewModal); the Parents section
  // passes goToParents instead, so following a parent link extends the
  // vertical thread (and lands on a couple card) rather than discarding it.
  // useFirstName trims the row to just a first name (full name in the title
  // attribute instead) -- used for Siblings/Children, which can run long
  // and go two-column (see .view-relation-grid), unlike Parents/Spouses,
  // which are only ever one or two people and stay full-name.
  function buildRelationRow(personId, onNavigate, useFirstName) {
    const p = data.people[personId];
    if (!p) return null;
    const li = document.createElement('li');
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'view-relation-link';
    const fullName = p.name || '(unnamed)';
    link.textContent = useFirstName ? firstNameOf(p) : fullName;
    if (useFirstName) link.title = fullName;
    link.addEventListener('click', () => (onNavigate || openViewModal)(personId));
    const age = computeAge(p);
    const ageSpan = document.createElement('span');
    ageSpan.className = 'view-relation-age';
    ageSpan.textContent = age == null ? '' : p.deathDate ? `(${age}, d. ${formatYear(p.deathDate)})` : `(${age})`;
    li.appendChild(link);
    li.appendChild(ageSpan);
    return li;
  }

  // A location-history row: plain text (not a link, unlike relation rows --
  // a location isn't a tree person to navigate to).
  function buildLocationRow(location) {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'view-location-text';
    text.textContent = location;
    li.appendChild(text);
    return li;
  }

  // Index 0 (the "current" one, per currentLocationOf) already shows up top
  // of the card, so this section is just everywhere *else* the person has
  // lived -- skip it here rather than repeating it.
  function fillLocationsSection(sectionEl, listEl, locations) {
    listEl.innerHTML = '';
    const previous = locations.slice(1);
    if (!previous.length) { sectionEl.hidden = true; return; }
    previous.forEach(loc => listEl.appendChild(buildLocationRow(loc)));
    sectionEl.hidden = false;
  }

  function fillRelationSection(sectionEl, listEl, ids, onNavigate, useFirstName) {
    listEl.innerHTML = '';
    const valid = ids.filter(id => data.people[id]);
    if (!valid.length) { sectionEl.hidden = true; return; }
    valid
      .slice()
      .sort((a, b) => compareByBirth(data.people[a], data.people[b]))
      .forEach(id => {
        const row = buildRelationRow(id, onNavigate, useFirstName);
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

  // A person's ordered location history -- locations[0] is "current" (order
  // decides that, not dates; see BACKLOG.md for the still-deferred
  // per-location date range). Falls back to the old singular `location`
  // field for pre-existing data that hasn't been re-saved yet, and runs
  // every entry through shortenLocationText so a record saved with the old
  // full-address text (from before that shortening existed) self-heals
  // wherever it's shown, without needing a resave first.
  function locationsOf(person) {
    if (!person) return [];
    const raw = Array.isArray(person.locations) && person.locations.length ? person.locations
      : person.location ? [person.location] : [];
    return raw.map(shortenLocationText);
  }

  function currentLocationOf(person) {
    return locationsOf(person)[0] || '';
  }

  // A person's contact entries (phone/email, in whatever order they were
  // added -- order carries no meaning here, unlike locations). Falls back
  // to the old singular `contact` field for pre-existing data that hasn't
  // been re-saved yet.
  function contactsOf(person) {
    if (!person) return [];
    if (Array.isArray(person.contacts) && person.contacts.length) return person.contacts;
    return person.contact ? [person.contact] : [];
  }

  // A couple's shared location: shown once for both, since they usually live
  // together -- the selected member's location if the two differ or only one
  // is known, otherwise the (matching) value both share.
  function sharedLocation(ids, selectedId) {
    const selLoc = currentLocationOf(data.people[selectedId]);
    const otherId = ids.find(id => id !== selectedId);
    const otherLoc = currentLocationOf(data.people[otherId]);
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

  // One half of a couple card's visuals: photo, name, dates+age, ringed
  // when selected -- with no click behavior of its own, so a swipe-preview
  // peek card (see buildSwipePeekCard) can reuse the exact same markup
  // without becoming tappable before the swipe it belongs to has committed.
  function buildCoupleMemberVisual(personId, isSelected) {
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
    return wrap;
  }

  // Clicking a member switches which side of the couple drives navigation,
  // without touching the vertical thread itself -- see selectCoupleMember.
  function buildCoupleMember(personId, isSelected) {
    const wrap = buildCoupleMemberVisual(personId, isSelected);
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
      const shortBirthLocation = shortenLocationText(p.birthLocation || '');
      els.viewBirthLocation.textContent = shortBirthLocation ? `Born in ${shortBirthLocation}` : '';
      els.viewBirthLocation.hidden = !els.viewBirthLocation.textContent;
      const zodiacEmoji = ZODIAC_EMOJI[p.zodiac];
      els.viewZodiac.textContent = zodiacEmoji ? `${zodiacEmoji} ${p.zodiac}` : '';
      els.viewZodiac.hidden = !els.viewZodiac.textContent;
      els.viewContact.innerHTML = '';
      const contacts = contactsOf(p);
      if (contacts.length) {
        const countryHint = guessCountryFromLocationText(currentLocationOf(p) || p.birthLocation || '') || 'US';
        contacts.forEach(contact => els.viewContact.appendChild(buildContactChip(contact, countryHint)));
      }
      els.viewContact.hidden = !contacts.length;
    }

    // Couple card contacts: one column per person, headed by their first
    // name -- unlike the single view above, the couple card needs that
    // heading since two people's chips sit side by side.
    els.viewCoupleContacts.innerHTML = '';
    if (isCouple) {
      let anyContacts = false;
      ids.forEach(id => {
        const person = data.people[id];
        const contacts = contactsOf(person);
        if (!contacts.length) return;
        anyContacts = true;
        const col = document.createElement('div');
        col.className = 'view-couple-contact-col';
        const heading = document.createElement('p');
        heading.className = 'view-couple-contact-name';
        heading.textContent = (person.name || '').trim().split(/\s+/)[0] || '(unnamed)';
        col.appendChild(heading);
        const countryHint = guessCountryFromLocationText(currentLocationOf(person) || person.birthLocation || '') || 'US';
        contacts.forEach(contact => col.appendChild(buildContactChip(contact, countryHint)));
        els.viewCoupleContacts.appendChild(col);
      });
      els.viewCoupleContacts.hidden = !anyContacts;
    } else {
      els.viewCoupleContacts.hidden = true;
    }

    // Spouses already shown as the other half of a couple card don't need
    // repeating in the small avatar row -- that row is for reaching anyone
    // else the selected person married, e.g. a second marriage.
    els.viewSpouseAvatars.innerHTML = '';
    const spouseIds = (p.spouses || []).filter(sid => data.people[sid] && !ids.includes(sid));
    spouseIds.forEach(sid => els.viewSpouseAvatars.appendChild(buildSpouseAvatar(sid)));
    els.viewSpouseAvatars.hidden = !spouseIds.length;

    els.viewLocation.textContent = isCouple ? sharedLocation(ids, selectedId) : currentLocationOf(p);
    els.viewLocation.hidden = !els.viewLocation.textContent;

    els.viewNotes.textContent = p.notes || '';
    els.viewNotes.hidden = !p.notes;

    fillRelationSection(els.viewParentsSection, els.viewParentsList, p.parents || [], goToParents);

    const siblingIds = Object.keys(data.people).filter(id => {
      if (id === selectedId) return false;
      return data.people[id].parents.some(pid => p.parents.includes(pid));
    });
    fillRelationSection(els.viewSiblingsSection, els.viewSiblingsList, siblingIds, undefined, true);

    // A couple card already shows both partners directly -- a Spouses list
    // repeating "the other one" underneath adds nothing.
    if (isCouple) {
      els.viewSpousesSection.hidden = true;
    } else {
      fillRelationSection(els.viewSpousesSection, els.viewSpousesList, p.spouses || []);
    }

    const childIds = Object.keys(data.people).filter(id => ids.some(pid => data.people[id].parents.includes(pid)));
    fillRelationSection(els.viewChildrenSection, els.viewChildrenList, childIds, undefined, true);

    fillLocationsSection(els.viewLocationsSection, els.viewLocationsList, locationsOf(p));

    updateSwipeHints();
    els.viewModal.hidden = false;
  }

  function closeViewModal() {
    if (document.activeElement && els.viewModal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    els.viewModal.hidden = true;
    resetPageScroll();
  }

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

  // 'current' or 'former' -- unset means 'current', the default both for a
  // freshly-added spouse and for pre-existing data saved before this field
  // existed.
  function spouseStatusOf(person, spouseId) {
    return (person && person.spouseStatus && person.spouseStatus[spouseId]) === 'former' ? 'former' : 'current';
  }

  // A person's current partner to pair them with on a couple card -- their
  // first recorded spouse who isn't tagged "former". A former spouse is
  // still a real recorded relationship (reachable via the avatar row and
  // relation lists), it just isn't auto-paired -- same as having no spouse
  // at all, per coupleIdsFor below. See BACKLOG.md for more than one
  // current partner.
  function partnerIdOf(personId) {
    const p = data.people[personId];
    return ((p && p.spouses) || []).find(id => data.people[id] && spouseStatusOf(p, id) === 'current') || null;
  }

  // The ids to render for a single anchor person: paired with their partner
  // when they have one, so anyone with a current recorded spouse always
  // gets the couple card, not just when viewed as "the parents" of someone
  // else. personId is always first, and the default selected.
  function coupleIdsFor(personId) {
    const partnerId = partnerIdOf(personId);
    return partnerId ? [personId, partnerId] : [personId];
  }

  // A person's recorded parents, filtered to ones that still exist, capped
  // to the two the couple card can actually show (their own stored order --
  // additional parents beyond that still appear in the Parents relation
  // list, just not on the card itself). A single recorded parent is still
  // paired with THEIR current partner if they have one (e.g. a
  // step-parent), per coupleIdsFor. Rendered by renderPersonView -- see
  // verticalGoDown/goToParents.
  function parentIdsOf(personId) {
    const p = data.people[personId];
    const recorded = ((p && p.parents) || []).filter(id => data.people[id]);
    return recorded.length === 1 ? coupleIdsFor(recorded[0]) : recorded.slice(0, 2);
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

  // Read-only mirrors of verticalGoUp/verticalGoDown's own logic, for the
  // swipe-drag preview (see the pointermove handler below) and the edge
  // hints (updateSwipeHints) to check "is there actually somewhere to go"
  // without mutating verticalPath -- the real navigation still always goes
  // through verticalGoUp/verticalGoDown themselves once a swipe commits.
  function peekChildIds() {
    if (!verticalPath.length) return null;
    if (verticalIndex + 1 < verticalPath.length) return verticalPath[verticalIndex + 1];
    const childId = firstChildId(verticalPath[verticalIndex].selected);
    return childId ? { ids: coupleIdsFor(childId), selected: childId } : null;
  }

  function peekParentIds() {
    if (!verticalPath.length) return null;
    if (verticalIndex > 0) return verticalPath[verticalIndex - 1];
    const parentIds = parentIdsOf(verticalPath[0].selected);
    return parentIds.length ? { ids: parentIds, selected: parentIds[0] } : null;
  }

  // Whether the swipe-edge hints (see updateSwipeHints) should show for
  // each direction -- mirrors exactly what a swipe in that direction would
  // actually do, so a hint never promises a swipe that would be a no-op.
  function canSwipeLeft() { return siblingNeighborId(currentViewId, 1) !== null; }
  function canSwipeRight() { return siblingNeighborId(currentViewId, -1) !== null; }
  function canSwipeUp() { return peekChildIds() !== null; }
  function canSwipeDown() { return peekParentIds() !== null; }

  function updateSwipeHints() {
    els.swipeHintLeft.hidden = !canSwipeLeft();
    els.swipeHintRight.hidden = !canSwipeRight();
    els.swipeHintUp.hidden = !canSwipeUp();
    els.swipeHintDown.hidden = !canSwipeDown();
  }

  const SWIPE_THRESHOLD = 48;   // px; smaller drags are taps, not swipes
  const SWIPE_DEADZONE = 10;    // px moved before this counts as dragging at all
  const SWIPE_SETTLE_MS = 220;  // must match .swipe-settling's transition duration in style.css
  const SWIPE_RESISTANCE = 0.35;    // how far a dead-end drag (no neighbor) travels, relative to the finger
  const SWIPE_RESISTANCE_MAX = 46;  // px cap on a dead-end drag's visual travel
  let swipeStart = null;
  let swipeCaptured = false;
  let suppressNextClick = false;

  // Live drag-follow state, set once a drag is captured (past the
  // deadzone) and cleared once its settle animation finishes -- see
  // startSwipeDrag/updateSwipeDrag/endSwipeDrag.
  let dragAxis = null;         // 'x' | 'y'
  let dragCaptureSign = 0;     // +1/-1: sign of dx (axis 'x') or dy (axis 'y') at the moment of capture
  let dragSign = 0;            // +1/-1: which side the incoming card starts off-screen on (always -dragCaptureSign)
  let dragNeighbor = null;     // { ids, selected, kind: 'sibling' | 'child' | 'parent' }, or null for a dead end
  let dragDim = 0;             // outgoing card's width (axis x) or height (axis y), px
  let dragGap = 0;             // the card's own margin to the screen edge -- see startSwipeDrag
  let dragOutFar = 0;          // outgoing's fully-off-screen offset: dragDim + dragGap
  let dragInStart = 0;         // incoming's starting (fully-off-screen) offset -- see startSwipeDrag
  let dragLayer = null;
  let outgoingEl = null;
  let incomingEl = null;

  // Duplicate ids in the DOM are invalid HTML and, worse, would shadow the
  // real elements for any later document.getElementById lookup -- everything
  // in this app resolves those once at startup into the `els` cache, so in
  // practice nothing breaks, but the clone should still never carry them.
  function stripIds(el) {
    el.removeAttribute('id');
    el.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  }

  // What a swipe in this direction would land on, without navigating there
  // -- mirrors siblingNeighborId's own sign convention (a positive dx, i.e.
  // dragging right, reveals the previous/older sibling) and
  // verticalGoUp/verticalGoDown's (dragging up reveals a child).
  function resolveSwipeTarget(axis, sign) {
    if (axis === 'x') {
      const siblingId = siblingNeighborId(currentViewId, sign > 0 ? -1 : 1);
      return siblingId ? { ids: coupleIdsFor(siblingId), selected: siblingId, kind: 'sibling' } : null;
    }
    const target = sign < 0 ? peekChildIds() : peekParentIds();
    return target ? { ...target, kind: sign < 0 ? 'child' : 'parent' } : null;
  }

  // The one place a swipe actually navigates -- always goes through the
  // same functions a tap-based navigation would, so there's exactly one
  // codepath that mutates verticalPath / calls openViewModal.
  function commitDragNeighbor(neighbor) {
    if (neighbor.kind === 'sibling') openViewModal(neighbor.selected);
    else if (neighbor.kind === 'child') verticalGoUp();
    else verticalGoDown();
  }

  // Mounts the drag-follow overlay: a pixel-perfect clone of the whole
  // modal card as it looks right now (outgoing), plus -- if there's
  // actually somewhere to go in this direction -- a full clone of how it
  // would look for the destination (incoming), positioned just off the
  // appropriate edge. The incoming clone is captured by briefly rendering
  // the destination for real into the live card, cloning that, then
  // rendering the original back -- reusing renderPersonView itself rather
  // than a second, parallel card-building codepath, and safe to do because
  // renderPersonView has no side effect beyond repainting the DOM (it
  // never touches verticalPath/verticalIndex) -- so this leaves navigation
  // state untouched and never paints on screen, since both calls happen
  // synchronously before the browser gets a chance to render either one.
  // The real card is hidden (not removed, so it keeps its layout space)
  // for the overlay's duration.
  function startSwipeDrag(axis) {
    dragAxis = axis;
    dragNeighbor = resolveSwipeTarget(axis, dragCaptureSign);
    dragSign = -dragCaptureSign;

    const cardEl = els.viewModalCard;
    const rect = cardEl.getBoundingClientRect();
    dragDim = axis === 'x' ? rect.width : rect.height;
    // The same margin the card already keeps from the screen edge at rest
    // (rect.left/top, since .modal-overlay centers it) -- kept as a visible
    // gap between the outgoing and incoming cards instead of them sliding
    // past each other edge-to-edge.
    dragGap = axis === 'x' ? rect.left : rect.top;
    dragOutFar = dragDim + dragGap;
    const prop = axis === 'x' ? 'translateX' : 'translateY';

    dragLayer = document.createElement('div');
    dragLayer.className = 'swipe-drag-layer';
    dragLayer.style.left = `${rect.left}px`;
    dragLayer.style.top = `${rect.top}px`;
    dragLayer.style.width = `${rect.width}px`;
    dragLayer.style.height = `${rect.height}px`;
    document.body.appendChild(dragLayer);

    outgoingEl = cardEl.cloneNode(true);
    stripIds(outgoingEl);
    outgoingEl.classList.add('swipe-card-slot', 'swipe-card-outgoing');
    dragLayer.appendChild(outgoingEl);

    if (dragNeighbor) {
      const current = verticalPath[verticalIndex]; // exactly what's on screen right now
      renderPersonView(dragNeighbor.ids, dragNeighbor.selected);
      incomingEl = cardEl.cloneNode(true);
      stripIds(incomingEl);
      renderPersonView(current.ids, current.selected); // restore before the browser ever paints the swap
      incomingEl.classList.add('swipe-card-slot', 'swipe-card-incoming');
      dragLayer.appendChild(incomingEl);
      // Single/couple cards are rarely the same size (contacts, location
      // history, etc. all add height) -- for axis 'y' especially, using
      // the OUTGOING card's own height to place the incoming one produced
      // a wildly inconsistent-looking gap whenever the two heights
      // differed. Entering from the "positive" side (dragSign > 0), the
      // reference point is the outgoing card's own far edge (dragDim), so
      // that side is unaffected by incoming's size; entering from the
      // "negative" side, it's incoming's *own* far edge that needs to
      // land just short of the outgoing card's near edge (0), which
      // depends on incoming's own height -- hence measuring it fresh here
      // rather than reusing dragDim for both sides.
      const incomingDim = axis === 'x' ? incomingEl.getBoundingClientRect().width : incomingEl.getBoundingClientRect().height;
      dragInStart = dragSign > 0 ? dragOutFar : -(incomingDim + dragGap);
      incomingEl.style.transform = `${prop}(${dragInStart}px)`;
    } else {
      incomingEl = null;
    }

    cardEl.style.visibility = 'hidden';
  }

  // Tracks the pointer 1:1 while the gesture is live. A dead end (no
  // neighbor that direction) just gives the outgoing card a little
  // rubber-band resistance instead of sliding a new one in.
  function updateSwipeDrag(delta) {
    const prop = dragAxis === 'x' ? 'translateX' : 'translateY';
    if (!dragNeighbor) {
      const resisted = Math.max(-SWIPE_RESISTANCE_MAX, Math.min(SWIPE_RESISTANCE_MAX, delta * SWIPE_RESISTANCE));
      outgoingEl.style.transform = `${prop}(${resisted}px)`;
      return;
    }
    const clamped = Math.max(-dragDim, Math.min(dragDim, delta));
    outgoingEl.style.transform = `${prop}(${clamped}px)`;
    incomingEl.style.transform = `${prop}(${dragInStart + clamped}px)`;
  }

  // Finishes the gesture: animates the rest of the way to either a full
  // swap (committed) or back to rest (spring-back), then tears down the
  // overlay and -- only if committed -- performs the real navigation.
  function endSwipeDrag(committed) {
    const axis = dragAxis;
    const prop = axis === 'x' ? 'translateX' : 'translateY';
    outgoingEl.classList.add('swipe-settling');
    if (incomingEl) incomingEl.classList.add('swipe-settling');

    if (committed) {
      outgoingEl.style.transform = `${prop}(${dragCaptureSign * dragOutFar}px)`;
      if (incomingEl) incomingEl.style.transform = `${prop}(0px)`;
    } else {
      outgoingEl.style.transform = `${prop}(0px)`;
      if (incomingEl) incomingEl.style.transform = `${prop}(${dragInStart}px)`;
    }

    const neighbor = dragNeighbor;
    const layer = dragLayer;
    const realCard = els.viewModalCard;
    dragLayer = null; outgoingEl = null; incomingEl = null; dragAxis = null; dragNeighbor = null;

    window.setTimeout(() => {
      layer.remove();
      // If a new drag started before this timeout fired (a very fast
      // second swipe), it has already hidden realCard for its own
      // overlay -- leave that alone; its own endSwipeDrag will restore it.
      if (!swipeCaptured) realCard.style.visibility = '';
      if (committed && neighbor) commitDragNeighbor(neighbor);
    }, SWIPE_SETTLE_MS + 20);
  }

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
    if (!swipeStart || e.pointerId !== swipeStart.id) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    if (!swipeCaptured) {
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
      const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      dragCaptureSign = (axis === 'x' ? dx : dy) >= 0 ? 1 : -1;
      startSwipeDrag(axis);
    }
    updateSwipeDrag(dragAxis === 'x' ? dx : dy);
  });
  els.viewSwipeZone.addEventListener('pointerup', (e) => {
    if (swipeCaptured && els.viewSwipeZone.hasPointerCapture(e.pointerId)) {
      els.viewSwipeZone.releasePointerCapture(e.pointerId);
    }
    if (!swipeStart || e.pointerId !== swipeStart.id) { swipeStart = null; return; }
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (!swipeCaptured) return; // a plain tap -- no drag ever started

    const delta = dragAxis === 'x' ? dx : dy;
    // Only commits if the release still agrees with the direction the
    // gesture captured in -- a hard reversal mid-drag (start right, end up
    // left of the start point) always springs back rather than navigating
    // to whatever the *original* direction's neighbor was.
    const committed = !!dragNeighbor && Math.sign(delta) === dragCaptureSign && Math.abs(delta) >= SWIPE_THRESHOLD;
    suppressNextClick = committed;
    endSwipeDrag(committed);
    swipeCaptured = false;
  });
  els.viewSwipeZone.addEventListener('pointercancel', () => {
    if (swipeCaptured) endSwipeDrag(false);
    swipeStart = null;
    swipeCaptured = false;
  });
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

    parentsCombo.setOptions(people);
    spousesCombo.setOptions(people);
  }

  // ---------- Form submit / delete ----------

  // Guards the whole submit handler against a second tap (or Enter, or
  // anything else) firing again while an earlier submission's saveData()
  // is still in flight -- saveData() can take a visible moment (a Supabase
  // round-trip), and with no guard each extra tap generated its own uid()
  // and saved as a brand-new person, so an impatient double- or triple-tap
  // on Save produced that many duplicate cards on the tree.
  let isSavingPerson = false;

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSavingPerson) return;
    isSavingPerson = true;
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = 'Saving…';
    try {
      const name = getEditableText(els.nameInput);
      if (!name) { els.nameInput.focus(); return; }
      // Blur now (rather than waiting for closeModal) so the on-screen
      // keyboard has the whole saveData() round-trip to finish dismissing.
      if (document.activeElement) document.activeElement.blur();

      const id = els.personId.value || uid();
      const isNew = !els.personId.value;

      const parents = parentsCombo.getValues();
      if (parents.includes(id)) { alert('A person cannot be their own parent.'); return; }

      const spouses = spousesCombo.getValues().filter(v => v && v !== id);

      // Prevent a parent cycle (ancestor being set as descendant)
      if (parents.some(pid => isDescendant(id, pid))) {
        alert('That would create a cycle (a descendant cannot be their own ancestor).');
        return;
      }

      // A freshly-cropped photo is still a local data URL at this point --
      // upload it to Storage now and store just the resulting public URL.
      // An unchanged photo is already either a Storage URL (left as-is) or,
      // for a person not yet touched since this feature shipped, still a
      // legacy data URL -- which this same upload step opportunistically
      // migrates too, since isDataUrl() doesn't care why the value is a
      // data URL, only that it is one.
      const originalPhoto = (data.people[id] && data.people[id].photo) || '';
      let photoUrl = pendingPhoto || '';
      if (usingSupabase && isDataUrl(photoUrl)) {
        try {
          photoUrl = await uploadPhoto(id, photoUrl);
        } catch (err) {
          console.error('Failed to upload photo to storage.', err);
          alert('Could not upload the photo. Please try saving again.');
          return;
        }
      }

      const person = data.people[id] || { id, parents: [], spouses: [] };
      person.name = name;
      person.birthDate = els.birthInput.value || '';
      person.deathDate = els.deathInput.value || '';
      person.locations = getLocationsFromForm();
      delete person.location; // superseded by locations -- see locationsOf()
      person.birthLocation = getEditableText(els.birthLocationInput);
      person.zodiac = els.zodiacInput.value;
      person.contacts = getContactsFromForm();
      delete person.contact; // superseded by contacts -- see contactsOf()
      person.notes = els.notesInput.value.trim();
      person.photo = photoUrl;
      person.parents = parents;

      data.people[id] = person;

      // Sync spouse relationships symmetrically
      const prevSpouses = new Set(person.spouses || []);
      const nextSpouses = new Set(spouses);
      for (const otherId of prevSpouses) {
        if (!nextSpouses.has(otherId) && data.people[otherId]) {
          data.people[otherId].spouses = data.people[otherId].spouses.filter(s => s !== id);
          if (data.people[otherId].spouseStatus) delete data.people[otherId].spouseStatus[id];
        }
      }
      for (const otherId of nextSpouses) {
        const other = data.people[otherId];
        if (other && !other.spouses.includes(id)) other.spouses.push(id);
      }
      person.spouses = Array.from(nextSpouses);

      // Sync each remaining spouse's current/former status symmetrically too:
      // if either side calls it "former", it's former on both records -- one
      // partner deciding it's over is enough to end it.
      person.spouseStatus = person.spouseStatus || {};
      for (const otherId of prevSpouses) {
        if (!nextSpouses.has(otherId)) delete person.spouseStatus[otherId];
      }
      for (const otherId of nextSpouses) {
        const other = data.people[otherId];
        if (!other) continue;
        other.spouseStatus = other.spouseStatus || {};
        const mine = spouseStatusDraft[otherId] === 'former' ? 'former' : 'current';
        const theirs = other.spouseStatus[id] === 'former' ? 'former' : 'current';
        const final = mine === 'former' || theirs === 'former' ? 'former' : 'current';
        person.spouseStatus[otherId] = final;
        other.spouseStatus[id] = final;
      }

      await saveData();

      // The old photo (if any) is only safe to delete once the record
      // pointing at the new one has actually saved.
      if (originalPhoto && originalPhoto !== person.photo) {
        deletePhotoIfStored(originalPhoto);
      }

      // Finishing the nested "+ Add new spouse" step: the new person is
      // already saved as their own record above. Pick up the original edit
      // where it left off, then ask current-or-former for them too, same as
      // picking an existing person from the list -- they aren't added to
      // the spouse chips until answered.
      if (pendingSpouseSnapshot) {
        const snap = pendingSpouseSnapshot;
        pendingSpouseSnapshot = null;
        renderTree();
        restorePersonForm(snap);
        showSpouseConfirm(name, (status) => {
          spouseStatusDraft[id] = status;
          spousesCombo.setValues([...spousesCombo.getValues(), id]);
        });
        return;
      }

      closeModal();
      renderTree();
      if (isNew) {
        highlightPerson(id);
      } else {
        // Edit is only ever reached from the read-only Person View's Edit
        // button -- saving should hand you back there, not drop you all the
        // way out to the tree.
        openViewModal(id);
      }
    } finally {
      isSavingPerson = false;
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = 'Save';
    }
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
    deletePhotoIfStored(person.photo);
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

  const CARD_MOVE_MS = 380; // must match .person-card's left/top transition duration in style.css

  function renderTree() {
    if (viewMode === 'chronological') renderChronological();
    else renderTraditional();
  }

  // Snapshots each currently-rendered card's position, keyed by person id,
  // before a re-render wipes and rebuilds every .person-card from scratch
  // -- lets animateLayoutIn (below) replay the move as a smooth transition
  // instead of an instant jump, even across a Traditional/Chronological
  // view-mode switch (both build cards via the same buildCard(), keyed by
  // the same dataset.id, so this works seamlessly across either).
  function captureCardPositions() {
    const positions = {};
    els.content.querySelectorAll('.person-card').forEach(card => {
      positions[card.dataset.id] = { left: card.style.left, top: card.style.top };
    });
    return positions;
  }

  // FLIP ("First, Last, Invert, Play"): cardEls have already been built
  // fresh and positioned at their final target left/top for this render.
  // For any id that also existed in oldPositions (i.e. was on screen
  // before this render), jump it back to its old spot with transitions
  // suppressed, force the browser to commit that as the visible frame,
  // then release it back to the real target -- which .person-card's own
  // left/top transition then animates smoothly. A brand-new card (no old
  // position on record) just appears at its target directly, since
  // there's nowhere meaningful to animate it in from.
  function animateLayoutIn(cardEls, oldPositions) {
    const moving = [];
    for (const id of Object.keys(cardEls)) {
      const old = oldPositions[id];
      if (!old || !old.left || !old.top) continue;
      const card = cardEls[id];
      const target = { left: card.style.left, top: card.style.top };
      if (old.left === target.left && old.top === target.top) continue;
      card.style.transition = 'none';
      card.style.left = old.left;
      card.style.top = old.top;
      moving.push({ card, target });
    }
    if (!moving.length) return false;
    // Force layout so the browser actually paints the "old position"
    // frame before releasing to the target -- without this the two style
    // writes would coalesce into one and nothing would visibly animate.
    void els.content.offsetHeight;
    moving.forEach(({ card, target }) => {
      card.style.transition = '';
      card.style.left = target.left;
      card.style.top = target.top;
    });
    return true;
  }

  // Keeps redrawing the connector lines on every frame for the duration
  // of the card-move transition, so lines visually track the cards as
  // they glide instead of snapping straight to their final position while
  // the cards they're attached to are still mid-flight.
  function animateLinesDuring(durationMs, extraStep) {
    const start = performance.now();
    function step(now) {
      drawLines();
      if (extraStep) extraStep();
      if (now - start < durationMs) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function renderTraditional() {
    const oldPositions = captureCardPositions();
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
    // If any card actually moved from where it was before this render,
    // FLIP-animate the move and keep lines tracking it every frame;
    // otherwise (first render, or nothing changed) just draw once.
    if (animateLayoutIn(cardEls, oldPositions)) animateLinesDuring(CARD_MOVE_MS);
    else requestAnimationFrame(drawLines);
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

      const sortedChildren = childRects.slice().sort((a, b) => a.centerX - b.centerX);
      const leftmost = sortedChildren[0];
      const rightmost = sortedChildren[sortedChildren.length - 1];
      // Only true when the trunk lands between the outermost children (the
      // normal case) -- otherwise the bus extends past a child's own X and
      // that "outer" corner is really a T-junction too, not a plain bend.
      const trunkIsInboard = parentAnchorX >= leftmost.centerX && parentAnchorX <= rightmost.centerX;

      if (childRects.length > 2 && trunkIsInboard) {
        // 3+ children sharing one bus: the trunk (and any middle child)
        // meets the bus at a three-way T-junction, not a plain corner --
        // rounding those independently makes neighboring branches' curves
        // visibly overlap right at that shared point, so they stay sharp.
        // Only the two OUTERMOST children sit at a genuine two-segment
        // elbow (bus-then-stub, nothing else meeting there), so only those
        // get rounded.
        svg.appendChild(svgLine(parentAnchorX, parentY, parentAnchorX, busY));
        for (const r of sortedChildren.slice(1, -1)) {
          svg.appendChild(svgLine(r.centerX, busY, r.centerX, r.top));
        }
        // Each outer corner's path runs only to the bus's own midpoint, not
        // all the way to the OTHER outer corner: extending that far would
        // have this path's dead-flat run cut straight through the far
        // corner's own rounding zone, where that corner's curve has
        // already started bending away from busY -- the flat run and the
        // curve would both be visible at once, looking like a small flag
        // poking out past where the curve visibly begins. Meeting in the
        // middle instead means the two paths' flat runs butt up exactly
        // against each other, still reading as one unbroken bus, with each
        // curve's own rounding zone touched by only its own path.
        const busMidX = (leftmost.centerX + rightmost.centerX) / 2;
        svg.appendChild(svgElbowPath([
          { x: busMidX, y: busY },
          { x: leftmost.centerX, y: busY },
          { x: leftmost.centerX, y: leftmost.top },
        ], CONNECTOR_CORNER_RADIUS));
        svg.appendChild(svgElbowPath([
          { x: busMidX, y: busY },
          { x: rightmost.centerX, y: busY },
          { x: rightmost.centerX, y: rightmost.top },
        ], CONNECTOR_CORNER_RADIUS));
      } else if (childRects.length > 2) {
        // Rare layout where the trunk sticks out past every child -- every
        // corner along the bus is a T-junction, so keep all of them sharp.
        svg.appendChild(svgLine(parentAnchorX, parentY, parentAnchorX, busY));
        const minX = Math.min(leftmost.centerX, parentAnchorX);
        const maxX = Math.max(rightmost.centerX, parentAnchorX);
        svg.appendChild(svgLine(minX, busY, maxX, busY));
        for (const r of childRects) {
          svg.appendChild(svgLine(r.centerX, busY, r.centerX, r.top));
        }
      } else {
        // One or two children: the trunk splits cleanly without landing on
        // either branch, so a rounded elbow path per child (trunk down,
        // across the bus, down to the child) reads fine -- every bend gets
        // its own rounded corner. Overlapping trunk/bus segments between
        // the two children's paths draw identically on top of each other,
        // so it still reads as a single shared bus visually.
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
    chronoMinYear = minYear;
    chronoRulerLabels = [];
    for (let y = minYear; y <= maxYear; y += 10) {
      const label = document.createElement('div');
      label.className = 'chrono-year-label';
      label.textContent = String(y);
      els.chronoRulerInner.appendChild(label);
      chronoRulerLabels.push({ el: label, year: y });
    }
    const thisYear = new Date().getFullYear();
    if (thisYear >= minYear && thisYear <= maxYear) {
      const today = document.createElement('div');
      today.className = 'chrono-year-label today';
      today.textContent = 'Today';
      els.chronoRulerInner.appendChild(today);
      chronoRulerLabels.push({ el: today, year: thisYear });
    }
    // Labels are created with no position of their own -- give them their
    // first (scale-aware) placement immediately rather than waiting for
    // the next pan/zoom event to call this.
    repositionChronoRulerLabels();
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
    const oldPositions = captureCardPositions();
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
    // Gridlines/ruler only depend on the (unanimated) year range, so they
    // draw once; if cards actually moved from before this render, lines
    // FLIP-animate and keep tracking them every frame instead.
    requestAnimationFrame(() => {
      drawChronoGridlines(minYear, maxYear, maxRight + MARGIN);
      renderChronoRuler(minYear, maxYear, contentHeight);
      if (animateLayoutIn(cardEls, oldPositions)) animateLinesDuring(CARD_MOVE_MS);
      else drawLines();
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
