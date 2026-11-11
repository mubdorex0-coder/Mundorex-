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
  function money(cents) { return '$' + (cents / 100).toFixed(2); }
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
    return opt && opt.value !== '' ? opt : null;
  }
  function updateSeasonLabels() {
    var opt = selectedRoom();
    var sel = document.getElementById('pay-season');
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
    if (type) type.value = idx == null || idx === '' ? '' : idx;
    if (season) season.value = '';
    if (adults) adults.value = '';
    if (kids) kids.value = '';
    if (vehicles) vehicles.value = '';
    if (err) err.hidden = true;
    if (math) { math.hidden = true; math.textContent = ''; }
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
    var msg = '';
    if (adults == null || kids == null) msg = 'Indica cuántos adultos y cuántos niños menores de 5 años son';
    else if (vehicles == null) msg = 'Indica el número de vehículos';
    else if (!season) msg = 'Elige la temporada';
    else if (!opt) msg = 'Elige el tipo de habitación';
    if (msg) {
      if (math) math.hidden = true;
      if (err) { err.hidden = !roomTried; err.textContent = msg; }
      if (proof) { proof.setAttribute('href', '#contacto'); proof.setAttribute('aria-disabled', 'true'); }
      return false;
    }
    if (err) err.hidden = true;
    var unit = Number(season === 'alta' ? opt.getAttribute('data-high') : opt.getAttribute('data-low'));
    var vehiclePrice = Number(currentBuy.getAttribute('data-vehicle') || '5');
    var feePct = Number(currentBuy.getAttribute('data-fee-pct') || '15');
    if (!isFinite(unit) || !isFinite(vehiclePrice)) return false;
    var roomCents = Math.round(unit * 100) * adults;
    var parkCents = Math.round(vehiclePrice * 100) * vehicles;
    var sub = roomCents + parkCents;
    var fee = cardOpen() ? Math.round(sub * feePct / 100) : 0;
    var total = sub + fee;
    var seasonName = season === 'alta' ? 'alta' : 'baja';
    var unitTxt = money(Math.round(unit * 100));
    var parkTxt = money(Math.round(vehiclePrice * 100));
    var lines = [
      'Habitación (' + adults + ' personas × ' + unitTxt + ' temporada ' + seasonName + '): ' + money(roomCents),
      'Parqueadero (' + vehicles + ' carros × ' + parkTxt + '): ' + money(parkCents),
      'Subtotal: ' + money(sub)
    ];
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
    var text = 'Hola, ya pagué ' + roomName + '. Temporada ' + seasonName + '. Adultos y niños de 5 años en adelante: ' + adults + '. Niños menores de 5 años: ' + kids + '. Vehículos: ' + vehicles + '. ' + lines.join('. ') + '. Te envío el comprobante.';
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
  function openModal(btn) {
    if (!modal || !dialog) return;
    lastFocus = btn;
    currentBuy = btn;
    if (title) title.textContent = btn.getAttribute('data-name') || '';
    if (price) price.textContent = btn.getAttribute('data-price') || '';
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
    var cardBtn = e.target.closest('.pay-card-btn');
    if (cardBtn) { setCardOpen(cardBtn.getAttribute('aria-expanded') !== 'true'); return; }
    if (e.target.closest('#pay-proof') && isRoom()) {
      roomTried = true;
      if (!roomQuote()) e.preventDefault();
      return;
    }
    if (e.target.closest('[data-close-modal]')) closeModal();
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
})();
