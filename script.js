// PickNest Reviews — lightweight JS: mobile nav, footer year, FAQ accordion
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
  document.querySelectorAll('.faq-q').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.faq-item');
      if (item) item.classList.toggle('open');
    });
  });
})();

// Affiliate click tracking (Vercel Analytics custom events)
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('a[href*="amazon."]').forEach(function (a) {
    a.addEventListener('click', function () {
      if (typeof window.va === 'function') {
        window.va('event', { name: 'amazon_click', data: { page: location.pathname, href: a.href } });
      }
    });
  });
  document.querySelectorAll('a[href^="http"]').forEach(function (a) {
    a.addEventListener('click', function () {
      if (typeof window.va === 'function' && a.hostname !== location.hostname) {
        window.va('event', { name: 'outbound_click', data: { page: location.pathname, host: a.hostname } });
      }
    });
  });
});
