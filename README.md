# Wiki Trails

Map how you wander through Wikipedia. You record each trail by hand: the page you started on, then each link you clicked. Wiki Trails draws all your trails as one brain-like network in 3D. Connections you use often are brighter and thicker, the way well-used pathways between neurons strengthen.

Click any article and the trails that went through it light up, and you can read them at a glance:

- **Each trail has its own colour.**
- **A ring marks where it started and a pin where it ended.** Both stay on top and keep their size at any zoom. When several trails start or end on the same page, their rings or pins sit side by side.
- **The way it went:** each trail is thin where it started and bold where it ended, with arrowheads along it and a light running from start to end.
- **The older a trail, the fainter it is.** How strongly they fade is a setting.

The camera turns to the angle where the trails spread out best and fills the window with them. Click a trail anywhere and it's shown in full while the others step back; the side panel explains it. Zoom out and you're back to your whole history.

![Clicking an article shows its latest trails, each from start to end](.github/screenshot.png)

## How it works

The window has one map and two side panels, and both panels can be collapsed.

- **Map** (middle). Drag to turn it, scroll to zoom. Click an article to see its trails, then click one of the trails to focus it. Click empty space or press <kbd>Esc</kbd> to step back (first from the trail, then to your whole history), or zoom far out. Hover anything to see when you last saw it.
- **Latest N threads** (over the map, while something is selected): show the latest 1, 3, 5, 10, 20 or 50 trails through it.
- **Timeline** (under the map). It shows your clicks over time; pick *30 days*, *1 year* or *All time* in the top bar, choose *Custom…* to enter a start and end date, or drag across the timeline to look at any period. With an article selected, it marks each time you were on that page, and dragging picks the period whose trails are drawn.
- **Record** (left). Paste a Wikipedia link or type a title for the first page, then add each page you clicked next. To go back like the browser's back button, click an earlier step and continue from there; your trail then branches. Revisits and loops are fine. Every article is one node in the network, so arriving somewhere you have been before links into it.
- **Trails** (left, below). All your trails, newest first, with a filter. Click one to see it on its own, with every page named.
- **Details** (right). Shows what you selected:
  - **An article:** how often you saw it and when, first and last. *When you saw it* lists every visit with its date and time and the pages before and after it. A coloured dot marks the visits drawn on the map, in the same colour as their trail. Click one to focus that trail. *You came from* and *You went on to* follow, plus buttons to start a new trail there or open it on Wikipedia.
  - **A trail you clicked on the map:** where it started and ended, when you were on the page, and every page in order. Click a page to go to it.
  - **A trail from the list:** its steps, with Continue, Rename and Delete.

![A trail clicked on the map: shown in full, explained at the side](.github/focused.png)

![One trail, thin at its start (Theatre) and bold at its end (Zebra)](.github/screenshot-trail.png)

### Built to last for years

It should still feel like day one after years of use.

- **Calm overview.** The whole history shows every article, but only the strongest ~1,400 connections, and only the busiest articles are named.
- **A handful of trails at a time.** A click shows the latest five trails by default, so even a page you've seen 600 times stays readable.
- **Fading.** Connections you haven't used for a while fade.
- **Stable layout.** Positions are saved, so the network doesn't reshuffle from day to day. New articles settle next to the page you came from.

![Two years of browsing: 20,000 clicks, 3,145 articles](.github/whole.png)

![The latest ten trails through Communication](.github/two-years.png)

### Your data

- **Stored locally.** Everything stays in your browser (IndexedDB, so years of history fit).
- **Save to a file.** **File → Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) writes a history file. In Chrome and Edge it remembers the file, so later saves update it; other browsers download a copy. A dot on the File button reminds you when it's been a while.
- **Open a file.** **File → Open** (<kbd>Ctrl</kbd>+<kbd>O</kbd>), or drop a file onto the window. You choose whether to add it to your history or replace your history with it.
- **Undo.** <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> undoes the last change.

### Settings

The ⚙ button opens Settings:

- **Light or dark.** Follows your system by default.
- **Look.** Plain is the default, and 27 optional looks are available. Hover a card to try one, click to keep it.
- **Map:** how many connections to show, fade old connections, how much older threads fade, turn the map slowly when you're not using it, and re-arrange it from scratch.
- **Other:** the Wikipedia language for links, and optional sounds.

![Settings](.github/gallery.png)

<details>
<summary>All 28 looks</summary>

![Six of the looks with the same trails selected](.github/looks.jpg)

- *Plain*
- *Retro computing:* Desktop 95 · Mono '91 · Amber Terminal · Vector Arcade · Teletext · 8-bit Home
- *Futuristic:* Holo HUD · Star Chart · Bio-Neural
- *AI:* Latent Space · Training Run · Sentinel
- *Millennium / Y2K:* Aqua Bubble · Y2K Chrome · GeoCities · Media Player
- *90s console games:* 16-bit RPG · Handheld '89 · Polygon Era · Fighter Select · Overworld Map
- *Synthwave:* Outrun Sunset · Vaporwave · Neon Rain
- *Minimal:* Swiss Paper · Midnight Mono · Zen Ink

Look names describe a style; they are not affiliated with any product.
</details>

### Keyboard

| Key | Action |
| --- | --- |
| <kbd>/</kbd> | Find an article or trail |
| <kbd>Esc</kbd> | Let go of the focused trail, then back to your whole history |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save history to a file (<kbd>Shift</kbd> for Save as) |
| <kbd>Ctrl</kbd>+<kbd>O</kbd> | Open a history file |

Drag to turn the map, scroll to zoom.

### Try it with real data

**File → Examples** loads real human trails from the Wikispeedia game: *30 days* (1,000 clicks) or *2 years* (20,000 clicks, 3,145 articles). The 2-year example shows how the map feels after long use. Loading it replaces your history, but you can undo that.

## Run it

Open `index.html` in your browser by double-clicking it. Nothing to install.

### Host on GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages → Build and deployment → Source: Deploy from a branch**, then pick `main` and `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`.

To publish your own map, save your history with **File → Save as**, put the file at `data/trails.json`, and commit it. Visitors with no history of their own see that file. This only works on the hosted site: browsers don't allow reading it when the page is opened from disk. Your own browser keeps using its local history.

### Developing

The code lives in `src/` as ES modules and is bundled into `js/app.js`. The bundle is committed, so GitHub Pages needs no build step. After editing `src/`:

```bash
npm install        # once: esbuild, three.js and 3d-force-graph
npm run build      # or: npm run watch
npm run serve      # optional: http://localhost:8000
```

```
index.html            page: top bar, three panels, Settings and Open dialogs
js/app.js             bundled app (built from src/, includes three.js and 3d-force-graph)
css/style.css         layout and components; every colour is a CSS variable
css/skins.css         plain light/dark, window styles, and the 27 optional looks
src/main.js           wires the map, panels and keyboard together
src/app.js            app state, selection, events, and the highlight for a selection
src/model.js          data model: trails → articles and weighted connections
src/storage.js        IndexedDB, history files (save/open/merge), data/trails.json
src/appearance.js     light/dark and looks
src/skins.js          the list of looks: map palette, dot shape, background effect
src/ui.js             small helpers (dates, toasts, the steps list)
src/panels/           record, trails, details, search, timeline, menus
src/views/map3d.js    the 3D network (3d-force-graph), threads drawn with three.js, labels, camera
src/views/effects.js  animated backgrounds for some looks
src/example.js        tiny example
data/                 Wikispeedia examples; your published trails.json goes here
scripts/              build_test_data.py (Wikispeedia → Wiki Trails)
vendor/d3.min.js      d3 v7.9.0
```

#### Adding a look

1. Add an entry to `SKINS` in `src/skins.js`: an `id`, a name, a family, a window style, map colours, a dot shape and an optional background effect.
2. Add a `[data-skin="your-id"] { … }` block of CSS variables to `css/skins.css`.

The Settings gallery picks it up automatically.

## Data format

```json
{
  "version": 2,
  "lang": "en",
  "trails": [
    {
      "id": "k3j2…", "name": "", "created": "2026-11-18T09:00:00.000Z",
      "visits": [
        { "id": "a", "article": "Brain",   "parent": null, "t": 1763456400000 },
        { "id": "b", "article": "Neuron",  "parent": "a",  "t": 1763456460000 },
        { "id": "c", "article": "Synapse", "parent": "b",  "t": 1763456520000 },
        { "id": "d", "article": "Axon",    "parent": "b",  "t": 1763456600000 }
      ]
    }
  ],
  "layout": { "Brain": [12.5, -40.1, 8.3] }
}
```

- **A trail is a tree of visits.** A visit's `parent` is the page you clicked from. Going back and branching means attaching a new visit to an earlier one; in the example, you read Synapse, went back to Neuron and clicked Axon.
- **Going back is not a click** and adds no connection.
- **`t`** is when you opened the page, in milliseconds since 1970.
- **`layout`** is optional and keeps the network looking the same after you open the file: each article's position in 3D. Files from the older flat map have two numbers per article; those positions are ignored and the network is arranged afresh.
- **Derived data.** Articles and connections are computed from the visits. A connection's weight is the number of clicks between its two articles, in either direction, over all trails.

## Test data: Wikispeedia

The examples are real human navigation paths from the [Wikispeedia](https://snap.stanford.edu/data/wikispeedia.html) dataset. Players went from one article to a target article by clicking links on the page, and a `<` in their path means they went back, which maps directly to branching here. The timestamps are spread over 30 days or 2 years so the time lens has something to show.

- `data/wikispeedia-1000.json` (also `.js`, so it loads from disk): 176 paths, 1,000 clicks, 401 articles. Most come from the four most-played games (Brain → Telephone, Asteroid → Viking, Theatre → Zebra, Pyramid → Bean), so shared routes build up thick connections.
- `data/wikispeedia-2years.js`: 3,700 paths, 20,005 clicks, 3,145 articles.

To regenerate or resize them:

```bash
python3 scripts/build_test_data.py path/to/paths_finished.tsv data/wikispeedia-1000.json 1000
```

Sources:

- Robert West and Jure Leskovec, *Human Wayfinding in Information Networks*, WWW 2012.
- Robert West, Joelle Pineau and Doina Precup, *Wikispeedia: An Online Game for Inferring Semantic Distances between Concepts*, IJCAI 2009.
- Article content: Wikipedia (CC BY-SA).

## Licence

MIT, see [LICENSE](LICENSE).

- d3 is © Mike Bostock, ISC licence (see `vendor/d3.LICENSE`).
- The bundle in `js/app.js` includes [three.js](https://threejs.org) and [3d-force-graph](https://github.com/vasturiano/3d-force-graph) with their dependencies, all under MIT, ISC or BSD licences; their notices are in `js/THIRD-PARTY-LICENSES.txt`.
- Fonts are loaded from Google Fonts under the SIL Open Font Licence: Inter and the fonts of the optional looks.
