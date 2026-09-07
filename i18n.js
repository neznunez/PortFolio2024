(function (global) {
  var MOBILE_MAX_WIDTH = 768;
  var SUPPORTED = ['pt', 'en'];
  var currentLocale = 'pt';
  var messages = { pt: null, en: null };
  var readyPromise = null;

  function isMobileViewport() {
    try {
      return global.matchMedia('(max-width: ' + MOBILE_MAX_WIDTH + 'px)').matches;
    } catch (e) {
      return (global.innerWidth || MOBILE_MAX_WIDTH + 1) <= MOBILE_MAX_WIDTH;
    }
  }

  function isPtBr(lang) {
    var s = String(lang || '').toLowerCase().replace('_', '-');
    return s === 'pt-br' || s.indexOf('pt-br-') === 0;
  }

  function detectLocale() {
    var list = [];
    try {
      if (global.navigator && global.navigator.languages && global.navigator.languages.length) {
        list = Array.prototype.slice.call(global.navigator.languages);
      }
    } catch (e) {
      list = [];
    }
    if (!list.length) {
      list = [(global.navigator && global.navigator.language) || ''];
    }
    var i;
    for (i = 0; i < list.length; i++) {
      if (isPtBr(list[i])) return 'pt';
    }
    return 'en';
  }

  function getByPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i += 1) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function t(key, vars) {
    var pack = messages[currentLocale] || messages.pt || {};
    var value = getByPath(pack, key);
    if (value == null && currentLocale !== 'pt') {
      value = getByPath(messages.pt || {}, key);
    }
    if (value == null) return String(key || '');
    var text = String(value);
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach(function (k) {
        text = text.split('{{' + k + '}}').join(String(vars[k]));
      });
    }
    return text;
  }

  function getLocale() {
    return currentLocale;
  }

  function setLocale(locale, options) {
    var opts = options || {};
    var next = locale === 'en' ? 'en' : 'pt';
    if (next === currentLocale && !opts.force) return;
    currentLocale = next;
    apply();
    try {
      global.dispatchEvent(new CustomEvent('localechange', { detail: { locale: next } }));
    } catch (e2) {
      /* ignore */
    }
  }

  function catalogLookup(item, base) {
    var catalog = getByPath(messages.en, 'projectCatalog');
    if (!catalog) return '';
    var docId = String(item.docId || item.id || '').trim();
    if (docId && catalog[docId] && catalog[docId][base]) {
      return String(catalog[docId][base]).trim();
    }
    var ptTitle = String(item.title || item.nome || '').trim();
    if (ptTitle && catalog.byTitle && catalog.byTitle[ptTitle] && catalog.byTitle[ptTitle][base]) {
      return String(catalog.byTitle[ptTitle][base]).trim();
    }
    return '';
  }

  function localized(item, field) {
    if (!item) return '';
    var base = field === 'title' ? 'title' : field === 'description' ? 'description' : field === 'subtitle' ? 'subtitle' : field;
    // Categoria/subtítulo é universal — o mesmo valor em PT e EN (filtro futuro).
    if (base === 'subtitle') {
      return String(item.subtitle || item.subtitulo || item.subtitle_en || item.meta || '').trim();
    }
    if (currentLocale === 'en') {
      var enKey = base + '_en';
      var enVal = item[enKey];
      if (enVal != null && String(enVal).trim() !== '') return String(enVal).trim();
      var fromCatalog = catalogLookup(item, base);
      if (fromCatalog) return fromCatalog;
    }
    if (base === 'title') return String(item.title || item.nome || t('projects.defaultTitle')).trim();
    if (base === 'description') return String(item.description || item.descricao || '').trim();
    return String(item[base] || '').trim();
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderSkills(container) {
    if (!container) return;
    var skills = getByPath(messages[currentLocale], 'cv.skills') || getByPath(messages.pt, 'cv.skills');
    if (!skills || !skills.groups) {
      container.innerHTML = '';
      return;
    }
    var html = '';
    skills.groups.forEach(function (group) {
      html += '<div class="skill-topic">' + escapeHtml(group.topic || '') + '</div>';
      (group.rows || []).forEach(function (row) {
        var levelLabel = t('levels.' + (row.levelKey || 'basic'));
        var widthStr = String(row.width || '0%');
        var pct = parseFloat(widthStr);
        if (isNaN(pct)) pct = 0;
        var p = Math.max(0, Math.min(100, pct)) / 100;
        var levelKey = String(row.levelKey || 'basic').replace(/[^a-z]/gi, '');
        html +=
          '<div class="skill-row is-level-' + escapeHtml(levelKey) + '">' +
          '<div class="skill-meta"><span class="skill-name">' + escapeHtml(row.name || '') + '</span></div>' +
          '<div class="skill-progress">' +
          '<div class="skill-track"><div class="skill-fill" style="--skill-width: ' + escapeHtml(widthStr) + '; --skill-p: ' + p + ';"></div></div>' +
          '<span class="skill-level">' + escapeHtml(levelLabel) + '</span>' +
          '</div></div>';
      });
    });
    container.innerHTML = html;
  }

  function apply() {
    var pack = messages[currentLocale] || messages.pt;
    if (!pack) return;

    document.documentElement.lang = currentLocale === 'en' ? 'en' : 'pt-BR';

    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      var value = t(key);
      // Chave ausente (pacote antigo em cache): preserva o texto escrito no HTML.
      if (value === key) return;
      el.textContent = value;
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-html]'), function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (!key) return;
      var html = t(key);
      if (html === key) return;
      if (typeof html === 'string') el.innerHTML = html;
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-attr]'), function (el) {
      var spec = el.getAttribute('data-i18n-attr');
      if (!spec) return;
      spec.split(';').forEach(function (pair) {
        var bits = pair.split(':');
        var attr = (bits[0] || '').trim();
        var key = (bits[1] || '').trim();
        if (!attr || !key) return;
        el.setAttribute(attr, t(key));
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-list]'), function (el) {
      var key = el.getAttribute('data-i18n-list');
      if (!key) return;
      var items = getByPath(pack, key);
      if (!Array.isArray(items)) return;
      el.innerHTML = items.join('');
    });

    var skillsRoot = document.getElementById('skills-content');
    if (skillsRoot) renderSkills(skillsRoot);

  }

  function loadLocaleFile(locale) {
    return fetch('locales/' + locale + '.json', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('locale ' + locale);
        return res.json();
      });
  }

  function init() {
    if (readyPromise) return readyPromise;
    readyPromise = Promise.all(SUPPORTED.map(loadLocaleFile))
      .then(function (packs) {
        messages.pt = packs[0];
        messages.en = packs[1];
        currentLocale = detectLocale();
        apply();
        return currentLocale;
      })
      .catch(function (err) {
        console.warn('i18n: falha ao carregar locales', err);
        currentLocale = detectLocale();
        apply();
        return currentLocale;
      });
    return readyPromise;
  }

  global.I18n = {
    init: init,
    t: t,
    getLocale: getLocale,
    setLocale: setLocale,
    apply: apply,
    localized: localized,
    isMobileViewport: isMobileViewport,
    MOBILE_MAX_WIDTH: MOBILE_MAX_WIDTH,
    ready: function () {
      return readyPromise || init();
    }
  };
})(window);
