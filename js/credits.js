// The credits screen (title screen and ending card). Plain data: to credit someone, add a line to the right section,
// or a new section. Each line is [name, what they did]; the second part may be left out. Shown in this order.
export const CREDITS = [
  { title: 'Created by', lines: [
    ['PurpleRobedMantis'],
  ] },
  { title: 'Contributors', lines: [
    ['PurpleRobedMantis'],
    ['Contributions are welcome', 'add yourself in js/credits.js with your change'],
  ] },
  { title: 'Sources', lines: [
    ['The experiencers', 'every scene is built from published accounts; each field note says whose'],
    ['Researchers and authors', 'cited in the field notes and in docs/RESEARCH.md'],
  ] },
  { title: 'Made with', lines: [
    ['three.js r160', 'three.js authors, MIT licence'],
    ['Web Audio API', 'every sound is synthesised in the browser'],
    ['AI coding assistants', 'Claude (Anthropic) and Codex (OpenAI), directed by PurpleRobedMantis'],
  ] },
  { title: 'Images', lines: [
    ['Blue Marble', 'Reto Stöckli, NASA Goddard Space Flight Center'],
    ['Elevation and city lights', 'NASA SRTM and NASA Earth Observatory'],
    ['The Moon', 'NASA Lunar Reconnaissance Orbiter, Scientific Visualization Studio CGI Moon Kit'],
  ] },
  { title: 'Licence', lines: [
    ['Released under the MIT licence', 'free to play, change and share'],
  ] },
];
