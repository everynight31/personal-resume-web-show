/* =============================================================================
 *  render.js —— 数据 → DOM
 * -----------------------------------------------------------------------------
 *  同一套渲染函数同时服务两处：
 *    · 主页面  #resume-root   （全尺寸）
 *    · 抽屉右侧实时预览 #mini-preview（由 CSS 缩放成缩略图）
 *  自定义区块（data.sections 里任意 sort）都能渲染，方便自由增删版块。
 * ========================================================================== */
(function (global) {
  'use strict';

  var ICONS = {
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h3l1.5 4-2 1.4a12 12 0 0 0 6 6l1.4-2 4 1.5v3A2 2 0 0 1 18.4 20 15.8 15.8 0 0 1 4 5.6a2 2 0 0 1 2.6-2.1z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.4"/><path d="M4 7.5l8 5.4 8-5.4"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7l-1.3 1.3"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.2" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6.5-6 6.5-10.5A6.5 6.5 0 0 0 5.5 10.5C5.5 15 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/></svg>',
    cap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5L12 5.5l9 4-9 4z"/><path d="M7 11.6V16c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.4"/></svg>',
    cube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l7.5 4.2v9.2L12 20.8 4.5 16.6V7.4z"/><path d="M4.5 7.4L12 11.6l7.5-4.2M12 11.6v9.2"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.6" cy="6.5" r="1.3"/><circle cx="4.6" cy="12" r="1.3"/><circle cx="4.6" cy="17.5" r="1.3"/></svg>',
    award: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9.5" r="5.2"/><path d="M8.4 13.8L7 21.5l5-2.6 5 2.6-1.4-7.7"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.2h6.2a2 2 0 0 1 2 2v12a1.6 1.6 0 0 0-1.6-1.6H4z"/><path d="M20 5.2h-6.2a2 2 0 0 0-2 2v12a1.6 1.6 0 0 1 1.6-1.6H20z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.4-4.6-7.4-9.6A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.4 2.8C19.4 15.4 12 20 12 20z"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function iconFor(name) {
    return ICONS[name] || ICONS.spark;
  }

  /* ------------------------------------------------------------------ Hero */
  function renderHero(data) {
    var p = data.profile || {};
    var hero = el('section');
    hero.id = 'hero';

    /* 打印时头像与姓名并排，故包一层 hero-top */
    var top = el('div', 'hero-top');

    var ring = el('div', 'avatar-ring');
    ring.id = 'avatar-anchor';
    if (p.avatar) {
      var img = document.createElement('img');
      img.className = 'avatar';
      img.src = p.avatar;
      img.alt = (p.name || '') + ' 证件照';
      img.onerror = function () {
        var fb = el('div', 'avatar-fallback', esc(firstChar(p.name)));
        ring.replaceChild(fb, img);
      };
      ring.appendChild(img);
    } else {
      ring.appendChild(el('div', 'avatar-fallback', esc(firstChar(p.name))));
    }

    var name = el('h1', 'name');
    var nm = String(p.name || '');
    if (nm.length > 1) {
      name.innerHTML = esc(nm.slice(0, -1)) + '<span class="last-name">' + esc(nm.slice(-1)) + '</span>';
    } else {
      name.textContent = nm;
    }

    top.appendChild(ring);
    top.appendChild(name);
    hero.appendChild(top);

    if (p.headline) hero.appendChild(el('p', 'headline', esc(p.headline)));
    if (p.intent) hero.appendChild(el('p', 'intent', esc(p.intent)));

    if (p.contacts && p.contacts.length) {
      var info = el('div', 'contact-info');
      p.contacts.forEach(function (c) {
        var inner = iconFor(c.icon) + '<span>' + esc(c.value || c.label) + '</span>';
        var node = c.href ? el('a', 'contact-item', inner) : el('span', 'contact-item', inner);
        if (c.href) {
          node.href = c.href;
          if (/^https?:/.test(c.href)) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
        }
        if (c.label) node.title = c.label;
        info.appendChild(node);
      });
      hero.appendChild(info);
    }

    /* 成绩条 */
    var sc = data.scores;
    if (sc && ((sc.items && sc.items.length) || (sc.total && sc.total.value))) {
      var box = el('div', 'scores');
      box.id = 'scores-anchor';
      var head = el('div', 'scores-head');
      head.appendChild(el('span', 'scores-title', esc(sc.title || '成绩')));
      if (sc.total && sc.total.value) {
        head.appendChild(el('span', 'scores-total', '<span>' + esc(sc.total.label || '总分') + '</span>' + esc(sc.total.value)));
      }
      box.appendChild(head);

      if (sc.items && sc.items.length) {
        var list = el('div', 'scores-list');
        sc.items.forEach(function (it) {
          list.appendChild(el('span', 'score-chip', esc(it.label) + '<b>' + esc(it.value) + '</b>'));
        });
        box.appendChild(list);
      }
      hero.appendChild(box);
    }

    return hero;
  }

  function firstChar(s) {
    var t = String(s || '').trim();
    return t ? t.slice(0, 1) : '简';
  }

  /* -------------------------------------------------------------- 区块导航 */
  function renderNav(data, root) {
    var sections = (data.sections || []).filter(function (s) { return s && s.title; });
    if (sections.length < 2) return null;
    var nav = el('nav', 'section-nav');
    sections.forEach(function (s) {
      var a = el('a', 'nav-pill', esc(s.title));
      a.href = '#' + (s.anchor || s.id || '');
      nav.appendChild(a);
    });
    root.appendChild(nav);
    return nav;
  }

  /* ---------------------------------------------------------------- 各版式 */

  function renderTimeline(section) {
    var wrap = el('div', 'timeline');
    (section.items || []).forEach(function (it) {
      var item = el('div', 'timeline-item');

      var icon = el('div', 'timeline-icon');
      if (it.logo) {
        icon.innerHTML = '<img src="' + esc(it.logo) + '" alt="">';
      } else {
        icon.innerHTML = ICONS.cap;
      }
      item.appendChild(icon);

      var content = el('div', 'timeline-content');
      if (it.date) content.appendChild(el('span', 'timeline-date', esc(it.date)));
      content.appendChild(el('h3', null, esc(it.org || '')));
      if (it.degree) content.appendChild(el('p', 'degree', esc(it.degree)));
      if (it.location) content.appendChild(el('p', 'location', esc(it.location)));

      if (it.bullets && it.bullets.length) {
        var ul = el('ul', 'blocks');
        it.bullets.forEach(function (b) {
          ul.appendChild(el('li', null, '<span class="block-text">' + esc(b) + '</span>'));
        });
        content.appendChild(ul);
      }
      item.appendChild(content);
      wrap.appendChild(item);
    });
    return wrap;
  }

  function renderCards(section) {
    var wrap = el('div', 'experience-list');
    (section.items || []).forEach(function (it) {
      var card = el('article', 'card experience-item');

      var header = el('header', 'card-header');
      var ci = el('div', 'card-icon');
      if (it.logo) ci.innerHTML = '<img src="' + esc(it.logo) + '" alt="">';
      else ci.textContent = firstChar(it.org);
      header.appendChild(ci);

      var headText = el('div', 'card-head-text');
      headText.appendChild(el('h3', null, esc(it.org || '')));
      if (it.title) headText.appendChild(el('span', 'job-title', esc(it.title)));
      if (it.location) headText.appendChild(el('div', 'job-location', esc(it.location)));
      header.appendChild(headText);

      if (it.date) header.appendChild(el('span', 'job-date', esc(it.date)));
      card.appendChild(header);

      if (it.blocks && it.blocks.length) {
        var ul = el('ul', 'blocks');
        it.blocks.forEach(function (b) {
          var li = el('li');
          if (b.label) li.appendChild(el('strong', 'block-label', esc(b.label)));
          if (b.text) li.appendChild(el('span', 'block-text', esc(b.text)));
          if (b.label || b.text) ul.appendChild(li);
        });
        if (ul.children.length) card.appendChild(ul);
      }
      wrap.appendChild(card);
    });
    return wrap;
  }

  function renderTags(section) {
    var wrap = el('div', 'skills-grid');
    (section.groups || []).forEach(function (g) {
      var box = el('div', 'skills-group');
      if (g.title) box.appendChild(el('h3', 'skills-group-title', esc(g.title)));
      var tags = el('div', 'tag-container');
      (g.items || []).forEach(function (t) {
        var cls = 'skill-tag' + (t.level === 'main' ? ' main-skill' : t.level === 'aux' ? ' aux-skill' : '');
        tags.appendChild(el('span', cls, esc(t.text)));
      });
      box.appendChild(tags);
      wrap.appendChild(box);
    });
    return wrap;
  }

  function renderList(section) {
    var ul = el('ul', 'list-items');
    (section.items || []).forEach(function (it) {
      var li = el('li');
      if (it.title) li.appendChild(el('span', 'item-title', esc(it.title)));
      if (it.text) li.appendChild(el('span', 'item-text', esc(it.text)));
      ul.appendChild(li);
    });
    return ul;
  }

  /* ------------------------------------------------------------ 整页渲染 */

  function renderInto(root, data, opts) {
    opts = opts || {};
    root.innerHTML = '';

    if (!data || !data.profile) {
      root.appendChild(el('p', 'empty-state', '没有数据。<br>请在 data.js 里填写，或用右下角的「粘贴识别」导入。'));
      return;
    }

    root.appendChild(renderHero(data));

    var sections = (data.sections || []).filter(function (s) {
      if (!s) return false;
      var n = (s.items && s.items.length) || (s.groups && s.groups.length) || 0;
      return n > 0;
    });

    renderNav({ sections: sections }, root);

    sections.forEach(function (s) {
      var sec = el('section', 'resume-section');
      sec.id = s.anchor || s.id || '';
      sec.appendChild(el('h2', 'section-title', esc(s.title || '')));

      /* 鼠标经过时右上角出现的小垃圾桶，点了就删掉整个模块（打印时隐藏） */
      var del = el('button', 'section-remove');
      del.type = 'button';
      del.title = '删除「' + (s.title || '') + '」这个模块';
      del.setAttribute('aria-label', del.title);
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M9 7l.7 12h4.6L15 7"/></svg>';
      sec.appendChild(del);

      var body;
      switch (s.sort) {
        case 'timeline': body = renderTimeline(s); break;
        case 'cards': body = renderCards(s); break;
        case 'tags': body = renderTags(s); break;
        default: body = renderList(s);
      }
      sec.appendChild(body);
      root.appendChild(sec);
    });

    var f = (data.meta && data.meta.footer) || '';
    var note = (data.meta && data.meta.footnote) || '';
    var footer = document.getElementById('page-footer');
    if (footer) {
      var l1 = footer.querySelector('#footer-line') || footer.children[0];
      var l2 = footer.querySelector('#footer-note') || footer.children[1];
      if (l1) l1.textContent = f;
      if (l2) l2.textContent = note;
    }

    /* 浏览器标签页标题也跟着数据走，免得改了名字却忘了改 index.html。
       mini 预览是嵌在抽屉里的，不能去改主文档的标题。 */
    if (!opts.mini) applyTitle(data);

    applyReveal(root, opts.animate !== false);
  }

  /** 计算并设置标签页标题：优先 meta.title，其次用姓名拼一个 */
  function applyTitle(data) {
    var meta = data.meta || {};
    var name = (data.profile && data.profile.name) || '';
    var title = String(meta.title || '').trim();
    if (!title) title = name ? name + ' - 简历' : document.title;
    document.title = title;
    return title;
  }

  /**
   * 滚动进入淡入。
   * 设计原则：**默认可见**。只有「用户真的滚动到它」时才临时挂上 .reveal 播放动画，
   * 播完立刻摘掉类。这样即使 IntersectionObserver 没触发、动画被打断、
   * 或者页面是通过 #锚点 直接跳进来的，内容都绝不会停在 opacity:0 上。
   */
  function applyReveal(root, animate) {
    var all = Array.prototype.slice.call(root.querySelectorAll('.resume-section'));
    if (!all.length) return;

    all.forEach(function (t) { t.classList.add('is-visible'); });

    if (!animate || !('IntersectionObserver' in window)) return;

    var armed = [];

    /* 把「还没进入视口」的区块登记为待播动画（此时仍旧可见，只是记个名单） */
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var t = e.target;
        if (!e.isIntersecting) return;
        io.unobserve(t);
        t.classList.remove('is-visible');
        t.classList.add('reveal');
        t.addEventListener('animationend', function onEnd() {
          t.classList.remove('reveal');
          t.classList.add('is-visible');
          t.removeEventListener('animationend', onEnd);
        });
        /* 保险：动画事件万一不来，1 秒后强制恢复可见 */
        setTimeout(function () {
          t.classList.remove('reveal');
          t.classList.add('is-visible');
        }, 1000);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    all.forEach(function (t) {
      if (t.getBoundingClientRect().top > window.innerHeight) {
        armed.push(t);
        io.observe(t);
      }
    });
  }

  /* 缩略预览：按 720px 设计宽度渲染，再等比缩放到面板里 */
  function renderMini(container, data) {
    if (!container) return;
    container.innerHTML = '';
    var inner = el('div', 'mini-inner');
    inner.style.width = MINI_WIDTH + 'px';

    var faux = el('div', 'container');
    var root = el('main');
    faux.appendChild(root);

    var footer = el('footer');
    footer.appendChild(el('p', null, esc((data.meta && data.meta.footer) || '')));

    inner.appendChild(faux);
    inner.appendChild(footer);
    container.appendChild(inner);

    /* 主渲染逻辑会去找主页面的 footer，这里先记下它的内容，渲染完再还原 */
    var realFooter = document.getElementById('page-footer');
    var realLine = realFooter && realFooter.children[0];
    var keep = realLine ? realLine.textContent : null;

    renderInto(root, data, { animate: false, mini: true });

    if (realLine && keep != null) realLine.textContent = keep;

    fitMini(container, inner);
  }

  var MINI_WIDTH = 720;

  /**
   * 把 720px 宽的缩略预览等比缩放到面板宽度。
   * 用 CSS zoom 而不是 transform: scale()：zoom 会真正改变布局尺寸，
   * 容器自然被撑成缩放后的大小，不需要手动裁剪，也不会出现「缩放了但仍占原尺寸」的空白。
   */
  function fitMini(container, inner) {
    var frame = container.parentElement;
    if (!frame) return;
    if (!inner) inner = container.firstElementChild;
    if (!inner) return;

    inner.style.zoom = '1';
    inner.style.transform = 'none';
    inner.style.width = MINI_WIDTH + 'px';

    var avail = frame.clientWidth - 24;
    if (avail <= 0) return;

    var scale = Math.max(0.2, Math.min(1, avail / MINI_WIDTH));
    inner.style.zoom = String(scale);

    if (global.getComputedStyle && global.getComputedStyle(inner).zoom === 'normal' && scale !== 1) {
      /* 极老的浏览器不支持 zoom，退回 transform 方案 */
      inner.style.zoom = '1';
      inner.style.transformOrigin = 'top left';
      inner.style.transform = 'scale(' + scale + ')';
      var rawHeight = inner.scrollHeight || MINI_WIDTH * 1.4;
      container.style.width = Math.round(MINI_WIDTH * scale) + 'px';
      container.style.height = Math.round(rawHeight * scale) + 'px';
    } else {
      container.style.width = '';
      container.style.height = '';
    }
  }

  global.ResumeRender = {
    renderInto: renderInto,
    renderMini: renderMini,
    fitMini: fitMini,
    applyTitle: applyTitle,
    MINI_WIDTH: MINI_WIDTH,
    esc: esc,
    ICONS: ICONS
  };
})(typeof window !== 'undefined' ? window : globalThis);
