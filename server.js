'use strict';
/*
 * Página de Baños Turismo + panel de administración.
 * Solo usa módulos incluidos en Node.js (sin npm). Ejecutar: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '3000', 10);
function assetVersion() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return sha || String(Date.now());
  } catch { return String(Date.now()); }
}
const ASSET_V = assetVersion();
const ROOT = __dirname;
const CONTENT_FILE = path.join(ROOT, 'content.json');
const AUTH_FILE = path.join(ROOT, 'auth.json');
const UPLOADS = path.join(ROOT, 'uploads');
const PUBLIC = path.join(ROOT, 'public');
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_UPLOAD = 5 * 1024 * 1024;
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

/* ---------- visitas ---------- */
const VISITS_FILE = path.join(ROOT, 'visits.json');
let visitCount = 0;
let visitTimer = null;
let visitDirty = false;
function loadVisits() {
  try {
    const n = Number(JSON.parse(fs.readFileSync(VISITS_FILE, 'utf8')).count);
    visitCount = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch { visitCount = 0; }
}
function flushVisits() {
  if (visitTimer) { clearTimeout(visitTimer); visitTimer = null; }
  if (!visitDirty) return;
  visitDirty = false;
  try { writeJsonAtomic(VISITS_FILE, { count: visitCount }); }
  catch (e) { console.error(e); visitDirty = true; }
}
function scheduleVisitWrite() {
  visitDirty = true;
  if (visitTimer) return;
  visitTimer = setTimeout(flushVisits, 1500);
  if (visitTimer.unref) visitTimer.unref();
}
loadVisits();
const formatVisits = (n) => String(Math.max(0, Math.floor(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const isBotUa = (ua) => /bot|crawler|spider/i.test(String(ua || ''));
function noteVisit(req) {
  if (isBotUa(req.headers['user-agent'])) return false;
  if (parseCookies(req).vst) return false;
  visitCount += 1;
  scheduleVisitWrite();
  return true;
}
process.on('SIGTERM', () => { flushVisits(); process.exit(0); });
process.on('SIGINT', () => { flushVisits(); process.exit(0); });

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
    services: [], benefits: [], products: [], testimonials: [], promotions: [],
    payments: { visible: bool(p.visible), cardFeePercent: feePercent(p.cardFeePercent), methods: [], banks: [] },
    social: {},
  };
  ['servicesTitle', 'servicesSubtitle', 'benefitsTitle', 'benefitsSubtitle', 'productsTitle', 'productsSubtitle', 'packagesTitle', 'packagesSubtitle', 'promosTitle', 'promosSubtitle', 'socialTitle', 'testimonialsTitle', 'testimonialsNote', 'paymentsTitle', 'paymentsSubtitle', 'banksTitle', 'banksNote']
    .forEach((k) => { out.sections[k] = str(s[k], 300); });
  const prevServices = arr(c.services, 3);
  ['chivas', 'hospedajes', 'departamentos'].forEach((id) => {
    const sv = prevServices.find((x) => x && x.id === id) || {};
    const o = {
      id, title: str(sv.title, 100), description: str(sv.description, 800), image: img(sv.image),
      chips: arr(sv.chips, 12).map((x) => str(x, 40)).filter(Boolean),
      ctaLabel: str(sv.ctaLabel, 60), waMessage: str(sv.waMessage, 300), visible: bool(sv.visible), emoji: str(sv.emoji, 8),
    };
    if (id === 'hospedajes' || id === 'departamentos') {
      o.available = sv.available == null || sv.available === '' ? true : bool(sv.available);
      o.units = roomUnits(sv.units);
    }
    if (id === 'hospedajes') {
      o.roomsTitle = str(sv.roomsTitle, 80);
      const vehicle = roomPrice(sv.vehiclePrice);
      o.vehiclePrice = vehicle === '' ? '5' : vehicle;
      o.rooms = arr(sv.rooms, 20).map((r) => ({
        name: str(r && r.name, 80),
        description: str(r && r.description, 300),
        priceLow: roomPrice(r && r.priceLow),
        priceHigh: roomPrice(r && r.priceHigh),
        ctaLabel: str(r && r.ctaLabel, 40) || 'Reservar',
        available: !r || r.available == null || r.available === '' ? true : bool(r.available),
        units: roomUnits(r && r.units),
      })).filter((r) => r.name);
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
  out.promotions = arr(c.promotions, 30).map((p) => ({ title: str(p && p.title, 120), text: str(p && p.text, 400) })).filter((p) => p.title || p.text);
  out.payments.methods = arr(p.methods, 20).map((m) => ({ icon: ICONS[m && m.icon] ? m.icon : 'check', name: str(m && m.name, 60), note: str(m && m.note, 200) })).filter((m) => m.name);
  out.payments.banks = arr(p.banks, 30).map((b) => ({ name: str(b && b.name, 60), active: bool(b && b.active), accountNumber: str(b && b.accountNumber, 40).replace(/\D/g, '') })).filter((b) => b.name);
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
const isStoreLink = (link) => {
  if (!link) return false;
  try {
    const host = new URL(link).hostname.replace(/^www\./, '');
    return host !== 'wa.me' && host !== 'api.whatsapp.com' && host !== 'whatsapp.com';
  } catch { return true; }
};
function feePercent(v) {
  if (v == null || v === '') return 15;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) return 15;
  return Math.round(n * 100) / 100;
}
function priceCents(price) {
  const m = String(price || '').match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}
function moneyUSD(cents) { return `$${(cents / 100).toFixed(2)}`; }
function roomPrice(v) {
  const s = str(v == null ? '' : v, 20).replace(',', '.');
  if (!s) return '';
  return /^\d{1,7}(\.\d{1,2})?$/.test(s) ? s : '';
}
function unitLabel(v) {
  const cents = priceCents(v);
  if (cents == null) return '';
  return cents % 100 === 0 ? `$${cents / 100}` : moneyUSD(cents);
}
function roomUnits(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 9999) return null;
  return n;
}
function lodgingOpen(item) {
  if (!item || item.available === false) return false;
  if (item.units === 0) return false;
  return true;
}
function lodgingSoldOut(name) {
  try {
    const c = sanitizeContent(readContent(), []);
    const items = [];
    (c.services || []).forEach((sv) => {
      if (sv.id === 'hospedajes' || sv.id === 'departamentos') items.push(sv);
      (sv.rooms || []).forEach((r) => items.push(r));
    });
    const item = items.find((x) => x && (x.name === name || x.title === name));
    return !!item && !lodgingOpen(item);
  } catch { return false; }
}
function availBadge(item) {
  if (!lodgingOpen(item)) return '<span class="avail no">Agotada</span>';
  if (item.units != null) return `<span class="avail ok">Disponible: ${item.units}</span>`;
  return '<span class="avail ok">Disponible</span>';
}
function consultBtn(wa, name) {
  const href = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`Hola, quiero consultar disponibilidad de ${name}`)}` : '#contacto';
  return `<a class="btn btn-consult" href="${esc(href)}"${wa ? EXT : ''}>Consultar disponibilidad</a>`;
}
const fmtPrice = (p, cur) => (p ? (cur === 'USD' ? `$${Number(p).toFixed(2)} USD` : `${Number(p).toFixed(2)} ${cur}`) : '');
const EXT = ' target="_blank" rel="noopener noreferrer"';
function renderPublic(c) {
  const g = c.general, s = c.sections, wa = g.whatsapp;
  const phoneDigits = String(g.phone || '').replace(/\D/g, '');
  const telHref = phoneDigits.startsWith('0') ? '+593' + phoneDigits.slice(1) : phoneDigits;
  const pageTitle = g.heroTitle === g.businessName ? g.businessName : `${g.businessName} · ${g.heroTitle}`;
  const services = c.services.filter((x) => x.visible);
  const feePct = feePercent(c.payments.cardFeePercent);
  const stay = c.services.find((x) => x.id === 'hospedajes') || {};
  const stayRooms = stay.rooms || [];
  const vehiclePrice = stay.vehiclePrice != null && stay.vehiclePrice !== '' ? stay.vehiclePrice : '5';
  const roomBook = (r, i) => {
    const low = unitLabel(r.priceLow);
    const high = unitLabel(r.priceHigh);
    const priceLine = [low && `Temporada baja: ${low} por persona`, high && `Temporada alta: ${high} por persona`].filter(Boolean).join(' · ');
    const open = lodgingOpen(r);
    const reserve = open
      ? `<button type="button" class="btn btn-accent buy-open" data-room="1" data-room-index="${i}" data-name="${esc(r.name)}" data-price="${esc(priceLine)}" data-vehicle="${esc(String(vehiclePrice))}" data-fee-pct="${esc(String(feePct))}" data-wa="${esc(wa)}">${esc(r.ctaLabel || 'Reservar')}</button>`
      : '<button type="button" class="btn btn-disabled" disabled>Agotada</button>';
    return `${availBadge(r)}<div class="room-actions">${open ? consultBtn(wa, r.name) : ''}${reserve}</div>`;
  };
  const roomCards = stayRooms.map((r, i) => {
    const low = unitLabel(r.priceLow);
    const high = unitLabel(r.priceHigh);
    return `<article class="room-card">
      <h3>${esc(r.name)}</h3>
      ${r.description ? `<p>${esc(r.description)}</p>` : ''}
      <p class="room-rate">${low ? `Temporada baja: ${esc(low)} por persona` : 'Temporada baja: Consultar precio'}</p>
      <p class="room-rate">${high ? `Temporada alta: ${esc(high)} por persona` : 'Temporada alta: Consultar precio'}</p>
      ${roomBook(r, i)}
    </article>`;
  }).join('');
  const roomGrid = roomCards ? `<div class="room-grid" aria-label="Tipos de habitación">${roomCards}</div>` : '';
  const roomOptions = stayRooms.map((r, i) => {
    const open = lodgingOpen(r);
    return `<option value="${i}" data-low="${esc(r.priceLow)}" data-high="${esc(r.priceHigh)}" data-available="${open ? '1' : '0'}"${open ? '' : ' disabled'}>${esc(r.name)}${open ? '' : ' (Agotada)'}</option>`;
  }).join('');
  const byId = (id) => c.services.find((x) => x.id === id && x.visible);
  const chiva = byId('chivas');
  const depto = byId('departamentos');
  const packageCards = [
    chiva ? `<article class="card package"><h3>${esc(chiva.emoji || '')} ${esc(chiva.title)}</h3><p>${esc(chiva.description)}</p><a class="btn btn-primary" href="#svc-${esc(chiva.id)}">${esc(chiva.ctaLabel || 'Ver tour')}</a></article>` : '',
    ...stayRooms.map((r, i) => {
      const low = unitLabel(r.priceLow);
      const high = unitLabel(r.priceHigh);
      return `<article class="card package"><h3>${esc(r.name)}</h3>${r.description ? `<p>${esc(r.description)}</p>` : ''}<p class="room-rate">${low ? `Temporada baja: ${esc(low)} por persona` : 'Temporada baja: Consultar precio'}</p><p class="room-rate">${high ? `Temporada alta: ${esc(high)} por persona` : 'Temporada alta: Consultar precio'}</p>${roomBook(r, i)}</article>`;
    }),
    depto ? `<article class="card package"><h3>${esc(depto.emoji || '')} ${esc(depto.title)}</h3><p>${esc(depto.description)}</p>${availBadge(depto)}<div class="room-actions">${lodgingOpen(depto) ? consultBtn(wa, depto.title) : ''}${lodgingOpen(depto) ? `<button type="button" class="btn btn-primary buy-open" data-room="1" data-room-pick="1" data-name="${esc(depto.title)}" data-price="" data-vehicle="${esc(String(vehiclePrice))}" data-fee-pct="${esc(String(feePct))}" data-wa="${esc(wa)}">${esc(depto.ctaLabel || 'Reservar')}</button>` : '<button type="button" class="btn btn-disabled" disabled>Agotada</button>'}</div></article>` : '',
  ].filter(Boolean).join('');
  const svcHtml = services.map((sv, i) => {
    const lodging = sv.id === 'hospedajes' || sv.id === 'departamentos';
    const lodgingOpenNow = lodging && lodgingOpen(sv);
    const reserveLodging = (sv.id === 'departamentos' || sv.id === 'hospedajes')
      ? `<button type="button" class="btn btn-primary buy-open" data-room="1" data-room-pick="1" data-name="${esc(sv.title)}" data-price="" data-vehicle="${esc(String(vehiclePrice))}" data-fee-pct="${esc(String(feePct))}" data-wa="${esc(wa)}">${esc(sv.id === 'hospedajes' ? 'Reservar' : (sv.ctaLabel || 'Reservar'))}</button>`
      : `<a class="btn btn-primary" href="${esc(waLink(wa, sv.waMessage))}"${wa ? EXT : ''}>${esc(sv.ctaLabel || 'Escríbenos')}</a>`;
    const lodgingPick = lodging
      ? `<div class="room-actions">${availBadge(sv)}${lodgingOpenNow ? consultBtn(wa, sv.title) : ''}${lodgingOpenNow ? reserveLodging : '<button type="button" class="btn btn-disabled" disabled>Agotada</button>'}</div>`
      : reserveLodging;
    return `
  <article class="service ${i % 2 ? 'rev' : ''}" id="svc-${esc(sv.id)}">
    <div class="service-media">${sv.image ? `<img src="${esc(sv.image)}" alt="${esc(sv.title)}" loading="lazy">` : `<div class="ph ph-${esc(sv.id)}"><span>${esc(sv.emoji || '★')}</span></div>`}</div>
    <div class="service-body">
      <h3>${esc(sv.title)}</h3>
      <p>${esc(sv.description)}</p>
      ${sv.chips.length ? `<ul class="chips">${sv.chips.map((ch) => `<li>${esc(ch)}</li>`).join('')}</ul>` : ''}
      ${lodgingPick}
    </div>
  </article>${sv.id === 'hospedajes' ? roomGrid : ''}`;
  }).join('');
  const products = c.products.map((pr) => {
    const price = fmtPrice(pr.price, pr.currency);
    const cents = priceCents(pr.price);
    const feeCents = cents == null ? null : Math.round(cents * feePct / 100);
    const totalCents = cents == null ? null : cents + feeCents;
    const baseMoney = cents == null ? '' : moneyUSD(cents);
    const feeMoney = feeCents == null ? '' : moneyUSD(feeCents);
    const totalMoney = totalCents == null ? '' : moneyUSD(totalCents);
    const proof = waLink(wa, `Hola, ya pagué ${pr.name}${price ? ` (${price})` : ''}. Te envío el comprobante.`);
    const proofCard = waLink(wa, `Hola, ya pagué ${pr.name}. Total a pagar con tarjeta: ${totalMoney || price || ''}. Te envío el comprobante.`);
    const buy = pr.soldOut
      ? '<button class="btn btn-disabled" disabled>Agotado</button>'
      : (isStoreLink(pr.buyLink)
        ? `<a class="btn btn-accent" href="${esc(pr.buyLink)}"${EXT}>${esc(pr.buyLabel)}</a>`
        : `<button type="button" class="btn btn-accent buy-open" data-name="${esc(pr.name)}" data-price="${esc(price)}" data-proof="${esc(proof)}" data-proof-card="${esc(proofCard)}" data-base="${esc(baseMoney)}" data-fee-amt="${esc(feeMoney)}" data-total="${esc(totalMoney)}" data-fee-pct="${esc(String(feePct))}" data-wa="${esc(wa)}">${esc(pr.buyLabel)}</button>`);
    return `<article class="product ${pr.soldOut ? 'sold' : ''}">
      <div class="product-media">${pr.image ? `<img src="${esc(pr.image)}" alt="${esc(pr.name)}" loading="lazy">` : '<div class="ph ph-product"><span>🛍️</span></div>'}${pr.soldOut ? '<span class="badge-sold">Agotado</span>' : ''}</div>
      <div class="product-body"><h3>${esc(pr.name)}</h3><p>${esc(pr.description)}</p>
      <div class="product-foot"><span class="price">${esc(price)}</span>
      ${buy}</div></div>
    </article>`;
  }).join('');
  const banks = c.payments.banks.filter((b) => b.active);
  const bankHtml = banks.map((b, i) => {
    const num = String(b.accountNumber || '').trim();
    if (!num) return `<li>${svgIcon(ICONS.transfer.svg)}${esc(b.name)}</li>`;
    const id = `bank-acct-${i}`;
    return `<li class="bank-has"><button type="button" class="bank-toggle" aria-expanded="false" aria-controls="${id}">${svgIcon(ICONS.transfer.svg)}<span>${esc(b.name)}</span></button><div class="bank-acct" id="${id}" hidden><span class="bank-num">${esc(num)}</span><button type="button" class="bank-copy" data-copy="${esc(num)}">Copiar</button></div></li>`;
  }).join('');
  const pichincha = banks.find((b) => /pichincha/i.test(b.name));
  const cardAcct = (pichincha && pichincha.accountNumber) || '2213461121';
  const payBankOpts = banks.map((b) => {
    const num = String(b.accountNumber || '').trim();
    const detail = num
      ? `<div class="bank-acct"><span class="bank-num">${esc(num)}</span><button type="button" class="bank-copy" data-copy="${esc(num)}">Copiar</button></div>`
      : '<p>Pide el número de cuenta por WhatsApp</p>';
    return `<div class="pay-choice" role="button" tabindex="0" data-method="${esc(b.name)}">${svgIcon(ICONS.transfer.svg)}<div><strong>${esc(b.name)}</strong>${detail}</div></div>`;
  }).join('');
  const payModal = `<div class="pay-modal" id="pay-modal" hidden>
  <div class="pay-backdrop" data-close-modal></div>
  <div class="pay-dialog" role="dialog" aria-modal="true" aria-labelledby="pay-title pay-price" tabindex="-1">
    <button type="button" class="pay-x" data-close-modal aria-label="Cerrar">×</button>
    <h2 id="pay-title"></h2>
    <p id="pay-hello" class="pay-age-note" hidden></p>
    <p class="pay-price" id="pay-price"></p>
    <div id="pay-room" hidden>
      <label class="pay-field">Tipo de habitación
        <select id="pay-room-type"><option value="">Elige el tipo de habitación</option>${roomOptions}</select>
      </label>
      <label class="pay-field">Temporada
        <select id="pay-season"><option value="">Elige la temporada</option><option value="baja">Temporada baja</option><option value="alta">Temporada alta</option></select>
      </label>
      <div class="pay-field-row">
        <label class="pay-field">Adultos y niños de 5 años en adelante
          <input id="pay-adults" type="number" min="1" inputmode="numeric" autocomplete="off">
        </label>
        <label class="pay-field">Niños menores de 5 años (no pagan)
          <input id="pay-kids" type="number" min="0" inputmode="numeric" autocomplete="off">
        </label>
        <label class="pay-field">Número de vehículos
          <input id="pay-vehicles" type="number" min="0" inputmode="numeric" autocomplete="off">
        </label>
      </div>
      <p class="pay-age-note">Niños menores de 5 años no pagan. Desde los 5 años pagan como adulto.</p>
      <p id="pay-room-error" class="pay-room-error" hidden></p>
      <ul id="pay-room-math" class="pay-card-math" hidden></ul>
    </div>
    <div class="pay-choices">${payBankOpts}<div class="pay-choice pay-choice-card" role="button" tabindex="0" data-method="Tarjeta de crédito"><button type="button" class="pay-card-btn" aria-expanded="false" aria-controls="pay-card-panel">${svgIcon(ICONS.card.svg)}<span>Tarjeta de crédito</span></button></div></div>
    <div id="pay-card-panel" class="pay-card-panel" hidden>
      <ul class="pay-card-math">
        <li>Precio: <strong id="pay-card-base"></strong></li>
        <li>Comisión tarjeta (<span id="pay-card-pct">${esc(String(feePct))}</span>%): <strong id="pay-card-fee"></strong></li>
        <li>Total a pagar: <strong id="pay-card-total"></strong></li>
      </ul>
      <p>Paga desde tu tarjeta o app del Banco Pichincha a la cuenta ${esc(cardAcct)}</p>
      <div class="pay-opt"><div><strong>Banco Pichincha</strong><div class="bank-acct"><span class="bank-num">${esc(cardAcct)}</span><button type="button" class="bank-copy" data-copy="${esc(cardAcct)}">Copiar</button></div></div></div>
    </div>
    <div id="pay-receipt" hidden>
      <label class="pay-field" for="pay-file">Sube tu comprobante de pago
        <input id="pay-file" type="file" accept="image/*,application/pdf">
      </label>
      <p class="pay-age-note">Imagen o PDF, máximo 5 MB. Al terminar de subir se abre WhatsApp con el mensaje listo.</p>
      <img id="pay-preview" alt="Vista previa del comprobante" hidden>
      <p id="pay-file-name" class="pay-age-note" hidden></p>
      <p id="pay-receipt-status" class="pay-receipt-ok" hidden></p>
      <button type="button" class="btn btn-wa" id="pay-share" hidden>Compartir comprobante por WhatsApp</button>
      <a class="btn btn-secondary pay-proof" id="pay-proof" href="#contacto" hidden>Abrir WhatsApp</a>
    </div>
  </div>
</div>`;
  const socials = Object.keys(SOCIAL_ICONS).filter((k) => c.social[k])
    .map((k) => `<a class="social" href="${esc(c.social[k])}"${EXT} aria-label="${SOCIAL_ICONS[k].label}" title="${SOCIAL_ICONS[k].label}">${svgIcon(SOCIAL_ICONS[k].svg)}</a>`).join('');
  const heroUrl = g.heroImage || '/img/cascada-noche-2.jpg';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(g.heroSubtitle)}">
<link rel="stylesheet" href="/style.css?v=${ASSET_V}">
<style>:root{--primary:${g.primaryColor};--accent:${g.accentColor}}</style>
</head><body>
<div class="page-bg" aria-hidden="true"><div class="page-bg-slide a"></div><div class="page-bg-slide b"></div><div class="page-bg-shade"></div><canvas id="mist"></canvas></div>
<header class="nav"><div class="wrap nav-in">
  <a class="brand" href="#inicio"><span class="brand-mark">⛰</span>${esc(g.businessName)}</a>
  <nav class="links" aria-label="Secciones"><a href="#inicio">Inicio</a><a href="#catalogo">Catálogo</a><a href="#paquetes">Paquetes</a><a href="#promociones">Promociones</a><a href="#comentarios">Comentarios</a><a href="#redes">Redes sociales</a>
  <a class="btn btn-wa btn-sm" href="${esc(wa ? `https://wa.me/${wa}` : '#contacto')}"${wa ? EXT : ''}>Escríbenos por WhatsApp</a>
  <a class="btn btn-login btn-sm" href="/admin">Iniciar sesión</a></nav>
</div></header>
<main id="inicio">
<section class="hero" style="--hero-img:url('${esc(heroUrl)}')"><div class="wrap hero-in">
  ${g.heroEyebrow ? `<p class="eyebrow">${esc(g.heroEyebrow)}</p>` : ''}
  <h1>${esc(g.heroTitle)}</h1>
  <p class="lead">${esc(g.heroSubtitle)}</p>
  <div class="hero-cta"><a class="btn btn-wa btn-lg" href="${esc(waLink(wa, g.whatsappMessage))}"${wa ? EXT : ''}>${svgIcon(SOCIAL_ICONS.whatsapp.svg)} ${esc(g.heroCta || 'Escríbenos por WhatsApp')}</a>
  <a class="btn btn-ghost btn-lg" href="#servicios">Ver servicios</a>
  <nav class="hero-pills" aria-label="Secciones del inicio"><a href="#inicio">Inicio</a><a href="#catalogo">Catálogo</a><a href="#paquetes">Paquetes</a><a href="#promociones">Promociones</a><a href="#comentarios">Comentarios</a><a href="#redes">Redes sociales</a></nav></div>
  <p class="visit-pill">👀 ${formatVisits(visitCount)} visitas</p>
</div><svg class="hero-mtn" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0 120V70l120-30 140 45 170-70 160 60 130-40 200 55 160-75 180 70 180-35v100z"/></svg></section>

<section class="section" id="comentarios"><div class="wrap">
  <div class="sec-head"><h2>Comentarios</h2><p>Regístrate para reservar paquetes y dejar tu comentario. Reservar también se puede sin cuenta.</p></div>
  <div id="comment-guest" class="comment-auth">
    <button type="button" class="btn btn-primary" id="comment-register-btn">Regístrate</button>
    <button type="button" class="btn btn-login" id="comment-login-btn">Iniciar sesión</button>
    <form id="comment-register" class="comment-form" hidden>
      <label>Nombre<input name="name" required minlength="2" maxlength="80" autocomplete="name"></label>
      <label>Usuario <small>(o deja el correo)</small><input name="username" maxlength="40" autocomplete="username" autocapitalize="none"></label>
      <label>Correo <small>(o deja el usuario)</small><input name="email" type="email" maxlength="120" autocomplete="email"></label>
      <label>Contraseña<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <label>Confirmar contraseña<input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn btn-primary" type="submit">Regístrate</button>
      <p class="comment-msg" role="status"></p>
    </form>
    <form id="comment-login" class="comment-form" hidden>
      <label>Usuario o correo<input name="login" required maxlength="120" autocomplete="username" autocapitalize="none"></label>
      <label>Contraseña<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn btn-primary" type="submit">Iniciar sesión</button>
      <p class="comment-msg" role="status"></p>
    </form>
  </div>
  <div id="comment-user" class="comment-auth" hidden>
    <p>Hola, <strong id="comment-hello"></strong></p>
    <form id="comment-form" class="comment-form">
      <label>Tu comentario<textarea name="text" required maxlength="500" rows="3"></textarea></label>
      <label>Estrellas <small>(opcional)</small>
        <select name="stars"><option value="">Sin estrellas</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
      </label>
      <button class="btn btn-accent" type="submit">Publicar</button>
      <p class="comment-msg" role="status"></p>
    </form>
    <button type="button" class="btn btn-login" id="comment-logout">Cerrar sesión</button>
  </div>
  <div id="comment-list" class="comment-list"></div>
</div></section>

<section class="section" id="servicios"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.servicesTitle)}</h2><p>${esc(s.servicesSubtitle)}</p></div>
  ${svcHtml}
</div></section>

${c.benefits.length ? `<section class="section alt" id="beneficios"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.benefitsTitle)}</h2><p>${esc(s.benefitsSubtitle)}</p></div>
  <div class="grid g4">${c.benefits.map((b) => `<div class="card benefit"><span class="b-ico">${esc(b.icon)}</span><h3>${esc(b.title)}</h3><p>${esc(b.text)}</p></div>`).join('')}</div>
</div></section>` : ''}

<section class="section" id="paquetes"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.packagesTitle || 'Paquetes')}</h2><p>${esc(s.packagesSubtitle || '')}</p></div>
  ${packageCards ? `<div class="grid g3">${packageCards}</div>` : '<p class="empty">Pronto agregaremos paquetes.</p>'}
</div></section>

<section class="section" id="catalogo"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.productsTitle)}</h2><p>${esc(s.productsSubtitle)}</p></div>
  ${products ? `<div class="grid g3">${products}</div>` : '<p class="empty">Pronto agregaremos productos.</p>'}
</div></section>

<section class="section alt" id="promociones"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.promosTitle || 'Promociones')}</h2><p>${esc(s.promosSubtitle || '')}</p></div>
  ${(c.promotions || []).length ? `<div class="grid g3">${c.promotions.map((p) => `<article class="card promo"><h3>${esc(p.title)}</h3>${p.text ? `<p>${esc(p.text)}</p>` : ''}</article>`).join('')}</div>` : '<p class="empty">No hay promociones por ahora.</p>'}
</div></section>

${c.testimonials.length ? `<section class="section alt" id="testimonios"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.testimonialsTitle)}</h2>${s.testimonialsNote ? `<p class="note">${esc(s.testimonialsNote)}</p>` : ''}</div>
  <div class="grid g3">${c.testimonials.map((t) => `<figure class="card testi">${t.example ? '<span class="tag">Ejemplo</span>' : ''}<blockquote>“${esc(t.text)}”</blockquote><figcaption><strong>${esc(t.name)}</strong>${t.place ? ` · ${esc(t.place)}` : ''}</figcaption></figure>`).join('')}</div>
</div></section>` : ''}

${c.payments.visible ? `<section class="section" id="pagos"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.paymentsTitle)}</h2><p>${esc(s.paymentsSubtitle)}</p></div>
  <div class="grid g5">${c.payments.methods.map((m) => `<div class="card pay">${svgIcon((ICONS[m.icon] || ICONS.check).svg, 'pay-ico')}<h3>${esc(m.name)}</h3>${m.note ? `<p>${esc(m.note)}</p>` : ''}</div>`).join('')}</div>
  ${banks.length ? `<div class="banks"><h3>${esc(s.banksTitle || 'Bancos aceptados')}</h3><ul>${bankHtml}</ul>${s.banksNote ? `<p class="note">${esc(s.banksNote)}</p>` : ''}</div>` : ''}
</div></section>` : ''}

<section class="final-cta"><div class="wrap">
  <h2>${esc(g.finalCtaTitle)}</h2><p>${esc(g.finalCtaText)}</p>
  <a class="btn btn-wa btn-lg" href="${esc(waLink(wa, g.whatsappMessage))}"${wa ? EXT : ''}>${svgIcon(SOCIAL_ICONS.whatsapp.svg)} ${esc(g.finalCtaButton || 'Escríbenos')}</a>
</div></section>
<section class="section" id="redes"><div class="wrap">
  <div class="sec-head"><h2>${esc(s.socialTitle || 'Redes sociales')}</h2><p>Síguenos y escríbenos.</p></div>
  ${socials ? `<div class="socials socials-block">${socials}</div>` : '<p class="empty">Pronto publicaremos nuestras redes.</p>'}
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
  <div><h4>Enlaces</h4><ul class="contact"><li><a href="#inicio">Inicio</a></li><li><a href="#catalogo">Catálogo</a></li><li><a href="#paquetes">Paquetes</a></li><li><a href="#promociones">Promociones</a></li><li><a href="#comentarios">Comentarios</a></li><li><a href="#redes">Redes sociales</a></li><li><a class="foot-login" href="/admin">Iniciar sesión</a></li></ul></div>
</div><div class="wrap copy">© ${new Date().getFullYear()} ${esc(g.businessName)}. Todos los derechos reservados.</div></footer>
${wa ? `<a class="wa-float" href="${esc(waLink(wa, g.whatsappMessage))}"${EXT} aria-label="Escríbenos por WhatsApp">${svgIcon(SOCIAL_ICONS.whatsapp.svg)}<span>WhatsApp</span></a>` : ''}
${payModal}
<script src="/site.js?v=${ASSET_V}" defer></script>
</body></html>`;
}

/* ---------- páginas de administración ---------- */
function adminShell(title, body, extraHead) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="stylesheet" href="/admin.css?v=${ASSET_V}">${extraHead || ''}</head><body>${body}</body></html>`;
}
const OAUTH_ICONS = {
  google: '<svg class="oauth-ico" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.7-6.7 7.1l6.3 5.3C37.4 38.4 44 33 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>',
  facebook: '<svg class="oauth-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H8v3h2v7h3v-7h2.6l.4-3H13v-2c0-.6.4-1 1-1z"/></svg>',
  x: '<svg class="oauth-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.5 3h3.1l-6.8 7.8L22 21h-6.2l-4.8-6.3L5.7 21H2.6l7.3-8.4L2 3h6.3l4.4 5.8L17.5 3zm-1.1 16.2h1.7L7.7 4.7H5.9l10.5 14.5z"/></svg>',
};
function oauthLoginHtml() {
  const rows = [
    ['google', 'Google', process.env.GOOGLE_CLIENT_ID],
    ['facebook', 'Facebook', process.env.FACEBOOK_APP_ID],
    ['x', 'X', process.env.X_CLIENT_ID],
  ].filter((r) => String(r[2] || '').trim());
  if (!rows.length) return '';
  return `<div class="oauth-box"><p class="muted small">O entra con</p>${rows.map(([id, label]) => `<a class="btn oauth ${id} block" href="/auth/${id}">${OAUTH_ICONS[id]} Continuar con ${label}</a>`).join('')}</div>`;
}
function authPage(kind, csrf, msg, ok) {
  const setup = kind === 'setup';
  const body = `<main class="auth"><form class="auth-card" method="post" action="/admin/${setup ? 'setup' : 'login'}" autocomplete="on">
  <div class="auth-logo">⛰</div>
  <h1>${setup ? 'Crear cuenta de dueño' : 'Panel de administración'}</h1>
  <p class="muted">${setup ? 'Es la primera vez que entras. Crea tu usuario y contraseña: solo tú podrás entrar a editar la página.' : 'Ingresa con tu usuario y contraseña.'}</p>
  ${msg ? `<div class="alert ${ok ? 'ok' : 'err'}">${esc(msg)}</div>` : ''}
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  <label>Usuario<input name="username" required minlength="3" maxlength="40" autocomplete="username" autocapitalize="none"></label>
  <label><span>Contraseña${setup ? ' <small>(mínimo 8 caracteres)</small>' : ''}</span><input name="password" type="password" required ${setup ? 'minlength="8"' : ''} autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
  ${setup ? '<label>Confirmar contraseña<input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>' : ''}
  <button class="btn primary block" type="submit">${setup ? 'Crear cuenta y entrar' : 'Entrar'}</button>
  ${setup ? '' : oauthLoginHtml()}
  <p class="muted small"><a href="/">← Volver a la página</a></p>
</form></main>`;
  return adminShell(setup ? 'Crear cuenta de dueño' : 'Iniciar sesión', body);
}
function panelPage(sess) {
  const a = readAuth();
  return adminShell('Panel de administración', `<div id="app" data-user="${esc(a.username)}" data-visits="${visitCount}"><p class="loading">Cargando panel…</p></div>
<form id="logout" method="post" action="/admin/logout" hidden><input type="hidden" name="csrf" value="${esc(sess.csrf)}"></form>
<script src="/admin.js?v=${ASSET_V}" defer></script>`, `<meta name="csrf" content="${esc(sess.csrf)}">`);
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
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };
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
  if (buf.length > 4 && buf.slice(0, 4).toString('ascii') === '%PDF') return 'pdf';
  return null;
}
const CUSTOMERS_FILE = path.join(ROOT, 'customers.json');
const COMMENTS_FILE = path.join(ROOT, 'comments.json');
const customerSessions = new Map();
function readCustomers() { try { const d = JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; } }
function readComments() { try { const d = JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; } }
function customerFromReq(req) {
  const t = parseCookies(req).cid;
  if (!t) return null;
  const s = customerSessions.get(t);
  if (!s || s.exp < Date.now()) { customerSessions.delete(t); return null; }
  return readCustomers().find((c) => c.id === s.id) || null;
}
function ownerUsername() {
  try { return authExists() ? String(readAuth().username || '').trim().toLowerCase() : ''; } catch { return ''; }
}
function reservedCustomerName(user) {
  const u = String(user || '').trim().toLowerCase();
  if (!u) return false;
  if (u === 'admin') return true;
  const owner = ownerUsername();
  return !!owner && u === owner;
}
function customerCookie(req, token) { return cookie(req, 'cid', token, token ? SESSION_MS / 1000 : 0); }
const RECEIPTS_FILE = path.join(ROOT, 'comprobantes.json');
const RECEIPT_DIR = path.join(UPLOADS, 'comprobantes');
const receiptHits = new Map();
function readReceipts() {
  try {
    const data = JSON.parse(fs.readFileSync(RECEIPTS_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function addReceipt(entry) {
  const list = readReceipts();
  list.unshift(entry);
  writeJsonAtomic(RECEIPTS_FILE, list.slice(0, 300));
}
function receiptLimited(ip) {
  const now = Date.now();
  const prev = (receiptHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (prev.length >= 8) { receiptHits.set(ip, prev); return true; }
  prev.push(now);
  receiptHits.set(ip, prev);
  return false;
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

/* ---------- inicio de sesión social (OAuth 2.0) ---------- */
const PUBLIC_URL = String(process.env.PUBLIC_URL || 'https://mundorex.onrender.com').replace(/\/+$/, '');
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || 'mariobropvp0@gmail.com').trim().toLowerCase();
const oauthRedirect = (provider) => `${PUBLIC_URL}/auth/${provider}/callback`;
function oauthClient(provider) {
  if (provider === 'google') return { id: String(process.env.GOOGLE_CLIENT_ID || '').trim(), secret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim() };
  if (provider === 'facebook') return { id: String(process.env.FACEBOOK_APP_ID || '').trim(), secret: String(process.env.FACEBOOK_APP_SECRET || '').trim() };
  if (provider === 'x') return { id: String(process.env.X_CLIENT_ID || '').trim(), secret: String(process.env.X_CLIENT_SECRET || '').trim() };
  return { id: '', secret: '' };
}
function oauthCookie(req, value, maxAgeSec) {
  let c = `oauth=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (maxAgeSec !== undefined) c += `; Max-Age=${maxAgeSec}`;
  if (isHttps(req)) c += '; Secure';
  return c;
}
function readOauthCookie(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (!o || !o.p || !o.s || !o.t || Date.now() - Number(o.t) > 10 * 60 * 1000) return null;
    return o;
  } catch { return null; }
}
function makePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
function oauthAuthorizeUrl(provider, state, challenge) {
  const cfg = oauthClient(provider);
  const redirectUri = oauthRedirect(provider);
  if (provider === 'google') {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', cfg.id);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('state', state);
    u.searchParams.set('prompt', 'select_account');
    return u.href;
  }
  if (provider === 'facebook') {
    const u = new URL('https://www.facebook.com/v27.0/dialog/oauth');
    u.searchParams.set('client_id', cfg.id);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'email');
    u.searchParams.set('state', state);
    return u.href;
  }
  const u = new URL('https://twitter.com/i/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.id);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', 'users.read tweet.read');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.href;
}
async function fetchJson(url, opts) {
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(12000) }, opts || {}));
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok || !data) throw new Error('oauth_http_' + res.status);
  return data;
}
async function postForm(url, body, headers) {
  return fetchJson(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, headers || {}),
    body: new URLSearchParams(body).toString(),
  });
}
async function ownerFromProvider(provider, code, verifier) {
  const cfg = oauthClient(provider);
  if (!cfg.id || !cfg.secret) throw new Error('oauth_secret');
  const redirectUri = oauthRedirect(provider);
  if (provider === 'google') {
    const tok = await postForm('https://oauth2.googleapis.com/token', {
      code, client_id: cfg.id, client_secret: cfg.secret, redirect_uri: redirectUri, grant_type: 'authorization_code',
    });
    const info = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token } });
    const email = String(info.email || '').trim().toLowerCase();
    const verified = info.email_verified === true || info.email_verified === 'true';
    return verified && email === OWNER_EMAIL;
  }
  if (provider === 'facebook') {
    const tokenUrl = new URL('https://graph.facebook.com/v27.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', cfg.id);
    tokenUrl.searchParams.set('client_secret', cfg.secret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);
    const tok = await fetchJson(tokenUrl);
    const meUrl = new URL('https://graph.facebook.com/v27.0/me');
    meUrl.searchParams.set('fields', 'id,email');
    meUrl.searchParams.set('access_token', tok.access_token);
    const me = await fetchJson(meUrl);
    return String(me.email || '').trim().toLowerCase() === OWNER_EMAIL;
  }
  const basic = Buffer.from(`${cfg.id}:${cfg.secret}`).toString('base64');
  const tok = await postForm('https://api.twitter.com/2/oauth2/token', {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: cfg.id,
  }, { Authorization: 'Basic ' + basic });
  const me = await fetchJson('https://api.twitter.com/2/users/me', { headers: { Authorization: 'Bearer ' + tok.access_token } });
  const username = String(me.data && me.data.username || '').trim().replace(/^@/, '').toLowerCase();
  const want = String(process.env.OWNER_X_USERNAME || '').trim().replace(/^@/, '').toLowerCase();
  return !!want && username === want;
}
async function handleOAuthCallback(req, res, urlObj, provider) {
  const clear = oauthCookie(req, '', 0);
  if (urlObj.searchParams.get('error')) return redirect(res, '/admin?m=oauth', { 'Set-Cookie': clear });
  const code = String(urlObj.searchParams.get('code') || '');
  const state = String(urlObj.searchParams.get('state') || '');
  const saved = readOauthCookie(parseCookies(req).oauth);
  if (!code || !saved || saved.p !== provider || !safeEqual(saved.s, state)) return redirect(res, '/admin?m=state', { 'Set-Cookie': clear });
  if (!authExists()) return redirect(res, '/admin?m=noaccount', { 'Set-Cookie': clear });
  let allowed = false;
  try { allowed = await ownerFromProvider(provider, code, saved.v || ''); }
  catch (e) { console.error('oauth', provider, e && e.message); return redirect(res, '/admin?m=oauth', { 'Set-Cookie': clear }); }
  if (!allowed) return redirect(res, '/admin?m=noauth', { 'Set-Cookie': clear });
  return redirect(res, '/admin', { 'Set-Cookie': [cookie(req, 'sid', newSession(), SESSION_MS / 1000), cookie(req, 'pcsrf', '', 0), clear] });
}

/* ---------- servidor ---------- */
async function handle(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname; const m = req.method;
  const ip = clientIp(req);

  if (m === 'GET' && (p === '/' || p === '/index.html')) {
    let c; try { c = sanitizeContent(readContent(), []); } catch (e) { return send(res, 500, 'Error leyendo content.json', 'text/plain; charset=utf-8'); }
    const extra = { 'Cache-Control': 'no-cache' };
    if (p === '/' && noteVisit(req)) extra['Set-Cookie'] = cookie(req, 'vst', '1', 30 * 60);
    return send(res, 200, renderPublic(c), null, extra);
  }
  if (m === 'GET' && p.startsWith('/uploads/')) {
    const rel = p.slice(9);
    if (/^comprobantes\/[a-f0-9]{32}\.(jpg|png|webp|gif|pdf)$/.test(rel)) return serveFile(res, path.join(UPLOADS, 'comprobantes', path.basename(rel)), 'public, max-age=86400');
    if (!/^[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(rel)) return send(res, 404, 'No encontrado', 'text/plain; charset=utf-8');
    return serveFile(res, path.join(UPLOADS, rel), 'public, max-age=86400');
  }
  if (m === 'POST' && p === '/api/comprobante') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Origen no permitido.' });
    if (receiptLimited(ip)) return sendJson(res, 429, { error: 'Demasiados comprobantes. Espera unos minutos e inténtalo de nuevo.' });
    const body = await parseBody(req, Math.ceil(MAX_UPLOAD * 1.4) + 8192);
    const mt = body && /^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(body.data || ''));
    if (!mt) return sendJson(res, 400, { error: 'Sube una imagen (JPG, PNG, WEBP o GIF) o un PDF.' });
    const buf = Buffer.from(mt[2], 'base64');
    if (!buf.length || buf.length > MAX_UPLOAD) return sendJson(res, 413, { error: 'El comprobante supera los 5 MB.' });
    const ext = detectImage(buf);
    if (!ext) return sendJson(res, 400, { error: 'El archivo no es una imagen o un PDF válido.' });
    if ((mt[1] === 'application/pdf') !== (ext === 'pdf')) return sendJson(res, 400, { error: 'El tipo del archivo no coincide con su contenido.' });
    if (!fs.existsSync(RECEIPT_DIR)) fs.mkdirSync(RECEIPT_DIR, { recursive: true });
    const name = rand(16) + '.' + ext;
    fs.writeFileSync(path.join(RECEIPT_DIR, name), buf, { flag: 'wx' });
    const url = `${PUBLIC_URL}/uploads/comprobantes/${name}`;
    const product = str(body.product, 140);
    const total = str(body.total, 40);
    const method = str(body.method, 80);
    if (lodgingSoldOut(product)) return sendJson(res, 400, { error: 'Esa habitación está agotada.' });
    addReceipt({ id: rand(8), date: new Date().toISOString(), product, total, method, url });
    return sendJson(res, 200, { ok: true, url });
  }
  if (p === '/cuenta' && m === 'GET') return redirect(res, '/#comentarios');
  if (p === '/api/comentarios' && m === 'GET') {
    const me = customerFromReq(req);
    const comments = readComments().map((c) => ({ name: c.name, text: c.text, stars: c.stars || 0, date: c.date }));
    return sendJson(res, 200, { comments, user: me ? { name: me.name } : null });
  }
  if (p === '/api/comentarios/registro' && m === 'POST') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Origen no permitido.' });
    const body = await parseBody(req);
    const name = str(body && body.name, 80);
    const email = str(body && body.email, 120).toLowerCase();
    const username = str(body && body.username, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');
    const pw = String(body && body.password || '');
    const confirm = String(body && body.confirm || '');
    if (name.length < 2) return sendJson(res, 400, { error: 'Escribe tu nombre.' });
    if (!email && username.length < 3) return sendJson(res, 400, { error: 'Indica un usuario o un correo.' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJson(res, 400, { error: 'El correo no es válido.' });
    if (username && username.length < 3) return sendJson(res, 400, { error: 'El usuario debe tener al menos 3 caracteres.' });
    if (reservedCustomerName(username) || reservedCustomerName(email.split('@')[0])) return sendJson(res, 400, { error: 'Ese usuario no está disponible.' });
    if (pw.length < 8 || pw !== confirm) return sendJson(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres y coincidir con la confirmación.' });
    const customers = readCustomers();
    if ((email && customers.some((c) => c.email === email)) || (username && customers.some((c) => c.username === username))) return sendJson(res, 400, { error: 'Esa cuenta ya está registrada. Inicia sesión.' });
    const h = await makeHash(pw);
    const id = rand(8);
    customers.push({ id, name, email, username, salt: h.salt, hash: h.hash, created: new Date().toISOString() });
    writeJsonAtomic(CUSTOMERS_FILE, customers);
    const token = rand(32);
    customerSessions.set(token, { id, exp: Date.now() + SESSION_MS });
    return sendJson(res, 200, { ok: true, name }, { 'Set-Cookie': customerCookie(req, token) });
  }
  if (p === '/api/comentarios/login' && m === 'POST') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Origen no permitido.' });
    const body = await parseBody(req);
    const login = str(body && body.login, 120).toLowerCase();
    const user = readCustomers().find((c) => c.email === login || c.username === login);
    let ok = false;
    if (user) {
      const k = await scrypt(String(body && body.password || '').slice(0, 200), user.salt);
      ok = crypto.timingSafeEqual(k, Buffer.from(user.hash, 'hex'));
    }
    if (!ok) return sendJson(res, 400, { error: 'Usuario o contraseña incorrectos.' });
    const token = rand(32);
    customerSessions.set(token, { id: user.id, exp: Date.now() + SESSION_MS });
    return sendJson(res, 200, { ok: true, name: user.name }, { 'Set-Cookie': customerCookie(req, token) });
  }
  if (p === '/api/comentarios/logout' && m === 'POST') {
    const t = parseCookies(req).cid;
    if (t) customerSessions.delete(t);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': customerCookie(req, '') });
  }
  if (p === '/api/comentarios' && m === 'POST') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Origen no permitido.' });
    const me = customerFromReq(req);
    if (!me) return sendJson(res, 401, { error: 'Inicia sesión para comentar.' });
    const body = await parseBody(req);
    const text = str(body && body.text, 500);
    const stars = Math.round(Number(body && body.stars));
    if (text.length < 2) return sendJson(res, 400, { error: 'Escribe un comentario.' });
    const comments = readComments();
    comments.unshift({ id: rand(8), name: me.name, text, stars: stars >= 1 && stars <= 5 ? stars : 0, date: new Date().toISOString() });
    writeJsonAtomic(COMMENTS_FILE, comments.slice(0, 200));
    return sendJson(res, 200, { ok: true });
  }
  if (m === 'GET' && /^\/img\/[a-z0-9_-]+\.jpg$/i.test(p)) {
    return serveFile(res, path.join(PUBLIC, 'img', path.basename(p)), 'public, max-age=86400');
  }
  if (m === 'GET' && /^\/[a-z0-9_-]+\.(css|js|svg|png|ico)$/i.test(p)) {
    return serveFile(res, path.join(PUBLIC, path.basename(p)), 'no-cache');
  }

  /* --- admin --- */
  if (p === '/admin' || p === '/admin/') {
    if (m !== 'GET') return send(res, 405, 'Método no permitido', 'text/plain; charset=utf-8');
    const sess = getSession(req);
    if (sess) return send(res, 200, panelPage(sess), null, { 'Cache-Control': 'no-store' });
    const { t, headers } = preCsrf(req, res);
    const msg = u.searchParams.get('m');
    const MSGS = { bad: 'Usuario o contraseña incorrectos.', lock: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.', out: 'Cerraste sesión.', exp: 'La página expiró. Inténtalo otra vez.', pw: 'Contraseña cambiada. Ingresa con tu nueva contraseña.', exists: 'La cuenta de dueño ya existe. Inicia sesión.', mismatch: 'Las contraseñas no coinciden.', short: 'La contraseña debe tener al menos 8 caracteres y el usuario al menos 3.', noauth: 'Esta cuenta no está autorizada', oauth: 'No se pudo iniciar sesión con esa red. Inténtalo de nuevo.', state: 'El inicio de sesión social expiró. Inténtalo otra vez.', noaccount: 'Primero crea la cuenta de dueño con usuario y contraseña.' };
    return send(res, 200, authPage(authExists() ? 'login' : 'setup', t, MSGS[msg] || '', msg === 'out' || msg === 'pw'), null, Object.assign({ 'Cache-Control': 'no-store' }, headers));
  }
  if (m === 'POST' && (p === '/admin/setup' || p === '/admin/login')) {
    if (!sameOrigin(req)) return send(res, 403, 'Origen no permitido', 'text/plain; charset=utf-8');
    const body = await parseBody(req);
    if (!body || !safeEqual(body.csrf || '', parseCookies(req).pcsrf || '')) return redirect(res, '/admin?m=exp');
    if (p === '/admin/setup') {
      if (authExists()) return redirect(res, '/admin?m=exists');
      if (lockMinutes(ip)) return redirect(res, '/admin?m=lock');
      const user = String(body.username || '').trim().toLowerCase();
      const pw = String(body.password || '');
      if (user.length < 3 || user.length > 40 || pw.length < 8 || pw.length > 200) return redirect(res, '/admin?m=short');
      if (pw !== String(body.confirm || '')) return redirect(res, '/admin?m=mismatch');
      const h = await makeHash(pw);
      if (authExists()) return redirect(res, '/admin?m=exists');
      fs.writeFileSync(AUTH_FILE, JSON.stringify({ username: user, salt: h.salt, hash: h.hash, created: new Date().toISOString() }, null, 2), { mode: 0o600, flag: 'wx' });
      attempts.delete(ip);
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
      return sendJson(res, 200, { content: sanitizeContent(readContent(), []), visits: visitCount, icons: Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v.label])), iconSvg: Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v.svg])) });
    }
    if (m === 'GET' && p === '/admin/api/comprobantes') return sendJson(res, 200, { receipts: readReceipts() });
    if (m === 'GET' && p === '/admin/api/comentarios') return sendJson(res, 200, { comments: readComments() });
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
    if (p === '/admin/api/comentarios/delete') {
      const body = await parseBody(req);
      const id = str(body && body.id, 40);
      writeJsonAtomic(COMMENTS_FILE, readComments().filter((c) => c.id !== id));
      return sendJson(res, 200, { ok: true });
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
  const oauthStart = /^\/auth\/(google|facebook|x)$/.exec(p);
  if (m === 'GET' && oauthStart) {
    const provider = oauthStart[1];
    if (!oauthClient(provider).id) return send(res, 404, 'No disponible', 'text/plain; charset=utf-8');
    const state = crypto.randomBytes(24).toString('hex');
    const pkce = provider === 'x' ? makePkce() : { verifier: '', challenge: '' };
    const payload = Buffer.from(JSON.stringify({ p: provider, s: state, v: pkce.verifier, t: Date.now() })).toString('base64url');
    return redirect(res, oauthAuthorizeUrl(provider, state, pkce.challenge), { 'Set-Cookie': oauthCookie(req, payload, 600) });
  }
  const oauthBack = /^\/auth\/(google|facebook|x)\/callback$/.exec(p);
  if (m === 'GET' && oauthBack) return handleOAuthCallback(req, res, u, oauthBack[1]);
  return send(res, 404, '<!doctype html><meta charset="utf-8"><title>No encontrado</title><p style="font-family:sans-serif">Página no encontrada. <a href="/">Volver al inicio</a></p>');
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (res.headersSent) return res.end();
    if (e && e.code === 413) return sendJson(res, 413, { error: 'El archivo o los datos son demasiado grandes.' });
    console.error(e);
    send(res, 500, 'Error interno', 'text/plain; charset=utf-8');
  });
}).listen(PORT, () => { console.log(`Página lista en http://localhost:${PORT}  ·  Panel: http://localhost:${PORT}/admin`); });
