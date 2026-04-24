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

    function isVideoTypeHint(hint) {
      var value = String(hint || '').toLowerCase();
      return value.indexOf('video') !== -1;
    }

    function collectMediaItems(source) {
      var found = [];

      function walk(value) {
        if (!value) return;
        if (typeof value === 'string') {
          var isHttp = /^https?:\/\//i.test(value);
          var isImage = /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i.test(value);
          var isVideo = isVideoUrl(value);
          if (isImage || isVideo || isHttp) {
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
        key: 'p-' + idx,
        title: item.title || item.nome || 'Projeto',
        description: item.description || item.descricao || '',
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
          data.id = data.id || doc.id;
          rows.push(data);
        });
        return rows.map(normalizeProject);
      })
      .catch(function () {
        return fromJsonFallback();
      });
  }

  function renderProjectsList() {
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
      var meta = project.year ? String(project.year) : 'Projeto';
      return [
        '<article class="project-item" data-project-key="' + project.key + '">',
        '<h3 class="project-item-title">' + escapeHtml(project.title) + '</h3>',
        '<p class="project-item-meta">' + escapeHtml(meta) + '</p>',
        '<p class="project-item-description">' + escapeHtml(safeDescription) + '</p>',
        '</article>'
      ].join('');
    }).join('');

    Array.prototype.slice.call(listEl.querySelectorAll('.project-item')).forEach(function (itemEl) {
      itemEl.addEventListener('mouseenter', function () {
        var key = itemEl.getAttribute('data-project-key');
        previewProjectByKey(key, false);
      });
      itemEl.addEventListener('pointerenter', function () {
        var key = itemEl.getAttribute('data-project-key');
        previewProjectByKey(key, false);
      });
      itemEl.addEventListener('click', function () {
        var key = itemEl.getAttribute('data-project-key');
        selectProject(key);
      });
      itemEl.addEventListener('mouseleave', function () {
        restoreSelectedProjectPreview();
      });
      itemEl.addEventListener('pointerleave', function () {
        restoreSelectedProjectPreview();
      });
    });

    selectedProjectId = null;
    updateProjectPreview([]);
  }

  function selectProject(projectKey) {
    selectedProjectId = String(projectKey);
    var selected = projectsByKey[selectedProjectId] || projectsData.find(function (p) { return p.key === selectedProjectId; });
    if (!selected) return;

    Array.prototype.slice.call(document.querySelectorAll('.project-item')).forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-project-key') === selectedProjectId);
    });

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
      var shouldShowControls = !!opts.showControls && activeProjectMedia.length >= 1;
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
        // No hover e no clique: mostra primeiro frame; play manual no botão.
        try { videoEl.currentTime = 0.01; } catch (e) {}
        videoEl.pause();
        if (playButton && opts.showControls) playButton.classList.remove('is-hidden');
      };
      videoEl.onerror = function () {
        if (token !== previewRenderToken) return;
        videoEl.classList.remove('is-visible');
        if (playButton) playButton.classList.add('is-hidden');
      };
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
  setupSectionIndexTracking();
  loadProjectsData().then(function (rows) {
    projectsData = rows;
    renderProjectsList();
  });
  setupScene();
})();
