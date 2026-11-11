/* Bancos con número de cuenta: mostrar y copiar */
(function () {
  'use strict';
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
  document.querySelectorAll('.bank-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (panel) panel.hidden = open;
    });
  });
  document.querySelectorAll('.bank-copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var num = btn.getAttribute('data-copy') || '';
      copyText(num).then(function () {
        var prev = btn.textContent;
        btn.textContent = 'Copiado';
        setTimeout(function () { btn.textContent = prev; }, 1600);
      }).catch(function () {});
    });
  });
})();
