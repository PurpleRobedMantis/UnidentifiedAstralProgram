# Unidentified Astral Program

**Play it in your browser: https://purplerobedmantis.itch.io/unidentified-astral-program** (public beta)

A first-person 3D browser game, about 25 minutes (in current iteration), that plays through one night of contact as people who call themselves "experiencers" describe it: waking paralysed at 3 a.m., figures in the bedroom, the white room, the robed mantis, the classroom, a control room where the beings shape the night of a group calling to them from a field, the checkered hall of jesters and the mandala. Every scene, line and mechanic is built from documented accounts: the abduction literature (Hopkins, Jacobs, Mack, Bullard and others), sleep-paralysis and out-of-body research, published DMT studies, Robert Monroe's out-of-body work and the declassified US Army Gateway report, and first-person posts on Reddit. The in-game field notes say where each piece comes from. The game has no combat; your body is the controller, and what you remember depends on whether you fight.

## Content warning

- **Photosensitivity:** the game contains flashing lights, strobing and intense, fast-moving psychedelic visuals (spinning mandalas, flicker, full-screen colour flashes). If you have photosensitive epilepsy or are sensitive to flashing images, please do not play.
- Sleep paralysis: being awake and unable to move, with figures in the room.
- Abduction and being taken against your will.
- Medical-examination imagery (no injury or sexual content is shown).
- One remembered scene implies a sexual encounter with a being. Nothing is shown.
- Loud, rising tones. Start with the volume low.
- Strong language: the jesters swear at you.
- Existential themes: death, memory loss, whether you can trust what you are shown.

## What this game is, and is not

The game dramatises experiences that real people have reported. It takes no position on whether any of them literally happened, whether they were dreams, sleep paralysis, drug experiences or something else. Where a named researcher or witness appears, the game presents what they have said or written as their account, not as established fact. Its endings echo the main ways the experiences are interpreted, from transformative contact to deception to sleep science, and none is presented as the right one.

## Run it

You need a recent browser with WebGL 2 and import maps: a current Chrome, Edge, Firefox or Safari, and on an iPhone or iPad iOS 16.4 or newer (an older browser shows a message saying so instead of the BEGIN button). On a computer you play with a mouse and a keyboard; on a phone or tablet the game shows touch controls from the start. Headphones are recommended. three.js is included in `vendor/`, so there is nothing to install. To play locally you need [Node.js](https://nodejs.org/) (any current LTS release, 18 or newer) for the bundled server.

**Windows:** double-click `start.bat`. It starts a small local server and opens the game in your browser. Keep the window open while you play.

**Any OS:**

    node server.js

(or `npm start`). Then open the address the server prints, normally <http://localhost:8765>. If that port is busy it tries 8080, then 3210, then any free port; set the `PORT` environment variable to choose one. `node server.js --open` also opens the browser for you.

The game must be served over HTTP; opening `index.html` directly from disk will not work, because browsers block ES modules on `file://` pages. Any static web server or static host (GitHub Pages, itch.io as an HTML game, and so on) also works: upload a release package, with `index.html` at the root. All paths are relative. From a full copy of the project, `node tools/release.js` makes one (a checked folder in `builds/beta` and a zip next to it); upload that, not the project folder, which holds development files.

## Controls

| Key | Action |
|---|---|
| Mouse | Look (click the view to capture the mouse) |
| Arrow keys | Also turn your head |
| W A S D | Walk, when you are able to |
| Shift + W | Run, while walking |
| Space | Struggle |
| Shift | Breathe: hold as the hum swells, let go as it fades |
| E | Interact |
| 1-4 | Choose an answer |
| Tab | Field notes (in play); on a menu, Tab and Shift+Tab move between buttons and Enter presses one |
| P or Esc | Pause. P, Enter or a click resumes |
| F3 | Show frame rate and render statistics |
| MUTE button | On the title and pause menus; remembered until the next version of the game |
| F2 | Developer mode (see below) |

## Languages

English, Spanish, French, German and Brazilian Portuguese, chosen on the title screen. The translations have not yet been checked by native speakers; corrections are welcome.

## Field notes and sources

Each thing you witness unlocks a field note (Tab) saying who reported it and how well it is sourced. Each new version of the game starts fresh: unlocked notes and every setting (language, sound, developer mode) are cleared. Notes are tagged:

- **Counted:** a survey, study or documented programme put a number or a record on it.
- **Recurring:** several independent researchers or witnesses report it.
- **One account:** one witness, or one researcher's cases.
- **Contested:** disputed, or widely regarded as a hoax.
- **Game:** the game's own combination of separate reports, flagged so it is not mistaken for a single account.

In the field notes, Reddit accounts are cited by subreddit and year, not by username. The full research, with the sources behind every scene, is in [docs/RESEARCH.md](docs/RESEARCH.md); the design is in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Endings

Which ending you reach depends on whether you fight, whether you hold the stare, and what you say at the end.

## Files

- `index.html`: page, overlays and the import map
- `js/compat.js`: a plain script run before the game that shows a message on browsers too old to run it
- `js/main.js`: start-up and scene order
- `js/engine.js`: renderer, camera, input, pause and on-screen text
- `js/models.js`: every model and texture, built in code
- `js/fx.js`: shaders and effects for the jester hall and mandala
- `js/jester-face.js`: the jester face, as a GLSL chunk used by the hall shader
- `js/jester-lines.txt`: the jester taunts, one per line, editable
- `js/jester-lines.js`: loads the taunts
- `js/dev.js`: the developer menu
- `js/touch.js`: touch controls for phones and tablets
- `js/clips.js`, `js/clips/`: keyframed body movements exported from Blender, and the code that plays them on a grey
- `js/audio.js`: synthesised sound
- `js/notes.js`: the field notes
- `js/i18n.js`, `js/lang/`: the languages; each file in `js/lang/` maps the English text to one translation
- `js/reset.js`: clears stored settings when a new version is installed
- `js/credits.js`: the credits screen; contributors add their name here
- `js/scenes/night.js`: bedroom, passage, white room
- `js/scenes/ship.js`: crossroads and the four rooms
- `js/scenes/beyond.js`: jester hall, mandala, council, endings
- `js/scenes/control.js`: the control room (the loom, the weather table, the link) and its aftermath
- `js/scenes/field.js`: the field at night, seen through a mantis's eyes and a paralysed man's
- `js/scenes/reveal.js`: the nursery and the memories (only if you took the toy)
- `vendor/three/`: a vendored copy of three.js r160 (`three.module.js`) and its licence
- `img/`: three public-domain NASA maps of the Earth and Moon
- `server.js`, `start.bat`: a dependency-free static file server for local play, and a Windows launcher for it
- `docs/RESEARCH.md`: the sources behind every scene
- `docs/GAME_DESIGN.md`: the design
- `tools/` (repository only): `release.js` builds the public copy and zip, `shot.js` captures stills headless in Chrome, `routes.js` plays every route and ending headless and checks the result, `i18n.js` lists text that still needs translating, `captions.js` lists every on-screen line, `levels.js` measures the layers of a sound, `meshclip.js` checks every arm vertex of a grey against its body for clipping, `blender/` builds the grey rig in Blender and exports keyframed clips (with `anim/grey-rig.json`), `drivers/` holds capture scripts

## Developer shortcuts

Press F2 on any screen, or open the game with `?dev=1` in the URL, to switch on developer mode (F2 is remembered in this browser until you choose "Switch off and reload" in the menu, or a new version of the game is installed). Then press `` ` `` to open the developer menu, pick a speed or jump straight to any scene or ending; `[` and `]` halve and double the speed, `\` resets it. The URL shortcuts below also need `dev=1`. `?dev=1&fast=4` speeds up time; `?dev=1&scene=hub&seen=3` jumps to the crossroads with three rooms done; `?scene=room&room=class` (or `window`, `containers`, `viewing`) opens one room; `?scene=end:communion` plays an ending; `?scene=control`, `field`, `aftermath` and `reveal&toy=1` open the control-room act. `path=calm` and `lucid=0.8` preset the player state.

## Technology and credits

- [three.js](https://threejs.org/) r160 (MIT licence), vendored in `vendor/three/` and loaded as a plain ES module with no build step. The npm dev dependency exists only as the source of that copy.
- All models, character textures and audio are generated in code at run time. The only image files are three NASA maps in `img/`, all public domain: `earth_day.jpg` (Blue Marble, Reto Stöckli / NASA Goddard Space Flight Center), `earth_data.png` (built from NASA SRTM elevation and NASA city lights) and `moon.jpg` (NASA Lunar Reconnaissance Orbiter colour map, from the NASA Scientific Visualization Studio CGI Moon Kit).
- Source material is credited in the field notes and in [docs/RESEARCH.md](docs/RESEARCH.md). Quotations from books and posts are kept short and attributed. The game is not affiliated with or endorsed by any researcher, author, witness or community it cites.

## Credits

Created by PurpleRobedMantis, with AI coding assistants (Claude by Anthropic and Codex by OpenAI). Contributors are listed on the in-game CREDITS screen (`js/credits.js`).

## License

MIT. Play it, copy it, change it, build on it; just keep the notice. See `LICENSE`.

three.js is © three.js authors and is distributed under the MIT licence (see `vendor/three/LICENSE`).
