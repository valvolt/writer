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

// ensure stories dir exists
if (!fs.existsSync(STORIES_ROOT)) {
  fs.mkdirSync(STORIES_ROOT, { recursive: true });
}

 // serve frontend
 app.use(express.static(path.join(__dirname, 'public')));

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
 app.use(auth(authConfig));
 
 // requireAuth middleware: protect API routes server-side
 function requireAuth(req, res, next) {
   try {
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
});
 
 // profile endpoint — requires authentication and returns the OIDC user profile
 app.get('/profile', requiresAuth(), (req, res) => {
   try {
     return res.json(req.oidc && req.oidc.user ? req.oidc.user : {});
   } catch (e) {
     return res.status(500).json({ ok: false, error: 'failed to read profile' });
   }
 });
 
 // serve story images statically (original behavior)
 app.use('/stories', express.static(STORIES_ROOT));

function safeName(name) {
  // very simple sanitization: remove path separators
  return name.replace(/[/\\?%*:|"<>]/g, '-');
}

function storyPath(name) {
  return path.join(STORIES_ROOT, safeName(name));
}

function ensureStoryStructure(name) {
  const base = storyPath(name);
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  // we no longer generate a top-level text.md file; highlights.md remains
  const files = ['highlights.md'];
  for (const f of files) {
    const fp = path.join(base, f);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, '', 'utf8');
    }
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

function ensureUserStoryStructure(userPath, storyName) {
  const base = path.join(userPath, safeName(storyName));
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  const files = ['highlights.md'];
  for (const f of files) {
    const fp = path.join(base, f);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, '', 'utf8');
    }
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

// Get story content (text, characters, locations) and image lists
app.get('/api/stories/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  const { userId, base } = resolveUserAndBase(req, name);
  if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
  try {
    const textPath = path.join(base, 'text.md');
    const text = fs.existsSync(textPath) ? fs.readFileSync(textPath, 'utf8') : '';
    const highlights = fs.readFileSync(path.join(base, 'highlights.md'), 'utf8');
    const imagesDir = path.join(base, 'images');
    const imageList = {};
    if (fs.existsSync(imagesDir)) {
      for (const sub of ['highlights']) {
        const p = path.join(imagesDir, sub);
        if (!fs.existsSync(p)) {
          imageList[sub] = [];
        } else {
          imageList[sub] = fs.readdirSync(p).map(fn => `/stories/${safeName(name)}/images/${sub}/${encodeURIComponent(fn)}`);
        }
      }
    }
    res.json({ ok: true, name, text, highlights, images: imageList });
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
  const { userId, base, userPath } = resolveUserAndBase(req, name);
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
   // only highlights.md may be saved now; text.md is no longer generated/edited
   if (!['highlights.md'].includes(file)) {
     return res.status(400).json({ ok: false, error: 'invalid file' });
   }
  const { userId, base } = resolveUserAndBase(req, name);
  if (!fs.existsSync(base)) return res.status(404).json({ ok: false, error: 'story not found' });
  try {
    fs.writeFileSync(path.join(base, file), content, 'utf8');
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
      const { userId, base } = resolveUserAndBase(req, story);
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
    const { userId, base } = resolveUserAndBase(req, req.params.name);
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
     try { fs.writeFileSync(outPath, agg, 'utf8'); } catch (e) { return res.status(500).json({ ok: false, error: 'failed to write published file' }); }
     // return public URL relative to /stories
     const rel = path.relative(STORIES_ROOT, outPath);
     const url = '/' + path.join('stories', rel).split(path.sep).map(encodeURIComponent).join('/');
     return res.json({ ok: true, url });
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
 
 // Start server
 const PORT = process.env.PORT || 3000;
 app.listen(PORT, () => {
   console.log(`Story writer server listening on http://localhost:${PORT}`);
 });
