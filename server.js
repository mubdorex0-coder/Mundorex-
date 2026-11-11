'use strict';
/*
 * Página de Baños Turismo + panel de administración.
 * Solo usa módulos incluidos en Node.js (sin npm). Ejecutar: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = __dirname;
const CONTENT_FILE = path.join(ROOT, 'content.json');
const AUTH_FILE = path.join(ROOT, 'auth.json');
const UPLOADS = path.join(ROOT, 'uploads');
const PUBLIC = path.join(ROOT, 'public');
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_UPLOAD = 5 * 1024 * 1024;
const SETUP_CODE_FILE = path.join(ROOT, 'setup-code.txt');
const ENV_SETUP_CODE = String(process.env.SETUP_CODE || '').trim();
const SECURE_COOKIE = process.env.COOKIE_SECURE === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

/* ---------- utilidades ---------- */
const rand = (n) => crypto.randomBytes(n).toString('hex');
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}
function writeJsonAtomic(file, data) {
  const tmp = file + '.' + rand(4) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
/* código de instalación de un solo uso (para crear la cuenta del dueño) */
let setupCode = null;
function ensureSetupCode() {
  if (authExists()) return null;
  if (ENV_SETUP_CODE) return ENV_SETUP_CODE;
  if (setupCode) return setupCode;
  if (fs.existsSync(SETUP_CODE_FILE)) {
    const c = fs.readFileSync(SETUP_CODE_FILE, 'utf8').trim().toUpperCase();
    if (/^[A-Z2-7]{8,32}$/.test(c)) { setupCode = c; console.log(`Código de instalación (en setup-code.txt): ${c}`); return c; }
  }
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; const b = crypto.randomBytes(8);
  setupCode = Array.from(b, (x) => A[x & 31]).join('');
  fs.writeFileSync(SETUP_CODE_FILE, setupCode + '\n', { mode: 0o600 }); fs.chmodSync(SETUP_CODE_FILE, 0o600);
  console.log(`\n*** Código de instalación para crear la cuenta del dueño: ${setupCode} ***\n    (también guardado en ${SETUP_CODE_FILE})\n`);
  return setupCode;
}
function consumeSetupCode() { setupCode = null; try { fs.unlinkSync(SETUP_CODE_FILE); } catch {} }
const readContent = () => JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
const authExists = () => fs.existsSync(AUTH_FILE);
const readAuth = () => JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) { const parts = String(req.headers['x-forwarded-for']).split(',').map((x) => x.trim()).filter(Boolean); return parts[parts.length - 1] || req.socket.remoteAddress || 'unknown'; } // la última IP la agrega tu proxy
  return req.socket.remoteAddress || 'unknown';
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isHttps(req) { return SECURE_COOKIE || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https'; }
function cookie(req, name, value, maxAgeSec) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict`;
  if (maxAgeSec !== undefined) c += `; Max-Age=${maxAgeSec}`;
  if (isHttps(req)) c += '; Secure';
  return c;
}
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type || 'text/html; charset=utf-8' }, BASE_HEADERS, extra || {}));
  res.end(body);
}
const sendJson = (res, status, obj, extra) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', Object.assign({ 'Cache-Control': 'no-store' }, extra || {}));
const redirect = (res, loc, extra) => { res.writeHead(303, Object.assign({ Location: loc }, BASE_HEADERS, extra || {})); res.end(); };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too_large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function parseBody(req, limit) {
  const raw = await readBody(req, limit || 100 * 1024);
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) { try { return JSON.parse(raw || '{}'); } catch { return null; } }
  const o = {}; new URLSearchParams(raw).forEach((v, k) => { o[k] = v; }); return o;
}

/* ---------- contraseñas, sesiones y bloqueo ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scrypt = (pw, salt) => new Promise((res, rej) =>
  crypto.scrypt(String(pw), Buffer.from(salt, 'hex'), 64, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
async function makeHash(pw) { const salt = rand(16); return { salt, hash: (await scrypt(pw, salt)).toString('hex') }; }
async function checkPassword(username, pw) {
  if (!authExists()) return false;
  const a = readAuth();
  const k = await scrypt(pw, a.salt);
  const okPw = crypto.timingSafeEqual(k, Buffer.from(a.hash, 'hex'));
  const okUser = safeEqual(String(username).trim().toLowerCase(), a.username);
  return okPw && okUser;
}
const sessions = new Map(); // token -> {exp, csrf}
function newSession() { const t = rand(32); sessions.set(t, { exp: Date.now() + SESSION_MS, csrf: rand(32) }); return t; }
function getSession(req) {
  if (!authExists()) return null;
  const t = parseCookies(req).sid; if (!t) return null;
  const s = sessions.get(t);
  if (!s || s.exp < Date.now()) { sessions.delete(t); return null; }
  return Object.assign({ token: t }, s);
}
const attempts = new Map(); // ip -> {count, until}
function lockMinutes(ip) {
  const a = attempts.get(ip);
  return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 60000) : 0;
}
function registerFail(ip) {
  let a = attempts.get(ip);
  if (!a || (a.until && a.until <= Date.now())) a = { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) { a.until = Date.now() + LOCK_MS; a.count = 0; }
  attempts.set(ip, a);
}
setInterval(() => { const n = Date.now(); for (const [k, s] of sessions) if (s.exp < n) sessions.delete(k); }, 600000).unref();

/* ---------- iconos ---------- */
const ICONS = {
  transfer: { label: 'Banco / transferencia', svg: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 21 7H3z"/>' },
  card: { label: 'Tarjeta', svg: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>' },
  cash: { label: 'Efectivo', svg: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>' },
  wallet: { label: 'Billetera digital', svg: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>' },
  qr: { label: 'Código QR', svg: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1"/>' },
  phone: { label: 'Celular', svg: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>' },
  check: { label: 'Otro', svg: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>' },
};
const SOCIAL_ICONS = {
  facebook: { label: 'Facebook', svg: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>' },
  whatsapp: { label: 'WhatsApp', svg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/>' },
  youtube: { label: 'YouTube', svg: '<path d="M2.5 17a24.1 24.1 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.6 49.6 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.1 24.1 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.6 49.6 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>' },
  instagram: { label: 'Instagram', svg: '<rect width="20" height="20" x="2" y="2" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>' },
  tiktok: { label: 'TikTok', svg: '<path d="M9 12a4 4 0 1 0 4 4V2c.6 2.8 2.6 4.6 5.5 5"/>' },
};
const svgIcon = (inner, cls) => `<svg class="${cls || 'ico'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/* ---------- validación del contenido ---------- */
const IMG_RE = /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 300);
const bool = (v) => v === true || v === 'true' || v === 'on' || v === 1;
const img = (v) => (IMG_RE.test(String(v || '')) ? String(v) : '');
const color = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : d);
const digits = (v) => String(v || '').replace(/\D/g, '').slice(0, 15);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
function httpUrl(v) {
  const s = str(v, 500); if (!s) return '';
  try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null; } catch { return null; }
}
function sanitizeContent(c, errors) {
  c = c && typeof c === 'object' ? c : {};
  const g = c.general || {}, s = c.sections || {}, p = c.payments || {}, so = c.social || {};
  const url = (v, label) => { const u = httpUrl(v); if (u === null) { errors.push(`El enlace de ${label} no es válido (debe empezar con http:// o https://).`); return ''; } return u; };
  const out = {
    general: {
      businessName: str(g.businessName, 80), heroEyebrow: str(g.heroEyebrow, 120), heroTitle: str(g.heroTitle, 140),
      heroSubtitle: str(g.heroSubtitle, 400), heroCta: str(g.heroCta, 60), heroImage: img(g.heroImage),
      whatsapp: digits(g.whatsapp), whatsappMessage: str(g.whatsappMessage, 300),
      email: str(g.email, 120), phone: str(g.phone, 40), address: str(g.address, 200), footerText: str(g.footerText, 300),
      primaryColor: color(g.primaryColor, '#0e7c66'), accentColor: color(g.accentColor, '#f59e0b'),
      finalCtaTitle: str(g.finalCtaTitle, 140), finalCtaText: str(g.finalCtaText, 400), finalCtaButton: str(g.finalCtaButton, 60),
    },
    sections: {},
    services: [], benefits: [], products: [], testimonials: [],
    payments: { visible: bool(p.visible), methods: [], banks: [] },
    social: {},
  };
  ['servicesTitle', 'servicesSubtitle', 'benefitsTitle', 'benefitsSubtitle', 'productsTitle', 'productsSubtitle', 'testimonialsTitle', 'testimonialsNote', 'paymentsTitle', 'paymentsSubtitle', 'banksTitle', 'banksNote']
    .forEach((k) => { out.sections[k] = str(s[k], 300); });
  const prevServices = arr(c.services, 3);
  ['chivas', 'hospedajes', 'departamentos'].forEach((id) => {
    const sv = prevServices.find((x) => x && x.id === id) || {};
    const o = {
      id, title: str(sv.title, 100), description: str(sv.description, 800), image: img(sv.image),
      chips: arr(sv.chips, 12).map((x) => str(x, 40)).filter(Boolean),
      ctaLabel: str(sv.ctaLabel, 60), waMessage: str(sv.waMessage, 300), visible: bool(sv.visible), emoji: str(sv.emoji, 8),
    };
    if (id === 'hospedajes') {
      o.roomsTitle = str(sv.roomsTitle, 80);
      o.rooms = arr(sv.rooms, 20).map((r) => ({ name: str(r && r.name, 60), description: str(r && r.description, 300) })).filter((r) => r.name || r.description);
    }
    out.services.push(o);
  });
  out.benefits = arr(c.benefits, 8).map((b) => ({ icon: str(b && b.icon, 8), title: str(b && b.title, 80), text: str(b && b.text, 300) })).filter((b) => b.title || b.text);
  out.products = arr(c.products, 100).map((pr) => {
    pr = pr || {};
    const price = str(pr.price, 20).replace(',', '.');
    if (price && !/^\d{1,7}(\.\d{1,2})?$/.test(price)) errors.push(`El precio de "${str(pr.name, 60)}" no es válido (ejemplo: 25.00).`);
    return {
      id: /^[a-f0-9]{8,32}$/.test(String(pr.id || '')) ? pr.id : rand(6), name: str(pr.name, 100), description: str(pr.description, 300),
      price: /^\d{1,7}(\.\d{1,2})?$/.test(price) ? price : '', currency: str(pr.currency, 5).toUpperCase().replace(/[^A-Z]/g, '') || 'USD',
      image: img(pr.image), buyLabel: str(pr.buyLabel, 40) || 'Comprar', buyLink: url(pr.buyLink, `compra de "${str(pr.name, 60)}"`), soldOut: bool(pr.soldOut),
    };
  }).filter((pr) => pr.name);
  out.testimonials = arr(c.testimonials, 20).map((t) => ({ name: str(t && t.name, 80), place: str(t && t.place, 80), text: str(t && t.text, 500), example: bool(t && t.example) })).filter((t) => t.text);
  out.payments.methods = arr(p.methods, 20).map((m) => ({ icon: ICONS[m && m.icon] ? m.icon : 'check', name: str(m && m.name, 60), note: str(m && m.note, 200) })).filter((m) => m.name);
  out.payments.banks = arr(p.banks, 30).map((b) => ({ name: str(b && b.name, 60), active: bool(b && b.active) })).filter((b) => b.name);
  Object.keys(SOCIAL_ICONS).forEach((k) => {
    let v = str(so[k], 500);
    if (k === 'whatsapp' && v && /^[+\d\s()-]+$/.test(v)) v = digits(v) ? 'https://wa.me/' + digits(v) : '';
    out.social[k] = url(v, SOCIAL_ICONS[k].label);
  });
  return out;
}
function imagesIn(c) {
  const set = new Set(); const walk = (v) => {
    if (typeof v === 'string') { if (IMG_RE.test(v)) set.add(path.basename(v)); } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  }; walk(c); return set;
}

/* ---------- página pública ---------- */
const waLink = (num, msg) => (num ? `https://wa.me/${num}?text=${encodeURIComponent(msg || '')}` : '#contacto');
const fmtPrice = (p, cur) => (p ? (cur === 'USD' ? `$${Number(p).toFixed(2)} USD` : `${Number(p).toFixed(2)} ${cur}`) : '');
const EXT = ' target="_blank" rel="noopener noreferrer"';
function renderPublic(c) {
  const g = c.general, s = c.sections, wa = g.whatsapp;
  const phoneDigits = String(g.phone || '').replace(/\D/g, '');
  const telHref = phoneDigits.startsWith('0') ? '+593' + phoneDigits.slice(1) : phoneDigits;
  const pageTitle = g.heroTitle === g.businessName ? g.businessName : `${g.businessName} · ${g.heroTitle}`;
  const services = c.services.filter((x) => x.visible);
  const svcHtml = services.map((sv, i) => `
  <article class="service ${i % 2 ? 'rev' : ''}" id="svc-${esc(sv.id)}">
    <div class="service-media">${sv.image ? `<img src="${esc(sv.image)}" alt="${esc(sv.title)}" loading="lazy">` : `<div class="ph ph-${esc(sv.id)}"><span>${esc(sv.emoji || '★')}</span></div>`}</div>
    <div class="service-body">
      <h3>${esc(sv.title)}</h3>
      <p>${esc(sv.description)}</p>
      ${sv.chips.length ? `<ul class="chips">${sv.chips.map((ch) => `<li>${esc(ch)}</li>`).join('')}</ul>` : ''}
      ${sv.rooms && sv.rooms.length ? `<h4 class="rooms-title">${esc(sv.roomsTitle || 'Tipos de habitación')}</h4>
      <div class="rooms">${sv.rooms.map((r) => `<div class="room"><strong>${esc(r.name)}</strong><span>${esc(r.description)}</span></div>`).join('')}</div>` : ''}
      <a class="btn btn-primary" href="${esc(waLink(wa, sv.waMessage))}"${wa ? EXT : ''}>${esc(sv.ctaLabel || 'Escríbenos')}</a>
    </div>
  </article>`).join('');
  const products = c.products.map((pr) => {
    const price = fmtPrice(pr.price, pr.currency);
    const href = pr.buyLink || waLink(wa, `Hola, quiero comprar: ${pr.name}${price ? ` (${price})` : ''}`);
    return `<article class="product ${pr.soldOut ? 'sold' : ''}">
      <div class="product-media">${pr.image ? `<img src="${esc(pr.image)}" alt="${esc(pr.name)}" loading="lazy">` : '<div class="ph ph-product"><span>🛍️</span></div>'}${pr.soldOut ? '<span class="badge-sold">Agotado</span>' : ''}</div>
      <div class="product-body"><h3>${esc(pr.name)}</h3><p>${esc(pr.description)}</p>
      <div class="product-foot"><span class="price">${esc(price)}</span>
      ${pr.soldOut ? '<button class="btn btn-disabled" disabled>Agotado</button>' : `<a class="btn btn-accent" href="${esc(href)}"${EXT}>${esc(pr.buyLabel)}</a>`}</div></div>
    </article>`;
  }).join('');
  const banks = c.payments.banks.filter((b) => b.active);
  const socials = Object.keys(SOCIAL_ICONS).filter((k) => c.social[k])
    .map((k) => `<a class="social" href="${esc(c.social[k])}"${EXT} aria-label="${SOCIAL_ICONS[k].label}" title="${SOCIAL_ICONS[k].label}">${svgIcon(SOCIAL_ICONS[k].svg)}</a>`).join('');
  const heroStyle = g.heroImage ? ` style="--hero-img:url('${esc(g.heroImage)}')"` : '';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(g.heroSubtitle)}">
<link rel="stylesheet" href="/style.css">
<style>:root{--primary:${g.primaryColor};--accent:${g.accentColor}}</style>
</head><body>
<header class="nav"><div class="wrap nav-in">
  <a class="brand" href="#inicio"><span class="brand-mark">⛰</span>${esc(g.businessName)}</a>
  <input type="checkbox" id="menu" class="menu-cb" aria-label="Abrir menú"><label for="menu" class="menu-btn" aria-hidden="true"><span></span><span></span><span></span></label>
  <nav class="links"><a href="#servicios">Servicios</a><a href="#productos">Productos</a>${c.payments.visible ? '<a href="#pagos">Pagos</a>' : ''}<a href="#contacto">Contacto</a>
  <a class="btn btn-wa btn-sm" href="${esc(waLink(wa, g.whatsappMessage))}"${wa ? EXT : ''}>WhatsApp</a>
  <a class="btn btn-login btn-sm" href="/admin">Iniciar sesión</a></nav>
</div></header>
<main id="inicio">
<section class="hero ${g.heroImage ? 'has-img' : ''}"${heroStyle}><div class="wrap hero-in">
  ${g.heroEyebrow ? `<p class="eyebrow">${esc(g.heroEyebrow)}</p>` : ''}
  <h1>${esc(g.heroTitle)}</h1>
  <p class="lead">${esc(g.heroSubtitle)}</p>
  <div class="hero-cta"><a class="btn btn-wa btn-lg" href="${esc(waLink(wa, g.whatsappMessage))}"${wa ? EXT : ''}>${svgIcon(SOCIAL_ICONS.whatsapp.svg)} ${esc(g.heroCta || 'Escríbenos por WhatsApp')}</a>
  <a class="btn btn-ghost btn-lg" href="#servicios">Ver servicios</a></div>
</div><svg class="hero-mtn" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0 120V70l120-30 140 45 170-70 160 60 130-40 200 55 160-75 180 70 180-35v100z"/></svg></section>

<section class="section" id="servicios"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.servicesTitle)}</h2><p>${esc(s.servicesSubtitle)}</p></div>
  ${svcHtml}
</div></section>

${c.benefits.length ? `<section class="section alt" id="beneficios"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.benefitsTitle)}</h2><p>${esc(s.benefitsSubtitle)}</p></div>
  <div class="grid g4">${c.benefits.map((b) => `<div class="card benefit"><span class="b-ico">${esc(b.icon)}</span><h3>${esc(b.title)}</h3><p>${esc(b.text)}</p></div>`).join('')}</div>
</div></section>` : ''}

<section class="section" id="productos"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.productsTitle)}</h2><p>${esc(s.productsSubtitle)}</p></div>
  ${products ? `<div class="grid g3">${products}</div>` : '<p class="empty">Pronto agregaremos productos.</p>'}
</div></section>

${c.testimonials.length ? `<section class="section alt" id="testimonios"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.testimonialsTitle)}</h2>${s.testimonialsNote ? `<p class="note">${esc(s.testimonialsNote)}</p>` : ''}</div>
  <div class="grid g3">${c.testimonials.map((t) => `<figure class="card testi">${t.example ? '<span class="tag">Ejemplo</span>' : ''}<blockquote>“${esc(t.text)}”</blockquote><figcaption><strong>${esc(t.name)}</strong>${t.place ? ` · ${esc(t.place)}` : ''}</figcaption></figure>`).join('')}</div>
</div></section>` : ''}

${c.payments.visible ? `<section class="section" id="pagos"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.paymentsTitle)}</h2><p>${esc(s.paymentsSubtitle)}</p></div>
  <div class="grid g5">${c.payments.methods.map((m) => `<div class="card pay">${svgIcon((ICONS[m.icon] || ICONS.check).svg, 'pay-ico')}<h3>${esc(m.name)}</h3>${m.note ? `<p>${esc(m.note)}</p>` : ''}</div>`).join('')}</div>
  ${banks.length ? `<div class="banks"><h3>${esc(s.banksTitle || 'Bancos aceptados')}</h3><ul>${banks.map((b) => `<li>${svgIcon(ICONS.transfer.svg)}${esc(b.name)}</li>`).join('')}</ul>${s.banksNote ? `<p class="note">${esc(s.banksNote)}</p>` : ''}</div>` : ''}
</div></section>` : ''}

<section class="final-cta"><div class="wrap">
  <h2>${esc(g.finalCtaTitle)}</h2><p>${esc(g.finalCtaText)}</p>
  <a class="btn btn-wa btn-lg" href="${esc(waLink(wa, g.whatsappMessage))}"${wa ? EXT : ''}>${svgIcon(SOCIAL_ICONS.whatsapp.svg)} ${esc(g.finalCtaButton || 'Escríbenos')}</a>
</div></section>
</main>
<footer class="footer" id="contacto"><div class="wrap foot-in">
  <div><div class="brand foot-brand"><span class="brand-mark">⛰</span>${esc(g.businessName)}</div><p>${esc(g.footerText)}</p>${socials ? `<div class="socials">${socials}</div>` : ''}</div>
  <div><h4>Contacto</h4><ul class="contact">
    ${g.whatsapp ? `<li>WhatsApp: <a href="${esc(waLink(wa, g.whatsappMessage))}"${EXT}>+${esc(g.whatsapp)}</a></li>` : ''}
    ${g.phone ? `<li>Teléfono: <a href="tel:${esc(telHref)}">${esc(g.phone)}</a></li>` : ''}
    ${g.email ? `<li>Correo: <a href="mailto:${esc(g.email)}">${esc(g.email)}</a></li>` : ''}
    ${g.address ? `<li>Dirección: ${esc(g.address)}</li>` : ''}
  </ul></div>
  <div><h4>Enlaces</h4><ul class="contact"><li><a href="#servicios">Servicios</a></li><li><a href="#productos">Productos</a></li>${c.payments.visible ? '<li><a href="#pagos">Métodos de pago</a></li>' : ''}<li><a class="foot-login" href="/admin">Iniciar sesión</a></li></ul></div>
</div><div class="wrap copy">© ${new Date().getFullYear()} ${esc(g.businessName)}. Todos los derechos reservados.</div></footer>
${wa ? `<a class="wa-float" href="${esc(waLink(wa, g.whatsappMessage))}"${EXT} aria-label="Escríbenos por WhatsApp">${svgIcon(SOCIAL_ICONS.whatsapp.svg)}<span>WhatsApp</span></a>` : ''}
</body></html>`;
}

/* ---------- páginas de administración ---------- */
function adminShell(title, body, extraHead) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="stylesheet" href="/admin.css">${extraHead || ''}</head><body>${body}</body></html>`;
}
function authPage(kind, csrf, msg, ok) {
  const setup = kind === 'setup';
  const body = `<main class="auth"><form class="auth-card" method="post" action="/admin/${setup ? 'setup' : 'login'}" autocomplete="on">
  <div class="auth-logo">⛰</div>
  <h1>${setup ? 'Crear cuenta de dueño' : 'Panel de administración'}</h1>
  <p class="muted">${setup ? 'Es la primera vez que entras. Crea tu usuario y contraseña: solo tú podrás entrar a editar la página.' : 'Ingresa con tu usuario y contraseña.'}</p>
  ${msg ? `<div class="alert ${ok ? 'ok' : 'err'}">${esc(msg)}</div>` : ''}
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  ${setup ? '<label><span>Código de instalación <small>(está en el archivo setup-code.txt del servidor o en la consola donde lo iniciaste)</small></span><input name="setupCode" required maxlength="40" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false"></label>' : ''}
  <label>Usuario<input name="username" required minlength="3" maxlength="40" autocomplete="username" autocapitalize="none"></label>
  <label><span>Contraseña${setup ? ' <small>(mínimo 8 caracteres)</small>' : ''}</span><input name="password" type="password" required ${setup ? 'minlength="8"' : ''} autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
  ${setup ? '<label>Confirmar contraseña<input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>' : ''}
  <button class="btn primary block" type="submit">${setup ? 'Crear cuenta y entrar' : 'Entrar'}</button>
  <p class="muted small"><a href="/">← Volver a la página</a></p>
</form></main>`;
  return adminShell(setup ? 'Crear cuenta de dueño' : 'Iniciar sesión', body);
}
function panelPage(sess) {
  const a = readAuth();
  return adminShell('Panel de administración', `<div id="app" data-user="${esc(a.username)}"><p class="loading">Cargando panel…</p></div>
<form id="logout" method="post" action="/admin/logout" hidden><input type="hidden" name="csrf" value="${esc(sess.csrf)}"></form>
<script src="/admin.js" defer></script>`, `<meta name="csrf" content="${esc(sess.csrf)}">`);
}
function preCsrf(req, res) {
  let t = parseCookies(req).pcsrf;
  const headers = {};
  if (!t || !/^[a-f0-9]{64}$/.test(t)) { t = rand(32); headers['Set-Cookie'] = cookie(req, 'pcsrf', t, 3600); }
  return { t, headers };
}
function sameOrigin(req) {
  const o = req.headers.origin; if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

/* ---------- archivos estáticos ---------- */
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' };
function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'No encontrado', 'text/plain; charset=utf-8');
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache }, BASE_HEADERS));
    fs.createReadStream(file).pipe(res);
  });
}
function detectImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 6 && (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a')) return 'gif';
  if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}
function cleanupUploads(keep) {
  // borra archivos subidos sin usar hace más de 1 hora
  fs.readdir(UPLOADS, (e, files) => {
    if (e) return;
    files.forEach((f) => {
      if (!/^[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(f) || keep.has(f)) return;
      const fp = path.join(UPLOADS, f);
      fs.stat(fp, (er, st) => { if (!er && Date.now() - st.mtimeMs > 3600e3) fs.unlink(fp, () => {}); });
    });
  });
}

/* ---------- servidor ---------- */
async function handle(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname; const m = req.method;
  const ip = clientIp(req);

  if (m === 'GET' && (p === '/' || p === '/index.html')) {
    let c; try { c = sanitizeContent(readContent(), []); } catch (e) { return send(res, 500, 'Error leyendo content.json', 'text/plain; charset=utf-8'); }
    return send(res, 200, renderPublic(c), null, { 'Cache-Control': 'no-cache' });
  }
  if (m === 'GET' && p.startsWith('/uploads/')) {
    const name = p.slice(9);
    if (!/^[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(name)) return send(res, 404, 'No encontrado', 'text/plain; charset=utf-8');
    return serveFile(res, path.join(UPLOADS, name), 'public, max-age=86400');
  }
  if (m === 'GET' && /^\/[a-z0-9_-]+\.(css|js|svg|png|ico)$/i.test(p)) {
    return serveFile(res, path.join(PUBLIC, path.basename(p)), 'no-cache');
  }

  /* --- admin --- */
  if (p === '/admin' || p === '/admin/') {
    if (m !== 'GET') return send(res, 405, 'Método no permitido', 'text/plain; charset=utf-8');
    const sess = getSession(req);
    if (sess) return send(res, 200, panelPage(sess), null, { 'Cache-Control': 'no-store' });
    if (!authExists()) ensureSetupCode();
    const { t, headers } = preCsrf(req, res);
    const msg = u.searchParams.get('m');
    const MSGS = { bad: 'Usuario o contraseña incorrectos.', lock: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.', out: 'Cerraste sesión.', exp: 'La página expiró. Inténtalo otra vez.', pw: 'Contraseña cambiada. Ingresa con tu nueva contraseña.', exists: 'La cuenta de dueño ya existe. Inicia sesión.', mismatch: 'Las contraseñas no coinciden.', short: 'La contraseña debe tener al menos 8 caracteres y el usuario al menos 3.', key: 'El código de instalación no es correcto.' };
    return send(res, 200, authPage(authExists() ? 'login' : 'setup', t, MSGS[msg] || '', msg === 'out' || msg === 'pw'), null, Object.assign({ 'Cache-Control': 'no-store' }, headers));
  }
  if (m === 'POST' && (p === '/admin/setup' || p === '/admin/login')) {
    if (!sameOrigin(req)) return send(res, 403, 'Origen no permitido', 'text/plain; charset=utf-8');
    const body = await parseBody(req);
    if (!body || !safeEqual(body.csrf || '', parseCookies(req).pcsrf || '')) return redirect(res, '/admin?m=exp');
    if (p === '/admin/setup') {
      if (authExists()) return redirect(res, '/admin?m=exists');
      if (lockMinutes(ip)) return redirect(res, '/admin?m=lock');
      const code = ensureSetupCode();
      if (!code || !safeEqual(String(body.setupCode || '').trim().toUpperCase(), code.toUpperCase())) { registerFail(ip); return redirect(res, lockMinutes(ip) ? '/admin?m=lock' : '/admin?m=key'); }
      const user = String(body.username || '').trim().toLowerCase();
      const pw = String(body.password || '');
      if (user.length < 3 || user.length > 40 || pw.length < 8 || pw.length > 200) return redirect(res, '/admin?m=short');
      if (pw !== String(body.confirm || '')) return redirect(res, '/admin?m=mismatch');
      const h = await makeHash(pw);
      if (authExists()) return redirect(res, '/admin?m=exists');
      fs.writeFileSync(AUTH_FILE, JSON.stringify({ username: user, salt: h.salt, hash: h.hash, created: new Date().toISOString() }, null, 2), { mode: 0o600, flag: 'wx' });
      attempts.delete(ip); consumeSetupCode();
      return redirect(res, '/admin', { 'Set-Cookie': [cookie(req, 'sid', newSession(), SESSION_MS / 1000), cookie(req, 'pcsrf', '', 0)] });
    }
    if (!authExists()) return redirect(res, '/admin');
    if (lockMinutes(ip)) return redirect(res, '/admin?m=lock');
    const ok = await checkPassword(body.username || '', String(body.password || '').slice(0, 200));
    if (!ok) { registerFail(ip); return redirect(res, lockMinutes(ip) ? '/admin?m=lock' : '/admin?m=bad'); }
    attempts.delete(ip);
    return redirect(res, '/admin', { 'Set-Cookie': [cookie(req, 'sid', newSession(), SESSION_MS / 1000), cookie(req, 'pcsrf', '', 0)] });
  }
  if (m === 'POST' && p === '/admin/logout') {
    const sess = getSession(req); const body = await parseBody(req);
    if (sess && body && safeEqual(body.csrf || '', sess.csrf)) sessions.delete(sess.token);
    else if (sess) return send(res, 403, 'Token CSRF inválido', 'text/plain; charset=utf-8');
    return redirect(res, '/admin?m=out', { 'Set-Cookie': cookie(req, 'sid', '', 0) });
  }
  if (p.startsWith('/admin/api/')) {
    const sess = getSession(req);
    if (!sess) return sendJson(res, 401, { error: 'Tu sesión expiró. Vuelve a iniciar sesión.' });
    if (m === 'GET' && p === '/admin/api/content') {
      return sendJson(res, 200, { content: sanitizeContent(readContent(), []), icons: Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v.label])), iconSvg: Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v.svg])) });
    }
    if (m !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
    if (!sameOrigin(req) || !safeEqual(req.headers['x-csrf-token'] || '', sess.csrf)) return sendJson(res, 403, { error: 'Token de seguridad inválido. Recarga la página.' });

    if (p === '/admin/api/content') {
      const body = await parseBody(req, 2 * 1024 * 1024);
      if (!body || !body.content) return sendJson(res, 400, { error: 'Datos inválidos.' });
      const errors = [];
      const clean = sanitizeContent(body.content, errors);
      if (errors.length) return sendJson(res, 400, { error: errors.join(' ') });
      const old = readContent();
      writeJsonAtomic(CONTENT_FILE, clean);
      const keep = imagesIn(clean);
      imagesIn(old).forEach((f) => { if (!keep.has(f)) fs.unlink(path.join(UPLOADS, f), () => {}); });
      cleanupUploads(keep);
      return sendJson(res, 200, { ok: true, content: clean });
    }
    if (p === '/admin/api/upload') {
      const body = await parseBody(req, Math.ceil(MAX_UPLOAD * 1.4) + 4096);
      const mt = body && /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(body.data || ''));
      if (!mt) return sendJson(res, 400, { error: 'Solo se permiten imágenes JPG, PNG, WEBP o GIF.' });
      const buf = Buffer.from(mt[2], 'base64');
      if (buf.length > MAX_UPLOAD) return sendJson(res, 413, { error: 'La imagen supera los 5 MB.' });
      const ext = detectImage(buf);
      if (!ext) return sendJson(res, 400, { error: 'El archivo no es una imagen válida.' });
      const name = rand(16) + '.' + ext;
      fs.writeFileSync(path.join(UPLOADS, name), buf, { flag: 'wx' });
      return sendJson(res, 200, { ok: true, url: '/uploads/' + name });
    }
    if (p === '/admin/api/password') {
      const body = await parseBody(req);
      if (!body) return sendJson(res, 400, { error: 'Datos inválidos.' });
      if (lockMinutes(ip)) return sendJson(res, 429, { error: `Demasiados intentos fallidos. Espera ${lockMinutes(ip)} minutos.` });
      const a = readAuth();
      const k = await scrypt(String(body.current || '').slice(0, 200), a.salt);
      if (!crypto.timingSafeEqual(k, Buffer.from(a.hash, 'hex'))) {
        registerFail(ip);
        return sendJson(res, 400, { error: lockMinutes(ip) ? 'Demasiados intentos fallidos. Espera 15 minutos.' : 'La contraseña actual no es correcta.' });
      }
      const nw = String(body.next || '');
      if (nw.length < 8 || nw.length > 200) return sendJson(res, 400, { error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      if (nw !== String(body.confirm || '')) return sendJson(res, 400, { error: 'Las contraseñas nuevas no coinciden.' });
      attempts.delete(ip);
      const h = await makeHash(nw);
      writeJsonAtomic(AUTH_FILE, Object.assign(a, { salt: h.salt, hash: h.hash, changed: new Date().toISOString() }));
      for (const t of sessions.keys()) if (t !== sess.token) sessions.delete(t);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: 'No encontrado' });
  }
  return send(res, 404, '<!doctype html><meta charset="utf-8"><title>No encontrado</title><p style="font-family:sans-serif">Página no encontrada. <a href="/">Volver al inicio</a></p>');
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (res.headersSent) return res.end();
    if (e && e.code === 413) return sendJson(res, 413, { error: 'El archivo o los datos son demasiado grandes.' });
    console.error(e);
    send(res, 500, 'Error interno', 'text/plain; charset=utf-8');
  });
}).listen(PORT, () => { ensureSetupCode(); console.log(`Página lista en http://localhost:${PORT}  ·  Panel: http://localhost:${PORT}/admin`); });
