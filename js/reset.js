// Every new build starts fresh, in every copy, with no exceptions (owner's rule: field notes since build 103, every
// setting since build 142). When the build number on the page is not the one this browser last saw, every 'uap-' key is
// removed: field notes, "all notes open", language, sound on/off, resolution, developer mode, and the night counters
// (fights, "fought last night"). Then the new build number is stored. Imported first in main.js, so it runs before any
// other module reads a setting. Anything new the game stores must use the 'uap-' prefix so this clears it too.
try {
  const BUILD = (document.getElementById('build')?.textContent || '').trim();
  if (BUILD && localStorage.getItem('uap-build') !== BUILD) {
    for (const k of Object.keys(localStorage)) if (k.startsWith('uap-')) localStorage.removeItem(k);
    localStorage.setItem('uap-build', BUILD);
  }
} catch (_) {}
