(function (global) {
  global.PORTFOLIO_ADMIN_UID = 'eeT0iJOXYlU7g7l6fh9hL5kCLDL2';
  global.PORTFOLIO_MAX_IMAGE_MB = 10;
  global.PORTFOLIO_MAX_VIDEO_MB = 80;
  /** Carrossel: lado maior máx. (qualidade alta, ainda leve na web). */
  global.PORTFOLIO_CAROUSEL_MAX_EDGE = 1920;
  global.PORTFOLIO_CAROUSEL_JPEG_QUALITY = 0.88;
  /** Se já estiver abaixo disto e dentro do max edge, não reprocessa. */
  global.PORTFOLIO_CAROUSEL_SKIP_BYTES = 450 * 1024;
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

  global.fitPortfolioImageSize = function (width, height, maxEdge) {
    var w = Number(width) || 1;
    var h = Number(height) || 1;
    var longest = Math.max(w, h);
    var limit = maxEdge || global.PORTFOLIO_CAROUSEL_MAX_EDGE || 1920;
    if (longest <= limit) return { w: Math.round(w), h: Math.round(h) };
    var scale = limit / longest;
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  };

  /** Redimensiona um Blob/File de imagem para JPEG. Devolve null se falhar ou for GIF/SVG. */
  global.resizeBlobToJpeg = function (blob, maxEdge, quality) {
    return new Promise(function (resolve) {
      if (!blob || typeof blob.size !== 'number' || blob.size < 32) {
        resolve(null);
        return;
      }
      var type = String(blob.type || '').toLowerCase();
      if (type === 'image/gif' || type === 'image/svg+xml') {
        resolve(null);
        return;
      }
      // Firebase por vezes devolve application/octet-stream — ainda assim tentamos descodificar.
      var objectUrl = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        try {
          var srcW = img.naturalWidth || img.width || 0;
          var srcH = img.naturalHeight || img.height || 0;
          if (srcW < 16 || srcH < 16) {
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
            resolve(null);
            return;
          }
          var size = global.fitPortfolioImageSize(srcW, srcH, maxEdge);
          if (size.w < 16 || size.h < 16) {
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
            resolve(null);
            return;
          }
          var canvas = document.createElement('canvas');
          canvas.width = size.w;
          canvas.height = size.h;
          var ctx = canvas.getContext('2d');
          if (!ctx || !canvas.toBlob) {
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
            resolve(null);
            return;
          }
          // Fundo branco: PNG com alpha → JPEG sem zonas pretas.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size.w, size.h);
          ctx.drawImage(img, 0, 0, size.w, size.h);
          canvas.toBlob(
            function (out) {
              try { URL.revokeObjectURL(objectUrl); } catch (e) {}
              if (!out || out.size < 256) {
                resolve(null);
                return;
              }
              resolve(out);
            },
            'image/jpeg',
            quality == null ? (global.PORTFOLIO_CAROUSEL_JPEG_QUALITY || 0.88) : quality
          );
        } catch (err) {
          try { URL.revokeObjectURL(objectUrl); } catch (e) {}
          resolve(null);
        }
      };
      img.onerror = function () {
        try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        resolve(null);
      };
      img.src = objectUrl;
    });
  };

  /** Confirma que um blob de imagem descodifica com dimensões úteis. */
  global.validateImageBlob = function (blob, minEdge) {
    return new Promise(function (resolve) {
      if (!blob || blob.size < 256) {
        resolve(false);
        return;
      }
      var min = minEdge || 16;
      var objectUrl = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width || 0;
        var h = img.naturalHeight || img.height || 0;
        try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        resolve(w >= min && h >= min);
      };
      img.onerror = function () {
        try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        resolve(false);
      };
      img.src = objectUrl;
    });
  };

  /**
   * Prepara imagem para o carrossel: JPEG até max edge, qualidade alta.
   * Mantém o original se GIF/SVG ou se a compressão não reduzir o tamanho.
   */
  global.prepareCarouselImageFile = function (file) {
    return new Promise(function (resolve) {
      if (!file || !(file.type || '').startsWith('image/')) {
        resolve(file);
        return;
      }
      var type = String(file.type || '').toLowerCase();
      if (type === 'image/gif' || type === 'image/svg+xml') {
        resolve(file);
        return;
      }
      var maxEdge = global.PORTFOLIO_CAROUSEL_MAX_EDGE || 1920;
      var quality = global.PORTFOLIO_CAROUSEL_JPEG_QUALITY || 0.88;
      global.resizeBlobToJpeg(file, maxEdge, quality).then(function (blob) {
        if (!blob) {
          resolve(file);
          return;
        }
        if (blob.size >= file.size) {
          resolve(file);
          return;
        }
        var validate = typeof global.validateImageBlob === 'function'
          ? global.validateImageBlob(blob, 16)
          : Promise.resolve(true);
        validate.then(function (ok) {
          if (!ok) {
            resolve(file);
            return;
          }
          var base = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
          resolve(new File([blob], base + '_opt.jpg', { type: 'image/jpeg' }));
        });
      });
    });
  };

  /** Indica se uma imagem já no Storage provavelmente não precisa de reencode. */
  global.shouldSkipCarouselImageOptimize = function (blob, width, height) {
    var skipBytes = global.PORTFOLIO_CAROUSEL_SKIP_BYTES || 450 * 1024;
    var maxEdge = global.PORTFOLIO_CAROUSEL_MAX_EDGE || 1920;
    var w = Number(width) || 0;
    var h = Number(height) || 0;
    var longest = Math.max(w, h);
    var size = blob && typeof blob.size === 'number' ? blob.size : Infinity;
    if (longest > 0 && longest <= maxEdge && size <= skipBytes) return true;
    return false;
  };
})(window);
