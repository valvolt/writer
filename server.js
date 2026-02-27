const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

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

// serve story images statically
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

// List stories (names)
app.get('/api/stories', (req, res) => {
  try {
    const items = fs.readdirSync(STORIES_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    res.json({ ok: true, stories: items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Create story
app.post('/api/stories', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
  const nm = safeName(name);
  const base = storyPath(nm);
  if (fs.existsSync(base)) {
    return res.status(409).json({ ok: false, error: 'story already exists' });
  }
  try {
    ensureStoryStructure(nm);
    res.json({ ok: true, name: nm });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Rename story
app.post('/api/stories/:name/rename', (req, res) => {
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
app.get('/api/stories/:name', (req, res) => {
  const name = req.params.name;
  const base = storyPath(name);
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
 app.get('/api/stories/:name/tiles', (req, res) => {
   const name = req.params.name;
   const base = storyPath(name);
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
 app.post('/api/stories/:name/tiles', (req, res) => {
   const name = req.params.name;
   const { title, content } = req.body || {};
   const base = storyPath(name);
   // ensure story exists (create structure if missing) so tile creation works reliably
   if (!fs.existsSync(base)) {
     try {
       ensureStoryStructure(name);
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
 app.get('/api/stories/:name/tiles/:id', (req, res) => {
   const name = req.params.name;
   const id = req.params.id;
   const base = storyPath(name);
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
 app.post('/api/stories/:name/tiles/:id/save', (req, res) => {
   const name = req.params.name;
   const id = req.params.id;
   const { content } = req.body || {};
   if (typeof content !== 'string') return res.status(400).json({ ok: false, error: 'content required' });
   const base = storyPath(name);
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
 app.post('/api/stories/:name/tiles/reorder', (req, res) => {
   const name = req.params.name;
   const order = Array.isArray(req.body && req.body.order) ? req.body.order : null;
   if (!order) return res.status(400).json({ ok: false, error: 'order required' });
   const base = storyPath(name);
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
 app.delete('/api/stories/:name/tiles/:id', (req, res) => {
   const name = req.params.name;
   const id = req.params.id;
   const base = storyPath(name);
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
 app.post('/api/stories/:name/save', (req, res) => {
   const name = req.params.name;
   const { file, content } = req.body || {};
   if (!file || !content) {
     return res.status(400).json({ ok: false, error: 'file and content required' });
   }
   // only highlights.md may be saved now; text.md is no longer generated/edited
   if (!['highlights.md'].includes(file)) {
     return res.status(400).json({ ok: false, error: 'invalid file' });
   }
   const base = storyPath(name);
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
    const dest = path.join(STORIES_ROOT, safeName(story), 'images', t);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: function (req, file, cb) {
    // keep original filename but sanitize
    const clean = path.basename(file.originalname).replace(/[/\\?%*:|"<>]/g, '-');
    cb(null, Date.now() + '-' + clean);
  }
});
const upload = multer({ storage });

 // Upload image
 app.post('/api/stories/:name/images', upload.single('file'), (req, res) => {
   if (!req.file) return res.status(400).json({ ok: false, error: 'no file uploaded' });
   // return public path to file
   const story = safeName(req.params.name);
   const rel = path.relative(STORIES_ROOT, req.file.path);
   const url = '/' + path.join('stories', rel).split(path.sep).map(encodeURIComponent).join('/');
   res.json({ ok: true, url });
 });
 
 // Delete story (remove entire story folder and contents)
 app.delete('/api/stories/:name', (req, res) => {
   const name = req.params.name;
   const base = storyPath(name);
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
 
 // Start server
 const PORT = process.env.PORT || 3000;
 app.listen(PORT, () => {
   console.log(`Story writer server listening on http://localhost:${PORT}`);
 });
