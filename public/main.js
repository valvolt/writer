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

// Highlights API client helpers
api.listHighlights = (name) => fetch(`/api/stories/${encodeURIComponent(name)}/highlights`).then(r => r.json());
api.getHighlight = (name, id) => fetch(`/api/stories/${encodeURIComponent(name)}/highlights/${encodeURIComponent(id)}`).then(r => r.json());
api.createHighlight = (name, title, content = '') => fetch(`/api/stories/${encodeURIComponent(name)}/highlights`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title, content })
}).then(r => r.json());
api.saveHighlight = (name, id, content) => fetch(`/api/stories/${encodeURIComponent(name)}/highlights/${encodeURIComponent(id)}/save`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content })
}).then(r => r.json());
api.renameHighlight = (name, id, newName) => fetch(`/api/stories/${encodeURIComponent(name)}/highlights/${encodeURIComponent(id)}/rename`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ newName })
}).then(r => r.json());
api.deleteHighlight = (name, id) => fetch(`/api/stories/${encodeURIComponent(name)}/highlights/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => r.json());

 // Publish button state checker (global)
// Enables the Publish button only when:
//  - the user is authenticated (heuristic: logout button visible)
//  - a story is open
//  - there is at least one tile with non-empty content
async function updatePublishButtonState() {
  const publishBtn = document.getElementById('publishBtn');
  if (!publishBtn) return;

  // Determine authentication status from the server to avoid races with UI updates.
  let isAuth = false;
  try {
    const st = await fetch('/api/auth-status').then(r => r.json()).catch(() => null);
    isAuth = !!(st && st.ok && st.authenticated);
  } catch (e) {
    isAuth = false;
  }

  // If not authenticated or no story open, hide/disable publish
  if (!isAuth || !state.currentStory) {
    publishBtn.style.display = isAuth ? 'inline-block' : 'none';
    publishBtn.disabled = true;
    return;
  }

  publishBtn.style.display = 'inline-block';
  publishBtn.disabled = true;

  try {
    // Try to get tiles list
    const listRes = await api.listTiles(state.currentStory).catch(() => null);

    // If tiles call failed or returned empty, fall back to checking story text (state.storyData.text)
    const tiles = (listRes && listRes.ok && Array.isArray(listRes.tiles)) ? listRes.tiles : [];

  // If there are no tiles, publishing is not allowed (tiles are the single source of truth)
    if (tiles.length === 0) {
      publishBtn.disabled = true;
      return;
    }

    // Check tiles in parallel for non-empty content
    const checks = await Promise.all(tiles.map(async (t) => {
      try {
        const tileRes = await api.getTile(state.currentStory, t.id).catch(() => null);
        return !!(tileRes && tileRes.ok && (tileRes.content || '').trim().length > 0);
      } catch (e) {
        return false;
      }
    }));

    // Also consider main story text as a fallback source
    const mainTextNonEmpty = !!(state.storyData && state.storyData.text && String(state.storyData.text).trim().length > 0);

    const hasNonEmpty = checks.some(Boolean) || mainTextNonEmpty;
    publishBtn.disabled = !hasNonEmpty;
  } catch (e) {
    // On unexpected errors, be permissive so users can still attempt to publish
    publishBtn.disabled = false;
  }
}

// --- state ---
const state = {
  currentStory: null,
  storyData: null, // result of GET /api/stories/:name
  // currentView indicates what the editor is showing:
  // { type: 'text'|'highlights', name?: string }
  currentView: { type: null, name: null },
  // activeTagFilter holds the currently selected tag used to filter highlight lists (null = no filter)
  activeTagFilter: null,
  // bubbleTag: single-tag "bubble" ordering (non-destructive) — when set, highlights containing this tag are shown first
  bubbleTag: null
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
const newHighlightInput = $('#newHighlightInput');
const createHighlightBtn = $('#createHighlightBtn');
const highlightSection = document.querySelector('.entities');
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
        // append image markdown to the per-highlight file (create if missing)
        try {
          const map = state.highlightsMap || {};
          let entry = map[ctx.name];
          let content = '';

          if (entry && entry.id) {
            const got = await api.getHighlight(state.currentStory, entry.id).catch(() => null);
            content = (got && got.ok) ? (got.content || '') : (entry.desc || '');
          } else {
            // create a minimal section if missing
            content = `## ${ctx.name}\n\n`;
          }

          content = content + (content.trim() ? '\n\n' : '') + `![${file.name}](${url})`;

          if (entry && entry.id) {
            const saveRes = await api.saveHighlight(state.currentStory, entry.id, content);
            if (!saveRes || !saveRes.ok) return alert(saveRes && saveRes.error ? saveRes.error : 'Save failed');
          } else {
            const cr = await api.createHighlight(state.currentStory, ctx.name, content);
            if (!cr || !cr.ok) return alert(cr && cr.error ? cr.error : 'Create failed');
          }

          const updated = await api.getStory(state.currentStory);
          if (updated && updated.ok) state.storyData = updated;
          await refreshEntityLists();
          renderPreview();
        } catch (err) {
          console.error('upload->entity save failed', err);
          alert('Save failed');
        }
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
  // Static 20-entry pastel palette (Light background, Dark text) using the exact pairs provided.
  const palette = [
    { background: 'rgb(245, 245, 245)', color: 'rgb(51, 51, 51)' },      // Neutral / gray 1
    { background: 'rgb(238, 238, 238)', color: 'rgb(34, 34, 34)' },      // Neutral / gray 2

    { background: 'rgb(230, 243, 255)', color: 'rgb(20, 60, 110)' },     // Blues 1
    { background: 'rgb(214, 234, 248)', color: 'rgb(21, 67, 96)' },      // Blues 2
    { background: 'rgb(224, 247, 250)', color: 'rgb(0, 77, 102)' },      // Blues 3

    { background: 'rgb(232, 245, 233)', color: 'rgb(27, 94, 32)' },      // Greens 1
    { background: 'rgb(220, 237, 200)', color: 'rgb(51, 105, 30)' },     // Greens 2

    { background: 'rgb(224, 247, 250)', color: 'rgb(0, 96, 100)' },      // Cyans/teals 1
    { background: 'rgb(225, 245, 254)', color: 'rgb(1, 87, 155)' },      // Cyans/teals 2

    { background: 'rgb(243, 229, 245)', color: 'rgb(74, 20, 140)' },     // Purples 1
    { background: 'rgb(237, 231, 246)', color: 'rgb(69, 39, 160)' },     // Purples 2

    { background: 'rgb(255, 235, 238)', color: 'rgb(136, 14, 79)' },     // Reds/pinks 1
    { background: 'rgb(252, 228, 236)', color: 'rgb(173, 20, 87)' },     // Reds/pinks 2

    { background: 'rgb(255, 243, 224)', color: 'rgb(230, 81, 0)' },      // Oranges 1
    { background: 'rgb(255, 249, 230)', color: 'rgb(204, 112, 0)' },     // Oranges 2

    { background: 'rgb(255, 253, 231)', color: 'rgb(245, 127, 23)' },    // Yellows/ambers 1
    { background: 'rgb(255, 248, 225)', color: 'rgb(245, 124, 0)' },     // Yellows/ambers 2

    { background: 'rgb(239, 235, 233)', color: 'rgb(78, 52, 46)' },      // Browns 1
    { background: 'rgb(250, 244, 239)', color: 'rgb(93, 64, 55)' },      // Browns 2

    { background: 'rgb(236, 239, 241)', color: 'rgb(33, 33, 33)' }       // Extra soft blue-gray
  ];

  // normalize tag to lower-case for case-insensitive mapping
  const key = (typeof tag === 'string') ? tag.toLowerCase() : String(tag || '');
  const idx = hashStringToInt(key) % palette.length;
  return palette[idx];
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
  // Normalize section body so we don't produce multiple blank lines when joining sections.
  // - strip leading/trailing blank lines from the description
  // - if the description is empty after trimming, return only the heading (joining will add a single separator)
  const safeDesc = (desc || '').replace(/^\n+/, '').replace(/\n+$/, '');
  if (!safeDesc) return `## ${title}`;
  return `## ${title}\n\n${safeDesc}`;
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
    const li = raw.match(/^\s*\*\s+(.*)/);
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

/* --------------------
   Counting helpers
   --------------------
   sanitizeForCounting(text): removes image markdown (![alt](url)) and tags (#tag)
   countWords(text): returns number of word tokens (Unicode-aware)
   countChars(text): returns character count including spaces (per spec)
   updateCounters(totalText, currentText): updates DOM nodes under #editorCounters
*/
function sanitizeForCounting(text) {
  if (!text || typeof text !== 'string') return '';
  // remove markdown images: ![alt](url)
  let s = text.replace(/!\[[^\]]*]\)]*\)/g, ' ');
  // remove tags like #keyword
  s = s.replace(/#[A-Za-z0-9_-]+/g, ' ');
  // normalize whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function countWords(text) {
  const s = sanitizeForCounting(text);
  if (!s) return 0;
  // Unicode-aware word matcher: letters, numbers, underscores and apostrophes are allowed inside words
  try {
    const matches = s.match(/\b[\p{L}\p{N}_']+\b/gu);
    return matches ? matches.length : 0;
  } catch (e) {
    // Fallback for environments without Unicode property escapes
    const matches = s.match(/\b[\w']+\b/g);
    return matches ? matches.length : 0;
  }
}

function countChars(text) {
  const s = sanitizeForCounting(text);
  return s.length;
}

function updateCounters(totalText, currentText) {
  try {
    const wcTotalEl = document.getElementById('wc-total');
    const wcCurrentEl = document.getElementById('wc-current');
    const ccTotalEl = document.getElementById('cc-total');
    const ccCurrentEl = document.getElementById('cc-current');
    const totalWords = countWords(totalText || '');
    const currentWords = countWords(currentText || '');
    const totalChars = countChars(totalText || '');
    const currentChars = countChars(currentText || '');
    if (wcTotalEl) wcTotalEl.textContent = totalWords.toLocaleString();
    if (wcCurrentEl) wcCurrentEl.textContent = currentWords.toLocaleString();
    if (ccTotalEl) ccTotalEl.textContent = totalChars.toLocaleString();
    if (ccCurrentEl) ccCurrentEl.textContent = currentChars.toLocaleString();
  } catch (e) {
    // don't let counters break the app
    console.warn('updateCounters failed', e);
  }
}

function countOccurrences(text, name) {
  // guard: name required
  if (!name) return 0;
  // coerce non-strings to safe string values (defensive: avoids .match TypeError)
  if (typeof text !== 'string') text = String(text || '');
  if (!text) return 0;
  // Use whole-word, case-sensitive matching for counts (aligns with UI highlight behavior).
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
  const m = text.match(re);
  return m ? m.length : 0;
}

// --- Story listing and CRUD UI ---
async function refreshStories() {
  const res = await api.listStories();
  if (!res || !res.ok) return;
 storyList.innerHTML = '';

  // Normalize stories into {id, name} objects and sort alphabetically by name.
  const storiesArr = (res.stories || []).map(s => {
    const id = (typeof s === 'string') ? s : (s.id || s.name || '');
    const name = (typeof s === 'string') ? s : (s.name || s.id || '');
    return { id, name };
  });

  storiesArr.sort((a, b) => a.name.localeCompare(b.name));

  // If a story is currently open, bring it to the front (but keep others alphabetized).
  if (state.currentStory) {
    const idx = storiesArr.findIndex(x => x.id === state.currentStory);
    if (idx > 0) {
      const [item] = storiesArr.splice(idx, 1);
      storiesArr.unshift(item);
    }
  }

  for (const s of storiesArr) {
    const li = document.createElement('li');
    li.className = 'story-item';
    const nameSpan = document.createElement('span');

    const storyId = s.id;
    const displayName = s.name;

    nameSpan.textContent = displayName;
    nameSpan.dataset.name = storyId;

    // apply explicit classes so styling is consistent and easy to override
    if (state.currentStory) {
      if (state.currentStory !== storyId) {
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

    nameSpan.addEventListener('click', () => openStory(storyId));
    li.appendChild(nameSpan);

    // delete button (asks for confirmation before deleting the story folder)
    const del = document.createElement('button');
    del.className = 'story-delete';
    del.textContent = 'Delete';
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm(`Delete story "${displayName}" and all its files/images? This cannot be undone.`)) return;
      try {
        const rr = await api.deleteStory(storyId);
        if (!rr || !rr.ok) return alert(rr && rr.error ? rr.error : 'Delete failed');
        // if the deleted story is currently open, perform a full close action so UI matches user pressing Close
        if (state.currentStory === storyId) {
          try { closeCurrentStory(); } catch (e) {
            // fallback: perform minimal cleanup if closeCurrentStory is unavailable
            state.currentStory = null;
            state.storyData = null;
            currentStoryTitle.textContent = 'No story opened';
            editor.value = '';
            preview.innerHTML = '';
            if (highlightList) highlightList.innerHTML = '';
            if (highlightSection) highlightSection.style.display = 'none';
            setEditorEnabled(false);
          }
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
  // Enter full view first so renderPreview will not overwrite the preview while we fetch tiles.
  state.currentView = { type: 'full' };
  try {
    // ensure tiles area visible and up to date and keep editor read-only
    if (tilesSection) tilesSection.style.display = 'block';
    setEditorEnabled(false);

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
    // render into preview (read-only mode)
    const html = (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function')
      ? (marked.parse(combined || ''))
      : simpleMarkdownToHtml(combined || '');
    preview.innerHTML = html || '<div class="empty-preview">[no tiles]</div>';
    // ensure #tags are rendered as pill elements in the concatenated full view as well
    try { renderTags(preview); } catch (e) { console.warn('renderTags failed on full view', e); }

    // update counters: total is concatenated tiles, current is editor value if editing a tile
    try {
      const currentText = (state.currentView && state.currentView.type === 'tile') ? (editor.value || '') : '';
      updateCounters(combined, currentText);
    } catch (e) { /* ignore */ }
  } catch (e) {
    console.error('show full tiles failed', e);
    // on error, fall back to editor text preview but keep full view state
    try {
      editor.value = (state.storyData && state.storyData.text) || '';
      renderPreview();
    } catch (err) { /* ignore */ }
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

/* Close the currently-open story and clear UI state so the left menu collapses
   and the editor/preview return to the initial state (same behavior as Close button). */
function closeCurrentStory() {
  state.currentStory = null;
  state.storyData = null;
  state.currentView = { type: null, name: null };
  currentStoryTitle.textContent = 'No story opened';
  editor.value = '';
  // clear preview so any rendered tags/pills are removed when closing
  if (preview) preview.innerHTML = '';
  if (highlightList) highlightList.innerHTML = '';
  // hide highlights area when no story is open
  if (highlightSection) highlightSection.style.display = 'none';
  if (newHighlightInput) newHighlightInput.value = '';
  // hide tiles area
  if (tilesSection) tilesSection.style.display = 'none';
  // remove story-level tags container if present
  const storyTagsEl = document.getElementById('storyTags');
  if (storyTagsEl && storyTagsEl.parentNode) storyTagsEl.parentNode.removeChild(storyTagsEl);
  // disable editor area when no story is open
  setEditorEnabled(false);
  // reset counters when no story is opened
  try { updateCounters('', ''); } catch (e) { /* ignore */ }
  // ensure sidebar reflects that no story is open so storiesPane can expand
  try {
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl) sidebarEl.classList.remove('story-open');
  } catch (e) { /* ignore */ }

  // refresh the stories list so the left menu updates (non-open stories appear grey)
  refreshStories();
}

closeStoryBtn.addEventListener('click', () => {
  closeCurrentStory();
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
  // show the concatenated tiles by default when opening a story (read-only full view)
  state.currentView = { type: 'full' };
  currentStoryTitle.textContent = name;
  // keep editor disabled by default when opening a story
  setEditorEnabled(false);
  // mark sidebar as having an open story so splitter heights remain in effect
  try {
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl) sidebarEl.classList.add('story-open');
  } catch (e) { /* ignore */ }

  // ensure tiles and highlights areas visible and load tiles; render concatenated tiles into preview
  if (tilesSection) tilesSection.style.display = 'block';
  if (highlightSection) highlightSection.style.display = 'block';
  try {
    await refreshTiles();
    // fetch tiles and render concatenated content in order
    const listRes = await api.listTiles(state.currentStory);
    if (listRes && listRes.ok) {
      const tiles = listRes.tiles || [];
      let combined = '';
      for (const t of tiles) {
        try {
          const tileRes = await api.getTile(state.currentStory, t.id);
          if (tileRes && tileRes.ok) combined += (tileRes.content || '') + '\n\n';
        } catch (e) {
          console.warn('failed to load tile during openStory', t.id, e);
        }
      }
      const html = (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function')
        ? (marked.parse(combined || ''))
        : simpleMarkdownToHtml(combined || '');
      preview.innerHTML = html || '<div class="empty-preview">[no tiles]</div>';
    } else {
      // fallback to showing text.md preview if tiles unavailable
      editor.value = res.text || '';
      renderPreview();
    }
  } catch (e) {
    console.warn('refreshTiles / openStory rendering failed', e);
    // fallback behavior: show text.md in preview
    editor.value = res.text || '';
    renderPreview();
  }

  // update sidebar and entity lists
  refreshEntityLists();
  refreshStories();
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

  

  // saving an entity when viewing a single highlight file: persist the editor content
  // to the per-highlight markdown file via the highlights API.
  if (state.currentView && state.currentView.type === 'highlight') {
    const id = state.currentView && state.currentView.id;
    if (!id) return console.warn('saveMainText: no highlight id');
    const content = editor.value;
    const res = await api.saveHighlight(state.currentStory, id, content);
    if (!res || !res.ok) {
      console.warn('saveMainText: failed to save highlight', res && res.error);
      return;
    }
    // refresh highlights list and story data so counts and tags update
    try {
      const updatedList = await api.listHighlights(state.currentStory);
      if (updatedList && updatedList.ok) {
        // optionally refresh full story metadata if the backend exposes it
        const updatedStory = await api.getStory(state.currentStory).catch(() => null);
        if (updatedStory && updatedStory.ok) state.storyData = updatedStory;
      }
    } catch (e) { /* ignore */ }
    await refreshEntityLists();
    console.log('Saved highlight', id);
    return;
  }

  // For other view types, fall back to existing highlights.md handling (if any)
  // — but by default the app now uses per-highlight files and the above branch will be used.
  console.debug('[debug] saveMainText: no per-highlight save performed (view=', state.currentView, ')');
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
 async function refreshEntityLists(mainTextOverride) {
   // If someone accidentally passed a non-string (e.g. Event) as the handler arg, ignore it.
   if (mainTextOverride && typeof mainTextOverride !== 'string') mainTextOverride = undefined;
   // If no story is opened and no override provided, nothing to do.
   if (!state.storyData && typeof mainTextOverride === 'undefined') return;
   // Determine the main text to count occurrences in:
   // - If caller provided an override (e.g. while typing in main text), use it.
   // - Otherwise prefer concatenated tiles content (if any), falling back to stored story main text.
   let mainText = (typeof mainTextOverride !== 'undefined') ? mainTextOverride : ((state.storyData && state.storyData.text) ? state.storyData.text : '');
   // If no override provided, attempt to build mainText from tiles (preferred source)
   if (typeof mainTextOverride === 'undefined' && state.currentStory) {
     try {
       const listRes = await api.listTiles(state.currentStory);
       if (listRes && listRes.ok && Array.isArray(listRes.tiles) && listRes.tiles.length > 0) {
         let combined = '';
         for (const t of listRes.tiles) {
           try {
             const tileRes = await api.getTile(state.currentStory, t.id);
             if (tileRes && tileRes.ok) combined += (tileRes.content || '') + '\n\n';
           } catch (e) {
             console.warn('refreshEntityLists: failed to load tile', t.id, e);
           }
         }
         if (combined.trim()) mainText = combined;
       }
     } catch (e) {
       console.warn('refreshEntityLists: failed to list tiles', e);
     }
   }
  // Build highlights map by querying per-highlight API. Fall back to parsing highlights.md if API is unavailable.
  const hls = {};
  const text = mainText || '';
  try {
    if (state.currentStory) {
      const listRes = await api.listHighlights(state.currentStory).catch(() => null);
      if (listRes && listRes.ok && Array.isArray(listRes.highlights)) {
        // fetch each highlight content in parallel (small projects expected)
        const details = await Promise.all(listRes.highlights.map(async (h) => {
          try {
            const got = await api.getHighlight(state.currentStory, h.id).catch(() => null);
            if (got && got.ok) {
              return { id: h.id, title: got.title || h.title || h.id, content: got.content || '' };
            }
          } catch (e) {}
          // fallback to title only if getHighlight fails
          return { id: h.id, title: h.title || h.id, content: '' };
        }));
        for (const d of details) {
          hls[d.title] = { id: d.id, title: d.title, desc: (d.content || '').replace(/^\s*#{1,6}\s+.*$/m, '').trim() };
        }
      } else {
        // no highlights available from API; leave hls empty but log for debugging
        console.warn('refreshEntityLists: no highlights returned from API', listRes);
      }
    }
  } catch (e) {
    // If per-highlight APIs fail, prefer empty map rather than falling back to highlights.md
    console.warn('refreshEntityLists: failed to load per-highlight files via API', e);
  }

  // Persist a runtime cache of highlights loaded from per-highlight files so other renderers use them.
  state.highlightsMap = hls || {};
  // Build highlight array with occurrence counts and id references
  const hlArr = Object.keys(hls).map(n => ({ name: n, id: hls[n] && hls[n].id ? hls[n].id : null, count: countOccurrences(text, n) }));

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

    // If a strict filter is active, only show highlights that include that tag.
    // Otherwise, if a bubbleTag is set, reorder the list so matching items appear first (stable).
    let filteredArr;
    if (state.activeTagFilter) {
      filteredArr = arr.filter(item => {
        const desc = (hls && hls[item.name] && typeof hls[item.name].desc === 'string') ? hls[item.name].desc : '';
        const tags = extractTagsFromText(desc);
        return tags.includes(state.activeTagFilter);
      });
    } else if (state.bubbleTag) {
      // stable partition: matches first, then others in original sort order
      const matches = [];
      const others = [];
      for (const item of arr) {
        const desc = (hls && hls[item.name] && typeof hls[item.name].desc === 'string') ? hls[item.name].desc : '';
        const tags = extractTagsFromText(desc);
        if (tags.includes(state.bubbleTag)) matches.push(item);
        else others.push(item);
      }
      filteredArr = matches.concat(others);
    } else {
      filteredArr = arr;
    }

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

      // Actions: Rename + Delete (use per-highlight APIs when available)
      const actionsDiv = document.createElement('div');
      actionsDiv.style.display = 'inline-flex';
      actionsDiv.style.gap = '6px';
      actionsDiv.style.marginLeft = '8px';
      actionsDiv.style.alignItems = 'center';

      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'Rename';
      renameBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!state.currentStory) return alert('Open a story first');
        const newTitle = prompt('New highlight title', item.name || '');
        if (newTitle === null) return;

        try {
          if (!item.id) {
            alert('Rename not supported for legacy highlights');
            return;
          }

          // Preview: ask the server where replacements would occur (dry-run)
          const previewUrl = `/api/stories/${encodeURIComponent(state.currentStory)}/highlights/${encodeURIComponent(item.id)}/rename-preview?newName=${encodeURIComponent(newTitle)}`;
          let preview = null;
          try {
            const pRes = await fetch(previewUrl);
            preview = await pRes.json().catch(() => null);
          } catch (e) {
            preview = null;
          }

          // Decide whether to prompt the user. If there are zero occurrences, skip confirmation and just rename.
          let shouldProceed = false;
          let propagateChange = true; // default when we do prompt-based rename we propagate replacements
          if (preview && preview.ok) {
            const total = Number(preview.totalMatches || 0);
            if (total === 0) {
              // nothing to replace in files — perform metadata rename only without prompting
              shouldProceed = true;
              propagateChange = false;
            }
          }

          // If we still need to confirm (preview unavailable or there are matches), build a preview message and ask the user.
          if (!shouldProceed) {
            // Build a concise preview message showing separate counts for tiles vs highlights.
            let msg = `Rename "${item.name}" → "${newTitle}"\nThis operation is NOT reversible.\n\n`;
            if (!preview || !preview.ok) {
              msg += 'Preview unavailable (server error). Proceed with rename?';
            } else {
              // compute totals per scope
              let tileMatches = 0;
              let highlightMatches = 0;
              for (const f of (preview.files || [])) {
                try {
                  if (typeof f.path === 'string' && f.path.startsWith('tiles/')) {
                    for (const m of (f.matches || [])) tileMatches += (Number(m.count) || 0);
                  } else if (typeof f.path === 'string' && f.path.startsWith('highlights/')) {
                    for (const m of (f.matches || [])) highlightMatches += (Number(m.count) || 0);
                  } else {
                    // unknown folder — count as tile by default for visibility
                    for (const m of (f.matches || [])) tileMatches += (Number(m.count) || 0);
                  }
                } catch (e) { /* ignore per-file counting errors */ }
              }
              msg += `Total Tile matches: ${tileMatches}\nTotal Highlight matches: ${highlightMatches}\n\nProceed with the rename and replace all matches?`;
            }

            const ok = confirm(msg);
            if (!ok) return;
            shouldProceed = true;
            propagateChange = true;
          }

          // Perform rename + propagation
          const renameUrl = `/api/stories/${encodeURIComponent(state.currentStory)}/highlights/${encodeURIComponent(item.id)}/rename`;
          // respect propagateChange (when preview showed 0 matches we set propagateChange=false)
          const body = { newName: newTitle, propagate: !!propagateChange };
          const rRes = await fetch(renameUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const rBody = await rRes.json().catch(() => null);
          if (!rBody || !rBody.ok) {
            return alert(rBody && rBody.error ? rBody.error : 'Rename failed');
          }

          // Refresh lists to reflect updated metadata and counts
          await refreshEntityLists();

          // Reload the current editor/view as if the user had clicked the corresponding list item.
          // This ensures the editor and rendered preview are reloaded from the server and reflect the rename.
          try {
            if (state.currentView && state.currentView.type === 'highlight' && state.currentView.id === item.id) {
              // reuse the existing openEntityInEditor flow to load the highlight afresh
              openEntityInEditor('highlights', item.id, newTitle);
            } else if (state.currentView && state.currentView.type === 'tile' && state.currentView.id) {
              // reload the currently open tile content
              const tid = state.currentView.id;
              (async () => {
                try {
                  const tgot = await api.getTile(state.currentStory, tid);
                  if (tgot && tgot.ok) {
                    editor.value = tgot.content || '';
                    // keep header showing story - tile title when possible
                    try {
                      const listRes = await api.listTiles(state.currentStory);
                      const tileMeta = (listRes && listRes.ok && Array.isArray(listRes.tiles)) ? (listRes.tiles.find(x => x.id === tid) || {}) : {};
                      currentStoryTitle.textContent = `${state.currentStory} - ${tileMeta.title || '(untitled)'}`;
                    } catch (e) {}
                    setEditorEnabled(true);
                    editor.focus();
                    renderPreview();
                  }
                } catch (e) { /* ignore */ }
              })();
            } else {
              // otherwise just re-render preview to pick up renamed terms in the displayed text
              try { renderPreview(); } catch (e) {}
            }
          } catch (e) {
            console.warn('reload-after-rename failed', e);
          }

          // Show summary of what changed only when there were actual replacements.
          // If no replacements were needed (metadata-only rename), skip the completion alert.
          const sum = (rBody.summary && typeof rBody.summary === 'object') ? rBody.summary : null;
          const replacements = sum && typeof sum.totalReplacements === 'number' ? sum.totalReplacements : 0;
          if (replacements > 0) {
            alert(`Rename completed. Replacements: ${replacements}. Files changed: ${sum.filesChanged ? sum.filesChanged.length : 0}.`);
          }
        } catch (err) {
          console.error('rename highlight failed', err);
          alert('Rename failed');
        }
      });
      actionsDiv.appendChild(renameBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm(`Delete highlight "${item.name}"? This cannot be undone.`)) return;
        try {
          if (item.id) {
            const rr = await api.deleteHighlight(state.currentStory, item.id);
            if (!rr || !rr.ok) return alert(rr && rr.error ? rr.error : 'Delete failed');
          } else {
            // fallback: remove from legacy highlights.md
            const filename = 'highlights.md';
            const raw = (state.storyData && state.storyData.highlights) ? state.storyData.highlights : '';
            const arrLegacy = parseEntitySectionsArray(raw);
            const idx = arrLegacy.findIndex(s => s.title === item.name);
            if (idx !== -1) {
              arrLegacy.splice(idx, 1);
              const newContent = arrLegacy.map(s => composeSection(s.title, s.desc)).join('\n\n');
              const r = await api.saveFile(state.currentStory, filename, newContent);
              if (!r || !r.ok) return alert(r && r.error ? r.error : 'Delete failed');
            }
          }
          // if currently editing this highlight, close editor and clear preview
          if (state.currentView && state.currentView.type === 'highlight' && state.currentView.id === item.id) {
            state.currentView = { type: null, name: null };
            editor.value = '';
            try { currentStoryTitle.textContent = state.currentStory || 'No story opened'; } catch (e) {}
            renderPreview();
          }
          await refreshEntityLists();
        } catch (err) {
          console.error('delete highlight failed', err);
          alert('Delete failed');
        }
      });
      actionsDiv.appendChild(delBtn);
      li.appendChild(actionsDiv);

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
        // clicking a tag "bubbles" that tag to the top of the highlights list (non-destructive ordering)
        tspan.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (!state.currentStory) return;
          // set bubbleTag (do not toggle off when clicking same tag)
          state.bubbleTag = tag;
          // clear strict filter if any (we only support bubbling now)
          state.activeTagFilter = null;
          // re-render lists using new bubble state
          refreshEntityLists(mainText);
        });
        // visually mark bubbled tag (less prominent than .selected)
        if (state.bubbleTag === tag) tspan.classList.add('bubbled');
        li.appendChild(tspan);
      }

      // click behavior: open the entity in the main editor (pass id + name)
      li.addEventListener('click', () => openEntityInEditor(type, item.id, item.name));
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
        // clicking story tag bubbles that tag to the top of the highlights list
        tspan.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (!state.currentStory) return;
          state.bubbleTag = tag;
          state.activeTagFilter = null;
          refreshEntityLists(mainText);
        });
        if (state.bubbleTag === tag) tspan.classList.add('bubbled');
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
    // If the UI is currently showing the full concatenated tiles view, we already
    // rendered the preview manually and should avoid overwriting it with the editor content.
    if (!(state.currentView && state.currentView.type === 'full')) {
      renderPreview();
    }

    // update counters using the mainText we computed above and the current editor tile (if any)
    try {
      const currentText = (state.currentView && state.currentView.type === 'tile') ? (editor.value || '') : '';
      updateCounters(text || '', currentText);
    } catch (e) { /* ignore counter errors */ }
}

 // sort change handlers
 if (hlSort) hlSort.addEventListener('change', () => {
   // when the user changes sorting (A→Z / By count), remove any active bubbled tag
   // so the list is fully resorted according to the selected sort mode.
   try { state.bubbleTag = null; } catch (e) { /* ignore */ }
   refreshEntityLists();
 });

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

        // update counters immediately for the selected tile and total project text
        (async () => {
          try {
            // build combined text from all tiles (total)
            const listRes = await api.listTiles(state.currentStory).catch(() => null);
            const tilesAll = (listRes && listRes.ok && Array.isArray(listRes.tiles)) ? listRes.tiles : [];
            if (tilesAll.length === 0) {
              updateCounters('', editor.value || '');
              return;
            }
            const parts = await Promise.all(tilesAll.map(async tt => {
              try {
                const r = await api.getTile(state.currentStory, tt.id).catch(() => null);
                return (r && r.ok) ? (r.content || '') : '';
              } catch (e) { return ''; }
            }));
            const combined = parts.filter(Boolean).join('\n\n');
            updateCounters(combined, editor.value || '');
          } catch (err) {
            console.warn('Failed to update counters on tile click', err);
          }
        })();
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
          state.currentView = { type: null, name: null };
          editor.value = '';
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
              // render tags (#tag) into pills for the refreshed full view
              try { renderTags(preview); } catch (e) { console.warn('renderTags failed on full refresh', e); }
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
  } finally {
    // After tiles are refreshed (or an error occurred), update the Publish button state.
    // Prefer a direct, robust check here: query each tile's content (in parallel) and enable Publish
    // if at least one tile contains non-empty content. This avoids races with separate async checks.
    try {
      const publishBtn = document.getElementById('publishBtn');
      const logoutBtn = document.getElementById('logoutBtn');
      const isAuthNow = !!(logoutBtn && logoutBtn.style.display !== 'none');
      if (!publishBtn) return;
      if (!isAuthNow || !state.currentStory) {
        publishBtn.style.display = isAuthNow ? 'inline-block' : 'none';
        publishBtn.disabled = true;
      } else {
        publishBtn.style.display = 'inline-block';
        // if there are no tiles, keep disabled
        const tilesEls = Array.from(tileList ? tileList.children : []);
        if (tilesEls.length === 0) {
          publishBtn.disabled = true;
        } else {
          // fetch tile contents in parallel with a conservative timeout via Promise.race if necessary
          try {
            const checks = await Promise.all(tilesEls.map(async (node) => {
              const id = node && node.dataset && node.dataset.id ? node.dataset.id : null;
              if (!id) return false;
              const r = await api.getTile(state.currentStory, id).catch(() => null);
              return !!(r && r.ok && (r.content || '').trim().length > 0);
            }));
            const hasNonEmpty = checks.some(Boolean);
            publishBtn.disabled = !hasNonEmpty;
          } catch (e) {
            // On error be permissive so users can still attempt to publish
            publishBtn.disabled = false;
          }
        }
      }
    } catch (err) {
      // ignore publish state failures
      console.warn('publish state update failed', err);
    }
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

  // create highlight via input in the sidebar
  if (createHighlightBtn) {
    createHighlightBtn.addEventListener('click', async () => {
      if (!state.currentStory) return alert('Open a story first');
      const name = (newHighlightInput && newHighlightInput.value) ? newHighlightInput.value.trim() : '';
      if (!name) return alert('Enter a highlight name');
      try {
        // create highlight entry but do not open it in editor
        await createEntityAndOpen('highlights', name, false);
        if (newHighlightInput) newHighlightInput.value = '';
        await refreshEntityLists();
      } catch (err) {
        console.error('createHighlight failed', err);
        alert('Failed to create highlight');
      }
    });
  }
}

/* Improved preview rendering: render markdown then wrap ALL entity occurrences (multi-match, multi-word, longest-first).
   NOTE: renderPreview now renders markdown even when no story is opened so the right pane always shows live preview. */
function renderPreview() {
  try {
    // When the UI is showing the full concatenated tiles view we must not
    // overwrite the preview (it is rendered from tiles, not from the editor).
    if (state.currentView && state.currentView.type === 'full') return;
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

    // derive entities from per-highlight cache if available (state.highlightsMap)
    const entityMap = state.highlightsMap || {};
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
      // Use case-sensitive matching (no 'i' flag) and whole-word boundaries.
      const re = new RegExp(`\\b${escapeRegExp(item.name)}\\b`, 'g');
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
          // ensure any previous no-tags marker is removed so CSS for tagged highlights applies
          a.classList.remove('no-tags');
          const st = tagStyleFor(entTags[0]);
          // apply pill background and text color; add subtle padding & radius to mimic the pill
          if (st && st.background) a.style.background = st.background;
          if (st && st.color) a.style.color = st.color;
          a.style.padding = '0.08em 0.35em';
          a.style.borderRadius = '6px';
          a.style.textDecoration = 'underline';
        } else {
          // no tag -> mark as no-tags so CSS will render fluorescent yellow (clear inline styles first)
          a.classList.add('no-tags');
          a.style.background = '';
          a.style.color = '';
          a.style.padding = '';
          a.style.borderRadius = '';
          a.style.textDecoration = '';
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
  const map = state.highlightsMap || {};
  let entry = map[name];
  if (!entry) {
    // try case-insensitive lookup
    for (const k in map) {
      if (k && k.toLowerCase() === String(name || '').toLowerCase()) { entry = map[k]; break; }
    }
  }
  if (!entry) entry = { title: name, desc: '' };
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

function openEntityInEditor(type, id, title) {
  if (!state.currentStory) return alert('Open a story first');
  (async () => {
    try {
      if (!id) {
        // fallback to legacy behavior if id missing: open by name from highlights.md
        const raw = state.storyData && state.storyData.highlights ? state.storyData.highlights : '';
        const map = parseEntitySections(raw);
        const entry = map[title] || { title: title, desc: '' };
        editor.value = composeSection(entry.title, entry.desc);
        state.currentView = { type: 'highlight', id: null };
        setEditorEnabled(true);
        renderPreview();
        return;
      }
      const got = await api.getHighlight(state.currentStory, id);
      if (!got || !got.ok) {
        alert(got && got.error ? got.error : 'Failed to load highlight');
        return;
      }
      state.currentView = { type: 'highlight', id: id };
      // load the file content as-is (do NOT auto-insert a heading when content is empty)
      editor.value = got.content || '';
      // update header to show "story - highlight title"
      try { currentStoryTitle.textContent = `${state.currentStory} - ${got.title || title}`; } catch (e) {}
      setEditorEnabled(true);
      editor.focus();
      renderPreview();
    } catch (err) {
      console.error('openEntityInEditor failed', err);
      alert('Failed to open highlight');
    }
  })();
}

saveEntityBtn.addEventListener('click', async () => {
  if (!currentEditing || !currentEditing.name) return;
  const { type, name } = currentEditing;
  let content = (entityContent.value || '');

  // if an image was selected, upload it first and append to content
  const file = entityImageInput.files[0];
  if (file) {
    const up = await api.uploadImage(state.currentStory, 'highlights', file);
    if (!up || !up.ok) return alert(up && up.error ? up.error : 'Image upload failed');
    const url = up.url;
    if (url) {
      content = (content ? content + '\n\n' : content) + `![${file.name}](${url})`;
    }
  }

  // find existing entry id (if any) from runtime cache
  const map = state.highlightsMap || {};
  const entry = map[name];

  try {
    if (entry && entry.id) {
      const res = await api.saveHighlight(state.currentStory, entry.id, content);
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Save failed');
    } else {
      const res = await api.createHighlight(state.currentStory, name, content);
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Create failed');
    }

    // refresh story metadata and highlights list
    const updatedStory = await api.getStory(state.currentStory).catch(() => null);
    if (updatedStory && updatedStory.ok) state.storyData = updatedStory;
    entityModal.classList.add('hidden');
    await refreshEntityLists();
  } catch (err) {
    alert(err && err.message ? err.message : 'Save failed');
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
  if (!state.currentStory) throw new Error('Open a story first');
  // create a per-highlight markdown file via API
    try {
      // Create the highlight with empty content by default (highlights.json holds the title).
      const res = await api.createHighlight(state.currentStory, name, '');
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Create failed');
      // refresh highlights list
      await refreshEntityLists();
      if (openAfter) {
        // open newly created highlight
        openEntityInEditor('highlights', res.id, res.title || name);
      }
    } catch (err) {
      console.error('createEntityAndOpen failed', err);
      throw err;
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
    // - if user is editing a tile, compute concatenated tiles with the current in-editor tile content
    //   so counts update immediately as you type in a tile
    if (state.currentView && state.currentView.type === 'text') {
      refreshEntityLists(editor.value);
    } else if (state.currentView && state.currentView.type === 'tile') {
      // build a combined text using the latest editor content for the active tile
      (async () => {
        try {
          const curId = state.currentView && state.currentView.id;
          if (!state.currentStory || !curId) {
            // fallback to stored data
            refreshEntityLists();
            return;
          }
          const listRes = await api.listTiles(state.currentStory);
          if (!listRes || !listRes.ok) {
            refreshEntityLists();
            return;
          }
          const tiles = listRes.tiles || [];
          let combined = '';
          for (const t of tiles) {
            if (t.id === curId) {
              combined += (editor.value || '') + '\n\n';
            } else {
              try {
                const tileRes = await api.getTile(state.currentStory, t.id);
                if (tileRes && tileRes.ok) combined += (tileRes.content || '') + '\n\n';
              } catch (err) {
                console.warn('input: failed to load tile for counts', t.id, err);
              }
            }
          }
          refreshEntityLists(combined);
        } catch (err) {
          console.warn('input->refreshEntityLists for tile failed', err);
          refreshEntityLists();
        }
      })();
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
 // hide highlights until a story is opened
 if (highlightSection) highlightSection.style.display = 'none';

 // --- Auth: check session and show splash / login / logout ---
 const loginBtn = document.getElementById('loginBtn');
 const logoutBtn = document.getElementById('logoutBtn');
 const splashLoginBtn = document.getElementById('splashLoginBtn');
 const splashEl = document.getElementById('splash');

function applyAuthStatus(status) {
  const isAuth = status && status.authenticated;
  // If the user is authenticated but their email is not verified, inform them and log them out.
  // This prevents unverified accounts from using editing features.
  if (isAuth && status && status.user && status.user.email_verified === false) {
    try {
      // show a clear message and then redirect to /logout to end the session
      alert('Please verify your email address before using this service. You will be logged out.');
    } catch (e) {
      /* ignore alert failures in non-browser environments */
    }
    try { window.location.href = '/logout'; } catch (e) { /* ignore */ }
    return;
  }
  // show/hide login/logout buttons
  // prefer showing the user's email next to the Logout control (fallback to nickname/name when email missing)
  const emailStr = (status && status.user && status.user.email) ? status.user.email : '';
  const displayName = (status && status.user && (status.user.nickname || status.user.name))
    ? (status.user.nickname || status.user.name)
    : '';
   if (loginBtn) loginBtn.style.display = isAuth ? 'none' : 'inline-block';
   if (logoutBtn) {
     logoutBtn.style.display = isAuth ? 'inline-block' : 'none';
     // show the email (preferred) or displayName next to the logout action as a separate element
     const existingUserEl = document.getElementById('currentUserEmail');
     const labelText = emailStr || displayName || '';
     if (isAuth && labelText) {
       if (existingUserEl) {
         existingUserEl.textContent = labelText;
       } else {
         const span = document.createElement('span');
         span.id = 'currentUserEmail';
         span.style.marginRight = '8px';
         span.style.fontSize = '14px';
         span.style.fontWeight = '500';
         span.textContent = labelText;
         // insert the span immediately before the logout button
         if (logoutBtn && logoutBtn.parentNode) logoutBtn.parentNode.insertBefore(span, logoutBtn);
       }
       // keep the logout button text minimal — user sees email then [Log Out]
       logoutBtn.textContent = 'Log Out';
     } else {
       if (existingUserEl && existingUserEl.parentNode) existingUserEl.parentNode.removeChild(existingUserEl);
       logoutBtn.textContent = 'Log out';
     }
   }
   // show or hide the full-screen splash overlay
    if (splashEl) {
      splashEl.style.display = isAuth ? 'none' : 'flex';
      splashEl.setAttribute('aria-hidden', isAuth ? 'true' : 'false');
    }
    // enable/disable editing controls based on auth state
    const editable = !!isAuth;
    try { setEditorEnabled(editable && !!state.currentStory); } catch (e) {}
    if (createStoryBtn) createStoryBtn.disabled = !editable;
    if (createTileBtn) createTileBtn.disabled = !editable;
    if (createHighlightBtn) createHighlightBtn.disabled = !editable;
    if (saveBtn) saveBtn.disabled = !editable;
    // Publish button enabled only when authenticated and a story is open
    const publishBtn = document.getElementById('publishBtn');

    // updatePublishButtonState checks whether the Publish button should be enabled.
    // It enables the button only when:
    //  - the user is authenticated
    //  - a story is open
    //  - there is at least one tile whose content is non-empty
    async function updatePublishButtonState() {
      if (!publishBtn) return;
      if (!isAuth || !state.currentStory) {
        publishBtn.style.display = isAuth ? 'inline-block' : 'none';
        publishBtn.disabled = true;
        return;
      }
      publishBtn.style.display = 'inline-block';
      publishBtn.disabled = true; // assume disabled until we find a non-empty tile

      try {
        const listRes = await api.listTiles(state.currentStory);
        if (!listRes || !listRes.ok || !Array.isArray(listRes.tiles) || listRes.tiles.length === 0) {
          // no tiles -> keep disabled
          publishBtn.disabled = true;
          return;
        }
        for (const t of listRes.tiles) {
          try {
            const tileRes = await api.getTile(state.currentStory, t.id);
            if (tileRes && tileRes.ok) {
              const content = (tileRes.content || '').trim();
              if (content.length > 0) {
                publishBtn.disabled = false;
                return;
              }
            }
          } catch (e) {
            // ignore individual tile errors and continue checking others
          }
        }
        // no non-empty tiles found
        publishBtn.disabled = true;
      } catch (e) {
        // on error be permissive (enable) so users can still try to publish
        publishBtn.disabled = false;
      }
    }

    // Run an initial async check for publishability (do not block applyAuthStatus)
    try { updatePublishButtonState(); } catch (e) {}

  }

 // wire buttons to server-side /login and /logout
 if (loginBtn) loginBtn.addEventListener('click', () => { window.location.href = '/login'; });
 if (logoutBtn) logoutBtn.addEventListener('click', () => { window.location.href = '/logout'; });
 if (splashLoginBtn) splashLoginBtn.addEventListener('click', () => { window.location.href = '/login'; });

 // Publish button handler: triggers server-side publish but keeps the user in the editor.
 // The server returns the public URL; we show a non-intrusive notice and do NOT navigate.
 const publishBtnEl = document.getElementById('publishBtn');
 if (publishBtnEl) {
   publishBtnEl.addEventListener('click', async () => {
     if (!state.currentStory) return alert('Open a story first');
     const confirmPublish = confirm('Publish the current story? This will overwrite any previously published version.');
     if (!confirmPublish) return;
     try {
       publishBtnEl.disabled = true;
       publishBtnEl.textContent = 'Publishing...';
       const resp = await fetch(`/api/stories/${encodeURIComponent(state.currentStory)}/publish`, { method: 'POST' });
       const body = await resp.json().catch(() => null);
       if (!body || !body.ok) {
         const err = body && body.error ? body.error : 'Publish failed';
         alert(err);
         return;
       }
       // Keep user in the editor: show a confirmation with a clickable link they can open manually.
       if (body.url) {
         try {
           // convert the returned storage URL (/stories/.../published/name.md) into the friendly route /published/:user/:story
           let pubRoute = body.url;
           try {
             const u = body.url;
             // Expecting something like: /stories/<userId>/<storyId>/published/<name>.md
             const m = u.match(/^\/stories\/([^\/]+)\/([^\/]+)\/published\/([^\/]+)\.md$/);
             if (m) {
               const user = decodeURIComponent(m[1]);
               const story = decodeURIComponent(m[2]);
               pubRoute = `/published/${encodeURIComponent(user)}/${encodeURIComponent(story)}`;
             }
           } catch (e) {
             // fallback to body.url if parsing fails
             pubRoute = body.url;
           }

           // create a temporary dialog element to show the published link
           const infoId = 'publishInfo';
           let infoEl = document.getElementById(infoId);
           if (!infoEl) {
             infoEl = document.createElement('div');
             infoEl.id = infoId;
             infoEl.style.position = 'fixed';
             infoEl.style.right = '16px';
             infoEl.style.bottom = '16px';
             infoEl.style.background = '#0b6cff';
             infoEl.style.color = '#fff';
             infoEl.style.padding = '10px 12px';
             infoEl.style.borderRadius = '8px';
             infoEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
             infoEl.style.zIndex = 9999;
             document.body.appendChild(infoEl);
           }
           infoEl.innerHTML = `Published ✓ — <a href="${pubRoute}" target="_blank" style="color:#fff;text-decoration:underline">View story</a>`;
           // auto-dismiss after 10s
           setTimeout(() => {
             try { const el = document.getElementById(infoId); if (el) el.remove(); } catch (e) {}
           }, 10000);
         } catch (e) {
           // fallback: simple alert but still keep user in editor
           alert('Published. View at: ' + body.url);
         }
       } else {
         alert('Published, but no public URL returned');
       }
     } catch (e) {
       console.error('publish failed', e);
       alert('Publish failed');
     } finally {
       publishBtnEl.disabled = false;
       publishBtnEl.textContent = 'Publish';
     }
   });
 }

 // fetch auth status on load and apply UI state
 fetch('/api/auth-status').then(r => r.json()).then(s => {
   if (s && s.ok) applyAuthStatus(s);
   else applyAuthStatus({ authenticated: false });
 }).catch(e => {
   console.warn('auth-status fetch failed', e);
   applyAuthStatus({ authenticated: false });
 });

(function() {
  // ensure #tag pills are rendered any time the preview DOM is updated while viewing the full concatenated tiles.
  // This is more robust than trying to call renderTags at every injection site.
  try {
    if (typeof MutationObserver !== 'undefined' && preview) {
      const mo = new MutationObserver((mutations) => {
        try {
          if (state.currentView && state.currentView.type === 'full') {
            // render tags in the preview whenever its children change
            renderTags(preview);
          }
        } catch (err) {
          console.warn('preview MutationObserver handler error', err);
        }
      });
      mo.observe(preview, { childList: true, subtree: true });
      // expose so tests or cleanup can disconnect if necessary
      window._previewMutationObserver = mo;
    }
  } catch (e) {
    console.warn('init preview MutationObserver failed', e);
  }
})();

 // expose for debugging
window._storyWriter = { state, refreshStories, openStory, saveMainText };

(function() {
  // Sidebar splitter: allow resizing Stories / Tiles / Highlights panes vertically.
  try {
    const sidebar = document.getElementById('sidebar');
    const storiesPane = document.getElementById('storiesPane');
    const tilesPane = document.getElementById('tilesPane');
    const highlightsPane = document.getElementById('highlightsPane');
    const splitter12 = document.querySelector('.splitter[data-split="stories-tiles"]');
    const splitter23 = document.querySelector('.splitter[data-split="tiles-highlights"]');

    if (sidebar && storiesPane && tilesPane && highlightsPane && splitter12 && splitter23) {
      const setDefaultHeights = () => {
        const h = sidebar.clientHeight || sidebar.offsetHeight;
        const third = Math.max(80, Math.floor(h / 3));
        storiesPane.style.height = third + 'px';
        tilesPane.style.height = third + 'px';
        highlightsPane.style.height = Math.max(80, h - 2 * third) + 'px';
      };
      // initial sizing
      setDefaultHeights();
      // recompute on window resize to keep sensible layout
      window.addEventListener('resize', setDefaultHeights);

      function setupSplitter(splitter, upperPane, lowerPane) {
        let startY = 0;
        let startUpperH = 0;
        let startLowerH = 0;
        let dragging = false;

        const onMouseMove = (e) => {
          if (!dragging) return;
          const dy = e.clientY - startY;
          const newUpper = Math.max(60, startUpperH + dy);
          const newLower = Math.max(60, startLowerH - dy);
          upperPane.style.height = newUpper + 'px';
          lowerPane.style.height = newLower + 'px';
        };

        const onMouseUp = () => {
          if (!dragging) return;
          dragging = false;
          document.body.classList.remove('resizing');
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        splitter.addEventListener('mousedown', (e) => {
          e.preventDefault();
          dragging = true;
          startY = e.clientY;
          startUpperH = upperPane.getBoundingClientRect().height;
          startLowerH = lowerPane.getBoundingClientRect().height;
          document.body.classList.add('resizing');
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        });
      }

      setupSplitter(splitter12, storiesPane, tilesPane);
      setupSplitter(splitter23, tilesPane, highlightsPane);
    }
  } catch (e) {
    console.warn('sidebar splitter init failed', e);
  }
})();
