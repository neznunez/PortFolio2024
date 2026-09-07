/**
 * Insere linha em branco antes de Role / ATUAÇÃO / Selected recognition / Reconhecimentos.
 *
 *   node scripts/normalize-descriptions.js
 *   node scripts/normalize-descriptions.js --apply
 */
var path = require('path');
var admin = require('firebase-admin');

var ROOT = path.join(__dirname, '..');
var SERVICE = path.join(ROOT, 'secrets', 'firebase-service-account.json');
var APPLY = process.argv.indexOf('--apply') !== -1;

function normalizeProjectDescription(text) {
  var t = String(text || '').replace(/\r\n/g, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '');
  t = t.replace(/SELECTED\s*\n+\s*RECOGNITION/gi, 'Selected recognition');
  t = t.replace(/([^\n])[ \t]+(?=(?:ROLE|Role|ATUAÇÃO|Atuação)\b)/g, '$1\n\n');
  t = t.replace(/([^\n])[ \t]+(?=(?:SELECTED\s+RECOGNITION|Selected\s+recognition|RECONHECIMENTOS|Reconhecimentos)\b)/g, '$1\n\n');
  t = t.replace(/((?:ROLE|Role|ATUAÇÃO|Atuação)[^\n]*)[ \t]+(?=(?:SELECTED|Selected|RECONHECIMENTOS|Reconhecimentos)\b)/g, '$1\n\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

admin.initializeApp({ credential: admin.credential.cert(require(SERVICE)) });
var db = admin.firestore();

db.collection('projetos')
  .get()
  .then(function (snap) {
    var jobs = [];
    snap.forEach(function (doc) {
      var data = doc.data() || {};
      var title = data.title || data.nome || doc.id;
      var patch = {};
      ['description', 'descricao', 'description_en'].forEach(function (key) {
        if (data[key] == null || data[key] === '') return;
        var next = normalizeProjectDescription(data[key]);
        if (next !== String(data[key]).replace(/\r\n/g, '\n').trim()) {
          patch[key] = next;
        }
      });
      if (!Object.keys(patch).length) {
        console.log('ok   ', title);
        return;
      }
      console.log(APPLY ? 'fix  ' : 'need ', title);
      Object.keys(patch).forEach(function (k) {
        console.log('      ' + k + ' → ' + JSON.stringify(patch[k]).slice(0, 160));
      });
      if (APPLY) jobs.push(doc.ref.set(patch, { merge: true }));
    });
    return Promise.all(jobs);
  })
  .then(function () {
    console.log(APPLY ? 'Gravado.' : 'Dry-run. Corre com --apply para gravar.');
    process.exit(0);
  })
  .catch(function (err) {
    console.error(err);
    process.exit(1);
  });
