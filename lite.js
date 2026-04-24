/* global THREE */
(function () {
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
  var firebaseConfig = {
    apiKey: "AIzaSyDSgff-2XhWgAhfzB8U6MjHvpMr61v28so",
    authDomain: "portfolio-neznunez.firebaseapp.com",
    projectId: "portfolio-neznunez",
    storageBucket: "portfolio-neznunez.firebasestorage.app",
    messagingSenderId: "182523090058",
    appId: "1:182523090058:web:a0b9aea951268c056d4973",
    measurementId: "G-XWH6S0H7WN"
  };

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

  function setupModeToggle() {
    var modeButton = document.getElementById('modeToggle');
    if (!modeButton) return;

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

  function setupAdminLiteTrigger() {
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isLiteAdmin) {
        isLiteAdmin = false;
        adminDrafts = Object.create(null);
        editingProjectKey = null;
        alert('Admin Lite desativado.');
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
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
    adminModalElements.submitButton.textContent = isLoading ? 'Entrando...' : 'Entrar';
  }

  function submitAdminLiteLogin() {
    if (!adminModalElements) return;
    var email = String(adminModalElements.emailInput.value || '').trim();
    var password = String(adminModalElements.passwordInput.value || '');
    if (!email || !password) {
      setAdminModalFeedback('Preencha login e senha.');
      return;
    }

    setAdminModalLoading(true);
    setAdminModalFeedback('');

    window.firebase.auth().signInWithEmailAndPassword(email, password)
      .then(function () {
        isLiteAdmin = true;
        closeAdminLiteModal();
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
      })
      .catch(function (error) {
        console.warn('Falha no login Admin Lite:', error);
        setAdminModalFeedback('Login inválido. Verifique email e senha.');
      })
      .finally(function () {
        setAdminModalLoading(false);
      });
  }

  function requestAdminLiteLogin() {
    if (isLiteAdmin) {
      alert('Admin Lite já está ativo.');
      return;
    }

    if (!window.firebase || !window.firebase.auth) {
      alert('Firebase Auth não está disponível nesta página.');
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

    // remove destaque fixo do indice CV quando estiver em Projetos
    navLinks.forEach(function (link) {
      if (isProjects) link.classList.remove('is-active');
    });
  }

  function setupFirebase() {
    if (!window.firebase || !window.firebase.apps) return null;
    try {
      if (!window.firebase.apps.length) {
        window.firebase.initializeApp(firebaseConfig);
      }
      if (window.firebase.auth) window.firebase.auth();
      return window.firebase.firestore();
    } catch (error) {
      console.warn('Firebase indisponivel no lite:', error);
      return null;
    }
  }

  function loadProjectsData() {
    var db = setupFirebase();

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

    function collectMediaItems(source) {
      var found = [];

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

      // Remove duplicatas mantendo ordem
      var seen = Object.create(null);
      return found.filter(function (item) {
        var key = item.type + '::' + item.src;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

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
        title: item.title || item.nome || 'Projeto',
        subtitle: item.subtitle || item.subtitulo || item.meta || '',
        description: item.description || item.descricao || '',
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
          .sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); });
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
      listEl.innerHTML = '<div class="project-item"><p class="project-item-title">Sem projetos disponíveis</p></div>';
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
      var cleanDescription = toPlainText(project.description || '');
      var safeDescription = cleanDescription.replace(/\n+/g, ' ').trim();
      var meta = project.subtitle ? String(project.subtitle) : (project.year ? String(project.year) : 'Projeto');
      var isActive = project.key === selectedProjectId;
      var isEditing = isLiteAdmin && isActive && editingProjectKey === project.key;
      var showEditButton = isLiteAdmin && isActive && !isEditing;
      var isEditable = isEditing;
      var draft = isEditable ? getProjectDraft(project.key) : null;
      var titleValue = isEditable ? (draft.title || '') : project.title;
      var subtitleValue = isEditable ? (draft.subtitle || '') : meta;
      var descValue = isEditable ? (draft.description || '') : safeDescription;
      var isSaving = !!adminSavingByKey[project.key];
      return [
        '<article class="project-item' + (isActive ? ' is-active' : '') + (isLiteAdmin ? ' project-item--admin' : '') + '" data-project-key="' + project.key + '" data-doc-id="' + escapeHtml(String(project.docId || '')) + '" data-mid="' + escapeHtml(String(project.docId || project.id || project.key)) + '">',
        isLiteAdmin
          ? '<span class="project-drag-handle" draggable="true" data-drag-handle="true" title="Arrastar para reordenar" aria-label="Arrastar para reordenar">⋮⋮</span>'
          : '',
        '<div class="project-item-content">',
        showEditButton
          ? '<div class="project-item-actions">' +
              '<button class="project-edit-icon" data-project-action="delete" type="button" aria-label="Excluir projeto">×</button>' +
              '<button class="project-edit-icon" data-project-action="start-edit" type="button" aria-label="Editar projeto">✎</button>' +
            '</div>'
          : '',
        isEditable
          ? '<input class="project-item-title project-edit-input" data-project-field="title" value="' + escapeHtml(titleValue) + '" />'
          : '<h3 class="project-item-title">' + escapeHtml(project.title) + '</h3>',
        isEditable
          ? '<input class="project-item-meta project-edit-input" data-project-field="subtitle" value="' + escapeHtml(subtitleValue) + '" />'
          : '<p class="project-item-meta">' + escapeHtml(meta) + '</p>',
        isEditable
          ? '<textarea class="project-item-description project-edit-textarea" data-project-field="description">' + escapeHtml(descValue) + '</textarea>'
          : '<p class="project-item-description">' + escapeHtml(safeDescription) + '</p>',
        isEditable
          ? '<div class="project-edit-actions">' +
              '<button class="project-edit-button" data-project-action="save" type="button"' + (isSaving || adminOrderSaving ? ' disabled' : '') + '>Salvar</button>' +
              '<button class="project-edit-button" data-project-action="cancel" type="button"' + (isSaving || adminOrderSaving ? ' disabled' : '') + '>Cancelar</button>' +
            '</div>' +
            '<div class="project-edit-status">' + (isSaving ? 'Salvando conteúdo...' : (adminOrderSaving ? 'Salvando ordem...' : 'Admin Lite ativo')) + '</div>'
          : '',
        '</div>',
        '</article>'
      ].join('');
    }).join('');

    Array.prototype.slice.call(listEl.querySelectorAll('.project-item')).forEach(function (itemEl) {
      itemEl.addEventListener('pointerenter', function () {
        if (projectReorderActive) return;
        if (hoverPreviewTimer) clearTimeout(hoverPreviewTimer);
        var key = itemEl.getAttribute('data-project-key');
        hoverPreviewTimer = setTimeout(function () {
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
      itemEl.addEventListener('pointerleave', function () {
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
            orderAtDragStart = projectsData.map(function (p) { return String(p.docId || p.id || p.key); }).join('\t');
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
      bindAdminDeleteButtons(listEl);
      bindAdminEditorEvents(listEl);
    }
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
      { showControls: true, autoplayVideo: true }
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
    updateProjectPreview(mediaItems, { showControls: keepControls, autoplayVideo: false });
  }

  function updateProjectPreview(mediaItems, options) {
    var opts = options || {};
    var imageEl = document.getElementById('project-preview-image');
    var videoEl = document.getElementById('project-preview-video');
    var playButton = document.getElementById('project-video-play');
    var emptyEl = document.getElementById('project-preview-empty');
    var controlsEl = document.getElementById('project-preview-controls');
    if (!imageEl || !videoEl || !emptyEl) return;

    activeProjectMedia = Array.isArray(mediaItems) ? mediaItems.filter(function (item) {
      return item && item.src;
    }) : [];
    activeMediaIndex = 0;

    if (!activeProjectMedia.length) {
      imageEl.classList.remove('is-visible');
      videoEl.classList.remove('is-visible');
      imageEl.removeAttribute('src');
      videoEl.pause();
      videoEl.removeAttribute('src');
      emptyEl.style.display = 'block';
      if (controlsEl) controlsEl.classList.add('is-hidden');
      if (playButton) playButton.classList.add('is-hidden');
      return;
    }

    renderProjectMedia(opts);
    emptyEl.style.display = 'none';
    if (controlsEl) {
      var shouldShowControls = !!opts.showControls && activeProjectMedia.length >= 2;
      controlsEl.classList.toggle('is-hidden', !shouldShowControls);
    }
  }

  function renderProjectMedia(options) {
    var opts = options || {};
    var imageEl = document.getElementById('project-preview-image');
    var videoEl = document.getElementById('project-preview-video');
    var indexEl = document.getElementById('project-preview-index');
    var playButton = document.getElementById('project-video-play');
    if (!imageEl || !videoEl || !activeProjectMedia.length) return;

    var targetItem = activeProjectMedia[activeMediaIndex];
    if (!targetItem || !targetItem.src) return;

    imageEl.classList.remove('is-visible');
    videoEl.classList.remove('is-visible');
    if (playButton) playButton.classList.add('is-hidden');

    var targetSrc = targetItem.src;
    var token = ++previewRenderToken;
    if (targetItem.type === 'video') {
      currentPreviewIsVideo = true;
      // Hover: usar frame cacheado para minimizar lag e bugs.
      if (!opts.showControls) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        renderVideoFramePreview(targetSrc, token);
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
          videoEl.classList.add('is-visible');
          // No clique: mostra primeiro frame; play manual no botão.
          try { videoEl.currentTime = 0.01; } catch (e) {}
          videoEl.pause();
          if (playButton) playButton.classList.remove('is-hidden');
        };
        videoEl.onerror = function () {
          if (token !== previewRenderToken) return;
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
        imageEl.src = targetSrc;
        imageEl.classList.add('is-visible');
      };
      probe.onerror = function () {
        if (token !== previewRenderToken) return;
        imageEl.src = targetSrc;
        imageEl.classList.add('is-visible');
      };
      probe.src = targetSrc;
    }

    if (indexEl) {
      indexEl.textContent = (activeMediaIndex + 1) + ' / ' + activeProjectMedia.length;
    }
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
    // Evita estressar o pipeline de vídeo durante hover/prefetch.
    video.preload = 'none';
    video.muted = true;
    video.src = url;
  }

  function preloadMedia(item) {
    if (!item || !item.src) return;
    if (item.type === 'video') preloadVideo(item.src);
    else preloadImage(item.src);
  }

  function preloadProjectMedia(project, limit) {
    if (!project || !Array.isArray(project.mediaItems)) return;
    var max = typeof limit === 'number' ? Math.min(limit, project.mediaItems.length) : project.mediaItems.length;
    for (var i = 0; i < max; i += 1) {
      preloadMedia(project.mediaItems[i]);
    }
  }

  function renderVideoFramePreview(videoUrl, token) {
    var imageEl = document.getElementById('project-preview-image');
    if (!imageEl) return;

    if (videoFrameCache[videoUrl]) {
      if (token !== previewRenderToken) return;
      imageEl.src = videoFrameCache[videoUrl];
      imageEl.classList.add('is-visible');
      return;
    }

    if (videoFramePending[videoUrl]) {
      videoFramePending[videoUrl].push(function (dataUrl) {
        if (token !== previewRenderToken || !dataUrl) return;
        imageEl.src = dataUrl;
        imageEl.classList.add('is-visible');
      });
      return;
    }

    videoFramePending[videoUrl] = [];
    var probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;
    probe.playsInline = true;
    probe.crossOrigin = 'anonymous';

    var finish = function (dataUrl) {
      videoFrameCache[videoUrl] = dataUrl || '';
      var waiters = videoFramePending[videoUrl] || [];
      delete videoFramePending[videoUrl];
      if (token === previewRenderToken && dataUrl) {
        imageEl.src = dataUrl;
        imageEl.classList.add('is-visible');
      }
      waiters.forEach(function (fn) { fn(dataUrl || ''); });
    };

    probe.onloadeddata = function () {
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
        finish(canvas.toDataURL('image/jpeg', 0.86));
      } catch (e) {
        finish('');
      }
    };
    probe.onerror = function () {
      finish('');
    };
    probe.src = videoUrl;
    probe.load();
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
      { showControls: true, autoplayVideo: false }
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
      alert('Não foi possível identificar o documento deste projeto.');
      return;
    }
    if (!dbRef) {
      alert('Banco indisponível para excluir.');
      return;
    }
    if (!window.confirm('Excluir este projeto? Esta ação não pode ser desfeita.')) return;

    var prevSelected = selectedProjectId ? getProjectByKey(selectedProjectId) : null;
    var prevSelectedDocId = prevSelected && prevSelected.docId ? prevSelected.docId : null;
    var targetDocId = project.docId;

    dbRef.collection('projetos').doc(project.docId).delete()
      .then(function () {
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
        alert('Falha ao excluir no banco.');
      });
  }

  function getProjectDraft(projectKey) {
    var key = String(projectKey || '');
    var existing = adminDrafts[key];
    if (existing) return existing;
    var project = getProjectByKey(key);
    if (!project) return null;
    var draft = {
      title: project.title || '',
      subtitle: project.subtitle || (project.year ? String(project.year) : ''),
      description: toPlainText(project.description || '')
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
          delete adminDrafts[String(projectKey || '')];
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

  function readOrderSignatureFromListDom(listEl) {
    if (!listEl) return '';
    return Array.from(listEl.querySelectorAll('.project-item')).map(function (el) {
      return el.getAttribute('data-mid') || el.getAttribute('data-project-key') || '';
    }).join('\t');
  }

  function syncProjectsOrderFromListDom(listEl) {
    if (!listEl) return;
    var byKey = Object.create(null);
    var byMid = Object.create(null);
    projectsData.forEach(function (p) {
      byKey[p.key] = p;
      byMid[String(p.docId || p.id || p.key)] = p;
    });
    var newData = Array.from(listEl.querySelectorAll('.project-item'))
      .map(function (el) {
        var mid = el.getAttribute('data-mid');
        if (mid && byMid[mid]) return byMid[mid];
        return byKey[el.getAttribute('data-project-key')];
      })
      .filter(Boolean);
    if (newData.length !== projectsData.length) return;
    var selectedRef = selectedProjectId ? byKey[selectedProjectId] : null;
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
  }

  function finalizeOrderAfterProjectDrag() {
    var listEl = document.getElementById('projects-list');
    var newSig = listEl ? readOrderSignatureFromListDom(listEl) : '';
    var orderChanged = orderAtDragStart && newSig && newSig !== orderAtDragStart;
    if (listEl) {
      syncProjectsOrderFromListDom(listEl);
    }
    liveDragRowEl = null;
    orderAtDragStart = '';
    liveDragLast = { id: null, after: null };
    draggingProjectKey = null;
    var targetList = listEl || document.getElementById('projects-list');
    endProjectListDrag(targetList);
    if (orderChanged) {
      persistProjectOrder();
    } else {
      renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
      if (selectedProjectId) {
        var r2 = getProjectByKey(selectedProjectId);
        if (r2) preloadProjectMedia(r2);
        restoreSelectedProjectPreview();
      }
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
    var validRows = projectsData.filter(function (item) { return item.docId; });
    if (!validRows.length) return;
    adminOrderSaving = true;
    renderProjectsList({ preserveSelection: true, skipPreviewReset: true });

    var batch = dbRef.batch();
    validRows.forEach(function (item, idx) {
      var ref = dbRef.collection('projetos').doc(item.docId);
      batch.set(ref, { order: idx, ordem: idx }, { merge: true });
    });

    batch.commit()
      .then(function () {
        // Ordem persistida com sucesso.
      })
      .catch(function (error) {
        console.warn('Erro ao salvar ordem dos projetos:', error);
        alert('Falha ao salvar ordem dos projetos.');
      })
      .finally(function () {
        adminOrderSaving = false;
        renderProjectsList({ preserveSelection: true, skipPreviewReset: true });
      });
  }

  function saveProjectDraft(projectKey) {
    var key = String(projectKey || '');
    var project = getProjectByKey(key);
    var draft = adminDrafts[key];
    if (!project || !draft) return;
    if (!dbRef) {
      alert('Banco indisponível para salvar.');
      return;
    }
    if (!project.docId) {
      alert('Não foi possível identificar o documento deste projeto.');
      return;
    }

    adminSavingByKey[key] = true;
    renderProjectsList({ preserveSelection: true, skipPreviewReset: true });

    var payload = {
      title: String(draft.title || '').trim(),
      nome: String(draft.title || '').trim(),
      subtitle: String(draft.subtitle || '').trim(),
      subtitulo: String(draft.subtitle || '').trim(),
      description: String(draft.description || '').trim(),
      descricao: String(draft.description || '').trim()
    };

    dbRef.collection('projetos').doc(project.docId).set(payload, { merge: true })
      .then(function () {
        project.title = payload.title;
        project.subtitle = payload.subtitle;
        project.description = payload.description;
        delete adminDrafts[key];
        editingProjectKey = null;
        alert('Projeto atualizado com sucesso.');
      })
      .catch(function (error) {
        console.warn('Erro ao salvar projeto no Admin Lite:', error);
        alert('Falha ao salvar no banco.');
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
    loader.load(
      'models/NezmodelF2.glb',
      function (gltf) {
        model = gltf.scene;
        model.position.set(0, -3, 0);
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
      },
      undefined,
      function (error) {
        console.error('Erro ao carregar modelo no modo lite:', error);
        hideLoadingIndicator();
      }
    );
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

  setupModeToggle();
  setupContentToggle();
  setupAdminLiteModal();
  setupAdminLiteTrigger();
  setupSectionIndexTracking();
  dbRef = setupFirebase();
  loadProjectsData().then(function (rows) {
    projectsData = rows;
    renderProjectsList();
  });
  setupScene();
})();
