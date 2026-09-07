/* global THREE, I18n */
(function () {
  function t(key, vars) {
    if (window.I18n && typeof I18n.t === 'function') return I18n.t(key, vars);
    return key;
  }

  function loc(project, field) {
    if (window.I18n && typeof I18n.localized === 'function') return I18n.localized(project, field);
    if (!project) return '';
    if (field === 'title') return String(project.title || project.nome || '').trim();
    if (field === 'description') return String(project.description || project.descricao || '').trim();
    if (field === 'subtitle') {
      return String(project.subtitle || project.subtitulo || project.subtitle_en || project.meta || '').trim();
    }
    return '';
  }

  var scene;
  var camera;
  var renderer;
  var controls = null;
  var mixer = null;
  var model = null;
  var loadingIndicator = null;
  var clock = new THREE.Clock();
  var contentMode = 'cv';
  var projectsData = [];
  var projectsByKey = Object.create(null);
  var selectedProjectId = null;
  var activeProjectMedia = [];
  var activeMediaIndex = 0;
  var imagePreloadCache = Object.create(null);
  var previewRenderToken = 0;
  var currentPreviewIsVideo = false;
  var hoverPreviewTimer = null;
  var hoverPreviewKey = '';
  var videoFrameCache = Object.create(null);
  var videoFramePending = Object.create(null);
  var videoProbeQueue = [];
  var videoProbeActive = false;
  var dbRef = null;
  var isLiteAdmin = false;
  var adminEditBuffer = '';
  var adminEditTimer = null;
  var adminDrafts = Object.create(null);
  var adminSavingByKey = Object.create(null);
  var adminOrderSaving = false;
  var editingProjectKey = null;
  var draggingProjectKey = null;
  var projectReorderActive = false;
  var liveDragRowEl = null;
  var orderAtDragStart = '';
  var liveDragLast = { id: null, after: null };
  var projectsListDnDBound = false;
  var adminModalElements = null;
  var projectDeleteModalElements = null;
  var pendingDeleteProjectKey = null;
  var storageRef = null;
  var _adminSdkPromise = null;
  var _liteAdminAuthBound = false;
  var FIREBASE_AUTH_SRC = 'https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js';
  var FIREBASE_STORAGE_SRC = 'https://www.gstatic.com/firebasejs/8.10.1/firebase-storage.js';
  var adminPreviewUploadBusy = false;
  var LITE_MAX_IMAGE_MB = window.PORTFOLIO_MAX_IMAGE_MB || 10;
  var LITE_MAX_VIDEO_MB = window.PORTFOLIO_MAX_VIDEO_MB || 80;
  var previewDisplayedProjectKey = '';
  var adminSaveNoticeByKey = Object.create(null);
  var adminSaveNoticeClearTimer = null;
  var projectListOrderDirty = false;
  var LITE_MODEL_URL = window.PORTFOLIO_MODEL_URL || 'models/NezmodelF2.tex.webp.1k.glb';

  var skyboxes = [
    [
      'desertdawn/desertdawn_ft.jpg',
      'desertdawn/desertdawn_bk.jpg',
      'desertdawn/desertdawn_up.jpg',
      'desertdawn/desertdawn_dn.jpg',
      'desertdawn/desertdawn_rt.jpg',
      'desertdawn/desertdawn_lf.jpg'
    ],
    [
      'Rainbow/rainbow_ft.png',
      'Rainbow/rainbow_bk.png',
      'Rainbow/rainbow_up.png',
      'Rainbow/rainbow_dn.png',
      'Rainbow/rainbow_rt.png',
      'Rainbow/rainbow_lf.png'
    ]
  ];

  var skyboxWeights = [5, 3];
  var firebaseConfig = window.PORTFOLIO_FIREBASE_CONFIG || null;

  function loadExternalScriptOnce(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-lazy-src="' + src + '"]');
      if (existing) {
        if (existing.getAttribute('data-lazy-ready') === '1') {
          resolve();
          return;
        }
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error('Falha ao carregar ' + src)); });
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.setAttribute('data-lazy-src', src);
      s.onload = function () {
        s.setAttribute('data-lazy-ready', '1');
        resolve();
      };
      s.onerror = function () { reject(new Error('Falha ao carregar ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureFirebaseAdminSdk() {
    if (typeof window.firebase !== 'undefined' &&
        typeof window.firebase.auth === 'function' &&
        typeof window.firebase.storage === 'function' &&
        storageRef) {
      return Promise.resolve();
    }
    if (_adminSdkPromise) return _adminSdkPromise;

    _adminSdkPromise = Promise.resolve()
      .then(function () {
        if (typeof window.firebase.auth === 'function') return;
        return loadExternalScriptOnce(FIREBASE_AUTH_SRC);
      })
      .then(function () {
        if (typeof window.firebase.storage === 'function') return;
        return loadExternalScriptOnce(FIREBASE_STORAGE_SRC);
      })
      .then(function () {
        if (!window.firebase.apps.length && firebaseConfig) {
          window.firebase.initializeApp(firebaseConfig);
        }
        window.firebase.auth();
        try {
          storageRef = window.firebase.storage();
        } catch (storageErr) {
          console.warn('Firebase Storage indisponivel no lite:', storageErr);
          storageRef = null;
        }
        if (!_liteAdminAuthBound && window.firebase.auth) {
          _liteAdminAuthBound = true;
          window.firebase.auth().onAuthStateChanged(function (user) {
            if (!isLiteAdmin) return;
            var stillAdmin = typeof window.isPortfolioAdmin === 'function'
              ? window.isPortfolioAdmin(user)
              : false;
            if (!stillAdmin) exitLiteAdmin(false);
          });
        }
      })
      .catch(function (err) {
        _adminSdkPromise = null;
        throw err;
      });

    return _adminSdkPromise;
  }

  function getWeightedSkybox() {
    return skyboxes[0];
  }

  function isMobileViewport() {
    if (window.I18n && typeof I18n.isMobileViewport === 'function') {
      return I18n.isMobileViewport();
    }
    try {
      return window.matchMedia('(max-width: 768px)').matches;
    } catch (e) {
      return window.innerWidth <= 768;
    }
  }

  function setupModeToggle() {
    var modeButton = document.getElementById('modeToggle');
    if (!modeButton) return;

    if (isMobileViewport()) {
      modeButton.classList.add('is-hidden-mobile');
      modeButton.setAttribute('aria-hidden', 'true');
      modeButton.tabIndex = -1;
      return;
    }

    modeButton.addEventListener('click', function () {
      localStorage.setItem('portfolio_mode', 'full');
      window.location.href = 'index.html';
    });
  }

  function setupContentToggle() {
    var cvButton = document.getElementById('showCV');
    var projectsButton = document.getElementById('showProjects');
    if (!cvButton || !projectsButton) return;

    cvButton.addEventListener('click', function () {
      setContentMode('cv');
    });
    projectsButton.addEventListener('click', function () {
      setContentMode('projects');
    });

    var prevButton = document.getElementById('project-prev');
    var nextButton = document.getElementById('project-next');
    var playButton = document.getElementById('project-video-play');
    if (prevButton) {
      prevButton.addEventListener('click', function () {
        if (!activeProjectMedia.length) return;
        activeMediaIndex = (activeMediaIndex - 1 + activeProjectMedia.length) % activeProjectMedia.length;
        renderProjectMedia({ showControls: true });
      });
    }
    if (nextButton) {
      nextButton.addEventListener('click', function () {
        if (!activeProjectMedia.length) return;
        activeMediaIndex = (activeMediaIndex + 1) % activeProjectMedia.length;
        renderProjectMedia({ showControls: true });
      });
    }
    if (playButton) {
      playButton.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
      });
      playButton.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        togglePreviewVideoPlayback();
      });
    }
    var preview = document.getElementById('project-preview');
    if (preview) {
      preview.addEventListener('click', function (e) {
        if (!playButton || playButton.classList.contains('is-hidden')) return;
        if (e.target && e.target.closest && (
          e.target.closest('#project-video-play') ||
          e.target.closest('#project-preview-controls') ||
          e.target.closest('#project-preview-add-wrap') ||
          e.target.closest('#project-media-order-wrap')
        )) return;
        togglePreviewVideoPlayback();
      });
    }
  }

  function setProjectPreviewLoading(isActive) {
    var el = document.getElementById('project-preview-loading');
    if (!el) return;
    el.classList.toggle('is-active', !!isActive);
    el.setAttribute('aria-busy', isActive ? 'true' : 'false');
  }

  function updateProjectPreviewAddButton() {
    var wrap = document.getElementById('project-preview-add-wrap');
    if (!wrap) return;
    var show =
      contentMode === 'projects' &&
      isLiteAdmin &&
      selectedProjectId &&
      dbRef &&
      storageRef;
    var proj = show ? getProjectByKey(selectedProjectId) : null;
    var previewMatchesSelection =
      !!selectedProjectId && previewDisplayedProjectKey === selectedProjectId;
    var canUpload = !!(proj && proj.docId && !adminPreviewUploadBusy && previewMatchesSelection);
    wrap.classList.toggle(
      'is-visible',
      show && !!proj && !!proj.docId && !!storageRef && previewMatchesSelection
    );
    wrap.classList.toggle('is-busy', adminPreviewUploadBusy);
    var btn = document.getElementById('project-preview-add-btn');
    if (btn) btn.disabled = !canUpload || adminPreviewUploadBusy;
    wrap.setAttribute(
      'aria-hidden',
      show && proj && proj.docId && storageRef && previewMatchesSelection ? 'false' : 'true'
    );
  }

  function liteUploadProjectMediaFile(docId, file) {
    return new Promise(function (resolve, reject) {
      if (!storageRef) {
        reject(new Error(t('js.storageError')));
        return;
      }
      var fileName = Date.now() + '_' + String(file.name || 'media').replace(/[^\w.\-]+/g, '_');
      var ref = storageRef.ref('projects/' + docId + '/' + fileName);
      var task = ref.put(file, { cacheControl: 'public, max-age=31536000' });
      task.on(
        'state_changed',
        function () {},
        function (err) {
          reject(err);
        },
        function () {
          task.snapshot.ref.getDownloadURL().then(resolve).catch(reject);
        }
      );
    });
  }

  var CUBE_FACE_MAX_EDGE = 512;

  function resizeFileToJpeg(file, maxEdge, quality) {
    return new Promise(function (resolve) {
      if (!file || !(file.type || '').startsWith('image/')) {
        resolve(null);
        return;
      }
      var objectUrl = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var size = fitMediaSize(img.naturalWidth || img.width, img.naturalHeight || img.height, maxEdge || CUBE_FACE_MAX_EDGE);
          var canvas = document.createElement('canvas');
          canvas.width = size.w;
          canvas.height = size.h;
          var ctx = canvas.getContext('2d');
          if (!ctx || !canvas.toBlob) {
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, size.w, size.h);
          canvas.toBlob(function (blob) {
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
            resolve(blob || null);
          }, 'image/jpeg', quality == null ? 0.82 : quality);
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
  }

  function liteUploadImageWithCubeThumb(docId, file) {
    var prepare = (typeof window.prepareCarouselImageFile === 'function')
      ? window.prepareCarouselImageFile(file)
      : Promise.resolve(file);
    return prepare.then(function (carouselFile) {
      var uploadFile = carouselFile || file;
      return liteUploadProjectMediaFile(docId, uploadFile).then(function (url) {
        return resizeFileToJpeg(file, CUBE_FACE_MAX_EDGE, 0.82).then(function (blob) {
          if (!blob) return { url: url, thumb: '', optimized: true };
          var thumbFile = new File([blob], Date.now() + '_cube.jpg', { type: 'image/jpeg' });
          return liteUploadProjectMediaFile(docId, thumbFile).then(function (thumbUrl) {
            return { url: url, thumb: thumbUrl || '', optimized: true };
          }).catch(function () {
            return { url: url, thumb: '', optimized: true };
          });
        });
      });
    });
  }

  function liteSaveNewImageUrlsToProject(docId, newEntries) {
    if (!dbRef || !newEntries.length) return Promise.resolve();
    var entries = newEntries.map(function (item) {
      if (typeof item === 'string') return { url: item, thumb: '' };
      return { url: item && item.url, thumb: (item && item.thumb) || '' };
    }).filter(function (item) { return !!item.url; });
    return dbRef
      .collection('projetos')
      .doc(docId)
      .get()
      .then(function (snap) {
        var data = snap.exists ? snap.data() || {} : {};
        var existingImages = Array.isArray(data.images) ? data.images : [];
        var existingCarousel =
          Array.isArray(data.carouselItems) && data.carouselItems.length > 0
            ? data.carouselItems
            : existingImages.map(function (u) {
                return { type: 'image', url: u };
              });
        var cubeUrls = entries.map(function (item) { return item.thumb || item.url; });
        var newImageEntries = entries.map(function (item) {
          var row = { type: 'image', url: item.url };
          if (item.thumb) row.thumb = item.thumb;
          if (item.optimized) row.optimized = true;
          return row;
        });
        return dbRef.collection('projetos').doc(docId).set(
          {
            images: existingImages.concat(cubeUrls),
            carouselItems: existingCarousel.concat(newImageEntries)
          },
          { merge: true }
        );
      });
  }

  function fitMediaSize(width, height, maxEdge) {
    var w = Number(width) || 320;
    var h = Number(height) || 180;
    var longest = Math.max(w, h);
    var limit = maxEdge || 720;
    if (longest <= limit) return { w: Math.round(w), h: Math.round(h) };
    var scale = limit / longest;
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }

  function capturePosterBlobFromVideoFile(file) {
    return new Promise(function (resolve) {
      if (!file) {
        resolve(null);
        return;
      }
      var objectUrl = URL.createObjectURL(file);
      var probe = document.createElement('video');
      var done = false;
      probe.muted = true;
      probe.playsInline = true;
      probe.preload = 'metadata';

      function finish(blob) {
        if (done) return;
        done = true;
        try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        probe.removeAttribute('src');
        try { probe.load(); } catch (err) {}
        resolve(blob || null);
      }

      probe.onloadedmetadata = function () {
        try {
          var d = Number(probe.duration || 0);
          probe.currentTime = isFinite(d) && d > 0.2 ? 0.12 : 0;
        } catch (e) {}
      };
      probe.onseeked = function () {
        try {
          var size = fitMediaSize(probe.videoWidth, probe.videoHeight, 720);
          var canvas = document.createElement('canvas');
          canvas.width = size.w;
          canvas.height = size.h;
          var ctx = canvas.getContext('2d');
          if (!ctx) {
            finish(null);
            return;
          }
          ctx.drawImage(probe, 0, 0, size.w, size.h);
          if (canvas.toBlob) {
            canvas.toBlob(function (blob) { finish(blob); }, 'image/jpeg', 0.82);
          } else {
            finish(null);
          }
        } catch (e) {
          finish(null);
        }
      };
      probe.onerror = function () { finish(null); };
      probe.src = objectUrl;
      probe.load();
    });
  }

  function liteUploadVideoWithPoster(docId, file) {
    var posterPromise = capturePosterBlobFromVideoFile(file).then(function (blob) {
      if (!blob) return '';
      var posterFile = new File([blob], Date.now() + '_poster.jpg', { type: 'image/jpeg' });
      return liteUploadProjectMediaFile(docId, posterFile).catch(function () { return ''; });
    });
    return Promise.all([liteUploadProjectMediaFile(docId, file), posterPromise]).then(function (parts) {
      return { url: parts[0], poster: parts[1] || '' };
    });
  }

  function liteSaveNewVideoEntriesToProject(docId, entries) {
    if (!dbRef || !entries.length) return Promise.resolve();
    return dbRef
      .collection('projetos')
      .doc(docId)
      .get()
      .then(function (snap) {
        var data = snap.exists ? snap.data() || {} : {};
        var existingImages = Array.isArray(data.images) ? data.images : [];
        var existingCarousel =
          Array.isArray(data.carouselItems) && data.carouselItems.length > 0
            ? data.carouselItems
            : existingImages.map(function (u) {
                return { type: 'image', url: u };
              });
        var newVideoEntries = entries.map(function (entry) {
          var url = typeof entry === 'string' ? entry : entry && entry.url;
          var row = { type: 'video', url: url };
          if (entry && entry.poster) row.poster = entry.poster;
          return row;
        }).filter(function (row) { return !!row.url; });
        return dbRef.collection('projetos').doc(docId).set(
          {
            carouselItems: existingCarousel.concat(newVideoEntries)
          },
          { merge: true }
        );
      });
  }

  function refreshProjectMediaFromFirestore(docId) {
    if (!dbRef || !docId) return Promise.resolve();
    return dbRef
      .collection('projetos')
      .doc(docId)
      .get()
      .then(function (snap) {
        if (!snap.exists) return;
        var data = snap.data() || {};
        var project = projectsData.find(function (p) {
          return p.docId === docId;
        });
        if (!project) return;
        applyFirestoreMediaToProject(project, data);
        projectsByKey[project.key] = project;
        if (selectedProjectId === project.key) {
          updateProjectPreview(
            project.mediaItems && project.mediaItems.length
              ? project.mediaItems
              : [{ type: 'image', src: project.preview }],
            { showControls: true, autoplayVideo: false, previewOwnerKey: project.key }
          );
        }
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
      });
  }

  function handleProjectPreviewMediaInputChange(event) {
    var input = event && event.target;
    if (!input || !input.files || !input.files.length) return;
    if (!isLiteAdmin || !selectedProjectId || !dbRef) {
      input.value = '';
      return;
    }
    var project = getProjectByKey(selectedProjectId);
    if (!project || !project.docId) {
      input.value = '';
      return;
    }
    if (!storageRef) {
      alert(t('js.storageUnavailable'));
      input.value = '';
      return;
    }

    var files = Array.prototype.slice.call(input.files);
    var imageFiles = files.filter(function (f) {
      return f.type && f.type.indexOf('image/') === 0;
    });
    var videoFiles = files.filter(function (f) {
      if (f.type && f.type.indexOf('image/') === 0) return false;
      if (
        f.type === 'video/mp4' ||
        f.type === 'video/webm' ||
        f.type === 'video/quicktime' ||
        f.type === 'video/x-quicktime'
      ) {
        return true;
      }
      var name = String(f.name || '').toLowerCase();
      return name.endsWith('.mov') || name.endsWith('.mp4') || name.endsWith('.webm');
    });
    if (!imageFiles.length && !videoFiles.length) {
      alert(t('js.pickMedia'));
      input.value = '';
      return;
    }

    var imgMax = LITE_MAX_IMAGE_MB * 1024 * 1024;
    var vidMax = LITE_MAX_VIDEO_MB * 1024 * 1024;
    imageFiles = imageFiles.filter(function (f) {
      return f.size <= imgMax;
    });
    videoFiles = videoFiles.filter(function (f) {
      return f.size <= vidMax;
    });
    if (!imageFiles.length && !videoFiles.length) {
      alert(t('js.fileTooLarge'));
      input.value = '';
      return;
    }

    adminPreviewUploadBusy = true;
    updateProjectPreviewAddButton();
    setProjectPreviewLoading(true);

    var docId = project.docId;
    var chain = Promise.resolve();

    if (imageFiles.length) {
      chain = chain.then(function () {
        return Promise.all(imageFiles.map(function (f) {
          return liteUploadImageWithCubeThumb(docId, f);
        })).then(function (urls) {
          return liteSaveNewImageUrlsToProject(docId, urls);
        });
      });
    }
    if (videoFiles.length) {
      chain = chain.then(function () {
        return Promise.all(videoFiles.map(function (f) {
          return liteUploadVideoWithPoster(docId, f);
        })).then(function (entries) {
          return liteSaveNewVideoEntriesToProject(docId, entries);
        });
      });
    }

    chain
      .then(function () {
        return refreshProjectMediaFromFirestore(docId);
      })
      .catch(function (err) {
        console.warn('Upload mídia Lite:', err);
        setProjectPreviewLoading(false);
        alert(err && err.message ? err.message : t('js.uploadError'));
      })
      .finally(function () {
        adminPreviewUploadBusy = false;
        input.value = '';
        updateProjectPreviewAddButton();
      });
  }

  function setupProjectPreviewUpload() {
    var btn = document.getElementById('project-preview-add-btn');
    var input = document.getElementById('project-preview-media-input');
    if (!btn || !input) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled || adminPreviewUploadBusy) return;
      input.click();
    });
    input.addEventListener('change', handleProjectPreviewMediaInputChange);
    setupProjectYouTubeUrlControls();
  }

  function setupProjectYouTubeUrlControls() {
    var ytInput = document.getElementById('project-youtube-url-input');
    var ytBtn = document.getElementById('project-youtube-url-btn');
    if (!ytInput || !ytBtn || ytBtn.dataset.bound === '1') return;
    ytBtn.dataset.bound = '1';
    function submitYouTube() {
      if (!isLiteAdmin || !selectedProjectId || !dbRef) return;
      var project = getProjectByKey(selectedProjectId);
      if (!project || !project.docId) return;
      var raw = String(ytInput.value || '').trim();
      if (!raw) return;
      var ytId = typeof window.parseYouTubeId === 'function' ? window.parseYouTubeId(raw) : null;
      if (!ytId) {
        alert(t('js.youtubeInvalid'));
        return;
      }
      var existing = Array.isArray(project.mediaItems) ? project.mediaItems : [];
      var already = existing.some(function (item) {
        if (!item) return false;
        if (item.youtubeId === ytId) return true;
        return typeof window.parseYouTubeId === 'function' && window.parseYouTubeId(item.src || '') === ytId;
      });
      if (already) {
        alert(t('js.youtubeExists'));
        return;
      }

      ytBtn.disabled = true;
      ytInput.disabled = true;
      setProjectPreviewLoading(true);
      var watchUrl =
        typeof window.youtubeWatchUrl === 'function'
          ? window.youtubeWatchUrl(ytId)
          : 'https://www.youtube.com/watch?v=' + ytId;
      var poster =
        typeof window.youtubePosterUrl === 'function' ? window.youtubePosterUrl(ytId) : '';

      dbRef
        .collection('projetos')
        .doc(project.docId)
        .get()
        .then(function (snap) {
          var data = snap.exists ? snap.data() || {} : {};
          var base =
            Array.isArray(data.carouselItems) && data.carouselItems.length
              ? data.carouselItems.slice()
              : existing.map(function (item) {
                  if (
                    item.provider === 'youtube' ||
                    item.youtubeId ||
                    (typeof window.isYouTubeUrl === 'function' && window.isYouTubeUrl(item.src))
                  ) {
                    var id =
                      item.youtubeId ||
                      (typeof window.parseYouTubeId === 'function'
                        ? window.parseYouTubeId(item.src)
                        : '');
                    return {
                      type: 'video',
                      provider: 'youtube',
                      youtubeId: id || '',
                      url: item.src,
                      poster: item.poster || ''
                    };
                  }
                  var row = { type: item.type === 'video' ? 'video' : 'image', url: item.src };
                  if (item.poster) row.poster = item.poster;
                  if (item.thumb) row.thumb = item.thumb;
                  return row;
                });
          base.push({
            type: 'video',
            provider: 'youtube',
            youtubeId: ytId,
            url: watchUrl,
            poster: poster
          });
          return dbRef.collection('projetos').doc(project.docId).set({ carouselItems: base }, { merge: true });
        })
        .then(function () {
          ytInput.value = '';
          return refreshProjectMediaFromFirestore(project.docId);
        })
        .then(function () {
          alert(t('js.youtubeAdded'));
        })
        .catch(function (err) {
          console.warn('YouTube Lite:', err);
          alert(t('js.youtubeAddFailed'));
        })
        .finally(function () {
          ytBtn.disabled = false;
          ytInput.disabled = false;
          setProjectPreviewLoading(false);
        });
    }
    ytBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      submitYouTube();
    });
    ytInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitYouTube();
      }
    });
  }

  function setupAdminLiteTrigger() {
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isLiteAdmin) {
        exitLiteAdmin(true);
        return;
      }

      if (!event.key || event.key.length !== 1) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      var tag = (event.target && event.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (event.target && event.target.isContentEditable)) return;

      adminEditBuffer = (adminEditBuffer + event.key.toLowerCase()).slice(-16);
      if (adminEditTimer) clearTimeout(adminEditTimer);
      adminEditTimer = setTimeout(function () {
        adminEditBuffer = '';
      }, 1200);

      if (adminEditBuffer.indexOf('admin lite') !== -1 || adminEditBuffer.indexOf('adminlite') !== -1) {
        adminEditBuffer = '';
        requestAdminLiteLogin();
      }
    });
  }

  function setupAdminLiteModal() {
    var modal = document.getElementById('admin-lite-modal');
    var form = document.getElementById('admin-lite-form');
    var emailInput = document.getElementById('admin-lite-email');
    var passwordInput = document.getElementById('admin-lite-password');
    var feedbackEl = document.getElementById('admin-lite-feedback');
    var cancelButton = document.getElementById('admin-lite-cancel');
    var submitButton = document.getElementById('admin-lite-submit');
    if (!modal || !form || !emailInput || !passwordInput || !feedbackEl || !cancelButton || !submitButton) return;

    adminModalElements = {
      modal: modal,
      form: form,
      emailInput: emailInput,
      passwordInput: passwordInput,
      feedbackEl: feedbackEl,
      cancelButton: cancelButton,
      submitButton: submitButton
    };

    modal.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.getAttribute && target.getAttribute('data-admin-modal-close') === 'true') {
        closeAdminLiteModal();
      }
    });

    cancelButton.addEventListener('click', function () {
      closeAdminLiteModal();
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submitAdminLiteLogin();
    });
  }

  function setupProjectDeleteModal() {
    var modal = document.getElementById('project-delete-modal');
    var nameEl = document.getElementById('project-delete-name');
    var errorEl = document.getElementById('project-delete-error');
    var cancelBtn = document.getElementById('project-delete-cancel');
    var confirmBtn = document.getElementById('project-delete-confirm');
    if (!modal || !nameEl || !errorEl || !cancelBtn || !confirmBtn) return;

    projectDeleteModalElements = {
      modal: modal,
      nameEl: nameEl,
      errorEl: errorEl,
      cancelBtn: cancelBtn,
      confirmBtn: confirmBtn
    };

    modal.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.getAttribute && target.getAttribute('data-project-delete-close') === 'true') {
        closeProjectDeleteModal();
      }
    });

    cancelBtn.addEventListener('click', function () {
      closeProjectDeleteModal();
    });

    confirmBtn.addEventListener('click', function () {
      if (pendingDeleteProjectKey) performDeleteProjectByKey(pendingDeleteProjectKey);
    });

    document.addEventListener('keydown', function (event) {
      if (!projectDeleteModalElements || projectDeleteModalElements.modal.classList.contains('is-hidden')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeProjectDeleteModal();
      }
    });
  }

  function setProjectDeleteModalLoading(isLoading) {
    if (!projectDeleteModalElements) return;
    projectDeleteModalElements.cancelBtn.disabled = !!isLoading;
    projectDeleteModalElements.confirmBtn.disabled = !!isLoading;
    projectDeleteModalElements.confirmBtn.textContent = isLoading ? t('deleteProject.confirming') : t('deleteProject.confirm');
  }

  function openProjectDeleteModal(projectKey) {
    if (!projectDeleteModalElements) return;
    var key = String(projectKey || '');
    var project = getProjectByKey(key);
    if (!project) return;
    pendingDeleteProjectKey = key;
    projectDeleteModalElements.errorEl.textContent = '';
    var displayTitle = loc(project, 'title');
    projectDeleteModalElements.nameEl.textContent = displayTitle
      ? t('deleteProject.namePrefix') + ' ' + displayTitle
      : t('deleteProject.untitled');
    projectDeleteModalElements.modal.classList.remove('is-hidden');
    projectDeleteModalElements.modal.setAttribute('aria-hidden', 'false');
    setProjectDeleteModalLoading(false);
    projectDeleteModalElements.cancelBtn.focus();
  }

  function closeProjectDeleteModal() {
    if (!projectDeleteModalElements) return;
    projectDeleteModalElements.modal.classList.add('is-hidden');
    projectDeleteModalElements.modal.setAttribute('aria-hidden', 'true');
    pendingDeleteProjectKey = null;
    projectDeleteModalElements.errorEl.textContent = '';
    setProjectDeleteModalLoading(false);
  }

  function openAdminLiteModal() {
    if (!adminModalElements) return;
    adminModalElements.modal.classList.remove('is-hidden');
    adminModalElements.modal.setAttribute('aria-hidden', 'false');
    setAdminModalFeedback('');
    setAdminModalLoading(false);
    adminModalElements.emailInput.value = '';
    adminModalElements.passwordInput.value = '';
    adminModalElements.emailInput.focus();
  }

  function closeAdminLiteModal() {
    if (!adminModalElements) return;
    adminModalElements.modal.classList.add('is-hidden');
    adminModalElements.modal.setAttribute('aria-hidden', 'true');
    setAdminModalFeedback('');
    setAdminModalLoading(false);
  }

  function setAdminModalFeedback(message) {
    if (!adminModalElements || !adminModalElements.feedbackEl) return;
    adminModalElements.feedbackEl.textContent = message || '';
  }

  function setAdminModalLoading(isLoading) {
    if (!adminModalElements) return;
    adminModalElements.emailInput.disabled = !!isLoading;
    adminModalElements.passwordInput.disabled = !!isLoading;
    adminModalElements.cancelButton.disabled = !!isLoading;
    adminModalElements.submitButton.disabled = !!isLoading;
    adminModalElements.submitButton.textContent = isLoading ? t('admin.submitting') : t('admin.submit');
  }

  function submitAdminLiteLogin() {
    if (!adminModalElements) return;
    var email = String(adminModalElements.emailInput.value || '').trim();
    var password = String(adminModalElements.passwordInput.value || '');
    if (!email || !password) {
      setAdminModalFeedback(t('admin.fillRequired'));
      return;
    }

    setAdminModalLoading(true);
    setAdminModalFeedback('');

    window.firebase.auth().signInWithEmailAndPassword(email, password)
      .then(function (credential) {
        var user = credential && credential.user;
        if (typeof window.isPortfolioAdmin === 'function' ? !window.isPortfolioAdmin(user) : true) {
          return window.firebase.auth().signOut().then(function () {
            var err = new Error('not-admin');
            err.code = 'not-admin';
            throw err;
          });
        }
        isLiteAdmin = true;
        closeAdminLiteModal();
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
        updateProjectPreviewAddButton();
        updateProjectListOrderBar();
      })
      .catch(function (error) {
        console.warn('Falha no login Admin Lite:', error);
        if (error && (error.code === 'not-admin' || error.message === 'not-admin')) {
          setAdminModalFeedback(t('admin.notAuthorized'));
        } else {
          setAdminModalFeedback(t('admin.invalidLogin'));
        }
      })
      .finally(function () {
        setAdminModalLoading(false);
      });
  }

  function requestAdminLiteLogin() {
    if (isLiteAdmin) {
      alert(t('js.adminAlreadyActive'));
      return;
    }

    ensureFirebaseAdminSdk()
      .then(function () {
        if (!window.firebase || !window.firebase.auth) {
          alert(t('js.authUnavailable'));
          return;
        }
        openAdminLiteModal();
      })
      .catch(function (err) {
        console.error(err);
        alert(t('js.authUnavailable'));
      });
  }

  function setContentMode(mode) {
    contentMode = mode;
    var cvButton = document.getElementById('showCV');
    var projectsButton = document.getElementById('showProjects');
    var cvPanel = document.getElementById('cv-panel');
    var projectsPanel = document.getElementById('projects-panel');
    var preview = document.getElementById('project-preview');
    var headWrap = document.getElementById('head-canvas-wrap');
    var leftPane = document.querySelector('.lite-left');
    var navLinks = Array.prototype.slice.call(document.querySelectorAll('.lite-copy-nav a'));

    var isProjects = mode === 'projects';
    if (cvButton) cvButton.classList.toggle('is-active', !isProjects);
    if (projectsButton) projectsButton.classList.toggle('is-active', isProjects);
    if (cvPanel) cvPanel.classList.toggle('is-hidden', isProjects);
    if (projectsPanel) projectsPanel.classList.toggle('is-hidden', !isProjects);
    if (preview) preview.classList.toggle('is-hidden', !isProjects);
    if (headWrap) headWrap.classList.toggle('is-hidden', isProjects);
    if (leftPane) leftPane.classList.toggle('projects-mode', isProjects);
    if (loadingIndicator) loadingIndicator.classList.toggle('is-hidden', isProjects || !!model);
    updateProjectPreviewAddButton();
    updateProjectMediaOrderTools();
    updateProjectListOrderBar();

    // remove destaque fixo do indice CV quando estiver em Projetos
    navLinks.forEach(function (link) {
      if (isProjects) link.classList.remove('is-active');
    });
  }

  function exitLiteAdmin(showAlert) {
    isLiteAdmin = false;
    adminDrafts = Object.create(null);
    editingProjectKey = null;
    projectListOrderDirty = false;
    function afterExit() {
      if (showAlert) alert(t('js.adminDisabled'));
      renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
      updateProjectPreviewAddButton();
      updateProjectListOrderBar();
    }
    if (window.firebase && window.firebase.auth) {
      window.firebase.auth().signOut().then(afterExit).catch(afterExit);
    } else {
      afterExit();
    }
  }

  function setupFirebase() {
    if (!window.firebase || !window.firebase.apps || !firebaseConfig) return null;
    try {
      if (!window.firebase.apps.length) {
        window.firebase.initializeApp(firebaseConfig);
      }
      storageRef = null;
      return window.firebase.firestore();
    } catch (error) {
      console.warn('Firebase indisponivel no lite:', error);
      return null;
    }
  }

  function isVideoUrl(url) {
    var value = String(url || '').toLowerCase();
    if (typeof window.isYouTubeUrl === 'function' && window.isYouTubeUrl(url)) return true;
    return (
      /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(value) ||
      value.indexOf('mime=video') !== -1 ||
      value.indexOf('contenttype=video') !== -1 ||
      value.indexOf('/videos/') !== -1 ||
      value.indexOf('%2fvideos%2f') !== -1
    );
  }

  function isImageUrl(url) {
    var value = String(url || '').toLowerCase();
    return (
      /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i.test(value) ||
      value.indexOf('mime=image') !== -1 ||
      value.indexOf('contenttype=image') !== -1
    );
  }

  function isVideoTypeHint(hint) {
    var value = String(hint || '').toLowerCase();
    return value.indexOf('video') !== -1;
  }

  function normalizeMediaEntry(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      if (typeof window.parseYouTubeId === 'function') {
        var bareYt = window.parseYouTubeId(raw);
        if (bareYt) {
          return {
            type: 'video',
            provider: 'youtube',
            youtubeId: bareYt,
            src: typeof window.youtubeWatchUrl === 'function' ? window.youtubeWatchUrl(bareYt) : raw,
            poster: typeof window.youtubePosterUrl === 'function' ? window.youtubePosterUrl(bareYt) : ''
          };
        }
      }
      if (isVideoUrl(raw)) return { type: 'video', src: raw };
      if (isImageUrl(raw)) return { type: 'image', src: raw };
      return null;
    }
    if (typeof raw !== 'object') return null;
    var src =
      raw.url ||
      raw.src ||
      raw.imageUrl ||
      raw.downloadURL ||
      raw.path ||
      raw.image ||
      raw.thumbnail ||
      raw.fileUrl ||
      '';
    if (!src || typeof src !== 'string') return null;
    if (typeof window.rewriteStorageUrlForLocal === 'function') {
      src = window.rewriteStorageUrlForLocal(src);
    }
    var explicitType = (
      raw.type ||
      raw.kind ||
      raw.mediaType ||
      raw.mimeType ||
      raw.contentType ||
      ''
    )
      .toString()
      .toLowerCase();
    var poster = raw.poster || raw.posterUrl || '';
    if (poster && typeof poster === 'string' && typeof window.rewriteStorageUrlForLocal === 'function') {
      poster = window.rewriteStorageUrlForLocal(poster);
    }
    var thumb = raw.thumb || raw.thumbnail || '';
    if (thumb && typeof thumb === 'string' && typeof window.rewriteStorageUrlForLocal === 'function') {
      thumb = window.rewriteStorageUrlForLocal(thumb);
    }
    var ytId =
      raw.youtubeId ||
      (typeof window.parseYouTubeId === 'function' ? window.parseYouTubeId(src) : null) ||
      '';
    if (
      raw.provider === 'youtube' ||
      raw.source === 'youtube' ||
      ytId ||
      (typeof window.isYouTubeUrl === 'function' && window.isYouTubeUrl(src))
    ) {
      ytId = ytId || (typeof window.parseYouTubeId === 'function' ? window.parseYouTubeId(src) : '');
      return {
        type: 'video',
        provider: 'youtube',
        youtubeId: ytId || '',
        src: ytId && typeof window.youtubeWatchUrl === 'function' ? window.youtubeWatchUrl(ytId) : src,
        poster: poster || (ytId && typeof window.youtubePosterUrl === 'function' ? window.youtubePosterUrl(ytId) : '')
      };
    }
    if (isVideoTypeHint(explicitType) || isVideoUrl(src)) {
      return { type: 'video', src: src, poster: poster || '' };
    }
    if (isImageUrl(src)) return { type: 'image', src: src, thumb: thumb || '' };
    return null;
  }

  function normalizeMediaItemsFromArray(arr) {
    if (!Array.isArray(arr)) return [];
    var seen = Object.create(null);
    return arr
      .map(normalizeMediaEntry)
      .filter(function (item) {
        if (!item || !item.src) return false;
        var key = item.type + '::' + item.src;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
  }

  function collectMediaItems(source) {
    var found = [];
    if (!source || typeof source !== 'object') return found;

    // Preserva ordem explícita do Firestore quando existir.
    var fromCarouselItems = normalizeMediaItemsFromArray(source.carouselItems);
    if (fromCarouselItems.length) return fromCarouselItems;

    var fromMedia = normalizeMediaItemsFromArray(source.media);
    if (fromMedia.length) return fromMedia;

    var fromImages = normalizeMediaItemsFromArray(source.images);
    if (fromImages.length) return fromImages;

    function walk(value) {
      if (!value) return;
      if (typeof value === 'string') {
        var isImage = isImageUrl(value);
        var isVideo = isVideoUrl(value);
        if (isImage || isVideo) {
          found.push({ type: isVideo ? 'video' : 'image', src: value });
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (typeof value === 'object') {
        var explicitType = (value.type || value.kind || value.mediaType || value.mimeType || value.contentType || '').toString().toLowerCase();
        var direct = value.url || value.src || value.imageUrl || value.downloadURL || value.path || value.image || value.thumbnail || value.fileUrl;
        if (direct) {
          if (typeof direct === 'string' && (isVideoTypeHint(explicitType) || isVideoUrl(direct))) {
            found.push({ type: 'video', src: direct });
          } else {
            walk(direct);
          }
        }
        Object.keys(value).forEach(function (key) {
          walk(value[key]);
        });
      }
    }

    walk(source.images);
    walk(source.media);
    walk(source.gallery);
    walk(source.imagens);
    walk(source.files);
    walk(source.carousel);
    walk(source.carouselItems);
    walk(source.items);
    walk(source.coverImage);
    walk(source.image);
    walk(source.thumbnail);
    walk(source.thumb);
    walk(source.video);
    walk(source.videos);
    walk(source.videoUrl);
    walk(source.previewVideo);

    var seen = Object.create(null);
    return found.filter(function (item) {
      var key = item.type + '::' + item.src;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function applyFirestoreMediaToProject(project, data) {
    if (!project || !data) return;
    var mediaItems = collectMediaItems(data);
    var coverCandidate = mediaItems.length ? mediaItems[0].src : (data.coverImage || data.image || data.thumbnail || data.thumb || '');
    if (!mediaItems.length && coverCandidate) {
      mediaItems = [{ type: isVideoUrl(coverCandidate) ? 'video' : 'image', src: coverCandidate }];
    }
    project.mediaItems = mediaItems;
    project.preview = coverCandidate || project.preview || '';
  }

  function loadProjectsData() {
    var db = setupFirebase();

    function normalizeProject(item, idx) {
      var mediaItems = collectMediaItems(item);
      var coverCandidate = mediaItems.length ? mediaItems[0].src : (item.coverImage || item.image || item.thumbnail || item.thumb || '');
      if (!mediaItems.length && coverCandidate) {
        mediaItems = [{ type: isVideoUrl(coverCandidate) ? 'video' : 'image', src: coverCandidate }];
      }

      return {
        id: String(item.id || item.projectId || idx + 1),
        docId: item.__docId || null,
        key: 'p-' + idx,
        title: item.title || item.nome || t('projects.defaultTitle'),
        title_en: item.title_en || item.titleEn || '',
        subtitle: item.subtitle || item.subtitulo || item.meta || '',
        subtitle_en: item.subtitle_en || item.subtitleEn || '',
        description: item.description || item.descricao || '',
        description_en: item.description_en || item.descriptionEn || '',
        order: Number(item.order || item.ordem || item.position || item.posicao || idx),
        mediaItems: mediaItems,
        preview: coverCandidate || '',
        year: item.year || item.ano || ''
      };
    }

    function fromJsonFallback() {
      return fetch('projects.json')
        .then(function (response) { return response.json(); })
        .then(function (list) {
          return (Array.isArray(list) ? list : []).map(normalizeProject);
        })
        .catch(function () { return []; });
    }

    if (!db) {
      return fromJsonFallback();
    }

    return db.collection('projetos').get()
      .then(function (snapshot) {
        if (!snapshot || snapshot.empty) return fromJsonFallback();
        var rows = [];
        snapshot.forEach(function (doc) {
          var data = doc.data() || {};
          data.__docId = doc.id;
          data.id = data.id || doc.id;
          rows.push(data);
        });
        return rows
          .map(normalizeProject)
          .sort(function (a, b) {
            var ao = Number(a.order != null ? a.order : a.ordem != null ? a.ordem : a.position != null ? a.position : a.posicao != null ? a.posicao : 0);
            var bo = Number(b.order != null ? b.order : b.ordem != null ? b.ordem : b.position != null ? b.position : b.posicao != null ? b.posicao : 0);
            if (ao !== bo) return ao - bo;
            return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
          });
      })
      .catch(function () {
        return fromJsonFallback();
      });
  }

  function renderProjectsList(options) {
    var opts = options || {};
    var listEl = document.getElementById('projects-list');
    if (!listEl) return;

    if (!projectsData.length) {
      projectListOrderDirty = false;
      if (isLiteAdmin) {
        listEl.innerHTML = '<p class="projects-empty-note">' + escapeHtml(t('projects.noneYet')) + '</p><button type="button" class="project-add-button" id="project-add-new" aria-label="' + escapeHtml(t('projects.add')) + '">+</button>';
        bindProjectAddButton(listEl);
      } else {
        listEl.innerHTML = '<div class="project-item"><p class="project-item-title">' + escapeHtml(t('projects.noneAvailable')) + '</p></div>';
      }
      updateProjectPreviewAddButton();
      updateProjectListOrderBar();
      return;
    }

    // Indexacao por chave e prefetch só das capas (imagens/posters), em idle.
    projectsByKey = Object.create(null);
    projectsData.forEach(function (project) {
      projectsByKey[project.key] = project;
    });
    scheduleIdle(function () {
      if (!shouldAggressivelyPrefetch()) return;
      projectsData.slice(0, 8).forEach(function (project) {
        if (project.mediaItems && project.mediaItems.length) {
          preloadCoverOnly(project.mediaItems[0]);
        }
      });
    }, 800);

    listEl.innerHTML = projectsData.map(function (project) {
      var meta = loc(project, 'subtitle') || (project.year ? String(project.year) : t('projects.metaFallback'));
      var isActive = project.key === selectedProjectId;
      var isEditing = isLiteAdmin && isActive && editingProjectKey === project.key;
      var showEditButton = isLiteAdmin && isActive && !isEditing;
      var isEditable = isEditing;
      var draft = isEditable ? getProjectDraft(project.key) : null;
      var titleValue = isEditable ? '' : loc(project, 'title');
      var subtitleValue = isEditable ? '' : meta;
      var descValue = isEditable ? '' : formatProjectDescriptionHtml(loc(project, 'description'));
      var isSaving = !!adminSavingByKey[project.key];
      var saveNotice = adminSaveNoticeByKey[project.key];
      var saveNoticeHtml =
        saveNotice && saveNotice.text
          ? '<p class="project-save-notice' +
            (saveNotice.error ? ' is-error' : '') +
            '" role="status">' +
            escapeHtml(saveNotice.text) +
            '</p>'
          : '';
      return [
        '<article class="project-item' + (isActive ? ' is-active' : '') + (isLiteAdmin ? ' project-item--admin' : '') + '" data-project-key="' + project.key + '" data-doc-id="' + escapeHtml(String(project.docId || '')) + '" data-mid="' + escapeHtml(String(project.docId || project.id || project.key)) + '">',
        isLiteAdmin
          ? '<span class="project-drag-handle" draggable="true" data-drag-handle="true" title="' + escapeHtml(t('projects.dragReorder')) + '" aria-label="' + escapeHtml(t('projects.dragReorder')) + '">⋮⋮</span>'
          : '',
        '<div class="project-item-content">',
        showEditButton
          ? '<div class="project-item-actions">' +
              '<button class="project-edit-icon" data-project-action="delete" type="button" aria-label="' + escapeHtml(t('projects.delete')) + '">×</button>' +
              '<button class="project-edit-icon" data-project-action="start-edit" type="button" aria-label="' + escapeHtml(t('projects.edit')) + '">✎</button>' +
            '</div>'
          : '',
        isEditable
          ? '<div class="project-bilingual-fields">' +
              '<label class="project-bilingual-label">' + escapeHtml(t('projects.labelTitlePt')) + '</label>' +
              '<input class="project-item-title project-edit-input" data-project-field="title_pt" value="' + escapeHtml(draft.title_pt || '') + '" />' +
              '<label class="project-bilingual-label">' + escapeHtml(t('projects.labelTitleEn')) + '</label>' +
              '<input class="project-item-title project-edit-input" data-project-field="title_en" value="' + escapeHtml(draft.title_en || '') + '" />' +
              '<label class="project-bilingual-label">' + escapeHtml(t('projects.labelSubtitle')) + '</label>' +
              '<input class="project-item-meta project-edit-input" data-project-field="subtitle" value="' + escapeHtml(draft.subtitle || '') + '" placeholder="DEV / Digital Art / AR / VR" />' +
              '<label class="project-bilingual-label">' + escapeHtml(t('projects.labelDescPt')) + '</label>' +
              '<textarea class="project-item-description project-edit-textarea" data-project-field="description_pt">' + escapeHtml(draft.description_pt || '') + '</textarea>' +
              '<label class="project-bilingual-label">' + escapeHtml(t('projects.labelDescEn')) + '</label>' +
              '<textarea class="project-item-description project-edit-textarea" data-project-field="description_en">' + escapeHtml(draft.description_en || '') + '</textarea>' +
            '</div>'
          : '<h3 class="project-item-title">' + escapeHtml(titleValue) + '</h3>',
        !isEditable ? '<p class="project-item-meta">' + escapeHtml(subtitleValue) + '</p>' : '',
        !isEditable ? (descValue ? '<div class="project-item-description">' + descValue + '</div>' : '') : '',
        isEditable
          ? '<div class="project-edit-actions">' +
              '<button class="project-edit-button" data-project-action="save" type="button"' + (isSaving || adminOrderSaving ? ' disabled' : '') + '>' + escapeHtml(t('projects.save')) + '</button>' +
              '<button class="project-edit-button" data-project-action="cancel" type="button"' + (isSaving || adminOrderSaving ? ' disabled' : '') + '>' + escapeHtml(t('projects.cancel')) + '</button>' +
            '</div>' +
            '<div class="project-edit-status">' + (isSaving ? escapeHtml(t('projects.savingContent')) : (adminOrderSaving ? escapeHtml(t('projects.savingOrder')) : escapeHtml(t('projects.adminActive')))) + '</div>'
          : '',
        saveNoticeHtml,
        '</div>',
        '</article>'
      ].join('');
    }).join('');

    if (isLiteAdmin) {
      listEl.innerHTML = listEl.innerHTML + '<button type="button" class="project-add-button" id="project-add-new" aria-label="' + escapeHtml(t('projects.add')) + '">+</button>';
    }

    Array.prototype.slice.call(listEl.querySelectorAll('.project-item')).forEach(function (itemEl) {
      itemEl.addEventListener('pointerenter', function () {
        if (projectReorderActive) return;
        if (hoverPreviewTimer) clearTimeout(hoverPreviewTimer);
        var key = itemEl.getAttribute('data-project-key');
        hoverPreviewKey = key || '';
        hoverPreviewTimer = setTimeout(function () {
          if (!hoverPreviewKey || hoverPreviewKey !== key) return;
          previewProjectByKey(key, false);
        }, 50);
      });
      itemEl.addEventListener('click', function (event) {
        if (eventOnEditableTarget(event)) return;
        if (draggingProjectKey) return;
        if (hoverPreviewTimer) {
          clearTimeout(hoverPreviewTimer);
          hoverPreviewTimer = null;
        }
        var key = itemEl.getAttribute('data-project-key');
        if (selectedProjectId !== key) {
          editingProjectKey = null;
        }
        selectProject(key);
      });
      itemEl.addEventListener('pointerleave', function (event) {
        var toEl = event && event.relatedTarget && event.relatedTarget.closest
          ? event.relatedTarget.closest('.project-item')
          : null;
        // Ao mover entre cards, não deve cancelar o hover do próximo card.
        if (toEl && toEl !== itemEl) return;
        hoverPreviewKey = '';
        if (hoverPreviewTimer) {
          clearTimeout(hoverPreviewTimer);
          hoverPreviewTimer = null;
        }
        restoreSelectedProjectPreview();
      });

      if (isLiteAdmin) {
        if (!projectsListDnDBound) {
          projectsListDnDBound = true;
          listEl.addEventListener('dragover', function (e) {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          });
          listEl.addEventListener('drop', function (e) {
            e.preventDefault();
          });
        }
        var dragHandle = itemEl.querySelector('[data-drag-handle]');
        if (dragHandle) {
          dragHandle.addEventListener('dragstart', function (event) {
            event.stopPropagation();
            var listRoot = document.getElementById('projects-list');
            orderAtDragStart = listRoot ? readOrderSignatureFromListDom(listRoot) : '';
            liveDragRowEl = itemEl;
            liveDragLast = { id: null, after: null };
            var key = itemEl.getAttribute('data-project-key');
            projectReorderActive = true;
            draggingProjectKey = key;
            itemEl.classList.add('is-dragging');
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', key);
              try {
                var ghost = new Image();
                ghost.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAEAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                event.dataTransfer.setDragImage(ghost, 0, 0);
              } catch (e) {}
            }
          });
          dragHandle.addEventListener('dragend', function () {
            finalizeOrderAfterProjectDrag();
          });
        }
        itemEl.addEventListener('dragover', function (event) {
          if (!liveDragRowEl || !projectReorderActive) return;
          if (itemEl === liveDragRowEl) return;
          var rect = itemEl.getBoundingClientRect();
          var h = Math.max(1, rect.height);
          var after = (event.clientY - rect.top) > h * 0.5;
          var rowId = itemEl.getAttribute('data-mid') || itemEl.getAttribute('data-project-key');
          if (rowId === liveDragLast.id && after === liveDragLast.after) {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            return;
          }
          liveDragLast = { id: rowId, after: after };
          if (after) {
            if (itemEl.nextSibling === liveDragRowEl) {
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
              return;
            }
            listEl.insertBefore(liveDragRowEl, itemEl.nextSibling);
          } else {
            if (itemEl.previousSibling === liveDragRowEl) {
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
              return;
            }
            listEl.insertBefore(liveDragRowEl, itemEl);
          }
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });
        itemEl.addEventListener('drop', function (event) {
          if (projectReorderActive) {
            event.preventDefault();
            event.stopPropagation();
          }
        });
      }
    });

    if (!opts.preserveSelection) {
      selectedProjectId = null;
      updateProjectPreview([]);
    } else if (selectedProjectId && !opts.skipPreviewReset) {
      restoreSelectedProjectPreview();
    }

    if (isLiteAdmin) {
      bindProjectAddButton(listEl);
      bindAdminDeleteButtons(listEl);
      bindAdminEditorEvents(listEl);
    }
    updateProjectPreviewAddButton();
    updateProjectListOrderBar();
  }

  function bindProjectAddButton(listEl) {
    var btn = document.getElementById('project-add-new');
    if (!btn) return;
    btn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      createNewProject();
    });
  }

  function createNewProject() {
    if (!isLiteAdmin) return;
    if (!dbRef) {
      alert(t('js.dbUnavailableCreate'));
      return;
    }
    if (adminOrderSaving) return;

    var nextOrder = projectsData.length;
    var newTitle = t('projects.newProject');
    var payload = {
      title: newTitle,
      nome: newTitle,
      title_en: '',
      subtitle: '',
      subtitulo: '',
      description: '',
      descricao: '',
      description_en: '',
      order: nextOrder,
      ordem: nextOrder,
      images: []
    };

    dbRef.collection('projetos').add(payload)
      .then(function (docRef) {
        var newProject = {
          id: String(docRef.id),
          docId: docRef.id,
          key: 'p-' + nextOrder,
          title: newTitle,
          title_en: '',
          subtitle: '',
          description: '',
          description_en: '',
          mediaItems: [],
          preview: '',
          year: '',
          order: nextOrder
        };
        projectsData.push(newProject);
        projectsData.forEach(function (pr, i) {
          pr.key = 'p-' + i;
          pr.order = i;
        });
        projectsByKey = Object.create(null);
        projectsData.forEach(function (pr) {
          projectsByKey[pr.key] = pr;
        });
        adminDrafts = Object.create(null);
        var lastKey = 'p-' + (projectsData.length - 1);
        selectedProjectId = lastKey;
        editingProjectKey = lastKey;
        getProjectDraft(lastKey);
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
        selectProject(lastKey);
      })
      .catch(function (err) {
        console.warn('Erro ao criar projeto:', err);
        alert(t('js.createFailed'));
      });
  }

  function selectProject(projectKey) {
    selectedProjectId = String(projectKey);
    var selected = projectsByKey[selectedProjectId] || projectsData.find(function (p) { return p.key === selectedProjectId; });
    if (!selected) return;

    if (isLiteAdmin) {
      renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
    } else {
      Array.prototype.slice.call(document.querySelectorAll('.project-item')).forEach(function (el) {
        el.classList.toggle('is-active', el.getAttribute('data-project-key') === selectedProjectId);
      });
    }

    preloadProjectMedia(selected);
    updateProjectPreview(
      selected.mediaItems && selected.mediaItems.length ? selected.mediaItems : [{ type: 'image', src: selected.preview }],
      { showControls: true, autoplayVideo: false, previewOwnerKey: selectedProjectId }
    );
    if (isLiteAdmin) schedulePosterBackfillForCurrentProject();
  }

  function slugifyLiteProjectName(text) {
    var s = String(text || '');
    try {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {}
    s = s.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
    if (s.length > 64) s = s.slice(0, 64).replace(/-+$/g, '');
    return s || 'projeto';
  }

  function findLiteProjectByDeepLink() {
    var token = '';
    try {
      token = String(new URLSearchParams(window.location.search || '').get('project') || '').trim();
    } catch (e) {
      token = '';
    }
    if (!token) return null;
    var lower = token.toLowerCase();
    var byId = projectsData.find(function (p) {
      return String(p.docId || '') === token || String(p.id || '') === token;
    });
    if (byId) return byId;
    return projectsData.find(function (p) {
      var title = loc(p, 'title');
      var slug = p.slug ? slugifyLiteProjectName(p.slug) : slugifyLiteProjectName(title);
      return slug === lower || slug === token;
    }) || null;
  }

  function applyLiteDeepLink() {
    var project = findLiteProjectByDeepLink();
    if (!project) return false;
    setContentMode('projects');
    selectProject(project.key);
    try {
      var title = loc(project, 'title');
      var slug = project.slug ? slugifyLiteProjectName(project.slug) : slugifyLiteProjectName(title);
      var params = new URLSearchParams(window.location.search || '');
      params.set('project', slug);
      history.replaceState({}, '', 'lite.html?' + params.toString() + (window.location.hash || ''));
    } catch (e) {}
    return true;
  }

  function previewProjectByKey(projectKey, showControls) {
    var key = String(projectKey || '');
    if (!key) return;
    var project = projectsByKey[key];
    if (!project) return;

    preloadProjectMedia(project, 2);
    var mediaItems = project.mediaItems && project.mediaItems.length ? project.mediaItems : [{ type: 'image', src: project.preview }];
    // Se estiver pairando o item já selecionado, mantém controles.
    var keepControls = !!showControls || key === selectedProjectId;
    updateProjectPreview(mediaItems, {
      showControls: keepControls,
      autoplayVideo: false,
      previewOwnerKey: key
    });
  }

  function updateProjectPreview(mediaItems, options) {
    var opts = options || {};
    previewDisplayedProjectKey = String(
      opts.previewOwnerKey != null && opts.previewOwnerKey !== ''
        ? opts.previewOwnerKey
        : selectedProjectId || ''
    );
    var imageEl = document.getElementById('project-preview-image');
    var videoEl = document.getElementById('project-preview-video');
    var playButton = document.getElementById('project-video-play');
    var emptyEl = document.getElementById('project-preview-empty');
    var controlsEl = document.getElementById('project-preview-controls');
    if (!imageEl || !videoEl || !emptyEl) {
      updateProjectPreviewAddButton();
      return;
    }

    activeProjectMedia = Array.isArray(mediaItems) ? mediaItems.filter(function (item) {
      return item && item.src;
    }) : [];
    activeMediaIndex = 0;
    // Abre pela primeira imagem quando existe; mantém a ordem real para a navegação.
    for (var firstImageIndex = 0; firstImageIndex < activeProjectMedia.length; firstImageIndex += 1) {
      if (activeProjectMedia[firstImageIndex].type !== 'video') {
        activeMediaIndex = firstImageIndex;
        break;
      }
    }

    if (!activeProjectMedia.length) {
      setProjectPreviewLoading(false);
      imageEl.classList.remove('is-visible');
      videoEl.classList.remove('is-visible');
      clearPreviewYouTube();
      imageEl.removeAttribute('src');
      videoEl.pause();
      videoEl.removeAttribute('src');
      emptyEl.style.display = 'block';
      if (controlsEl) controlsEl.classList.add('is-hidden');
      if (playButton) playButton.classList.add('is-hidden');
      updateProjectPreviewAddButton();
      return;
    }

    renderProjectMedia(opts);
    emptyEl.style.display = 'none';
    if (controlsEl) {
      var shouldShowControls = !!opts.showControls && activeProjectMedia.length >= 2;
      controlsEl.classList.toggle('is-hidden', !shouldShowControls);
    }
    updateProjectMediaOrderTools();
    updateProjectPreviewAddButton();
  }

  function renderProjectMedia(options) {
    var opts = options || {};
    var imageEl = document.getElementById('project-preview-image');
    var videoEl = document.getElementById('project-preview-video');
    var youtubeEl = document.getElementById('project-preview-youtube');
    var indexEl = document.getElementById('project-preview-index');
    var playButton = document.getElementById('project-video-play');
    if (!imageEl || !videoEl || !activeProjectMedia.length) {
      setProjectPreviewLoading(false);
      updateProjectMediaOrderTools();
      return;
    }

    var targetItem = activeProjectMedia[activeMediaIndex];
    if (!targetItem || !targetItem.src) {
      setProjectPreviewLoading(false);
      updateProjectMediaOrderTools();
      return;
    }

    setProjectPreviewLoading(true);
    imageEl.classList.remove('is-visible');
    videoEl.classList.remove('is-visible');
    clearPreviewYouTube();
    if (playButton) playButton.classList.add('is-hidden');

    var targetSrc = targetItem.src;
    var token = ++previewRenderToken;
    var isYt =
      targetItem.provider === 'youtube' ||
      !!targetItem.youtubeId ||
      (typeof window.isYouTubeUrl === 'function' && window.isYouTubeUrl(targetSrc));

    if (isYt) {
      currentPreviewIsVideo = true;
      clearPreviewVideoSource();
      var ytId =
        targetItem.youtubeId ||
        (typeof window.parseYouTubeId === 'function' ? window.parseYouTubeId(targetSrc) : '');
      var poster =
        targetItem.poster ||
        (ytId && typeof window.youtubePosterUrl === 'function' ? window.youtubePosterUrl(ytId) : '');
      if (poster) {
        imageEl.src = poster;
        imageEl.classList.add('is-visible');
      }
      if (youtubeEl && ytId && typeof window.youtubeEmbedUrl === 'function') {
        youtubeEl.dataset.embedSrc = window.youtubeEmbedUrl(ytId, { autoplay: true });
      }
      if (playButton) playButton.classList.toggle('is-hidden', !opts.showControls);
      setProjectPreviewLoading(false);
    } else if (targetItem.type === 'video') {
      currentPreviewIsVideo = true;
      videoEl.pause();
      videoEl.loop = true;
      videoEl.autoplay = false;
      videoEl.controls = false;
      videoEl.muted = true;
      videoEl.playsInline = true;
      showVideoPosterPreview(targetItem, token, opts);
    } else {
      currentPreviewIsVideo = false;
      clearPreviewVideoSource();
      var probe = new Image();
      probe.decoding = 'async';
      probe.onload = function () {
        if (token !== previewRenderToken) return;
        setProjectPreviewLoading(false);
        imageEl.src = targetSrc;
        imageEl.classList.add('is-visible');
      };
      probe.onerror = function () {
        if (token !== previewRenderToken) return;
        setProjectPreviewLoading(false);
        imageEl.src = targetSrc;
        imageEl.classList.add('is-visible');
      };
      probe.src = targetSrc;
    }

    if (indexEl) {
      indexEl.textContent = (activeMediaIndex + 1) + ' / ' + activeProjectMedia.length;
    }
    updateProjectMediaOrderTools();
    prefetchAdjacentMediaCovers();
  }

  function clearPreviewYouTube() {
    var yt = document.getElementById('project-preview-youtube');
    if (!yt) return;
    yt.classList.remove('is-visible');
    if (yt.getAttribute('src')) yt.removeAttribute('src');
    delete yt.dataset.embedSrc;
  }

  function clearPreviewVideoSource() {
    var videoEl = document.getElementById('project-preview-video');
    if (!videoEl) return;
    videoEl.pause();
    videoEl.removeAttribute('poster');
    if (videoEl.getAttribute('src') || videoEl.dataset.boundSrc) {
      videoEl.removeAttribute('src');
      delete videoEl.dataset.boundSrc;
      try { videoEl.load(); } catch (e) {}
    }
  }

  function showVideoPosterPreview(targetItem, token, opts) {
    var imageEl = document.getElementById('project-preview-image');
    var videoEl = document.getElementById('project-preview-video');
    var playButton = document.getElementById('project-video-play');
    if (!imageEl || !videoEl || !targetItem || !targetItem.src) {
      setProjectPreviewLoading(false);
      return;
    }

    // Poster/frame primeiro; o MP4 só entra no clique de play.
    clearPreviewVideoSource();
    videoEl.classList.remove('is-visible');
    if (playButton) {
      playButton.classList.toggle('is-hidden', !opts.showControls);
    }

    var poster = targetItem.poster || videoFrameCache[targetItem.src] || '';
    if (poster) {
      imageEl.src = poster;
      imageEl.classList.add('is-visible');
      setProjectPreviewLoading(false);
      if (opts.showControls && isLiteAdmin && !targetItem.poster) {
        schedulePosterBackfillForCurrentProject();
      }
      return;
    }

    imageEl.classList.remove('is-visible');
    renderVideoFramePreview(targetItem.src, token, function () {
      if (!opts.showControls || !isLiteAdmin) return;
      schedulePosterBackfillForCurrentProject();
    });
  }

  function prefetchAdjacentMediaCovers() {
    if (!activeProjectMedia.length || !shouldAggressivelyPrefetch()) return;
    var idxs = [
      activeMediaIndex - 1,
      activeMediaIndex + 1
    ];
    idxs.forEach(function (i) {
      if (i < 0 || i >= activeProjectMedia.length) return;
      preloadCoverOnly(activeProjectMedia[i]);
    });
  }

  function shouldAggressivelyPrefetch() {
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!c) return true;
      if (c.saveData) return false;
      if (c.effectiveType === 'slow-2g' || c.effectiveType === '2g') return false;
    } catch (e) {}
    return true;
  }

  function scheduleIdle(fn, timeoutMs) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: timeoutMs || 1200 });
      return;
    }
    setTimeout(fn, 180);
  }

  function preloadImage(url) {
    if (!url || imagePreloadCache['image::' + url]) return;
    var img = new Image();
    img.decoding = 'async';
    imagePreloadCache['image::' + url] = true;
    img.src = url;
  }

  function preloadCoverOnly(item) {
    if (!item || !item.src) return;
    if (item.type === 'video') {
      if (item.poster) preloadImage(item.poster);
      return;
    }
    preloadImage(item.src);
  }

  function preloadMedia(item) {
    preloadCoverOnly(item);
  }

  function preloadProjectMedia(project, limit) {
    if (!project || !Array.isArray(project.mediaItems)) return;
    var max = typeof limit === 'number' ? Math.min(limit, project.mediaItems.length) : Math.min(2, project.mediaItems.length);
    for (var i = 0; i < max; i += 1) {
      preloadCoverOnly(project.mediaItems[i]);
    }
  }

  var posterBackfillBusy = false;
  var posterBackfillQueuedKey = '';

  function schedulePosterBackfillForCurrentProject() {
    if (!isLiteAdmin || !selectedProjectId || !dbRef || !storageRef) return;
    var key = selectedProjectId;
    posterBackfillQueuedKey = key;
    scheduleIdle(function () {
      if (posterBackfillQueuedKey !== key) return;
      backfillMissingPostersForProject(key);
    }, 2500);
  }

  function dataUrlToBlob(dataUrl) {
    try {
      var parts = String(dataUrl || '').split(',');
      if (parts.length < 2) return null;
      var mimeMatch = parts[0].match(/:(.*?);/);
      var mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      var binary = atob(parts[1]);
      var len = binary.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    } catch (e) {
      return null;
    }
  }

  function backfillMissingPostersForProject(projectKey) {
    if (posterBackfillBusy) return Promise.resolve();
    var project = getProjectByKey(projectKey);
    if (!project || !project.docId || !Array.isArray(project.mediaItems)) return Promise.resolve();

    var missing = project.mediaItems.filter(function (item) {
      if (!item || item.type !== 'video' || !item.src || item.poster) return false;
      if (item.provider === 'youtube' || item.youtubeId) return false;
      if (typeof window.isYouTubeUrl === 'function' && window.isYouTubeUrl(item.src)) return false;
      return true;
    });
    if (!missing.length) return Promise.resolve();

    posterBackfillBusy = true;
    var chain = Promise.resolve();
    var changed = false;

    missing.forEach(function (item) {
      chain = chain.then(function () {
        if (selectedProjectId !== projectKey) return;
        return new Promise(function (resolve) {
          var cached = videoFrameCache[item.src];
          if (cached && cached.indexOf('data:') === 0) {
            resolve(cached);
            return;
          }
          createVideoFrameProbe(item.src, function (dataUrl) {
            if (dataUrl) videoFrameCache[item.src] = dataUrl;
            resolve(dataUrl || '');
          });
        }).then(function (dataUrl) {
          if (!dataUrl || selectedProjectId !== projectKey) return;
          var blob = dataUrlToBlob(dataUrl);
          if (!blob) return;
          var posterFile = new File([blob], Date.now() + '_poster.jpg', { type: 'image/jpeg' });
          return liteUploadProjectMediaFile(project.docId, posterFile).then(function (posterUrl) {
            if (!posterUrl) return;
            item.poster = posterUrl;
            changed = true;
            if (project.preview === item.src || !project.preview) {
              project.preview = posterUrl;
            }
          }).catch(function () {});
        });
      });
    });

    return chain
      .then(function () {
        if (!changed || selectedProjectId !== projectKey) return;
        return saveProjectMediaOrder(project);
      })
      .catch(function (err) {
        console.warn('Backfill de posters:', err);
      })
      .finally(function () {
        posterBackfillBusy = false;
      });
  }

  function createVideoFrameProbe(videoUrl, onFinish) {
    var done = false;
    var probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;
    probe.playsInline = true;
    probe.crossOrigin = 'anonymous';

    function finish(dataUrl) {
      if (done) return;
      done = true;
      probe.removeAttribute('src');
      try { probe.load(); } catch (e) {}
      onFinish(dataUrl || '');
    }

    function captureFrame() {
      try {
        var size = fitMediaSize(probe.videoWidth, probe.videoHeight, 640);
        var canvas = document.createElement('canvas');
        canvas.width = size.w;
        canvas.height = size.h;
        var ctx = canvas.getContext('2d');
        if (!ctx) {
          finish('');
          return;
        }
        ctx.drawImage(probe, 0, 0, size.w, size.h);
        finish(canvas.toDataURL('image/jpeg', 0.82));
      } catch (e) {
        finish('');
      }
    }

    probe.onloadedmetadata = function () {
      try {
        var d = Number(probe.duration || 0);
        var targetTime = 0.12;
        if (isFinite(d) && d > 0) {
          targetTime = Math.min(Math.max(d * 0.1, 0.12), Math.max(0.12, d - 0.05, 1.1));
        }
        probe.currentTime = targetTime;
      } catch (e) {
        captureFrame();
      }
    };
    probe.onseeked = captureFrame;
    probe.onerror = function () {
      finish('');
    };
    probe.src = videoUrl;
    probe.load();
  }

  function drainVideoProbeQueue() {
    if (videoProbeActive) return;
    var videoUrl = videoProbeQueue.shift();
    if (!videoUrl) return;
    videoProbeActive = true;
    createVideoFrameProbe(videoUrl, function (dataUrl) {
      videoFrameCache[videoUrl] = dataUrl || '';
      var waiters = videoFramePending[videoUrl] || [];
      delete videoFramePending[videoUrl];
      waiters.forEach(function (fn) {
        fn(dataUrl || '');
      });
      videoProbeActive = false;
      drainVideoProbeQueue();
    });
  }

  function warmVideoFrameCache(videoUrl) {
    if (!videoUrl || videoFrameCache[videoUrl]) return;
    if (videoFramePending[videoUrl]) return;
    videoFramePending[videoUrl] = [];
    videoProbeQueue.push(videoUrl);
    drainVideoProbeQueue();
  }

  function renderVideoFramePreview(videoUrl, token, onReady) {
    var imageEl = document.getElementById('project-preview-image');
    if (!imageEl) return;

    function applyPoster(dataUrl) {
      if (token !== previewRenderToken) {
        if (typeof onReady === 'function') onReady('');
        return;
      }
      if (!dataUrl) {
        setProjectPreviewLoading(false);
        if (typeof onReady === 'function') onReady('');
        return;
      }
      setProjectPreviewLoading(false);
      imageEl.src = dataUrl;
      imageEl.classList.add('is-visible');
      if (typeof onReady === 'function') onReady(dataUrl);
    }

    if (videoFrameCache[videoUrl]) {
      applyPoster(videoFrameCache[videoUrl]);
      return;
    }

    if (videoFramePending[videoUrl]) {
      videoFramePending[videoUrl].push(applyPoster);
      return;
    }

    videoFramePending[videoUrl] = [applyPoster];
    videoProbeQueue.push(videoUrl);
    drainVideoProbeQueue();
  }

  function updateProjectMediaOrderTools() {
    var wrap = document.getElementById('project-media-order-wrap');
    var leftBtn = document.getElementById('project-media-move-left');
    var rightBtn = document.getElementById('project-media-move-right');
    var deleteBtn = document.getElementById('project-media-delete');
    if (!wrap || !leftBtn || !rightBtn || !deleteBtn) return;
    var canShow =
      contentMode === 'projects' &&
      isLiteAdmin &&
      !!selectedProjectId &&
      !!activeProjectMedia.length &&
      !!dbRef;
    wrap.classList.toggle('is-visible', canShow);
    wrap.setAttribute('aria-hidden', canShow ? 'false' : 'true');
    if (!canShow) {
      leftBtn.disabled = true;
      rightBtn.disabled = true;
      deleteBtn.disabled = true;
      return;
    }
    leftBtn.disabled = activeMediaIndex <= 0;
    rightBtn.disabled = activeMediaIndex >= activeProjectMedia.length - 1;
    deleteBtn.disabled = !activeProjectMedia.length;
  }

  function setupProjectMediaOrderTools() {
    var leftBtn = document.getElementById('project-media-move-left');
    var rightBtn = document.getElementById('project-media-move-right');
    var deleteBtn = document.getElementById('project-media-delete');
    if (!leftBtn || !rightBtn || !deleteBtn) return;
    leftBtn.addEventListener('click', function () {
      moveCurrentProjectMediaBy(-1);
    });
    rightBtn.addEventListener('click', function () {
      moveCurrentProjectMediaBy(1);
    });
    deleteBtn.addEventListener('click', function () {
      deleteCurrentProjectMedia();
    });
  }

  function saveProjectMediaOrder(project) {
    if (!dbRef || !project || !project.docId) return Promise.resolve();
    var mediaItems = Array.isArray(project.mediaItems) ? project.mediaItems : [];
    var payload = {
      carouselItems: mediaItems.map(function (item) {
        var isYt =
          item.provider === 'youtube' ||
          item.youtubeId ||
          (typeof window.isYouTubeUrl === 'function' && window.isYouTubeUrl(item.src));
        if (isYt) {
          var ytId =
            item.youtubeId ||
            (typeof window.parseYouTubeId === 'function' ? window.parseYouTubeId(item.src) : '');
          var rowYt = {
            type: 'video',
            provider: 'youtube',
            youtubeId: ytId || '',
            url:
              ytId && typeof window.youtubeWatchUrl === 'function'
                ? window.youtubeWatchUrl(ytId)
                : item.src
          };
          if (item.poster) rowYt.poster = item.poster;
          else if (ytId && typeof window.youtubePosterUrl === 'function') {
            rowYt.poster = window.youtubePosterUrl(ytId);
          }
          return rowYt;
        }
        var row = { type: item.type === 'video' ? 'video' : 'image', url: item.src };
        if (item.type === 'video' && item.poster) row.poster = item.poster;
        if (item.type !== 'video' && item.thumb) row.thumb = item.thumb;
        return row;
      }),
      images: mediaItems
        .filter(function (item) {
          return item.type !== 'video';
        })
        .map(function (item) {
          return item.thumb || item.src;
        })
    };
    return dbRef.collection('projetos').doc(project.docId).set(payload, { merge: true });
  }

  function moveCurrentProjectMediaBy(delta) {
    if (!isLiteAdmin || !selectedProjectId || !delta) return;
    var project = getProjectByKey(selectedProjectId);
    if (!project || !Array.isArray(project.mediaItems) || project.mediaItems.length < 2) return;
    var from = activeMediaIndex;
    var to = from + Number(delta);
    if (to < 0 || to >= project.mediaItems.length) return;
    if (!project.docId || !dbRef) return;

    var reordered = project.mediaItems.slice();
    var moved = reordered.splice(from, 1)[0];
    reordered.splice(to, 0, moved);
    project.mediaItems = reordered;
    activeProjectMedia = reordered.slice();
    activeMediaIndex = to;
    renderProjectMedia({ showControls: true });
    setProjectPreviewLoading(true);
    saveProjectMediaOrder(project)
      .catch(function (error) {
        console.warn('Erro ao salvar ordem das mídias do projeto:', error);
        alert(t('js.mediaOrderFailed'));
      })
      .finally(function () {
        setProjectPreviewLoading(false);
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
      });
  }

  function deleteCurrentProjectMedia() {
    if (!isLiteAdmin || !selectedProjectId) return;
    var project = getProjectByKey(selectedProjectId);
    if (!project || !project.docId || !dbRef) return;
    if (!Array.isArray(project.mediaItems) || !project.mediaItems.length) return;
    var index = activeMediaIndex;
    if (index < 0 || index >= project.mediaItems.length) return;
    var item = project.mediaItems[index];
    var label = item && item.type === 'video' ? 'este vídeo' : 'esta imagem';
    var ok = window.confirm(t('immersive.deleteMediaConfirm', { label: label }));
    if (!ok) return;

    var previousItems = project.mediaItems.slice();
    var previousPreview = project.preview;
    var previousIndex = activeMediaIndex;
    var urlToDelete = item && item.src ? item.src : null;
    var thumbToDelete = item && item.thumb ? item.thumb : null;
    var posterToDelete = item && item.poster ? item.poster : null;

    var reordered = project.mediaItems.slice();
    reordered.splice(index, 1);
    project.mediaItems = reordered;
    project.preview = reordered.length ? reordered[0].src : '';
    activeProjectMedia = reordered.slice();
    if (activeMediaIndex >= activeProjectMedia.length) {
      activeMediaIndex = Math.max(0, activeProjectMedia.length - 1);
    }

    if (!activeProjectMedia.length) {
      updateProjectPreview([], { showControls: true, previewOwnerKey: selectedProjectId });
    } else {
      renderProjectMedia({ showControls: true });
    }

    setProjectPreviewLoading(true);
    saveProjectMediaOrder(project)
      .then(function () {
        return liteDeleteStorageUrls([urlToDelete, thumbToDelete, posterToDelete]);
      })
      .catch(function (error) {
        console.warn('Erro ao excluir mídia do projeto:', error);
        project.mediaItems = previousItems;
        project.preview = previousPreview;
        activeProjectMedia = previousItems.slice();
        activeMediaIndex = previousIndex;
        if (activeProjectMedia.length) {
          renderProjectMedia({ showControls: true });
        } else {
          updateProjectPreview([], { showControls: true, previewOwnerKey: selectedProjectId });
        }
        alert(t('js.mediaDeleteFailed'));
      })
      .finally(function () {
        setProjectPreviewLoading(false);
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
        updateProjectMediaOrderTools();
      });
  }

  function liteStoragePathFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (typeof window.isYouTubeUrl === 'function' && window.isYouTubeUrl(url)) return null;
    if (url.indexOf('i.ytimg.com') !== -1) return null;
    if (url.indexOf('/fb-storage') === 0 || url.indexOf('/fb-storage-app') === 0 || url.indexOf('/gcs-storage') === 0) {
      return null;
    }
    try {
      var parts = url.split('/o/');
      if (parts.length >= 2) {
        return decodeURIComponent(parts[1].split('?')[0]);
      }
      var parsed = new URL(url, window.location.href);
      if (parsed.hostname.indexOf('firebasestorage.app') !== -1) {
        var path = decodeURIComponent(parsed.pathname || '').replace(/^\/+/, '');
        return path || null;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function liteDeleteStorageUrls(urls) {
    if (!storageRef || !urls || !urls.length) return Promise.resolve();
    return Promise.all(
      urls.filter(Boolean).map(function (url) {
        var path = liteStoragePathFromUrl(url);
        if (!path) return Promise.resolve();
        return storageRef
          .ref(path)
          .delete()
          .catch(function (err) {
            console.warn('Falha ao deletar do Storage:', path, err);
          });
      })
    );
  }

  function togglePreviewVideoPlayback() {
    var videoEl = document.getElementById('project-preview-video');
    var imageEl = document.getElementById('project-preview-image');
    var playButton = document.getElementById('project-video-play');
    if (!videoEl || !currentPreviewIsVideo) return;
    var item = activeProjectMedia[activeMediaIndex];
    if (
      item &&
      (item.provider === 'youtube' ||
        item.youtubeId ||
        (typeof window.isYouTubeUrl === 'function' && window.isYouTubeUrl(item.src)))
    ) {
      var youtubeEl = document.getElementById('project-preview-youtube');
      var ytId =
        item.youtubeId ||
        (typeof window.parseYouTubeId === 'function' ? window.parseYouTubeId(item.src) : '');
      if (!youtubeEl || !ytId || typeof window.youtubeEmbedUrl !== 'function') return;
      setProjectPreviewLoading(false);
      youtubeEl.src = youtubeEl.dataset.embedSrc || window.youtubeEmbedUrl(ytId, { autoplay: true });
      youtubeEl.classList.add('is-visible');
      if (imageEl) imageEl.classList.remove('is-visible');
      if (playButton) playButton.classList.add('is-hidden');
      return;
    }
    var src = item && item.src;
    var poster = (item && item.poster) || videoFrameCache[src] || '';

    if (videoEl.paused) {
      setProjectPreviewLoading(true);
      if (src && videoEl.dataset.boundSrc !== src) {
        videoEl.preload = 'auto';
        if (poster && poster.indexOf('data:') !== 0) videoEl.poster = poster;
        videoEl.dataset.boundSrc = src;
        videoEl.src = src;
        videoEl.load();
      }
      var startPlay = function () {
        setProjectPreviewLoading(false);
        var playPromise = videoEl.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(function () {
            setProjectPreviewLoading(false);
            if (playButton) playButton.classList.remove('is-hidden');
          });
        }
        videoEl.classList.add('is-visible');
        if (imageEl) imageEl.classList.remove('is-visible');
        if (playButton) playButton.classList.add('is-hidden');
      };
      if (videoEl.readyState >= 2) {
        startPlay();
      } else {
        videoEl.oncanplay = function () {
          videoEl.oncanplay = null;
          if (!currentPreviewIsVideo) return;
          startPlay();
        };
        videoEl.onerror = function () {
          setProjectPreviewLoading(false);
          if (playButton) playButton.classList.remove('is-hidden');
        };
      }
    } else {
      videoEl.pause();
      if (playButton) playButton.classList.remove('is-hidden');
    }
  }

  function restoreSelectedProjectPreview() {
    if (!selectedProjectId) return;
    var selected = projectsByKey[selectedProjectId];
    if (!selected) return;

    updateProjectPreview(
      selected.mediaItems && selected.mediaItems.length ? selected.mediaItems : [{ type: 'image', src: selected.preview }],
      { showControls: true, autoplayVideo: false, previewOwnerKey: selectedProjectId }
    );
  }

  function eventOnEditableTarget(event) {
    if (!event || !event.target || !event.target.closest) return false;
    return !!event.target.closest('.project-edit-input, .project-edit-textarea, .project-edit-button, .project-item-actions, .project-drag-handle');
  }

  function getProjectByKey(key) {
    return projectsByKey[String(key || '')] || null;
  }

  function bindAdminDeleteButtons(listEl) {
    Array.prototype.slice.call(listEl.querySelectorAll('[data-project-action="delete"]')).forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        event.preventDefault();
        var item = event.target && event.target.closest ? event.target.closest('.project-item') : null;
        var key = item && item.getAttribute('data-project-key');
        if (key) deleteProjectByKey(key);
      });
    });
  }

  function deleteProjectByKey(projectKey) {
    var key = String(projectKey || '');
    var project = getProjectByKey(key);
    if (!project) return;
    if (!project.docId) {
      alert(t('js.docUnknown'));
      return;
    }
    if (!dbRef) {
      alert(t('js.dbUnavailableDelete'));
      return;
    }
    openProjectDeleteModal(key);
  }

  function performDeleteProjectByKey(projectKey) {
    var key = String(projectKey || '');
    var project = getProjectByKey(key);
    if (!project || !project.docId || !dbRef) {
      closeProjectDeleteModal();
      return;
    }

    var prevSelected = selectedProjectId ? getProjectByKey(selectedProjectId) : null;
    var prevSelectedDocId = prevSelected && prevSelected.docId ? prevSelected.docId : null;
    var targetDocId = project.docId;

    setProjectDeleteModalLoading(true);
    if (projectDeleteModalElements) projectDeleteModalElements.errorEl.textContent = '';

    dbRef.collection('projetos').doc(project.docId).delete()
      .then(function () {
        closeProjectDeleteModal();
        projectsData = projectsData.filter(function (p) { return p.key !== key; });
        projectsData.forEach(function (p, i) {
          p.key = 'p-' + i;
          p.order = i;
        });
        projectsByKey = Object.create(null);
        projectsData.forEach(function (p) {
          projectsByKey[p.key] = p;
        });
        adminDrafts = Object.create(null);
        editingProjectKey = null;
        if (prevSelectedDocId && prevSelectedDocId === targetDocId) {
          selectedProjectId = projectsData[0] ? projectsData[0].key : null;
        } else if (prevSelectedDocId) {
          var found = projectsData.find(function (p) { return p.docId === prevSelectedDocId; });
          selectedProjectId = found ? found.key : null;
        } else {
          selectedProjectId = null;
        }
        renderProjectsList({ preserveSelection: true, skipPreviewReset: !selectedProjectId });
        if (selectedProjectId) {
          var reselected = getProjectByKey(selectedProjectId);
          if (reselected) preloadProjectMedia(reselected);
          restoreSelectedProjectPreview();
        } else {
          updateProjectPreview([]);
        }
        persistProjectOrder();
      })
      .catch(function (err) {
        console.warn('Erro ao excluir projeto:', err);
        setProjectDeleteModalLoading(false);
        if (projectDeleteModalElements) {
          projectDeleteModalElements.errorEl.textContent = t('deleteProject.errorRetry');
        }
      });
  }

  function getProjectDraft(projectKey) {
    var key = String(projectKey || '');
    var existing = adminDrafts[key];
    if (existing) return existing;
    var project = getProjectByKey(key);
    if (!project) return null;
    var draft = {
      title_pt: String(project.title || project.nome || '').trim(),
      title_en: String(project.title_en || '').trim(),
      subtitle: String(project.subtitle || project.subtitulo || project.subtitle_en || project.meta || '').trim(),
      description_pt: toPlainText(project.description || project.descricao || ''),
      description_en: toPlainText(project.description_en || '')
    };
    adminDrafts[key] = draft;
    return draft;
  }

  function bindAdminEditorEvents(listEl) {
    Array.prototype.slice.call(listEl.querySelectorAll('.project-item.is-active')).forEach(function (itemEl) {
      var projectKey = itemEl.getAttribute('data-project-key');
      var draft = getProjectDraft(projectKey);
      if (!draft) return;

      Array.prototype.slice.call(itemEl.querySelectorAll('[data-project-field]')).forEach(function (fieldEl) {
        fieldEl.addEventListener('input', function () {
          var field = fieldEl.getAttribute('data-project-field');
          if (!field) return;
          draft[field] = fieldEl.value;
        });
      });

      var saveButton = itemEl.querySelector('[data-project-action="save"]');
      if (saveButton) {
        saveButton.addEventListener('click', function () {
          saveProjectDraft(projectKey);
        });
      }

      var cancelButton = itemEl.querySelector('[data-project-action="cancel"]');
      if (cancelButton) {
        cancelButton.addEventListener('click', function () {
          var k = String(projectKey || '');
          delete adminDrafts[k];
          delete adminSaveNoticeByKey[k];
          if (adminSaveNoticeClearTimer) {
            clearTimeout(adminSaveNoticeClearTimer);
            adminSaveNoticeClearTimer = null;
          }
          editingProjectKey = null;
          renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
        });
      }

      var startEditButton = itemEl.querySelector('[data-project-action="start-edit"]');
      if (startEditButton) {
        startEditButton.addEventListener('click', function (event) {
          event.stopPropagation();
          editingProjectKey = String(projectKey || '');
          getProjectDraft(projectKey);
          renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
        });
      }
    });
  }

  function endProjectListDrag(listEl) {
    projectReorderActive = false;
    if (listEl) {
      Array.prototype.slice.call(listEl.querySelectorAll('.project-item')).forEach(function (el) {
        el.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
      });
    }
  }

  function projectRowDomId(el) {
    if (!el || !el.getAttribute) return '';
    var docAttr = (el.getAttribute('data-doc-id') || '').trim();
    if (docAttr) return docAttr;
    var midAttr = (el.getAttribute('data-mid') || '').trim();
    if (midAttr) return midAttr;
    return String(el.getAttribute('data-project-key') || '');
  }

  function readOrderSignatureFromListDom(listEl) {
    if (!listEl) return '';
    return Array.from(listEl.querySelectorAll('.project-item'))
      .map(projectRowDomId)
      .join('\t');
  }

  function syncProjectsOrderFromListDom(listEl) {
    if (!listEl) return false;
    var byKey = Object.create(null);
    var byMid = Object.create(null);
    projectsData.forEach(function (p) {
      byKey[p.key] = p;
      if (p.docId) {
        byMid[String(p.docId).trim()] = p;
      }
      var fallback = String(p.id != null && p.id !== '' ? p.id : p.key || '').trim();
      if (fallback && !p.docId) {
        byMid[fallback] = p;
      }
    });
    var newData = Array.from(listEl.querySelectorAll('.project-item'))
      .map(function (el) {
        var rid = projectRowDomId(el);
        if (rid && byMid[rid]) return byMid[rid];
        var pk = el.getAttribute('data-project-key');
        return pk ? byKey[pk] : null;
      })
      .filter(Boolean);
    if (newData.length !== projectsData.length) {
      console.warn(
        'Lite: ordem da lista não sincronizada (esperado ' +
          projectsData.length +
          ' itens, DOM resolveu ' +
          newData.length +
          ').'
      );
      return false;
    }
    var selectedRef = selectedProjectId ? byKey[selectedProjectId] : null;
    newData.forEach(function (p, i) {
      p.key = 'p-' + i;
      p.order = i;
    });
    projectsData = newData;
    projectsByKey = Object.create(null);
    newData.forEach(function (p) {
      projectsByKey[p.key] = p;
    });
    if (selectedRef) {
      var match = newData.find(function (p) {
        return p === selectedRef;
      });
      selectedProjectId = match ? match.key : null;
    } else {
      selectedProjectId = null;
    }
    return true;
  }

  function finalizeOrderAfterProjectDrag() {
    var listEl = document.getElementById('projects-list');
    var newSig = listEl ? readOrderSignatureFromListDom(listEl) : '';
    var orderChanged = !!(orderAtDragStart && newSig && newSig !== orderAtDragStart);
    var synced = listEl ? syncProjectsOrderFromListDom(listEl) : false;
    liveDragRowEl = null;
    orderAtDragStart = '';
    liveDragLast = { id: null, after: null };
    draggingProjectKey = null;
    var targetList = listEl || document.getElementById('projects-list');
    endProjectListDrag(targetList);
    if (orderChanged && synced) {
      projectListOrderDirty = true;
    }
    renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
    if (selectedProjectId) {
      var r2 = getProjectByKey(selectedProjectId);
      if (r2) preloadProjectMedia(r2);
      restoreSelectedProjectPreview();
    }
    updateProjectListOrderBar();
    if (orderChanged && synced && isLiteAdmin && dbRef && !adminOrderSaving) {
      persistProjectOrder();
    }
  }

  function applyProjectOrderFromKeys(orderKeys) {
    if (!orderKeys || !orderKeys.length) return false;
    var beforeStr = projectsData.map(function (p) { return p.key; }).join('\t');
    var afterStr = orderKeys.join('\t');
    if (beforeStr === afterStr) return false;
    var byKey = Object.create(null);
    projectsData.forEach(function (p) { byKey[p.key] = p; });
    var selectedRef = selectedProjectId ? byKey[selectedProjectId] : null;
    var newData = orderKeys.map(function (k) { return byKey[k]; }).filter(Boolean);
    if (newData.length !== orderKeys.length) return false;
    newData.forEach(function (p, i) {
      p.key = 'p-' + i;
      p.order = i;
    });
    projectsData = newData;
    projectsByKey = Object.create(null);
    newData.forEach(function (p) { projectsByKey[p.key] = p; });
    if (selectedRef) {
      var match = newData.find(function (p) { return p === selectedRef; });
      selectedProjectId = match ? match.key : null;
    } else {
      selectedProjectId = null;
    }
    return true;
  }

  function persistProjectOrder() {
    if (!dbRef) return;
    var validRows = projectsData.filter(function (item) {
      return item.docId;
    });
    if (!validRows.length) return;
    var hadPendingListOrder = projectListOrderDirty;
    adminOrderSaving = true;
    renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
    updateProjectListOrderBar();

    var batch = dbRef.batch();
    validRows.forEach(function (item, idx) {
      var ref = dbRef.collection('projetos').doc(item.docId);
      batch.set(
        ref,
        {
          order: idx,
          ordem: idx,
          position: idx,
          posicao: idx
        },
        { merge: true }
      );
    });

    batch.commit()
      .then(function () {
        projectListOrderDirty = false;
      })
      .catch(function (error) {
        console.warn('Erro ao salvar ordem dos projetos:', error);
        if (hadPendingListOrder) projectListOrderDirty = true;
        alert(t('js.projectOrderFailed'));
      })
      .finally(function () {
        adminOrderSaving = false;
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
        updateProjectListOrderBar();
      });
  }

  function updateProjectListOrderBar() {
    var bar = document.getElementById('projects-order-bar');
    var btn = document.getElementById('projects-order-save');
    if (!bar || !btn) return;
    var show =
      contentMode === 'projects' &&
      isLiteAdmin &&
      projectListOrderDirty &&
      projectsData.length > 0;
    bar.classList.toggle('is-visible', show);
    bar.setAttribute('aria-hidden', show ? 'false' : 'true');
    btn.disabled = !show || adminOrderSaving || !dbRef;
  }

  function setupProjectsOrderSaveBar() {
    var btn = document.getElementById('projects-order-save');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!projectListOrderDirty || adminOrderSaving || !dbRef) return;
      persistProjectOrder();
    });
  }

  function scheduleAdminSaveNoticeClear(projectKey) {
    var k = String(projectKey || '');
    if (!k) return;
    if (adminSaveNoticeClearTimer) {
      clearTimeout(adminSaveNoticeClearTimer);
      adminSaveNoticeClearTimer = null;
    }
    Object.keys(adminSaveNoticeByKey).forEach(function (x) {
      if (x !== k) delete adminSaveNoticeByKey[x];
    });
    adminSaveNoticeClearTimer = setTimeout(function () {
      adminSaveNoticeClearTimer = null;
      delete adminSaveNoticeByKey[k];
      renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
    }, 4200);
  }

  function saveProjectDraft(projectKey) {
    var key = String(projectKey || '');
    var project = getProjectByKey(key);
    var draft = adminDrafts[key];
    if (!project || !draft) return;
    if (!dbRef) {
      adminSaveNoticeByKey[key] = { text: t('js.dbUnavailableSave'), error: true };
      scheduleAdminSaveNoticeClear(key);
      renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
      return;
    }
    if (!project.docId) {
      adminSaveNoticeByKey[key] = { text: t('js.docNotFound'), error: true };
      scheduleAdminSaveNoticeClear(key);
      renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
      return;
    }

    adminSavingByKey[key] = true;
    renderProjectsList({ preserveSelection: true, skipPreviewReset: true });

    var payload = {
      title: String(draft.title_pt || '').trim(),
      nome: String(draft.title_pt || '').trim(),
      title_en: String(draft.title_en || '').trim(),
      subtitle: String(draft.subtitle || '').trim(),
      subtitulo: String(draft.subtitle || '').trim(),
      subtitle_en: String(draft.subtitle || '').trim(),
      description: normalizeProjectDescription(draft.description_pt || ''),
      descricao: normalizeProjectDescription(draft.description_pt || ''),
      description_en: normalizeProjectDescription(draft.description_en || '')
    };

    dbRef.collection('projetos').doc(project.docId).set(payload, { merge: true })
      .then(function () {
        project.title = payload.title;
        project.title_en = payload.title_en;
        project.subtitle = payload.subtitle;
        project.subtitulo = payload.subtitulo;
        project.subtitle_en = payload.subtitle_en;
        project.description = payload.description;
        project.description_en = payload.description_en;
        delete adminDrafts[key];
        editingProjectKey = null;
        adminSaveNoticeByKey[key] = { text: t('js.saved'), error: false };
        scheduleAdminSaveNoticeClear(key);
      })
      .catch(function (error) {
        console.warn('Erro ao salvar projeto no Admin Lite:', error);
        adminSaveNoticeByKey[key] = { text: t('js.saveFailed'), error: true };
        scheduleAdminSaveNoticeClear(key);
      })
      .finally(function () {
        delete adminSavingByKey[key];
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
      });
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeProjectDescription(text) {
    var t = String(text || '').replace(/\r\n/g, '\n');
    t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '');
    t = t.replace(/SELECTED\s*\n+\s*RECOGNITION/gi, 'Selected recognition');
    t = t.replace(/([^\n])[ \t]+(?=(?:ROLE|Role|ATUAÇÃO|Atuação)\b)/g, '$1\n\n');
    t = t.replace(/([^\n])[ \t]+(?=(?:SELECTED\s+RECOGNITION|Selected\s+recognition|RECONHECIMENTOS|Reconhecimentos)\b)/g, '$1\n\n');
    t = t.replace(/((?:ROLE|Role|ATUAÇÃO|Atuação)[^\n]*)[ \t]+(?=(?:SELECTED|Selected|RECONHECIMENTOS|Reconhecimentos)\b)/g, '$1\n\n');
    return t.replace(/\n{3,}/g, '\n\n').trim();
  }

  function formatProjectDescriptionHtml(text) {
    var raw = normalizeProjectDescription(text);
    if (!raw) return '';
    return raw.split(/\n{2,}/).map(function (block) {
      return '<p>' + escapeHtml(block.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function toPlainText(value) {
    return normalizeProjectDescription(value);
  }

  function setupSectionIndexTracking() {
    var nav = document.querySelector('.lite-copy-nav');
    var scrollRoot = document.querySelector('.lite-right');
    if (!nav || !scrollRoot) return;

    var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
    var sections = links
      .map(function (link) {
        var id = link.getAttribute('href').slice(1);
        return document.getElementById(id);
      })
      .filter(Boolean);
    if (!links.length || !sections.length) return;

    function setActiveById(id) {
      links.forEach(function (link) {
        var isActive = link.getAttribute('href') === '#' + id;
        link.classList.toggle('is-active', isActive);
      });
    }

    function scrollSectionIntoView(target) {
      var navBottom = nav.getBoundingClientRect().bottom;
      var delta = target.getBoundingClientRect().top - navBottom;
      var paneStyle = window.getComputedStyle(scrollRoot);
      var usesPaneScroll = paneStyle.overflowY === 'auto' || paneStyle.overflowY === 'scroll';
      if (usesPaneScroll) {
        scrollRoot.scrollTo({
          top: Math.max(0, scrollRoot.scrollTop + delta),
          behavior: 'smooth'
        });
        return;
      }
      var pageRoot = document.scrollingElement || document.documentElement;
      pageRoot.scrollTo({
        top: Math.max(0, pageRoot.scrollTop + delta),
        behavior: 'smooth'
      });
    }

    // Estado inicial
    setActiveById(sections[0].id);

    // Mantém destaque no clique e alinha a seção abaixo do menu
    links.forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        var id = (link.getAttribute('href') || '').slice(1);
        var target = id ? document.getElementById(id) : null;
        setActiveById(id);
        if (target) scrollSectionIntoView(target);
      });
    });

    // Atualiza ao rolar conteúdo da coluna direita
    var observer = new IntersectionObserver(
      function (entries) {
        var visible = entries
          .filter(function (entry) { return entry.isIntersecting; })
          .sort(function (a, b) { return b.intersectionRatio - a.intersectionRatio; });
        if (visible.length > 0) {
          setActiveById(visible[0].target.id);
        }
      },
      {
        root: scrollRoot,
        threshold: [0.2, 0.35, 0.5, 0.7],
        rootMargin: "-15% 0px -55% 0px"
      }
    );

    sections.forEach(function (section) {
      observer.observe(section);
    });
  }

  function setupScene() {
    var wrap = document.getElementById('head-canvas-wrap');
    if (!wrap) return;
    loadingIndicator = document.getElementById('lite-loading-indicator');

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(46, wrap.clientWidth / wrap.clientHeight, 0.01, 1000);
    camera.position.set(-2.17, 0.55, 8.11);

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false
      });
    } catch (primaryError) {
      console.warn('Falha ao criar WebGL, tentando fallback...', primaryError);
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: false,
          alpha: false,
          powerPreference: 'default'
        });
      } catch (fallbackError) {
        console.error('Falha ao criar contexto WebGL no modo lite:', fallbackError);
        if (loadingIndicator) loadingIndicator.classList.add('is-hidden');
        return;
      }
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobileViewport() ? 1 : 1.25));
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    wrap.appendChild(renderer.domElement);

    setupControls();
    addLights();
    loadSkyboxBackground();
    loadModel();

    window.addEventListener('resize', handleResize);
    animate();
  }

  function setupControls() {
    if (!THREE.OrbitControls) return;

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.7;
    controls.target.set(0, -0.1, 0);
    controls.update();
  }

  function addLights() {
    var ambient = new THREE.AmbientLight(0xffffff, 0.95);
    scene.add(ambient);

    var hemi = new THREE.HemisphereLight(0xffffff, 0x303030, 0.45);
    scene.add(hemi);

    var key = new THREE.DirectionalLight(0xffffff, 0.65);
    key.position.set(2.2, 3.4, 4.3);
    scene.add(key);

    var fill = new THREE.DirectionalLight(0xffffff, 0.2);
    fill.position.set(-3, -1.5, -2.5);
    scene.add(fill);
  }

  function applyEnvMapIntensity() {
    if (!model || !scene.environment) return;

    model.traverse(function (child) {
      if (!child.isMesh || !child.material) return;
      var materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(function (material) {
        if ('envMapIntensity' in material && scene.environment) {
          material.envMap = scene.environment;
          material.envMapIntensity = 0.4;
        }
        if ('roughness' in material) {
          material.roughness = Math.max(material.roughness || 0, 0.55);
        }
        if ('metalness' in material) {
          material.metalness = Math.min(material.metalness || 0, 0.15);
          material.needsUpdate = true;
        }
      });
    });
  }

  function loadSkyboxBackground() {
    var selected = getWeightedSkybox();
    var loader = new THREE.CubeTextureLoader();

    loader.load(
      selected,
      function (texture) {
        scene.background = texture;
      },
      undefined,
      function (error) {
        console.error('Erro ao carregar o skybox do modo lite:', error);
      }
    );
  }

  function loadHDREnvironment() {
    function onLoadHDR(RGBELoaderClass) {
      var hdrLoader = new RGBELoaderClass();
      hdrLoader.load(
        'HDR/grasslands_sunset_1k.hdr',
        function (texture) {
          texture.mapping = THREE.EquirectangularReflectionMapping;

          var pmremGenerator = new THREE.PMREMGenerator(renderer);
          pmremGenerator.compileEquirectangularShader();
          var envMap = pmremGenerator.fromEquirectangular(texture).texture;

          pmremGenerator.dispose();
          texture.dispose();

          scene.environment = envMap;
          applyEnvMapIntensity();
        },
        undefined,
        function (error) {
          console.error('Erro ao carregar HDR no modo lite:', error);
        }
      );
    }

    if (window.RGBELoader) {
      onLoadHDR(window.RGBELoader);
      return;
    }

    import('https://cdn.jsdelivr.net/npm/three@0.160.0/addons/loaders/RGBELoader.js')
      .then(function (module) {
        window.RGBELoader = module.RGBELoader;
        onLoadHDR(module.RGBELoader);
      })
      .catch(function (error) {
        console.error('Erro ao importar RGBELoader no modo lite:', error);
      });
  }

  function loadModel() {
    var loader = new THREE.GLTFLoader();
    var modelResolved = false;
    function attachLoadedModel(gltf) {
      if (modelResolved) return;
      modelResolved = true;
      model = gltf.scene;
      /* Leve deslocamento em Y- para centrar melhor no ecra; pivô da orbita mantém-se em (0,-0.1,0). */
      model.position.set(0, -3.28, 0);
      model.scale.set(1.2, 1.2, 1.2);

      model.traverse(function (child) {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      scene.add(model);
      applyEnvMapIntensity();

      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach(function (clip) {
          mixer.clipAction(clip).play();
        });
      }

      hideLoadingIndicator();
    }

    function onModelError(error) {
      if (modelResolved) return;
      console.error('Erro ao carregar modelo no modo lite:', error);
      hideLoadingIndicator();
    }

    if (typeof window.loadPortfolioHeadGltf === 'function') {
      window.loadPortfolioHeadGltf(loader, attachLoadedModel, undefined, onModelError);
      return;
    }

    loader.load(LITE_MODEL_URL, attachLoadedModel, undefined, onModelError);
  }

  function hideLoadingIndicator() {
    if (!loadingIndicator) return;
    loadingIndicator.classList.add('is-hidden');
  }

  function handleResize() {
    if (!renderer || !camera) return;
    var wrap = document.getElementById('head-canvas-wrap');
    if (!wrap) return;

    camera.aspect = wrap.clientWidth / wrap.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  }

  function animate() {
    requestAnimationFrame(animate);
    if (document.hidden) return;

    var delta = clock.getDelta();
    if (delta > 0.25) delta = 0.033;
    if (mixer) mixer.update(delta);
    if (controls) controls.update();

    renderer.render(scene, camera);
  }

  function playLiteAboutType() {
    var section = document.getElementById('sobre-mim');
    if (!section) return;
    var paras = section.querySelectorAll('p');
    var i;
    for (i = 0; i < paras.length; i++) paras[i].style.setProperty('--p-i', String(i));
    section.classList.remove('is-typed');
    void section.offsetWidth;
    section.classList.add('is-typed');
  }

  function startLiteApp() {
    setupModeToggle();
    setupContentToggle();
    setupProjectsOrderSaveBar();
    setupProjectPreviewUpload();
    setupProjectMediaOrderTools();
    setupAdminLiteModal();
    setupProjectDeleteModal();
    setupAdminLiteTrigger();
    setupSectionIndexTracking();
    playLiteAboutType();
    dbRef = setupFirebase();
    loadProjectsData().then(function (rows) {
      projectsData = rows;
      renderProjectsList();
      applyLiteDeepLink();
    });
  }

  document.addEventListener('localechange', function () {
    if (window.I18n && typeof I18n.apply === 'function') I18n.apply();
    playLiteAboutType();
    renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
    if (projectDeleteModalElements && projectDeleteModalElements.modal && !projectDeleteModalElements.modal.classList.contains('is-hidden')) {
      var pending = pendingDeleteProjectKey ? getProjectByKey(pendingDeleteProjectKey) : null;
      if (pending) openProjectDeleteModal(pending);
    }
    setAdminModalLoading(false);
  });

  setupScene();
  if (window.I18n && typeof I18n.init === 'function') {
    I18n.init().then(startLiteApp);
  } else {
    startLiteApp();
  }
})();
