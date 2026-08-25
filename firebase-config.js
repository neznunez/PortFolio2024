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
})(window);
