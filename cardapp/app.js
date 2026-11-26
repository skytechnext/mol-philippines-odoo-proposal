/* MOL Cards - test build. Runs as a page on the Odoo demo site, so it talks to Odoo on the same origin.
   Nothing secret is in this file: the Odoo API key is typed once on the phone and kept in that browser only. */
(function () {
  'use strict';
  var GREETING = 'Hello {name}, nice to meet you today. This is an automated message by my AI agent. Here is my business card.';
  var S = load();
  var state = { img: null, saved: null };

  function load() { try { return JSON.parse(localStorage.getItem('molcards') || '{}'); } catch (e) { return {}; } }
  function store() { localStorage.setItem('molcards', JSON.stringify(S)); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(msg, bad) { var t = $('toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = 'toast'; }, 4200); }

  /* ---------- Odoo ---------- */
  var rpcId = 0;
  function call(service, method, args) {
    return fetch('/jsonrpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++rpcId, params: { service: service, method: method, args: args } }) })
      .then(function (r) { return r.json(); })
      .then(function (r) { if (r.error) { throw new Error((r.error.data && r.error.data.message) || r.error.message || 'Odoo error'); } return r.result; });
  }
  function db() { return S.db ? Promise.resolve(S.db) : call('db', 'list', []).then(function (l) { S.db = l[0]; store(); return S.db; }).catch(function () { S.db = location.hostname.split('.')[0]; store(); return S.db; }); }
  function login() {
    if (!S.key) { return Promise.reject(new Error('Add your Odoo API key in Settings first.')); }
    if (S.uid) { return Promise.resolve(S.uid); }
    return db().then(function (d) { return call('common', 'authenticate', [d, S.user || 'admin', S.key, {}]); })
      .then(function (uid) { if (!uid) { throw new Error('Odoo refused the login. Check the user name and API key.'); } S.uid = uid; store(); return uid; });
  }
  function odoo(model, method, args, kw) {
    return login().then(function (uid) { return call('object', 'execute_kw', [S.db, uid, S.key, model, method, args || [], kw || {}]); });
  }

  /* ---------- reading the card ---------- */
  function shrink(file) {
    return new Promise(function (ok, no) {
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1800 / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src); ok(c);
      };
      img.onerror = function () { no(new Error('That file is not an image I can read.')); };
      img.src = URL.createObjectURL(file);
    });
  }
  var JP = /[぀-ヿ㐀-鿿]/;
  function parse(text) {
    var lines = text.split(/\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(function (l) { return l.length > 1; });
    var out = { name: '', company: '', title: '', email: '', phone: '', website: '', address: '' };
    var used = {};
    var m = text.match(/[A-Za-z0-9._%+-]+ ?@ ?[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (m) { out.email = m[0].replace(/ /g, '').toLowerCase(); }
    var phones = [];
    lines.forEach(function (l, i) {
      var p = l.match(/(\+?\d[\d\s().-]{7,}\d)/g);
      if (p && !/@/.test(l)) { p.forEach(function (x) { if (x.replace(/\D/g, '').length >= 8) { phones.push({ n: x.trim(), mobile: /mob|cell|携帯|m[:.]|\+?63\s?9|09\d\d|0[789]0/i.test(l) }); } }); used[i] = 1; }
      if (/@/.test(l)) { used[i] = 1; }
      var w = l.match(/(https?:\/\/|www\.)[^\s]+/i);
      if (w) { out.website = w[0]; used[i] = 1; }
    });
    phones.sort(function (a, b) { return (b.mobile ? 1 : 0) - (a.mobile ? 1 : 0); });
    if (phones.length) { out.phone = phones[0].n; }
    var CO = /(inc\.?|corp\.?|corporation|co\.,? ?ltd\.?|ltd\.?|limited|company|k\.k\.|llc|pte|gmbh|holdings|enterprise|lines|shipping|logistics|株式会社|有限会社|商事|海運|会社)/i;
    var TI = /(manager|director|president|officer|chief|head|supervisor|engineer|captain|consultant|executive|specialist|coordinator|analyst|partner|founder|sales|部長|課長|取締役|社長|主任|係長|代表|担当|マネージャー)/i;
    var AD = /(street|st\.|avenue|ave\.?|road|rd\.|floor|bldg|building|tower|city|brgy|〒|丁目|番地|都|県|市|区)/i;
    lines.forEach(function (l, i) {
      if (used[i]) { return; }
      if (!out.company && CO.test(l)) { out.company = l; used[i] = 1; return; }
      if (!out.title && TI.test(l) && l.length < 60) { out.title = l; used[i] = 1; return; }
      if (AD.test(l)) { out.address = (out.address ? out.address + ', ' : '') + l; used[i] = 1; }
    });
    for (var i = 0; i < lines.length && !out.name; i++) {
      var l = lines[i]; if (used[i]) { continue; }
      var latin = /^[A-Z][A-Za-z.'-]+( [A-Z][A-Za-z.'-]+){1,3}$/.test(l);
      var jp = JP.test(l) && l.replace(/\s/g, '').length <= 8 && !/\d/.test(l);
      if (latin || jp) { out.name = l; used[i] = 1; }
    }
    if (!out.name) { for (var j = 0; j < lines.length; j++) { if (!used[j] && !/\d/.test(lines[j]) && lines[j].length < 40) { out.name = lines[j]; break; } } }
    if (!out.company && out.email) { var d = out.email.split('@')[1].split('.')[0]; if (!/gmail|yahoo|outlook|hotmail|icloud/.test(d)) { out.company = d.charAt(0).toUpperCase() + d.slice(1); } }
    return out;
  }
  function scan(file) {
    show('work'); $('prog').textContent = 'Preparing photo...';
    shrink(file).then(function (c) {
      state.img = c.toDataURL('image/jpeg', 0.85);
      $('shot').src = state.img;
      if (!window.Tesseract) { throw new Error('The text reader did not load. Check the connection and try again.'); }
      return window.Tesseract.recognize(c, 'eng+jpn', { logger: function (m) {
        $('prog').textContent = (m.status || 'Reading') + (m.progress ? ' ' + Math.round(m.progress * 100) + '%' : '');
      } });
    }).then(function (r) {
      var text = r.data.text || '';
      var f = parse(text);
      ['name', 'company', 'title', 'email', 'phone', 'website', 'address'].forEach(function (k) { $('f_' + k).value = f[k]; });
      $('raw').value = text.trim();
      $('shot2').src = state.img;
      show('review');
    }).catch(function (e) { toast(e.message, true); show('home'); });
  }

  /* ---------- saving ---------- */
  function tagId() { return odoo('res.partner.category', 'search', [[['name', '=', 'Scanned card']]]).then(function (r) { return r.length ? r[0] : odoo('res.partner.category', 'create', [{ name: 'Scanned card' }]); }); }
  function companyId(name) {
    if (!name) { return Promise.resolve(false); }
    return odoo('res.partner', 'search', [[['is_company', '=', true], ['name', '=ilike', name]]], { limit: 1 })
      .then(function (r) { return r.length ? r[0] : odoo('res.partner', 'create', [{ name: name, is_company: true }]); });
  }
  function save() {
    var v = {}; ['name', 'company', 'title', 'email', 'phone', 'website', 'address'].forEach(function (k) { v[k] = $('f_' + k).value.trim(); });
    if (!v.name) { toast('A name is needed before saving.', true); return; }
    var b = $('saveBtn'); b.disabled = true; b.textContent = 'Saving to Odoo...';
    var dup = v.email ? odoo('res.partner', 'search', [[['email', '=ilike', v.email]]], { limit: 1 }) : Promise.resolve([]);
    var pid, isNew = true;
    dup.then(function (d) {
      return Promise.all([tagId(), companyId(v.company)]).then(function (x) {
        var vals = { name: v.name, 'function': v.title, email: v.email, phone: v.phone, website: v.website, street: v.address, category_id: [[4, x[0]]] };
        if (x[1]) { vals.parent_id = x[1]; }
        if (d.length) { isNew = false; pid = d[0]; return odoo('res.partner', 'write', [[pid], vals]); }
        return odoo('res.partner', 'create', [vals]).then(function (id) { pid = id; });
      });
    }).then(function () {
      return odoo('ir.attachment', 'create', [{ name: 'Business card - ' + v.name + '.jpg', raw: state.img.split(',')[1], res_model: 'res.partner', res_id: pid, mimetype: 'image/jpeg' }]);
    }).then(function (att) {
      var who = S.me ? ' by ' + esc(S.me) : '';
      return odoo('res.partner', 'message_post', [[pid]], { body: 'Business card scanned with MOL Cards' + who + (isNew ? '.' : '. Existing contact updated.'), attachment_ids: [att], message_type: 'comment', subtype_xmlid: 'mail.mt_note' });
    }).then(function () {
      state.saved = { id: pid, v: v, isNew: isNew };
      $('doneName').textContent = v.name;
      $('doneSub').textContent = (isNew ? 'New contact saved in Odoo' : 'Existing contact updated in Odoo') + (v.company ? ' under ' + v.company : '') + '.';
      $('openOdoo').href = '/odoo/action-contacts.action_contacts/' + pid;
      $('waBtn').style.display = v.phone ? '' : 'none';
      $('noPhone').style.display = v.phone ? 'none' : '';
      $('mailBtn').style.display = v.email ? '' : 'none';
      show('done'); recent();
      if (v.phone && S.auto !== false) { setTimeout(whatsapp, 600); }
    }).catch(function (e) { toast(e.message, true); }).then(function () { b.disabled = false; b.textContent = 'Save to Odoo'; });
  }

  /* ---------- after saving ---------- */
  function intl(p) {
    var d = p.replace(/[^\d+]/g, '');
    if (d.charAt(0) === '+') { return d.slice(1); }
    if (d.indexOf('00') === 0) { return d.slice(2); }
    if (d.charAt(0) === '0') { return (S.cc || '63') + d.slice(1); }
    return d;
  }
  function greeting() { return GREETING.replace('{name}', state.saved.v.name.replace(/\s*\(.*\)\s*/, '')); }
  function whatsapp() {
    var s = state.saved; if (!s || !s.v.phone) { return; }
    window.open('https://wa.me/' + intl(s.v.phone) + '?text=' + encodeURIComponent(greeting()), '_blank');
    odoo('res.partner', 'message_post', [[s.id]], { body: 'WhatsApp greeting opened for sending from MOL Cards: “' + esc(greeting()) + '”', message_type: 'comment', subtype_xmlid: 'mail.mt_note' }).catch(function () {});
  }
  function shareCard() {
    if (!S.card) { toast('Add a photo of your own card in Settings first.', true); return; }
    fetch(S.card).then(function (r) { return r.blob(); }).then(function (b) {
      var f = new File([b], 'my-business-card.jpg', { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { return navigator.share({ files: [f], text: 'Here is my business card.' }); }
      var a = document.createElement('a'); a.href = S.card; a.download = 'my-business-card.jpg'; a.click();
      toast('This browser cannot share images directly. The card image was downloaded instead.');
    }).catch(function (e) { if (e && e.name !== 'AbortError') { toast(e.message, true); } });
  }
  function vcard() {
    var v = state.saved.v;
    var t = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + v.name, 'N:' + v.name + ';;;;', v.company ? 'ORG:' + v.company : '', v.title ? 'TITLE:' + v.title : '',
      v.phone ? 'TEL;TYPE=CELL:' + v.phone : '', v.email ? 'EMAIL:' + v.email : '', v.website ? 'URL:' + v.website : '', v.address ? 'ADR:;;' + v.address.replace(/,/g, '\\,') + ';;;;' : '', 'END:VCARD']
      .filter(Boolean).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/vcard' })); a.download = v.name.replace(/[^\w぀-鿿]+/g, '_') + '.vcf'; a.click();
  }
  function recent() {
    if (!S.key) { $('recent').innerHTML = '<p class="hint">Open Settings and add your Odoo API key to connect.</p>'; return; }
    odoo('res.partner', 'search_read', [[['category_id.name', '=', 'Scanned card'], ['is_company', '=', false]]], { fields: ['name', 'function', 'parent_id', 'phone', 'email'], limit: 12, order: 'create_date desc' })
      .then(function (rows) {
        $('recent').innerHTML = rows.map(function (r) {
          return '<a class="row" href="/odoo/action-contacts.action_contacts/' + r.id + '" target="_blank"><b>' + esc(r.name) + '</b><span>' + esc([r['function'], r.parent_id && r.parent_id[1]].filter(Boolean).join(' · ')) + '</span></a>';
        }).join('') || '<p class="hint">No scanned cards yet.</p>';
        $('conn').textContent = 'Connected to Odoo'; $('conn').className = 'conn ok';
      }).catch(function (e) { $('conn').textContent = 'Not connected'; $('conn').className = 'conn'; $('recent').innerHTML = '<p class="hint">' + esc(e.message) + '</p>'; });
  }

  /* ---------- screens ---------- */
  function show(id) { ['home', 'work', 'review', 'done', 'settings'].forEach(function (s) { $(s).style.display = s === id ? '' : 'none'; }); window.scrollTo(0, 0); }
  function field(k, label, type) { return '<label>' + label + '<input id="f_' + k + '" type="' + (type || 'text') + '" autocomplete="off"></label>'; }
  $('app').innerHTML =
    '<header><div class="logo"><i>M</i><i class="w">O</i><i>L</i></div><b>Cards</b><span id="conn" class="conn">Not connected</span><button id="gear" aria-label="Settings">Settings</button></header>' +
    '<main>' +
    '<section id="home"><h1>Scan a business card</h1><p class="lead">Photograph a card. The app reads it in English and Japanese, saves the contact to Odoo and opens the WhatsApp greeting.</p>' +
    '<label class="big">Take a photo<input id="cam" type="file" accept="image/*" capture="environment"></label>' +
    '<label class="ghost">Choose from photos<input id="pick" type="file" accept="image/*"></label>' +
    '<h2>Recently scanned</h2><div id="recent"></div></section>' +
    '<section id="work" style="display:none"><img id="shot" alt=""><div class="scanline"></div><p id="prog" class="prog">Reading...</p><p class="hint">The first scan downloads the English and Japanese reading data, about 15 MB. Later scans are faster.</p></section>' +
    '<section id="review" style="display:none"><h1>Check the details</h1><img id="shot2" class="thumb" alt="">' +
    field('name', 'Name') + field('company', 'Company') + field('title', 'Job title') + field('phone', 'Mobile or phone', 'tel') + field('email', 'Email', 'email') + field('website', 'Website') + field('address', 'Address') +
    '<details><summary>Text read from the card</summary><textarea id="raw" rows="6" readonly></textarea></details>' +
    '<button id="saveBtn" class="big">Save to Odoo</button><button id="again" class="ghost">Scan again</button></section>' +
    '<section id="done" style="display:none"><div class="tick">&#10003;</div><h1 id="doneName"></h1><p id="doneSub" class="lead"></p>' +
    '<button id="waBtn" class="big wa">Send WhatsApp greeting</button><p id="noPhone" class="hint" style="display:none">No phone number on this card, so there is no WhatsApp greeting to send.</p>' +
    '<button id="shareBtn" class="ghost">Send my business card image</button><a id="mailBtn" class="ghost" href="#">Email instead</a>' +
    '<button id="vcfBtn" class="ghost">Add to phone contacts</button><a id="openOdoo" class="ghost" target="_blank" href="#">Open in Odoo</a><button id="next" class="big">Scan the next card</button></section>' +
    '<section id="settings" style="display:none"><h1>Settings</h1>' +
    '<label>Odoo user<input id="s_user" autocomplete="off" autocapitalize="off"></label><label>Odoo API key<input id="s_key" type="password" autocomplete="off"></label>' +
    '<label>Your name, shown in the Odoo note<input id="s_me"></label><label>Country code for numbers that start with 0<input id="s_cc" inputmode="numeric"></label>' +
    '<label class="check"><input id="s_auto" type="checkbox"> Open the WhatsApp greeting automatically after saving</label>' +
    '<label class="ghost">Photo of your own business card<input id="s_card" type="file" accept="image/*"></label><img id="s_cardimg" class="thumb" alt="">' +
    '<button id="s_save" class="big">Save settings</button><button id="s_back" class="ghost">Back</button>' +
    '<p class="hint">The API key stays in this browser on this phone. It is sent only to this Odoo site.</p></section>' +
    '</main><div id="toast" class="toast"></div>';

  $('cam').onchange = $('pick').onchange = function (e) { if (e.target.files[0]) { scan(e.target.files[0]); } e.target.value = ''; };
  $('saveBtn').onclick = save;
  $('again').onclick = $('next').onclick = function () { show('home'); };
  $('waBtn').onclick = whatsapp; $('shareBtn').onclick = shareCard; $('vcfBtn').onclick = vcard;
  $('mailBtn').onclick = function () { this.href = 'mailto:' + state.saved.v.email + '?subject=' + encodeURIComponent('Nice to meet you') + '&body=' + encodeURIComponent(greeting()); };
  $('gear').onclick = function () {
    $('s_user').value = S.user || 'admin'; $('s_key').value = S.key || ''; $('s_me').value = S.me || ''; $('s_cc').value = S.cc || '63'; $('s_auto').checked = S.auto !== false; $('s_cardimg').src = S.card || ''; show('settings');
  };
  $('s_card').onchange = function (e) { if (e.target.files[0]) { shrink(e.target.files[0]).then(function (c) { S.card = c.toDataURL('image/jpeg', 0.8); $('s_cardimg').src = S.card; }); } };
  $('s_save').onclick = function () {
    S.user = $('s_user').value.trim() || 'admin'; S.key = $('s_key').value.trim(); S.me = $('s_me').value.trim(); S.cc = $('s_cc').value.replace(/\D/g, '') || '63'; S.auto = $('s_auto').checked; S.uid = null;
    try { store(); } catch (err) { S.card = null; store(); toast('The card photo was too large to keep. Settings saved without it.', true); }
    show('home'); recent();
  };
  $('s_back').onclick = function () { show('home'); };
  recent();
  if (!S.key) { $('gear').click(); }
})();
