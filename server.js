require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { auth, requiresAuth } = require('express-openid-connect');

const app = express();
app.use(cors());
app.use(express.json());

const STORIES_ROOT = path.join(__dirname, 'stories');

 // Local mode detection: if the .env file is missing OR required Auth0 env vars are absent
 // we run in a local developer mode where authentication is simulated. This keeps the
 // existing Auth0 integration intact for production but allows a friction-free local workflow.
 const _envExists = fs.existsSync(path.join(__dirname, '.env'));
 const _hasAuthVars = !!(process.env.AUTH0_CLIENT_ID && process.env.AUTH0_ISSUER_BASE_URL);
 const LOCAL_MODE = (!_envExists) || (!_hasAuthVars);

// ensure stories dir exists
if (!fs.existsSync(STORIES_ROOT)) {
  fs.mkdirSync(STORIES_ROOT, { recursive: true });
}

 // serve frontend under /write
 app.use('/write', express.static(path.join(__dirname, 'public')));
 // Public listing at / showing published stories (no authentication required).
 // This scans each user's folder for a published/<story>.md file and lists available published stories.
 app.get('/', (req, res) => {
   try {
     const published = [];
     const users = fs.readdirSync(STORIES_ROOT, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
     for (const u of users) {
       const userPath = path.join(STORIES_ROOT, u);
       // skip non-directories or special files
       try {
         const stories = fs.readdirSync(userPath, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
         for (const s of stories) {
           const pubPath = path.join(userPath, s, 'published', `${safeName(s)}.md`);
           if (fs.existsSync(pubPath)) {
             published.push({ user: u, story: s, url: `/published/${encodeURIComponent(u)}/${encodeURIComponent(s)}` });
           }
         }
       } catch (e) {
         // ignore user folder read errors and continue with others
       }
     }
     let html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Published stories</title><style>body{font-family:Arial,Helvetica,sans-serif;max-width:900px;margin:32px auto;padding:0 16px}h1{margin-top:0}ul{line-height:1.6}.write-btn{display:inline-block;margin:8px 0;padding:8px 12px;background:#2b7cff;color:#fff;border-radius:6px;text-decoration:none}</style></head><body>';
     html += '<h1>Published stories</h1><p><a href="/write" class="write-btn">Write</a></p>';
     if (published.length === 0) {
       html += '<p>No published stories yet.</p>';
     } else {
       html += '<ul>';
       for (const p of published) {
         html += `<li><strong>${p.user}</strong> — <a href="${p.url}">${p.story}</a></li>`;
       }
       html += '</ul>';
     }
     html += '</body></html>';
     res.send(html);
   } catch (err) {
     res.status(500).send('failed to generate published list');
   }
 });

 // configure express-openid-connect using values from .env (if present)
 // see .env for AUTH0_AUTH_REQUIRED, AUTH0_AUTH0LOGOUT, SECRET, AUTH0_BASEURL, AUTH0_CLIENT_ID, AUTH0_ISSUER_BASE_URL
 const authConfig = {
   authRequired: (process.env.AUTH0_AUTH_REQUIRED === 'true'),
   auth0Logout: (process.env.AUTH0_AUTH0LOGOUT === 'true'),
   secret: process.env.SECRET || 'replace-with-a-long-secret',
   baseURL: process.env.AUTH0_BASEURL || `http://localhost:${process.env.PORT || 3000}`,
   clientID: process.env.AUTH0_CLIENT_ID || '',
   issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL || ''
 };

 // attach auth router (adds /login, /logout, /callback)
 // In LOCAL_MODE we skip mounting the express-openid-connect auth router because
 // it validates required config (clientID, issuer) at init and will throw when
 // those values are empty. When running locally without a .env we simulate auth
 // via /api/auth-status instead.
 if (!LOCAL_MODE) {
   app.use(auth(authConfig));
 } else {
   console.warn('[server] running in LOCAL_MODE: Auth0 integration disabled, simulating auth via /api/auth-status');
 }
 
 // requireAuth middleware: protect API routes server-side
 // In LOCAL_MODE we allow requests and stub a minimal req.oidc so downstream code can
 // rely on req.oidc.user / req.oidc.isAuthenticated() without additional checks.
 function requireAuth(req, res, next) {
   try {
     if (LOCAL_MODE) {
       // ensure a minimal req.oidc shape so resolveUserIdFromReq and other helpers work.
       req.oidc = req.oidc || {};
       req.oidc.isAuthenticated = () => true;
       req.oidc.user = req.oidc.user || { name: 'localuser', nickname: 'localuser', email: null, email_verified: true };
       return next();
     }
     if (req && req.oidc && req.oidc.isAuthenticated && req.oidc.isAuthenticated()) {
       return next();
     }
     return res.status(401).json({ ok: false, error: 'Authentication required' });
   } catch (e) {
     return res.status(401).json({ ok: false, error: 'Authentication required' });
   }
 }
 
 // public endpoint returning auth status for the current browser session
app.get('/api/auth-status', (req, res) => {
  try {
    // If running in local mode (no .env), return a simulated authenticated user.
    if (LOCAL_MODE) {
      return res.json({
        ok: true,
        authenticated: true,
        localMode: true,
        user: {
          name: 'localuser',
          nickname: 'localuser',
          email: null,
          email_verified: true
        },
        loginUrl: null,
        logoutUrl: null
      });
    }

    const isAuth = !!(req && req.oidc && req.oidc.isAuthenticated && req.oidc.isAuthenticated());
    const user = isAuth && req.oidc && req.oidc.user ? {
      name: req.oidc.user.name || null,
      nickname: req.oidc.user.nickname || null,
      email: req.oidc.user.email || null,
      // normalize to boolean (may be undefined)
      email_verified: !!req.oidc.user.email_verified
    } : null;
    res.json({
      ok: true,
      authenticated: isAuth,
      user,
      loginUrl: '/login',
      logoutUrl: '/logout'
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'failed to determine auth status' });
  }
});
 
 // profile endpoint — requires authentication and returns the OIDC user profile
 app.get('/profile', requiresAuth(), (req, res) => {
   try {
     return res.json(req.oidc && req.oidc.user ? req.oidc.user : {});
   } catch (e) {
     return res.status(500).json({ ok: false, error: 'failed to read profile' });
   }
 });
 
 // serve story images via guarded route (do NOT expose STORIES_ROOT directly).
 // This endpoint replaces the previous app.use('/stories', ...) static mount so we can
 // enforce "published-or-owner" access control for any file under /stories/...
 //
 // Example incoming paths this handler will accept:
 //  - /stories/<userId>/<storyId>/images/<sub>/<file>
 //  - /stories/<userId>/<storyId>/published/<name>.md
 //  - any other path under /stories/... that maps to STORIES_ROOT/<...>
 //
 // The handler works by resolving the requested path under STORIES_ROOT, ensuring
 // it is inside that directory, then deciding access based on:
 //  - published file exists (public)
 //  - or authenticated request and requester resolves to the same userId (owner)
 //
 function isPublished(userId, storyId) {
   try {
     if (!userId || !storyId) return false;
     const pubPath = path.join(STORIES_ROOT, userId, safeName(storyId), 'published', `${safeName(storyId)}.md`);
     return fs.existsSync(pubPath);
   } catch (e) { return false; }
 }
 
 function canAccessPublishedOrOwner(req, userId, storyId) {
   // published content is public
   try {
     if (isPublished(userId, storyId)) return true;
     // otherwise require authenticated owner
     if (req && req.oidc && req.oidc.isAuthenticated && req.oidc.isAuthenticated()) {
       // resolve auth userId (may create user folder if not present - acceptable here)
       try {
         const auth = resolveUserIdFromReq(req);
         if (auth && auth.userId && userId && auth.userId === userId) return true;
       } catch (e) {
         return false;
       }
     }
   } catch (e) { /* fall through */ }
   return false;
 }
 
 app.get('/stories/*', (req, res) => {
   try {
     // Allow unrestricted access in LOCAL_MODE to simplify local development (images and published pages).
     // In production (LOCAL_MODE === false) the original access checks below still apply.
     if (LOCAL_MODE) {
       // req.params[0] contains the wildcard path after /stories/
       const rel = req.params[0] || '';
       // normalize and prevent path traversal
       const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
       const full = path.join(STORIES_ROOT, normalized);
       // ensure resolved path is inside STORIES_ROOT
       const rootResolved = path.resolve(STORIES_ROOT) + path.sep;
       const fullResolved = path.resolve(full);
       if (!fullResolved.startsWith(rootResolved)) return res.status(404).send('not found');
       if (!fs.existsSync(fullResolved)) return res.status(404).send('not found');
       return res.sendFile(fullResolved);
     }
     // req.params[0] contains the wildcard path after /stories/
     const rel = req.params[0] || '';
     // normalize and prevent path traversal
     const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
     const full = path.join(STORIES_ROOT, normalized);
     // ensure resolved path is inside STORIES_ROOT
     const rootResolved = path.resolve(STORIES_ROOT) + path.sep;
     const fullResolved = path.resolve(full);
     if (!fullResolved.startsWith(rootResolved)) return res.status(404).send('not found');
     if (!fs.existsSync(fullResolved)) return res.status(404).send('not found');
 
     // Determine probable userId and storyId from the path segments if available:
     const parts = normalized.split(path.sep).filter(Boolean);
     const userId = parts.length >= 1 ? parts[0] : null;
     const storyId = parts.length >= 2 ? parts[1] : null;
 
     // If we can determine a userId/storyId, enforce published-or-owner.
     // If not (edge cases), be conservative and deny access unless file is in a published folder.
     if (userId && storyId) {
       if (!canAccessPublishedOrOwner(req, userId, storyId)) return res.status(403).send('forbidden');
     } else {
       // fallback: if file path contains "/published/" allow, else deny
       if (!normalized.includes(path.join('published', '/'))) {
         return res.status(403).send('forbidden');
       }
     }
 
     return res.sendFile(fullResolved);
   } catch (e) {
     return res.status(500).send('error');
   }
 });

function safeName(name) {
  // very simple sanitization: remove path separators
  return name.replace(/[/\\?%*:|"<>]/g, '-');
}

function storyPath(name) {
  return path.join(STORIES_ROOT, safeName(name));
}

 // Helper to escape HTML for safe embedding in server-rendered pages
 function escapeHtml(s) {
   return String(s || '')
     .replace(/&/g, '&')
     .replace(/</g, '<')
     .replace(/>/g, '>');
 }

// Typographic transforms helper (server-side):
// - "..." -> …
// - "--"  -> —
// - straight double quotes " -> smart quotes “ ” (simple alternating heuristic)
// Skips <code>...</code> spans by temporarily replacing them with placeholders.
function typographicTransform(s) {
  if (!s || typeof s !== 'string') return s;
  const placeholders = [];
  s = s.replace(/<code>[\s\S]*?<\/code>/g, (m) => {
    const key = `__CODE_PLACEHOLDER_${placeholders.length}__`;
    placeholders.push(m);
    return key;
  });

  // ellipses
  s = s.replace(/\.{3}/g, '…');
  // em-dash
  s = s.replace(/--/g, '—');

  // smart double quotes (toggle heuristic)
  let out = '';
  let open = true;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      out += open ? '“' : '”';
      open = !open;
    } else {
      out += ch;
    }
  }
  s = out;

  // restore code placeholders
  s = s.replace(/__CODE_PLACEHOLDER_(\d+)__/g, (_m, idx) => placeholders[Number(idx)] || '');
  return s;
}

function ensureStoryStructure(name) {
  const base = storyPath(name);
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }

  // Create a minimal project.json for explicit metadata (helps future features)
  const projectMetaPath = path.join(base, 'project.json');
  if (!fs.existsSync(projectMetaPath)) {
    try {
      const meta = { name: name, createdAt: new Date().toISOString(), version: 1 };
      fs.writeFileSync(projectMetaPath, JSON.stringify(meta, null, 2), 'utf8');
    } catch (e) {
      // ignore write errors here; higher-level handlers will surface problems
    }
  }

  // ensure highlights directory exists (per-highlight markdown files)
  const highlightsDir = path.join(base, 'highlights');
  if (!fs.existsSync(highlightsDir)) {
    fs.mkdirSync(highlightsDir, { recursive: true });
  }

  // create images subfolders (only highlights now)
  const imgs = path.join(base, 'images');
  const imgSub = ['highlights'];
  for (const s of imgSub) {
    const p = path.join(imgs, s);
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
  }

  // create tiles folder and minimal tiles.json (ordered array of {id,title})
  const tilesDir = path.join(base, 'tiles');
  if (!fs.existsSync(tilesDir)) {
    fs.mkdirSync(tilesDir, { recursive: true });
  }
  const tilesMeta = path.join(tilesDir, 'tiles.json');
  if (!fs.existsSync(tilesMeta)) {
    try {
      fs.writeFileSync(tilesMeta, JSON.stringify([], null, 2), 'utf8');
    } catch (e) {
      // ignore write errors here; higher-level handlers will surface problems
    }
  }
}

/**
 * Helpers for per-user storage and usage
 */

function nicknameFromEmail(email) {
  if (!email) return null;
  const local = String(email).split('@')[0] || email;
  return safeName(local);
}

function shortHash(email) {
  return crypto.createHash('sha256').update(String(email)).digest('hex').slice(0, 8);
}

function resolveUserIdFromReq(req) {
  // In local mode, map all requests to the 'localuser' account.
  if (LOCAL_MODE) {
    const nick = 'localuser';
    const baseCandidate = path.join(STORIES_ROOT, nick);
    if (!fs.existsSync(baseCandidate)) {
      fs.mkdirSync(baseCandidate, { recursive: true });
      const meta = { name: 'localuser', createdAt: new Date().toISOString() };
      try { fs.writeFileSync(path.join(baseCandidate, 'user.json'), JSON.stringify(meta, null, 2), 'utf8'); } catch (e) {}
    }
    return { userId: nick, userPath: baseCandidate };
  }

  if (!req || !req.oidc || !req.oidc.user || !req.oidc.user.email) {
    throw new Error('authenticated user email required');
  }
  const email = String(req.oidc.user.email).toLowerCase();
  const nick = nicknameFromEmail(email) || safeName(email);
  const baseCandidate = path.join(STORIES_ROOT, nick);
  if (!fs.existsSync(baseCandidate)) {
    fs.mkdirSync(baseCandidate, { recursive: true });
    const meta = { email, name: req.oidc.user.nickname || req.oidc.user.name || null, createdAt: new Date().toISOString() };
    try { fs.writeFileSync(path.join(baseCandidate, 'user.json'), JSON.stringify(meta, null, 2), 'utf8'); } catch (e) {}
    return { userId: nick, userPath: baseCandidate };
  }
  const metaPath = path.join(baseCandidate, 'user.json');
  if (fs.existsSync(metaPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '{}');
      if (m.email && String(m.email).toLowerCase() === email) {
        return { userId: nick, userPath: baseCandidate };
      }
      // collision => create suffixed folder
      const newId = `${nick}__${shortHash(email)}`;
      const newPath = path.join(STORIES_ROOT, newId);
      if (!fs.existsSync(newPath)) fs.mkdirSync(newPath, { recursive: true });
      const meta = { email, name: req.oidc.user.nickname || req.oidc.user.name || null, createdAt: new Date().toISOString() };
      try { fs.writeFileSync(path.join(newPath, 'user.json'), JSON.stringify(meta, null, 2), 'utf8'); } catch (e) {}
      return { userId: newId, userPath: newPath };
    } catch (e) {
      const newId = `${nick}__${shortHash(email)}`;
      const newPath = path.join(STORIES_ROOT, newId);
      if (!fs.existsSync(newPath)) fs.mkdirSync(newPath, { recursive: true });
      const meta = { email, name: req.oidc.user.nickname || req.oidc.user.name || null, createdAt: new Date().toISOString() };
      try { fs.writeFileSync(path.join(newPath, 'user.json'), JSON.stringify(meta, null, 2), 'utf8'); } catch (e2) {}
      return { userId: newId, userPath: newPath };
    }
  } else {
    const newId = `${nick}__${shortHash(email)}`;
    const newPath = path.join(STORIES_ROOT, newId);
    if (!fs.existsSync(newPath)) fs.mkdirSync(newPath, { recursive: true });
    const meta = { email, name: req.oidc.user.nickname || req.oidc.user.name || null, createdAt: new Date().toISOString() };
    try { fs.writeFileSync(path.join(newPath, 'user.json'), JSON.stringify(meta, null, 2), 'utf8'); } catch (e) {}
    return { userId: newId, userPath: newPath };
  }
}

function resolveUserAndBase(req, storyName) {
  const { userId, userPath } = resolveUserIdFromReq(req);
  const base = path.join(userPath, safeName(storyName));
  return { userId, base, userPath };
}

// Flexible resolver: supports either the current authenticated user's stories
// (default behavior) or an explicit user-prefixed name like "userId/storyName".
// This helps when the frontend or direct requests sometimes pass "user/story".
function resolveBaseFlexible(req, storyName) {
  if (!storyName || typeof storyName !== 'string') {
    return resolveUserAndBase(req, storyName);
  }
  // If the caller provided an explicit user prefix (userId/story), honor it.
  // Use the first path segment as userId and the rest as the story name.
  if (storyName.indexOf('/') !== -1) {
    const parts = storyName.split('/');
    const userId = parts.shift();
    const name = parts.join('/');
    const base = path.join(STORIES_ROOT, userId, safeName(name));
    const userPath = path.join(STORIES_ROOT, userId);
    return { userId, base, userPath };
  }
  // Fallback to resolving from the authenticated user
  return resolveUserAndBase(req, storyName);
}

function ensureUserStoryStructure(userPath, storyName) {
  const base = path.join(userPath, safeName(storyName));
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  // ensure highlights directory exists (per-highlight markdown files)
  const highlightsDir = path.join(base, 'highlights');
  if (!fs.existsSync(highlightsDir)) {
    fs.mkdirSync(highlightsDir, { recursive: true });
  }
  const imgs = path.join(base, 'images');
  const imgSub = ['highlights'];
  for (const s of imgSub) {
    const p = path.join(imgs, s);
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
  }
  const tilesDir = path.join(base, 'tiles');
  if (!fs.existsSync(tilesDir)) {
    fs.mkdirSync(tilesDir, { recursive: true });
  }
  const tilesMeta = path.join(tilesDir, 'tiles.json');
  if (!fs.existsSync(tilesMeta)) {
    try {
      fs.writeFileSync(tilesMeta, JSON.stringify([], null, 2), 'utf8');
    } catch (e) {
      // ignore
    }
  }
}

// compute total bytes used by a user's folder (recursively)
function getUserUsageBytes(userId) {
  const userPath = path.join(STORIES_ROOT, userId);
  let total = 0;
  if (!fs.existsSync(userPath)) return 0;
  const walk = (p) => {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const cur = path.join(p, ent.name);
      if (ent.isDirectory()) walk(cur);
      else {
        try { total += fs.statSync(cur).size; } catch (e) {}
      }
    }
  };
  walk(userPath);
  return total;
}

app.get('/api/stories', requireAuth, (req, res) => {
  try {
    const { userId, userPath } = resolveUserIdFromReq(req);
    const items = fs.readdirSync(userPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ id: d.name, name: d.name }));
    res.json({ ok: true, stories: items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Create story
app.post('/api/stories', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
  const nm = safeName(name);
  try {
    const { userId, userPath } = resolveUserIdFromReq(req);
    const base = path.join(userPath, nm);
    if (fs.existsSync(base)) {
      return res.status(409).json({ ok: false, error: 'story already exists' });
    }
    ensureUserStoryStructure(userPath, nm);
    res.json({ ok: true, id: nm, name: nm });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Rename story
app.post('/api/stories/:name/rename', requireAuth, (req, res) => {
  const oldName = req.params.name;
  const { newName } = req.body || {};
  if (!newName) return res.status(400).json({ ok: false, error: 'newName is required' });
  const from = storyPath(oldName);
  const to = storyPath(newName);
  if (!fs.existsSync(from)) return res.status(404).json({ ok: false, error: 'story not found' });
  if (fs.existsSync(to)) return res.status(409).json({ ok: false, error: 'target name already exists' });
  try {
    fs.renameSync(from, to);
    res.json({ ok: true, name: newName });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

 // Get story content (characters, locations) and image lists
 app.get('/api/stories/:name', requireAuth, (req, res) => {
   const name = req.params.name;
   const { userId, base } = resolveBaseFlexible(req, name);
   if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
    try {
      // Aggregate per-highlight files from the highlights/ directory (no more highlights.md)
      const highlightsDir = path.join(base, 'highlights');
      let highlights = '';
      if (fs.existsSync(highlightsDir)) {
        // read files in stable order (by mtime then name) to produce consistent concatenation
        const files = fs.readdirSync(highlightsDir, { withFileTypes: true })
          .filter(d => d.isFile() && d.name.endsWith('.md'))
          .map(d => d.name);
        // sort files by name for determinism
        files.sort();
        for (const fn of files) {
          try {
            const fp = path.join(highlightsDir, fn);
            const txt = fs.readFileSync(fp, 'utf8') || '';
            // ensure sections are separated by blank lines
            highlights += (highlights ? '\n\n' : '') + txt.trim();
          } catch (e) {
            // ignore individual highlight read errors
          }
        }
      } else {
        highlights = '';
      }

      const imagesDir = path.join(base, 'images');
      const imageList = {};
      if (fs.existsSync(imagesDir)) {
        for (const sub of ['highlights']) {
          const p = path.join(imagesDir, sub);
          if (!fs.existsSync(p)) {
            imageList[sub] = [];
          } else {
            imageList[sub] = fs.readdirSync(p).map(fn => '/' + ['stories', encodeURIComponent(userId), encodeURIComponent(safeName(name)), 'images', encodeURIComponent(sub), encodeURIComponent(fn)].join('/'));
          }
        }
      }
      res.json({ ok: true, name, highlights, images: imageList });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
 });

/*
  Highlights API - per-highlight markdown files stored under:
    stories/<userId>/<story>/highlights/<id>.md

  Endpoints:
    GET    /api/stories/:name/highlights           -> list highlights
    GET    /api/stories/:name/highlights/:id       -> get highlight content
    POST   /api/stories/:name/highlights           -> create highlight { title, content }
    POST   /api/stories/:name/highlights/:id/save  -> save content { content }
    POST   /api/stories/:name/highlights/:id/rename -> rename { newName }
    DELETE /api/stories/:name/highlights/:id      -> delete highlight
*/
app.get('/api/stories/:name/highlights', requireAuth, (req, res) => {
  const name = req.params.name;
  try {
    const { userId, base } = resolveBaseFlexible(req, name);
    if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });

    const dir = path.join(base, 'highlights');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const metaPath = path.join(dir, 'highlights.json');
    // If highlights.json missing, return empty list per spec (no backwards compatibility)
    if (!fs.existsSync(metaPath)) return res.json({ ok: true, highlights: [] });

    let meta = [];
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { meta = []; }

    // enrich with mtime if file present
    const list = meta.map(item => {
      const fp = path.join(dir, item.id + '.md');
      let mtime = 0;
      try { mtime = fs.existsSync(fp) ? fs.statSync(fp).mtimeMs || 0 : 0; } catch (e) { mtime = 0; }
      return { id: item.id, title: item.title, mtime };
    });

    res.json({ ok: true, highlights: list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/stories/:name/highlights/:id', requireAuth, (req, res) => {
  const name = req.params.name;
  const id = req.params.id;
  try {
    const { userId, base } = resolveBaseFlexible(req, name);
    if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });

    const dir = path.join(base, 'highlights');
    const metaPath = path.join(dir, 'highlights.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ ok: false, error: 'highlights metadata not found' });

    let meta = [];
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { meta = []; }
    const entry = meta.find(m => m.id === id);
    if (!entry) return res.status(404).json({ ok: false, error: 'highlight not found' });

    const filename = path.join(dir, id + '.md');
    let content = '';
    if (fs.existsSync(filename)) {
      try { content = fs.readFileSync(filename, 'utf8'); } catch (e) { content = ''; }
    }

    res.json({ ok: true, id, title: entry.title, content });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/stories/:name/highlights', requireAuth, (req, res) => {
  const name = req.params.name;
  const { title, content } = req.body || {};
  if (!title) return res.status(400).json({ ok: false, error: 'title is required' });
  try {
    const { userId, base } = resolveBaseFlexible(req, name);
    if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });

    const dir = path.join(base, 'highlights');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const metaPath = path.join(dir, 'highlights.json');
    let meta = [];
    try { meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]') : []; } catch (e) { meta = []; }

    // Prevent creating a highlight with a title that already exists (case-insensitive, trimmed)
    const normalizedTitle = String(title || '').trim().toLowerCase();
    if (normalizedTitle.length > 0) {
      const dup = meta.find(m => m && m.title && String(m.title).trim().toLowerCase() === normalizedTitle);
      if (dup) {
        return res.status(409).json({ ok: false, error: 'another highlight with that name already exists' });
      }
    }

    let id = safeName(title) || String(Date.now());
    // ensure uniqueness within meta
    let candidate = id;
    let suffix = 1;
    while (meta.find(m => m.id === candidate)) {
      candidate = `${id}-${suffix++}`;
    }
    id = candidate;

    // write file (empty by default if no content provided)
    const out = (typeof content === 'string') ? content : '';
    fs.writeFileSync(path.join(dir, id + '.md'), out, 'utf8');

    // append to highlights.json
    const now = Date.now();
    meta.push({ id, title, mtime: now });
    try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8'); } catch (e) {}

    res.json({ ok: true, id, title });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/stories/:name/highlights/:id/save', requireAuth, (req, res) => {
  const name = req.params.name;
  const id = req.params.id;
  const { content } = req.body || {};
  if (typeof content !== 'string') return res.status(400).json({ ok: false, error: 'content required' });
  try {
    const { userId, base } = resolveBaseFlexible(req, name);
    if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });

    const dir = path.join(base, 'highlights');
    const metaPath = path.join(dir, 'highlights.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ ok: false, error: 'highlights metadata not found' });

    let meta = [];
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { meta = []; }
    const entry = meta.find(m => m.id === id);
    if (!entry) return res.status(404).json({ ok: false, error: 'highlight not found' });

    const filename = path.join(dir, id + '.md');
    fs.writeFileSync(filename, content, 'utf8');

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Rename highlight title and optional propagation (search & replace).
 *
 * New endpoints:
 *  - GET  /api/stories/:name/highlights/:id/rename-preview?newName=... 
 *      -> returns a dry-run preview of matches in tiles/*.md and highlights/*.md
 *  - POST /api/stories/:name/highlights/:id/rename
 *      body: { newName, propagate: true|false }
 *      -> updates highlights.json title and, if propagate, replaces whole-word case-sensitive matches
 *         in tiles/*.md and highlights/*.md (NOT reversible).
 */
app.get('/api/stories/:name/highlights/:id/rename-preview', requireAuth, (req, res) => {
  const name = req.params.name;
  const id = req.params.id;
  const newName = req.query.newName;
  if (!newName) return res.status(400).json({ ok: false, error: 'newName query param required' });

  try {
    const { userId, base } = resolveBaseFlexible(req, name);
    if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });

    const dir = path.join(base, 'highlights');
    const metaPath = path.join(dir, 'highlights.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ ok: false, error: 'highlights metadata not found' });

    let meta = [];
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { meta = []; }

    // Prevent duplicate highlight titles on rename (case-insensitive, trimmed).
    const normalizedNew = String(newName || '').trim().toLowerCase();
    if (normalizedNew.length > 0) {
      const duplicate = meta.find(m =>
        m && m.id && m.title &&
        m.id !== id && String(m.title).trim().toLowerCase() === normalizedNew
      );
      if (duplicate) {
        return res.status(409).json({ ok: false, error: 'another highlight with that name already exists' });
      }
    }

    const entry = meta.find(m => m.id === id);
    if (!entry) return res.status(404).json({ ok: false, error: 'highlight not found' });

    const oldName = entry.title || id;
    // build whole-word, case-sensitive regex using escaped oldName
    const escapeForRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escapeForRegex(oldName)}\\b`, 'g');

    const scanDirs = ['tiles', 'highlights'];
    const filesResult = [];
    let totalMatches = 0;

    for (const sub of scanDirs) {
      const p = path.join(base, sub);
      if (!fs.existsSync(p)) continue;
      const ents = fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith('.md')).map(d => d.name);
      for (const fn of ents) {
        const fp = path.join(p, fn);
        let txt = '';
        try { txt = fs.readFileSync(fp, 'utf8') || ''; } catch (e) { continue; }
        const lines = String(txt).split(/\r?\n/);
        const matches = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const m = line.match(re);
          if (m && m.length) {
            totalMatches += m.length;
            // capture a snippet with context
            const snippet = line.trim().slice(0, 240);
            matches.push({ line: i + 1, snippet, count: m.length });
          }
        }
        if (matches.length) {
          filesResult.push({ path: path.relative(base, fp), matches });
        }
      }
    }

    return res.json({ ok: true, totalMatches, files: filesResult });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/stories/:name/highlights/:id/rename', requireAuth, (req, res) => {
  const name = req.params.name;
  const id = req.params.id;
  const { newName, propagate } = req.body || {};
  if (!newName) return res.status(400).json({ ok: false, error: 'newName is required' });
  try {
    const { userId, base } = resolveBaseFlexible(req, name);
    if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });

    const dir = path.join(base, 'highlights');
    const metaPath = path.join(dir, 'highlights.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ ok: false, error: 'highlights metadata not found' });

    let meta = [];
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { meta = []; }
    const entry = meta.find(m => m.id === id);
    if (!entry) return res.status(404).json({ ok: false, error: 'highlight not found' });

    const oldName = entry.title || id;

    // Update metadata title first (authoritative)
    entry.title = newName;
    entry.mtime = Date.now();
    try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8'); } catch (e) {}

    // If propagate requested, perform whole-word, case-sensitive replacements in tiles/*.md and highlights/*.md
    const resultSummary = { totalReplacements: 0, filesChanged: [] };
    if (propagate) {
      const escapeForRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escapeForRegex(oldName)}\\b`, 'g'); // case-sensitive, whole-word
      const scanDirs = ['tiles', 'highlights'];

      for (const sub of scanDirs) {
        const p = path.join(base, sub);
        if (!fs.existsSync(p)) continue;
        const ents = fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith('.md')).map(d => d.name);
        for (const fn of ents) {
          const fp = path.join(p, fn);
          let txt = '';
          try { txt = fs.readFileSync(fp, 'utf8') || ''; } catch (e) { continue; }
          const matches = txt.match(re);
          if (!matches || matches.length === 0) continue;
          const replacements = matches.length;
          const newTxt = txt.replace(re, newName);
          // atomic write
          try {
            const tmp = fp + '.tmp';
            fs.writeFileSync(tmp, newTxt, 'utf8');
            fs.renameSync(tmp, fp);
            resultSummary.totalReplacements += replacements;
            resultSummary.filesChanged.push({ path: path.relative(base, fp), replacements });
          } catch (e) {
            // on failure, abort and return error to avoid partial silent corruption
            return res.status(500).json({ ok: false, error: 'failed to write updated file: ' + fp });
          }
        }
      }
    }

    return res.json({ ok: true, id, title: newName, propagate: !!propagate, summary: resultSummary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/stories/:name/highlights/:id', requireAuth, (req, res) => {
  const name = req.params.name;
  const id = req.params.id;
  try {
    const { userId, base } = resolveBaseFlexible(req, name);
    if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });

    const dir = path.join(base, 'highlights');
    const metaPath = path.join(dir, 'highlights.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ ok: false, error: 'highlights metadata not found' });

    let meta = [];
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { meta = []; }
    const idx = meta.findIndex(m => m.id === id);
    if (idx !== -1) meta.splice(idx, 1);
    try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8'); } catch (e) {}

    const filename = path.join(dir, id + '.md');
    if (fs.existsSync(filename)) fs.unlinkSync(filename);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

 // Tiles API: minimal per-story tile storage (stories/<name>/tiles/, stories/<name>/tiles/tiles.json)
app.get('/api/stories/:name/tiles', requireAuth, (req, res) => {
  const name = req.params.name;
  const { userId, base } = resolveUserAndBase(req, name);
  if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
   try {
     const tilesDir = path.join(base, 'tiles');
     const metaPath = path.join(tilesDir, 'tiles.json');
     let tiles = [];
     if (fs.existsSync(metaPath)) {
       try { tiles = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { tiles = []; }
     }
     res.json({ ok: true, tiles });
   } catch (err) {
     res.status(500).json({ ok: false, error: err.message });
   }
 });

 // Create a new tile
app.post('/api/stories/:name/tiles', requireAuth, (req, res) => {
  const name = req.params.name;
  const { title, content } = req.body || {};
  const { userId, base, userPath } = resolveBaseFlexible(req, name);
  // ensure story exists (create structure if missing) so tile creation works reliably
  if (!fs.existsSync(base)) {
    try {
      ensureUserStoryStructure(userPath, name);
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'failed to create story structure' });
    }
  }
   try {
     const tilesDir = path.join(base, 'tiles');
     if (!fs.existsSync(tilesDir)) fs.mkdirSync(tilesDir, { recursive: true });
     const metaPath = path.join(tilesDir, 'tiles.json');
     let tiles = [];
     if (fs.existsSync(metaPath)) {
       try { tiles = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { tiles = []; }
     }
     const id = String(Date.now()) + '-' + Math.floor(Math.random() * 10000);
     const safeId = safeName(id);
     const filename = path.join(tilesDir, safeId + '.md');
     fs.writeFileSync(filename, content || '', 'utf8');
     const entry = { id: safeId, title: (title || '') };
     tiles.push(entry);
     fs.writeFileSync(metaPath, JSON.stringify(tiles, null, 2), 'utf8');
     res.json({ ok: true, id: safeId, tile: entry });
   } catch (err) {
     res.status(500).json({ ok: false, error: err.message });
   }
 });

 // Get single tile content
app.get('/api/stories/:name/tiles/:id', requireAuth, (req, res) => {
  const name = req.params.name;
  const id = req.params.id;
  const { userId, base } = resolveUserAndBase(req, name);
  if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
   try {
     const tilesDir = path.join(base, 'tiles');
     const metaPath = path.join(tilesDir, 'tiles.json');
     let tiles = [];
     if (fs.existsSync(metaPath)) {
       try { tiles = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { tiles = []; }
     }
     const meta = tiles.find(t => t.id === id) || { id, title: '' };
     const filename = path.join(tilesDir, id + '.md');
     let content = '';
     if (fs.existsSync(filename)) {
       content = fs.readFileSync(filename, 'utf8');
     }
     res.json({ ok: true, id: meta.id, title: meta.title, content });
   } catch (err) {
     res.status(500).json({ ok: false, error: err.message });
   }
 });

 // Save tile content
app.post('/api/stories/:name/tiles/:id/save', requireAuth, (req, res) => {
  const name = req.params.name;
  const id = req.params.id;
  const { content } = req.body || {};
  if (typeof content !== 'string') return res.status(400).json({ ok: false, error: 'content required' });
  const { userId, base } = resolveUserAndBase(req, name);
  if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
   try {
     const tilesDir = path.join(base, 'tiles');
     const filename = path.join(tilesDir, id + '.md');
     fs.writeFileSync(filename, content, 'utf8');
     res.json({ ok: true });
   } catch (err) {
     res.status(500).json({ ok: false, error: err.message });
   }
 });

 // Reorder or update titles (body: { order: [{id,title}, ...] } )
app.post('/api/stories/:name/tiles/reorder', requireAuth, (req, res) => {
  const name = req.params.name;
  const order = Array.isArray(req.body && req.body.order) ? req.body.order : null;
  if (!order) return res.status(400).json({ ok: false, error: 'order required' });
  const { userId, base } = resolveUserAndBase(req, name);
  if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
  try {
    const tilesDir = path.join(base, 'tiles');
    if (!fs.existsSync(tilesDir)) fs.mkdirSync(tilesDir, { recursive: true });
    const metaPath = path.join(tilesDir, 'tiles.json');
    // normalize to objects with id and title
    const normalized = order.map(o => (typeof o === 'string' ? { id: safeName(o), title: '' } : { id: safeName(String(o.id || '')), title: String(o.title || '') }));
    fs.writeFileSync(metaPath, JSON.stringify(normalized, null, 2), 'utf8');
    res.json({ ok: true, tiles: normalized });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

 // Delete tile
app.delete('/api/stories/:name/tiles/:id', requireAuth, (req, res) => {
  const name = req.params.name;
  const id = req.params.id;
  const { userId, base } = resolveUserAndBase(req, name);
  if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
  try {
    const tilesDir = path.join(base, 'tiles');
    const metaPath = path.join(tilesDir, 'tiles.json');
    let tiles = [];
    if (fs.existsSync(metaPath)) {
      try { tiles = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { tiles = []; }
    }
    const newTiles = tiles.filter(t => t.id !== id);
    fs.writeFileSync(metaPath, JSON.stringify(newTiles, null, 2), 'utf8');
    const filename = path.join(tilesDir, id + '.md');
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

 // Save text/characters/locations
 app.post('/api/stories/:name/save', requireAuth, (req, res) => {
   const name = req.params.name;
   const { file, content } = req.body || {};
   if (!file || !content) {
     return res.status(400).json({ ok: false, error: 'file and content required' });
   }
   // Only accept saves for the legacy aggregated highlights endpoint to allow migration.
   // When clients POST highlights.md, parse the provided aggregated markdown into per-highlight files
   // stored under highlights/<id>.md. This migrates legacy bulk edits into the per-file model.
   if (file !== 'highlights.md') {
     return res.status(400).json({ ok: false, error: 'invalid file' });
   }
  const { userId, base } = resolveUserAndBase(req, name);
  if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
  try {
    const highlightsDir = path.join(base, 'highlights');
    if (!fs.existsSync(highlightsDir)) fs.mkdirSync(highlightsDir, { recursive: true });

    // Split the aggregated markdown into sections using leading "## " headings as anchors.
    // This mirrors the client-side parseEntitySectionsArray behavior.
    const parts = String(content).split(/\n(?=##\s+)/g).filter(Boolean);
    const incomingIds = new Set();
    for (const p of parts) {
      const lines = p.split('\n');
      if (lines.length === 0) continue;
      const titleLine = lines[0];
      const title = titleLine.replace(/^#{1,6}\s*/, '').trim();
      const desc = lines.slice(1).join('\n');
      if (!title) continue;
      const id = safeName(title) || String(Date.now());
      incomingIds.add(id);
      const out = `## ${title}\n\n${(desc || '').replace(/^\n+/, '').replace(/\n+$/, '')}`;
      try {
        fs.writeFileSync(path.join(highlightsDir, id + '.md'), out, 'utf8');
      } catch (e) {
        // ignore per-file write errors but continue processing others
      }
    }

    // Remove any highlight files that were not present in the incoming aggregated content
    try {
      const existing = fs.readdirSync(highlightsDir, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.endsWith('.md'))
        .map(d => d.name);
      for (const fn of existing) {
        const id = path.basename(fn, '.md');
        if (!incomingIds.has(id)) {
          try { fs.unlinkSync(path.join(highlightsDir, fn)); } catch (e) { /* ignore unlink errors */ }
        }
      }
    } catch (e) {
      // ignore cleanup failures
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// multer storage: destination depends on story and type field
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const story = req.params.name;
    const type = req.body.type; // expected: highlights
    const allowed = ['highlights'];
    const t = allowed.includes(type) ? type : 'highlights';
    try {
      const { userId, base } = resolveBaseFlexible(req, story);
      const dest = path.join(base, 'images', t);
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    } catch (e) {
      cb(e);
    }
  },
  filename: function (req, file, cb) {
    // keep original filename but sanitize
    const clean = path.basename(file.originalname).replace(/[/\\?%*:|"<>]/g, '-');
    cb(null, Date.now() + '-' + clean);
  }
});
const upload = multer({ storage });

 // Upload image
app.post('/api/stories/:name/images', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file uploaded' });
  try {
    const { userId, base } = resolveBaseFlexible(req, req.params.name);
    const used = getUserUsageBytes(userId);
    const quota = (parseInt(process.env.USER_QUOTA_MB || '10', 10) * 1024 * 1024);
    const newSize = used + (req.file.size || 0);
    if (newSize > quota) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(413).json({ ok: false, error: 'quota exceeded', usedBytes: used, quotaBytes: quota });
    }
    const rel = path.relative(STORIES_ROOT, req.file.path);
    const url = '/' + path.join('stories', rel).split(path.sep).map(encodeURIComponent).join('/');
    res.json({ ok: true, url });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (ex) {}
    return res.status(500).json({ ok: false, error: e.message });
  }
});
 
 // Delete story (remove entire story folder and contents)
 app.delete('/api/stories/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  const { userId, base } = resolveUserAndBase(req, name);
  if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
   try {
     // remove directory recursively - use rmSync when available for clarity, fall back to rSync for older Node
     if (fs.rmSync) {
       fs.rmSync(base, { recursive: true, force: true });
     } else {
       // Node <14 fallback
       const rimraf = (p) => {
         if (fs.existsSync(p)) {
           for (const entry of fs.readdirSync(p)) {
             const cur = path.join(p, entry);
             if (fs.lstatSync(cur).isDirectory()) rimraf(cur);
             else fs.unlinkSync(cur);
           }
           fs.rmdirSync(p);
         }
       };
       rimraf(base);
     }
     res.json({ ok: true });
   } catch (err) {
     res.status(500).json({ ok: false, error: err.message });
   }
 });
 
 // Publish story endpoint — aggregates tiles into a single markdown and copies images
 app.post('/api/stories/:name/publish', requireAuth, (req, res) => {
   const name = req.params.name;
   try {
     const { userId, base } = resolveUserAndBase(req, name);
     if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
     const tilesDir = path.join(base, 'tiles');
     const metaPath = path.join(tilesDir, 'tiles.json');
     let tiles = [];
     if (fs.existsSync(metaPath)) {
       try { tiles = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { tiles = []; }
     }
     // aggregate tiles in order
     let agg = '';
     for (const t of tiles) {
       const fn = path.join(tilesDir, `${t.id}.md`);
       if (fs.existsSync(fn)) {
         try { agg += fs.readFileSync(fn, 'utf8') + '\n\n'; } catch (e) {}
       }
     }
     const publishedDir = path.join(base, 'published');
     const publishedImages = path.join(publishedDir, 'images');
     if (!fs.existsSync(publishedDir)) fs.mkdirSync(publishedDir, { recursive: true });
     if (!fs.existsSync(publishedImages)) fs.mkdirSync(publishedImages, { recursive: true });
     // copy story images to published/images
     const imagesDir = path.join(base, 'images');
     if (fs.existsSync(imagesDir)) {
       const subs = fs.readdirSync(imagesDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
       for (const sub of subs) {
         const src = path.join(imagesDir, sub);
         const destSub = path.join(publishedImages, sub);
         if (!fs.existsSync(destSub)) fs.mkdirSync(destSub, { recursive: true });
         for (const f of fs.readdirSync(src)) {
           try { fs.copyFileSync(path.join(src, f), path.join(destSub, f)); } catch (e) {}
         }
       }
     }
     // write aggregated markdown (overwrite)
    const outPath = path.join(publishedDir, `${safeName(name)}.md`);
    // prepend story title as a markdown heading before aggregated content
    const outContent = `# ${name}\n\n${agg}`;

    // Create snapshots directory and write a timestamped snapshot (do NOT touch legacy text.md files)
    try {
      const snapsDir = path.join(base, 'snapshots');
      if (!fs.existsSync(snapsDir)) fs.mkdirSync(snapsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const snapName = `${safeName(name)}-${ts}.md`;
      const snapPath = path.join(snapsDir, snapName);
      try { fs.writeFileSync(snapPath, outContent, 'utf8'); } catch (e) { /* ignore snapshot write failure */ }

      // update snapshots/meta.json (append simple metadata)
      const metaPath = path.join(snapsDir, 'meta.json');
      let meta = [];
      try { meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]') : []; } catch (e) { meta = []; }
      try {
        meta.push({ file: snapName, timestamp: new Date().toISOString(), tileCount: tiles.length, size: Buffer.byteLength(outContent, 'utf8') });
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
      } catch (e) { /* ignore meta write failure */ }
    } catch (e) {
      // ignore snapshot directory failures - publishing should continue even if snapshots fail
    }

    try { fs.writeFileSync(outPath, outContent, 'utf8'); } catch (e) { return res.status(500).json({ ok: false, error: 'failed to write published file' }); }
    // Return a friendly public route under /published/:userId/:storyId instead of exposing the raw file path.
    // Use the resolved userId (from resolveUserAndBase above) and the story name.
    const pubRoute = `/published/${encodeURIComponent(userId)}/${encodeURIComponent(name)}`;
    return res.json({ ok: true, url: pubRoute });
   } catch (err) {
     return res.status(500).json({ ok: false, error: err.message });
   }
 });
 
 // Usage endpoint for current user
 app.get('/api/usage', requireAuth, (req, res) => {
   try {
     const { userId } = resolveUserIdFromReq(req);
     const used = getUserUsageBytes(userId);
     const quota = (parseInt(process.env.USER_QUOTA_MB || '10', 10) * 1024 * 1024);
     res.json({ ok: true, usedBytes: used, quotaBytes: quota });
   } catch (err) {
     res.status(500).json({ ok: false, error: err.message });
   }
 });
 
 // Minimal markdown -> HTML renderer used for published stories to match the editor preview
 function simpleMarkdownToHtml(md) {
   if (!md) return '';
   const lines = String(md).split(/\r?\n/);
   let html = '';
   let inList = false;

   function escapeHtml(s) {
     return String(s)
       .replace(/&/g, '&')
       .replace(/</g, '<')
       .replace(/>/g, '>');
   }

   for (let raw of lines) {
     // preserve original raw line for heading detection and some heuristics
     const cleaned = raw.replace(/^[\uFEFF\u200B]+/, '');
     // headings: 1-6 hashes followed by a space
     const h = cleaned.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      if (inList) { html += '</ul>'; inList = false; }
      const level = h[1].length;
      const headingText = escapeHtml(h[2].replace(/^[#\s]+/, ''));
      html += `<h${level}>${headingText}</h${level}>`;
      continue;
    }

    // section separator: three or more asterisks on their own line (e.g. *** or * * *)
    if (/^\s*(?:\*\s*){3,}\s*$/.test(cleaned)) {
      if (inList) { html += '</ul>'; inList = false; }
      // render as a centered decorative separator using Unicode stars
      html += '<div class="section-sep" aria-hidden="true"><span>✦ ✦ ✦</span></div>';
      continue;
    }

    // horizontal rule: line containing three or more hyphens only (e.g. ---)
    if (/^\s*-{3,}\s*$/.test(cleaned)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<hr />';
      continue;
    }

    // unordered lists (- or *) 
    const li = cleaned.match(/^\s*[-*]\s+(.*)$/);
     if (li) {
       if (!inList) { html += '<ul>'; inList = true; }
       let content = li[1];

      // escape and handle code spans first
      content = escapeHtml(content)
        .replace(/`([^`]+)`/g, '<code>$1</code>');
      // apply typographic transforms (skip code spans)
      try { content = typographicTransform(content); } catch (e) { /* non-fatal */ }
      // images: ![alt](url)
      content = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`;
      });
      // inline bold, italic
      content = content
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>');
      html += `<li>${content}</li>`;
      continue;
     } else {
       if (inList) { html += '</ul>'; inList = false }
     }

    // process inline elements for paragraphs
    let paragraph = escapeHtml(raw)
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    // apply typographic transforms (skip code spans)
    try { paragraph = typographicTransform(paragraph); } catch (e) { /* non-fatal */ }
    paragraph = paragraph
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`;
      })
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
 
    if (paragraph.trim() === '') {
      // blank line -> paragraph separator (emit nothing)
      html += '';
    } else {
      html += `<p>${paragraph}</p>`;
    }
    }

   if (inList) html += '</ul>';
   return html;
 }

 // Public view for a published story: renders the aggregated markdown in a minimal page (no editor/menu).
 app.get('/published/:userId/:storyId', (req, res) => {
   try {
     const userId = req.params.userId;
     const storyId = req.params.storyId;
     if (!userId || !storyId) return res.status(400).send('invalid request');
     const pubPath = path.join(STORIES_ROOT, userId, safeName(storyId), 'published', `${safeName(storyId)}.md`);
     if (!fs.existsSync(pubPath)) return res.status(404).send('published story not found');
     let md = '';
     try { md = fs.readFileSync(pubPath, 'utf8'); } catch (e) { return res.status(500).send('failed to read published story'); }

     // Render markdown to HTML on the server using the same simple renderer as the editor fallback.
     const rendered = simpleMarkdownToHtml(md);
     const html = `<!doctype html>
 <html>
 <head>
 <meta charset="utf-8"/>
 <meta name="viewport" content="width=device-width,initial-scale=1"/>
 <title>${escapeHtml(userId)} / ${escapeHtml(storyId)}</title>
 <link rel="stylesheet" href="/write/style.css">
 <style>
   body{font-family:Arial,Helvetica,sans-serif;max-width:900px;margin:24px auto;padding:16px}
   .story-content img{max-width:100%;height:auto}
 </style>
 </head>
 <body>
 <main class="story-content">
 ${rendered}
 </main>
 </body>
 </html>`;
     res.send(html);
   } catch (err) {
     res.status(500).send('failed to render published story');
   }
 });

 // Start server
 const PORT = process.env.PORT || 3000;
 app.listen(PORT, () => {
   console.log(`Story writer server listening on http://localhost:${PORT}`);
 });
