// Story Writer - frontend (clean, working vanilla JS)
console.log('[debug] main.js loaded');

// --- API helpers ---
const api = {
  listStories: () => fetch('/api/stories').then(r => r.json()),
  createStory: (name) => fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }).then(r => r.json()),
  getStory: (name) => fetch(`/api/stories/${encodeURIComponent(name)}`).then(r => r.json()),
  saveFile: (name, file, content) => fetch(`/api/stories/${encodeURIComponent(name)}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, content })
  }).then(r => r.json()),
  renameStory: (name, newName) => fetch(`/api/stories/${encodeURIComponent(name)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName })
  }).then(r => r.json()),
  deleteStory: (name) => fetch(`/api/stories/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(r => r.json()),

  // images
  uploadImage: (name, type, file) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type);
    return fetch(`/api/stories/${encodeURIComponent(name)}/images`, { method: 'POST', body: fd }).then(r => r.json());
  },

  // tiles API
  listTiles: (name) => fetch(`/api/stories/${encodeURIComponent(name)}/tiles`).then(r => r.json()),
  createTile: (name, title, content = '') => fetch(`/api/stories/${encodeURIComponent(name)}/tiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content })
  }).then(r => r.json()),
  getTile: (name, id) => fetch(`/api/stories/${encodeURIComponent(name)}/tiles/${encodeURIComponent(id)}`).then(r => r.json()),
  saveTile: (name, id, content) => fetch(`/api/stories/${encodeURIComponent(name)}/tiles/${encodeURIComponent(id)}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ content })
  }).then(r => r.json()),
  deleteTile: (name, id) => fetch(`/api/stories/${encodeURIComponent(name)}/tiles/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => r.json()),
  reorderTiles: (name, order) => fetch(`/api/stories/${encodeURIComponent(name)}/tiles/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order })
  }).then(r => r.json())
};

// --- state ---
const state = {
  currentStory: null,
  storyData: null, // result of GET /api/stories/:name
  // currentView indicates what the editor is showing:
  // { type: 'text'|'highlights', name?: string }
  currentView: { type: 'text', name: null },
  // activeTagFilter holds the currently selected tag used to filter highlight lists (null = no filter)
  activeTagFilter: null
};
// autosave timer handle (debounced saves while typing)
let autosaveTimer = null;

// --- DOM helpers ---
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// --- element refs ---
const storyList = $('#storyList');
const createStoryBtn = $('#createStoryBtn');
const newStoryName = $('#newStoryName');
const currentStoryTitle = $('#currentStoryTitle');
const editor = $('#editor');
const preview = $('#preview');
const saveBtn = $('#saveBtn');
const renameInput = $('#renameInput');
const renameBtn = $('#renameBtn');
const closeStoryBtn = $('#closeStoryBtn');

const tilesSection = $('#tilesSection');
const newTileTitle = $('#newTileTitle');
const createTileBtn = $('#createTileBtn');
const tileList = $('#tileList');

const highlightList = $('#highlightList');
const hlSort = $('#hlSort');
// hide the save button — we autosave on input so the button is now optional
if (saveBtn) saveBtn.style.display = 'none';

const entityModal = $('#entityModal');
const entityModalTitle = $('#entityModalTitle');
const entityContent = $('#entityContent');
const entityImageInput = $('#entityImageInput');
const saveEntityBtn = $('#saveEntityBtn');
const closeEntityBtn = $('#closeEntityBtn');

function setEditorEnabled(enabled) {
  // enable/disable the main editor and adjust preview/save controls
  try {
    if (!editor) return;
    // Use both disabled and readOnly to ensure the editor cannot be edited when disabled.
    // disabled prevents focus/interaction; readOnly ensures no accidental edits if styling changes.
    editor.disabled = !enabled;
    editor.readOnly = !enabled;
    if (enabled) {
      editor.classList.remove('disabled');
      editor.classList.remove('readonly');
      editor.placeholder = editor.placeholder && editor.placeholder === 'No story opened' ? 'Write your story here...' : editor.placeholder;
    } else {
      editor.classList.add('disabled');
      editor.classList.add('readonly');
      editor.placeholder = 'No story opened';
      // clear preview when disabled
      if (preview) preview.innerHTML = '';
    }
    if (saveBtn) saveBtn.disabled = !enabled;
  } catch (e) {
    console.warn('setEditorEnabled error', e);
  }
}

// custom context menu element ref
let customContextEl = null;

// tooltip element
let tooltipEl = null;

// currently editing entity info
let currentEditing = { type: null, name: null };
let lastEditorSelection = null; // saved when user opens editor context menu
let uploadContext = null; // { mode: 'editor'|'entity', type: 'text'|'highlights', name?, start?, end? }

/* global hidden file input handler (used by right-click upload actions) */
const globalFileInput = document.getElementById('globalHiddenFileInput');
if (globalFileInput) {
  globalFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !uploadContext) return;
    const ctx = uploadContext;
    uploadContext = null;
    globalFileInput.value = '';
    if (!state.currentStory) return alert('Open a story first');
    try {
      const type = ctx.type || 'text';
      const res = await api.uploadImage(state.currentStory, type, file);
      if (!res || !res.ok) return alert(res && res.error ? res.error : 'Upload failed');
      const url = res.url;
      if (ctx.mode === 'editor') {
        // insert markdown image at saved selection
        const s = (typeof ctx.start === 'number') ? ctx.start : editor.selectionStart;
        const epos = (typeof ctx.end === 'number') ? ctx.end : editor.selectionEnd;
        const before = editor.value.slice(0, s);
        const after = editor.value.slice(epos);
        const md = `![${file.name}](${url})`;
        editor.value = before + md + after;
        renderPreview();
        // save immediately after inserting the image so the change persists
        try {
          await saveMainText();
        } catch (err) {
          console.warn('autosave after image insert failed', err);
        }
      } else if (ctx.mode === 'entity') {
        // append image markdown to section (highlights.md)
        const filename = 'highlights.md';
        const raw = state.storyData && state.storyData.highlights ? state.storyData.highlights : '';
        const sections = parseEntitySections(raw);
        const entry = sections[ctx.name] || { title: ctx.name, desc: '' };
        entry.desc = (entry.desc ? entry.desc + '\n\n' : '') + `![${file.name}](${url})`;
        sections[ctx.name] = entry;
        const newContent = Object.values(sections).map(s => composeSection(s.title, s.desc)).join('\n\n');
        const saveRes = await api.saveFile(state.currentStory, filename, newContent);
        if (!saveRes || !saveRes.ok) return alert(saveRes && saveRes.error ? saveRes.error : 'Save failed');
        const updated = await api.getStory(state.currentStory);
        if (updated && updated.ok) state.storyData = updated;
        renderPreview();
      }
    } catch (err) {
      console.error('upload handler error', err);
      alert('Upload failed');
    }
  });
}

// --- utilities ---
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* --- tag rendering helpers ---
   Generate a deterministic pastel background color and a darker text color
   based on the tag string so each tag gets the same color every time. */
function hashStringToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function tagStyleFor(tag) {
  const hue = hashStringToInt(tag) % 360;
  const bg = `hsl(${hue}, 60%, 85%)`;   // pastel background
  const color = `hsl(${hue}, 55%, 28%)`; // darker same-hue text
  return { background: bg, color };
}

/* Extract tags from text (global utility) — returns unique tag strings without the leading '#' */
function extractTagsFromText(t) {
  if (!t || typeof t !== 'string') return [];
  const re = /#([A-Za-z0-9_-]+)/g;
  const set = new Set();
  let m;
  while ((m = re.exec(t)) !== null) {
    set.add(m[1]);
  }
  return Array.from(set);
}

/* Render occurrences of #tag inside the given root element (preview).
   Uses walkTextNodes to avoid replacing inside code, links, headings, etc. */
function renderTags(root) {
  walkTextNodes(root, (textNode) => {
    const parent = textNode.parentNode;
    const txt = textNode.nodeValue;
    if (!txt || !txt.trim()) return;

    const re = /#([A-Za-z0-9_-]+)/g;
    let m;
    const matches = [];
    while ((m = re.exec(txt)) !== null) {
      matches.push({ index: m.index, text: m[0], tag: m[1], length: m[0].length });
    }
    if (matches.length === 0) return;

    // filter overlaps (keep earliest non-overlapping matches)
    matches.sort((a, b) => a.index - b.index || b.length - a.length);
    const filtered = [];
    let lastEnd = -1;
    for (const mt of matches) {
      if (mt.index >= lastEnd) {
        filtered.push(mt);
        lastEnd = mt.index + mt.length;
      }
    }

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const mt of filtered) {
      if (mt.index > cursor) {
        frag.appendChild(document.createTextNode(txt.slice(cursor, mt.index)));
      }
      const span = document.createElement('span');
      span.className = 'tag';
      span.dataset.tag = mt.tag;
      span.textContent = mt.tag;
      const st = tagStyleFor(mt.tag);
      span.style.background = st.background;
      span.style.color = st.color;
      frag.appendChild(span);
      cursor = mt.index + mt.length;
    }
    if (cursor < txt.length) frag.appendChild(document.createTextNode(txt.slice(cursor)));
    parent.replaceChild(frag, textNode);
  });
}

// parse entities markdown into map Name -> {title, desc}
// expects sections like "## Name\n\nDescription..."
function parseEntitySections(raw) {
  if (!raw || !raw.trim()) return {};
  // split on headings starting with "## " — preserve section raw content and description whitespace
  const parts = raw.split(/\n(?=##\s+)/g).filter(Boolean);
  const map = {};
  for (const p of parts) {
    const lines = p.split('\n');
    if (lines.length === 0) continue;
    const title = lines[0].replace(/^#{1,6}\s*/, '').trim();
    // preserve the description exactly as written (keep blank lines and trailing newlines)
    const desc = lines.slice(1).join('\n');
    if (title) map[title] = { title, desc, raw: p };
  }
  return map;
}

function composeSection(title, desc) {
  // preserve trailing newlines/whitespace in the section body
  return `## ${title}\n\n${desc || ''}`;
}

/*
  parseEntitySectionsArray(raw) -> preserves order and returns an array of section objects:
  [{ title, desc, raw }]
  This is safer for merging edits because it preserves other sections and their order.
*/
function parseEntitySectionsArray(raw) {
  if (!raw || !raw.trim()) return [];
  const parts = raw.split(/\n(?=##\s+)/g).filter(Boolean);
  const arr = [];
  for (const p of parts) {
    const lines = p.split('\n');
    if (lines.length === 0) continue;
    const titleLine = lines[0];
    const title = titleLine.replace(/^#{1,6}\s*/, '').trim();
    const desc = lines.slice(1).join('\n');
    if (title) arr.push({ title, desc, raw: p });
  }
  return arr;
}

/* Minimal fallback markdown -> HTML renderer used when marked is unavailable or fails.
   Supports headings (#), bold/italic, images, inline code, and simple lists and paragraphs — enough for live preview. */
function simpleMarkdownToHtml(md) {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  let html = '';
  let inList = false;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');
  }

  for (let line of lines) {
    const raw = line;
    line = escapeHtml(line);

    // headings
    // strip possible BOM/zero-width characters that sometimes sneak into files,
    // then match 1-6 leading '#' followed by at least one space and the heading text.
    const cleaned = raw.replace(/^[\uFEFF\u200B]+/, '');
    const h = cleaned.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      // debug log to help diagnose malformed heading inputs (will show exact raw line)
      try { console.log('[debug] simpleMarkdownToHtml: heading match ->', JSON.stringify(cleaned), 'level=', h[1].length, 'text=', JSON.stringify(h[2])); } catch (e) {}
      if (inList) { html += '</ul>'; inList = false; }
      const level = h[1].length;
      // sanitize heading text: if the captured heading text still starts with stray hashes or spaces
      // (for example due to accidental normalization earlier producing "# # test"), remove those.
      const headingText = (h[2] || '').replace(/^[#\s]+/, '');
      html += `<h${level}>${escapeHtml(headingText)}</h${level}>`;
      continue;
    }

    // list items
    const li = raw.match(/^\s*[-*]\s+(.*)/);
    if (li) {
      if (!inList) { html += '<ul>'; inList = true; }
      let content = escapeHtml(li[1]);

      // process inline elements inside list item
      content = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`;
      });
      content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
      content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      content = content.replace(/\*(.+?)\*/g, '<em>$1</em>');

      html += `<li>${content}</li>`;
      continue;
    } else {
      if (inList) { html += '</ul>'; inList = false }
    }

    // images on their own line or inline
    // inline image syntax: ![alt](url)
    let content = escapeHtml(raw)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`;
      });

    // inline code, bold, italic
    content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
    content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    content = content.replace(/\*(.+?)\*/g, '<em>$1</em>');

    if (content.trim() === '') {
      // blank line — keep as separator
      html += '';
    } else {
      html += `<p>${content}</p>`;
    }
  }

  if (inList) html += '</ul>';
  return html;
}

function countOccurrences(text, name) {
  // guard: name required
  if (!name) return 0;
  // coerce non-strings to safe string values (defensive: avoids .match TypeError)
  if (typeof text !== 'string') text = String(text || '');
  if (!text) return 0;
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi');
  const m = text.match(re);
  return m ? m.length : 0;
}

// --- Story listing and CRUD UI ---
async function refreshStories() {
  const res = await api.listStories();
  if (!res || !res.ok) return;
 storyList.innerHTML = '';
  for (const s of res.stories) {
    const li = document.createElement('li');
    li.className = 'story-item';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = s;
    nameSpan.dataset.name = s;
    // apply explicit classes so styling is consistent and easy to override
    if (state.currentStory) {
      if (state.currentStory !== s) {
        nameSpan.classList.add('story-item--muted');
        nameSpan.classList.remove('story-item--active');
      } else {
        nameSpan.classList.add('story-item--active');
        nameSpan.classList.remove('story-item--muted');
      }
    } else {
      // no story open: ensure all items are in the default state
      nameSpan.classList.remove('story-item--muted');
      nameSpan.classList.remove('story-item--active');
    }
    nameSpan.addEventListener('click', () => openStory(s));
    li.appendChild(nameSpan);

    // delete button (asks for confirmation before deleting the story folder)
    const del = document.createElement('button');
    del.className = 'story-delete';
    del.textContent = 'Delete';
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm(`Delete story "${s}" and all its files/images? This cannot be undone.`)) return;
      try {
        const rr = await api.deleteStory(s);
        if (!rr || !rr.ok) return alert(rr && rr.error ? rr.error : 'Delete failed');
        // if the deleted story is currently open, close it
        if (state.currentStory === s) {
          state.currentStory = null;
          state.storyData = null;
          currentStoryTitle.textContent = 'No story opened';
          editor.value = '';
          preview.innerHTML = '';
          if (highlightList) highlightList.innerHTML = '';
          setEditorEnabled(false);
        }
        await refreshStories();
      } catch (err) {
        console.error('delete story failed', err);
        alert('Delete failed');
      }
    });
    li.appendChild(del);

    storyList.appendChild(li);
  }
}

createStoryBtn.addEventListener('click', async () => {
  const name = (newStoryName.value || '').trim();
  if (!name) return alert('Enter a story name');
  const res = await api.createStory(name);
  if (!res || !res.ok) return alert(res && res.error ? res.error : 'Create failed');
  newStoryName.value = '';
  await refreshStories();
  openStory(res.name);
});

/* Single-click on the story title shows the concatenated, read-only content of all tiles.
   Double-click enters inline rename mode (preserves the previous behavior). */
currentStoryTitle.addEventListener('click', async () => {
  if (!state.currentStory) return;
  // fetch tiles in order and render concatenated markdown in the preview (read-only)
  try {
    // ensure tiles area visible and up to date
    if (tilesSection) tilesSection.style.display = 'block';
    const listRes = await api.listTiles(state.currentStory);
    if (!listRes || !listRes.ok) {
      console.warn('listTiles failed', listRes && listRes.error);
      return;
    }
    const tiles = listRes.tiles || [];
    let combined = '';
    for (const t of tiles) {
      try {
        const tileRes = await api.getTile(state.currentStory, t.id);
        if (tileRes && tileRes.ok) combined += (tileRes.content || '') + '\n\n';
      } catch (e) {
        console.warn('failed to load tile', t.id, e);
      }
    }
    // render into preview and disable the editor (read-only mode)
    const html = (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function')
      ? (marked.parse(combined || ''))
      : simpleMarkdownToHtml(combined || '');
    // make the editor read-only (preserve the rendered preview)
    setEditorEnabled(false);
    preview.innerHTML = html || '<div class="empty-preview">[no tiles]</div>';
    state.currentView = { type: 'full' };
  } catch (e) {
    console.error('show full tiles failed', e);
  }
});

// double-click to rename (preserves previous rename UX)
currentStoryTitle.addEventListener('dblclick', () => {
  if (!state.currentStory) return;
  currentStoryTitle.contentEditable = 'true';
  currentStoryTitle.focus();
});

currentStoryTitle.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') { e.preventDefault(); currentStoryTitle.blur(); }
  else if (e.key === 'Escape') {
    currentStoryTitle.contentEditable = 'false';
    if (state.currentStory) currentStoryTitle.textContent = state.currentStory;
  }
});
currentStoryTitle.addEventListener('blur', async () => {
  if (!currentStoryTitle.isContentEditable) return;
  currentStoryTitle.contentEditable = 'false';
  const newName = (currentStoryTitle.textContent || '').trim();
  if (!newName || newName === state.currentStory) {
    currentStoryTitle.textContent = state.currentStory || 'No story opened';
    return;
  }
  const res = await api.renameStory(state.currentStory, newName);
  if (!res || !res.ok) {
    alert(res && res.error ? res.error : 'Rename failed');
    currentStoryTitle.textContent = state.currentStory;
    return;
  }
  await refreshStories();
  openStory(res.name);
});

closeStoryBtn.addEventListener('click', () => {
  state.currentStory = null;
  state.storyData = null;
  currentStoryTitle.textContent = 'No story opened';
  editor.value = '';
  if (highlightList) highlightList.innerHTML = '';
  // hide tiles area
  if (tilesSection) tilesSection.style.display = 'none';
  // disable editor area when no story is open
  setEditorEnabled(false);
  // refresh the stories list so the left menu updates (non-open stories appear grey)
  refreshStories();
});

// --- Open / Save story ---
async function openStory(name) {
  const res = await api.getStory(name);
  if (!res || !res.ok) {
    alert(res && res.error ? res.error : 'Failed to open story');
    return;
  }
  state.currentStory = name;
  state.storyData = res;
  // reset view to main story text when opening a story
  state.currentView = { type: 'text', name: null };
  currentStoryTitle.textContent = name;
  // enable editor area now that a story is open
  setEditorEnabled(true);
  editor.value = res.text || '';
  renderPreview();
  refreshEntityLists();
  // update sidebar to reflect the currently open story
  refreshStories();
  // show tiles area and load tiles
  if (tilesSection) tilesSection.style.display = 'block';
  try { await refreshTiles(); } catch (e) { console.warn('refreshTiles failed', e); }
}

saveBtn.addEventListener('click', saveMainText);

async function saveMainText() {
  if (!state.currentStory) return;
  // determine which file we're saving to
  const view = state.currentView && state.currentView.type ? state.currentView.type : 'text';

  // saving a tile
  if (view === 'tile') {
    const id = state.currentView && state.currentView.id;
    if (!id) return console.warn('saveMainText: no tile id');
    const content = editor.value;
    const res = await api.saveTile(state.currentStory, id, content);
    if (!res || !res.ok) {
      console.warn('saveMainText: failed to save tile', res && res.error);
      return;
    }
    // refresh tiles metadata and counts
    try {
      const updated = await api.getStory(state.currentStory);
      if (updated && updated.ok) state.storyData = updated;
    } catch (e) {}
    await refreshTiles();
    console.log('Saved tile', id);
    return;
  }

  if (view === 'text') {
    // saving main story text (replace entire text.md)
    const content = editor.value;
    const res = await api.saveFile(state.currentStory, 'text.md', content);
    if (!res || !res.ok) {
      console.warn('saveMainText: failed to save text.md', res && res.error);
      return;
    }
    const updated = await api.getStory(state.currentStory);
    if (updated && updated.ok) state.storyData = updated;
    refreshEntityLists();
    console.log('Saved text.md');
    return;
  }

  // saving an entity (highlights.md) — merge edited section into the existing file (preserving other sections)
  const filename = 'highlights.md';
  const raw = (state.storyData && state.storyData.highlights) ? state.storyData.highlights : '';
  const arr = parseEntitySectionsArray(raw);

  // parse the editor content which should be in the form "## Name\n\nDescription..."
  // IMPORTANT: do not trim the full editor content — preserve trailing newlines and cursor position.
  const editedRaw = (editor.value || '');
  const lines = editedRaw.split(/\r?\n/);
  let editedTitle = state.currentView && state.currentView.name ? state.currentView.name : null;
  let editedDesc = '';

  if (lines.length > 0 && lines[0].match(/^#{1,6}\s+/)) {
    // title: trim only the heading text, but keep the description verbatim (no .trim())
    editedTitle = lines[0].replace(/^#{1,6}\s+/, '').trim();
    editedDesc = lines.slice(1).join('\n');
  } else {
    // no explicit heading — treat entire content as description (preserve whitespace)
    editedDesc = editedRaw;
  }

  if (!editedTitle) {
    console.warn('saveMainText: cannot determine entity title; aborting save');
    return;
  }

  // Avoid unnecessary saves that reset content/cursor:
  // Compare the current in-editor description with the one stored on disk for this entity.
  // If identical (including trailing newlines), skip saving entirely.
  try {
    const storedMap = parseEntitySections(raw);
    const storedEntry = storedMap[editedTitle];
    const storedDesc = storedEntry ? storedEntry.desc : '';
    if (storedDesc === editedDesc) {
      // nothing changed — skip network call and avoid touching editor/state
      console.debug('[debug] saveMainText: no changes detected for', editedTitle, '- skipping save');
      return;
    }
  } catch (e) {
    console.warn('saveMainText: compare failed, proceeding to save', e);
  }

  // find index by original name (supports renames), otherwise by title, otherwise append
  let idx = -1;
  if (state.currentView && state.currentView.name) {
    idx = arr.findIndex(s => s.title === state.currentView.name);
  }
  if (idx === -1) {
    idx = arr.findIndex(s => s.title === editedTitle);
  }
  if (idx === -1) {
    // append new section
    arr.push({ title: editedTitle, desc: editedDesc });
  } else {
    // replace existing section
    arr[idx] = { title: editedTitle, desc: editedDesc };
  }

  // ensure unique titles (if a rename collided with another section, merge by keeping the edited one and removing duplicates)
  const seen = new Set();
  const merged = [];
  for (const s of arr) {
    if (seen.has(s.title)) continue;
    seen.add(s.title);
    merged.push(s);
  }

  const newContent = merged.map(s => composeSection(s.title, s.desc)).join('\n\n');
  const res = await api.saveFile(state.currentStory, filename, newContent);
  if (!res || !res.ok) {
    console.warn('saveMainText: failed to save', filename, res && res.error);
    return;
  }

  // refresh story data but do NOT overwrite the editor value or reset the cursor.
  // Preserve state.currentView if possible; update storyData so counts/tooltips refresh.
  const updated = await api.getStory(state.currentStory);
  if (updated && updated.ok) {
    state.storyData = updated;
  }
  refreshEntityLists();
  console.log('Saved', filename, 'without disturbing the editor for', editedTitle);
}

function scheduleAutoSave(delay = 500) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { saveMainText(); } catch (e) { console.warn('autosave failed', e); }
  }, delay);
}

// Ctrl/Cmd+S
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveMainText();
  }
});

/* Image upload via sidebar has been replaced by right-click upload (globalHiddenFileInput). */

 // --- Entities lists and counts ---
 function refreshEntityLists(mainTextOverride) {
   // If someone accidentally passed a non-string (e.g. Event) as the handler arg, ignore it.
   if (mainTextOverride && typeof mainTextOverride !== 'string') mainTextOverride = undefined;
   // If no story is opened and no override provided, nothing to do.
   if (!state.storyData && typeof mainTextOverride === 'undefined') return;
   // Determine the main text to count occurrences in:
   // - If caller provided an override (e.g. while typing in main text), use it.
   // - Otherwise use the stored story main text from state.storyData.
   const mainText = (typeof mainTextOverride !== 'undefined') ? mainTextOverride : ((state.storyData && state.storyData.text) ? state.storyData.text : '');
   const hls = parseEntitySections(state.storyData && state.storyData.highlights ? state.storyData.highlights : '');
   const text = mainText || '';

  const hlArr = Object.keys(hls).map(n => ({ name: n, count: countOccurrences(text, n) }));

  // extract tags from a block of markdown/text — returns unique tags without the leading '#'
  function extractTagsFromText(t) {
    if (!t || typeof t !== 'string') return [];
    const re = /#([A-Za-z0-9_-]+)/g;
    const set = new Set();
    let m;
    while ((m = re.exec(t)) !== null) {
      set.add(m[1]);
    }
    return Array.from(set);
  }

  // ensure a small story-level tags container exists next to the story title
  function ensureStoryTagsContainer() {
    let el = document.getElementById('storyTags');
    if (!el && currentStoryTitle && currentStoryTitle.parentNode) {
      el = document.createElement('div');
      el.id = 'storyTags';
      el.style.display = 'inline-block';
      el.style.marginLeft = '12px';
      el.style.verticalAlign = 'middle';
      currentStoryTitle.parentNode.insertBefore(el, currentStoryTitle.nextSibling);
    }
    return el;
  }

  // ensure a visible filter indicator exists above the highlights list so the user
  // can clearly see which tag is active and click the 'x' to clear the filter.
  function ensureFilterIndicator() {
    let el = document.getElementById('tagFilterIndicator');
    if (!el && highlightList && highlightList.parentNode) {
      el = document.createElement('div');
      el.id = 'tagFilterIndicator';
      el.style.margin = '6px 0';
      el.style.fontSize = '13px';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.gap = '8px';
      // place it directly above the highlight list
      highlightList.parentNode.insertBefore(el, highlightList);
    }
    return el;
  }

  function renderList(arr, container, type, sortMode) {
    if (sortMode === 'alpha') arr.sort((a, b) => a.name.localeCompare(b.name));
    else arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    container.innerHTML = '';

    // for story-level tags, extract from the main story text (not from highlights)
    const storyTagsArr = extractTagsFromText(mainText);

    // If a tag filter is active, only show highlights that include that tag
    const filteredArr = state.activeTagFilter
      ? arr.filter(item => {
        const desc = (hls && hls[item.name] && typeof hls[item.name].desc === 'string') ? hls[item.name].desc : '';
        const tags = extractTagsFromText(desc);
        return tags.includes(state.activeTagFilter);
      })
      : arr;

    for (const item of filteredArr) {
      const li = document.createElement('li');

      // name and count
      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.name;
      nameSpan.style.fontWeight = '500';
      nameSpan.style.marginRight = '8px';

      const countSpan = document.createElement('span');
      countSpan.className = 'small';
      countSpan.textContent = `(${item.count})`;
      countSpan.style.marginRight = '8px';

      li.appendChild(nameSpan);
      li.appendChild(countSpan);

      // find tags inside the highlight description (if available in hls map)
      const desc = (hls && hls[item.name] && typeof hls[item.name].desc === 'string') ? hls[item.name].desc : '';
      const tags = extractTagsFromText(desc);
      for (const tag of tags) {
        const tspan = document.createElement('span');
        tspan.className = 'tag';
        tspan.dataset.tag = tag;
        tspan.textContent = tag;
        const st = (typeof tagStyleFor === 'function') ? tagStyleFor(tag) : null;
        if (st) {
          tspan.style.background = st.background;
          tspan.style.color = st.color;
        }
        tspan.style.marginLeft = '6px';
        // clicking a tag toggles the active filter; stopPropagation so the li click doesn't fire
        tspan.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (state.activeTagFilter === tag) state.activeTagFilter = null;
          else state.activeTagFilter = tag;
          // re-render lists using the new filter
          refreshEntityLists(mainText);
        });
        // visually mark selected tag
        if (state.activeTagFilter === tag) tspan.classList.add('selected');
        li.appendChild(tspan);
      }

      // click behavior: open the entity in the main editor
      li.addEventListener('click', () => openEntityInEditor(type, item.name));
      container.appendChild(li);
    }

    // render story-level tags next to the story title (derived from main story text)
    const storyTagsEl = ensureStoryTagsContainer();
    if (storyTagsEl) {
      storyTagsEl.innerHTML = '';
      // stable sorted order
      const storyTags = Array.from(new Set(storyTagsArr)).sort();
      for (const tag of storyTags) {
        const tspan = document.createElement('span');
        tspan.className = 'tag';
        tspan.dataset.tag = tag;
        tspan.textContent = tag;
        const st = (typeof tagStyleFor === 'function') ? tagStyleFor(tag) : null;
        if (st) {
          tspan.style.background = st.background;
          tspan.style.color = st.color;
        }
        tspan.style.marginLeft = '6px';
        tspan.style.marginBottom = '0';
        // clicking story tag also toggles the filter
        tspan.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (state.activeTagFilter === tag) state.activeTagFilter = null;
          else state.activeTagFilter = tag;
          refreshEntityLists(mainText);
        });
        if (state.activeTagFilter === tag) tspan.classList.add('selected');
        storyTagsEl.appendChild(tspan);
      }
    }

    // update/render a clearable filter indicator above the highlights list so the user
    // can immediately see which tag is active and clear it with one click.
    const filterIndicator = ensureFilterIndicator();
    if (filterIndicator) {
      filterIndicator.innerHTML = '';
      if (state.activeTagFilter) {
        const label = document.createElement('div');
        label.style.display = 'inline-flex';
        label.style.alignItems = 'center';
        label.style.gap = '8px';

        const tag = state.activeTagFilter;
        const tagEl = document.createElement('span');
        tagEl.className = 'tag selected';
        tagEl.textContent = tag;
        const st = (typeof tagStyleFor === 'function') ? tagStyleFor(tag) : null;
        if (st) {
          tagEl.style.background = st.background;
          tagEl.style.color = st.color;
        }

        const clearBtn = document.createElement('button');
        clearBtn.textContent = '×';
        clearBtn.title = 'Clear tag filter';
        clearBtn.style.border = 'none';
        clearBtn.style.background = 'transparent';
        clearBtn.style.cursor = 'pointer';
        clearBtn.style.fontSize = '16px';
        clearBtn.style.lineHeight = '1';
        clearBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          state.activeTagFilter = null;
          refreshEntityLists(mainText);
        });

        const text = document.createElement('span');
        text.textContent = 'Filtering by tag:';
        text.className = 'small';
        label.appendChild(text);
        label.appendChild(tagEl);
        label.appendChild(clearBtn);
        filterIndicator.appendChild(label);
      } else {
        // empty indicator when no filter
        filterIndicator.innerHTML = '';
      }
    }
  }

  // render highlights
  if (highlightList) renderList(hlArr, highlightList, 'highlights', hlSort && hlSort.value ? hlSort.value : 'alpha');

  // re-render preview to refresh highlights
  renderPreview();
}

 // sort change handlers
 if (hlSort) hlSort.addEventListener('change', () => refreshEntityLists());

/* --- Tiles UI & handlers --- */
async function refreshTiles() {
  if (!state.currentStory) return;
  if (!tileList) return;
  try {
    const res = await api.listTiles(state.currentStory);
    if (!res || !res.ok) return;
    const tiles = res.tiles || [];
    tileList.innerHTML = '';
    for (const t of tiles) {
      const li = document.createElement('li');
      li.className = 'tile-item';
      li.dataset.id = t.id;
      li.draggable = true;
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.justifyContent = 'space-between';
      li.style.gap = '8px';
      li.style.padding = '6px';
      li.style.borderRadius = '4px';
      li.style.cursor = 'grab';

      const titleSpan = document.createElement('span');
      titleSpan.textContent = t.title || '(untitled)';
      titleSpan.style.flex = '1';
      titleSpan.style.minWidth = '0';
      titleSpan.addEventListener('click', async () => {
        // open tile in editor
        const got = await api.getTile(state.currentStory, t.id);
        if (!got || !got.ok) return alert(got && got.error ? got.error : 'Failed to load tile');
        state.currentView = { type: 'tile', id: t.id };
        editor.value = got.content || '';
        // update header to show "story - tile title"
        try { currentStoryTitle.textContent = `${state.currentStory} - ${t.title || '(untitled)'}`; } catch (e) {}
        setEditorEnabled(true);
        renderPreview();
      });

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';
      actions.style.alignItems = 'center';

      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'Rename';
      renameBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const newTitle = prompt('New tile title', t.title || '');
        if (newTitle === null) return;
        // update tiles order with new title
        const cur = (await api.listTiles(state.currentStory)).tiles || [];
        const updated = cur.map(x => x.id === t.id ? { id: x.id, title: newTitle } : x);
        const rr = await api.reorderTiles(state.currentStory, updated);
        if (!rr || !rr.ok) return alert(rr && rr.error ? rr.error : 'Rename failed');
        await refreshTiles();
      });
      actions.appendChild(renameBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm(`Delete tile "${t.title || t.id}"? This cannot be undone.`)) return;
        const rr = await api.deleteTile(state.currentStory, t.id);
        if (!rr || !rr.ok) return alert(rr && rr.error ? rr.error : 'Delete failed');
        // if currently editing this tile, close editor
        if (state.currentView && state.currentView.type === 'tile' && state.currentView.id === t.id) {
          state.currentView = { type: 'text', name: null };
          editor.value = state.storyData && state.storyData.text ? state.storyData.text : '';
          // restore header to just the story name
          try { currentStoryTitle.textContent = state.currentStory || 'No story opened'; } catch (e) {}
          renderPreview();
        }
        await refreshTiles();
      });
      actions.appendChild(delBtn);

      li.appendChild(titleSpan);
      li.appendChild(actions);

      // drag handlers with visual insertion indicators
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
        li.style.opacity = '0.5';
        // mark dragged item
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', (e) => {
        li.style.opacity = '1';
        li.classList.remove('dragging');
        // clear any leftover drop indicators
        Array.from(tileList.children).forEach(n => {
          n.classList.remove('drop-before', 'drop-after');
        });
      });

      li.addEventListener('dragenter', (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId) return;
        if (draggedId === t.id) return;
        // decide before/after based on mouse position
        const rect = li.getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (y < rect.height / 2) {
          li.classList.add('drop-before');
          li.classList.remove('drop-after');
        } else {
          li.classList.add('drop-after');
          li.classList.remove('drop-before');
        }
      });

      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });

      li.addEventListener('dragleave', (e) => {
        // remove visual indicators when leaving
        li.classList.remove('drop-before', 'drop-after');
      });

      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId) return;
        // find dragged and target elements
        const draggedEl = Array.from(tileList.children).find(n => n.dataset.id === draggedId);
        const targetEl = e.currentTarget;
        if (!draggedEl || !targetEl || draggedEl === targetEl) {
          // cleanup and exit
 Array.from(tileList.children).forEach(n => n.classList.remove('drop-before', 'drop-after'));
          return;
        }
        // insert based on indicator
        if (targetEl.classList.contains('drop-before')) {
          tileList.insertBefore(draggedEl, targetEl);
        } else {
          tileList.insertBefore(draggedEl, targetEl.nextSibling);
        }
        // clear indicators
        Array.from(tileList.children).forEach(n => n.classList.remove('drop-before', 'drop-after'));
        // build new order
        const newOrder = Array.from(tileList.children).map(node => {
          const id = node.dataset.id;
          const span = node.querySelector('span');
          const title = span ? span.textContent : '';
          return { id, title };
        });
        const rr = await api.reorderTiles(state.currentStory, newOrder);
        if (!rr || !rr.ok) return alert(rr && rr.error ? rr.error : 'Reorder failed');
        await refreshTiles();
        // if the user is viewing the full concatenated tiles, refresh that rendered view now
        if (state.currentView && state.currentView.type === 'full') {
          try {
            const listRes2 = await api.listTiles(state.currentStory);
            if (listRes2 && listRes2.ok) {
              const tiles2 = listRes2.tiles || [];
              let combined2 = '';
              for (const tt of tiles2) {
                try {
                  const tileRes2 = await api.getTile(state.currentStory, tt.id);
                  if (tileRes2 && tileRes2.ok) combined2 += (tileRes2.content || '') + '\n\n';
                } catch (err) {
                  console.warn('failed to load tile during full refresh', tt.id, err);
                }
              }
              const html2 = (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function')
                ? marked.parse(combined2 || '')
                : simpleMarkdownToHtml(combined2 || '');
              // preserve read-only state
              setEditorEnabled(false);
              preview.innerHTML = html2 || '<div class="empty-preview">[no tiles]</div>';
            }
          } catch (e) {
            console.warn('refresh full tiles view failed', e);
          }
        }
      });

      tileList.appendChild(li);
    }
  } catch (e) {
    console.error('refreshTiles error', e);
  }
}

// create tile handler
if (createTileBtn) {
  createTileBtn.addEventListener('click', async () => {
    if (!state.currentStory) return alert('Open a story first');
    const title = (newTileTitle && newTileTitle.value) ? newTileTitle.value.trim() : '';
    const res = await api.createTile(state.currentStory, title, '');
    if (!res || !res.ok) return alert(res && res.error ? res.error : 'Create tile failed');
    if (newTileTitle) newTileTitle.value = '';
    await refreshTiles();
    // open newly created tile
    const got = await api.getTile(state.currentStory, res.id);
    if (got && got.ok) {
      state.currentView = { type: 'tile', id: res.id };
      editor.value = got.content || '';
      // update header to show "story - tile title      try { currentStoryTitle.textContent = `${state.currentStory} - ${res.tile && res.tile.title ? res.tile.title : '(untitled)'}`; } catch (e) {}
      setEditorEnabled(true);
      renderPreview();
    }
  });
}

/* Improved preview rendering: render markdown then wrap ALL entity occurrences (multi-match, multi-word, longest-first).
   NOTE: renderPreview now renders markdown even when no story is opened so the right pane always shows live preview. */
function renderPreview() {
  try {
    const md = editor.value || '';
    console.log('[debug] renderPreview invoked, md length=', md.length);
    // log whether marked is present so we can diagnose why headings are not being converted
    try { console.log('[debug] typeof marked =', typeof marked); } catch (e) { console.warn('cannot log marked type', e); }
    // Use marked when available; otherwise fall back to the simple renderer.
    // If marked isn't present, attempt to load it dynamically once and retry rendering.
    let html = '';
    if (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function') {
      try {
        html = marked.parse(md || '');
      } catch (err) {
        console.warn('marked.parse failed, falling back to simple renderer', err);
        html = simpleMarkdownToHtml(md || '');
      }
    } else {
      // Try to load marked dynamically (only once). When it finishes loading we'll re-run renderPreview.
      if (!window._markedLoading && !window._markedTriedToLoad) {
        window._markedLoading = true;
        window._markedTriedToLoad = true;
        console.log('[debug] marked not found — injecting script to load marked from CDN');
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/marked@4.4.12/marked.min.js';
        s.async = true;
        s.onload = () => {
          window._markedLoading = false;
          console.log('[debug] marked loaded dynamically; re-rendering preview');
          try { renderPreview(); } catch (e) { console.warn('re-render after marked load failed', e); }
        };
        s.onerror = () => {
          window._markedLoading = false;
          console.warn('Failed to load marked from CDN; continuing with fallback renderer');
        };
        document.head.appendChild(s);
      } else {
        console.warn('marked not available, using simpleMarkdownToHtml fallback');
      }
      html = simpleMarkdownToHtml(md || '');
    }
    // debug: log the actual HTML we will inject so we can inspect why headings appear as literal text
    try {
      console.log('[debug] rendered HTML preview (first 1000 chars):', (html || '').slice(0, 1000));
    } catch (e) {
      console.warn('Could not log rendered HTML', e);
    }
    // try to set the rendered HTML. If for some reason it doesn't render (zero child nodes),
    // fall back to showing the raw HTML as text so we can see what's produced.
    preview.innerHTML = html || '<div class="empty-preview">[preview empty]</div>';
    // if no nodes got inserted (some browsers / HTML combinations could cause empty rendering),
    // show raw HTML so user can debug, and add a small debug attribute.
    if (!preview.childNodes || preview.childNodes.length === 0) {
      preview.textContent = html || '[no output]';
      preview.setAttribute('data-render-debug', 'raw-text-fallback');
    } else {
      preview.removeAttribute('data-render-debug');
    }
    console.log('[debug] preview rendered, html length=', (html || '').length, 'childNodes=', preview.childNodes.length, 'data-render-debug=', preview.getAttribute('data-render-debug'));

    // derive entities from state if available, otherwise empty lists
    const entityMap = parseEntitySections((state.storyData && state.storyData.highlights) || '');
    const hls = Object.keys(entityMap);

    // build combined list (highlights) and sort by length desc to prefer longest match
    const combined = hls.map(n => ({ name: n, cls: 'entity-hl' }))
      .sort((a, b) => b.name.length - a.name.length);

    // walk text nodes and replace all non-overlapping matches found for combined names
    walkTextNodes(preview, (textNode) => {
      const parent = textNode.parentNode;
      const txt = textNode.nodeValue;
      if (!txt || !txt.trim()) return;

      // collect matches across all entity names
      const matches = [];
      for (const item of combined) {
        const re = new RegExp(`\\b${escapeRegExp(item.name)}\\b`, 'gi');
        let m;
        while ((m = re.exec(txt)) !== null) {
          matches.push({ index: m.index, text: m[0], name: item.name, cls: item.cls, length: m[0].length });
        }
      }
      if (matches.length === 0) return;

      // sort matches by index and filter overlaps (keep earliest, then skip overlaps)
      matches.sort((a, b) => a.index - b.index || b.length - a.length);
      const filtered = [];
      let lastEnd = -1;
      for (const mt of matches) {
        if (mt.index >= lastEnd) {
          filtered.push(mt);
          lastEnd = mt.index + mt.length;
        }
      }

      // build fragment
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const mt of filtered) {
        if (mt.index > cursor) {
          frag.appendChild(document.createTextNode(txt.slice(cursor, mt.index)));
        }
      const a = document.createElement('a');
      a.className = mt.cls;
      a.textContent = mt.text;
      a.href = 'javascript:void(0)';
      a.dataset.entityName = mt.name;
      a.dataset.entityType = 'highlights';
      // color link by the first tag found in the entity description:
      // display the word with the tag pill background and use the pill text color for the link text.
      try {
        const ent = entityMap && entityMap[mt.name] ? entityMap[mt.name] : null;
        const entTags = ent ? extractTagsFromText(ent.desc) : [];
        if (entTags && entTags.length > 0) {
          const st = tagStyleFor(entTags[0]);
          // apply pill background and text color; add subtle padding & radius to mimic the pill
          if (st && st.background) a.style.background = st.background;
          if (st && st.color) a.style.color = st.color;
          a.style.padding = '0.08em 0.35em';
          a.style.borderRadius = '6px';
          a.style.textDecoration = 'underline';
        } else {
          // no tag -> plain black text, no background
          a.style.background = 'transparent';
          a.style.color = '#000';
          a.style.textDecoration = 'underline';
        }
      } catch (e) {
        // if anything goes wrong, fallback to default link color (do nothing)
      }
      frag.appendChild(a);
        cursor = mt.index + mt.length;
      }
      if (cursor < txt.length) frag.appendChild(document.createTextNode(txt.slice(cursor)));
      parent.replaceChild(frag, textNode);
    });

    // render tags (#tag) as pastel pills
    renderTags(preview);

    // attach hover handlers only — clicks are intentionally disabled for entity words
    preview.querySelectorAll('a.entity-hl').forEach(a => {
      a.addEventListener('mouseover', onEntityHover);
      a.addEventListener('mouseout', onEntityOut);
    });
  } catch (err) {
    console.error('renderPreview error', err);
  }
}

// walk text nodes helper (skip tags where we shouldn't change content)
function walkTextNodes(root, cb) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentNode;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.nodeName.toLowerCase();
      // don't touch text inside these tags (including headings) to avoid corrupting generated markup
      if (['script', 'style', 'a', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const t of nodes) cb(t);
}

// --- tooltip handlers ---
function onEntityHover(ev) {
  const a = ev.currentTarget;
  const name = a.dataset.entityName;
  const type = a.dataset.entityType;
  if (!state.storyData) return;
  const raw = state.storyData[type] || '';
  const map = parseEntitySections(raw);
  const entry = map[name] || { title: name, desc: '' };
  const images = state.storyData.images && state.storyData.images[type] ? state.storyData.images[type] : [];

  // choose image to show in tooltip:
  // - prefer an image URL embedded in the entity description markdown (![alt](url))
  // - otherwise fall back to the story images list for that entity type
  let imgUrl = null;
  if (entry.desc) {
    const mdImg = entry.desc.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (mdImg && mdImg[2]) imgUrl = mdImg[2];
  }
  if (!imgUrl && images.length) imgUrl = images[0];

  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'entity-tooltip';

  // if we found an image URL, render it
  if (imgUrl) {
    const im = document.createElement('img');
    im.src = imgUrl;
    im.alt = entry.title || '';
    tooltipEl.appendChild(im);
  }

  const h = document.createElement('div');
  h.innerHTML = `<strong>${entry.title}</strong>`;
  tooltipEl.appendChild(h);

  if (entry.desc) {
    // render the first non-image line of the description as plain text
    const lines = entry.desc.split('\n').map(l => l.trim()).filter(Boolean);
    let summary = '';
    for (const L of lines) {
      // skip pure image lines
      if (/^!\[.*\]\(.*\)$/.test(L)) continue;
      summary = L;
      break;
    }
    if (summary) {
      const d = document.createElement('div');
      d.className = 'small';
      d.textContent = summary;
      tooltipEl.appendChild(d);
    }
  }

  document.body.appendChild(tooltipEl);
  const rect = a.getBoundingClientRect();
  tooltipEl.style.left = (rect.right + 8) + 'px';
  tooltipEl.style.top = (rect.top) + 'px';
}

function onEntityOut() {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
}

// --- Entity editor modal ---
function openEntityEditor(type, name) {
  if (!state.currentStory) return alert('Open a story first');
  currentEditing = { type, name };
  entityModalTitle.textContent = `Highlight: ${name}`;
  const raw = state.storyData && state.storyData.highlights ? state.storyData.highlights : '';
  const map = parseEntitySections(raw);
  const entry = map[name];
  entityContent.value = entry ? entry.desc : '';
  entityImageInput.value = '';
  entityModal.classList.remove('hidden');
}

closeEntityBtn.addEventListener('click', () => entityModal.classList.add('hidden'));

function openEntityInEditor(type, name) {
  if (!state.currentStory) return alert('Open a story first');
  state.currentView = { type, name };
  const raw = state.storyData && state.storyData.highlights ? state.storyData.highlights : '';
  const map = parseEntitySections(raw);
  const entry = map[name] || { title: name, desc: '' };
  // load the entity as markdown into the editor so it behaves like the main text
  editor.value = composeSection(entry.title, entry.desc);
  renderPreview();
}

saveEntityBtn.addEventListener('click', async () => {
  if (!currentEditing || !currentEditing.name) return;
  const { type, name } = currentEditing;
  const filename = 'highlights.md';
  const raw = state.storyData && state.storyData.highlights ? state.storyData.highlights : '';
  const map = parseEntitySections(raw);
  map[name] = { title: name, desc: (entityContent.value || '') };

  // if an image was selected, upload it to the story images and then proceed
  const file = entityImageInput.files[0];
  if (file) {
    const up = await api.uploadImage(state.currentStory, 'highlights', file);
    if (!up || !up.ok) return alert(up && up.error ? up.error : 'Image upload failed');
    // refresh state to include the new image
    const updated = await api.getStory(state.currentStory);
    if (updated && updated.ok) state.storyData = updated;
  }

  const sections = Object.values(map).map(e => composeSection(e.title, e.desc));
  const newContent = sections.join('\n\n');
  const res = await api.saveFile(state.currentStory, filename, newContent);
  if (!res || !res.ok) return alert(res && res.error ? res.error : 'Save failed');
  const updated = await api.getStory(state.currentStory);
  if (updated && updated.ok) {
    state.storyData = updated;
    entityModal.classList.add('hidden');
    refreshEntityLists();
  }
});

editor.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  if (!state.currentStory) return;
  // remember selection/caret for later insertion
  lastEditorSelection = { start: editor.selectionStart, end: editor.selectionEnd };

  // compute selected word or caret word
  let start = lastEditorSelection.start;
  let end = lastEditorSelection.end;
  let selected = '';
  if (start !== end) {
    selected = editor.value.substring(start, end).trim();
  } else {
    const v = editor.value;
    let i = start;
    let a = i, b = i;
    while (a > 0 && /\w/.test(v[a - 1])) a--;
    while (b < v.length && /\w/.test(v[b])) b++;
    selected = v.substring(a, b).trim();
  }

  // remove existing menu
  if (customContextEl) {
    customContextEl.remove();
    customContextEl = null;
  }

  customContextEl = document.createElement('div');
  customContextEl.className = 'custom-context';
  customContextEl.style.left = ev.pageX + 'px';
  customContextEl.style.top = ev.pageY + 'px';

  let btnHl = null;
  if (selected && selected.length > 0) {
    btnHl = document.createElement('button');
    btnHl.textContent = `Make "${selected}" a Highlight`;
    btnHl.addEventListener('click', async () => {
      if (!state.currentStory) { alert('Open a story first'); return; }
      try {
        // create the highlight but do not open it — keep the current editor view open
        await createEntityAndOpen('highlights', selected, false);
      } catch (err) {
        console.error('createEntityAndOpen error', err);
        alert('Failed to create highlight');
      }
      if (customContextEl) customContextEl.remove();
    });
  }

  const btnUpload = document.createElement('button');
  btnUpload.textContent = 'Upload image...';
  btnUpload.addEventListener('click', () => {
    uploadContext = { mode: 'editor', type: 'text', start: lastEditorSelection.start, end: lastEditorSelection.end, selected };
    document.getElementById('globalHiddenFileInput').click();
    if (customContextEl) customContextEl.remove();
  });

  if (btnHl) customContextEl.appendChild(btnHl);
  customContextEl.appendChild(btnUpload);
  document.body.appendChild(customContextEl);
});

// remove custom context on outer click
document.addEventListener('click', (e) => {
  if (customContextEl && !customContextEl.contains(e.target)) {
    customContextEl.remove();
    customContextEl = null;
  }
});

function openNewEntityModal(type, name) {
  currentEditing = { type, name };
  entityModalTitle.textContent = `New highlight: ${name}`;
  entityContent.value = '';
  entityImageInput.value = '';
  entityModal.classList.remove('hidden');
}

async function createEntityAndOpen(type, name, openAfter = true) {
  // create the entity entry (if missing) in the highlights.md file, refresh state, then optionally open it in editor
  if (!state.currentStory) throw new Error('Open a story first');
  const filename = 'highlights.md';
  const raw = state.storyData && state.storyData.highlights ? state.storyData.highlights : '';
  const map = parseEntitySections(raw);

  // if already exists, just open it (or refresh lists)
  const arr = parseEntitySectionsArray(raw);
  const existingIdx = arr.findIndex(s => s.title === name);
  if (existingIdx === -1) {
    arr.push({ title: name, desc: '' });
    const newContent = arr.map(s => composeSection(s.title, s.desc)).join('\n\n');
    const res = await api.saveFile(state.currentStory, filename, newContent);
    if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Save failed');
    const updated = await api.getStory(state.currentStory);
    if (updated && updated.ok) state.storyData = updated;
    await refreshEntityLists();
  } else {
    // ensure lists are up to date
    await refreshEntityLists();
  }

  // optionally open the new entity in the main editor
  if (openAfter) {
    openEntityInEditor('highlights', name);
  }
}

/* clicking highlighted entity no longer opens the editor.
   Editing highlights is managed from the left sidebar only. This handler
   prevents the previous behavior and ensures clicks on entity words do nothing. */
preview.addEventListener('click', (ev) => {
  const a = ev.target.closest('a.entity-hl');
  if (!a) return;
  // swallow the event so nothing happens when clicking an entity word
  ev.preventDefault();
  ev.stopPropagation();
});

/* right-click on highlighted entity used to open a custom context menu.
   Disabled by design: highlight editing should be managed from the left menu only.
   This handler prevents the custom context menu from appearing for highlighted words. */
preview.addEventListener('contextmenu', (ev) => {
  const a = ev.target.closest('a.entity-hl');
  if (!a) return;
  // when right-clicking an entity word, prevent the native/context menu and do nothing.
  ev.preventDefault();
  // intentionally no custom context menu — highlights are managed from the sidebar only.
});

 // live preview on input + autosave (debounced)
 editor.addEventListener('input', (e) => {
  try {
    renderPreview();
    // update entity occurrence counts in real-time:
    // - if user is editing the main story text, count occurrences in editor.value
    // - otherwise (editing an entity) count occurrences only in the stored main story text
    if (state.currentView && state.currentView.type === 'text') {
      refreshEntityLists(editor.value);
    } else {
      refreshEntityLists();
    }
    // autosave with small debounce to avoid too many writes while typing;
    // user asked for autosave on each typed key — this runs ~500ms after last keystroke.
    scheduleAutoSave(500);
  } catch (err) {
    console.error('input handler error', err);
  }
 });

 // initial load
 refreshStories();
 // ensure editor is disabled until a story is opened
 setEditorEnabled(false);

// expose for debugging
window._storyWriter = { state, refreshStories, openStory, saveMainText };