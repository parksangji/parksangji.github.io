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

  // 1.5) 사이드바 카테고리: 펼침 상태 유지(localStorage) + 현재 카테고리 자동 펼침/강조
  (function () {
    var KEY = 'sidebar-open-cats';
    var read = function () {
      try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
    };
    var write = function (arr) {
      try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
    };

    var groups = document.querySelectorAll('#sidebar .cat-tree details');
    var opened = read();

    groups.forEach(function (d) {
      var name = d.getAttribute('data-cat');
      if (opened.indexOf(name) !== -1) { d.open = true; }
      d.addEventListener('toggle', function () {
        var cur = read();
        var i = cur.indexOf(name);
        if (d.open && i === -1) { cur.push(name); }
        else if (!d.open && i !== -1) { cur.splice(i, 1); }
        write(cur);
      });
    });

    // 현재 페이지에 해당하는 카테고리 링크 강조 + 부모 그룹 펼치기
    var path = location.pathname.replace(/\/+$/, '');
    document.querySelectorAll('#sidebar .cat-tree a').forEach(function (a) {
      var href = (a.getAttribute('href') || '').replace(/\/+$/, '');
      if (href && href === path) {
        a.classList.add('active-cat');
        var parent = a.closest('details');
        if (parent) { parent.open = true; }
      }
    });
  })();

  // 1.7) 블로그 글 잔디 (컨트리뷰션 그래프) 렌더링
  (function () {
    var el = document.getElementById('blog-heatmap');
    if (!el || !window.BLOG_POST_DATES) return;

    var counts = {};
    window.BLOG_POST_DATES.forEach(function (d) {
      counts[d] = (counts[d] || 0) + 1;
    });

    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var fmt = function (dt) {
      return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
    };
    var level = function (c) { return c === 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : c === 3 ? 3 : 4; };

    var end = new Date();
    end.setHours(0, 0, 0, 0);
    var start = new Date(end);
    start.setDate(start.getDate() - 7 * 52);
    start.setDate(start.getDate() - start.getDay()); // 직전 일요일로

    var grid = document.createElement('div');
    grid.className = 'heatmap-grid';
    var cur = new Date(start);
    while (cur <= end) {
      var col = document.createElement('div');
      col.className = 'heatmap-col';
      for (var i = 0; i < 7; i++) {
        var key = fmt(cur);
        var c = counts[key] || 0;
        var cell = document.createElement('span');
        cell.className = 'heatmap-cell lv' + level(c);
        cell.title = key + ' · 글 ' + c + '개';
        col.appendChild(cell);
        cur.setDate(cur.getDate() + 1);
      }
      grid.appendChild(col);
    }
    el.innerHTML = '';
    el.appendChild(grid);
  })();

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
