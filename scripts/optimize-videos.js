/**
 * Otimiza vídeos do Firebase no teu PC (HandBrake) e devolve o MP4 leve ao Storage.
 *
 * 1) Instala: npm install
 * 2) Instala HandBrakeCLI: https://handbrake.fr/downloads.php
 * 3) Firebase Console → Project settings → Service accounts → Generate new private key
 *    Guarda o JSON em: secrets/firebase-service-account.json
 * 4) Ver lista (sem alterar nada):
 *      node scripts/optimize-videos.js
 * 5) Processar só o mais pesado:
 *      node scripts/optimize-videos.js --apply --max 1
 * 6) Processar todos ≥ 8 MB (ainda não otimizados):
 *      node scripts/optimize-videos.js --apply --min-mb 8
 * 7) Reprocessar os URGENTES (≥ 20 MB), mesmo já marcados — usa o original:
 *      npm run optimize-videos:urgente
 *
 * Não apaga o ficheiro original. Guarda urlOriginal no Firestore.
 */

var fs = require('fs');
var path = require('path');
var https = require('https');
var http = require('http');
var { spawnSync } = require('child_process');

var ROOT = path.join(__dirname, '..');
var TMP_DIR = path.join(ROOT, '.tmp-videos');
var SERVICE_PATHS = [
  path.join(ROOT, 'secrets', 'firebase-service-account.json'),
  process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
].filter(Boolean);

var FIREBASE_PROJECT = 'portfolio-neznunez';
var FIREBASE_API_KEY = 'AIzaSyDSgff-2XhWgAhfzB8U6MjHvpMr61v28so';
var STORAGE_BUCKET = 'portfolio-neznunez.firebasestorage.app';
var URGENT_MB = 20;

function parseArgs(argv) {
  var out = { apply: false, max: Infinity, minMb: 8, only: '', help: false, urgente: false };
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--urgente') out.urgente = true;
    else if (a === '--max') out.max = Number(argv[++i] || 1) || 1;
    else if (a === '--min-mb') out.minMb = Number(argv[++i] || 8) || 8;
    else if (a === '--only') out.only = String(argv[++i] || '').toLowerCase();
  }
  if (out.urgente) out.minMb = URGENT_MB;
  return out;
}

function printHelp() {
  console.log('\nUso:\n  node scripts/optimize-videos.js                      lista (não altera)\n  node scripts/optimize-videos.js --apply --max 1       comprime o mais pesado novo\n  node scripts/optimize-videos.js --apply --min-mb 8\n  node scripts/optimize-videos.js --apply --urgente     reprocessa ≥ 20 MB (inclui já otimizados)\n  node scripts/optimize-videos.js --apply --only "plasma"\n');
}

function fieldVal(f) {
  if (!f) return undefined;
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.doubleValue !== undefined) return f.doubleValue;
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.arrayValue) return (f.arrayValue.values || []).map(fieldVal);
  if (f.mapValue) {
    var o = {};
    var fields = f.mapValue.fields || {};
    Object.keys(fields).forEach(function (k) { o[k] = fieldVal(fields[k]); });
    return o;
  }
  if (f.nullValue !== undefined) return null;
  return undefined;
}

function isYouTube(item) {
  if (!item) return false;
  if (item.provider === 'youtube' || item.youtubeId) return true;
  return /youtu\.?be|youtube\.com/i.test(String(item.url || ''));
}

function isVideoItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.type === 'video') return true;
  return /\.(mp4|webm|mov)(\?|$)/i.test(String(item.url || ''));
}

function fmtMb(bytes) {
  if (bytes == null || !isFinite(bytes)) return '?';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function fetchJson(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      var d = '';
      res.on('data', function (c) { d += c; });
      res.on('end', function () {
        try { resolve({ status: res.statusCode, json: JSON.parse(d) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function headSize(url) {
  return new Promise(function (resolve) {
    try {
      var u = new URL(url);
      var lib = u.protocol === 'http:' ? http : https;
      var req = lib.request(u, { method: 'HEAD', timeout: 20000 }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          headSize(res.headers.location).then(resolve);
          return;
        }
        var len = res.headers['content-length'];
        resolve({
          status: res.statusCode,
          bytes: len ? Number(len) : null,
          type: res.headers['content-type'] || ''
        });
      });
      req.on('error', function () { resolve({ status: 0, bytes: null, type: '' }); });
      req.on('timeout', function () { req.destroy(); resolve({ status: 0, bytes: null, type: '' }); });
      req.end();
    } catch (e) {
      resolve({ status: 0, bytes: null, type: '' });
    }
  });
}

function downloadFile(url, destPath) {
  return new Promise(function (resolve, reject) {
    var file = fs.createWriteStream(destPath);
    function go(currentUrl) {
      var u = new URL(currentUrl);
      var lib = u.protocol === 'http:' ? http : https;
      lib.get(u, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try { fs.unlinkSync(destPath); } catch (e) {}
          file = fs.createWriteStream(destPath);
          go(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(destPath); } catch (e) {}
          reject(new Error('Download HTTP ' + res.statusCode));
          return;
        }
        res.pipe(file);
        file.on('finish', function () { file.close(function () { resolve(destPath); }); });
      }).on('error', function (err) {
        file.close();
        try { fs.unlinkSync(destPath); } catch (e) {}
        reject(err);
      });
    }
    go(url);
  });
}

function findHandBrake() {
  var localApp = process.env.LOCALAPPDATA || '';
  var names = [
    'HandBrakeCLI',
    'C:\\Program Files\\HandBrake\\HandBrakeCLI.exe',
    'C:\\Program Files (x86)\\HandBrake\\HandBrakeCLI.exe',
    localApp ? path.join(localApp, 'HandBrake', 'HandBrakeCLI.exe') : ''
  ].filter(Boolean);
  for (var i = 0; i < names.length; i++) {
    var bin = names[i];
    var r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
    if (r.status === 0 || (r.stdout && /HandBrake/i.test(r.stdout + r.stderr))) return bin;
  }
  return null;
}

function encodeWithHandBrake(cli, inputPath, outputPath) {
  // maxWidth + maxHeight: encaixa no retângulo 1280×1280 sem aumentar (vertical ou horizontal).
  var args = [
    '-i', inputPath,
    '-o', outputPath,
    '-e', 'x264',
    '-q', '23',
    '--encoder-preset', 'medium',
    '--optimize',
    '--maxWidth', '1280',
    '--maxHeight', '1280',
    '--keep-display-aspect',
    '-B', '96',
    '--aencoder', 'av_aac'
  ];
  console.log('  HandBrake…');
  var r = spawnSync(cli, args, { stdio: 'inherit', timeout: 1000 * 60 * 40 });
  if (r.status !== 0) throw new Error('HandBrake falhou (código ' + r.status + ')');
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
    throw new Error('MP4 de saída inválido');
  }
}

function safeName(name) {
  return String(name || 'video').replace(/[^\w.\-]+/g, '_').slice(0, 80);
}

function findServiceAccount() {
  for (var i = 0; i < SERVICE_PATHS.length; i++) {
    var p = SERVICE_PATHS[i];
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

async function listVideos() {
  var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT +
    '/databases/(default)/documents/projetos?pageSize=100&key=' + FIREBASE_API_KEY;
  var res = await fetchJson(url);
  if (res.status !== 200) throw new Error('Firestore HTTP ' + res.status);
  var docs = res.json.documents || [];
  var rows = [];
  docs.forEach(function (doc) {
    var id = doc.name.split('/').pop();
    var fields = doc.fields || {};
    var title = fieldVal(fields.title) || fieldVal(fields.nome) || id;
    var carousel = fieldVal(fields.carouselItems) || [];
    if (!Array.isArray(carousel)) carousel = [];
    carousel.forEach(function (item, idx) {
      if (!isVideoItem(item)) return;
      if (isYouTube(item)) {
        rows.push({ title: title, id: id, idx: idx, kind: 'youtube', url: item.url, bytes: 0, poster: !!item.poster });
        return;
      }
      rows.push({
        title: title,
        id: id,
        idx: idx,
        kind: 'storage',
        url: item.url,
        urlOriginal: item.urlOriginal || '',
        poster: !!item.poster,
        optimized: !!item.optimized,
        bytes: null
      });
    });
  });
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].kind !== 'storage' || !rows[i].url) continue;
    var h = await headSize(rows[i].url);
    rows[i].bytes = h.bytes;
    rows[i].ctype = h.type;
  }
  return rows;
}

function priorityLabel(bytes) {
  var mb = (bytes || 0) / (1024 * 1024);
  if (!bytes) return 'tamanho ?';
  if (mb >= 20) return 'REENCODAR (urgente)';
  if (mb >= 8) return 'REENCODAR';
  if (mb >= 4) return 'considerar';
  return 'ok';
}

function sourceUrl(row) {
  return row.urlOriginal || row.url;
}

function guessExt(fileUrl) {
  try {
    var p = decodeURIComponent(new URL(fileUrl).pathname);
    var ext = path.extname(p).toLowerCase();
    if (/\.(mp4|webm|mov|m4v)$/.test(ext)) return ext;
  } catch (e) {}
  return '.mp4';
}

async function applyOne(admin, hb, row) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  var base = safeName(row.title) + '_' + row.idx;
  var downloadFrom = sourceUrl(row);
  var inPath = path.join(TMP_DIR, base + guessExt(downloadFrom));
  var outPath = path.join(TMP_DIR, base + '_opt.mp4');

  console.log('\n→ ' + row.title + '  slide ' + (row.idx + 1) + '  no site agora: ' + fmtMb(row.bytes));
  if (row.urlOriginal && row.urlOriginal !== row.url) {
    console.log('  A descarregar o ORIGINAL (não a versão que ficou maior)…');
  } else {
    console.log('  A descarregar do Storage…');
  }
  await downloadFile(downloadFrom, inPath);

  encodeWithHandBrake(hb, inPath, outPath);
  var newSize = fs.statSync(outPath).size;
  console.log('  Ficheiro fonte → novo ' + fmtMb(newSize) + '  (no site estava ' + fmtMb(row.bytes) + ')');
  if (row.bytes && newSize >= row.bytes) {
    console.warn('  Não enviei: o novo não ficou mais leve que o que está no site.');
    try { fs.unlinkSync(inPath); } catch (e) {}
    try { fs.unlinkSync(outPath); } catch (e) {}
    return;
  }

  var bucket = admin.storage().bucket();
  var dest = 'projects/' + row.id + '/' + Date.now() + '_' + base + '_opt.mp4';
  console.log('  A enviar ' + dest + ' …');
  var token = require('crypto').randomUUID();
  await bucket.upload(outPath, {
    destination: dest,
    metadata: {
      contentType: 'video/mp4',
      cacheControl: 'public, max-age=31536000',
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });
  var downloadUrl = 'https://firebasestorage.googleapis.com/v0/b/' + STORAGE_BUCKET + '/o/' +
    encodeURIComponent(dest) + '?alt=media&token=' + token;

  var db = admin.firestore();
  var ref = db.collection('projetos').doc(row.id);
  await db.runTransaction(async function (tx) {
    var snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Doc desapareceu: ' + row.id);
    var data = snap.data() || {};
    var carousel = Array.isArray(data.carouselItems) ? data.carouselItems.slice() : [];
    var item = carousel[row.idx];
    if (!item) throw new Error('Slide desapareceu: ' + row.idx);
    var sameSlide = item.url === row.url || item.url === downloadFrom || item.urlOriginal === row.urlOriginal;
    if (!sameSlide) {
      throw new Error('O slide mudou entretanto. Interrompi para não gravar no sítio errado.');
    }
    if (!item.urlOriginal) item.urlOriginal = item.urlOriginal || downloadFrom || item.url;
    item.url = downloadUrl;
    item.type = 'video';
    item.optimized = true;
    carousel[row.idx] = item;
    tx.set(ref, { carouselItems: carousel }, { merge: true });
  });

  try { fs.unlinkSync(inPath); } catch (e) {}
  try { fs.unlinkSync(outPath); } catch (e) {}
  console.log('  Gravado no banco. Original mantido no Storage.');
}

async function main() {
  var opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return;
  }

  console.log('A ler projetos no Firestore…');
  var rows = await listVideos();
  var storage = rows.filter(function (r) { return r.kind === 'storage'; })
    .sort(function (a, b) { return (b.bytes || 0) - (a.bytes || 0); });
  var youtube = rows.filter(function (r) { return r.kind === 'youtube'; });

  console.log('\n=== Storage (maior → menor) ===');
  storage.forEach(function (r, i) {
    var mark = r.optimized ? ' [já marcado optimized]' : '';
    console.log(
      String(i + 1).padStart(2, ' ') + '. ' + fmtMb(r.bytes).padStart(10) +
      '  ' + priorityLabel(r.bytes).padEnd(20) +
      '  ' + r.title + '  slide ' + (r.idx + 1) +
      (r.poster ? '' : '  (sem poster)') + mark
    );
  });
  if (youtube.length) {
    console.log('\n=== YouTube (já ok) ===');
    youtube.forEach(function (r) {
      console.log('- ' + r.title + '  slide ' + (r.idx + 1));
    });
  }

  var candidates = storage.filter(function (r) {
    if ((r.bytes || 0) < opts.minMb * 1024 * 1024) return false;
    if (!opts.urgente && r.optimized) return false;
    if (opts.only && String(r.title).toLowerCase().indexOf(opts.only) === -1 && r.id.toLowerCase().indexOf(opts.only) === -1) {
      return false;
    }
    return true;
  }).slice(0, opts.max === Infinity ? undefined : opts.max);

  console.log('\nCandidatos (≥ ' + opts.minMb + ' MB' + (opts.urgente ? ', incluindo já otimizados / urgentes' : '') + '): ' + candidates.length);

  if (!opts.apply) {
    printHelp();
    console.log('Nada foi alterado (faltou --apply).\n');
    return;
  }

  var sa = findServiceAccount();
  if (!sa) {
    console.error('\nFalta a chave de serviço.');
    console.error('Firebase Console → definições do projeto → Contas de serviço → Gerar nova chave privada');
    console.error('Guarda em: secrets/firebase-service-account.json\n');
    process.exit(1);
  }

  var hb = findHandBrake();
  if (!hb) {
    console.error('\nHandBrakeCLI não encontrado.');
    console.error('Instala: https://handbrake.fr/downloads.php  (marca a opção de linha de comando)');
    console.error('Ou coloca HandBrakeCLI no PATH.\n');
    process.exit(1);
  }
  console.log('HandBrake: ' + hb);

  var admin;
  try {
    admin = require('firebase-admin');
  } catch (e) {
    console.error('\nFalta firebase-admin. Corre: npm install firebase-admin --save-dev\n');
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(require(sa)),
      storageBucket: STORAGE_BUCKET
    });
  }

  for (var i = 0; i < candidates.length; i++) {
    try {
      await applyOne(admin, hb, candidates[i]);
    } catch (err) {
      console.error('  Falhou:', err.message || err);
    }
  }
  console.log('\nConcluído.');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
