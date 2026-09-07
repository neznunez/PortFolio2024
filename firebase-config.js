(function (global) {
  global.PORTFOLIO_ADMIN_UID = 'eeT0iJOXYlU7g7l6fh9hL5kCLDL2';
  global.PORTFOLIO_MAX_IMAGE_MB = 10;
  global.PORTFOLIO_MAX_VIDEO_MB = 80;
  global.PORTFOLIO_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDSgff-2XhWgAhfzB8U6MjHvpMr61v28so',
    authDomain: 'portfolio-neznunez.firebaseapp.com',
    projectId: 'portfolio-neznunez',
    storageBucket: 'portfolio-neznunez.firebasestorage.app',
    messagingSenderId: '182523090058',
    appId: '1:182523090058:web:a0b9aea951268c056d4973',
    measurementId: 'G-XWH6S0H7WN'
  };
  global.isPortfolioAdmin = function (user) {
    return !!(user && user.uid === global.PORTFOLIO_ADMIN_UID);
  };

  /** Em localhost o Storage recusa CORS; o Vite faz proxy destas origens. */
  global.rewriteStorageUrlForLocal = function (url) {
    if (!url || typeof url !== 'string') return url;
    var host = global.location && global.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return url;
    try {
      var parsed = new URL(url, global.location.href);
      if (parsed.hostname === 'firebasestorage.googleapis.com') {
        return '/fb-storage' + parsed.pathname + parsed.search;
      }
      if (parsed.hostname.indexOf('firebasestorage.app') !== -1) {
        return '/fb-storage-app' + parsed.pathname + parsed.search;
      }
      if (parsed.hostname === 'storage.googleapis.com') {
        return '/gcs-storage' + parsed.pathname + parsed.search;
      }
    } catch (e) {
      /* ignore */
    }
    return url;
  };

  /** Extrai o ID de um link do YouTube (watch, youtu.be, embed, shorts, live). */
  global.parseYouTubeId = function (input) {
    if (!input || typeof input !== 'string') return null;
    var raw = input.trim();
    if (!raw) return null;
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
    try {
      var url = new URL(raw, 'https://www.youtube.com');
      var host = (url.hostname || '').replace(/^www\./, '').toLowerCase();
      if (host === 'youtu.be') {
        var shortId = (url.pathname || '').split('/').filter(Boolean)[0] || '';
        return /^[A-Za-z0-9_-]{11}$/.test(shortId) ? shortId : null;
      }
      if (
        host === 'youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host === 'youtube-nocookie.com'
      ) {
        var v = url.searchParams.get('v');
        if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
        var parts = (url.pathname || '').split('/').filter(Boolean);
        var kind = parts[0] || '';
        var idPart = parts[1] || '';
        if (
          (kind === 'embed' || kind === 'shorts' || kind === 'live' || kind === 'v') &&
          /^[A-Za-z0-9_-]{11}$/.test(idPart)
        ) {
          return idPart;
        }
      }
    } catch (e) {
      /* ignore */
    }
    var match = raw.match(
      /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  global.isYouTubeUrl = function (url) {
    return !!global.parseYouTubeId(url);
  };

  global.youtubeWatchUrl = function (id) {
    return id ? 'https://www.youtube.com/watch?v=' + id : '';
  };

  global.youtubeEmbedUrl = function (id, options) {
    if (!id) return '';
    var opts = options || {};
    var params = [
      'rel=0',
      'modestbranding=1',
      'playsinline=1'
    ];
    if (opts.autoplay) params.push('autoplay=1');
    if (opts.mute) params.push('mute=1');
    return 'https://www.youtube.com/embed/' + id + '?' + params.join('&');
  };

  global.youtubePosterUrl = function (id) {
    return id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : '';
  };

  global.isYouTubeCarouselItem = function (item) {
    if (!item || typeof item !== 'object') return false;
    if (item.provider === 'youtube' || item.source === 'youtube') return true;
    if (item.youtubeId && /^[A-Za-z0-9_-]{11}$/.test(String(item.youtubeId))) return true;
    var url = item.url || item.src || '';
    return global.isYouTubeUrl(url);
  };
})(window);
