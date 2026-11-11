/* Panel de administración – sin dependencias */
(function () {
  'use strict';
  var CSRF = document.querySelector('meta[name="csrf"]').content;
  var app = document.getElementById('app');
  var state = null, icons = {}, iconSvg = {}, dirty = false, tab = location.hash.slice(1) || 'general';
  var visits = Number(app.dataset.visits || 0);
  function formatVisits(n) { return String(Math.max(0, Math.floor(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function svg(inner, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('class', cls || 'ico');
    // los iconos vienen fijos del servidor (no del usuario)
    s.innerHTML = inner;
    return s;
  }
  function markDirty() { dirty = true; var s = document.getElementById('savestate'); if (s) { s.textContent = 'Tienes cambios sin guardar'; s.className = 'savestate warn'; } }
  function toast(msg, ok) {
    var t = h('div', { class: 'toast ' + (ok ? 'ok' : 'err'), role: 'status', text: msg });
    document.body.appendChild(t); setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, ok ? 2600 : 5000);
  }
  function api(url, body) {
    return fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401) { dirty = false; location.href = '/admin'; }
          if (!r.ok) throw new Error(j.error || 'Ocurrió un error (' + r.status + ').');
          return j;
        });
      });
  }

  /* ----- campos ----- */
  function field(label, obj, key, o) {
    o = o || {};
    var input;
    if (o.type === 'textarea') input = h('textarea', { rows: o.rows || 3, maxlength: o.max || 800, placeholder: o.placeholder || '' });
    else input = h('input', { type: o.type || 'text', maxlength: o.max || 300, placeholder: o.placeholder || '', inputmode: o.inputmode });
    input.value = obj[key] == null ? '' : obj[key];
    input.addEventListener('input', function () { obj[key] = input.value; markDirty(); if (o.oninput) o.oninput(input.value); });
    return h('label', { class: 'field' + (o.wide ? ' wide' : '') }, h('span', { text: label }), input, o.help ? h('small', { text: o.help }) : null);
  }
  function toggle(label, obj, key, onchange) {
    var cb = h('input', { type: 'checkbox', checked: obj[key] });
    cb.addEventListener('change', function () { obj[key] = cb.checked; markDirty(); if (onchange) onchange(); });
    return h('label', { class: 'switch' }, cb, h('span', { class: 'slider' }), h('span', { class: 'switch-label', text: label }));
  }
  function imageField(label, obj, key) {
    var wrap = h('div', { class: 'field wide imgfield' });
    function draw() {
      wrap.textContent = '';
      wrap.appendChild(h('span', { text: label }));
      var row = h('div', { class: 'imgrow' });
      row.appendChild(obj[key] ? h('img', { src: obj[key], alt: '' }) : h('div', { class: 'noimg', text: 'Sin imagen' }));
      var file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', class: 'sr' });
      file.addEventListener('change', function () {
        var f = file.files[0]; if (!f) return;
        if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return toast('Solo imágenes JPG, PNG, WEBP o GIF.');
        if (f.size > 5 * 1024 * 1024) return toast('La imagen supera los 5 MB.');
        var rd = new FileReader();
        rd.onload = function () {
          btn.textContent = 'Subiendo…';
          api('/admin/api/upload', { data: rd.result }).then(function (j) { obj[key] = j.url; markDirty(); draw(); toast('Imagen subida. Recuerda guardar los cambios.', true); })
            .catch(function (e) { toast(e.message); draw(); });
        };
        rd.readAsDataURL(f);
      });
      var btn = h('label', { class: 'btn small' }, obj[key] ? 'Cambiar imagen' : 'Subir imagen', file);
      var actions = h('div', { class: 'imgactions' }, btn,
        obj[key] ? h('button', { type: 'button', class: 'btn small ghost', text: 'Quitar', onclick: function () { obj[key] = ''; markDirty(); draw(); } }) : null,
        h('small', { text: 'JPG, PNG, WEBP o GIF, máximo 5 MB.' }));
      row.appendChild(actions); wrap.appendChild(row);
    }
    draw(); return wrap;
  }
  function chipsEditor(label, list) {
    var wrap = h('div', { class: 'field wide' });
    function draw() {
      wrap.textContent = '';
      wrap.appendChild(h('span', { text: label }));
      var box = h('div', { class: 'chipbox' });
      list.forEach(function (c, i) {
        box.appendChild(h('span', { class: 'chip' }, c, h('button', { type: 'button', 'aria-label': 'Quitar ' + c, text: '×', onclick: function () { list.splice(i, 1); markDirty(); draw(); } })));
      });
      var inp = h('input', { type: 'text', maxlength: 40, placeholder: 'Nueva característica…' });
      function add() { var v = inp.value.trim(); if (!v) return; list.push(v); markDirty(); draw(); wrap.querySelector('input').focus(); }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      wrap.appendChild(box);
      wrap.appendChild(h('div', { class: 'inline' }, inp, h('button', { type: 'button', class: 'btn small', text: '+ Agregar', onclick: add })));
    }
    draw(); return wrap;
  }
  function moveBtns(list, i, redraw) {
    return h('span', { class: 'moves' },
      h('button', { type: 'button', class: 'icon-btn', title: 'Subir', text: '↑', disabled: i === 0, onclick: function () { var x = list.splice(i, 1)[0]; list.splice(i - 1, 0, x); markDirty(); redraw(); } }),
      h('button', { type: 'button', class: 'icon-btn', title: 'Bajar', text: '↓', disabled: i === list.length - 1, onclick: function () { var x = list.splice(i, 1)[0]; list.splice(i + 1, 0, x); markDirty(); redraw(); } }));
  }
  function card(title, children, extra) { return h('section', { class: 'pcard' }, h('div', { class: 'pcard-head' }, h('h3', { text: title }), extra || null), h('div', { class: 'grid2' }, children)); }

  /* ----- pestañas ----- */
  var TABS = [
    ['general', 'General y encabezado', '⚙️'], ['servicios', 'Servicios', '🧭'], ['productos', 'Productos', '🛍️'],
    ['promociones', 'Promociones', '🎁'], ['beneficios', 'Beneficios', '⭐'], ['testimonios', 'Testimonios', '💬'], ['pagos', 'Métodos de pago', '💳'],
    ['redes', 'Redes sociales', '🔗'], ['comprobantes', 'Comprobantes', '🧾'], ['comentarios', 'Comentarios', '💬'], ['seguridad', 'Cambiar contraseña', '🔒']];

  var views = {
    general: function () {
      var g = state.general;
      return [
        card('Encabezado (lo primero que se ve)', [
          field('Nombre del negocio', g, 'businessName', { max: 80 }),
          field('Texto pequeño sobre el título', g, 'heroEyebrow', { max: 120 }),
          field('Título principal', g, 'heroTitle', { max: 140, wide: true }),
          field('Subtítulo', g, 'heroSubtitle', { type: 'textarea', max: 400, wide: true }),
          field('Texto del botón principal', g, 'heroCta', { max: 60 }),
          imageField('Foto de fondo del encabezado (opcional)', g, 'heroImage')]),
        card('WhatsApp y contacto', [
          field('Número de WhatsApp (con código de país, solo números)', g, 'whatsapp', { inputmode: 'numeric', placeholder: '593991234567', help: 'Ejemplo Ecuador: 593 + número sin el 0 inicial.' }),
          field('Mensaje que llega por WhatsApp', g, 'whatsappMessage', { max: 300 }),
          field('Teléfono', g, 'phone', { type: 'tel', max: 40, inputmode: 'tel', placeholder: '0968306412' }),
          field('Correo electrónico', g, 'email', { type: 'email', max: 120 }),
          field('Dirección', g, 'address', { max: 200 }),
          field('Texto del pie de página', g, 'footerText', { type: 'textarea', max: 300, wide: true })]),
        card('Llamada final (antes del pie de página)', [
          field('Título', g, 'finalCtaTitle', { max: 140, wide: true }),
          field('Texto', g, 'finalCtaText', { type: 'textarea', max: 400, wide: true }),
          field('Texto del botón', g, 'finalCtaButton', { max: 60 })]),
        card('Colores de la marca', [
          field('Color principal', g, 'primaryColor', { type: 'color' }),
          field('Color de acento (botones de compra)', g, 'accentColor', { type: 'color' })])];
    },
    servicios: function () {
      var s = state.sections;
      var out = [card('Encabezado de la sección', [field('Título', s, 'servicesTitle'), field('Subtítulo', s, 'servicesSubtitle', { wide: true })]),
        card('Paquetes', [field('Título', s, 'packagesTitle'), field('Subtítulo', s, 'packagesSubtitle', { wide: true, help: 'Los paquetes se arman con los tours, las habitaciones y los departamentos.' })])];
      state.services.forEach(function (sv) {
        var kids = [
          field('Título', sv, 'title', { max: 100 }),
          field('Ícono (emoji, si no hay foto)', sv, 'emoji', { max: 8 }),
          field('Descripción', sv, 'description', { type: 'textarea', rows: 4, max: 800, wide: true }),
          chipsEditor('Características (etiquetas)', sv.chips),
          imageField('Foto del servicio (opcional)', sv, 'image'),
          field('Texto del botón', sv, 'ctaLabel', { max: 60 }),
          field('Mensaje de WhatsApp de este botón', sv, 'waMessage', { max: 300 })];
        if (sv.rooms) kids.push(roomsEditor(sv));
        out.push(card(sv.title || sv.id, kids, toggle('Mostrar en la página', sv, 'visible')));
      });
      return out;
    },
    productos: function () {
      var s = state.sections, wrap = h('div');
      function draw() {
        wrap.textContent = '';
        wrap.appendChild(card('Encabezado del catálogo', [field('Título', s, 'productsTitle'), field('Subtítulo', s, 'productsSubtitle', { wide: true })]));
        state.products.forEach(function (p, i) {
          var head = h('span', { class: 'row-actions' }, moveBtns(state.products, i, draw),
            h('button', { type: 'button', class: 'btn small danger', text: 'Eliminar', onclick: function () {
              if (confirm('¿Eliminar el producto "' + (p.name || 'sin nombre') + '"? Recuerda guardar los cambios.')) { state.products.splice(i, 1); markDirty(); draw(); }
            } }));
          wrap.appendChild(card(p.name || 'Producto nuevo', [
            field('Nombre', p, 'name', { max: 100 }),
            field('Precio (ejemplo 25.00)', p, 'price', { inputmode: 'decimal', max: 20 }),
            field('Descripción corta', p, 'description', { type: 'textarea', max: 300, wide: true }),
            imageField('Foto', p, 'image'),
            field('Moneda', p, 'currency', { max: 5 }),
            field('Texto del botón', p, 'buyLabel', { max: 40, placeholder: 'Comprar' }),
            field('Enlace de compra (opcional)', p, 'buyLink', { type: 'url', max: 500, wide: true, placeholder: 'https://…', help: 'Si lo dejas vacío, o pegas un enlace de WhatsApp, el botón abre las opciones de pago. Otro enlace se abre directo.' }),
            toggle('Agotado (desactiva el botón de compra)', p, 'soldOut')], head));
        });
        wrap.appendChild(h('button', { type: 'button', class: 'btn primary', text: '+ Agregar producto', onclick: function () {
          state.products.push({ name: '', description: '', price: '', currency: 'USD', image: '', buyLabel: 'Comprar', buyLink: '', soldOut: false }); markDirty(); draw();
          var cards = wrap.querySelectorAll('.pcard'); cards[cards.length - 1].scrollIntoView({ behavior: 'smooth' });
        } }));
      }
      draw(); return [wrap];
    },
    promociones: function () {
      var s = state.sections;
      if (!state.promotions) state.promotions = [];
      return [card('Encabezado', [field('Título', s, 'promosTitle'), field('Subtítulo', s, 'promosSubtitle', { wide: true })]),
        listSection(state.promotions, 'Promoción', function (p) {
          return [field('Título', p, 'title', { max: 120 }), field('Texto', p, 'text', { type: 'textarea', max: 400, wide: true })];
        }, function () { return { title: '', text: '' }; }, 30)];
    },
    beneficios: function () {
      var s = state.sections;
      return [card('Encabezado', [field('Título', s, 'benefitsTitle'), field('Subtítulo', s, 'benefitsSubtitle', { wide: true })]),
        listSection(state.benefits, 'Beneficio', function (b) { return [field('Ícono (emoji)', b, 'icon', { max: 8 }), field('Título', b, 'title', { max: 80 }), field('Texto', b, 'text', { type: 'textarea', max: 300, wide: true })]; },
          function () { return { icon: '✅', title: '', text: '' }; }, 8)];
    },
    testimonios: function () {
      var s = state.sections;
      return [card('Encabezado', [field('Título', s, 'testimonialsTitle'), field('Nota (opcional)', s, 'testimonialsNote', { wide: true, help: 'Borra esta nota cuando pongas testimonios reales.' })]),
        listSection(state.testimonials, 'Testimonio', function (t) {
          return [field('Nombre del cliente', t, 'name', { max: 80 }), field('Ciudad', t, 'place', { max: 80 }), field('Opinión', t, 'text', { type: 'textarea', max: 500, wide: true }), toggle('Marcar como "Ejemplo"', t, 'example')];
        }, function () { return { name: '', place: '', text: '', example: false }; }, 20)];
    },
    pagos: function () {
      var p = state.payments, s = state.sections, wrap = h('div');
      function draw() {
        wrap.textContent = '';
        if (p.cardFeePercent == null || p.cardFeePercent === '') p.cardFeePercent = 15;
        wrap.appendChild(card('Sección de métodos de pago', [field('Título', s, 'paymentsTitle'), field('Subtítulo', s, 'paymentsSubtitle', { wide: true }),
          field('Comisión por tarjeta de crédito (%)', p, 'cardFeePercent', { inputmode: 'decimal', max: 6, placeholder: '15', help: 'Se suma al precio solo si el cliente elige Tarjeta de crédito en el catálogo. Ejemplo: 15. No se piden datos de la tarjeta.' }),
          h('p', { class: 'muted wide', text: 'Esta sección solo informa cómo pagar; no cobra ni guarda datos de tarjetas.' })], toggle('Mostrar sección', p, 'visible')));
        var mcard = h('section', { class: 'pcard' }, h('div', { class: 'pcard-head' }, h('h3', { text: 'Formas de pago' })));
        p.methods.forEach(function (m, i) {
          var picker = h('div', { class: 'iconpick', role: 'radiogroup', 'aria-label': 'Ícono' });
          Object.keys(icons).forEach(function (k) {
            picker.appendChild(h('button', { type: 'button', class: 'iconopt' + (m.icon === k ? ' on' : ''), title: icons[k], 'aria-pressed': m.icon === k ? 'true' : 'false', onclick: function () { m.icon = k; markDirty(); draw(); } }, svg(iconSvg[k])));
          });
          mcard.appendChild(h('div', { class: 'item' },
            h('div', { class: 'item-head' }, h('span', { class: 'item-ico' }, svg(iconSvg[m.icon] || iconSvg.check)), h('strong', { text: m.name || 'Método nuevo' }),
              h('span', { class: 'row-actions' }, moveBtns(p.methods, i, draw), h('button', { type: 'button', class: 'btn small danger', text: 'Quitar', onclick: function () { if (confirm('¿Quitar "' + (m.name || 'este método') + '"?')) { p.methods.splice(i, 1); markDirty(); draw(); } } }))),
            h('div', { class: 'grid2' }, field('Nombre', m, 'name', { max: 60 }), field('Nota corta (opcional)', m, 'note', { max: 200 }), h('div', { class: 'field wide' }, h('span', { text: 'Ícono' }), picker))));
        });
        mcard.appendChild(h('button', { type: 'button', class: 'btn', text: '+ Agregar método de pago', onclick: function () { p.methods.push({ icon: 'check', name: '', note: '' }); markDirty(); draw(); } }));
        wrap.appendChild(mcard);
        var bcard = h('section', { class: 'pcard' }, h('div', { class: 'pcard-head' }, h('h3', { text: 'Bancos aceptados' })),
          h('div', { class: 'grid2' }, field('Título de la lista', s, 'banksTitle'), field('Nota (opcional)', s, 'banksNote', { wide: true })),
          h('p', { class: 'muted', text: 'Enciende un banco para mostrarlo en la página; apágalo para ocultarlo. Si escribes un número de cuenta, en la página se puede pulsar ese banco para verlo y copiarlo.' }));
        p.banks.forEach(function (b, i) {
          if (b.accountNumber == null) b.accountNumber = '';
          var name = h('input', { type: 'text', maxlength: 60, value: b.name, 'aria-label': 'Nombre del banco' });
          name.addEventListener('input', function () { b.name = name.value; markDirty(); });
          var acct = h('input', { type: 'text', maxlength: 40, inputmode: 'numeric', value: b.accountNumber || '', placeholder: 'N.º de cuenta (opcional)', 'aria-label': 'Número de cuenta de ' + (b.name || 'banco') });
          acct.addEventListener('input', function () { b.accountNumber = acct.value; markDirty(); });
          bcard.appendChild(h('div', { class: 'bank-row' }, toggle('', b, 'active'), name, acct, moveBtns(p.banks, i, draw),
            h('button', { type: 'button', class: 'btn small danger', text: 'Quitar', onclick: function () { if (confirm('¿Quitar "' + b.name + '" de la lista?')) { p.banks.splice(i, 1); markDirty(); draw(); } } })));
        });
        bcard.appendChild(h('button', { type: 'button', class: 'btn', text: '+ Agregar banco', onclick: function () { p.banks.push({ name: 'Nuevo banco', active: true, accountNumber: '' }); markDirty(); draw(); } }));
        wrap.appendChild(bcard);
      }
      draw(); return [wrap];
    },
    comentarios: function () {
      var wrap = h('div');
      function draw(rows) {
        wrap.textContent = '';
        if (!rows.length) { wrap.appendChild(h('p', { class: 'muted', text: 'Todavía no hay comentarios.' })); return; }
        rows.forEach(function (c) {
          var when = '';
          try { when = c.date ? new Date(c.date).toLocaleString('es-EC') : ''; } catch (e) { when = c.date || ''; }
          wrap.appendChild(card((c.name || 'Cliente') + (c.stars ? ' · ' + c.stars + '★' : ''), [
            h('p', { text: when }),
            h('p', { text: c.text || '' }),
            h('button', { type: 'button', class: 'btn small danger', text: 'Eliminar', onclick: function () {
              if (!confirm('¿Eliminar este comentario?')) return;
              api('/admin/api/comentarios/delete', { id: c.id }).then(function () { api('/admin/api/comentarios').then(function (j) { draw(j.comments || []); }); }).catch(function (err) { toast(err.message); });
            } })
          ]));
        });
      }
      wrap.appendChild(h('p', { class: 'muted', text: 'Cargando comentarios…' }));
      api('/admin/api/comentarios').then(function (j) { draw(j.comments || []); }).catch(function (e) { wrap.textContent = e.message; });
      return [wrap];
    },
    comprobantes: function () {
      var wrap = h('div');
      wrap.appendChild(h('p', { class: 'muted', text: 'Cargando comprobantes…' }));
      api('/admin/api/comprobantes').then(function (j) {
        wrap.textContent = '';
        var rows = j.receipts || [];
        if (!rows.length) { wrap.appendChild(h('p', { class: 'muted', text: 'Todavía no hay comprobantes.' })); return; }
        rows.forEach(function (r) {
          var when = '';
          try { when = r.date ? new Date(r.date).toLocaleString('es-EC') : ''; } catch (e) { when = r.date || ''; }
          wrap.appendChild(card(r.product || 'Pago', [
            h('p', { text: when }),
            h('p', { text: 'Total: ' + (r.total || '—') }),
            r.method ? h('p', { text: 'Método: ' + r.method }) : null,
            r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener', text: 'Ver comprobante' }) : null
          ]));
        });
      }).catch(function (e) { wrap.textContent = ''; wrap.appendChild(h('p', { class: 'muted', text: e.message })); });
      return [wrap];
    },
    redes: function () {
      var so = state.social;
      return [card('Redes sociales (pie de página)', [
        h('p', { class: 'muted wide', text: 'Pega el enlace completo de tu perfil (debe empezar con https://). Si dejas un campo vacío, ese ícono no aparece.' }),
        field('Facebook', so, 'facebook', { type: 'url', max: 500, placeholder: 'https://facebook.com/tu-pagina' }),
        field('WhatsApp', so, 'whatsapp', { max: 500, placeholder: '593991234567 o https://wa.me/…', help: 'Puedes poner solo tu número y se convierte en enlace de WhatsApp.' }),
        field('YouTube', so, 'youtube', { type: 'url', max: 500, placeholder: 'https://youtube.com/@tu-canal' }),
        field('Instagram', so, 'instagram', { type: 'url', max: 500, placeholder: 'https://instagram.com/tu-cuenta' }),
        field('TikTok', so, 'tiktok', { type: 'url', max: 500, placeholder: 'https://tiktok.com/@tu-cuenta' })])];
    },
    seguridad: function () {
      var f = { current: '', next: '', confirm: '' };
      var form = h('form', { class: 'pcard narrow', onsubmit: function (e) {
        e.preventDefault();
        if (f.next.length < 8) return toast('La nueva contraseña debe tener al menos 8 caracteres.');
        if (f.next !== f.confirm) return toast('Las contraseñas nuevas no coinciden.');
        api('/admin/api/password', f).then(function () { toast('Contraseña cambiada. Las demás sesiones se cerraron.', true); form.reset(); f.current = f.next = f.confirm = ''; })
          .catch(function (er) { toast(er.message); });
      } },
      h('div', { class: 'pcard-head' }, h('h3', { text: 'Cambiar contraseña' })),
      h('p', { class: 'muted', text: 'Por seguridad te pedimos tu contraseña actual. Al cambiarla se cierran las sesiones abiertas en otros dispositivos.' }),
      pw('Contraseña actual', 'current', 'current-password'), pw('Nueva contraseña (mínimo 8 caracteres)', 'next', 'new-password'), pw('Confirmar nueva contraseña', 'confirm', 'new-password'),
      h('button', { type: 'submit', class: 'btn primary', text: 'Cambiar contraseña' }));
      function pw(label, key, ac) { var i = h('input', { type: 'password', required: true, autocomplete: ac, maxlength: 200 }); i.addEventListener('input', function () { f[key] = i.value; }); return h('label', { class: 'field' }, h('span', { text: label }), i); }
      return [form];
    }
  };
  function roomsEditor(sv) {
    var wrap = h('div', { class: 'field wide rooms-ed' });
    function draw() {
      wrap.textContent = '';
      if (sv.vehiclePrice == null || sv.vehiclePrice === '') sv.vehiclePrice = '5';
      wrap.appendChild(h('span', { text: 'Tipos de habitación' }));
      wrap.appendChild(field('Título de la lista', sv, 'roomsTitle', { max: 80 }));
      wrap.appendChild(field('Precio por vehículo / parqueadero', sv, 'vehiclePrice', { inputmode: 'decimal', max: 10, placeholder: '5', help: 'Se suma por cada vehículo. No cambia el precio por persona. Ejemplo: 5.' }));
      sv.rooms.forEach(function (r, i) {
        wrap.appendChild(h('div', { class: 'room-row' },
          field('Nombre', r, 'name', { max: 80 }),
          field('Descripción corta', r, 'description', { max: 300 }),
          field('Temporada baja por persona', r, 'priceLow', { inputmode: 'decimal', max: 10, placeholder: '10' }),
          field('Temporada alta por persona', r, 'priceHigh', { inputmode: 'decimal', max: 10, placeholder: '15' }),
          field('Texto del botón', r, 'ctaLabel', { max: 40, placeholder: 'Reservar' }),
          h('span', { class: 'row-actions' }, moveBtns(sv.rooms, i, draw), h('button', { type: 'button', class: 'btn small danger', text: 'Quitar', onclick: function () { if (confirm('¿Quitar la habitación "' + (r.name || '') + '"?')) { sv.rooms.splice(i, 1); markDirty(); draw(); } } }))));
      });
      wrap.appendChild(h('button', { type: 'button', class: 'btn small', text: '+ Agregar tipo de habitación', onclick: function () { sv.rooms.push({ name: '', description: '', priceLow: '10', priceHigh: '15', ctaLabel: 'Reservar' }); markDirty(); draw(); } }));
    }
    draw(); return wrap;
  }
  function listSection(list, label, fields, blank, max) {
    var wrap = h('div');
    function draw() {
      wrap.textContent = '';
      list.forEach(function (it, i) {
        wrap.appendChild(card(label + ' ' + (i + 1), fields(it), h('span', { class: 'row-actions' }, moveBtns(list, i, draw),
          h('button', { type: 'button', class: 'btn small danger', text: 'Eliminar', onclick: function () { if (confirm('¿Eliminar este ' + label.toLowerCase() + '?')) { list.splice(i, 1); markDirty(); draw(); } } }))));
      });
      if (list.length < max) wrap.appendChild(h('button', { type: 'button', class: 'btn primary', text: '+ Agregar ' + label.toLowerCase(), onclick: function () { list.push(blank()); markDirty(); draw(); } }));
    }
    draw(); return wrap;
  }

  function save() {
    var b = document.getElementById('savebtn'); b.disabled = true; b.textContent = 'Guardando…';
    api('/admin/api/content', { content: state }).then(function (j) {
      state = j.content; dirty = false; render(); toast('¡Cambios guardados! Ya se ven en la página.', true);
    }).catch(function (e) { toast(e.message); }).then(function () { var b2 = document.getElementById('savebtn'); if (b2) { b2.disabled = false; b2.textContent = 'Guardar cambios'; } });
  }

  function render() {
    var y = window.scrollY;
    app.textContent = '';
    var nav = h('nav', { class: 'side' }, TABS.map(function (t) {
      return h('a', { href: '#' + t[0], class: tab === t[0] ? 'on' : '', onclick: function (e) { e.preventDefault(); tab = t[0]; history.replaceState(null, '', '#' + t[0]); render(); window.scrollTo(0, 0); } }, h('span', { text: t[2] }), t[1]);
    }));
    var top = h('header', { class: 'top' },
      h('div', { class: 'top-brand' }, h('span', { class: 'logo', text: '⛰' }), h('div', {}, h('strong', { text: 'Panel de administración' }), h('small', { text: 'Sesión: ' + app.dataset.user + ' · 👀 ' + formatVisits(visits) + ' visitas' }))),
      h('div', { class: 'top-actions' }, h('a', { class: 'btn small ghost', href: '/', target: '_blank', rel: 'noopener', text: 'Ver página ↗' }),
        h('button', { type: 'button', class: 'btn small ghost', text: 'Cerrar sesión', onclick: function () { if (!dirty || confirm('Tienes cambios sin guardar. ¿Salir igual?')) { dirty = false; document.getElementById('logout').submit(); } } })));
    var title = TABS.filter(function (t) { return t[0] === tab; })[0] || TABS[0];
    var main = h('main', { class: 'main' }, h('h2', { class: 'page-title', text: title[1] }), views[title[0]]());
    var bar = tab === 'seguridad' ? null : h('div', { class: 'savebar' }, h('span', { id: 'savestate', class: 'savestate' + (dirty ? ' warn' : ''), text: dirty ? 'Tienes cambios sin guardar' : 'Todo guardado' }),
      h('button', { id: 'savebtn', type: 'button', class: 'btn primary', text: 'Guardar cambios', onclick: save }));
    app.appendChild(top); app.appendChild(h('div', { class: 'layout' }, nav, h('div', { class: 'content' }, main, bar)));
    window.scrollTo(0, y);
  }
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  api('/admin/api/content').then(function (j) { state = j.content; icons = j.icons; iconSvg = j.iconSvg; if (typeof j.visits === 'number') visits = j.visits; render(); })
    .catch(function (e) { app.textContent = e.message; });
})();
