/* 정적 사이트용 클라이언트 인터랙션: 읽기 진행바 + 스크롤 등장 */
(function () {
  'use strict';

  // 1) 읽기 진행바 — 포스트 페이지에서만
  if (location.pathname.indexOf('/posts/') !== -1) {
    var bar = document.createElement('div');
    bar.className = 'reading-progress';
    bar.setAttribute('aria-hidden', 'true');
    var fill = document.createElement('span');
    bar.appendChild(fill);
    document.body.appendChild(bar);

    var update = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      var y = window.scrollY || doc.scrollTop || 0;
      fill.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // 2) 스크롤 등장 애니메이션
  var reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    var supports =
      'IntersectionObserver' in window &&
      document.documentElement.classList.contains('js-reveal');

    if (supports) {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              e.target.classList.add('revealed');
              io.unobserve(e.target);
            }
          });
        },
        { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
      );
      reveals.forEach(function (el) {
        io.observe(el);
      });
    } else {
      // 폴백: 전부 표시
      reveals.forEach(function (el) {
        el.classList.add('revealed');
      });
    }
  }
})();
