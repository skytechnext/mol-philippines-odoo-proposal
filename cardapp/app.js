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
  function load_img(file) {
    return new Promise(function (ok, no) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { no(new Error('That file is not an image I can read.')); };
      img.src = URL.createObjectURL(file);
    });
  }
  function draw(img, max, turn) {
    var k = Math.min(1, max / Math.max(img.width, img.height));
    var w = Math.round(img.width * k), h = Math.round(img.height * k);
    var c = document.createElement('canvas'); var x = c.getContext('2d');
    if (turn === 90 || turn === 270) { c.width = h; c.height = w; } else { c.width = w; c.height = h; }
    x.translate(c.width / 2, c.height / 2); x.rotate((turn || 0) * Math.PI / 180); x.drawImage(img, -w / 2, -h / 2, w, h);
    return c;
  }
  function shrink(file) { return load_img(file).then(function (img) { return draw(img, 1800, 0); }); }
  /* grey-scale and stretch contrast so small print on a phone photo stands out */
  function clean(c) {
    var x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height), p = d.data, hist = new Uint32Array(256), i, g;
    for (i = 0; i < p.length; i += 4) { g = (p[i] * 77 + p[i + 1] * 150 + p[i + 2] * 29) >> 8; p[i] = g; hist[g]++; }
    var n = p.length / 4, lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.02) { lo = i; break; } }
    acc = 0; for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.02) { hi = i; break; } }
    var span = Math.max(40, hi - lo);
    for (i = 0; i < p.length; i += 4) { g = Math.max(0, Math.min(255, (p[i] - lo) * 255 / span)); p[i] = p[i + 1] = p[i + 2] = g; }
    x.putImageData(d, 0, 0); return c;
  }
  var JP = /[぀-ヿ㐀-鿿]/;
  var MOB = /^(hp|h\/p|h\.p|handphone|hand ?phone|mobile|mob|cell|cp|m|c|携帯)$/i;
  var FAX = /^(fax|f|facsimile)$/i;
  function digits(s) { return s.replace(/\D/g, ''); }
  /* letters that the reader often produces in place of digits, fixed only inside number-like runs */
  function fixnum(s) {
    return s.replace(/[0-9OoQlI|SsBZ][0-9OoQlI|SsBZ\s().+\-–]{5,}/g, function (run) {
      if (digits(run).length < run.replace(/[\s().+\-–]/g, '').length * 0.6) { return run; }
      return run.replace(/[OoQ]/g, '0').replace(/[lI|]/g, '1').replace(/[Ss]/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
    });
  }
  function phones_in(text) {
    var out = [];
    text.split(/\n/).forEach(function (raw) {
      if (/@/.test(raw) || /(https?:|www\.)/i.test(raw)) { return; }
      var line = fixnum(raw), re = /(\+?\(?\d[\d\s().\-–]{5,}\d)/g, m, last = 0;
      while ((m = re.exec(line))) {
        var num = m[1].trim(), dg = digits(num);
        if (dg.length < 7 || dg.length > 15) { continue; }
        var before = line.slice(last, m.index), lab = (before.match(/([A-Za-z携帯][A-Za-z\/. 携帯]{0,11})\s*[:.\-)]*\s*$/) || [])[1] || '';
        lab = lab.replace(/[. ]+$/, '').trim(); last = m.index + m[1].length;
        var kind = MOB.test(lab) ? 'mobile' : FAX.test(lab) ? 'fax' : 'other';
        if (kind === 'other' && /^(\+?63\s?9|09\d|\+?65\s?[89]|[89]\d{3}[\s-]?\d{4}$|\+?60\s?1|01\d|\+?81\s?[789]0|0[789]0)/.test(num.replace(/[()]/g, ''))) { kind = 'mobile'; }
        if (!out.some(function (o) { return digits(o.n) === dg; })) { out.push({ n: num.replace(/\s+/g, ' '), kind: kind, label: lab }); }
      }
    });
    var rank = { mobile: 0, other: 1, fax: 2 };
    return out.sort(function (a, b) { return rank[a.kind] - rank[b.kind]; });
  }
  function parse(text) {
    text = text.replace(/[ \t]*[©]\s*/g, '@').replace(/\(at\)|\[at\]/gi, '@');
    var lines = text.split(/\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(function (l) { return l.length > 1; });
    var out = { name: '', company: '', title: '', email: '', phone: '', website: '', address: '', phones: [] };
    var used = {};
    var m = text.match(/[A-Za-z0-9._%+-]+ ?@ ?[A-Za-z0-9-]+(?: ?\. ?[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/);
    if (m) { out.email = m[0].replace(/ /g, '').toLowerCase(); }
    out.phones = phones_in(text);
    var pick = out.phones.filter(function (p) { return p.kind !== 'fax'; })[0];
    if (pick) { out.phone = pick.n; }
    lines.forEach(function (l, i) {
      if (/@/.test(l)) { used[i] = 1; }
      if (digits(fixnum(l)).length >= 7 && digits(fixnum(l)).length > l.replace(/\s/g, '').length * 0.45) { used[i] = 1; }
      var w = l.match(/(https?:\/\/|www\.)[^\s]+/i);
      if (w) { out.website = w[0]; used[i] = 1; }
    });
    var CO = /(inc\.?|corp\.?|corporation|co\.,? ?ltd\.?|ltd\.?|limited|company|k\.k\.|llc|pte|sdn|bhd|gmbh|holdings|enterprise|lines|shipping|logistics|株式会社|有限会社|商事|海運|会社)/i;
    var TI = /(manager|director|president|officer|chief|head|supervisor|engineer|captain|consultant|executive|specialist|coordinator|analyst|partner|founder|sales|lead|ceo|cto|cfo|coo|部長|課長|取締役|社長|主任|係長|代表|担当|マネージャー)/i;
    var AD = /(street|st\.|avenue|ave\.?|road|rd\.|floor|bldg|building|tower|city|brgy|singapore \d|#\d|〒|丁目|番地|都|県|市|区)/i;
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
    if (!out.name) { for (var j = 0; j < lines.length; j++) { if (!used[j] && !/\d/.test(lines[j]) && lines[j].length > 3 && lines[j].length < 40) { out.name = lines[j]; break; } } }
    if (!out.company && out.email) { var d = out.email.split('@')[1].split('.')[0]; if (!/gmail|yahoo|outlook|hotmail|icloud/.test(d)) { out.company = d.charAt(0).toUpperCase() + d.slice(1); } }
    return out;
  }
  /* how much usable text a pass found: real words, plus a bonus for an email or a phone number */
  function score(text) {
    var words = (text.match(/[A-Za-z]{3,}/g) || []).length, f = parse(text);
    return words + (f.email ? 12 : 0) + (f.phones.length ? 12 : 0) + (text.match(JP) ? 3 : 0);
  }
  function merge(a, b) {
    var seen = {}, out = [];
    (a + '\n' + b).split(/\n/).forEach(function (l) { var k = l.replace(/\W/g, '').toLowerCase(); if (l.trim().length > 1 && !seen[k]) { seen[k] = 1; out.push(l.trim()); } });
    return out.join('\n');
  }
  var W = {};
  function worker(lang) {
    if (!W[lang]) { W[lang] = window.Tesseract.createWorker(lang, 1, { logger: function (m) { if (m.progress && m.status) { $('prog').textContent = state.step + ' · ' + m.status + ' ' + Math.round(m.progress * 100) + '%'; } } }); }
    return W[lang];
  }
  function pass(lang, canvas, psm, label) {
    state.step = label; $('prog').textContent = label;
    return worker(lang).then(function (w) { return w.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' }).then(function () { return w.recognize(canvas); }); })
      .then(function (r) { return r.data.text || ''; });
  }
  function scan(file) {
    show('work'); $('prog').textContent = 'Preparing photo...';
    var img, best = '', turn = 0;
    load_img(file).then(function (i) {
      img = i; state.img = draw(img, 1800, 0).toDataURL('image/jpeg', 0.85); $('shot').src = state.img;
      if (!window.Tesseract) { throw new Error('The text reader did not load. Check the connection and try again.'); }
      var c = clean(draw(img, 2600, 0));
      return pass('eng', c, '3', 'Reading, pass 1 of 3').then(function (a) {
        return pass('eng', c, '11', 'Reading, pass 2 of 3').then(function (b) { best = score(b) > score(a) ? merge(b, a) : merge(a, b); });
      });
    }).then(function () {
      if (score(best) >= 14) { return; }
      /* little was found: the card is probably sideways in the photo */
      var chain = Promise.resolve();
      [90, 270, 180].forEach(function (t) {
        chain = chain.then(function () {
          if (score(best) >= 14) { return; }
          return pass('eng', clean(draw(img, 2600, t)), '11', 'Trying the photo turned ' + t + '°').then(function (x) { if (score(x) > score(best)) { best = x; turn = t; } });
        });
      });
      return chain;
    }).then(function () {
      if (S.jpn === false) { return; }
      return pass('jpn', clean(draw(img, 2600, turn)), '11', 'Reading Japanese, pass 3 of 3').then(function (j) {
        var jl = j.split(/\n/).filter(function (l) { return JP.test(l); }).map(function (l) { return l.replace(/\s+/g, ' ').trim(); });
        if (jl.length) { best = best + '\n' + jl.join('\n'); }
      }).catch(function () {});
    }).then(function () {
      var f = parse(best);
      ['name', 'company', 'title', 'email', 'phone', 'website', 'address'].forEach(function (k) { $('f_' + k).value = f[k]; });
      $('alts').innerHTML = f.phones.length > 1 ? f.phones.map(function (p) { return '<button type="button" class="chip" data-n="' + esc(p.n) + '">' + esc((p.label ? p.label + ' ' : '') + p.n) + (p.kind === 'fax' ? ' (fax)' : '') + '</button>'; }).join('') : '';
      $('raw').value = best.trim();
      $('shot2').src = state.img;
      $('weak').style.display = (f.phone || f.email) ? 'none' : '';
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
    var d = p.replace(/[^\d+]/g, ''), cc = S.cc || '63';
    if (d.charAt(0) === '+') { return d.slice(1); }
    if (d.indexOf('00') === 0) { return d.slice(2); }
    if (d.charAt(0) === '0') { return cc + d.slice(1); }
    if (d.indexOf(cc) === 0 && d.length > 9) { return d; }
    return d.length <= 10 ? cc + d : d;
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
    '<p id="weak" class="warn" style="display:none">I could not find a phone number or an email on this photo. Fill the card with the frame, hold it flat in good light, and try again, or type the details below.</p>' +
    field('name', 'Name') + field('company', 'Company') + field('title', 'Job title') + field('phone', 'Mobile or phone', 'tel') + '<div id="alts" class="chips"></div>' + field('email', 'Email', 'email') + field('website', 'Website') + field('address', 'Address') +
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
    '<label class="check"><input id="s_jpn" type="checkbox"> Also read Japanese (slower)</label>' +
    '<label class="ghost">Photo of your own business card<input id="s_card" type="file" accept="image/*"></label><img id="s_cardimg" class="thumb" alt="">' +
    '<button id="s_save" class="big">Save settings</button><button id="s_back" class="ghost">Back</button>' +
    '<p class="hint">The API key stays in this browser on this phone. It is sent only to this Odoo site.</p></section>' +
    '</main><div id="toast" class="toast"></div>';

  $('cam').onchange = $('pick').onchange = function (e) { if (e.target.files[0]) { scan(e.target.files[0]); } e.target.value = ''; };
  $('saveBtn').onclick = save;
  $('alts').onclick = function (e) { var n = e.target && e.target.getAttribute('data-n'); if (n) { $('f_phone').value = n; } };
  $('again').onclick = $('next').onclick = function () { show('home'); };
  $('waBtn').onclick = whatsapp; $('shareBtn').onclick = shareCard; $('vcfBtn').onclick = vcard;
  $('mailBtn').onclick = function () { this.href = 'mailto:' + state.saved.v.email + '?subject=' + encodeURIComponent('Nice to meet you') + '&body=' + encodeURIComponent(greeting()); };
  $('gear').onclick = function () {
    $('s_user').value = S.user || 'admin'; $('s_key').value = S.key || ''; $('s_me').value = S.me || ''; $('s_cc').value = S.cc || '63'; $('s_auto').checked = S.auto !== false; $('s_jpn').checked = S.jpn !== false; $('s_cardimg').src = S.card || ''; show('settings');
  };
  $('s_card').onchange = function (e) { if (e.target.files[0]) { shrink(e.target.files[0]).then(function (c) { S.card = c.toDataURL('image/jpeg', 0.8); $('s_cardimg').src = S.card; }); } };
  $('s_save').onclick = function () {
    S.user = $('s_user').value.trim() || 'admin'; S.key = $('s_key').value.trim(); S.me = $('s_me').value.trim(); S.cc = $('s_cc').value.replace(/\D/g, '') || '63'; S.auto = $('s_auto').checked; S.jpn = $('s_jpn').checked; S.uid = null;
    try { store(); } catch (err) { S.card = null; store(); toast('The card photo was too large to keep. Settings saved without it.', true); }
    show('home'); recent();
  };
  $('s_back').onclick = function () { show('home'); };
  recent();
  if (!S.key) { $('gear').click(); }
})();
