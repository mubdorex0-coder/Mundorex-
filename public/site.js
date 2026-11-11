/* Pago de productos y reserva de habitaciones */
(function () {
  'use strict';
  var modal = document.getElementById('pay-modal');
  var dialog = modal ? modal.querySelector('.pay-dialog') : null;
  var title = document.getElementById('pay-title');
  var price = document.getElementById('pay-price');
  var proof = document.getElementById('pay-proof');
  var roomBox = document.getElementById('pay-room');
  var lastFocus = null;
  var currentBuy = null;
  var roomTried = false;
  var payMethod = '';
  var chosenFile = null;
  var lastQuote = null;

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy')); }
      catch (e) { reject(e); }
      finally { ta.remove(); }
    });
  }
  function focusables() {
    if (!dialog) return [];
    return Array.prototype.filter.call(dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]'), function (el) {
      return !el.disabled && el.getAttribute('tabindex') !== '-1' && !el.closest('[hidden]');
    });
  }
  function isRoom() { return !!(currentBuy && currentBuy.getAttribute('data-room') === '1'); }
  function cardOpen() {
    var cardBtn = modal && modal.querySelector('.pay-card-btn');
    return !!(cardBtn && cardBtn.getAttribute('aria-expanded') === 'true');
  }
  function money(cents) {
    var n = cents / 100;
    return '$' + (cents % 100 === 0 ? String(n) : n.toFixed(2));
  }
  function countOf(id, min) {
    var el = document.getElementById(id);
    if (!el || String(el.value).trim() === '') return null;
    var n = Number(el.value);
    if (!Number.isInteger(n) || n < min) return null;
    return n;
  }
  function selectedRoom() {
    var sel = document.getElementById('pay-room-type');
    if (!sel || sel.selectedIndex < 0) return null;
    var opt = sel.options[sel.selectedIndex];
    if (!opt || opt.value === '' || opt.disabled || opt.getAttribute('data-available') === '0') return null;
    return opt;
  }
  function updateSeasonLabels() {
    var opt = selectedRoom();
    var sel = document.getElementById('pay-season');
    var seasonField = document.getElementById('pay-season-field');
    var vehicles = document.getElementById('pay-vehicles');
    var fixed = !!(opt && opt.getAttribute('data-mode') === 'fixed');
    if (seasonField) seasonField.hidden = fixed;
    if (vehicles) {
      var max = opt && opt.getAttribute('data-garage-max');
      if (max) vehicles.max = max;
      else vehicles.removeAttribute('max');
    }
    if (!sel || sel.options.length < 3) return;
    var cur = sel.value;
    var low = opt ? opt.getAttribute('data-low') : '';
    var high = opt ? opt.getAttribute('data-high') : '';
    sel.options[1].textContent = low ? ('Temporada baja — $' + low + ' por persona') : 'Temporada baja';
    sel.options[2].textContent = high ? ('Temporada alta — $' + high + ' por persona') : 'Temporada alta';
    sel.value = cur;
  }
  function fillCardMath(btn) {
    var base = document.getElementById('pay-card-base');
    var fee = document.getElementById('pay-card-fee');
    var total = document.getElementById('pay-card-total');
    var pct = document.getElementById('pay-card-pct');
    var box = modal.querySelector('.pay-card-math');
    if (box) box.hidden = isRoom();
    if (isRoom()) return;
    if (base) base.textContent = (btn && btn.getAttribute('data-base')) || '';
    if (fee) fee.textContent = (btn && btn.getAttribute('data-fee-amt')) || '';
    if (total) total.textContent = (btn && btn.getAttribute('data-total')) || '';
    if (pct && btn && btn.getAttribute('data-fee-pct')) pct.textContent = btn.getAttribute('data-fee-pct');
  }
  function resetRoom() {
    if (!roomBox) return;
    roomBox.hidden = !isRoom();
    roomTried = false;
    if (!isRoom()) return;
    var type = document.getElementById('pay-room-type');
    var season = document.getElementById('pay-season');
    var adults = document.getElementById('pay-adults');
    var kids = document.getElementById('pay-kids');
    var vehicles = document.getElementById('pay-vehicles');
    var err = document.getElementById('pay-room-error');
    var math = document.getElementById('pay-room-math');
    var idx = currentBuy.getAttribute('data-room-index');
    if (type) {
      var preset = idx == null || idx === '' ? null : type.querySelector('option[value="' + idx + '"]');
      type.value = preset && !preset.disabled ? idx : '';
    }
    if (season) season.value = '';
    if (adults) adults.value = '';
    if (kids) kids.value = '';
    if (vehicles) vehicles.value = '';
    if (err) err.hidden = true;
    if (math) { math.hidden = true; math.textContent = ''; }
    var packBox = document.getElementById('pay-pack');
    if (packBox) { packBox.hidden = true; packBox.textContent = ''; }
    updateSeasonLabels();
    if (type && type.value && title) title.textContent = type.options[type.selectedIndex].textContent;
  }
  function roomQuote() {
    var opt = selectedRoom();
    var season = (document.getElementById('pay-season') || {}).value || '';
    var adults = countOf('pay-adults', 1);
    var kids = countOf('pay-kids', 0);
    var vehicles = countOf('pay-vehicles', 0);
    var err = document.getElementById('pay-room-error');
    var math = document.getElementById('pay-room-math');
    var rawSel = document.getElementById('pay-room-type');
    var rawOpt = rawSel && rawSel.selectedIndex >= 0 ? rawSel.options[rawSel.selectedIndex] : null;
    var fixed = !!(opt && opt.getAttribute('data-mode') === 'fixed');
    var gmax = opt && opt.getAttribute('data-garage-max');
    var msg = '';
    if (rawOpt && rawOpt.getAttribute('data-available') === '0') msg = 'Esta habitación está agotada.';
    else if (!opt) msg = 'Elige el tipo de habitación';
    else if (adults == null || kids == null) msg = 'Indica cuántos adultos y cuántos niños menores de 5 años son';
    else if (vehicles == null) msg = 'Indica el número de vehículos';
    else if (gmax && vehicles > Number(gmax)) msg = 'El garaje admite hasta ' + gmax + (Number(gmax) === 1 ? ' carro.' : ' carros.');
    else if (!fixed && !season) msg = 'Elige la temporada';
    else if (opt.getAttribute('data-available') === '0') msg = 'Esta habitación está agotada.';
    var packBox = document.getElementById('pay-pack');
    if (msg) {
      if (math) math.hidden = true;
      if (packBox) packBox.hidden = true;
      if (err) { err.hidden = !roomTried; err.textContent = msg; }
      if (proof) { proof.setAttribute('href', '#contacto'); proof.setAttribute('aria-disabled', 'true'); }
      return false;
    }
    if (err) err.hidden = true;
    var vehiclePrice = Number(currentBuy.getAttribute('data-vehicle') || '5');
    var feePct = Number(currentBuy.getAttribute('data-fee-pct') || '15');
    if (!isFinite(vehiclePrice)) return false;
    var seasonName = '';
    var lines;
    var packItems = [];
    var sub;
    if (fixed) {
      var stay = Number(opt.getAttribute('data-stay'));
      var pack = Number(opt.getAttribute('data-pack'));
      if (!isFinite(stay) || !isFinite(pack)) return false;
      var stayCents = Math.round(stay * 100);
      var packCents = Math.round(pack * 100);
      var parkCents = Math.round(vehiclePrice * 100) * vehicles;
      sub = stayCents + packCents + parkCents;
      var parkTxt = money(Math.round(vehiclePrice * 100));
      lines = [
        'Departamento: ' + money(stayCents) + ' — ' + (opt.getAttribute('data-stay-note') || ''),
        'Paquete incluido: ' + money(packCents) + ' — ' + (opt.getAttribute('data-pack-note') || ''),
        'Garaje (' + vehicles + ' carros × ' + parkTxt + '): ' + money(parkCents),
        'Subtotal: ' + money(sub)
      ];
      packItems = String(opt.getAttribute('data-pack-items') || '').split('|').filter(Boolean);
      if (packBox) {
        packBox.hidden = !packItems.length;
        packBox.textContent = '';
        if (packItems.length) {
          var ul = document.createElement('ul');
          ul.className = 'pack-list';
          packItems.forEach(function (item) {
            var li = document.createElement('li');
            li.textContent = item;
            ul.appendChild(li);
          });
          packBox.appendChild(ul);
        }
      }
    } else {
      var unit = Number(season === 'alta' ? opt.getAttribute('data-high') : opt.getAttribute('data-low'));
      if (!isFinite(unit)) return false;
      if (packBox) packBox.hidden = true;
      var roomCents = Math.round(unit * 100) * adults;
      var parkCentsPerson = Math.round(vehiclePrice * 100) * vehicles;
      sub = roomCents + parkCentsPerson;
      seasonName = season === 'alta' ? 'alta' : 'baja';
      var unitTxt = money(Math.round(unit * 100));
      var parkTxtPerson = money(Math.round(vehiclePrice * 100));
      lines = [
        'Habitación (' + adults + ' personas × ' + unitTxt + ' temporada ' + seasonName + '): ' + money(roomCents),
        'Garaje (' + vehicles + ' carros × ' + parkTxtPerson + '): ' + money(parkCentsPerson),
        'Subtotal: ' + money(sub)
      ];
    }
    var fee = cardOpen() ? Math.round(sub * feePct / 100) : 0;
    var total = sub + fee;
    if (cardOpen()) lines.push('Comisión tarjeta (' + feePct + '%): ' + money(fee));
    lines.push('Total a pagar: ' + money(total));
    if (math) {
      math.hidden = false;
      math.textContent = '';
      lines.forEach(function (line) {
        var li = document.createElement('li');
        li.textContent = line;
        math.appendChild(li);
      });
    }
    var roomName = opt.textContent;
    lastQuote = { room: true, product: roomName, season: seasonName, adults: adults, kids: kids, vehicles: vehicles, lines: lines, packItems: packItems, total: money(total) };
    var text = 'Hola, ya pagué ' + roomName + '. ' + (seasonName ? ('Temporada ' + seasonName + '. ') : '') + 'Adultos y niños de 5 años en adelante: ' + adults + '. Niños menores de 5 años: ' + kids + '. Vehículos: ' + vehicles + '. ' + lines.join('. ') + (packItems.length ? '. Incluye: ' + packItems.map(function (item) { return '• ' + item; }).join(' ') : '') + '. Te envío el comprobante.';
    var num = currentBuy.getAttribute('data-wa') || '';
    if (proof) {
      proof.setAttribute('href', num ? ('https://wa.me/' + num + '?text=' + encodeURIComponent(text)) : '#contacto');
      proof.removeAttribute('aria-disabled');
    }
    return true;
  }
  function applyProof() {
    if (isRoom()) { roomQuote(); return; }
    if (!proof || !currentBuy) return;
    proof.removeAttribute('aria-disabled');
    proof.setAttribute('href', currentBuy.getAttribute(cardOpen() ? 'data-proof-card' : 'data-proof') || '#contacto');
  }
  function setCardOpen(open) {
    var cardBtn = modal && modal.querySelector('.pay-card-btn');
    var panel = document.getElementById('pay-card-panel');
    if (cardBtn) cardBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (panel) panel.hidden = !open;
    applyProof();
  }
  function productQuote() {
    var name = (currentBuy && currentBuy.getAttribute('data-name')) || '';
    var plain = (currentBuy && currentBuy.getAttribute('data-price')) || '';
    var base = (currentBuy && currentBuy.getAttribute('data-base')) || '';
    var feeAmt = (currentBuy && currentBuy.getAttribute('data-fee-amt')) || '';
    var pct = (currentBuy && currentBuy.getAttribute('data-fee-pct')) || '15';
    var lines = [];
    var total = plain;
    if (cardOpen()) {
      if (base) lines.push('Precio: ' + base);
      if (feeAmt) lines.push('Comisión tarjeta (' + pct + '%): ' + feeAmt);
      total = (currentBuy && currentBuy.getAttribute('data-total')) || plain;
      lines.push('Total a pagar: ' + total);
    } else if (plain) lines.push('Total a pagar: ' + plain);
    lastQuote = { room: false, product: name, lines: lines, total: total };
    return lastQuote;
  }
  function composeReceipt(url) {
    var q = lastQuote;
    if (!q) return '';
    var out = ['✅ Comprobante de pago enviado', q.product];
    if (q.room) {
      if (q.season) out.push('Temporada: ' + q.season);
      out.push('Adultos y niños de 5 años en adelante: ' + q.adults);
      out.push('Niños menores de 5 años: ' + q.kids);
      out.push('Vehículos: ' + q.vehicles);
    }
    out.push('Método de pago: ' + payMethod);
    (q.lines || []).forEach(function (line) { out.push(line); });
    if (q.packItems && q.packItems.length) {
      out.push('Paquete incluido:');
      q.packItems.forEach(function (item) { out.push('• ' + item); });
    }
    out.push('Comprobante: ' + url);
    return out.join('\n');
  }
  function waHrefFor(text) {
    var num = (currentBuy && currentBuy.getAttribute('data-wa')) || '593968306412';
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
  }
  function openWhatsApp(url) {
    var fallback = document.getElementById('pay-proof');
    if (fallback) { fallback.hidden = false; fallback.textContent = 'Abrir WhatsApp'; fallback.setAttribute('href', url); }
    var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    if (mobile) { location.href = url; return; }
    var pop = window.open(url, '_blank', 'noopener');
    if (!pop) location.href = url;
  }
  function resetReceipt() {
    payMethod = '';
    chosenFile = null;
    lastQuote = null;
    if (!modal) return;
    modal.querySelectorAll('.pay-choice.on').forEach(function (el) { el.classList.remove('on'); });
    var box = document.getElementById('pay-receipt');
    var file = document.getElementById('pay-file');
    var preview = document.getElementById('pay-preview');
    var nameEl = document.getElementById('pay-file-name');
    var status = document.getElementById('pay-receipt-status');
    var share = document.getElementById('pay-share');
    var open = document.getElementById('pay-proof');
    if (box) box.hidden = true;
    if (file) file.value = '';
    if (preview) { preview.hidden = true; preview.removeAttribute('src'); }
    if (nameEl) nameEl.hidden = true;
    if (status) { status.hidden = true; status.textContent = ''; }
    if (share) share.hidden = true;
    if (open) { open.hidden = true; open.setAttribute('href', '#contacto'); }
  }
  function selectMethod(name) {
    payMethod = name || '';
    if (!modal) return;
    modal.querySelectorAll('.pay-choice').forEach(function (el) {
      el.classList.toggle('on', el.getAttribute('data-method') === payMethod);
    });
    var box = document.getElementById('pay-receipt');
    if (box) box.hidden = !payMethod;
    setCardOpen(payMethod === 'Tarjeta de crédito');
  }
  function uploadReceipt(file) {
    var status = document.getElementById('pay-receipt-status');
    if (isRoom()) { roomTried = true; if (!roomQuote()) { if (status) { status.hidden = false; status.textContent = 'Completa la reserva antes de subir el comprobante.'; } return; } }
    else productQuote();
    if (!lastQuote || !payMethod) return;
    if (status) { status.hidden = false; status.textContent = 'Subiendo comprobante…'; }
    var reader = new FileReader();
    reader.onload = function () {
      fetch('/api/comprobante', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: reader.result, product: lastQuote.product, total: lastQuote.total, method: payMethod }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'No se pudo subir el comprobante.'); return j; }); })
        .then(function (j) {
          var text = composeReceipt(j.url);
          var href = waHrefFor(text);
          if (status) { status.hidden = false; status.textContent = '¡Comprobante recibido! Te llevamos a WhatsApp…'; }
          openWhatsApp(href);
        })
        .catch(function (e) { if (status) { status.hidden = false; status.textContent = e.message; } });
    };
    reader.readAsDataURL(file);
  }
  function openModal(btn) {
    if (!modal || !dialog) return;
    lastFocus = btn;
    currentBuy = btn;
    if (title) title.textContent = btn.getAttribute('data-name') || '';
    var hello = document.getElementById('pay-hello');
    if (hello) { hello.textContent = window.customerName ? ('Hola, ' + window.customerName) : ''; hello.hidden = !window.customerName; }
    if (price) price.textContent = btn.getAttribute('data-price') || '';
    resetReceipt();
    resetRoom();
    fillCardMath(btn);
    setCardOpen(false);
    modal.hidden = false;
    document.body.classList.add('modal-open');
    dialog.focus();
  }
  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
    currentBuy = null;
  }

  document.addEventListener('click', function (e) {
    var copy = e.target.closest('.bank-copy');
    if (copy) {
      e.preventDefault();
      copyText(copy.getAttribute('data-copy') || '').then(function () {
        var prev = copy.textContent;
        copy.textContent = 'Copiado';
        setTimeout(function () { copy.textContent = prev; }, 1600);
      }).catch(function () {});
      return;
    }
    var buy = e.target.closest('.buy-open');
    if (buy) { openModal(buy); return; }
    var choice = e.target.closest('.pay-choice');
    if (choice && modal && modal.contains(choice) && !e.target.closest('.bank-copy')) {
      selectMethod(choice.getAttribute('data-method') || '');
      return;
    }
    if (e.target.closest('#pay-share') && chosenFile && navigator.share) {
      var shareText = lastQuote ? composeReceipt('') : 'Comprobante de pago';
      navigator.share({ files: [chosenFile], title: 'Comprobante de pago', text: shareText }).catch(function () {});
      return;
    }
    if (e.target.closest('[data-close-modal]')) closeModal();
  });
  document.addEventListener('change', function (e) {
    if (!e.target || e.target.id !== 'pay-file') return;
    var file = e.target.files && e.target.files[0];
    var status = document.getElementById('pay-receipt-status');
    var preview = document.getElementById('pay-preview');
    var nameEl = document.getElementById('pay-file-name');
    var share = document.getElementById('pay-share');
    chosenFile = file || null;
    if (!file) return;
    var image = file.type.indexOf('image/') === 0;
    if (!image && file.type !== 'application/pdf') { if (status) { status.hidden = false; status.textContent = 'Sube una imagen o un PDF.'; } return; }
    if (file.size > 5 * 1024 * 1024) { if (status) { status.hidden = false; status.textContent = 'El comprobante supera los 5 MB.'; } return; }
    if (preview) {
      if (image) { preview.src = URL.createObjectURL(file); preview.hidden = false; if (nameEl) nameEl.hidden = true; }
      else { preview.hidden = true; if (nameEl) { nameEl.hidden = false; nameEl.textContent = file.name; } }
    }
    if (share) share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    uploadReceipt(file);
  });
  document.addEventListener('input', function (e) {
    if (e.target.closest && e.target.closest('#pay-room')) roomQuote();
  });
  document.addEventListener('change', function (e) {
    if (!e.target.closest || !e.target.closest('#pay-room')) return;
    if (e.target.id === 'pay-room-type') {
      var opt = selectedRoom();
      if (title && opt) title.textContent = opt.textContent;
      updateSeasonLabels();
    }
    roomQuote();
  });
  document.addEventListener('keydown', function (e) {
    if (!modal || modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    var items = focusables();
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  var guest = document.getElementById('comment-guest');
  var userBox = document.getElementById('comment-user');
  var list = document.getElementById('comment-list');
  function commentMsg(form, text) { var p = form && form.querySelector('.comment-msg'); if (p) p.textContent = text || ''; }
  function paintComments(box, items) {
    if (!box) return;
    box.textContent = '';
    items.forEach(function (c) {
      var art = document.createElement('article');
      var name = document.createElement('h3');
      name.className = 'comment-name';
      name.textContent = c.name || '';
      var meta = document.createElement('p');
      meta.className = 'comment-meta';
      var when = '';
      try { when = c.date ? new Date(c.date).toLocaleString('es-EC') : ''; } catch (e) { when = ''; }
      var stars = '★'.repeat(c.stars || 0) + '☆'.repeat(5 - (c.stars || 0));
      meta.textContent = (when ? when + ' · ' : '') + stars;
      var p = document.createElement('p');
      p.className = 'comment-text';
      p.textContent = c.text || '';
      art.appendChild(name); art.appendChild(meta); art.appendChild(p); box.appendChild(art);
    });
  }
  function fillAuthor(name) {
    document.querySelectorAll('input[name="author"]').forEach(function (input) {
      if (document.activeElement === input) return;
      if (!input.value || input.getAttribute('data-prefilled') === '1') {
        input.value = name || '';
        input.setAttribute('data-prefilled', '1');
      }
    });
  }
  document.querySelectorAll('input[name="author"]').forEach(function (input) {
    input.addEventListener('input', function () {
      input.setAttribute('data-prefilled', input.value === (window.customerName || '') ? '1' : '0');
    });
  });
  function showComments(data) {
    var logged = !!(data && data.user);
    if (guest) guest.hidden = logged;
    if (userBox) userBox.hidden = !logged;
    var hello = document.getElementById('comment-hello');
    if (hello && logged) hello.textContent = data.user.name;
    window.customerName = logged ? data.user.name : '';
    var all = data.comments || [];
    paintComments(list, all.filter(function (c) { return !c.section; }));
    document.querySelectorAll('.mini-comments').forEach(function (block) {
      var id = block.getAttribute('data-section');
      var guestLink = block.querySelector('.mini-guest');
      var form = block.querySelector('.mini-form');
      if (guestLink) guestLink.hidden = logged;
      if (form) form.hidden = !logged;
      paintComments(block.querySelector('.mini-list'), all.filter(function (c) { return c.section === id; }));
    });
    if (logged) fillAuthor(data.user.name);
  }
  var commentsReq = 0;
  function loadComments() {
    var reqId = ++commentsReq;
    return fetch('/api/comentarios', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (data) {
      if (reqId === commentsReq) showComments(data);
    }).catch(function () {});
  }
  function commentPost(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'No se pudo completar.'); return j; }); });
  }
  var regBtn = document.getElementById('comment-register-btn');
  var logBtn = document.getElementById('comment-login-btn');
  var regForm = document.getElementById('comment-register');
  var logForm = document.getElementById('comment-login');
  if (regBtn && regForm) regBtn.addEventListener('click', function () { regForm.hidden = false; if (logForm) logForm.hidden = true; });
  if (logBtn && logForm) logBtn.addEventListener('click', function () { logForm.hidden = false; if (regForm) regForm.hidden = true; });
  if (regForm) regForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(regForm);
    if (fd.get('password') !== fd.get('confirm')) { commentMsg(regForm, 'La contraseña y la confirmación no coinciden.'); return; }
    commentPost('/api/comentarios/registro', { name: fd.get('name'), username: fd.get('username'), email: fd.get('email'), password: fd.get('password'), confirm: fd.get('confirm') })
      .then(function () { commentMsg(regForm, ''); loadComments(); }).catch(function (err) { commentMsg(regForm, err.message); });
  });
  if (logForm) logForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(logForm);
    commentPost('/api/comentarios/login', { login: fd.get('login'), password: fd.get('password') })
      .then(function () { commentMsg(logForm, ''); loadComments(); }).catch(function (err) { commentMsg(logForm, err.message); });
  });
  var postForm = document.getElementById('comment-form');
  if (postForm) postForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(postForm);
    commentPost('/api/comentarios', { name: fd.get('author'), text: fd.get('text'), stars: fd.get('stars') }).then(function () {
      postForm.reset();
      fillAuthor(window.customerName || '');
      commentMsg(postForm, 'Comentario publicado.');
      loadComments();
    }).catch(function (err) { commentMsg(postForm, err.message); });
  });
  document.querySelectorAll('.mini-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var section = form.closest('.mini-comments').getAttribute('data-section');
      var fd = new FormData(form);
      commentPost('/api/comentarios', { name: fd.get('author'), text: fd.get('text'), stars: fd.get('stars'), section: section }).then(function () {
        form.reset();
        fillAuthor(window.customerName || '');
        commentMsg(form, 'Comentario publicado.');
        loadComments();
      }).catch(function (err) { commentMsg(form, err.message); });
    });
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-open-register]')) return;
    if (regForm) { regForm.hidden = false; if (logForm) logForm.hidden = true; }
  });
  var outBtn = document.getElementById('comment-logout');
  if (outBtn) outBtn.addEventListener('click', function () { commentPost('/api/comentarios/logout', {}).then(loadComments); });
  if (guest) loadComments();

  var mist = document.getElementById('mist');
  if (mist && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    var ctx = mist.getContext('2d');
    var drops = [];
    function mistCount() { return window.innerWidth <= 820 ? 30 : 46; }
    function mistSize() { mist.width = window.innerWidth; mist.height = window.innerHeight; }
    function mistSeed() {
      mistSize();
      drops = [];
      for (var i = 0; i < mistCount(); i++) drops.push({ x: Math.random() * mist.width, y: Math.random() * mist.height, r: 1 + Math.random() * 2.6, a: 0.06 + Math.random() * 0.16, vy: -0.12 - Math.random() * 0.28, vx: (Math.random() - 0.5) * 0.18 });
    }
    function mistFrame() {
      ctx.clearRect(0, 0, mist.width, mist.height);
      drops.forEach(function (d) {
        d.y += d.vy; d.x += d.vx;
        if (d.y < -6) { d.y = mist.height + 6; d.x = Math.random() * mist.width; }
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255,255,255,' + d.a + ')';
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      });
      requestAnimationFrame(mistFrame);
    }
    mistSeed();
    window.addEventListener('resize', mistSeed);
    requestAnimationFrame(mistFrame);
  }
})();
