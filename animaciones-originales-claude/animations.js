/*!
 * Hesloy · escenas decorativas del checkout — controlador
 * - Inserta los SVG (en línea o desde archivo) y les da IDs únicos.
 * - Pausa cada escena fuera de pantalla y todas cuando la pestaña está oculta.
 * - No crea botones, no captura clics y no toca el checkout.
 * El movimiento vive en animations.css; con prefers-reduced-motion el CSS
 * deja la pose estática del marcado y este script no anima nada.
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var FILES = {
    'contra-entrega': 'contra-entrega.svg',
    'transferencia': 'transferencia.svg',
    'tarjeta-pos': 'tarjeta-pos.svg'
  };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Carpeta de los .svg: por defecto, la misma que este script.
  var scriptEl = doc.currentScript;
  var basePath = (scriptEl && scriptEl.src) ? scriptEl.src.replace(/[^\/]*(\?.*)?$/, '') : '';

  var uid = 0;
  var cache = {};
  var visible = new WeakMap();
  var live = new Set();

  var io = ('IntersectionObserver' in global)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { visible.set(e.target, e.isIntersecting); sync(e.target); });
      }, { rootMargin: '200px 0px' })
    : null;

  function sync(svg) {
    var offscreen = visible.get(svg) === false;
    var paused = doc.hidden || offscreen || svg.hasAttribute('data-hsa-paused');
    svg.classList.toggle('hsa-paused', paused);
    // Fuera de pantalla además se deja de pintar (conserva su espacio en el layout).
    svg.classList.toggle('hsa-offscreen', offscreen);
  }

  doc.addEventListener('visibilitychange', function () { live.forEach(sync); });

  // Renombra todos los id del SVG y sus referencias (url(#…), href="#…").
  function uniquify(svg) {
    var suffix = '-hsa' + (++uid);
    var map = Object.create(null);
    var withId = svg.querySelectorAll('[id]');
    if (!withId.length) return;
    for (var i = 0; i < withId.length; i++) {
      var old = withId[i].id;
      map[old] = old + suffix;
      withId[i].id = old + suffix;
    }
    var all = svg.querySelectorAll('*');
    var re = /url\(\s*#([^)\s"']+)\s*\)/g;
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      for (var k = 0; k < el.attributes.length; k++) {
        var a = el.attributes[k];
        var val = a.value;
        if ((a.localName === 'href') && val.charAt(0) === '#' && map[val.slice(1)]) {
          a.value = '#' + map[val.slice(1)];
        } else if (val.indexOf('url(') !== -1) {
          a.value = val.replace(re, function (m, id) { return map[id] ? 'url(#' + map[id] + ')' : m; });
        }
      }
    }
  }

  function register(svg) {
    if (!svg || svg.__hsa) return svg;
    svg.__hsa = true;
    uniquify(svg);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    live.add(svg);
    if (io) io.observe(svg);
    sync(svg);
    return svg;
  }

  function parse(text) {
    var parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    var root = parsed.documentElement;
    if (!root || root.namespaceURI !== SVG_NS || root.getElementsByTagName('parsererror').length) {
      throw new Error('SVG no válido');
    }
    return doc.importNode(root, true);
  }

  // Busca una copia en <template data-hsa-template="nombre"> (útil con file://).
  function fromTemplate(name) {
    var tpl = doc.querySelector('template[data-hsa-template="' + name + '"]');
    if (!tpl) return null;
    var svg = tpl.content.querySelector('svg');
    return svg ? doc.importNode(svg, true) : null;
  }

  function fetchSvg(name, src) {
    // Abierto con doble clic (file://): fetch no está permitido; usa la copia en <template> si existe.
    if (global.location && global.location.protocol === 'file:') {
      var local = fromTemplate(name);
      if (local) return Promise.resolve(local);
    }
    var url = src || (basePath + (FILES[name] || (name + '.svg')));
    if (!cache[url]) {
      cache[url] = (global.fetch ? fetch(url, { credentials: 'same-origin' }) : Promise.reject())
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
    }
    return cache[url].then(parse, function (err) {
      var t = fromTemplate(name);
      if (t) return t;
      throw err;
    });
  }

  /**
   * Monta una escena.
   * - `el` puede ser un <svg class="hsa-scene"> ya insertado en el HTML,
   *   o un contenedor con data-hsa-scene="contra-entrega|transferencia|tarjeta-pos"
   *   (y opcionalmente data-src="ruta/al.svg").
   * Devuelve una promesa con el <svg> montado.
   */
  function mount(el) {
    if (!el) return Promise.resolve(null);
    if (el.namespaceURI === SVG_NS && el.classList.contains('hsa-scene')) return Promise.resolve(register(el));
    var inner = el.querySelector && el.querySelector('svg.hsa-scene');
    if (inner) return Promise.resolve(register(inner));
    var name = el.getAttribute('data-hsa-scene');
    if (!name) return Promise.resolve(null);
    if (el.__hsaLoading) return el.__hsaLoading;
    el.__hsaLoading = fetchSvg(name, el.getAttribute('data-src')).then(function (svg) {
      el.textContent = '';
      el.appendChild(svg);
      return register(svg);
    }).catch(function () { return null; });
    return el.__hsaLoading;
  }

  function init(root) {
    root = root || doc;
    var nodes = root.querySelectorAll('[data-hsa-scene], svg.hsa-scene');
    var jobs = [];
    for (var i = 0; i < nodes.length; i++) jobs.push(mount(nodes[i]));
    return Promise.all(jobs);
  }

  function resolveSvg(el) {
    if (!el) return null;
    if (el.namespaceURI === SVG_NS) return el;
    return el.querySelector('svg.hsa-scene');
  }

  // Pausa / reanuda programática (p. ej. si el panel de pago se pliega).
  function pause(el) { var s = resolveSvg(el); if (s) { s.setAttribute('data-hsa-paused', ''); sync(s); } }
  function play(el) { var s = resolveSvg(el); if (s) { s.removeAttribute('data-hsa-paused'); sync(s); } }

  function destroy(el) {
    var s = resolveSvg(el);
    if (!s) return;
    if (io) io.unobserve(s);
    live.delete(s);
    s.classList.remove('hsa-paused', 'hsa-offscreen');
  }

  global.HesloyScenes = {
    init: init,
    mount: mount,
    pause: pause,
    play: play,
    destroy: destroy,
    setBasePath: function (p) { basePath = p && p.slice(-1) !== '/' ? p + '/' : (p || ''); }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
})(window);
