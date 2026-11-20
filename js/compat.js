// Runs before the game's modules, as a plain script in old syntax so even an old browser runs it. A browser that cannot
// run the game (no import maps or no WebGL 2: for example Safari before 16.4, which is every browser on an iPhone or iPad
// on iOS before 16.4) would otherwise show the title screen with its keyboard help and then do nothing at all. Here it
// says plainly what is needed instead, in the player's language, and the BEGIN button is hidden.
(function () {
  var maps = false, gl = false;
  try { maps = !!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('importmap')); } catch (e) {}
  try { gl = !!document.createElement('canvas').getContext('webgl2'); } catch (e) {}
  if (maps && gl) return;
  var MSG = {
    en: 'This browser cannot run the game. It needs WebGL 2 and import maps: on an iPhone or iPad, iOS 16.4 or newer; on a computer or Android phone, a current Chrome, Edge, Firefox or Safari.',
    es: 'Este navegador no puede ejecutar el juego. Necesita WebGL 2 y mapas de importación: en iPhone o iPad, iOS 16.4 o posterior; en un ordenador o un teléfono Android, una versión actual de Chrome, Edge, Firefox o Safari.',
    fr: 'Ce navigateur ne peut pas lancer le jeu. Il lui faut WebGL 2 et les import maps : sur iPhone ou iPad, iOS 16.4 ou plus récent ; sur ordinateur ou téléphone Android, une version récente de Chrome, Edge, Firefox ou Safari.',
    de: 'Dieser Browser kann das Spiel nicht ausführen. Es braucht WebGL 2 und Import Maps: auf iPhone oder iPad iOS 16.4 oder neuer, auf einem Computer oder Android-Handy ein aktuelles Chrome, Edge, Firefox oder Safari.',
    pt: 'Este navegador não consegue rodar o jogo. Ele precisa de WebGL 2 e import maps: no iPhone ou iPad, iOS 16.4 ou mais recente; no computador ou celular Android, uma versão atual do Chrome, Edge, Firefox ou Safari.'
  };
  var lang = 'en';
  try { var s = localStorage.getItem('uap-lang'); if (s && MSG[s]) lang = s; else { var n = (navigator.language || 'en').slice(0, 2).toLowerCase(); if (MSG[n]) lang = n; } } catch (e) {}
  var keys = document.querySelector('#title .keys');
  if (keys) { keys.textContent = MSG[lang]; keys.style.color = '#e8b0a0'; keys.style.maxWidth = '34em'; keys.style.margin = '0 auto'; keys.style.lineHeight = '1.5'; }
  var b = document.getElementById('startBtn'); if (b) b.style.display = 'none';
  window.UAP_UNSUPPORTED = true;
})();
