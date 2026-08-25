(function (global) {
  var MODEL_URL = 'models/NezmodelF2.glb';
  var CACHE_NAME = 'portfolio-head-model-cache-v1';

  global.PORTFOLIO_MODEL_URL = MODEL_URL;

  function parseWithLoader(loader, buffer, onLoad, onError) {
    try {
      loader.parse(buffer, 'models/', onLoad, onError);
    } catch (err) {
      if (onError) onError(err);
    }
  }

  function readWithProgress(response, onProgress) {
    var total = Number(response.headers.get('content-length') || 0);
    if (!response.body || typeof onProgress !== 'function') {
      return response.arrayBuffer();
    }
    var reader = response.body.getReader();
    var chunks = [];
    var received = 0;
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) {
          var out = new Uint8Array(received);
          var offset = 0;
          for (var i = 0; i < chunks.length; i += 1) {
            out.set(chunks[i], offset);
            offset += chunks[i].byteLength;
          }
          return out.buffer;
        }
        chunks.push(result.value);
        received += result.value.byteLength;
        onProgress({
          loaded: received,
          total: total || received,
          lengthComputable: total > 0
        });
        return pump();
      });
    }
    return pump();
  }

  function fetchAndCache(onProgress) {
    return fetch(MODEL_URL, { cache: 'force-cache' }).then(function (response) {
      if (!response || !response.ok) {
        throw new Error('model fetch failed');
      }
      if (global.caches) {
        var clone = response.clone();
        global.caches
          .open(CACHE_NAME)
          .then(function (cache) {
            return cache.put(MODEL_URL, clone);
          })
          .catch(function () {});
      }
      return readWithProgress(response, onProgress);
    });
  }

  global.loadPortfolioHeadGltf = function (loader, onLoad, onProgress, onError) {
    function fail(err) {
      if (onError) onError(err);
    }

    function fromNetwork() {
      fetchAndCache(onProgress)
        .then(function (buffer) {
          parseWithLoader(loader, buffer, onLoad, fail);
        })
        .catch(function () {
          loader.load(MODEL_URL, onLoad, onProgress, fail);
        });
    }

    if (!loader || typeof loader.parse !== 'function') {
      fail(new Error('GLTFLoader indisponível'));
      return;
    }

    if (!global.caches) {
      fromNetwork();
      return;
    }

    global.caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.match(MODEL_URL);
      })
      .then(function (cached) {
        if (!cached) {
          fromNetwork();
          return;
        }
        if (typeof onProgress === 'function') {
          onProgress({ loaded: 1, total: 1, lengthComputable: true });
        }
        return cached.arrayBuffer().then(function (buffer) {
          parseWithLoader(loader, buffer, onLoad, function () {
            fromNetwork();
          });
        });
      })
      .catch(fromNetwork);
  };
})(window);
