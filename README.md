# Writer — Local Story Editor

A small offline-first story editor that stores stories as folders on disk. Each story folder contains:
- text.md — main story text (Markdown)
- characters.md — character entries (sections starting with `## Name`)
- locations.md — location entries (sections starting with `## Name`)
- images/ — images used in the story
  - characters/
  - locations/
  - text/

Features
- Create / open / close stories (stored as folders under `stories/`)
- WYSIWYG-ish Markdown editor with live preview (uses marked when available, a simple fallback otherwise)
- Right-click a word to create a Character or Location — creates the entity and opens it in the main editor
- Characters and locations are highlighted in the preview; hover shows a tooltip with image and short text
- Autosave: edits are saved automatically (debounced) — Save button hidden by default
- Counts: sidebar shows how many times each character/location is mentioned in the main text (updates live while editing main text)
- Image uploads for the editor and entity pages

Local development / run
1. Install Node.js (tested with Node 18+)
2. Install dependencies (if any are added later) — currently no install step is required for the shipped code.
3. Start the server:
   node server.js
4. Open the app in your browser:
   http://localhost:3000

Notes
- Stories content is intentionally git-ignored: see `.gitignore` which excludes `/stories/*` but allows keeping a `.gitkeep` placeholder.
- The app uses a fallback markdown renderer if the `marked` library cannot be loaded (useful offline or behind restrictive CSP).
- If you plan to push this repo to GitHub and want to include an empty `stories/` folder, add `stories/.gitkeep`.

Contributing
- Open an issue or submit a PR to the repository.
- Keep user story content out of commits; test data should be placed outside `stories/` or in a temporary branch.

License
- Unspecified — add a LICENSE file if you want to publish with a specific license.