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
})(window);
