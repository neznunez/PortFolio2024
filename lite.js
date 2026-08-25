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
    if (field === 'subtitle') return String(project.subtitle || project.subtitulo || project.meta || '').trim();
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
  var adminPreviewUploadBusy = false;
  var LITE_MAX_IMAGE_MB = window.PORTFOLIO_MAX_IMAGE_MB || 10;
  var LITE_MAX_VIDEO_MB = window.PORTFOLIO_MAX_VIDEO_MB || 80;
  var previewDisplayedProjectKey = '';
  var adminSaveNoticeByKey = Object.create(null);
  var adminSaveNoticeClearTimer = null;
  var projectListOrderDirty = false;
  var LITE_MODEL_URL = 'models/NezmodelF2.glb';
  var LITE_MODEL_CACHE_NAME = 'portfolio-lite-model-cache-v1';

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
      'Park2/posx.jpg',
      'Park2/negx.jpg',
      'Park2/posy.jpg',
      'Park2/negy.jpg',
      'Park2/posz.jpg',
      'Park2/negz.jpg'
    ],
    [
      'Rainbow/rainbow_ft.png',
      'Rainbow/rainbow_bk.png',
      'Rainbow/rainbow_up.png',
      'Rainbow/rainbow_dn.png',
      'Rainbow/rainbow_rt.png',
      'Rainbow/rainbow_lf.png'
    ],
    [
      'Lycksele3/posx.jpg',
      'Lycksele3/negx.jpg',
      'Lycksele3/posy.jpg',
      'Lycksele3/negy.jpg',
      'Lycksele3/posz.jpg',
      'Lycksele3/negz.jpg'
    ]
  ];

  var skyboxWeights = [5, 1, 3, 1];
  var firebaseConfig = window.PORTFOLIO_FIREBASE_CONFIG || null;

  function getWeightedSkybox() {
    var total = skyboxWeights.reduce(function (sum, weight) {
      return sum + weight;
    }, 0);
    var random = Math.random() * total;
    var acc = 0;

    for (var i = 0; i < skyboxWeights.length; i += 1) {
      acc += skyboxWeights[i];
      if (random <= acc) return skyboxes[i];
    }

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
      playButton.addEventListener('click', function () {
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
      var task = ref.put(file);
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

  function liteSaveNewImageUrlsToProject(docId, newUrls) {
    if (!dbRef || !newUrls.length) return Promise.resolve();
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
        var newImageEntries = newUrls.map(function (u) {
          return { type: 'image', url: u };
        });
        return dbRef.collection('projetos').doc(docId).set(
          {
            images: existingImages.concat(newUrls),
            carouselItems: existingCarousel.concat(newImageEntries)
          },
          { merge: true }
        );
      });
  }

  function liteSaveNewVideoUrlsToProject(docId, newUrls) {
    if (!dbRef || !newUrls.length) return Promise.resolve();
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
        var newVideoEntries = newUrls.map(function (u) {
          return { type: 'video', url: u };
        });
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
          return liteUploadProjectMediaFile(docId, f);
        })).then(function (urls) {
          return liteSaveNewImageUrlsToProject(docId, urls);
        });
      });
    }
    if (videoFiles.length) {
      chain = chain.then(function () {
        return Promise.all(videoFiles.map(function (f) {
          return liteUploadProjectMediaFile(docId, f);
        })).then(function (urls) {
          return liteSaveNewVideoUrlsToProject(docId, urls);
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

    if (!window.firebase || !window.firebase.auth) {
      alert(t('js.authUnavailable'));
      return;
    }

    openAdminLiteModal();
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
      if (window.firebase.auth) window.firebase.auth();
      storageRef = null;
      if (window.firebase.storage) {
        try {
          storageRef = window.firebase.storage();
        } catch (storageErr) {
          console.warn('Firebase Storage indisponivel no lite:', storageErr);
        }
      }
      return window.firebase.firestore();
    } catch (error) {
      console.warn('Firebase indisponivel no lite:', error);
      return null;
    }
  }

  function isVideoUrl(url) {
    var value = String(url || '').toLowerCase();
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
    if (isVideoTypeHint(explicitType) || isVideoUrl(src)) return { type: 'video', src: src };
    if (isImageUrl(src)) return { type: 'image', src: src };
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

    // Indexacao por chave e prefetch inicial para reduzir delay no hover.
    projectsByKey = Object.create(null);
    projectsData.forEach(function (project) {
      projectsByKey[project.key] = project;
      if (project.mediaItems && project.mediaItems.length) {
        preloadMedia(project.mediaItems[0]);
      }
    });

    listEl.innerHTML = projectsData.map(function (project) {
      var cleanDescription = toPlainText(loc(project, 'description'));
      var safeDescription = cleanDescription.replace(/\n+/g, ' ').trim();
      var meta = loc(project, 'subtitle') || (project.year ? String(project.year) : t('projects.metaFallback'));
      var isActive = project.key === selectedProjectId;
      var isEditing = isLiteAdmin && isActive && editingProjectKey === project.key;
      var showEditButton = isLiteAdmin && isActive && !isEditing;
      var isEditable = isEditing;
      var draft = isEditable ? getProjectDraft(project.key) : null;
      var titleValue = isEditable ? '' : loc(project, 'title');
      var subtitleValue = isEditable ? '' : meta;
      var descValue = isEditable ? '' : safeDescription;
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
              '<label class="project-bilingual-label">' + escapeHtml(t('projects.labelSubtitlePt')) + '</label>' +
              '<input class="project-item-meta project-edit-input" data-project-field="subtitle_pt" value="' + escapeHtml(draft.subtitle_pt || '') + '" />' +
              '<label class="project-bilingual-label">' + escapeHtml(t('projects.labelSubtitleEn')) + '</label>' +
              '<input class="project-item-meta project-edit-input" data-project-field="subtitle_en" value="' + escapeHtml(draft.subtitle_en || '') + '" />' +
              '<label class="project-bilingual-label">' + escapeHtml(t('projects.labelDescPt')) + '</label>' +
              '<textarea class="project-item-description project-edit-textarea" data-project-field="description_pt">' + escapeHtml(draft.description_pt || '') + '</textarea>' +
              '<label class="project-bilingual-label">' + escapeHtml(t('projects.labelDescEn')) + '</label>' +
              '<textarea class="project-item-description project-edit-textarea" data-project-field="description_en">' + escapeHtml(draft.description_en || '') + '</textarea>' +
            '</div>'
          : '<h3 class="project-item-title">' + escapeHtml(titleValue) + '</h3>',
        !isEditable ? '<p class="project-item-meta">' + escapeHtml(subtitleValue) + '</p>' : '',
        !isEditable ? '<p class="project-item-description">' + escapeHtml(descValue) + '</p>' : '',
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
      subtitle_en: '',
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
          subtitle_en: '',
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
      { showControls: true, autoplayVideo: true, previewOwnerKey: selectedProjectId }
    );
  }

  function previewProjectByKey(projectKey, showControls) {
    var key = String(projectKey || '');
    if (!key) return;
    var project = projectsByKey[key];
    if (!project) return;

    preloadProjectMedia(project, 3);
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

    if (!activeProjectMedia.length) {
      setProjectPreviewLoading(false);
      imageEl.classList.remove('is-visible');
      videoEl.classList.remove('is-visible');
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
    if (playButton) playButton.classList.add('is-hidden');

    var targetSrc = targetItem.src;
    var token = ++previewRenderToken;
    if (targetItem.type === 'video') {
      currentPreviewIsVideo = true;
      // Hover: render direto em <video> para reduzir latência perceptível.
      if (!opts.showControls) {
        renderVideoHoverPreview(targetSrc, token);
      } else {
        videoEl.pause();
        videoEl.currentTime = 0;
        videoEl.loop = true;
        videoEl.autoplay = false;
        videoEl.controls = false;
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.src = targetSrc;
        videoEl.load();
        videoEl.onloadeddata = function () {
          if (token !== previewRenderToken) return;
          setProjectPreviewLoading(false);
          videoEl.classList.add('is-visible');
          // No clique: mostra primeiro frame; play manual no botão.
          try { videoEl.currentTime = 0.01; } catch (e) {}
          videoEl.pause();
          if (playButton) playButton.classList.remove('is-hidden');
        };
        videoEl.onerror = function () {
          if (token !== previewRenderToken) return;
          setProjectPreviewLoading(false);
          videoEl.classList.remove('is-visible');
          if (playButton) playButton.classList.add('is-hidden');
        };
      }
    } else {
      currentPreviewIsVideo = false;
      videoEl.pause();
      videoEl.removeAttribute('src');
      var probe = new Image();
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
  }

  function renderVideoHoverPreview(videoUrl, token) {
    var imageEl = document.getElementById('project-preview-image');
    var videoEl = document.getElementById('project-preview-video');
    if (!imageEl || !videoEl) {
      setProjectPreviewLoading(false);
      return;
    }

    videoEl.pause();
    videoEl.loop = false;
    videoEl.autoplay = false;
    videoEl.controls = false;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.preload = 'metadata';
    videoEl.src = videoUrl;
    videoEl.load();

    videoEl.onloadeddata = function () {
      if (token !== previewRenderToken) return;
      setProjectPreviewLoading(false);
      imageEl.classList.remove('is-visible');
      videoEl.classList.add('is-visible');
      try {
        videoEl.currentTime = 0.08;
      } catch (e) {}
      videoEl.pause();
    };

    videoEl.onerror = function () {
      if (token !== previewRenderToken) return;
      // Fallback para frame em imagem quando o elemento de vídeo falha no hover.
      videoEl.classList.remove('is-visible');
      renderVideoFramePreview(videoUrl, token);
    };

    warmVideoFrameCache(videoUrl);
  }

  function preloadImage(url) {
    if (!url || imagePreloadCache['image::' + url]) return;
    var img = new Image();
    imagePreloadCache['image::' + url] = true;
    img.src = url;
  }

  function preloadVideo(url) {
    if (!url || imagePreloadCache['video::' + url]) return;
    var video = document.createElement('video');
    imagePreloadCache['video::' + url] = true;
    // Mantém metadata pronta para reduzir latência do primeiro hover.
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;
    warmVideoFrameCache(url);
  }

  function preloadMedia(item) {
    if (!item || !item.src) return;
    if (item.type === 'video') {
      preloadVideo(item.src);
      warmVideoFrameCache(item.src);
    } else {
      preloadImage(item.src);
    }
  }

  function preloadProjectMedia(project, limit) {
    if (!project || !Array.isArray(project.mediaItems)) return;
    var max = typeof limit === 'number' ? Math.min(limit, project.mediaItems.length) : project.mediaItems.length;
    for (var i = 0; i < max; i += 1) {
      preloadMedia(project.mediaItems[i]);
    }
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
      onFinish(dataUrl || '');
    }

    function captureFrame() {
      try {
        var w = probe.videoWidth || 320;
        var h = probe.videoHeight || 180;
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        if (!ctx) {
          finish('');
          return;
        }
        ctx.drawImage(probe, 0, 0, w, h);
        finish(canvas.toDataURL('image/jpeg', 0.88));
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
    probe.onloadeddata = captureFrame;
    probe.onerror = function () {
      finish('');
    };
    probe.src = videoUrl;
    probe.load();
  }

  function warmVideoFrameCache(videoUrl) {
    if (!videoUrl || videoFrameCache[videoUrl]) return;
    if (videoFramePending[videoUrl]) return;
    videoFramePending[videoUrl] = [];
    createVideoFrameProbe(videoUrl, function (dataUrl) {
      videoFrameCache[videoUrl] = dataUrl || '';
      var waiters = videoFramePending[videoUrl] || [];
      delete videoFramePending[videoUrl];
      waiters.forEach(function (fn) {
        fn(dataUrl || '');
      });
    });
  }

  function renderVideoFramePreview(videoUrl, token) {
    var imageEl = document.getElementById('project-preview-image');
    if (!imageEl) return;

    if (videoFrameCache[videoUrl]) {
      if (token !== previewRenderToken) return;
      setProjectPreviewLoading(false);
      imageEl.src = videoFrameCache[videoUrl];
      imageEl.classList.add('is-visible');
      return;
    }

    if (videoFramePending[videoUrl]) {
      videoFramePending[videoUrl].push(function (dataUrl) {
        if (token !== previewRenderToken || !dataUrl) return;
        setProjectPreviewLoading(false);
        imageEl.src = dataUrl;
        imageEl.classList.add('is-visible');
      });
      return;
    }

    videoFramePending[videoUrl] = [];

    var finish = function (dataUrl) {
      videoFrameCache[videoUrl] = dataUrl || '';
      var waiters = videoFramePending[videoUrl] || [];
      delete videoFramePending[videoUrl];
      if (token === previewRenderToken) {
        if (dataUrl) {
          imageEl.src = dataUrl;
          imageEl.classList.add('is-visible');
        }
        setProjectPreviewLoading(false);
      }
      waiters.forEach(function (fn) { fn(dataUrl || ''); });
    };
    createVideoFrameProbe(videoUrl, finish);
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
        return { type: item.type === 'video' ? 'video' : 'image', url: item.src };
      }),
      images: mediaItems
        .filter(function (item) {
          return item.type !== 'video';
        })
        .map(function (item) {
          return item.src;
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
      .catch(function (error) {
        console.warn('Erro ao excluir mídia do projeto:', error);
        alert(t('js.mediaDeleteFailed'));
      })
      .finally(function () {
        setProjectPreviewLoading(false);
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
      });
  }

  function togglePreviewVideoPlayback() {
    var videoEl = document.getElementById('project-preview-video');
    var playButton = document.getElementById('project-video-play');
    if (!videoEl || !currentPreviewIsVideo) return;

    if (videoEl.paused) {
      var playPromise = videoEl.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(function () {});
      }
      if (playButton) playButton.classList.add('is-hidden');
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
      subtitle_pt: String(project.subtitle || project.subtitulo || project.meta || (project.year ? String(project.year) : '')).trim(),
      subtitle_en: String(project.subtitle_en || '').trim(),
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
      subtitle: String(draft.subtitle_pt || '').trim(),
      subtitulo: String(draft.subtitle_pt || '').trim(),
      subtitle_en: String(draft.subtitle_en || '').trim(),
      description: String(draft.description_pt || '').trim(),
      descricao: String(draft.description_pt || '').trim(),
      description_en: String(draft.description_en || '').trim()
    };

    dbRef.collection('projetos').doc(project.docId).set(payload, { merge: true })
      .then(function () {
        project.title = payload.title;
        project.title_en = payload.title_en;
        project.subtitle = payload.subtitle;
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

  function toPlainText(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    // Remove tags e atributos vindos de rich text (Firestore/editor).
    var noTags = raw.replace(/<[^>]*>/g, ' ');
    // Compacta espacos para uma linha limpa.
    return noTags.replace(/\s+/g, ' ').trim();
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

    // Estado inicial
    setActiveById(sections[0].id);

    // Mantém destaque no clique
    links.forEach(function (link) {
      link.addEventListener('click', function () {
        var id = link.getAttribute('href').slice(1);
        setActiveById(id);
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
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      });
    } catch (primaryError) {
      console.warn('Falha ao criar WebGL com antialias, tentando fallback...', primaryError);
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    wrap.appendChild(renderer.domElement);

    setupControls();
    addLights();
    loadModel();
    loadSkyboxBackground();

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

    function warmModelCacheInBackground() {
      if (!window.fetch || !window.caches) return;
      window.caches
        .open(LITE_MODEL_CACHE_NAME)
        .then(function (cache) {
          return cache.match(LITE_MODEL_URL).then(function (cachedResponse) {
            if (cachedResponse) return;
            return fetch(LITE_MODEL_URL, { cache: 'force-cache' }).then(function (networkResponse) {
              if (!networkResponse || !networkResponse.ok) return;
              return cache.put(LITE_MODEL_URL, networkResponse.clone()).catch(function () {});
            });
          });
        })
        .catch(function () {});
    }

    function loadModelViaUrl() {
      loader.load(
        LITE_MODEL_URL,
        function (gltf) {
          attachLoadedModel(gltf);
          // Mantém próximas visitas rápidas sem bloquear o primeiro render.
          warmModelCacheInBackground();
        },
        undefined,
        function (error) {
          if (modelResolved) return;
          console.error('Erro ao carregar modelo no modo lite:', error);
          hideLoadingIndicator();
        }
      );
    }

    function loadModelViaArrayBuffer(buffer) {
      try {
        loader.parse(
          buffer,
          '',
          function (gltf) {
            attachLoadedModel(gltf);
          },
          function (error) {
            if (modelResolved) return;
            console.warn('Falha ao parsear GLB em cache, usando loader padrão:', error);
            loadModelViaUrl();
          }
        );
      } catch (parseErr) {
        if (modelResolved) return;
        console.warn('Falha ao inicializar parse GLB, usando loader padrão:', parseErr);
        loadModelViaUrl();
      }
    }

    function tryLoadModelFromPersistentCache() {
      if (!window.caches) return Promise.resolve(false);
      return window.caches
        .open(LITE_MODEL_CACHE_NAME)
        .then(function (cache) {
          return cache.match(LITE_MODEL_URL);
        })
        .then(function (cachedResponse) {
          if (!cachedResponse) return false;
          return cachedResponse.arrayBuffer().then(function (buffer) {
            if (!buffer) return false;
            loadModelViaArrayBuffer(buffer);
            return true;
          });
        })
        .catch(function () {
          return false;
        });
    }

    tryLoadModelFromPersistentCache().then(function (loadedFromCache) {
      if (loadedFromCache) return;
      // Garante primeiro carregamento sem depender da estratégia de cache.
      loadModelViaUrl();
      warmModelCacheInBackground();
    });
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

    var delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    if (controls) controls.update();

    renderer.render(scene, camera);
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
    dbRef = setupFirebase();
    if (window.firebase && window.firebase.auth) {
      window.firebase.auth().onAuthStateChanged(function (user) {
        if (!isLiteAdmin) return;
        var stillAdmin = typeof window.isPortfolioAdmin === 'function'
          ? window.isPortfolioAdmin(user)
          : false;
        if (!stillAdmin) exitLiteAdmin(false);
      });
    }
    loadProjectsData().then(function (rows) {
      projectsData = rows;
      renderProjectsList();
    });
    setupScene();
  }

  document.addEventListener('localechange', function () {
    if (window.I18n && typeof I18n.apply === 'function') I18n.apply();
    renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
    if (projectDeleteModalElements && projectDeleteModalElements.modal && !projectDeleteModalElements.modal.classList.contains('is-hidden')) {
      var pending = pendingDeleteProjectKey ? getProjectByKey(pendingDeleteProjectKey) : null;
      if (pending) openProjectDeleteModal(pending);
    }
    setAdminModalLoading(false);
  });

  if (window.I18n && typeof I18n.init === 'function') {
    I18n.init().then(startLiteApp);
  } else {
    startLiteApp();
  }
})();
