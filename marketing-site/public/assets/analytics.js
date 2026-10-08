// Analytics for about.spottheaurora.co.nz.
//
// The same Google Analytics property as the app (G-H8KY78RQJC), so the
// marketing site shows up in the Spot The Aurora analytics, kept apart from
// the app by its content group, "Marketing site" (the app's is "App"), and by
// its hostname. Both sites are on spottheaurora.co.nz, so somebody who reads
// about the app here and then opens it counts as one visitor across both.
//
// Besides page views, scrolls and the rest GA measures itself, three things
// worth knowing about a marketing site:
//   open_app_click     a link into the app: which link, on which page, in
//                      which section - which pitch actually sends people over
//   feature_video_play a feature video started, and which
//   faq_open           an FAQ question opened, and which
//
// Analytics must never break the page: everything here fails silently. Set
// localStorage.debug_analytics = '1' to see the events in the console.
(function () {
  var ID = 'G-H8KY78RQJC';
  var debug = false;
  try { debug = localStorage.getItem('debug_analytics') === '1'; } catch (_) { /* storage blocked */ }

  try {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ID, { content_group: 'Marketing site' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    document.head.appendChild(s);
  } catch (_) {
    return;
  }

  function track(name, params) {
    try {
      window.gtag('event', name, params);
      if (debug) console.log('[analytics]', name, params);
    } catch (_) { /* never break the page */ }
  }

  var clip = function (text) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 100); };
  var page = function () { return location.pathname.replace(/\.html$/, '') || '/'; };

  /** The heading of the part of the page something sits in. */
  function sectionOf(el) {
    var node = el;
    while (node && node !== document.body) {
      if (node.tagName === 'SECTION' || node.tagName === 'HEADER' || node.tagName === 'FOOTER' || node.tagName === 'NAV') {
        if (node.tagName === 'NAV') return 'Navigation';
        if (node.tagName === 'FOOTER') return 'Footer';
        var h = node.querySelector('h1, h2, h3');
        if (!h) return clip(node.id || node.tagName.toLowerCase());
        // A heading broken over lines with <br> keeps its spaces; its own
        // case, not the uppercase some headings are styled in.
        var c = h.cloneNode(true);
        var brs = c.querySelectorAll('br');
        for (var i = 0; i < brs.length; i++) brs[i].replaceWith(' ');
        return clip(c.textContent);
      }
      node = node.parentElement;
    }
    return '';
  }

  /** A link into the app itself, not this site or the photo host. */
  function isAppLink(a) {
    try {
      var u = new URL(a.href, location.href);
      return u.hostname === 'spottheaurora.co.nz' || u.hostname === 'www.spottheaurora.co.nz';
    } catch (_) {
      return false;
    }
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !isAppLink(a)) return;
    var u = new URL(a.href, location.href);
    track('open_app_click', {
      link_text: clip(a.textContent || a.getAttribute('aria-label')),
      app_page: u.pathname || '/',
      page: page(),
      section: sectionOf(a),
    });
  }, true);

  // Media events do not bubble; caught on the way down instead.
  document.addEventListener('play', function (e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO' || v.dataset.played) return;
    v.dataset.played = '1';
    track('feature_video_play', { video: clip(v.getAttribute('aria-label')), page: page() });
  }, true);

  // A question that starts open fires a toggle as the page loads; only the
  // ones somebody opens count.
  var interacted = false;
  var touched = function () { interacted = true; };
  document.addEventListener('pointerdown', touched, true);
  document.addEventListener('keydown', touched, true);
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!interacted || !d || d.tagName !== 'DETAILS' || !d.open || !d.classList.contains('faq')) return;
    var q = d.querySelector('summary');
    track('faq_open', { question: clip(q ? q.textContent : ''), page: page() });
  }, true);
})();
