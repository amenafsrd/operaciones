/* =====================================================================
   SRD · Servidor (Cloudflare Pages · _worker.js)
   Ejecuta la lógica original (Codigo.gs) sobre un emulador de hojas
   guardado en Supabase. Archivo generado: no se edita a mano.
   ===================================================================== */

/* ---------- Fecha: hora de Costa Rica (UTC-6, sin horario de verano) ---------- */
const RealDate = Date;
const OFFSET_CR_MS = 6 * 3600 * 1000;
class CRDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(RealDate.now() - OFFSET_CR_MS);
    else super(...a);
  }
  static now() { return RealDate.now() - OFFSET_CR_MS; }
}
globalThis.Date = CRDate;

const PUBLICA_POR_DEFECTO = 'sb_publishable_rrKMTXKzTaNHYFjEdrlKVw__dIudr8o';
let ENV = null;          // variables del entorno de la solicitud
let AUTH_EMAIL = '';     // correo verificado de quien llama
let REQ = null;          // estado de la solicitud en curso
const STORE = new Map(); // caché por instancia: nombre -> {v, rows}
const APRENDIDO = new Map(); // función -> hojas que usa

class NeedSheet extends Error { constructor(n) { super('NEED ' + n); this.hoja = n; } }

/* ---------- Conversión de celdas ---------- */
function celda_(v) {
  if (v === undefined || v === null) return '';
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return v;
  if (v instanceof RealDate) return v;
  return String(v);
}
function revivir_(rows) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let j = 0; j < r.length; j++) {
      const c = r[j];
      if (c !== null && typeof c === 'object') r[j] = new CRDate(c.$d === null ? NaN : c.$d);
      else if (c === null) r[j] = '';
    }
  }
  return rows;
}
function serializar_(rows) {
  let fin = rows.length;
  const vacia = r => { for (let j = 0; j < r.length; j++) if (r[j] !== '') return false; return true; };
  while (fin > 0 && vacia(rows[fin - 1])) fin--;
  const out = new Array(fin);
  for (let i = 0; i < fin; i++) {
    const r = rows[i];
    let n = r.length;
    while (n > 0 && r[n - 1] === '') n--;
    const o = new Array(n);
    for (let j = 0; j < n; j++) {
      const c = r[j];
      o[j] = (c instanceof RealDate) ? { $d: isNaN(c) ? null : c.getTime() } : c;
    }
    out[i] = o;
  }
  return out;
}
function ancho_(rows) {
  let m = 0;
  for (const r of rows) { let n = r.length; while (n > 0 && r[n - 1] === '') n--; if (n > m) m = n; }
  return m;
}
function colA1_(s) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }

/* ---------- Hoja y rango ---------- */
class Rango {
  constructor(h, r, c, nr, nc) { this.h = h; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getValues() {
    const out = [], rows = this.h._r;
    for (let i = 0; i < this.nr; i++) {
      const row = rows[this.r - 1 + i], o = new Array(this.nc);
      for (let j = 0; j < this.nc; j++) {
        const v = row ? row[this.c - 1 + j] : undefined;
        o[j] = v === undefined ? '' : v;
      }
      out.push(o);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValues() { return this.getValues().map(f => f.map(v => v instanceof RealDate ? String(v) : String(v))); }
  setValues(vals) {
    for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals[i].length; j++) this.h._set(this.r + i, this.c + j, vals[i][j]);
    return this;
  }
  setValue(v) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.h._set(this.r + i, this.c + j, v);
    return this;
  }
  clearContent() {
    const rows = this.h._r;
    for (let i = 0; i < this.nr; i++) {
      const row = rows[this.r - 1 + i];
      if (!row) continue;
      for (let j = 0; j < this.nc; j++) if (this.c - 1 + j < row.length && row[this.c - 1 + j] !== '') { row[this.c - 1 + j] = ''; this.h._touch(this.r - 1 + i); }
    }
    return this;
  }
  clearContents() { return this.clearContent(); }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
}
['setNumberFormat', 'setNumberFormats', 'setBackground', 'setBackgrounds', 'setFontWeight', 'setFontColor', 'setFontSize',
 'setHorizontalAlignment', 'setVerticalAlignment', 'setWrap', 'setNote', 'setFontFamily', 'setBorder', 'merge', 'clearFormat',
 'clearFormats', 'setFontStyle', 'setWrapStrategy', 'protect', 'sort', 'createFilter', 'setDataValidation', 'setFormula']
  .forEach(n => { Rango.prototype[n] = function () { return this; }; });

class Hoja {
  constructor(nombre, rows, v, existe) {
    this._n = nombre; this._r = rows; this._v = v; this._existe = existe;
    this._base = rows.length; this._min = Infinity; this._borrada = false;
    this._cols = ancho_(rows);
  }
  _touch(i) { if (i < this._min) this._min = i; }
  _set(r1, c1, val) {
    while (this._r.length < r1) this._r.push([]);
    const row = this._r[r1 - 1];
    while (row.length < c1) row.push('');
    const v = celda_(val);
    row[c1 - 1] = v;
    this._touch(r1 - 1);
    if (v !== '' && c1 > this._cols) this._cols = c1;
  }
  getName() { return this._n; }
  getSheetName() { return this._n; }
  getLastRow() {
    for (let i = this._r.length - 1; i >= 0; i--) {
      const r = this._r[i];
      for (let j = 0; j < r.length; j++) if (r[j] !== '') return i + 1;
    }
    return 0;
  }
  getLastColumn() { return this._cols; }
  getMaxRows() { return Math.max(this._r.length, 1); }
  getMaxColumns() { return Math.max(this._cols, 1); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/);
      if (!m) throw new Error('Rango no válido: ' + a);
      const c1 = colA1_(m[1]), r1 = +m[2], c2 = m[3] ? colA1_(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
      return new Rango(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new Rango(this, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
  }
  getDataRange() { return new Rango(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this._cols, 1)); }
  appendRow(arr) {
    const n = this.getLastRow() + 1;
    // Quita filas vacías sobrantes al final para que la nueva quede pegada a los datos
    if (this._r.length > n - 1) { this._r.length = n - 1; this._touch(n - 1); }
    for (let j = 0; j < arr.length; j++) this._set(n, j + 1, arr[j]);
    if (!arr.length) this._set(n, 1, '');
    return this;
  }
  deleteRow(n) {
    if (n >= 1 && n <= this._r.length) { this._r.splice(n - 1, 1); this._touch(n - 1); }
    return this;
  }
  deleteRows(n, k) { if (n >= 1) { this._r.splice(n - 1, k); this._touch(n - 1); } return this; }
  insertRowsAfter() { return this; }
  insertRowsBefore() { return this; }
  insertColumnsAfter() { return this; }
  clear() { this._r.length = 0; this._cols = 0; this._touch(0); return this; }
  clearContents() { return this.clear(); }
  clearContent() { return this.clear(); }
  getFilter() { return null; }
}
['clearFormats', 'setFrozenRows', 'setFrozenColumns', 'setColumnWidth', 'setRowHeight', 'hideColumns', 'showColumns',
 'autoResizeColumns', 'autoResizeColumn', 'setTabColor', 'activate', 'setHiddenGridlines', 'hideSheet', 'showSheet',
 'setConditionalFormatRules', 'setColumnWidths', 'protect']
  .forEach(n => { Hoja.prototype[n] = function () { return this; }; });

function hojaCargada_(nombre) {
  const h = REQ.hojas.get(nombre);
  if (!h) { REQ.faltan.add(nombre); throw new NeedSheet(nombre); }   // se anota por si el código original captura el error
  return h;
}
const SpreadsheetApp = {
  getActiveSpreadsheet() { return SS; },
  openById() { return SS; },
  getUi() { throw new Error('No disponible en el servidor.'); },
  flush() {}
};
const SS = {
  getSheetByName(n) { const h = hojaCargada_(String(n)); return h._existe ? h : null; },
  insertSheet(n) {
    const h = hojaCargada_(String(n));
    if (h._existe) throw new Error('Ya existe una hoja llamada "' + n + '".');
    h._existe = true; h._touch(0);
    return h;
  },
  deleteSheet(sh) { sh._borrada = true; sh._existe = false; sh._r.length = 0; },
  getSheets() { return [...REQ.hojas.values()].filter(h => h._existe && !h._n.startsWith('__')); },
  getId() { return 'srd'; },
  getUrl() { return ''; },
  toast() {},
  getSpreadsheetTimeZone() { return 'America/Costa_Rica'; }
};

/* ---------- Servicios de Google simulados ---------- */
const LockService = { getScriptLock() { return { waitLock() {}, tryLock() { return true; }, releaseLock() {} }; } };
const CacheService = {
  getScriptCache() { return { get() { return null; }, put() {}, remove() {}, getAll() { return {}; }, putAll() {}, removeAll() {} }; }
};
const PropertiesService = {
  getScriptProperties() {
    const hoja = () => hojaCargada_('__PROPS');
    const fila = (h, k) => h._r.findIndex(r => r[0] === k);
    return {
      getProperty(k) { const h = hoja(); const i = fila(h, k); return i < 0 ? null : String(h._r[i][1]); },
      setProperty(k, v) {
        if (k === 'INV_CON_VER') return this;     // era solo para invalidar la caché
        const h = hoja(); h._existe = true;
        const i = fila(h, k);
        if (i < 0) h.appendRow([k, String(v)]); else h._set(i + 1, 2, String(v));
        return this;
      },
      deleteProperty(k) { const h = hoja(); const i = fila(h, k); if (i >= 0) h.deleteRow(i + 1); return this; },
      getProperties() { const o = {}; hoja()._r.forEach(r => { if (r[0] !== '') o[r[0]] = String(r[1]); }); return o; }
    };
  }
};
const Session = {
  getScriptTimeZone() { return 'America/Costa_Rica'; },
  getActiveUser() { return { getEmail() { return AUTH_EMAIL; } }; }
};
const Logger = { log(...a) { console.log(...a); } };

/* ---------- Utilities ---------- */
function bytesDe_(d) {
  if (d instanceof Uint8Array) return d;
  if (Array.isArray(d)) return Uint8Array.from(d.map(x => x & 255));
  return new TextEncoder().encode(String(d));
}
class Blob_ {
  constructor(b, mime, nombre) { this._b = b; this._m = mime || 'application/octet-stream'; this._n = nombre || ''; }
  getBytes() { return this._b; }
  getName() { return this._n; }
  setName(n) { this._n = n; return this; }
  getContentType() { return this._m; }
  setContentType(m) { this._m = m; return this; }
  getDataAsString() { return new TextDecoder().decode(this._b); }
}
const T_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32_(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = T_CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip_(blobs, nombre) {
  const enc = new TextEncoder(), partes = [], central = [];
  let pos = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const bl of blobs) {
    const nom = enc.encode(bl.getName()), dat = bl.getBytes(), crc = crc32_(dat);
    const loc = Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(dat.length), ...u32(dat.length), ...u16(nom.length), 0, 0]);
    partes.push(loc, nom, dat);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(dat.length), ...u32(dat.length), ...u16(nom.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(pos)]), nom);
    pos += loc.length + nom.length + dat.length;
  }
  let tamC = 0; central.forEach(x => tamC += x.length);
  const fin = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(blobs.length), ...u16(blobs.length), ...u32(tamC), ...u32(pos), 0, 0]);
  const todo = [...partes, ...central, fin];
  let tam = 0; todo.forEach(x => tam += x.length);
  const out = new Uint8Array(tam); let o = 0; todo.forEach(x => { out.set(x, o); o += x.length; });
  return new Blob_(out, 'application/zip', nombre || 'archivo.zip');
}
function b64enc_(b) {
  const u = bytesDe_(b); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64dec_(t) { const s = atob(String(t).replace(/\s/g, '')); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

const DIAS_ES_ = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_ES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function formatDate_(d, tz, fmt) {
  if (!(d instanceof RealDate) || isNaN(d)) return '';
  const p = (n, l) => String(n).padStart(l || 2, '0');
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), H = d.getUTCHours(), m = d.getUTCMinutes(), s = d.getUTCSeconds();
  const h12 = H % 12 === 0 ? 12 : H % 12;
  return String(fmt).replace(/'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|ss|SSS|EEEE|EEE|a|Z/g, (t, lit) => {
    if (lit !== undefined) return lit;
    switch (t) {
      case 'yyyy': return p(Y, 4); case 'yy': return p(Y % 100);
      case 'MMMM': return MESES_ES_[M]; case 'MMM': return MESES_ES_[M].slice(0, 3);
      case 'MM': return p(M + 1); case 'M': return String(M + 1);
      case 'dd': return p(D); case 'd': return String(D);
      case 'HH': return p(H); case 'H': return String(H);
      case 'hh': return p(h12); case 'h': return String(h12);
      case 'mm': return p(m); case 'ss': return p(s); case 'SSS': return p(d.getUTCMilliseconds(), 3);
      case 'EEEE': return DIAS_ES_[d.getUTCDay()]; case 'EEE': return DIAS_ES_[d.getUTCDay()].slice(0, 3);
      case 'a': return H < 12 ? 'AM' : 'PM'; case 'Z': return '-0600';
    }
    return t;
  });
}
const Utilities = {
  getUuid() { return crypto.randomUUID(); },
  formatDate: formatDate_,
  base64Encode: b64enc_,
  base64Decode: b64dec_,
  newBlob(data, mime, nombre) { return new Blob_(bytesDe_(data), mime, nombre); },
  zip: zip_,
  sleep() {},
  Charset: { UTF_8: 'UTF_8' },
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  computeDigest() { throw new Error('No disponible.'); }
};

/* ---------- Archivos (Drive): solo se guardan los de Cotizaciones ---------- */
function archivoDe_(id, h) {
  return {
    getId() { return id; },
    getName() { return h ? String(h._r[0][0]) : ''; },
    getUrl() { return ''; },
    setTrashed() { if (h) { h._borrada = true; h._existe = false; h._r.length = 0; } return this; },
    getBlob() { return new Blob_(b64dec_(h._r[0][2]), String(h._r[0][1]), String(h._r[0][0])); }
  };
}
function carpeta_(nombre) {
  return {
    createFile(blob) {
      const id = Utilities.getUuid().replace(/-/g, '');
      if (!/^SRD - Calendarios/.test(nombre)) {
        const h = new Hoja('__F_' + id, [], 0, true);
        REQ.hojas.set(h._n, h);
        h._touch(0);
        h._set(1, 1, blob.getName()); h._set(1, 2, blob.getContentType()); h._set(1, 3, b64enc_(blob.getBytes()));
        return archivoDe_(id, h);
      }
      return { getId() { return id; }, getName() { return blob.getName(); }, getUrl() { return ''; }, setTrashed() { return this; } };
    }
  };
}
const DriveApp = {
  getFoldersByName(n) { const c = carpeta_(n); let usado = false; return { hasNext() { return !usado; }, next() { usado = true; return c; } }; },
  createFolder(n) { return carpeta_(n); },
  getRootFolder() { return carpeta_('root'); },
  getFileById(id) {
    const h = hojaCargada_('__F_' + id);
    if (!h._existe) throw new Error('No se encontró el archivo.');
    return archivoDe_(id, h);
  }
};

const API = (function () {
/* =========================================================
   SISTEMA SRD - CONTROL DE MÓVILES (versión corregida)
   ========================================================= */

const CONFIG = {

  SPREADSHEET_ID: '18DzY_mXavLcgPECucUQVwz-MEWnNmRVwzbAT-Hu2PM8',

  HOJAS: {
    MOVILES: 'MOVILES',
    ASIGNACIONES: 'ASIGNACIONES',
    REGISTRO: 'REGISTRO',
    LISTAS: 'LISTAS',
    CALENDARIO: 'CALENDARIO',
    RESUMEN: 'RESUMEN',
    USUARIOS: 'USUARIOS',
    HISTORIAL: 'HISTORIAL',
    CAMBIOS: 'CAMBIOS_MOVILES'
  },

  ESTADOS: ['Activa', 'Backup', 'Varada', 'Libre'],

  COLORES: {
    'Activa': '#b6d7a8',
    'Backup': '#9fc5e8',
    'Varada': '#ea9999',
    'Libre': '#f9cb9c'
  },

  HEADERS: {
    MOVILES: [
      'ID_Movil', 'Movil', 'Tecnico_Actual', 'Contrata', 'Domicilio',
      'Estado', 'Fecha_Ingreso', 'Fecha_Salida', 'Placa', 'Tipo_Vehiculo',
      'ID_Movil_TLC', 'Tecnologia', 'Tecnico_Cedula', 'Tecnico_Telefono',
      'Tecnico_Correo', 'Tecnico_Nota_Ingreso', 'Asistente', 'Asistente_Cedula',
      'Asistente_Telefono', 'Asistente_Correo', 'Asistente_Nota_Ingreso',
      'Anio_Vehiculo', 'Modelo_Color', 'Provincia', 'Canton', 'Region',
      'Tecnico_Foto', 'Asistente_Foto', 'Direccion_Exacta', 'Ubicacion_GPS'
    ],
    ASIGNACIONES: [
      'ID_Asignacion', 'ID_Movil', 'Movil', 'Tecnico',
      'Fecha_Inicio', 'Fecha_Fin', 'Activa', 'Motivo_Fin',
      'Placa', 'Tipo_Vehiculo',
      'Tecnico_Cedula', 'Tecnico_Telefono', 'Tecnico_Correo',
      'Asistente', 'Asistente_Cedula', 'Asistente_Telefono', 'Asistente_Correo',
      'Tecnico_Salida', 'Tecnico_Motivo_Salida', 'Tecnico_Obs_Salida',
      'Asistente_Salida', 'Asistente_Motivo_Salida', 'Asistente_Obs_Salida',
      'Tecnico_Foto', 'Asistente_Foto'
    ],
    REGISTRO: [
      'Fecha', 'ID_Movil', 'Movil', 'Tecnico', 'Contrata',
      'Domicilio', 'Estado', 'Fecha_Registro', 'Usuario'
    ],
    USUARIOS: [
      'Usuario', 'Nombre', 'Rol', 'Salt', 'Hash',
      'Activo', 'Creado', 'Ultimo_Acceso', 'Correo', 'Debe_Cambiar_Clave', 'Modulos', 'Foto'
    ],
    HISTORIAL: [
      'Fecha_Hora', 'Usuario', 'Nombre', 'Ano', 'Semana', 'Fecha',
      'ID_Movil', 'Movil', 'Estado_Anterior', 'Estado_Nuevo', 'Lote', 'Comentario'
    ],
    CAMBIOS: [
      'Fecha_Hora', 'Usuario', 'Nombre', 'ID_Movil', 'Movil', 'Campo',
      'Valor_Anterior', 'Valor_Nuevo', 'Lote', 'Origen'
    ]
  }
};

const CAMPOS_BASICOS_MOVIL = [
  'ID_Movil', 'Movil', 'Tecnico_Actual', 'Contrata', 'Domicilio',
  'Estado', 'Fecha_Ingreso', 'Fecha_Salida', 'Placa', 'Tipo_Vehiculo'
];

const DIAS_SEMANA = [
  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'
];

const ENCABEZADO_SEMANA = ['Contrata', 'Domicilio', 'Móvil'].concat(DIAS_SEMANA);


/* =========================================================
   CONEXIÓN Y UTILIDADES DE HOJAS
   ========================================================= */

let SS_CACHE_ = null;

function obtenerSpreadsheet_() {

  /* Se abre una sola vez por ejecución (abrirlo cada vez es lento) */
  if (SS_CACHE_) return SS_CACHE_;

  try {
    const activa = SpreadsheetApp.getActiveSpreadsheet();
    if (activa) return (SS_CACHE_ = activa);
  } catch (e) { /* web app: se usa el ID */ }

  return (SS_CACHE_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID));
}

function obtenerHoja_(nombre) {
  const sh = obtenerSpreadsheet_().getSheetByName(nombre);
  if (!sh) {
    throw new Error(
      'Falta la hoja "' + nombre + '". Ejecuta "Configurar / reparar sistema" desde el menú.'
    );
  }
  return sh;
}

function conBloqueo_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function leerObjetos_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values.shift().map(h => String(h).trim());
  const out = [];
  values.forEach((r, i) => {
    if (!r.some(v => v !== '')) return;
    const o = { _fila: i + 2 };
    headers.forEach((h, j) => { if (h) o[h] = r[j]; });
    out.push(o);
  });
  return out;
}

/* Como leerObjetos_, pero solo trae las filas cuya fecha cae entre desde y hasta (ISO yyyy-MM-dd).
   Primero lee solo la columna de fecha y después únicamente el bloque de filas que hace falta:
   en hojas que crecen todos los días es lo que evita leer todo el historial en cada consulta. */
function leerObjetosPorFecha_(sh, campoFecha, desde, hasta) {
  if (!sh || sh.getLastRow() < 2) return [];
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const ci = headers.indexOf(campoFecha);
  if (ci < 0) return leerObjetos_(sh);
  const d0 = desde || '0000-00-00', d1 = hasta || '9999-99-99';
  const col = sh.getRange(2, ci + 1, lastRow - 1, 1).getValues();
  let primero = -1, ultimo = -1;
  for (let i = 0; i < col.length; i++) {
    const raw = col[i][0], f = segFecha_(raw);
    /* Una fecha con formato raro no se descarta: se deja pasar para que quien llama decida */
    if (f ? (f >= d0 && f <= d1) : (raw !== '' && raw != null)) { if (primero < 0) primero = i; ultimo = i; }
  }
  if (primero < 0) return [];
  const values = sh.getRange(primero + 2, 1, ultimo - primero + 1, lastCol).getValues();
  const out = [];
  values.forEach((r, k) => {
    const f = segFecha_(r[ci]);
    if (f ? (f < d0 || f > d1) : (r[ci] === '' || r[ci] == null)) return;
    if (!r.some(v => v !== '')) return;
    const o = { _fila: primero + 2 + k };
    headers.forEach((h, j) => { if (h) o[h] = r[j]; });
    out.push(o);
  });
  return out;
}

function leerTabla_(sh) {
  const values = sh.getDataRange().getValues();
  const idx = {};
  values[0].forEach((h, i) => {
    const n = String(h).trim();
    if (n) idx[n] = i;
  });
  return { values, idx };
}

function exigirColumnas_(idx, nombres, hoja) {
  const faltan = nombres.filter(n => idx[n] === undefined);
  if (faltan.length) {
    throw new Error(
      'Faltan columnas en ' + hoja + ': ' + faltan.join(', ') +
      '. Ejecuta "Configurar / reparar sistema" desde el menú.'
    );
  }
}

function appendPorEncabezados_(sh, obj) {
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(x => String(x).trim());
  sh.appendRow(h.map(n => (n in obj ? obj[n] : '')));
}

/* Los objetos Date no se pueden enviar a la web app: se pasan a texto */
function limpiarParaWeb_(lista) {
  return lista.map(o => {
    const c = {};
    Object.keys(o).forEach(k => {
      const v = o[k];
      c[k] = v instanceof Date ? (isNaN(v) ? '' : formatearFechaISO_(v)) : v;
    });
    return c;
  });
}


/* =========================================================
   USUARIOS, CONTRASEÑAS Y SESIONES
   - Las contraseñas se guardan cifradas (hash con sal y un
     valor secreto guardado fuera del Sheet). Nunca en texto.
   - Cada llamada de la web exige un token de sesión válido.
   - Roles: consulta (solo ver), operador (ver y editar el
     calendario / exportar) y admin (todo, incl. móviles y usuarios).
   ========================================================= */

const ROLES = ['consulta', 'operador', 'admin'];
const NIVEL_ROL = { consulta: 1, operador: 2, admin: 3 };
/* Módulos a los que puede entrar cada usuario. El administrador entra a todos.
   Un usuario sin lista guardada conserva el acceso de siempre, salvo Cotizaciones, que hay que darlo expresamente. */
const MODULOS = { cronograma: 'Cronograma', moviles: 'Móviles', seguimiento: 'Seguimiento', bodega: 'Bodega', cotizaciones: 'Cotizaciones', resumen: 'Resumen' };

function modulosDe_(rol, texto) {
  const todos = Object.keys(MODULOS);
  if (String(rol).toLowerCase() === 'admin') return todos;
  const t = String(texto || '').trim();
  if (!t) return todos.filter(k => k !== 'cotizaciones');
  return t.split(',').map(x => x.trim()).filter(k => MODULOS[k]);
}

function limpiarModulos_(m) {
  if (m === undefined || m === null) return undefined;
  const l = (Array.isArray(m) ? m : String(m).split(',')).map(x => String(x).trim()).filter(k => MODULOS[k]);
  return l.length ? l.join(',') : 'NINGUNO';
}

const MAX_FALLOS = 5;
const BLOQUEO_SEG = 900;
const SESION_SEG = 21600;

/* Bloquea que una función del menú se ejecute desde la web */
function soloDesdeMenu_() {
  try {
    SpreadsheetApp.getUi();
  } catch (e) {
    throw new Error('Esta acción solo se puede ejecutar desde el menú del Sheet.');
  }
}

function normalizarUsuario_(u) {
  return String(u || '').trim().toLowerCase().slice(0, 60);
}

function obtenerPepper_() {
  const props = PropertiesService.getScriptProperties();
  let p = props.getProperty('PEPPER');
  if (!p) {
    p = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('PEPPER', p);
  }
  return p;
}

function nuevoSalt_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function hashClave_(clave, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    obtenerPepper_() + '|' + salt + '|' + clave,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function compararSeguro_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function buscarUsuario_(usuario) {
  const u = normalizarUsuario_(usuario);
  return leerObjetos_(obtenerHoja_(CONFIG.HOJAS.USUARIOS))
    .find(x => normalizarUsuario_(x.Usuario) === u) || null;
}

/* Crea o actualiza un usuario. Campos vacíos = se conserva el valor actual. */
function guardarUsuario_(d) {

  return conBloqueo_(() => {

    const sh = obtenerHoja_(CONFIG.HOJAS.USUARIOS);
    asegurarColumnasHoja_(sh, CONFIG.HEADERS.USUARIOS);
    const { idx } = leerTabla_(sh);
    exigirColumnas_(idx, CONFIG.HEADERS.USUARIOS, 'USUARIOS');

    const u = normalizarUsuario_(d.usuario);
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) {
      throw new Error('El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.');
    }

    const existente = buscarUsuario_(u);

    const rol = String(d.rol || (existente ? existente.Rol : '')).toLowerCase();
    if (ROLES.indexOf(rol) === -1) throw new Error('Rol no válido.');

    const nombre = String(d.nombre || (existente ? existente.Nombre : '') || u).trim();
    const clave = d.clave ? String(d.clave) : '';

    if (clave && clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (!existente && !clave) throw new Error('Debes indicar una contraseña para el usuario nuevo.');

    const activo = (d.activo === undefined || d.activo === null)
      ? (existente ? String(existente.Activo) === 'SI' : true)
      : !!d.activo;

    /* Siempre debe quedar al menos un administrador activo */
    const admins = leerObjetos_(sh).filter(x => {
      const esEste = normalizarUsuario_(x.Usuario) === u;
      const rolX = esEste ? rol : String(x.Rol).toLowerCase();
      const activoX = esEste ? activo : String(x.Activo) === 'SI';
      return rolX === 'admin' && activoX;
    }).length + ((!existente && rol === 'admin' && activo) ? 1 : 0);

    if (admins < 1) throw new Error('Debe quedar al menos un administrador activo.');

    /* Salt y Hash como texto para que Sheets no los convierta en número */
    [idx.Salt, idx.Hash].forEach(c =>
      sh.getRange(1, c + 1, sh.getMaxRows(), 1).setNumberFormat('@')
    );

    if (!existente) {

      const salt = nuevoSalt_();

      appendPorEncabezados_(sh, {
        Usuario: u,
        Nombre: nombre,
        Rol: rol,
        Salt: salt,
        Hash: hashClave_(clave, salt),
        Activo: activo ? 'SI' : 'NO',
        Creado: new Date(),
        Ultimo_Acceso: '',
        Correo: d.correo ? String(d.correo).trim().toLowerCase() : '',
        Debe_Cambiar_Clave: d.debeCambiar ? 'SI' : 'NO',
        Modulos: limpiarModulos_(d.modulos) || ''
      });

      return { ok: true, creado: true };
    }

    const fila = existente._fila;
    const set = (n, v) => sh.getRange(fila, idx[n] + 1).setValue(v);

    set('Nombre', nombre);
    set('Rol', rol);
    set('Activo', activo ? 'SI' : 'NO');
    if (d.correo) set('Correo', String(d.correo).trim().toLowerCase());
    if (d.debeCambiar !== undefined) set('Debe_Cambiar_Clave', d.debeCambiar ? 'SI' : 'NO');
    if (limpiarModulos_(d.modulos) !== undefined) set('Modulos', limpiarModulos_(d.modulos));

    if (clave) {
      const salt = nuevoSalt_();
      set('Salt', salt);
      set('Hash', hashClave_(clave, salt));
    }

    return { ok: true, creado: false };
  });
}

/* Valida el token y el rol. Devuelve {usuario, nombre, rol}. */
function requerirSesion_(token, minimo) {

  const t = String(token || '');
  const cache = CacheService.getScriptCache();
  let raw = (t && t.length < 200) ? cache.get('ses_' + t) : null;

  if (!raw) throw new Error('SESION_EXPIRADA');

  const ses = JSON.parse(raw);
  const ahora = Date.now();

  /* El usuario se vuelve a comprobar en el Sheet como máximo cada 60 segundos.
     Así, desactivar a alguien o cambiarle el rol surte efecto en menos de un minuto,
     sin leer la hoja USUARIOS en cada acción. */
  if (!ses.rol || !ses.vt || !ses.modulos || ahora - ses.vt > 60000) {

    const reg = buscarUsuario_(ses.usuario);

    if (!reg || String(reg.Activo) !== 'SI') {
      cache.remove('ses_' + t);
      throw new Error('SESION_EXPIRADA');
    }

    ses.rol = String(reg.Rol || '').toLowerCase();
    ses.nombre = String(reg.Nombre || reg.Usuario);
    ses.modulos = modulosDe_(ses.rol, reg.Modulos);
    ses.vt = ahora;

    raw = JSON.stringify(ses);
    cache.put('ses_' + t, raw, SESION_SEG);
  }

  if ((NIVEL_ROL[ses.rol] || 0) < (NIVEL_ROL[minimo] || 99)) {
    throw new Error('No tienes permiso para realizar esta acción.');
  }

  return { usuario: ses.usuario, nombre: ses.nombre, rol: ses.rol, modulos: ses.modulos || [] };
}

function loginWeb(usuario, clave) {

  const u = normalizarUsuario_(usuario);
  const cache = CacheService.getScriptCache();
  const kFallos = 'fallos_' + u;
  const fallos = Number(cache.get(kFallos) || 0);

  if (fallos >= MAX_FALLOS) {
    throw new Error('Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.');
  }

  const reg = u ? buscarUsuario_(u) : null;

  const ok = !!reg &&
    String(reg.Activo) === 'SI' &&
    compararSeguro_(hashClave_(String(clave || ''), String(reg.Salt)), String(reg.Hash));

  if (!ok) {
    cache.put(kFallos, String(fallos + 1), BLOQUEO_SEG);
    throw new Error('Usuario o contraseña incorrectos.');
  }

  cache.remove(kFallos);

  const rol = String(reg.Rol).toLowerCase();
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const nombre = String(reg.Nombre || reg.Usuario);

  cache.put('ses_' + token, JSON.stringify({ usuario: u }), SESION_SEG);

  /* Último acceso ANTES de este (para el mensaje de bienvenida) */
  const previo = (reg.Ultimo_Acceso instanceof Date && !isNaN(reg.Ultimo_Acceso))
    ? Utilities.formatDate(reg.Ultimo_Acceso, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : '';

  try {
    const sh = obtenerHoja_(CONFIG.HOJAS.USUARIOS);
    const { idx } = leerTabla_(sh);
    sh.getRange(reg._fila, idx.Ultimo_Acceso + 1).setValue(new Date());
  } catch (e) { /* no es crítico */ }

  return {
    token: token, usuario: u, nombre: nombre, rol: rol, modulos: modulosDe_(rol, reg.Modulos),
    foto: String(reg.Foto || ''), accesoPrevio: previo,
    cambiarClave: String(reg.Debe_Cambiar_Clave || '') === 'SI'
  };
}

/* ---------- Foto de perfil ---------- */

/* Datos propios para pintar el avatar al abrir una sesión guardada */
function miPerfilWeb(token) {
  const ses = requerirSesion_(token, 'consulta');
  const reg = buscarUsuario_(ses.usuario) || {};
  return { foto: String(reg.Foto || '') };
}

/* Cada usuario cambia su propia foto. Llega ya reducida desde el navegador (cuadrada, ~200 px). Vacío = quitar la foto. */
function guardarFotoPerfilWeb(token, dataUrl) {
  const ses = requerirSesion_(token, 'consulta');
  dataUrl = String(dataUrl || '');
  if (dataUrl && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(dataUrl)) throw new Error('La imagen no es válida.');
  if (dataUrl.length > 45000) throw new Error('La foto es demasiado pesada. Elige otra o una de menor tamaño.');
  return conBloqueo_(() => {
    const sh = obtenerHoja_(CONFIG.HOJAS.USUARIOS);
    asegurarColumnasHoja_(sh, CONFIG.HEADERS.USUARIOS);
    const { idx } = leerTabla_(sh);
    const reg = buscarUsuario_(ses.usuario);
    if (!reg) throw new Error('No se encontró el usuario.');
    sh.getRange(reg._fila, idx.Foto + 1).setNumberFormat('@').setValue(dataUrl);
    return { ok: true };
  });
}

function validarSesionWeb(token) {
  try {
    return requerirSesion_(token, 'consulta');
  } catch (e) {
    return null;
  }
}

function logoutWeb(token) {
  if (token) CacheService.getScriptCache().remove('ses_' + String(token));
  return { ok: true };
}

function cambiarClaveWeb(token, actual, nueva) {

  const ses = requerirSesion_(token, 'consulta');
  const reg = buscarUsuario_(ses.usuario);

  if (!compararSeguro_(hashClave_(String(actual || ''), String(reg.Salt)), String(reg.Hash))) {
    throw new Error('La contraseña actual no es correcta.');
  }

  guardarUsuario_({ usuario: ses.usuario, clave: nueva, debeCambiar: false });

  return { ok: true };
}

function listarUsuariosWeb(token) {

  requerirSesion_(token, 'admin');

  return leerObjetos_(obtenerHoja_(CONFIG.HOJAS.USUARIOS)).map(x => ({
    usuario: normalizarUsuario_(x.Usuario),
    nombre: String(x.Nombre || ''),
    correo: String(x.Correo || ''),
    pendienteClave: String(x.Debe_Cambiar_Clave || '') === 'SI',
    rol: String(x.Rol || '').toLowerCase(),
    modulos: modulosDe_(String(x.Rol || '').toLowerCase(), x.Modulos),
    foto: String(x.Foto || ''),
    activo: String(x.Activo) === 'SI',
    ultimoAcceso: (x.Ultimo_Acceso instanceof Date && !isNaN(x.Ultimo_Acceso))
      ? Utilities.formatDate(x.Ultimo_Acceso, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
      : ''
  }));
}

/* ---------- generación automática de usuario y contraseña ---------- */

function sinAcentos_(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function limpiarNombre_(n) {
  return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function validarCorreo_(c) {
  const correo = String(c || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) throw new Error('Escribe un correo empresarial válido (ej. nombre@empresa.com).');
  return correo;
}

function correoEnUso_(correo, exceptoUsuario) {
  const ex = normalizarUsuario_(exceptoUsuario || '');
  return leerObjetos_(obtenerHoja_(CONFIG.HOJAS.USUARIOS)).some(x =>
    String(x.Correo || '').trim().toLowerCase() === correo && normalizarUsuario_(x.Usuario) !== ex);
}

/* "Allan Mena Fonseca" -> allan.mena ; "Luis Diego Pérez Carmona" -> luis.perez
   Si ya existe: allan.fonseca, luego allan.mena2, allan.mena3... */
function generarUsuarioUnico_(nombre) {

  const particulas = ['de', 'del', 'la', 'las', 'los', 'y', 'san'];

  const t = sinAcentos_(nombre).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter(x => x && particulas.indexOf(x) === -1);

  if (!t.length) throw new Error('El nombre no tiene letras válidas.');

  const primero = t[0];
  const apellido1 = t.length >= 3 ? t[t.length - 2] : (t[1] || '');
  const apellido2 = t.length >= 3 ? t[t.length - 1] : '';

  const candidatos = [];
  if (apellido1) candidatos.push(primero + '.' + apellido1);
  if (apellido2) candidatos.push(primero + '.' + apellido2);
  if (!candidatos.length) candidatos.push(primero + '.srd');

  const base = candidatos[0];

  for (let i = 0; i < candidatos.length; i++) {
    const c = candidatos[i].slice(0, 28);
    if (c.length >= 3 && !buscarUsuario_(c)) return c;
  }

  for (let n = 2; n < 100; n++) {
    const c = base.slice(0, 26) + n;
    if (!buscarUsuario_(c)) return c;
  }

  throw new Error('No se pudo generar un usuario único. Revisa el nombre.');
}

/* 12 caracteres sin letras confusas (0/O, 1/l/I), con mayúscula, minúscula y número */
function generarClave_() {

  const MAY = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const MIN = 'abcdefghijkmnpqrstuvwxyz';
  const NUM = '23456789';
  const TODO = MAY + MIN + NUM;

  const aleatorio = n => {
    const limite = Math.floor(256 / n) * n;
    for (;;) {
      const hex = Utilities.getUuid().replace(/-/g, '');
      for (let i = 0; i < hex.length; i += 2) {
        const b = parseInt(hex.substr(i, 2), 16);
        if (b < limite) return b % n;
      }
    }
  };

  const pick = set => set.charAt(aleatorio(set.length));

  const chars = [pick(MAY), pick(MIN), pick(NUM)];
  while (chars.length < 12) chars.push(pick(TODO));

  for (let i = chars.length - 1; i > 0; i--) {
    const j = aleatorio(i + 1);
    const tmp = chars[i]; chars[i] = chars[j]; chars[j] = tmp;
  }

  return chars.join('');
}

function crearUsuarioWeb(token, datos) {

  requerirSesion_(token, 'admin');

  datos = datos || {};

  const nombre = limpiarNombre_(datos.nombre);
  if (nombre.split(' ').length < 2) throw new Error('Escribe el nombre completo (nombre y apellido).');

  const correo = validarCorreo_(datos.correo);
  if (correoEnUso_(correo)) throw new Error('Ese correo ya está registrado en otro usuario.');

  const rol = String(datos.rol || '').toLowerCase();
  if (ROLES.indexOf(rol) === -1) throw new Error('Rol no válido.');

  const usuario = generarUsuarioUnico_(nombre);
  const clave = generarClave_();

  guardarUsuario_({
    usuario: usuario, nombre: nombre, correo: correo, rol: rol,
    clave: clave, activo: true, debeCambiar: true, modulos: datos.modulos
  });

  return { ok: true, usuario: usuario, clave: clave, nombre: nombre, correo: correo, rol: rol };
}

function actualizarUsuarioWeb(token, datos) {

  requerirSesion_(token, 'admin');

  datos = datos || {};

  if (!buscarUsuario_(datos.usuario)) throw new Error('No se encontró el usuario.');

  let correo;
  if (datos.correo) {
    correo = validarCorreo_(datos.correo);
    if (correoEnUso_(correo, datos.usuario)) throw new Error('Ese correo ya está registrado en otro usuario.');
  }

  const nombre = datos.nombre ? limpiarNombre_(datos.nombre) : '';
  if (nombre && nombre.split(' ').length < 2) throw new Error('Escribe el nombre completo (nombre y apellido).');

  const nueva = datos.generarClave ? generarClave_() : '';

  guardarUsuario_({
    usuario: datos.usuario,
    nombre: nombre,
    correo: correo,
    rol: datos.rol,
    clave: nueva,
    debeCambiar: nueva ? true : undefined,
    activo: datos.activo,
    modulos: datos.modulos
  });

  return { ok: true, clave: nueva, usuario: normalizarUsuario_(datos.usuario) };
}

/* Menú del Sheet: crea un usuario o restablece su contraseña/rol.
   Así se crea el primer administrador. */
function menuGestionarUsuario() {

  soloDesdeMenu_();

  const ui = SpreadsheetApp.getUi();

  const pedir = (titulo, texto) => {
    const r = ui.prompt(titulo, texto, ui.ButtonSet.OK_CANCEL);
    return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null;
  };

  const usuario = pedir('Usuario', 'Nombre de usuario (ej. maria):');
  if (usuario === null) return;

  const nombre = pedir('Nombre', 'Nombre completo (opcional si el usuario ya existe):');
  if (nombre === null) return;

  const rol = pedir('Rol', 'Escribe: admin, operador o consulta (vacío = conservar el actual):');
  if (rol === null) return;

  const clave = pedir('Contraseña', 'Contraseña de al menos 8 caracteres (vacío = conservar la actual):');
  if (clave === null) return;

  try {
    const r = guardarUsuario_({
      usuario: usuario, nombre: nombre, rol: rol, clave: clave, activo: true
    });
    ui.alert(r.creado ? 'Usuario creado.' : 'Usuario actualizado.');
  } catch (e) {
    ui.alert('No se pudo guardar: ' + e.message);
  }
}


/* =========================================================
   MENÚ
   ========================================================= */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SRD Gestión Operativa')
    .addItem('⚙️ Configurar / reparar sistema', 'configurarSistema')
    .addItem('📅 Actualizar calendario', 'menuActualizarCalendario')
    .addItem('📥 Exportar Calendario Cliente a Excel', 'exportarCalendarioClienteExcelMenu')
    .addItem('📊 Actualizar resumen', 'menuActualizarResumen')
    .addItem('🔎 Verificar sistema', 'verificarSistema')
    .addSeparator()
    .addItem('📋 Importar fichas (hoja IMPORTAR_FICHAS)', 'menuImportarFichas')
    .addItem('👤 Crear / restablecer usuario', 'menuGestionarUsuario')
    .addToUi();
}

function menuActualizarCalendario() {
  soloDesdeMenu_();
  actualizarCalendario_();
}

function menuActualizarResumen() {
  soloDesdeMenu_();
  actualizarResumen_();
}

/* =========================================================
   WEB APP
   ========================================================= */

function doGet() {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle('SRD Gestión Operativa')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/* =========================================================
   CONFIGURAR SISTEMA
   ========================================================= */

function configurarSistema() {

  soloDesdeMenu_();

  const ss = obtenerSpreadsheet_();

  migrarOMantenerMoviles_(ss);

  asegurarHoja_(ss, CONFIG.HOJAS.ASIGNACIONES, CONFIG.HEADERS.ASIGNACIONES);
  asegurarHoja_(ss, CONFIG.HOJAS.REGISTRO, CONFIG.HEADERS.REGISTRO);
  asegurarHoja_(ss, CONFIG.HOJAS.USUARIOS, CONFIG.HEADERS.USUARIOS);
  asegurarHoja_(ss, CONFIG.HOJAS.HISTORIAL, CONFIG.HEADERS.HISTORIAL);
  asegurarHoja_(ss, CONFIG.HOJAS.CAMBIOS, CONFIG.HEADERS.CAMBIOS);
  Object.keys(SEG.HOJAS).forEach(k => segHoja_(k));
  Object.keys(INV.HOJAS).forEach(k => invHoja_(k));
  prepararFormatosMoviles_();
  obtenerPepper_();

  asegurarHoja_(ss, CONFIG.HOJAS.LISTAS, [
    'Estados', '', 'Estados_Movil', '', 'Domicilios', '', 'Contratas', '', 'Año', 'Semana'
  ]);

  asegurarHoja_(ss, CONFIG.HOJAS.CALENDARIO, ['']);
  asegurarHoja_(ss, CONFIG.HOJAS.RESUMEN, ['Estado', 'Cantidad']);

  prepararListas_();
  generarSemanas_();
  sincronizarAsignacionesIniciales_();
  completarFichaAsignaciones_();
  actualizarCalendario_();
  actualizarResumen_();
  formatearHojas_();

  ss.toast('Sistema configurado correctamente.', 'SRD Gestión Operativa', 5);
}


/* =========================================================
   ASEGURAR HOJA (crea la hoja y agrega encabezados faltantes)
   ========================================================= */

/* Google Sheets crea las hojas con 26 columnas; si hacen falta más, hay que agregarlas */
function asegurarAnchoHoja_(sh, n) {
  const max = sh.getMaxColumns();
  if (max < n) sh.insertColumnsAfter(max, n - max);
}

function asegurarHoja_(ss, nombre, encabezados) {

  let sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);

  if (encabezados.length === 1 && encabezados[0] === '') return sh;

  asegurarAnchoHoja_(sh, encabezados.length);

  const columnas = Math.max(sh.getLastColumn(), encabezados.length);
  const actuales = sh.getRange(1, 1, 1, columnas).getValues()[0];
  const vacia = actuales.every(v => String(v || '').trim() === '');

  if (vacia) {
    sh.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
    return sh;
  }

  asegurarColumnasHoja_(sh, encabezados);

  return sh;
}


/* =========================================================
   MOVILES (migración / mantenimiento de columnas)
   ========================================================= */

function migrarOMantenerMoviles_(ss) {

  const headers = CONFIG.HEADERS.MOVILES;
  const base = headers.slice(0, 8);

  let sh = ss.getSheetByName(CONFIG.HOJAS.MOVILES);

  if (!sh) {
    sh = ss.insertSheet(CONFIG.HOJAS.MOVILES);
    asegurarAnchoHoja_(sh, headers.length);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  if (sh.getLastRow() === 0 || sh.getLastColumn() === 0) {
    sh.clear();
    asegurarAnchoHoja_(sh, headers.length);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  const data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const oldHeaders = data[0].map(v => String(v || '').trim());

  /* Si ya tiene el formato base, solo se agregan las columnas nuevas
     (Placa, Tipo_Vehiculo) al final, sin tocar los datos. */
  if (base.every(h => oldHeaders.indexOf(h) !== -1)) {
    asegurarHoja_(ss, CONFIG.HOJAS.MOVILES, headers);
    return;
  }

  /* Formato antiguo: se hace respaldo y se reconstruye */
  const backupName = 'MOVILES_BACKUP_' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');

  ss.insertSheet(backupName)
    .getRange(1, 1, data.length, data[0].length)
    .setValues(data);

  const idx = {};
  oldHeaders.forEach((h, i) => { idx[h.toLowerCase()] = i; });

  const buscar = aliases => {
    for (const a of aliases) {
      const p = idx[a.toLowerCase()];
      if (p !== undefined) return p;
    }
    return -1;
  };

  const iId = buscar(['id_movil', 'id', 'id movil']);
  const iMovil = buscar(['movil', 'móvil', 'vehiculo', 'vehículo', 'unidad']);
  const iTec = buscar(['tecnico_actual', 'tecnico', 'técnico_actual', 'técnico', 'nombre tecnico', 'nombre técnico']);
  const iCon = buscar(['contrata', 'contratista', 'empresa']);
  const iDom = buscar(['domicilio', 'zona', 'base']);
  const iEst = buscar(['estado', 'estatus']);
  const iIng = buscar(['fecha_ingreso', 'fecha ingreso', 'ingreso']);
  const iSal = buscar(['fecha_salida', 'fecha salida', 'salida']);
  const iPla = buscar(['placa']);
  const iTip = buscar(['tipo_vehiculo', 'tipo vehiculo', 'tipo de vehiculo', 'tipo de vehículo', 'tipo']);

  const val = (row, i) => (i >= 0 ? row[i] : '');

  const out = [headers];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const movil = val(row, iMovil);
    if (String(movil).trim() === '') continue;

    const id = (iId >= 0 && row[iId])
      ? row[iId]
      : 'M' + String(out.length).padStart(3, '0');

    out.push([
      id,
      movil,
      val(row, iTec),
      val(row, iCon),
      val(row, iDom),
      iEst >= 0 && row[iEst] ? normalizarEstadoMovil_(row[iEst]) : 'ACTIVA',
      val(row, iIng),
      val(row, iSal),
      val(row, iPla),
      val(row, iTip)
    ]);
  }

  const ancho = headers.length;
  const salida = out.map(f => (f.length < ancho ? f.concat(new Array(ancho - f.length).fill('')) : f));

  sh.clear();
  asegurarAnchoHoja_(sh, ancho);
  sh.getRange(1, 1, salida.length, ancho).setValues(salida);
}


/* =========================================================
   LISTAS
   ========================================================= */

function prepararListas_() {

  const sh = obtenerHoja_(CONFIG.HOJAS.LISTAS);

  sh.getRange('A1').setValue('Estados');
  sh.getRange('A2:A5').setValues(CONFIG.ESTADOS.map(x => [x]));

  sh.getRange('C1').setValue('Estados_Movil');
  sh.getRange('C2:C3').setValues([['ACTIVA'], ['INACTIVA']]);

  sh.getRange('E1').setValue('Domicilios');
  sh.getRange('E2:E200').clearContent();
  const domicilios = valoresUnicos_('Domicilio');
  if (domicilios.length) {
    sh.getRange(2, 5, domicilios.length, 1).setValues(domicilios.map(x => [x]));
  }

  sh.getRange('G1').setValue('Contratas');
  sh.getRange('G2:G200').clearContent();
  const contratas = valoresUnicos_('Contrata');
  if (contratas.length) {
    sh.getRange(2, 7, contratas.length, 1).setValues(contratas.map(x => [x]));
  }
}

function valoresUnicos_(campo) {
  return Array.from(new Set(
    obtenerMoviles_()
      .map(m => String(m[campo] || '').trim())
      .filter(Boolean)
  ));
}


/* =========================================================
   SEMANAS (lista en la hoja LISTAS)
   ========================================================= */

function generarSemanas_() {

  const sh = obtenerHoja_(CONFIG.HOJAS.LISTAS);
  const year = new Date().getFullYear();

  sh.getRange('I1:J60').clearContent();
  sh.getRange('I1:J1').setValues([['Año', 'Semana']]);

  const filas = [];
  for (let w = 1; w <= semanasEnAno_(year); w++) filas.push([year, w]);

  sh.getRange(2, 9, filas.length, 2).setValues(filas);
}


/* =========================================================
   ASIGNACIONES
   ========================================================= */

function sincronizarAsignacionesIniciales_() {

  const moviles = obtenerMoviles_();
  if (!moviles.length) return;

  const asignaciones = leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES));

  const conActiva = new Set(
    asignaciones
      .filter(a => String(a.Activa).toUpperCase() === 'SI')
      .map(a => String(a.ID_Movil))
  );

  const hoy = inicioDia_(new Date());

  moviles.forEach(m => {
    if (!esActiva_(m)) return;
    if (conActiva.has(String(m.ID_Movil))) return;

    agregarAsignacion_(
      m.ID_Movil,
      m.Movil,
      m.Fecha_Ingreso ? (convertirFecha_(m.Fecha_Ingreso) || hoy) : hoy,
      m
    );
  });
}

function maxIdAsignacion_() {
  let max = 0;
  leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES)).forEach(a => {
    const n = parseInt(String(a.ID_Asignacion).replace(/\D/g, ''), 10);
    if (n > max) max = n;
  });
  return max;
}

function formatoIdAsignacion_(n) {
  return 'A' + String(n).padStart(5, '0');
}

/* Agrega al final de la fila 1 las columnas que falten (sin tocar los datos) */
function asegurarColumnasHoja_(sh, headers) {

  const lc = sh.getLastColumn();
  const actuales = lc
    ? sh.getRange(1, 1, 1, lc).getValues()[0].map(x => String(x).trim())
    : [];

  const faltan = headers.filter(h => h && actuales.indexOf(h) === -1);

  if (!faltan.length) return 0;

  asegurarAnchoHoja_(sh, lc + faltan.length);
  sh.getRange(1, lc + 1, 1, faltan.length).setValues([faltan]);

  return faltan.length;
}

function textoSnap_(campo, v) {
  const t = String(v == null ? '' : (v instanceof Date ? '' : v)).trim();
  return campo === 'Placa' ? t.toUpperCase() : t;
}

/* Abre un periodo nuevo: técnico, asistente y vehículo de ese momento.
   m = objeto con los campos de la móvil (Tecnico_Actual, Placa, Asistente, ...) */
function agregarAsignacion_(id, movil, fechaInicio, m) {

  m = m || {};

  const sh = obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES);

  if (asegurarColumnasHoja_(sh, CONFIG.HEADERS.ASIGNACIONES) > 0) {
    formatearColumnasTexto_(sh, [
      'Tecnico_Cedula', 'Tecnico_Telefono', 'Asistente_Cedula', 'Asistente_Telefono', 'Placa'
    ]);
    ocultarColumnasFoto_(sh);
  }

  const fila = {
    ID_Asignacion: formatoIdAsignacion_(maxIdAsignacion_() + 1),
    ID_Movil: id,
    Movil: movil,
    Fecha_Inicio: fechaInicio,
    Fecha_Fin: '',
    Activa: 'SI',
    Motivo_Fin: ''
  };

  Object.keys(SNAPSHOT_PERIODO).forEach(col => {
    const campo = SNAPSHOT_PERIODO[col];
    fila[col] = textoSnap_(campo, m[campo]);
  });

  appendPorEncabezados_(sh, fila);
}

/* Corrige los datos del periodo actual SIN crear un periodo nuevo */
function corregirAsignacionActiva_(idMovil, m) {

  const sh = obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES);
  asegurarColumnasHoja_(sh, CONFIG.HEADERS.ASIGNACIONES);

  const { values, idx } = leerTabla_(sh);
  const cols = Object.keys(SNAPSHOT_PERIODO).filter(c => idx[c] !== undefined);

  for (let r = 1; r < values.length; r++) {

    if (String(values[r][idx.ID_Movil]) !== String(idMovil)) continue;
    if (String(values[r][idx.Activa]).toUpperCase() !== 'SI') continue;

    cols.forEach(c => {
      const campo = SNAPSHOT_PERIODO[c];
      values[r][idx[c]] = textoSnap_(campo, m[campo]);
    });

    escribirCeldas_(sh, r, values, idx, cols);
    return;
  }
}

/* A los periodos activos que aún no tienen datos se les copian los actuales de la móvil */
function completarFichaAsignaciones_() {

  const sh = obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES);
  if (sh.getLastRow() < 2) return;

  if (asegurarColumnasHoja_(sh, CONFIG.HEADERS.ASIGNACIONES) > 0) {
    formatearColumnasTexto_(sh, [
      'Tecnico_Cedula', 'Tecnico_Telefono', 'Asistente_Cedula', 'Asistente_Telefono', 'Placa'
    ]);
  }

  const { values, idx } = leerTabla_(sh);

  const mapa = {};
  obtenerMoviles_().forEach(m => { mapa[String(m.ID_Movil)] = m; });

  const tocadas = {};

  for (let r = 1; r < values.length; r++) {

    if (String(values[r][idx.Activa]).toUpperCase() !== 'SI') continue;

    const m = mapa[String(values[r][idx.ID_Movil])];
    if (!m) continue;

    Object.keys(SNAPSHOT_PERIODO).forEach(col => {

      if (idx[col] === undefined) return;
      if (String(values[r][idx[col]] || '').trim()) return;

      const campo = SNAPSHOT_PERIODO[col];
      const v = textoSnap_(campo, m[campo]);
      if (!v) return;

      values[r][idx[col]] = v;
      tocadas[col] = true;
    });
  }

  Object.keys(tocadas).forEach(col => {
    const c = idx[col];
    sh.getRange(2, c + 1, values.length - 1, 1).setValues(values.slice(1).map(f => [f[c]]));
  });
}

/* Escribe de una vez las celdas indicadas de una fila (una sola llamada al Sheet) */
function escribirCeldas_(sh, filaIdx, values, idx, nombres) {
  const cols = nombres.map(n => idx[n]);
  const c0 = Math.min.apply(null, cols);
  const c1 = Math.max.apply(null, cols);
  sh.getRange(filaIdx + 1, c0 + 1, 1, c1 - c0 + 1)
    .setValues([values[filaIdx].slice(c0, c1 + 1)]);
}

/* previo (opcional): datos de la móvil justo antes del cambio, para completar el periodo que se cierra */
function cerrarAsignacionAnterior_(idMovil, fechaFin, motivo, previo, salida) {

  const sh = obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES);
  if (sh.getLastRow() < 2) return;

  asegurarColumnasHoja_(sh, CONFIG.HEADERS.ASIGNACIONES);

  const { values, idx } = leerTabla_(sh);
  exigirColumnas_(idx, CONFIG.HEADERS.ASIGNACIONES, 'ASIGNACIONES');

  for (let r = 1; r < values.length; r++) {

    const esDeLaMovil = String(values[r][idx.ID_Movil]) === String(idMovil);
    const estaActiva = String(values[r][idx.Activa]).toUpperCase() === 'SI';
    if (!esDeLaMovil || !estaActiva) continue;

    let fin = fechaFin;
    const ini = convertirFecha_(values[r][idx.Fecha_Inicio]);
    if (ini && fin < ini) fin = ini;

    values[r][idx.Fecha_Fin] = fin;
    values[r][idx.Activa] = 'NO';
    values[r][idx.Motivo_Fin] = motivo || '';

    /* Si ese periodo no tenía datos guardados, se le ponen los que tenía la móvil */
    const cols = ['Fecha_Fin', 'Activa', 'Motivo_Fin'];

    Object.keys(SNAPSHOT_PERIODO).forEach(col => {

      if (idx[col] === undefined) return;
      cols.push(col);

      if (!previo || String(values[r][idx[col]] || '').trim()) return;

      const v = textoSnap_(SNAPSHOT_PERIODO[col], previo[SNAPSHOT_PERIODO[col]]);
      if (v) values[r][idx[col]] = v;
    });

    /* Cómo salió la persona (dejó de laborar, traslado...), si se indicó */
    if (salida) {
      Object.keys(salida).forEach(col => {
        if (idx[col] === undefined) return;
        values[r][idx[col]] = salida[col];
        cols.push(col);
      });
    }

    escribirCeldas_(sh, r, values, idx, cols);
  }
}

function ordenarAsignaciones_(arr) {
  return arr.slice().sort((a, b) => {
    const ia = convertirFecha_(a.Fecha_Inicio);
    const ib = convertirFecha_(b.Fecha_Inicio);
    const ta = ia ? ia.getTime() : 0;
    const tb = ib ? ib.getTime() : 0;
    return (ta - tb) || (a._fila - b._fila);
  });
}

function asignacionesQueCubren_(lista, desde, hasta) {
  return lista.filter(a => {
    const ini = convertirFecha_(a.Fecha_Inicio);
    const fin = convertirFecha_(a.Fecha_Fin);
    return (!ini || ini <= hasta) && (!fin || fin >= desde);
  });
}

function tecnicoEnFecha_(asignaciones, idMovil, fecha, respaldo) {
  const f = inicioDia_(fecha);
  const propias = asignaciones.filter(a => String(a.ID_Movil) === String(idMovil));
  const cubren = asignacionesQueCubren_(propias, f, f);
  if (!cubren.length) return respaldo;
  return ordenarAsignaciones_(cubren).pop().Tecnico;
}


/* =========================================================
   MOVILES (lectura)
   ========================================================= */

function obtenerMoviles_() {
  return leerObjetos_(obtenerHoja_(CONFIG.HOJAS.MOVILES));
}

function esActiva_(m) {
  return String(m.Estado || '').trim().toUpperCase() === 'ACTIVA';
}

function obtenerMovilesActivas_() {
  return obtenerMoviles_().filter(esActiva_);
}


/* =========================================================
   NORMALIZAR ESTADOS
   ========================================================= */

/* Estado diario del calendario. Vacío se queda vacío (NO es "Libre"). */
function normalizarEstado_(estado) {

  const s = String(estado || '').trim();
  if (!s) return '';

  const mapa = {
    activa: 'Activa',
    backup: 'Backup',
    respaldo: 'Backup',
    varada: 'Varada',
    libre: 'Libre'
  };

  return mapa[s.toLowerCase()] || s;
}

/* Estado de la móvil en la hoja MOVILES */
function normalizarEstadoMovil_(estado) {
  return String(estado || '').trim().toUpperCase() === 'INACTIVA'
    ? 'INACTIVA'
    : 'ACTIVA';
}


/* =========================================================
   SEMANAS ISO
   ========================================================= */

function semanaISO_(date) {

  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;

  d.setUTCDate(d.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/* Año al que pertenece la semana ISO (distinto del año calendario
   en los primeros/últimos días del año) */
function anoISO_(date) {

  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;

  d.setUTCDate(d.getUTCDate() + 4 - day);

  return d.getUTCFullYear();
}

function semanasEnAno_(year) {
  return semanaISO_(new Date(year, 11, 28));
}

function obtenerSemanaInfo_(year, week) {

  const hoy = new Date();

  year = Number(year) || anoISO_(hoy);
  week = Number(week) || semanaISO_(hoy);

  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;

  const lunes = new Date(year, 0, 4 - day + 1 + (week - 1) * 7);

  const fechas = [];
  for (let i = 0; i < 7; i++) {
    fechas.push(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i));
  }

  return { year, week, lunes, fechas };
}


/* =========================================================
   DATOS WEB
   ========================================================= */

function obtenerDatosWeb(token) {

  requerirSesion_(token, 'consulta');

  const now = new Date();
  const todas = obtenerMoviles_();

  /* Datos básicos para todos los roles; cédulas, teléfonos y correos solo en Fichas (admin) */
  const basicos = lista => limpiarParaWeb_(lista).map(o => {
    const b = {};
    CAMPOS_BASICOS_MOVIL.forEach(k => { b[k] = o[k]; });
    return b;
  });

  return {
    todasMoviles: basicos(todas),
    movilesActivas: basicos(todas.filter(esActiva_)),
    estados: CONFIG.ESTADOS,
    colores: CONFIG.COLORES,
    añoActual: anoISO_(now),
    semanaActual: semanaISO_(now)
  };
}

function obtenerSemanasWeb(token, year) {

  requerirSesion_(token, 'consulta');

  year = Number(year) || anoISO_(new Date());

  const arr = [];
  const total = semanasEnAno_(year);

  for (let w = 1; w <= total; w++) {
    const info = obtenerSemanaInfo_(year, w);
    arr.push({
      semana: w,
      inicio: formatearFecha_(info.fechas[0]),
      fin: formatearFecha_(info.fechas[6])
    });
  }

  return arr;
}


/* =========================================================
   REGISTRO (estados diarios)
   ========================================================= */

function claveRegistro_(id, fecha) {
  return String(id) + '|' + String(fecha);
}

function obtenerRegistroMapa_(desde, hasta) {

  const sh = obtenerHoja_(CONFIG.HOJAS.REGISTRO);
  const mapa = {};

  const d0 = inicioDia_(desde).getTime();
  const d1 = inicioDia_(hasta).getTime();

  leerObjetosPorFecha_(sh, 'Fecha', formatearFechaISO_(desde), formatearFechaISO_(hasta)).forEach(r => {

    const f = convertirFecha_(r.Fecha);
    if (!f) return;

    const t = f.getTime();
    if (t < d0 || t > d1) return;

    const estado = normalizarEstado_(r.Estado);
    if (!estado) return;

    mapa[claveRegistro_(r.ID_Movil, formatearFechaISO_(f))] = estado;
  });

  return mapa;
}


/* =========================================================
   MOVILES QUE APARECEN EN UNA SEMANA
   Usa ASIGNACIONES para que las semanas pasadas conserven
   la móvil y el técnico que tenían en ese momento.
   ========================================================= */

function movilesDeSemana_(info, registro) {

  const desde = inicioDia_(info.fechas[0]);
  const hasta = inicioDia_(info.fechas[6]);

  const asignaciones = leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES));

  const idsConRegistro = new Set(
    Object.keys(registro).map(k => k.split('|')[0])
  );

  const out = [];

  obtenerMoviles_().forEach(m => {

    const id = String(m.ID_Movil);
    const propias = asignaciones.filter(a => String(a.ID_Movil) === id);
    const cubren = asignacionesQueCubren_(propias, desde, hasta);

    const incluir =
      cubren.length > 0 ||
      (propias.length === 0 && esActiva_(m)) ||
      idsConRegistro.has(id);

    if (!incluir) return;

    const elegidas = ordenarAsignaciones_(cubren.length ? cubren : propias);
    const tecnico = elegidas.length
      ? elegidas[elegidas.length - 1].Tecnico
      : m.Tecnico_Actual;

    out.push({
      ID_Movil: m.ID_Movil,
      Movil: m.Movil,
      Tecnico_Actual: tecnico,
      Contrata: m.Contrata,
      Domicilio: m.Domicilio
    });
  });

  return out;
}

function filasSemana_(info) {

  const registro = obtenerRegistroMapa_(info.fechas[0], info.fechas[6]);
  const moviles = movilesDeSemana_(info, registro);
  const isos = info.fechas.map(d => formatearFechaISO_(d));

  return moviles.map(m =>
    [m.Contrata, m.Domicilio, m.Movil].concat(
      isos.map(iso => registro[claveRegistro_(m.ID_Movil, iso)] || '')
    )
  );
}


/* =========================================================
   CALENDARIO WEB
   ========================================================= */

function obtenerCalendarioWeb(token, year, week) {

  requerirSesion_(token, 'consulta');

  const info = obtenerSemanaInfo_(year, week);
  const registro = obtenerRegistroMapa_(info.fechas[0], info.fechas[6]);
  const moviles = movilesDeSemana_(info, registro);
  const dias = info.fechas.map(d => formatearFechaISO_(d));

  return {
    year: info.year,
    week: info.week,
    dias: dias,
    diasBonitos: info.fechas.map(d => formatearFechaCorta_(d)),
    moviles: moviles.map(m => ({
      ID_Movil: m.ID_Movil,
      Movil: m.Movil,
      Tecnico_Actual: m.Tecnico_Actual,
      Contrata: m.Contrata,
      Domicilio: m.Domicilio,
      estados: dias.map(f => registro[claveRegistro_(m.ID_Movil, f)] || '')
    }))
  };
}


/* =========================================================
   ROTACIÓN DE BACKUP
   Quién (técnico) ha estado de Backup en las últimas semanas,
   para no repetir a las mismas personas semana tras semana.
   ========================================================= */

function obtenerRotacionBackupWeb(token, year, week, semanas) {

  requerirSesion_(token, 'consulta');

  const n = Math.max(2, Math.min(12, Number(semanas) || 8));
  const info = obtenerSemanaInfo_(year, week);

  const hasta = inicioDia_(info.fechas[6]);
  const desde = sumarDias_(inicioDia_(info.fechas[0]), -7 * (n - 1));

  const registro = obtenerRegistroMapa_(desde, hasta);
  const asignaciones = leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES));

  const moviles = {};
  const todas = obtenerMoviles_();
  todas.forEach(m => { moviles[String(m.ID_Movil)] = m; });

  const etiquetas = [];
  for (let i = 0; i < n; i++) etiquetas.push(formatearFechaCorta_(sumarDias_(desde, 7 * i)));

  const ceros = () => { const a = []; for (let i = 0; i < n; i++) a.push(0); return a; };
  const personas = {};

  const persona = nombre => {
    const k = nombre.toLowerCase();
    return (personas[k] = personas[k] || { nombre: nombre, movil: '', activo: false, semanas: ceros(), moviles: {} });
  };

  Object.keys(registro).forEach(k => {

    if (registro[k] !== 'Backup') return;

    const partes = k.split('|');
    const id = partes[0];
    const f = partes[1].split('-').map(Number);
    const fecha = new Date(f[0], f[1] - 1, f[2]);

    const m = moviles[id];
    const nombre = txt_(tecnicoEnFecha_(asignaciones, id, fecha, m ? m.Tecnico_Actual : ''));
    if (!nombre) return;

    const dias = Math.round((inicioDia_(fecha).getTime() - desde.getTime()) / 86400000);
    const wi = Math.floor(dias / 7);
    if (wi < 0 || wi >= n) return;

    const p = persona(nombre);
    p.semanas[wi]++;
    if (m) p.moviles[String(m.Movil)] = true;
  });

  /* Técnicos que hoy están en una móvil activa (candidatos aunque nunca hayan hecho Backup) */
  todas.forEach(m => {
    if (!esActiva_(m) || !txt_(m.Tecnico_Actual)) return;
    const p = persona(txt_(m.Tecnico_Actual));
    p.activo = true;
    p.movil = String(m.Movil);
  });

  const lista = Object.keys(personas).map(k => {

    const p = personas[k];
    let ultima = -1;
    p.semanas.forEach((c, i) => { if (c > 0) ultima = i; });

    return {
      nombre: p.nombre,
      movil: p.movil || Object.keys(p.moviles).join(', '),
      activo: p.activo,
      semanas: p.semanas,
      total: p.semanas.reduce((a, b) => a + b, 0),
      ultima: ultima
    };
  });

  return { etiquetas: etiquetas, personas: lista };
}


/* =========================================================
   GUARDAR CALENDARIO
   - Un estado vacío ("--") BORRA el registro de ese día
     (la celda queda sin registro, no "Libre").
   ========================================================= */

function guardarCalendarioWeb(token, cambios, comentario) {

  const ses = requerirSesion_(token, 'operador');

  if (!Array.isArray(cambios) || !cambios.length) {
    return { ok: true, mensaje: 'No había cambios para guardar.' };
  }

  const bitacora = [];

  conBloqueo_(() => {

    const sh = obtenerHoja_(CONFIG.HOJAS.REGISTRO);
    const asignaciones = leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES));

    const mapaMov = {};
    obtenerMoviles_().forEach(m => { mapaMov[String(m.ID_Movil)] = m; });

    const { values, idx: col } = leerTabla_(sh);
    exigirColumnas_(col, ['Fecha', 'ID_Movil', 'Estado'], 'REGISTRO');

    const ncols = values[0].length;

    const indice = {};
    for (let r = 1; r < values.length; r++) {
      const id = values[r][col.ID_Movil];
      const f = convertirFecha_(values[r][col.Fecha]);
      if (id && f) indice[claveRegistro_(id, formatearFechaISO_(f))] = r;
    }

    const put = (fila, nombre, valor) => {
      if (col[nombre] !== undefined) fila[col[nombre]] = valor;
    };

    const filasOriginales = values.length;
    let minF = Infinity;
    let maxF = -1;

    const marcar = i => {
      if (i < filasOriginales) {
        if (i < minF) minF = i;
        if (i > maxF) maxF = i;
      }
    };

    cambios.forEach(c => {

      const m = mapaMov[String(c.idMovil)];
      if (!m) return;

      const fecha = convertirFecha_(c.fecha);
      if (!fecha) return;

      const estado = normalizarEstado_(c.estado);
      if (estado && CONFIG.ESTADOS.indexOf(estado) === -1) {
        throw new Error('Estado no válido: ' + c.estado);
      }

      const key = claveRegistro_(m.ID_Movil, formatearFechaISO_(fecha));
      const existente = indice[key];

      const anterior = existente !== undefined
        ? normalizarEstado_(values[existente][col.Estado])
        : '';

      if (anterior !== estado) {
        bitacora.push({
          fecha: fecha, id: m.ID_Movil, movil: m.Movil,
          anterior: anterior, nuevo: estado
        });
      }

      /* Si el estado no cambió realmente, no se toca la fila */
      if (anterior === estado) return;

      if (!estado) {
        /* Celda vacía ("--"): el registro queda con el estado en blanco,
           que equivale a "sin registro". No se borran filas (es lo lento). */
        if (existente !== undefined && anterior !== '') {
          values[existente][col.Estado] = '';
          marcar(existente);
        }
        return;
      }

      const fila = new Array(ncols).fill('');
      put(fila, 'Fecha', fecha);
      put(fila, 'ID_Movil', m.ID_Movil);
      put(fila, 'Movil', m.Movil);
      put(fila, 'Tecnico', tecnicoEnFecha_(asignaciones, m.ID_Movil, fecha, m.Tecnico_Actual));
      put(fila, 'Contrata', m.Contrata);
      put(fila, 'Domicilio', m.Domicilio);
      put(fila, 'Estado', estado);
      put(fila, 'Fecha_Registro', new Date());
      put(fila, 'Usuario', ses.usuario);

      if (existente !== undefined) {
        values[existente] = fila;
        marcar(existente);
      } else {
        values.push(fila);
        indice[key] = values.length - 1;
      }
    });

    /* Solo se reescribe el tramo que cambió + las filas nuevas al final */
    if (maxF >= 0) {
      sh.getRange(minF + 1, 1, maxF - minF + 1, ncols)
        .setValues(values.slice(minF, maxF + 1));
    }

    if (values.length > filasOriginales) {
      sh.getRange(filasOriginales + 1, 1, values.length - filasOriginales, ncols)
        .setValues(values.slice(filasOriginales));
    }
  });

  try {
    registrarHistorial_(ses, bitacora, String(comentario || '').trim().slice(0, 400));
  } catch (e) {
    Logger.log('No se pudo registrar el historial: ' + e.message);
  }

  return { ok: true, mensaje: cambios.length + ' cambio(s) guardado(s).' };
}


/* =========================================================
   HISTORIAL DE MODIFICACIONES DEL CALENDARIO
   Cada cambio queda registrado: quién, cuándo, qué móvil,
   qué día y de qué estado a qué estado. Se consulta por semana.
   ========================================================= */

function registrarHistorial_(ses, cambios, comentario) {

  if (!cambios || !cambios.length) return;

  const ss = obtenerSpreadsheet_();
  const sh = ss.getSheetByName(CONFIG.HOJAS.HISTORIAL) ||
    asegurarHoja_(ss, CONFIG.HOJAS.HISTORIAL, CONFIG.HEADERS.HISTORIAL);

  let ncols = sh.getLastColumn();
  const idx = {};
  sh.getRange(1, 1, 1, ncols).getValues()[0].forEach((h, i) => {
    const n = String(h).trim();
    if (n) idx[n] = i;
  });
  /* Hojas creadas antes de los comentarios: se agrega la columna */
  if (idx.Comentario === undefined) {
    sh.getRange(1, ncols + 1).setValue('Comentario');
    idx.Comentario = ncols;
    ncols++;
  }
  const ahora = new Date();
  const lote = 'L' + ahora.getTime() + '_' + ses.usuario;

  const filas = cambios.map(c => {

    const fila = new Array(ncols).fill('');
    const put = (n, v) => { if (idx[n] !== undefined) fila[idx[n]] = v; };

    put('Fecha_Hora', ahora);
    put('Usuario', ses.usuario);
    put('Nombre', ses.nombre);
    put('Ano', anoISO_(c.fecha));
    put('Semana', semanaISO_(c.fecha));
    put('Fecha', c.fecha);
    put('ID_Movil', c.id);
    put('Movil', c.movil);
    put('Estado_Anterior', c.anterior);
    put('Estado_Nuevo', c.nuevo);
    put('Lote', lote);
    put('Comentario', comentario || '');

    return fila;
  });

  sh.getRange(sh.getLastRow() + 1, 1, filas.length, ncols).setValues(filas);
}

/* Historial de la semana indicada (la semana del calendario que se modificó) */
function obtenerHistorialWeb(token, year, week) {

  requerirSesion_(token, 'consulta');

  const sh = obtenerSpreadsheet_().getSheetByName(CONFIG.HOJAS.HISTORIAL);
  if (!sh) return { lotes: [], resumen: [] };

  const y = Number(year);
  const w = Number(week);
  const tz = Session.getScriptTimeZone();

  const lotes = {};

  leerObjetos_(sh).forEach(r => {

    if (Number(r.Ano) !== y || Number(r.Semana) !== w) return;
    if (!(r.Fecha_Hora instanceof Date) || isNaN(r.Fecha_Hora)) return;

    const k = String(r.Lote || r.Fecha_Hora.getTime());

    if (!lotes[k]) {
      lotes[k] = {
        ts: r.Fecha_Hora.getTime(),
        fechaHora: Utilities.formatDate(r.Fecha_Hora, tz, 'dd/MM/yyyy HH:mm'),
        usuario: String(r.Usuario || ''),
        nombre: String(r.Nombre || r.Usuario || ''),
        comentario: String(r.Comentario || ''),
        cambios: []
      };
    }

    const dia = convertirFecha_(r.Fecha);

    lotes[k].cambios.push({
      movil: String(r.Movil),
      dia: dia ? DIAS_SEMANA[(dia.getDay() + 6) % 7] + ' ' + formatearFechaCorta_(dia) : '',
      anterior: String(r.Estado_Anterior || ''),
      nuevo: String(r.Estado_Nuevo || '')
    });
  });

  const lista = Object.keys(lotes).map(k => lotes[k]).sort((a, b) => b.ts - a.ts);

  /* Resumen por persona (la lista ya viene de lo más reciente a lo más antiguo) */
  const res = {};
  lista.forEach(l => {
    if (!res[l.usuario]) {
      res[l.usuario] = { usuario: l.usuario, nombre: l.nombre, cambios: 0, ultimo: l.fechaHora };
    }
    res[l.usuario].cambios += l.cambios.length;
  });

  return {
    lotes: lista.slice(0, 50).map(l => ({
      fechaHora: l.fechaHora, usuario: l.usuario, nombre: l.nombre, comentario: l.comentario, cambios: l.cambios
    })),
    resumen: Object.keys(res).map(k => res[k]).sort((a, b) => b.cambios - a.cambios)
  };
}


/* =========================================================
   AGREGAR MOVIL
   ========================================================= */

function validarMovil_(d) {
  if (!d || !String(d.movil || '').trim()) {
    throw new Error('Debe indicar el número de móvil.');
  }
}

function validarPlacaUnica_(placa, idPropio) {
  const p = String(placa || '').trim().toUpperCase();
  if (!p) return;
  const dup = obtenerMoviles_().some(m =>
    String(m.Placa || '').trim().toUpperCase() === p &&
    String(m.ID_Movil) !== String(idPropio || '')
  );
  if (dup) throw new Error('La placa ' + p + ' ya está registrada en otra móvil.');
}

function generarIdMovil_() {

  const existentes = new Set(obtenerMoviles_().map(x => String(x.ID_Movil)));
  let n = 1;

  while (existentes.has('M' + String(n).padStart(3, '0'))) n++;

  return 'M' + String(n).padStart(3, '0');
}

function agregarMovilWeb(token, datos) {

  const ses = requerirSesion_(token, 'admin');

  validarMovil_(datos);

  return conBloqueo_(() => {

    const sh = obtenerHoja_(CONFIG.HOJAS.MOVILES);
    const movil = String(datos.movil).trim();

    if (obtenerMoviles_().some(m => String(m.Movil).trim() === movil)) {
      throw new Error('La móvil ' + movil + ' ya existe.');
    }

    validarPlacaUnica_(datos.placa, '');

    const id = generarIdMovil_();
    const estado = normalizarEstadoMovil_(datos.estado);
    const fecha = datos.fechaIngreso
      ? (convertirFecha_(datos.fechaIngreso) || inicioDia_(new Date()))
      : inicioDia_(new Date());
    const tecnico = String(datos.tecnico || '').trim();

    appendPorEncabezados_(sh, {
      ID_Movil: id,
      Movil: movil,
      Tecnico_Actual: tecnico,
      Contrata: String(datos.contrata || '').trim(),
      Domicilio: String(datos.domicilio || '').trim(),
      Estado: estado,
      Fecha_Ingreso: fecha,
      Fecha_Salida: '',
      Placa: String(datos.placa || '').trim().toUpperCase(),
      Tipo_Vehiculo: String(datos.tipoVehiculo || '').trim()
    });

    if (estado === 'ACTIVA') {
      agregarAsignacion_(id, movil, fecha, { Tecnico_Actual: tecnico, Placa: datos.placa, Tipo_Vehiculo: datos.tipoVehiculo });
    }

    registrarCambiosMoviles_(
      ses,
      [{ id: id, movil: movil, campo: 'Alta de móvil', anterior: '', nuevo: movil }],
      'Web (Móviles)'
    );

    return { ok: true, id: id };
  });
}


/* =========================================================
   ACTUALIZAR MOVIL
   - Cambiar técnico cierra la asignación anterior y abre una
     nueva (con la fecha indicada), conservando el historial.
   ========================================================= */

function actualizarMovilWeb(token, datos) {

  const ses = requerirSesion_(token, 'admin');

  if (!datos || !datos.idMovil) throw new Error('Falta el ID de la móvil.');

  aplicarCambiosMoviles_(
    ses,
    [{
      idMovil: datos.idMovil,
      campos: {
        Tecnico_Actual: datos.tecnico,
        Contrata: datos.contrata,
        Domicilio: datos.domicilio,
        Placa: datos.placa,
        Tipo_Vehiculo: datos.tipoVehiculo
      }
    }],
    { fechaCambio: datos.fechaCambio, soloCorregir: !!datos.soloCorregir },
    'Web (Móviles)'
  );

  return { ok: true };
}


/* Quiénes han trabajado con una móvil y con qué vehículo (más reciente primero) */
function obtenerHistorialMovilWeb(token, idMovil) {

  requerirSesion_(token, 'consulta');

  const movil = obtenerMoviles_().find(m => String(m.ID_Movil) === String(idMovil));
  if (!movil) throw new Error('No se encontró la móvil.');

  const propias = leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES))
    .filter(a => String(a.ID_Movil) === String(idMovil));

  const filas = ordenarAsignaciones_(propias).reverse().map(a => {

    const ini = convertirFecha_(a.Fecha_Inicio);
    const fin = convertirFecha_(a.Fecha_Fin);

    return {
      desde: ini ? formatearFecha_(ini) : '',
      hasta: fin ? formatearFecha_(fin) : '',
      actual: String(a.Activa).toUpperCase() === 'SI',
      tecnico: String(a.Tecnico || '').trim(),
      asistente: String(a.Asistente || '').trim(),
      placa: String(a.Placa || '').trim(),
      tipo: String(a.Tipo_Vehiculo || '').trim(),
      motivo: String(a.Motivo_Fin || '').trim()
    };
  });

  return { movil: String(movil.Movil), filas: filas };
}


/* =========================================================
   DAR DE BAJA / REACTIVAR
   ========================================================= */

function cambiarEstadoMovil_(id, estado) {

  const sh = obtenerHoja_(CONFIG.HOJAS.MOVILES);
  const { values, idx } = leerTabla_(sh);
  exigirColumnas_(idx, ['ID_Movil', 'Estado', 'Fecha_Salida'], 'MOVILES');

  for (let r = 1; r < values.length; r++) {

    if (String(values[r][idx.ID_Movil]) !== String(id)) continue;

    values[r][idx.Estado] = estado;
    values[r][idx.Fecha_Salida] = estado === 'INACTIVA' ? inicioDia_(new Date()) : '';

    escribirCeldas_(sh, r, values, idx, ['Estado', 'Fecha_Salida']);

    return { fila: values[r], idx: idx };
  }

  throw new Error('No se encontró la móvil.');
}

function darDeBajaMovilWeb(token, idMovil) {

  const ses = requerirSesion_(token, 'admin');

  return conBloqueo_(() => {

    const r = cambiarEstadoMovil_(idMovil, 'INACTIVA');

    cerrarAsignacionAnterior_(
      idMovil, inicioDia_(new Date()), 'Baja / en desuso', objetoDesdeFila_(r.fila, r.idx)
    );

    registrarCambiosMoviles_(
      ses,
      [{ id: idMovil, movil: r.fila[r.idx.Movil], campo: 'Estado de la móvil', anterior: 'ACTIVA', nuevo: 'INACTIVA (baja)' }],
      'Web (Móviles)'
    );

    return { ok: true };
  });
}

function reactivarMovilWeb(token, idMovil) {

  const ses = requerirSesion_(token, 'admin');

  return conBloqueo_(() => {

    const r = cambiarEstadoMovil_(idMovil, 'ACTIVA');

    agregarAsignacion_(
      idMovil,
      r.fila[r.idx.Movil],
      inicioDia_(new Date()),
      objetoDesdeFila_(r.fila, r.idx)
    );

    registrarCambiosMoviles_(
      ses,
      [{ id: idMovil, movil: r.fila[r.idx.Movil], campo: 'Estado de la móvil', anterior: 'INACTIVA', nuevo: 'ACTIVA (reactivada)' }],
      'Web (Móviles)'
    );

    return { ok: true };
  });
}


/* =========================================================
   CALENDARIO (hoja)
   ========================================================= */

function actualizarCalendario_() {

  const sh = obtenerHoja_(CONFIG.HOJAS.CALENDARIO);
  const hoy = new Date();

  construirCalendarioHoja_(sh, anoISO_(hoy), semanaISO_(hoy));
}

function estiloEncabezado_(rango, fondo, texto) {
  rango
    .setFontWeight('bold')
    .setBackground(fondo)
    .setFontColor(texto)
    .setHorizontalAlignment('center');
}

function construirCalendarioHoja_(sh, year, week) {

  sh.clearContents();
  sh.clearFormats();

  const info = obtenerSemanaInfo_(year, week);
  const filas = filasSemana_(info);

  sh.getRange('A1:B2').setValues([
    ['AÑO', info.year],
    ['SEMANA', info.week]
  ]);

  sh.getRange('A4:J4').setValues([ENCABEZADO_SEMANA]);

  sh.getRange('D3:J3')
    .setNumberFormat('@')
    .setValues([info.fechas.map(d => formatearFechaCorta_(d))]);

  if (filas.length) {
    sh.getRange(5, 1, filas.length, 10).setValues(filas);
  }

  aplicarColoresEstados_(sh, 5, filas.length, 4, 7);

  estiloEncabezado_(sh.getRange(4, 1, 1, 10), '#b71c1c', '#ffffff');
  estiloEncabezado_(sh.getRange(3, 4, 1, 7), '#f9cb00', '#000000');

  sh.setFrozenRows(4);
  sh.autoResizeColumns(1, 10);
  sh.setColumnWidth(2, 150);
  sh.setColumnWidth(3, 80);
}

function aplicarColoresEstados_(sh, startRow, numRows, startCol, numCols) {

  if (numRows <= 0) return;

  const range = sh.getRange(startRow, startCol, numRows, numCols);

  const fondos = range.getValues().map(row =>
    row.map(v =>
      String(v || '').trim() === ''
        ? '#ffffff'
        : (CONFIG.COLORES[normalizarEstado_(v)] || '#ffffff')
    )
  );

  range.setBackgrounds(fondos).setHorizontalAlignment('center');
}


/* =========================================================
   EXCEL DEL CLIENTE (idéntico a su plantilla)
   - Parte de la plantilla incrustada (estilos, colores
     condicionales, lista desplegable, tabla, anchos, etc.)
     y solo reemplaza los datos de la semana.
   - Total = cantidad de móviles (fórmula SUBTOTAL de la tabla).
   ========================================================= */

const MESES_ES_ = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

function serialExcel_(d) {
  return Math.round(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000
  );
}

function xmlEsc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function nombreHojaCliente_(info) {
  return 'Semana del ' + info.fechas[0].getDate() + ' al ' + info.fechas[6].getDate();
}

function nombreArchivoCliente_(info) {
  const a = info.fechas[0];
  const b = info.fechas[6];
  if (a.getMonth() === b.getMonth()) {
    return 'Cronograma_del_' + a.getDate() + '_AL_' + b.getDate() + '_DE_' + MESES_ES_[b.getMonth()] + '.xlsx';
  }
  return 'Cronograma_del_' + a.getDate() + '_DE_' + MESES_ES_[a.getMonth()] +
    '_AL_' + b.getDate() + '_DE_' + MESES_ES_[b.getMonth()] + '.xlsx';
}

/* Datos de la semana en el orden y formato del cliente:
   Contrata | Domicilio | "111_Nombre del técnico" | 7 estados */
function datosCalendarioCliente_(info) {

  const registro = obtenerRegistroMapa_(info.fechas[0], info.fechas[6]);
  const isos = info.fechas.map(d => formatearFechaISO_(d));

  return movilesDeSemana_(info, registro)
    .map(m => {
      const movil = String(m.Movil).trim();
      const tecnico = String(m.Tecnico_Actual || '').trim();
      return {
        numero: parseInt(movil, 10),
        movil: movil,
        contrata: String(m.Contrata || '').trim(),
        domicilio: String(m.Domicilio || '').trim(),
        movilTecnico: tecnico ? movil + '_' + tecnico : movil,
        estados: isos.map(iso => {
          const e = registro[claveRegistro_(m.ID_Movil, iso)] || '';
          return CONFIG.ESTADOS.indexOf(e) !== -1 ? e : '';
        })
      };
    })
    .sort((a, b) =>
      ((isNaN(a.numero) ? 1e9 : a.numero) - (isNaN(b.numero) ? 1e9 : b.numero)) ||
      a.movil.localeCompare(b.movil)
    );
}

/* Devuelve { 'ruta/dentro/del/xlsx': 'contenido XML' } */
function construirArchivosCliente_(d) {

  const P = PLANTILLA_CLIENTE;
  const n = d.filas.length;

  if (!n) throw new Error('No hay móviles para exportar en esta semana.');

  const ultima = 12 + n;           // fila "Total"
  const lunes = serialExcel_(d.lunes);
  const hoy = serialExcel_(d.hoy);

  /* ---- cadenas compartidas ---- */
  const idxTexto = new Map();
  const textos = [];
  let refs = 0;

  const ss = t => {
    t = String(t);
    refs++;
    if (!idxTexto.has(t)) {
      idxTexto.set(t, textos.length);
      textos.push(t);
    }
    return idxTexto.get(t);
  };

  /* Q1:Q4 de la plantilla usan los índices 0..3 en este orden */
  ['Activa', 'Libre', 'Varada', 'Backup'].forEach(t => ss(t));

  const cs = (ref, s, t) => '<c r="' + ref + '" s="' + s + '" t="s"><v>' + ss(t) + '</v></c>';
  const vacia = (ref, s) => '<c r="' + ref + '" s="' + s + '"/>';
  const textoOVacia = (ref, s, t) => (String(t || '').trim() === '' ? vacia(ref, s) : cs(ref, s, t));

  /* ---- filas ---- */
  let filas = P.filas1a4
    .replace(/(<c r="R1"[^>]*><f ca="1">TODAY\(\)<\/f><v>)\d+(<\/v>)/, '$1' + hoy + '$2')
    .replace(/(<c r="R2"[^>]*><f ca="1">R1\+1<\/f><v>)\d+(<\/v>)/, '$1' + (hoy + 1) + '$2');

  /* Las 4 celdas Q1:Q4 ya cuentan como referencias */
  refs += 0;

  filas +=
    '<row r="9" spans="2:18" x14ac:dyDescent="0.25">' +
    '<c r="E9" s="3"><v>' + lunes + '</v></c>' +
    '<c r="F9" s="3"><f>E9+1</f><v>' + (lunes + 1) + '</v></c>' +
    '<c r="G9" s="3"><f t="shared" ref="G9:K9" si="0">F9+1</f><v>' + (lunes + 2) + '</v></c>' +
    '<c r="H9" s="3"><f t="shared" si="0"/><v>' + (lunes + 3) + '</v></c>' +
    '<c r="I9" s="3"><f t="shared" si="0"/><v>' + (lunes + 4) + '</v></c>' +
    '<c r="J9" s="3"><f t="shared" si="0"/><v>' + (lunes + 5) + '</v></c>' +
    '<c r="K9" s="3"><f t="shared" si="0"/><v>' + (lunes + 6) + '</v></c>' +
    '</row>';

  filas += P.fila10;

  /* Encabezado (fila 11) */
  const encabezados = ['Contrata', 'Domicilio', 'Móvil'].concat(DIAS_SEMANA);
  const colsEnc = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
  const estEnc = [5, 6, 7, 8, 8, 8, 8, 8, 8, 8];

  filas += '<row r="11" spans="2:18" x14ac:dyDescent="0.25">' +
    colsEnc.map((c, i) => cs(c + '11', estEnc[i], encabezados[i])).join('') +
    '</row>';

  /* Datos */
  const colsDias = ['E', 'F', 'G', 'H', 'I', 'J', 'K'];

  d.filas.forEach((f, i) => {

    const r = 12 + i;

    filas += '<row r="' + r + '" spans="2:11" ht="14.45" customHeight="1" x14ac:dyDescent="0.25">' +
      textoOVacia('B' + r, 10, f.contrata) +
      textoOVacia('C' + r, 11, f.domicilio) +
      textoOVacia('D' + r, 12, f.movilTecnico) +
      colsDias.map((c, k) => textoOVacia(c + r, 13, f.estados[k])).join('') +
      '</row>';
  });

  /* Total */
  filas += '<row r="' + ultima + '" spans="2:11" ht="14.45" customHeight="1" x14ac:dyDescent="0.25">' +
    cs('B' + ultima, 18, 'Total') +
    vacia('C' + ultima, 19) +
    vacia('D' + ultima, 20) +
    ['E', 'F', 'G', 'H', 'I', 'J'].map(c => vacia(c + ultima, 21)).join('') +
    '<c r="K' + ultima + '" s="21"><f>SUBTOTAL(103,Tabla23[Domingo])</f><v>' + n + '</v></c>' +
    '</row>';

  /* ---- hoja ---- */
  const rango = 'E12:K' + (11 + n);

  let hoja = P.archivos['xl/worksheets/sheet1.xml']
    .replace('{{FILAS}}', filas)
    .replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="B1:R' + ultima + '"/>')
    .split('E12:K26').join(rango);

  /* ---- tabla ---- */
  const tabla = P.archivos['xl/tables/table1.xml']
    .replace('ref="B11:K27"', 'ref="B11:K' + ultima + '"')
    .replace('ref="B11:K26"', 'ref="B11:K' + (11 + n) + '"');

  /* ---- nombre de la hoja ---- */
  const libro = P.archivos['xl/workbook.xml']
    .replace('name="Semana del 12 al 18"', 'name="' + xmlEsc_(d.nombreHoja) + '"');

  const app = P.archivos['docProps/app.xml']
    .replace('<vt:lpstr>Semana del 12 al 18</vt:lpstr>', '<vt:lpstr>' + xmlEsc_(d.nombreHoja) + '</vt:lpstr>');

  /* ---- textos compartidos ---- */
  const sst = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + refs +
    '" uniqueCount="' + textos.length + '">' +
    textos.map(t =>
      '<si><t' + (/^\s|\s$/.test(t) ? ' xml:space="preserve"' : '') + '>' + xmlEsc_(t) + '</t></si>'
    ).join('') +
    '</sst>';

  /* ---- propiedades (sin datos personales) ---- */
  const ahora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:creator>SRD Gestión Operativa</dc:creator><cp:lastModifiedBy>SRD Gestión Operativa</cp:lastModifiedBy>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + ahora + '</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + ahora + '</dcterms:modified></cp:coreProperties>';

  const salida = {};
  Object.keys(P.archivos).forEach(k => { salida[k] = P.archivos[k]; });

  salida['xl/worksheets/sheet1.xml'] = hoja;
  salida['xl/tables/table1.xml'] = tabla;
  salida['xl/workbook.xml'] = libro;
  salida['docProps/app.xml'] = app;
  salida['xl/sharedStrings.xml'] = sst;
  salida['docProps/core.xml'] = core;

  return salida;
}

/* Crea el .xlsx (blob) de la semana indicada */
function crearExcelCalendarioCliente_(year, week) {

  const info = obtenerSemanaInfo_(year, week);

  const archivos = construirArchivosCliente_({
    filas: datosCalendarioCliente_(info),
    lunes: info.fechas[0],
    hoy: new Date(),
    nombreHoja: nombreHojaCliente_(info)
  });

  const orden = [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/_rels/sheet1.xml.rels',
    'xl/tables/table1.xml',
    'xl/styles.xml',
    'xl/theme/theme1.xml',
    'xl/sharedStrings.xml',
    'xl/metadata.xml',
    'docProps/core.xml',
    'docProps/app.xml'
  ];

  const blobs = orden.map(p => Utilities.newBlob(archivos[p], 'application/xml', p));

  return Utilities.zip(blobs, nombreArchivoCliente_(info))
    .setName(nombreArchivoCliente_(info))
    .setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}


/* Carpeta de Drive donde se guardan los archivos exportados */
function carpetaExportaciones_() {
  const nombre = 'SRD - Calendarios Cliente';
  const it = DriveApp.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nombre);
}

/* Genera el .xlsx, lo guarda en Drive y devuelve los datos del archivo */
function exportarYGuardar_(year, week) {

  const blob = crearExcelCalendarioCliente_(year, week);
  const base64 = Utilities.base64Encode(blob.getBytes());
  const archivo = carpetaExportaciones_().createFile(blob);

  return {
    nombre: archivo.getName(),
    url: archivo.getUrl(),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: base64
  };
}

/* Desde el menú del Sheet */
function exportarCalendarioClienteExcelMenu() {

  soloDesdeMenu_();

  const r = exportarYGuardar_();

  SpreadsheetApp.getUi().alert(
    'Archivo creado en tu Drive (carpeta "SRD - Calendarios Cliente"):\n\n' +
    r.nombre + '\n' + r.url
  );
}

/* Desde la web */
function exportarCalendarioClienteExcelWeb(token, year, week) {
  requerirSesion_(token, 'operador');
  return exportarYGuardar_(year, week);
}

/* Ejecútala UNA vez desde el editor de Apps Script para autorizar
   el permiso de Drive (donde se guardan los Excel exportados). */
function autorizarPermisos() {
  DriveApp.getRootFolder();
  Logger.log('Permisos autorizados.');
}

/* =========================================================
   RESUMEN (estados de un día + móviles activas/inactivas)
   ========================================================= */

function calcularResumen_(fecha) {

  const d = fecha ? (convertirFecha_(fecha) || inicioDia_(new Date())) : inicioDia_(new Date());
  const iso = formatearFechaISO_(d);

  const moviles = obtenerMoviles_();
  const activas = moviles.filter(esActiva_);
  const registro = obtenerRegistroMapa_(d, d);

  const estados = {};
  CONFIG.ESTADOS.forEach(e => { estados[e] = 0; });

  let sinRegistro = 0;

  activas.forEach(m => {
    const e = registro[claveRegistro_(m.ID_Movil, iso)];
    if (e && estados[e] !== undefined) estados[e]++;
    else sinRegistro++;
  });

  return {
    fecha: iso,
    fechaBonita: formatearFecha_(d),
    total: moviles.length,
    activas: activas.length,
    inactivas: moviles.length - activas.length,
    tecnicos: activas.filter(m => String(m.Tecnico_Actual || '').trim()).length,
    estados: estados,
    sinRegistro: sinRegistro
  };
}

function obtenerResumenWeb(token, fecha) {
  requerirSesion_(token, 'consulta');
  return calcularResumen_(fecha);
}

function actualizarResumen_() {

  const sh = obtenerHoja_(CONFIG.HOJAS.RESUMEN);
  const r = calcularResumen_();

  sh.clearContents();

  const filas = [['Estado', 'Cantidad']];
  CONFIG.ESTADOS.forEach(e => filas.push([e, r.estados[e]]));
  filas.push(['Sin registro', r.sinRegistro]);
  filas.push(['INACTIVA', r.inactivas]);

  sh.getRange(1, 1, filas.length, 2).setValues(filas);
  sh.getRange('D1').setValue('Resumen del día: ' + r.fechaBonita);

  estiloEncabezado_(sh.getRange(1, 1, 1, 2), '#b71c1c', '#ffffff');
}


/* =========================================================
   VERIFICAR SISTEMA
   ========================================================= */

function verificarSistema() {

  soloDesdeMenu_();

  const ss = obtenerSpreadsheet_();
  const ui = SpreadsheetApp.getUi();

  const faltantes = Object.keys(CONFIG.HOJAS)
    .map(k => CONFIG.HOJAS[k])
    .filter(n => !ss.getSheetByName(n));

  if (faltantes.length) {
    ui.alert(
      'VERIFICACIÓN DEL SISTEMA\n\nHojas faltantes: ' + faltantes.join(', ') +
      '\n\nEjecuta "Configurar / reparar sistema".'
    );
    return;
  }

  const problemas = [];

  ['MOVILES', 'ASIGNACIONES', 'REGISTRO'].forEach(k => {
    const { idx } = leerTabla_(ss.getSheetByName(CONFIG.HOJAS[k]));
    const fal = CONFIG.HEADERS[k].filter(h => idx[h] === undefined);
    if (fal.length) {
      problemas.push('Columnas faltantes en ' + CONFIG.HOJAS[k] + ': ' + fal.join(', '));
    }
  });

  const duplicados = arr => {
    const vistos = new Set();
    const rep = new Set();
    arr.forEach(v => {
      if (!v) return;
      if (vistos.has(v)) rep.add(v);
      vistos.add(v);
    });
    return Array.from(rep);
  };

  const mov = obtenerMoviles_();
  const asg = leerObjetos_(ss.getSheetByName(CONFIG.HOJAS.ASIGNACIONES));
  const reg = leerObjetos_(ss.getSheetByName(CONFIG.HOJAS.REGISTRO));

  const idsDup = duplicados(mov.map(m => String(m.ID_Movil)));
  if (idsDup.length) problemas.push('ID_Movil repetidos: ' + idsDup.join(', '));

  const placasDup = duplicados(mov.map(m => String(m.Placa || '').trim().toUpperCase()));
  if (placasDup.length) problemas.push('Placas repetidas: ' + placasDup.join(', '));

  ui.alert(
    'VERIFICACIÓN DEL SISTEMA\n\n' +
    'Móviles registradas: ' + mov.length + '\n' +
    'Móviles activas: ' + mov.filter(esActiva_).length + '\n' +
    'Asignaciones históricas: ' + asg.length + '\n' +
    'Registros de calendario: ' + reg.length + '\n\n' +
    (problemas.length ? 'PROBLEMAS:\n- ' + problemas.join('\n- ') : 'Sin problemas detectados.')
  );
}


/* =========================================================
   FORMATO DE HOJAS
   ========================================================= */

function formatearHojas_() {

  const ss = obtenerSpreadsheet_();

  ['MOVILES', 'ASIGNACIONES', 'REGISTRO'].forEach(k => {

    const sh = ss.getSheetByName(CONFIG.HOJAS[k]);
    if (!sh) return;

    const cols = Math.max(sh.getLastColumn(), CONFIG.HEADERS[k].length);

    sh.getRange(1, 1, 1, cols)
      .setFontWeight('bold')
      .setBackground('#b71c1c')
      .setFontColor('#ffffff');

    sh.setFrozenRows(1);

    if (k === 'MOVILES') sh.autoResizeColumns(1, cols);
  });
}


/* =========================================================
   FECHAS
   ========================================================= */

function convertirFecha_(v) {

  if (v instanceof Date && !isNaN(v)) return inicioDia_(v);
  if (!v) return null;

  const s = String(v).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const p = s.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  const dt = new Date(s);
  return isNaN(dt) ? null : inicioDia_(dt);
}

function inicioDia_(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sumarDias_(d, n) {
  const x = inicioDia_(d);
  x.setDate(x.getDate() + n);
  return x;
}

function p2_(n) {
  return String(n).padStart(2, '0');
}

function formatearFechaISO_(d) {
  const x = new Date(d);
  return x.getFullYear() + '-' + p2_(x.getMonth() + 1) + '-' + p2_(x.getDate());
}

function formatearFecha_(d) {
  const x = new Date(d);
  return p2_(x.getDate()) + '/' + p2_(x.getMonth() + 1) + '/' + x.getFullYear();
}

function formatearFechaCorta_(d) {
  const x = new Date(d);
  return p2_(x.getDate()) + '/' + p2_(x.getMonth() + 1);
}


/* =========================================================
   FICHAS DE MÓVILES (datos del archivo mensual SRD_<MES>_<AÑO>.xlsx)
   - Una ficha por móvil: técnico, asistente, vehículo y ubicación.
   - Cada cambio queda registrado campo por campo (hoja CAMBIOS_MOVILES).
   - Si cambia el técnico, el asistente o el vehículo, se abre un periodo
     nuevo en el historial (hoja ASIGNACIONES) con los datos de ese momento.
   - Se exporta con el formato exacto del archivo que se entrega cada mes.
   ========================================================= */

const HOJA_IMPORTAR = 'IMPORTAR_FICHAS';

/* Columnas del archivo mensual, en su orden (A a V) */
const FICHA_COLUMNAS = [
  { col: 'A', titulo: 'Fecha de ingreso', campo: 'Fecha_Ingreso', tipo: 'fecha', ancho: 16.66, estilo: 3 },
  { col: 'B', titulo: 'Empresa', campo: 'Contrata', ancho: 9 },
  { col: 'C', titulo: 'ID MOVIL', campo: 'ID_Movil_TLC', ancho: 10.66, estilo: 5 },
  { col: 'D', titulo: 'Movil', campo: 'Movil', tipo: 'numero', ancho: 8.1, solo: true },
  { col: 'E', titulo: 'Tecnologia', campo: 'Tecnologia', ancho: 11 },
  { col: 'F', titulo: 'Tecnico', campo: 'Tecnico_Actual', ancho: 28.44 },
  { col: 'G', titulo: 'Ced//Pass', campo: 'Tecnico_Cedula', tipo: 'cedula', ancho: 15.66 },
  { col: 'H', titulo: 'Nota de ingreso', campo: 'Tecnico_Nota_Ingreso', ancho: 15.78, estilo: 5, rosa: true },
  { col: 'I', titulo: '**Tel importante**', campo: 'Tecnico_Telefono', ancho: 21 },
  { col: 'J', titulo: 'Correo electrónico', campo: 'Tecnico_Correo', ancho: 36.78 },
  { col: 'K', titulo: 'Asistente Tecnico', campo: 'Asistente', ancho: 33.22 },
  { col: 'L', titulo: '**Tel importante**', campo: 'Asistente_Telefono', ancho: 19.44 },
  { col: 'M', titulo: 'Ced//Pass', campo: 'Asistente_Cedula', tipo: 'cedula', ancho: 17.78 },
  { col: 'N', titulo: 'Nota de ingreso', campo: 'Asistente_Nota_Ingreso', ancho: 15.78, estilo: 5, rosa: true },
  { col: 'O', titulo: 'Correo electrónico', campo: 'Asistente_Correo', ancho: 40.78 },
  { col: 'P', titulo: 'Año del vehículo', campo: 'Anio_Vehiculo', tipo: 'numero', ancho: 16.66 },
  { col: 'Q', titulo: 'Antigüedad', campo: '', calculada: true, ancho: 11.78 },
  { col: 'R', titulo: 'Placa', campo: 'Placa', ancho: 12.1 },
  { col: 'S', titulo: 'Modelo// Color', campo: 'Modelo_Color', ancho: 39 },
  { col: 'T', titulo: 'Provincia', campo: 'Provincia', ancho: 15.44 },
  { col: 'U', titulo: 'Canton', campo: 'Canton', ancho: 21.33 },
  { col: 'V', titulo: 'Region', campo: 'Region', ancho: 10.66, estilo: 5 }
];

/* Campos que se pueden editar desde las fichas o desde "Editar móvil" */
const CAMPOS_EDITABLES_FICHA = FICHA_COLUMNAS
  .filter(c => c.campo && c.campo !== 'Movil')
  .map(c => c.campo)
  .concat(['Domicilio', 'Tipo_Vehiculo', 'Tecnico_Foto', 'Asistente_Foto', 'Direccion_Exacta', 'Ubicacion_GPS']);

/* Si cambia alguno de estos, se abre un periodo nuevo en el historial */
const CAMPOS_PERIODO = ['Tecnico_Actual', 'Asistente', 'Placa', 'Tipo_Vehiculo'];

/* Columna de ASIGNACIONES -> campo de MOVILES (datos que se guardan en cada periodo) */
const SNAPSHOT_PERIODO = {
  Tecnico: 'Tecnico_Actual',
  Tecnico_Cedula: 'Tecnico_Cedula',
  Tecnico_Telefono: 'Tecnico_Telefono',
  Tecnico_Correo: 'Tecnico_Correo',
  Asistente: 'Asistente',
  Asistente_Cedula: 'Asistente_Cedula',
  Asistente_Telefono: 'Asistente_Telefono',
  Asistente_Correo: 'Asistente_Correo',
  Placa: 'Placa',
  Tipo_Vehiculo: 'Tipo_Vehiculo',
  Tecnico_Foto: 'Tecnico_Foto',
  Asistente_Foto: 'Asistente_Foto'
};

const ETIQUETA_CAMPO_ = {
  Fecha_Ingreso: 'Fecha de ingreso',
  Contrata: 'Empresa',
  ID_Movil_TLC: 'ID MOVIL (TLC)',
  Tecnologia: 'Tecnología',
  Tecnico_Actual: 'Técnico',
  Tecnico_Cedula: 'Técnico · Cédula/Pasaporte',
  Tecnico_Nota_Ingreso: 'Técnico · Nota de ingreso',
  Tecnico_Telefono: 'Técnico · Teléfono',
  Tecnico_Correo: 'Técnico · Correo',
  Asistente: 'Asistente técnico',
  Asistente_Telefono: 'Asistente · Teléfono',
  Asistente_Cedula: 'Asistente · Cédula/Pasaporte',
  Asistente_Nota_Ingreso: 'Asistente · Nota de ingreso',
  Asistente_Correo: 'Asistente · Correo',
  Anio_Vehiculo: 'Año del vehículo',
  Placa: 'Placa',
  Modelo_Color: 'Modelo / Color',
  Provincia: 'Provincia',
  Canton: 'Cantón',
  Region: 'Región',
  Domicilio: 'Zona de trabajo',
  Direccion_Exacta: 'Dirección exacta',
  Ubicacion_GPS: 'Ubicación GPS',
  Tipo_Vehiculo: 'Tipo de vehículo',
  Tecnico_Foto: 'Técnico · Foto',
  Asistente_Foto: 'Asistente · Foto'
};

const MESES_FICHA_ = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];


/* ---------- utilidades ---------- */

function txt_(v) {
  if (v instanceof Date) return isNaN(v) ? '' : formatearFechaISO_(v);
  return String(v == null ? '' : v).trim();
}

/* Valor tal como se guarda en el Sheet */
function valorCampo_(campo, v) {

  if (/_Foto$/.test(campo)) {
    const f = String(v == null ? '' : v).trim();
    if (!f) return '';
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(f)) throw new Error('La foto no tiene un formato válido.');
    if (f.length > 45000) throw new Error('La foto es demasiado pesada; prueba con otra más pequeña.');
    return f;
  }

  if (campo === 'Ubicacion_GPS') return normalizarGps_(v);

  if (campo === 'Fecha_Ingreso') {
    return convertirFecha_(v) || '';
  }

  if (campo === 'Anio_Vehiculo') {
    const s = txt_(v);
    if (!s) return '';
    const n = Number(s);
    return isNaN(n) ? s : n;
  }

  const s = txt_(v);
  return campo === 'Placa' ? s.toUpperCase() : s;
}

function objetoDesdeFila_(fila, idx) {
  const o = {};
  Object.keys(idx).forEach(k => { o[k] = fila[idx[k]]; });
  return o;
}

/* Pone formato "texto" a columnas con números largos (cédulas, teléfonos, placas) */
function formatearColumnasTexto_(sh, nombres) {

  const lc = sh.getLastColumn();
  if (!lc) return;

  const enc = sh.getRange(1, 1, 1, lc).getValues()[0].map(x => String(x).trim());
  const filas = Math.max(sh.getMaxRows(), 2);

  nombres.forEach(n => {
    const c = enc.indexOf(n);
    if (c !== -1) sh.getRange(1, c + 1, filas, 1).setNumberFormat('@');
  });
}

function ocultarColumnasFoto_(sh) {

  if (!sh || !sh.hideColumns) return;

  const lc = sh.getLastColumn();
  if (!lc) return;

  sh.getRange(1, 1, 1, lc).getValues()[0].forEach((h, i) => {
    if (/_Foto$/.test(String(h).trim())) sh.hideColumns(i + 1);
  });
}

function prepararFormatosMoviles_() {

  const ss = obtenerSpreadsheet_();

  const mov = ss.getSheetByName(CONFIG.HOJAS.MOVILES);
  if (mov) {
    formatearColumnasTexto_(mov, [
      'Tecnico_Cedula', 'Tecnico_Telefono', 'Asistente_Cedula',
      'Asistente_Telefono', 'Placa', 'ID_Movil_TLC'
    ]);
  }

  const asg = ss.getSheetByName(CONFIG.HOJAS.ASIGNACIONES);
  if (asg) {
    formatearColumnasTexto_(asg, [
      'Tecnico_Cedula', 'Tecnico_Telefono', 'Asistente_Cedula', 'Asistente_Telefono', 'Placa'
    ]);
  }

  ocultarColumnasFoto_(mov);
  ocultarColumnasFoto_(asg);
}

function validarPlacaUnicaEn_(values, idx, placa, filaPropia) {

  const p = String(placa || '').trim().toUpperCase();
  if (!p) return;

  for (let r = 1; r < values.length; r++) {
    if (r === filaPropia) continue;
    if (String(values[r][idx.Placa] || '').trim().toUpperCase() === p) {
      throw new Error('La placa ' + p + ' ya está registrada en la móvil ' + values[r][idx.Movil] + '.');
    }
  }
}

function motivoPeriodo_(cambiados) {

  const partes = [];
  if (cambiados.indexOf('Tecnico_Actual') !== -1) partes.push('técnico');
  if (cambiados.indexOf('Asistente') !== -1) partes.push('asistente');
  if (cambiados.indexOf('Placa') !== -1 || cambiados.indexOf('Tipo_Vehiculo') !== -1) partes.push('vehículo');

  if (partes.length < 2) return 'Cambio de ' + (partes[0] || 'datos');

  return 'Cambio de ' + partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}


/* ---------- registro de cambios ---------- */

function registrarCambiosMoviles_(ses, lista, origen) {

  if (!lista || !lista.length) return;

  const ss = obtenerSpreadsheet_();
  const sh = ss.getSheetByName(CONFIG.HOJAS.CAMBIOS) ||
    asegurarHoja_(ss, CONFIG.HOJAS.CAMBIOS, CONFIG.HEADERS.CAMBIOS);

  const ncols = sh.getLastColumn();
  const idx = {};
  sh.getRange(1, 1, 1, ncols).getValues()[0].forEach((h, i) => {
    const n = String(h).trim();
    if (n) idx[n] = i;
  });

  const ahora = new Date();
  const lote = 'C' + ahora.getTime() + '_' + ses.usuario;

  const filas = lista.map(c => {

    const fila = new Array(ncols).fill('');
    const put = (n, v) => { if (idx[n] !== undefined) fila[idx[n]] = v; };

    put('Fecha_Hora', ahora);
    put('Usuario', ses.usuario);
    put('Nombre', ses.nombre);
    put('ID_Movil', c.id);
    put('Movil', c.movil);
    put('Campo', ETIQUETA_CAMPO_[c.campo] || c.campo);
    put('Valor_Anterior', c.anterior);
    put('Valor_Nuevo', c.nuevo);
    put('Lote', lote);
    put('Origen', origen || '');

    return fila;
  });

  const inicio = sh.getLastRow() + 1;

  [idx.Valor_Anterior, idx.Valor_Nuevo].forEach(c => {
    if (c !== undefined) sh.getRange(inicio, c + 1, filas.length, 1).setNumberFormat('@');
  });

  sh.getRange(inicio, 1, filas.length, ncols).setValues(filas);
}


/* ---------- motor de cambios (lo usan Fichas, Editar móvil e Importación) ---------- */

function aplicarCambiosMoviles_(ses, cambios, opciones, origen) {

  opciones = opciones || {};

  return conBloqueo_(() => {

    const sh = obtenerHoja_(CONFIG.HOJAS.MOVILES);

    if (asegurarColumnasHoja_(sh, CONFIG.HEADERS.MOVILES) > 0) {
      formatearColumnasTexto_(sh, [
        'Tecnico_Cedula', 'Tecnico_Telefono', 'Asistente_Cedula',
        'Asistente_Telefono', 'Placa', 'ID_Movil_TLC', 'Direccion_Exacta', 'Ubicacion_GPS'
      ]);
      ocultarColumnasFoto_(sh);
    }

    const { values, idx } = leerTabla_(sh);
    exigirColumnas_(idx, CONFIG.HEADERS.MOVILES, 'MOVILES');

    const filaPorId = {};
    for (let r = 1; r < values.length; r++) filaPorId[String(values[r][idx.ID_Movil])] = r;

    const bitacora = [];
    const tocadas = [];
    let minF = Infinity;
    let maxF = -1;

    cambios.forEach(c => {

      const r = filaPorId[String(c.idMovil)];
      if (r === undefined) throw new Error('No se encontró la móvil.');

      const cambiados = [];
      const anteriores = {};

      Object.keys(c.campos || {}).forEach(campo => {

        if (CAMPOS_EDITABLES_FICHA.indexOf(campo) === -1) return;
        if (idx[campo] === undefined) return;

        const nuevo = valorCampo_(campo, c.campos[campo]);
        const anterior = values[r][idx[campo]];

        if (txt_(anterior) === txt_(nuevo)) return;

        if (campo === 'Placa') validarPlacaUnicaEn_(values, idx, nuevo, r);

        values[r][idx[campo]] = nuevo;
        cambiados.push(campo);
        anteriores[campo] = anterior;

        const esFoto = /_Foto$/.test(campo);

        bitacora.push({
          id: values[r][idx.ID_Movil],
          movil: values[r][idx.Movil],
          campo: campo,
          anterior: esFoto ? (txt_(anterior) ? 'Foto anterior' : '(sin foto)') : txt_(anterior),
          nuevo: esFoto ? (txt_(nuevo) ? 'Foto nueva' : '(sin foto)') : txt_(nuevo)
        });
      });

      if (cambiados.length) {
        tocadas.push({ r: r, cambiados: cambiados, anteriores: anteriores });
        if (r < minF) minF = r;
        if (r > maxF) maxF = r;
      }
    });

    if (maxF >= 0) {
      sh.getRange(minF + 1, 1, maxF - minF + 1, values[0].length)
        .setValues(values.slice(minF, maxF + 1));
    }

    /* Historial de periodos (técnico / asistente / vehículo) */
    tocadas.forEach(p => {

      const fila = values[p.r];
      if (String(fila[idx.Estado]).toUpperCase() !== 'ACTIVA') return;

      const idM = fila[idx.ID_Movil];
      const actual = objetoDesdeFila_(fila, idx);
      const cambiaPeriodo = p.cambiados.some(k => CAMPOS_PERIODO.indexOf(k) !== -1);

      if (cambiaPeriodo && !opciones.soloCorregir) {

        const fechaCambio = opciones.fechaCambio
          ? convertirFecha_(opciones.fechaCambio)
          : inicioDia_(new Date());

        if (!fechaCambio) throw new Error('La fecha del cambio no es válida.');

        const previo = Object.assign({}, actual);
        Object.keys(p.anteriores).forEach(k => { previo[k] = p.anteriores[k]; });

        const salida = {};
        const salidas = opciones.salidas || {};

        [['Tecnico', 'Tecnico_Actual', 'técnico'], ['Asistente', 'Asistente', 'asistente']].forEach(r3 => {

          const s = salidas[r3[0].toLowerCase()];
          const quienSale = txt_(p.anteriores[r3[1]]);

          if (!s || !quienSale || p.cambiados.indexOf(r3[1]) === -1) return;

          salida[r3[0] + '_Salida'] = txt_(s.estado);
          salida[r3[0] + '_Motivo_Salida'] = txt_(s.motivo);
          salida[r3[0] + '_Obs_Salida'] = txt_(s.obs);

          bitacora.push({
            id: idM,
            movil: fila[idx.Movil],
            campo: 'Salida de ' + r3[2],
            anterior: quienSale,
            nuevo: [txt_(s.estado), txt_(s.motivo), txt_(s.obs)].filter(Boolean).join(' · ')
          });
        });

        cerrarAsignacionAnterior_(idM, sumarDias_(fechaCambio, -1), motivoPeriodo_(p.cambiados), previo, salida);
        agregarAsignacion_(idM, fila[idx.Movil], fechaCambio, actual);

      } else {

        corregirAsignacionActiva_(idM, actual);
      }

      const tecAntes = txt_('Tecnico_Actual' in p.anteriores ? p.anteriores.Tecnico_Actual : fila[idx.Tecnico_Actual]);
      const asiAntes = txt_('Asistente' in p.anteriores ? p.anteriores.Asistente : fila[idx.Asistente]);
      const tecAhora = txt_(fila[idx.Tecnico_Actual]);
      const asiAhora = txt_(fila[idx.Asistente]);

      if ((tecAntes || asiAntes) && !tecAhora && !asiAhora) {
        bitacora.push({ id: idM, movil: fila[idx.Movil], campo: 'Móvil disponible para otro personal',
          anterior: [tecAntes, asiAntes].filter(Boolean).join(' / '), nuevo: 'Sin técnicos' });
      } else if (!tecAntes && !asiAntes && (tecAhora || asiAhora)) {
        bitacora.push({ id: idM, movil: fila[idx.Movil], campo: 'Móvil con personal asignado',
          anterior: 'Sin técnicos', nuevo: [tecAhora, asiAhora].filter(Boolean).join(' / ') });
      }
    });

    registrarCambiosMoviles_(ses, bitacora, origen);

    return { moviles: tocadas.length, campos: bitacora.length };
  });
}


/* ---------- fichas (web) ---------- */

function fichaParaWeb_(m) {

  const o = { ID_Movil: m.ID_Movil, Movil: m.Movil, Estado: String(m.Estado || '').toUpperCase() };

  FICHA_COLUMNAS.concat([{ campo: 'Domicilio' }, { campo: 'Tipo_Vehiculo' }, { campo: 'Tecnico_Foto' }, { campo: 'Asistente_Foto' }, { campo: 'Direccion_Exacta' }, { campo: 'Ubicacion_GPS' }]).forEach(c => {
    if (!c.campo || c.campo === 'Movil') return;
    const v = m[c.campo];
    o[c.campo] = v instanceof Date ? (isNaN(v) ? '' : formatearFechaISO_(v)) : (v == null ? '' : v);
  });

  return o;
}

function obtenerFichasWeb(token) {

  requerirSesion_(token, 'admin');

  const moviles = obtenerMoviles_()
    .sort((a, b) => (parseInt(a.Movil, 10) || 0) - (parseInt(b.Movil, 10) || 0))
    .map(fichaParaWeb_);

  return {
    columnas: FICHA_COLUMNAS.map(c => ({
      col: c.col, titulo: c.titulo, campo: c.campo, tipo: c.tipo || 'texto',
      ancho: c.ancho, solo: !!c.solo, calculada: !!c.calculada, rosa: !!c.rosa
    })),
    etiquetas: ETIQUETA_CAMPO_,
    moviles: moviles
  };
}

function guardarFichasWeb(token, cambios, opciones) {

  const ses = requerirSesion_(token, 'admin');

  if (!Array.isArray(cambios) || !cambios.length) {
    return { ok: true, moviles: 0, campos: 0 };
  }

  const r = aplicarCambiosMoviles_(ses, cambios, opciones || {}, 'Web (Fichas)');

  return { ok: true, moviles: r.moviles, campos: r.campos };
}

/* Todas las personas que han trabajado como técnico o asistente, con su móvil, fechas y,
   si ya no laboran, por qué salieron. Los periodos seguidos de la misma persona en la
   misma móvil se unen en una sola fila. */
function obtenerPersonalWeb(token) {

  requerirSesion_(token, 'admin');

  const crudos = [];

  leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES)).forEach(a => {

    const ini = convertirFecha_(a.Fecha_Inicio);
    const fin = convertirFecha_(a.Fecha_Fin);

    const base = {
      id: txt_(a.ID_Asignacion),
      movil: txt_(a.Movil),
      placa: txt_(a.Placa),
      ini: ini ? ini.getTime() : 0,
      fin: fin ? fin.getTime() : null,
      actual: String(a.Activa).toUpperCase() === 'SI',
      cambio: txt_(a.Motivo_Fin)
    };

    if (txt_(a.Tecnico)) {
      crudos.push(Object.assign({
        rol: 'Técnico', nombre: txt_(a.Tecnico), cedula: txt_(a.Tecnico_Cedula),
        telefono: txt_(a.Tecnico_Telefono), correo: txt_(a.Tecnico_Correo),
        salida: txt_(a.Tecnico_Salida), motivoSalida: txt_(a.Tecnico_Motivo_Salida),
        obsSalida: txt_(a.Tecnico_Obs_Salida), foto: txt_(a.Tecnico_Foto)
      }, base));
    }

    if (txt_(a.Asistente)) {
      crudos.push(Object.assign({
        rol: 'Asistente', nombre: txt_(a.Asistente), cedula: txt_(a.Asistente_Cedula),
        telefono: txt_(a.Asistente_Telefono), correo: txt_(a.Asistente_Correo),
        salida: txt_(a.Asistente_Salida), motivoSalida: txt_(a.Asistente_Motivo_Salida),
        obsSalida: txt_(a.Asistente_Obs_Salida), foto: txt_(a.Asistente_Foto)
      }, base));
    }
  });

  /* Unir periodos seguidos (mismo rol, nombre y móvil) */
  const grupos = {};
  crudos.forEach(c => {
    const k = [c.rol, c.nombre.toLowerCase(), c.movil].join('|');
    (grupos[k] = grupos[k] || []).push(c);
  });

  const DIA = 86400000;
  const unidos = [];

  Object.keys(grupos).forEach(k => {

    const lista = grupos[k].sort((x, y) => x.ini - y.ini);
    let cur = null;

    lista.forEach(c => {

      if (cur && (cur.actual || (cur.fin !== null && c.ini - cur.fin <= 2 * DIA))) {
        /* continúa el mismo tramo: se queda con los datos más recientes y completa lo que falte */
        cur.fin = c.fin;
        cur.actual = c.actual;
        cur.cambio = c.cambio;
        cur.id = c.id;
        cur.salida = c.salida;
        cur.motivoSalida = c.motivoSalida;
        cur.obsSalida = c.obsSalida;
        ['cedula', 'telefono', 'correo', 'placa', 'foto'].forEach(f => { if (c[f]) cur[f] = c[f]; });
        return;
      }

      cur = Object.assign({}, c);
      unidos.push(cur);
    });
  });

  unidos.sort((x, y) => x.nombre.localeCompare(y.nombre) || y.ini - x.ini);

  return unidos.map(o => {

    let estado = 'Trabaja actualmente';

    if (!o.actual) {
      estado = o.salida || (/baja/i.test(o.cambio) ? 'Móvil dada de baja' : 'Sin registrar');
    }

    return {
      id: o.id,
      rol: o.rol,
      nombre: o.nombre,
      cedula: o.cedula,
      telefono: o.telefono,
      correo: o.correo,
      foto: o.foto || '',
      movil: o.movil,
      placa: o.placa,
      iniTs: o.ini || 0,
      finTs: o.fin,
      desde: o.ini ? formatearFecha_(new Date(o.ini)) : '',
      hasta: (o.actual || o.fin === null) ? '' : formatearFecha_(new Date(o.fin)),
      actual: o.actual,
      estado: estado,
      motivoSalida: o.actual ? '' : o.motivoSalida,
      obsSalida: o.actual ? '' : o.obsSalida
    };
  });
}


/* =========================================================
   REINCORPORAR, VEHÍCULOS Y DESHACER "SIN TÉCNICOS"
   ========================================================= */

/* Deja solo letras y números (para comparar cédulas y placas: 1-0234-0567 = 102340567, CL 366147 = cl366147) */
function normId_(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ¿Esta cédula ya trabajó con nosotros? Devuelve sus datos más recientes y sus tramos, o null */
function buscarPersonaWeb(token, cedula) {

  requerirSesion_(token, 'admin');

  const k = normId_(cedula);
  if (k.length < 5) return null;

  const tramos = [];

  leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES)).forEach(a => {

    [['Técnico', 'Tecnico'], ['Asistente', 'Asistente']].forEach(r => {

      const nombre = txt_(a[r[1]]);
      if (!nombre || normId_(a[r[1] + '_Cedula']) !== k) return;

      const ini = convertirFecha_(a.Fecha_Inicio);
      const fin = convertirFecha_(a.Fecha_Fin);
      const actual = String(a.Activa).toUpperCase() === 'SI';

      tramos.push({
        rol: r[0],
        nombre: nombre,
        cedula: txt_(a[r[1] + '_Cedula']),
        telefono: txt_(a[r[1] + '_Telefono']),
        correo: txt_(a[r[1] + '_Correo']),
        foto: txt_(a[r[1] + '_Foto']),
        movil: txt_(a.Movil),
        ini: ini ? ini.getTime() : 0,
        actual: actual,
        desde: ini ? formatearFecha_(ini) : '',
        hasta: (!actual && fin) ? formatearFecha_(fin) : '',
        salida: txt_(a[r[1] + '_Salida']),
        motivo: txt_(a[r[1] + '_Motivo_Salida'])
      });
    });
  });

  if (!tramos.length) return null;

  tramos.sort((x, y) => y.ini - x.ini);

  const ultimo = tramos[0];
  const dato = f => { const t = tramos.find(x => x[f]); return t ? t[f] : ''; };
  const act = tramos.find(x => x.actual);

  return {
    nombre: ultimo.nombre,
    cedula: dato('cedula'),
    telefono: dato('telefono'),
    correo: dato('correo'),
    foto: dato('foto'),
    activoAhora: !!act,
    movilActual: act ? act.movil : '',
    ultimaSalida: (!ultimo.actual && (ultimo.salida || ultimo.hasta))
      ? { estado: ultimo.salida, motivo: ultimo.motivo, hasta: ultimo.hasta, movil: ultimo.movil } : null,
    tramos: tramos.slice(0, 8).map(t => ({
      rol: t.rol, movil: t.movil, desde: t.desde, hasta: t.hasta, actual: t.actual
    }))
  };
}

/* Historial por vehículo (placa): qué móviles y qué personas lo han usado */
function obtenerVehiculosWeb(token) {

  requerirSesion_(token, 'consulta');

  const mapa = {};

  leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES)).forEach(a => {

    const placa = txt_(a.Placa).toUpperCase();
    const k = normId_(placa);
    if (!k) return;

    const v = mapa[k] = mapa[k] || { placa: placa, tipo: '', modelo: '', anio: '', movilActual: '', periodos: [] };

    const ini = convertirFecha_(a.Fecha_Inicio);
    const fin = convertirFecha_(a.Fecha_Fin);
    const actual = String(a.Activa).toUpperCase() === 'SI';

    if (txt_(a.Tipo_Vehiculo)) v.tipo = txt_(a.Tipo_Vehiculo);
    if (actual) v.movilActual = txt_(a.Movil);

    v.periodos.push({
      movil: txt_(a.Movil),
      ini: ini ? ini.getTime() : 0,
      desde: ini ? formatearFecha_(ini) : '',
      hasta: (!actual && fin) ? formatearFecha_(fin) : '',
      actual: actual,
      tecnico: txt_(a.Tecnico),
      asistente: txt_(a.Asistente),
      motivo: txt_(a.Motivo_Fin)
    });
  });

  /* Modelo y año salen de la ficha de la móvil que lo usa hoy */
  obtenerMoviles_().forEach(m => {
    const v = mapa[normId_(m.Placa)];
    if (!v) return;
    if (txt_(m.Modelo_Color)) v.modelo = txt_(m.Modelo_Color);
    if (txt_(m.Anio_Vehiculo)) v.anio = txt_(m.Anio_Vehiculo);
    if (txt_(m.Tipo_Vehiculo) && !v.tipo) v.tipo = txt_(m.Tipo_Vehiculo);
  });

  return Object.keys(mapa).map(k => {
    const v = mapa[k];
    v.periodos.sort((x, y) => y.ini - x.ini);
    return v;
  }).sort((x, y) => x.placa.localeCompare(y.placa));
}

/* Deshace "Dejar sin técnicos": devuelve a la móvil el personal del periodo anterior */
function deshacerSinTecnicosWeb(token, idMovil) {

  const ses = requerirSesion_(token, 'admin');

  return conBloqueo_(() => {

    const sh = obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES);
    asegurarColumnasHoja_(sh, CONFIG.HEADERS.ASIGNACIONES);

    const t = leerTabla_(sh);
    const values = t.values;
    const idx = t.idx;
    exigirColumnas_(idx, CONFIG.HEADERS.ASIGNACIONES, 'ASIGNACIONES');

    const tiempo = (fila, col) => { const d = convertirFecha_(fila[idx[col]]); return d ? d.getTime() : 0; };

    let rAct = -1;
    const previas = [];

    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idx.ID_Movil]) !== String(idMovil)) continue;
      if (String(values[r][idx.Activa]).toUpperCase() === 'SI') rAct = r; else previas.push(r);
    }

    if (rAct < 0) throw new Error('La móvil no tiene un periodo activo.');

    if (txt_(values[rAct][idx.Tecnico]) || txt_(values[rAct][idx.Asistente])) {
      throw new Error('Esta móvil ya tiene personal asignado: no hay nada que deshacer.');
    }

    const conGente = previas.filter(r => txt_(values[r][idx.Tecnico]) || txt_(values[r][idx.Asistente]));
    if (!conGente.length) throw new Error('No hay personal anterior que restaurar en esta móvil.');

    conGente.sort((a, b) =>
      (tiempo(values[b], 'Fecha_Fin') - tiempo(values[a], 'Fecha_Fin')) ||
      (tiempo(values[b], 'Fecha_Inicio') - tiempo(values[a], 'Fecha_Inicio')) || (b - a));

    const rPrev = conGente[0];
    const prev = values[rPrev];
    const iniPrev = tiempo(prev, 'Fecha_Inicio');

    /* Periodos vacíos posteriores (el actual y, si los hay, otros sin personal) se eliminan */
    const borrar = [rAct].concat(previas.filter(r =>
      r !== rPrev && !(txt_(values[r][idx.Tecnico]) || txt_(values[r][idx.Asistente])) &&
      tiempo(values[r], 'Fecha_Inicio') >= iniPrev && r > rPrev));

    /* Datos de la móvil (para dejar el vehículo vigente) */
    const shM = obtenerHoja_(CONFIG.HOJAS.MOVILES);
    const tm = leerTabla_(shM);
    let rM = -1;

    for (let r = 1; r < tm.values.length; r++) {
      if (String(tm.values[r][tm.idx.ID_Movil]) === String(idMovil)) { rM = r; break; }
    }

    if (rM < 0) throw new Error('No se encontró la móvil.');
    if (String(tm.values[rM][tm.idx.Estado]).toUpperCase() !== 'ACTIVA') {
      throw new Error('La móvil está dada de baja. Reactívala primero.');
    }

    /* 1) Reabrir el periodo anterior */
    const cols = ['Fecha_Fin', 'Activa', 'Motivo_Fin'];
    prev[idx.Fecha_Fin] = '';
    prev[idx.Activa] = 'SI';
    prev[idx.Motivo_Fin] = '';

    ['Tecnico', 'Asistente'].forEach(rol => {
      ['_Salida', '_Motivo_Salida', '_Obs_Salida'].forEach(suf => {
        if (idx[rol + suf] === undefined) return;
        prev[idx[rol + suf]] = '';
        cols.push(rol + suf);
      });
    });

    ['Placa', 'Tipo_Vehiculo'].forEach(c => {
      if (idx[c] === undefined || tm.idx[c] === undefined) return;
      prev[idx[c]] = textoSnap_(c, tm.values[rM][tm.idx[c]]);
      cols.push(c);
    });

    escribirCeldas_(sh, rPrev, values, idx, cols);

    /* 2) Devolver el personal a la ficha de la móvil */
    const camposM = [];

    Object.keys(SNAPSHOT_PERIODO).forEach(col => {
      const campo = SNAPSHOT_PERIODO[col];
      if (campo === 'Placa' || campo === 'Tipo_Vehiculo') return;
      if (idx[col] === undefined || tm.idx[campo] === undefined) return;
      tm.values[rM][tm.idx[campo]] = textoSnap_(campo, prev[idx[col]]);
      camposM.push(campo);
    });

    escribirCeldas_(shM, rM, tm.values, tm.idx, camposM);

    /* 3) Quitar los periodos vacíos (de abajo hacia arriba para no mover filas) */
    borrar.sort((a, b) => b - a).forEach(r => sh.deleteRow(r + 1));

    const tecnico = txt_(prev[idx.Tecnico]);
    const asistente = txt_(prev[idx.Asistente]);

    registrarCambiosMoviles_(ses, [{
      id: idMovil,
      movil: tm.values[rM][tm.idx.Movil],
      campo: 'Deshacer: personal restaurado',
      anterior: 'Sin técnicos',
      nuevo: [tecnico, asistente].filter(Boolean).join(' / ')
    }], 'Web (Deshacer)');

    return { ok: true, tecnico: tecnico, asistente: asistente };
  });
}

/* Registra o corrige por qué salió una persona (periodos ya cerrados) */
function guardarSalidaPersonalWeb(token, datos) {

  const ses = requerirSesion_(token, 'admin');

  if (!datos || !datos.idAsignacion) throw new Error('Falta indicar la persona.');

  const rol = datos.rol === 'Asistente' ? 'Asistente' : 'Tecnico';
  const rolTxt = rol === 'Asistente' ? 'asistente' : 'técnico';

  return conBloqueo_(() => {

    const sh = obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES);
    asegurarColumnasHoja_(sh, CONFIG.HEADERS.ASIGNACIONES);

    const { values, idx } = leerTabla_(sh);

    const cE = rol + '_Salida';
    const cM = rol + '_Motivo_Salida';
    const cO = rol + '_Obs_Salida';

    for (let r = 1; r < values.length; r++) {

      if (String(values[r][idx.ID_Asignacion]) !== String(datos.idAsignacion)) continue;

      if (String(values[r][idx.Activa]).toUpperCase() === 'SI') {
        throw new Error('Esa persona sigue en la móvil. Su salida se registra al cambiar de personal (botón 👤).');
      }

      const texto = (e, m, o) => [txt_(e), txt_(m), txt_(o)].filter(Boolean).join(' · ');
      const anterior = texto(values[r][idx[cE]], values[r][idx[cM]], values[r][idx[cO]]);

      const nuevo = texto(datos.estado, datos.motivo, datos.obs);

      /* Si no cambió nada, no se escribe ni se registra */
      if (nuevo === anterior) return { ok: true };

      values[r][idx[cE]] = txt_(datos.estado);
      values[r][idx[cM]] = txt_(datos.motivo);
      values[r][idx[cO]] = txt_(datos.obs);

      escribirCeldas_(sh, r, values, idx, [cE, cM, cO]);

      registrarCambiosMoviles_(ses, [{
        id: values[r][idx.ID_Movil],
        movil: values[r][idx.Movil],
        campo: 'Salida de ' + rolTxt + ' (registro)',
        anterior: anterior,
        nuevo: nuevo
      }], 'Web (Personal)');

      return { ok: true };
    }

    throw new Error('No se encontró el registro de esa persona.');
  });
}

/* Últimos cambios registrados (más reciente primero) */
function obtenerCambiosFichasWeb(token) {

  requerirSesion_(token, 'admin');

  const sh = obtenerSpreadsheet_().getSheetByName(CONFIG.HOJAS.CAMBIOS);
  if (!sh || sh.getLastRow() < 2) return [];

  const lc = sh.getLastColumn();
  const enc = sh.getRange(1, 1, 1, lc).getValues()[0].map(x => String(x).trim());
  const desde = Math.max(2, sh.getLastRow() - 599);
  const datos = sh.getRange(desde, 1, sh.getLastRow() - desde + 1, lc).getValues();
  const tz = Session.getScriptTimeZone();
  const c = n => enc.indexOf(n);

  return datos
    .filter(f => f[c('Fecha_Hora')] instanceof Date)
    .map(f => ({
      ts: f[c('Fecha_Hora')].getTime(),
      fechaHora: Utilities.formatDate(f[c('Fecha_Hora')], tz, 'dd/MM/yyyy HH:mm'),
      usuario: txt_(f[c('Nombre')]) || txt_(f[c('Usuario')]),
      movil: txt_(f[c('Movil')]),
      campo: txt_(f[c('Campo')]),
      anterior: txt_(f[c('Valor_Anterior')]),
      nuevo: txt_(f[c('Valor_Nuevo')]),
      origen: txt_(f[c('Origen')])
    }))
    .sort((a, b) => b.ts - a.ts)
    .map(o => { delete o.ts; return o; });
}


/* Ubicación GPS: acepta "9.9346, -84.0875" o un enlace de Google Maps y la deja como "lat, long".
   Si no se puede leer (por ejemplo un enlace corto), se guarda tal cual. */
function normalizarGps_(v) {

  const s = txt_(v);
  if (!s) return '';

  const pats = [
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|ll|query|destination|center)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /^\s*(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*$/
  ];

  for (let i = 0; i < pats.length; i++) {
    const m = s.match(pats[i]);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return lat.toFixed(6) + ', ' + lng.toFixed(6);
  }

  return s;
}

/* ---------- importación desde la hoja IMPORTAR_FICHAS (formato del archivo mensual) ---------- */

function crearMovilDesdeFicha_(ses, numero, campos) {

  const sh = obtenerHoja_(CONFIG.HOJAS.MOVILES);
  asegurarColumnasHoja_(sh, CONFIG.HEADERS.MOVILES);

  const id = generarIdMovil_();
  const fecha = campos.Fecha_Ingreso || inicioDia_(new Date());

  const fila = {
    ID_Movil: id, Movil: numero, Estado: 'ACTIVA', Fecha_Ingreso: fecha, Fecha_Salida: '',
    Domicilio: '', Tipo_Vehiculo: ''
  };

  const bitacora = [{ id: id, movil: numero, campo: 'Alta de móvil', anterior: '', nuevo: numero }];

  Object.keys(campos).forEach(campo => {
    if (CAMPOS_EDITABLES_FICHA.indexOf(campo) === -1 || campo === 'Fecha_Ingreso') return;
    const v = valorCampo_(campo, campos[campo]);
    fila[campo] = v;
    if (txt_(v)) bitacora.push({ id: id, movil: numero, campo: campo, anterior: '', nuevo: txt_(v) });
  });

  appendPorEncabezados_(sh, fila);
  agregarAsignacion_(id, numero, fecha, fila);
  registrarCambiosMoviles_(ses, bitacora, 'Importación');
}

function importarFichasDesdeHoja_(src, ses) {

  const datos = src.getDataRange().getValues();
  if (datos.length < 2) throw new Error('La hoja no tiene filas de datos.');

  const enc = datos[0].map(x => String(x).trim().toLowerCase());
  if (enc[3] !== 'movil' || enc[5] !== 'tecnico') {
    throw new Error('La hoja no tiene el formato del archivo mensual (columna D "Movil" y columna F "Tecnico").');
  }

  const porNumero = {};
  obtenerMoviles_().forEach(m => { porNumero[String(m.Movil).trim()] = m; });

  /* Encabezados opcionales después de la columna V: zona de trabajo, dirección exacta, GPS */
  const extras = {};
  enc.forEach((e, k) => {
    if (k < FICHA_COLUMNAS.length) return;
    const n = e.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/^(zona|zona de trabajo|domicilio)$/.test(n)) extras.Domicilio = k;
    else if (/^direccion( exacta)?$/.test(n)) extras.Direccion_Exacta = k;
    else if (/^(gps|ubicacion|ubicacion gps|coordenadas)$/.test(n)) extras.Ubicacion_GPS = k;
  });

  const cambios = [];
  const nuevas = [];
  const avisos = [];

  for (let i = 1; i < datos.length; i++) {

    const fila = datos[i];
    const numero = String(fila[3] == null ? '' : fila[3]).trim();
    if (!numero) continue;

    const campos = {};

    FICHA_COLUMNAS.forEach((c, k) => {

      if (!c.campo || c.campo === 'Movil') return;

      const v = fila[k];

      if (c.campo === 'Fecha_Ingreso') {
        const d = (v instanceof Date) ? convertirFecha_(v) : null;
        if (d && d.getFullYear() >= 2000) {
          campos.Fecha_Ingreso = d;
        } else if (txt_(v)) {
          avisos.push('Móvil ' + numero + ': la fecha de ingreso no es válida y se omitió.');
        }
        return;
      }

      campos[c.campo] = v;
    });

    /* Columnas opcionales a la derecha (por nombre de encabezado) */
    Object.keys(extras).forEach(campo => {
      const v = txt_(fila[extras[campo]]);
      if (v) campos[campo] = campo === 'Ubicacion_GPS' ? normalizarGps_(v) : v;
    });

    const existente = porNumero[numero];

    if (existente) cambios.push({ idMovil: existente.ID_Movil, campos: campos });
    else nuevas.push({ numero: numero, campos: campos });
  }

  const r = cambios.length
    ? aplicarCambiosMoviles_(ses, cambios, { soloCorregir: true }, 'Importación')
    : { moviles: 0, campos: 0 };

  nuevas.forEach(n => crearMovilDesdeFicha_(ses, n.numero, n.campos));

  completarFichaAsignaciones_();

  return {
    filas: cambios.length + nuevas.length,
    actualizadas: r.moviles,
    campos: r.campos,
    nuevas: nuevas.length,
    avisos: avisos
  };
}

function menuImportarFichas() {

  soloDesdeMenu_();

  const ui = SpreadsheetApp.getUi();
  const src = obtenerSpreadsheet_().getSheetByName(HOJA_IMPORTAR);

  if (!src) {
    ui.alert(
      'No existe la hoja "' + HOJA_IMPORTAR + '".\n\n' +
      'Importa tu archivo mensual al Sheet (Archivo → Importar → Subir → "Insertar hojas nuevas") ' +
      'y cambia el nombre de esa hoja a ' + HOJA_IMPORTAR + '. Luego repite esta opción.'
    );
    return;
  }

  const ok = ui.alert(
    'Importar fichas',
    'Se actualizarán las móviles con los datos de la hoja ' + HOJA_IMPORTAR +
    '. Los cambios quedan registrados y no se crean periodos nuevos en el historial. ¿Continuar?',
    ui.ButtonSet.YES_NO
  );

  if (ok !== ui.Button.YES) return;

  const correo = Session.getActiveUser().getEmail();
  const ses = { usuario: 'importacion', nombre: 'Importación' + (correo ? ' (' + correo + ')' : '') };

  try {

    const r = importarFichasDesdeHoja_(src, ses);

    ui.alert(
      'Importación terminada\n\n' +
      'Filas leídas: ' + r.filas + '\n' +
      'Móviles con cambios: ' + r.actualizadas + ' (' + r.campos + ' datos modificados)\n' +
      'Móviles nuevas: ' + r.nuevas +
      (r.avisos.length ? '\n\nAvisos:\n- ' + r.avisos.join('\n- ') : '')
    );

  } catch (e) {
    ui.alert('No se pudo importar: ' + e.message);
  }
}


/* ---------- exportación en el formato exacto del archivo mensual ---------- */

function construirArchivosFichas_(d) {

  const P = PLANTILLA_FICHAS;
  const n = d.moviles.length;

  if (!n) throw new Error('No hay móviles activas para exportar.');

  const idxTexto = new Map();
  const textos = [];
  let refs = 0;

  const ss = t => {
    t = String(t);
    refs++;
    if (!idxTexto.has(t)) {
      idxTexto.set(t, textos.length);
      textos.push(t);
    }
    return idxTexto.get(t);
  };

  const cs = (ref, s, t) => '<c r="' + ref + '" s="' + s + '" t="s"><v>' + ss(t) + '</v></c>';
  const num = (ref, s, v) => '<c r="' + ref + '" s="' + s + '"><v>' + v + '</v></c>';
  const vacia = (ref, s) => '<c r="' + ref + '" s="' + s + '"/>';

  const atrib = ' spans="1:22" ht="15.6" x14ac:dyDescent="0.3"';

  let filas = '<row r="1"' + atrib + '>' +
    FICHA_COLUMNAS.map(c => cs(c.col + '1', c.rosa ? 2 : 1, c.titulo)).join('') +
    '</row>';

  d.moviles.forEach((m, i) => {

    const r = i + 2;

    filas += '<row r="' + r + '"' + atrib + '>' +
      FICHA_COLUMNAS.map(c => {

        const ref = c.col + r;
        const estilo = c.estilo || 4;

        if (c.calculada) {
          const a = Number(m.Anio_Vehiculo);
          return a
            ? '<c r="' + ref + '" s="4"><f>' + d.anio + '-P' + r + '</f><v>' + (d.anio - a) + '</v></c>'
            : vacia(ref, 4);
        }

        const v = m[c.campo];

        if (c.tipo === 'fecha') {
          const f = (v instanceof Date && !isNaN(v)) ? v : convertirFecha_(v);
          return f ? num(ref, 3, serialExcel_(f)) : vacia(ref, 3);
        }

        const s = txt_(v);
        if (!s) return vacia(ref, estilo);

        if (c.tipo === 'numero' && /^\d+$/.test(s)) return num(ref, 4, s);

        if (c.tipo === 'cedula' && /^[1-9]\d{0,14}$/.test(s)) return num(ref, 6, s);

        return cs(ref, estilo, s);

      }).join('') +
      '</row>';
  });

  const ultima = n + 1;

  const hoja = P.archivos['xl/worksheets/sheet1.xml']
    .replace('{{FILAS}}', filas)
    .replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:V' + ultima + '"/>')
    .replace(/<autoFilter ref="[^"]*"\/>/, '<autoFilter ref="A1:V' + ultima + '"/>');

  const libro = P.archivos['xl/workbook.xml']
    .replace(/Hoja1!\$A\$1:\$V\$\d+/, 'Hoja1!$A$1:$V$' + ultima);

  const sst = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + refs +
    '" uniqueCount="' + textos.length + '">' +
    textos.map(t =>
      '<si><t' + (/^\s|\s$/.test(t) ? ' xml:space="preserve"' : '') + '>' + xmlEsc_(t) + '</t></si>'
    ).join('') +
    '</sst>';

  const ahora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:creator>SRD Gestión Operativa</dc:creator><cp:lastModifiedBy>SRD Gestión Operativa</cp:lastModifiedBy>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + ahora + '</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + ahora + '</dcterms:modified></cp:coreProperties>';

  const salida = {};
  Object.keys(P.archivos).forEach(k => { salida[k] = P.archivos[k]; });

  salida['xl/worksheets/sheet1.xml'] = hoja;
  salida['xl/workbook.xml'] = libro;
  salida['xl/sharedStrings.xml'] = sst;
  salida['docProps/core.xml'] = core;

  return salida;
}

function crearExcelFichas_(anio, mes) {

  const hoy = new Date();
  anio = Number(anio) || hoy.getFullYear();
  mes = Number(mes) || (hoy.getMonth() + 1);

  const moviles = obtenerMoviles_()
    .filter(esActiva_)
    .sort((a, b) => (parseInt(a.Movil, 10) || 0) - (parseInt(b.Movil, 10) || 0));

  const archivos = construirArchivosFichas_({ moviles: moviles, anio: anio });

  const orden = [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
    'xl/styles.xml',
    'xl/theme/theme1.xml',
    'xl/sharedStrings.xml',
    'docProps/core.xml',
    'docProps/app.xml'
  ];

  const nombre = 'SRD_' + MESES_FICHA_[mes - 1] + '_' + anio + '.xlsx';

  const blobs = orden.map(p => Utilities.newBlob(archivos[p], 'application/xml', p));

  return Utilities.zip(blobs, nombre)
    .setName(nombre)
    .setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function exportarFichasExcelWeb(token, anio, mes) {

  requerirSesion_(token, 'admin');

  const blob = crearExcelFichas_(anio, mes);
  const base64 = Utilities.base64Encode(blob.getBytes());

  const nombreCarpeta = 'SRD - Fichas mensuales';
  const it = DriveApp.getFoldersByName(nombreCarpeta);
  const carpeta = it.hasNext() ? it.next() : DriveApp.createFolder(nombreCarpeta);
  const archivo = carpeta.createFile(blob);

  return {
    nombre: archivo.getName(),
    url: archivo.getUrl(),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: base64,
    carpeta: nombreCarpeta
  };
}


/* =========================================================
   PLANTILLA DEL CALENDARIO CLIENTE (formato exacto del cliente)
   Generada a partir de su archivo Excel. No editar a mano.
   ========================================================= */
const PLANTILLA_CLIENTE = {
"archivos": {
"[Content_Types].xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/><Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/><Override PartName=\"/xl/metadata.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml\"/><Override PartName=\"/xl/tables/table1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml\"/><Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/><Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/></Types>",
"docProps/app.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\"><Application>Microsoft Excel</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size=\"2\" baseType=\"variant\"><vt:variant><vt:lpstr>Hojas de cálculo</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size=\"1\" baseType=\"lpstr\"><vt:lpstr>Semana del 12 al 18</vt:lpstr></vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>",
"_rels/.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>",
"xl/styles.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"x14ac x16r2\" xmlns:x14ac=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac\" xmlns:x16r2=\"http://schemas.microsoft.com/office/spreadsheetml/2015/02/main\"><numFmts count=\"2\"><numFmt numFmtId=\"164\" formatCode=\"dddd/dd/mmm\"/><numFmt numFmtId=\"165\" formatCode=\"dddd\"/></numFmts><fonts count=\"10\" x14ac:knownFonts=\"1\"><font><sz val=\"11\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/><scheme val=\"minor\"/></font><font><sz val=\"11\"/><color rgb=\"FFFF0000\"/><name val=\"Calibri\"/><family val=\"2\"/><scheme val=\"minor\"/></font><font><b/><sz val=\"11\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/><scheme val=\"minor\"/></font><font><sz val=\"11\"/><color theme=\"0\"/><name val=\"Calibri\"/><family val=\"2\"/></font><font><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font><font><sz val=\"11\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/></font><font><sz val=\"8\"/><name val=\"Calibri\"/><family val=\"2\"/><scheme val=\"minor\"/></font><font><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font><font><sz val=\"11\"/><color rgb=\"FF000000\"/><name val=\"Calibri\"/><family val=\"2\"/><scheme val=\"minor\"/></font><font><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font></fonts><fills count=\"3\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF872F98\"/><bgColor indexed=\"64\"/></patternFill></fill></fills><borders count=\"7\"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left/><right/><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left/><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/><diagonal/></border></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"23\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/><xf numFmtId=\"14\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"2\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"3\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"165\" fontId=\"3\" fillId=\"2\" borderId=\"3\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"4\" fillId=\"0\" borderId=\"4\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"5\" fillId=\"0\" borderId=\"5\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"4\" fillId=\"0\" borderId=\"5\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\"/><xf numFmtId=\"0\" fontId=\"5\" fillId=\"0\" borderId=\"5\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"7\" fillId=\"0\" borderId=\"5\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"7\" fillId=\"0\" borderId=\"5\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"8\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/><xf numFmtId=\"0\" fontId=\"4\" fillId=\"0\" borderId=\"5\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"9\" fillId=\"0\" borderId=\"6\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"9\" fillId=\"0\" borderId=\"2\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"9\" fillId=\"0\" borderId=\"2\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\"/><xf numFmtId=\"0\" fontId=\"9\" fillId=\"0\" borderId=\"2\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"4\" fillId=\"0\" borderId=\"5\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf></cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles><dxfs count=\"30\"><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><alignment horizontal=\"center\" vertical=\"bottom\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><alignment horizontal=\"center\" vertical=\"bottom\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left/><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><fgColor indexed=\"64\"/><bgColor auto=\"1\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><fgColor indexed=\"64\"/><bgColor auto=\"1\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><fgColor indexed=\"64\"/><bgColor auto=\"1\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><fgColor indexed=\"64\"/><bgColor auto=\"1\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><fgColor indexed=\"64\"/><bgColor auto=\"1\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><fgColor rgb=\"FFFFFFFF\"/><bgColor auto=\"1\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><fgColor rgb=\"FFFFFFFF\"/><bgColor auto=\"1\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><bgColor auto=\"1\"/></patternFill></fill><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><bgColor auto=\"1\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"bottom\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><fgColor indexed=\"64\"/><bgColor auto=\"1\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"bottom\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left/><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom></border></dxf><dxf><border outline=\"0\"><left style=\"thin\"><color rgb=\"FF000000\"/></left><top style=\"thin\"><color rgb=\"FF000000\"/></top><bottom style=\"thin\"><color rgb=\"FF000000\"/></bottom></border></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color auto=\"1\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><fill><patternFill patternType=\"none\"><fgColor rgb=\"FF000000\"/><bgColor auto=\"1\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/></dxf><dxf><font><b val=\"0\"/><i val=\"0\"/><strike val=\"0\"/><condense val=\"0\"/><extend val=\"0\"/><outline val=\"0\"/><shadow val=\"0\"/><u val=\"none\"/><vertAlign val=\"baseline\"/><sz val=\"11\"/><color theme=\"0\"/><name val=\"Calibri\"/><scheme val=\"none\"/></font><numFmt numFmtId=\"165\" formatCode=\"dddd\"/><fill><patternFill patternType=\"solid\"><fgColor indexed=\"64\"/><bgColor rgb=\"FF872F98\"/></patternFill></fill><alignment horizontal=\"center\" vertical=\"center\" textRotation=\"0\" wrapText=\"0\" indent=\"0\" justifyLastLine=\"0\" shrinkToFit=\"0\" readingOrder=\"0\"/><border diagonalUp=\"0\" diagonalDown=\"0\" outline=\"0\"><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/></border></dxf><dxf><font><b/><i val=\"0\"/><color theme=\"0\"/></font><fill><patternFill><bgColor rgb=\"FF00B0F0\"/></patternFill></fill></dxf><dxf><font><b/><i val=\"0\"/><color auto=\"1\"/></font><fill><patternFill><bgColor rgb=\"FFFFC000\"/></patternFill></fill></dxf><dxf><font><b/><i val=\"0\"/><color theme=\"0\"/></font><fill><patternFill><bgColor rgb=\"FF00B050\"/></patternFill></fill></dxf><dxf><font><b/><i val=\"0\"/><color theme=\"0\"/></font><fill><patternFill><bgColor rgb=\"FFFF0000\"/></patternFill></fill></dxf><dxf><font><b/><i val=\"0\"/><color theme=\"0\"/></font><fill><patternFill><bgColor rgb=\"FFFF0000\"/></patternFill></fill></dxf><dxf><font><b/><i val=\"0\"/><color theme=\"0\"/></font><fill><patternFill><bgColor rgb=\"FF7030A0\"/></patternFill></fill></dxf><dxf><font><b/><i val=\"0\"/><color rgb=\"FFFF0000\"/></font><fill><patternFill><bgColor rgb=\"FFFFC000\"/></patternFill></fill></dxf></dxfs><tableStyles count=\"0\" defaultTableStyle=\"TableStyleMedium2\" defaultPivotStyle=\"PivotStyleLight16\"/><extLst><ext uri=\"{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}\" xmlns:x14=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/main\"><x14:slicerStyles defaultSlicerStyle=\"SlicerStyleLight1\"/></ext><ext uri=\"{9260A510-F301-46a8-8635-F512D64BE5F5}\" xmlns:x15=\"http://schemas.microsoft.com/office/spreadsheetml/2010/11/main\"><x15:timelineStyles defaultTimelineStyle=\"TimeSlicerStyleLight1\"/></ext></extLst></styleSheet>",
"xl/metadata.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<metadata xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><metadataTypes count=\"1\"><metadataType name=\"XLDAPR\" minSupportedVersion=\"120000\" copy=\"1\" pasteAll=\"1\" pasteValues=\"1\" merge=\"1\" splitFirst=\"1\" rowColShift=\"1\" clearFormats=\"1\" clearComments=\"1\" assign=\"1\" coerce=\"1\" cellMeta=\"1\"/></metadataTypes><futureMetadata name=\"XLDAPR\" count=\"1\"><bk><extLst><ext uri=\"{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}\" xmlns:xda=\"http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray\"><xda:dynamicArrayProperties fDynamic=\"1\" fCollapsed=\"0\"/></ext></extLst></bk></futureMetadata><cellMetadata count=\"1\"><bk><rc t=\"1\" v=\"0\"/></bk></cellMetadata></metadata>",
"xl/workbook.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"x15\" xmlns:x15=\"http://schemas.microsoft.com/office/spreadsheetml/2010/11/main\"><fileVersion appName=\"xl\" lastEdited=\"6\" lowestEdited=\"7\" rupBuild=\"14420\"/><workbookPr/><bookViews><workbookView xWindow=\"0\" yWindow=\"0\" windowWidth=\"24000\" windowHeight=\"10920\"/></bookViews><sheets><sheet name=\"Semana del 12 al 18\" sheetId=\"1\" r:id=\"rId1\"/></sheets><calcPr calcId=\"162913\"/><extLst><ext uri=\"{140A7094-0E35-4892-8432-C4D2E57EDEB5}\" xmlns:x15=\"http://schemas.microsoft.com/office/spreadsheetml/2010/11/main\"><x15:workbookPr chartTrackingRefBase=\"1\"/></ext><ext uri=\"{B58B0392-4F1F-4190-BB64-5DF3571DCE5F}\" xmlns:xcalcf=\"http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures\"><xcalcf:calcFeatures><xcalcf:feature name=\"microsoft.com:RD\"/><xcalcf:feature name=\"microsoft.com:Single\"/><xcalcf:feature name=\"microsoft.com:FV\"/><xcalcf:feature name=\"microsoft.com:CNMTM\"/><xcalcf:feature name=\"microsoft.com:LET_WF\"/><xcalcf:feature name=\"microsoft.com:LAMBDA_WF\"/><xcalcf:feature name=\"microsoft.com:ARRAYTEXT_WF\"/></xcalcf:calcFeatures></ext></extLst></workbook>",
"xl/worksheets/sheet1.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"x14ac\" xmlns:x14ac=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac\"><sheetPr codeName=\"Hoja2\"/><dimension ref=\"B1:R165\"/><sheetViews><sheetView showGridLines=\"0\" tabSelected=\"1\" topLeftCell=\"B5\" zoomScale=\"95\" zoomScaleNormal=\"95\" workbookViewId=\"0\"><selection activeCell=\"K13\" sqref=\"K13\"/></sheetView></sheetViews><sheetFormatPr baseColWidth=\"10\" defaultRowHeight=\"15\" x14ac:dyDescent=\"0.25\"/><cols><col min=\"1\" max=\"1\" width=\"3.42578125\" customWidth=\"1\"/><col min=\"3\" max=\"3\" width=\"26.85546875\" customWidth=\"1\"/><col min=\"4\" max=\"4\" width=\"39.85546875\" bestFit=\"1\" customWidth=\"1\"/><col min=\"5\" max=\"11\" width=\"16.85546875\" customWidth=\"1\"/><col min=\"12\" max=\"12\" width=\"3.140625\" customWidth=\"1\"/><col min=\"13\" max=\"13\" width=\"4.42578125\" customWidth=\"1\"/><col min=\"17\" max=\"17\" width=\"11.5703125\" style=\"1\" customWidth=\"1\"/><col min=\"18\" max=\"18\" width=\"21.42578125\" customWidth=\"1\"/></cols><sheetData>{{FILAS}}</sheetData><phoneticPr fontId=\"6\" type=\"noConversion\"/><conditionalFormatting sqref=\"E10:K10\"><cfRule type=\"expression\" dxfId=\"29\" priority=\"2\"><formula>E$10=\"🚚🗓️\"</formula></cfRule><cfRule type=\"expression\" dxfId=\"28\" priority=\"3\"><formula>E$10=\"⬇️PR⬇️\"</formula></cfRule><cfRule type=\"expression\" dxfId=\"27\" priority=\"4\"><formula>E$10=\"⬇️PLANI⬇️\"</formula></cfRule></conditionalFormatting><conditionalFormatting sqref=\"E12:K26\"><cfRule type=\"expression\" dxfId=\"26\" priority=\"1\"><formula>E12=$Q$3</formula></cfRule><cfRule type=\"expression\" dxfId=\"25\" priority=\"6\"><formula>E12=$Q$1</formula></cfRule><cfRule type=\"expression\" dxfId=\"24\" priority=\"7\"><formula>E12=$Q$2</formula></cfRule><cfRule type=\"expression\" dxfId=\"23\" priority=\"8\"><formula>E12=$Q$4</formula></cfRule></conditionalFormatting><dataValidations count=\"1\"><dataValidation type=\"list\" allowBlank=\"1\" showInputMessage=\"1\" showErrorMessage=\"1\" sqref=\"E12:K26\"><formula1>$Q$1:$Q$4</formula1></dataValidation></dataValidations><pageMargins left=\"0.7\" right=\"0.7\" top=\"0.75\" bottom=\"0.75\" header=\"0.3\" footer=\"0.3\"/><tableParts count=\"1\"><tablePart r:id=\"rId1\"/></tableParts></worksheet>",
"xl/worksheets/_rels/sheet1.xml.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/table\" Target=\"../tables/table1.xml\"/></Relationships>",
"xl/tables/table1.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<table xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" id=\"1\" name=\"Tabla23\" displayName=\"Tabla23\" ref=\"B11:K27\" totalsRowCount=\"1\" headerRowDxfId=\"22\" dataDxfId=\"21\" tableBorderDxfId=\"20\"><autoFilter ref=\"B11:K26\"><filterColumn colId=\"0\" hiddenButton=\"1\"/><filterColumn colId=\"1\" hiddenButton=\"1\"/><filterColumn colId=\"2\" hiddenButton=\"1\"/><filterColumn colId=\"3\" hiddenButton=\"1\"/><filterColumn colId=\"4\" hiddenButton=\"1\"/><filterColumn colId=\"5\" hiddenButton=\"1\"/><filterColumn colId=\"6\" hiddenButton=\"1\"/><filterColumn colId=\"7\" hiddenButton=\"1\"/><filterColumn colId=\"8\" hiddenButton=\"1\"/><filterColumn colId=\"9\" hiddenButton=\"1\"/></autoFilter><tableColumns count=\"10\"><tableColumn id=\"1\" name=\"Contrata\" totalsRowLabel=\"Total\" dataDxfId=\"19\" totalsRowDxfId=\"9\"/><tableColumn id=\"2\" name=\"Domicilio\" dataDxfId=\"18\" totalsRowDxfId=\"8\"/><tableColumn id=\"3\" name=\"Móvil\" dataDxfId=\"17\" totalsRowDxfId=\"7\"/><tableColumn id=\"4\" name=\"Lunes\" dataDxfId=\"16\" totalsRowDxfId=\"6\"/><tableColumn id=\"5\" name=\"Martes\" dataDxfId=\"15\" totalsRowDxfId=\"5\"/><tableColumn id=\"6\" name=\"Miércoles\" dataDxfId=\"14\" totalsRowDxfId=\"4\"/><tableColumn id=\"7\" name=\"Jueves\" dataDxfId=\"13\" totalsRowDxfId=\"3\"/><tableColumn id=\"8\" name=\"Viernes\" dataDxfId=\"12\" totalsRowDxfId=\"2\"/><tableColumn id=\"9\" name=\"Sábado\" dataDxfId=\"11\" totalsRowDxfId=\"1\"/><tableColumn id=\"10\" name=\"Domingo\" totalsRowFunction=\"count\" dataDxfId=\"10\" totalsRowDxfId=\"0\"/></tableColumns><tableStyleInfo name=\"TableStyleLight10\" showFirstColumn=\"0\" showLastColumn=\"0\" showRowStripes=\"1\" showColumnStripes=\"0\"/></table>",
"xl/theme/theme1.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Office 2013 - Tema de 2022\"><a:themeElements><a:clrScheme name=\"Office 2013 - 2022\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"44546A\"/></a:dk2><a:lt2><a:srgbClr val=\"E7E6E6\"/></a:lt2><a:accent1><a:srgbClr val=\"4472C4\"/></a:accent1><a:accent2><a:srgbClr val=\"ED7D31\"/></a:accent2><a:accent3><a:srgbClr val=\"A5A5A5\"/></a:accent3><a:accent4><a:srgbClr val=\"FFC000\"/></a:accent4><a:accent5><a:srgbClr val=\"5B9BD5\"/></a:accent5><a:accent6><a:srgbClr val=\"70AD47\"/></a:accent6><a:hlink><a:srgbClr val=\"0563C1\"/></a:hlink><a:folHlink><a:srgbClr val=\"954F72\"/></a:folHlink></a:clrScheme><a:fontScheme name=\"Office 2013 - 2022\"><a:majorFont><a:latin typeface=\"Calibri Light\" panose=\"020F0302020204030204\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"游ゴシック Light\"/><a:font script=\"Hang\" typeface=\"맑은 고딕\"/><a:font script=\"Hans\" typeface=\"等线 Light\"/><a:font script=\"Hant\" typeface=\"新細明體\"/><a:font script=\"Arab\" typeface=\"Times New Roman\"/><a:font script=\"Hebr\" typeface=\"Times New Roman\"/><a:font script=\"Thai\" typeface=\"Tahoma\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"MoolBoran\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Times New Roman\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/><a:font script=\"Geor\" typeface=\"Sylfaen\"/><a:font script=\"Armn\" typeface=\"Arial\"/><a:font script=\"Bugi\" typeface=\"Leelawadee UI\"/><a:font script=\"Bopo\" typeface=\"Microsoft JhengHei\"/><a:font script=\"Java\" typeface=\"Javanese Text\"/><a:font script=\"Lisu\" typeface=\"Segoe UI\"/><a:font script=\"Mymr\" typeface=\"Myanmar Text\"/><a:font script=\"Nkoo\" typeface=\"Ebrima\"/><a:font script=\"Olck\" typeface=\"Nirmala UI\"/><a:font script=\"Osma\" typeface=\"Ebrima\"/><a:font script=\"Phag\" typeface=\"Phagspa\"/><a:font script=\"Syrn\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syrj\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syre\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Sora\" typeface=\"Nirmala UI\"/><a:font script=\"Tale\" typeface=\"Microsoft Tai Le\"/><a:font script=\"Talu\" typeface=\"Microsoft New Tai Lue\"/><a:font script=\"Tfng\" typeface=\"Ebrima\"/></a:majorFont><a:minorFont><a:latin typeface=\"Calibri\" panose=\"020F0502020204030204\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"游ゴシック\"/><a:font script=\"Hang\" typeface=\"맑은 고딕\"/><a:font script=\"Hans\" typeface=\"等线\"/><a:font script=\"Hant\" typeface=\"新細明體\"/><a:font script=\"Arab\" typeface=\"Arial\"/><a:font script=\"Hebr\" typeface=\"Arial\"/><a:font script=\"Thai\" typeface=\"Tahoma\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"DaunPenh\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Arial\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/><a:font script=\"Geor\" typeface=\"Sylfaen\"/><a:font script=\"Armn\" typeface=\"Arial\"/><a:font script=\"Bugi\" typeface=\"Leelawadee UI\"/><a:font script=\"Bopo\" typeface=\"Microsoft JhengHei\"/><a:font script=\"Java\" typeface=\"Javanese Text\"/><a:font script=\"Lisu\" typeface=\"Segoe UI\"/><a:font script=\"Mymr\" typeface=\"Myanmar Text\"/><a:font script=\"Nkoo\" typeface=\"Ebrima\"/><a:font script=\"Olck\" typeface=\"Nirmala UI\"/><a:font script=\"Osma\" typeface=\"Ebrima\"/><a:font script=\"Phag\" typeface=\"Phagspa\"/><a:font script=\"Syrn\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syrj\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syre\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Sora\" typeface=\"Nirmala UI\"/><a:font script=\"Tale\" typeface=\"Microsoft Tai Le\"/><a:font script=\"Talu\" typeface=\"Microsoft New Tai Lue\"/><a:font script=\"Tfng\" typeface=\"Ebrima\"/></a:minorFont></a:fontScheme><a:fmtScheme name=\"Office 2013 - 2022\"><a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"110000\"/><a:satMod val=\"105000\"/><a:tint val=\"67000\"/></a:schemeClr></a:gs><a:gs pos=\"50000\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"105000\"/><a:satMod val=\"103000\"/><a:tint val=\"73000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"105000\"/><a:satMod val=\"109000\"/><a:tint val=\"81000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"5400000\" scaled=\"0\"/></a:gradFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:satMod val=\"103000\"/><a:lumMod val=\"102000\"/><a:tint val=\"94000\"/></a:schemeClr></a:gs><a:gs pos=\"50000\"><a:schemeClr val=\"phClr\"><a:satMod val=\"110000\"/><a:lumMod val=\"100000\"/><a:shade val=\"100000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"99000\"/><a:satMod val=\"120000\"/><a:shade val=\"78000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"5400000\" scaled=\"0\"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w=\"6350\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln><a:ln w=\"12700\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln><a:ln w=\"19050\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"57150\" dist=\"19050\" dir=\"5400000\" algn=\"ctr\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"63000\"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"><a:tint val=\"95000\"/><a:satMod val=\"170000\"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"93000\"/><a:satMod val=\"150000\"/><a:shade val=\"98000\"/><a:lumMod val=\"102000\"/></a:schemeClr></a:gs><a:gs pos=\"50000\"><a:schemeClr val=\"phClr\"><a:tint val=\"98000\"/><a:satMod val=\"130000\"/><a:shade val=\"90000\"/><a:lumMod val=\"103000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"63000\"/><a:satMod val=\"120000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"5400000\" scaled=\"0\"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/><a:extLst><a:ext uri=\"{05A4C25C-085E-4340-85A3-A5531E510DB2}\"><thm15:themeFamily xmlns:thm15=\"http://schemas.microsoft.com/office/thememl/2012/main\" name=\"Office 2013 - 2022 Theme\" id=\"{62F939B6-93AF-4DB8-9C6B-D6C7DFDC589F}\" vid=\"{4A3C46E8-61CC-4603-A589-7422A47A8E4A}\"/></a:ext></a:extLst></a:theme>",
"xl/_rels/workbook.xml.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"theme/theme1.xml\"/><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId5\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata\" Target=\"metadata.xml\"/><Relationship Id=\"rId4\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings\" Target=\"sharedStrings.xml\"/></Relationships>"
},
"filas1a4": "<row r=\"1\" spans=\"2:18\" hidden=\"1\" x14ac:dyDescent=\"0.25\"><c r=\"Q1\" s=\"1\" t=\"s\"><v>0</v></c><c r=\"R1\" s=\"2\"><f ca=\"1\">TODAY()</f><v>46301</v></c></row><row r=\"2\" spans=\"2:18\" hidden=\"1\" x14ac:dyDescent=\"0.25\"><c r=\"Q2\" s=\"1\" t=\"s\"><v>1</v></c><c r=\"R2\" s=\"2\"><f ca=\"1\">R1+1</f><v>46302</v></c></row><row r=\"3\" spans=\"2:18\" hidden=\"1\" x14ac:dyDescent=\"0.25\"><c r=\"Q3\" s=\"1\" t=\"s\"><v>2</v></c></row><row r=\"4\" spans=\"2:18\" hidden=\"1\" x14ac:dyDescent=\"0.25\"><c r=\"Q4\" s=\"1\" t=\"s\"><v>3</v></c></row>",
"fila10": "<row r=\"10\" spans=\"2:18\" x14ac:dyDescent=\"0.25\"><c r=\"E10\" s=\"4\" t=\"str\" cm=\"1\"><f t=\"array\" aca=\"1\" ref=\"E10\" ca=\"1\">IFERROR(_xlfn.IFS(E9=#REF!,\"⬇️PR⬇️\",E9=$R$2,\"⬇️PLANI⬇️\"),\"🚚🗓️\")</f><v>🚚🗓️</v></c><c r=\"F10\" s=\"4\" t=\"str\" cm=\"1\"><f t=\"array\" aca=\"1\" ref=\"F10\" ca=\"1\">IFERROR(_xlfn.IFS(F9=#REF!,\"⬇️PR⬇️\",F9=$R$2,\"⬇️PLANI⬇️\"),\"🚚🗓️\")</f><v>🚚🗓️</v></c><c r=\"G10\" s=\"4\" t=\"str\" cm=\"1\"><f t=\"array\" aca=\"1\" ref=\"G10\" ca=\"1\">IFERROR(_xlfn.IFS(G9=#REF!,\"⬇️PR⬇️\",G9=$R$2,\"⬇️PLANI⬇️\"),\"🚚🗓️\")</f><v>🚚🗓️</v></c><c r=\"H10\" s=\"4\" t=\"str\" cm=\"1\"><f t=\"array\" aca=\"1\" ref=\"H10\" ca=\"1\">IFERROR(_xlfn.IFS(H9=#REF!,\"⬇️PR⬇️\",H9=$R$2,\"⬇️PLANI⬇️\"),\"🚚🗓️\")</f><v>🚚🗓️</v></c><c r=\"I10\" s=\"4\" t=\"str\" cm=\"1\"><f t=\"array\" aca=\"1\" ref=\"I10\" ca=\"1\">IFERROR(_xlfn.IFS(I9=#REF!,\"⬇️PR⬇️\",I9=$R$2,\"⬇️PLANI⬇️\"),\"🚚🗓️\")</f><v>🚚🗓️</v></c><c r=\"J10\" s=\"4\" t=\"str\" cm=\"1\"><f t=\"array\" aca=\"1\" ref=\"J10\" ca=\"1\">IFERROR(_xlfn.IFS(J9=#REF!,\"⬇️PR⬇️\",J9=$R$2,\"⬇️PLANI⬇️\"),\"🚚🗓️\")</f><v>🚚🗓️</v></c><c r=\"K10\" s=\"4\" t=\"str\" cm=\"1\"><f t=\"array\" aca=\"1\" ref=\"K10\" ca=\"1\">IFERROR(_xlfn.IFS(K9=#REF!,\"⬇️PR⬇️\",K9=$R$2,\"⬇️PLANI⬇️\"),\"🚚🗓️\")</f><v>🚚🗓️</v></c></row>"
};


/* =========================================================
   PLANTILLA DEL ARCHIVO MENSUAL DE FICHAS (formato exacto)
   Generada a partir del archivo SRD_SETIEMBRE_2026.xlsx. No editar a mano.
   ========================================================= */
const PLANTILLA_FICHAS = {
"archivos": {
"[Content_Types].xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/><Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/><Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/><Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/></Types>",
"docProps/app.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\"><Application>Microsoft Excel</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size=\"2\" baseType=\"variant\"><vt:variant><vt:lpstr>Hojas de cálculo</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size=\"1\" baseType=\"lpstr\"><vt:lpstr>Hoja1</vt:lpstr></vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>",
"_rels/.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>",
"xl/styles.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"x14ac x16r2 xr\" xmlns:x14ac=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac\" xmlns:x16r2=\"http://schemas.microsoft.com/office/spreadsheetml/2015/02/main\" xmlns:xr=\"http://schemas.microsoft.com/office/spreadsheetml/2014/revision\"><fonts count=\"8\" x14ac:knownFonts=\"1\"><font><sz val=\"11\"/><color theme=\"1\"/><name val=\"Aptos Narrow\"/><family val=\"2\"/><scheme val=\"minor\"/></font><font><b/><sz val=\"12\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/></font><font><sz val=\"12\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/></font><font><b/><sz val=\"11\"/><color rgb=\"FFFF0000\"/><name val=\"Aptos Narrow\"/><family val=\"2\"/><scheme val=\"minor\"/></font><font><b/><sz val=\"12\"/><color rgb=\"FFFF0000\"/><name val=\"Aptos Narrow\"/><family val=\"2\"/><scheme val=\"minor\"/></font><font><sz val=\"12\"/><color theme=\"1\"/><name val=\"Aptos Narrow\"/><family val=\"2\"/><scheme val=\"minor\"/></font><font><u/><sz val=\"11\"/><color theme=\"10\"/><name val=\"Aptos Narrow\"/><family val=\"2\"/><scheme val=\"minor\"/></font><font><sz val=\"11\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/></font></fonts><fills count=\"5\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFFFC000\"/><bgColor indexed=\"64\"/></patternFill></fill><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFC27BA0\"/><bgColor indexed=\"64\"/></patternFill></fill><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF00B0F0\"/><bgColor indexed=\"64\"/></patternFill></fill></fills><borders count=\"3\"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border></borders><cellStyleXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/><xf numFmtId=\"0\" fontId=\"6\" fillId=\"0\" borderId=\"0\" applyNumberFormat=\"0\" applyFill=\"0\" applyBorder=\"0\" applyAlignment=\"0\" applyProtection=\"0\"/></cellStyleXfs><cellXfs count=\"19\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"3\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"14\" fontId=\"2\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"1\" fontId=\"2\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"2\" fillId=\"4\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyBorder=\"1\"/><xf numFmtId=\"3\" fontId=\"2\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"4\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"5\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/><xf numFmtId=\"0\" fontId=\"3\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"7\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"6\" fillId=\"0\" borderId=\"1\" xfId=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"2\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"7\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" wrapText=\"1\"/></xf></cellXfs><cellStyles count=\"2\"><cellStyle name=\"Hipervínculo\" xfId=\"1\" builtinId=\"8\"/><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles><dxfs count=\"0\"/><tableStyles count=\"0\" defaultTableStyle=\"TableStyleMedium2\" defaultPivotStyle=\"PivotStyleLight16\"/><extLst><ext uri=\"{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}\" xmlns:x14=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/main\"><x14:slicerStyles defaultSlicerStyle=\"SlicerStyleLight1\"/></ext><ext uri=\"{9260A510-F301-46a8-8635-F512D64BE5F5}\" xmlns:x15=\"http://schemas.microsoft.com/office/spreadsheetml/2010/11/main\"><x15:timelineStyles defaultTimelineStyle=\"TimeSlicerStyleLight1\"/></ext></extLst></styleSheet>",
"xl/workbook.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"x15 xr xr6 xr10 xr2\" xmlns:x15=\"http://schemas.microsoft.com/office/spreadsheetml/2010/11/main\" xmlns:xr=\"http://schemas.microsoft.com/office/spreadsheetml/2014/revision\" xmlns:xr6=\"http://schemas.microsoft.com/office/spreadsheetml/2016/revision6\" xmlns:xr10=\"http://schemas.microsoft.com/office/spreadsheetml/2016/revision10\" xmlns:xr2=\"http://schemas.microsoft.com/office/spreadsheetml/2015/revision2\"><fileVersion appName=\"xl\" lastEdited=\"7\" lowestEdited=\"7\" rupBuild=\"30326\"/><workbookPr defaultThemeVersion=\"202300\"/><bookViews><workbookView xWindow=\"-108\" yWindow=\"-108\" windowWidth=\"23256\" windowHeight=\"12456\"/></bookViews><sheets><sheet name=\"Hoja1\" sheetId=\"1\" r:id=\"rId1\"/></sheets><definedNames><definedName name=\"_xlnm._FilterDatabase\" localSheetId=\"0\" hidden=\"1\">Hoja1!$A$1:$V$16</definedName></definedNames><calcPr calcId=\"191029\"/><extLst><ext uri=\"{140A7094-0E35-4892-8432-C4D2E57EDEB5}\" xmlns:x15=\"http://schemas.microsoft.com/office/spreadsheetml/2010/11/main\"><x15:workbookPr chartTrackingRefBase=\"1\"/></ext><ext uri=\"{B58B0392-4F1F-4190-BB64-5DF3571DCE5F}\" xmlns:xcalcf=\"http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures\"><xcalcf:calcFeatures><xcalcf:feature name=\"microsoft.com:RD\"/><xcalcf:feature name=\"microsoft.com:Single\"/><xcalcf:feature name=\"microsoft.com:FV\"/><xcalcf:feature name=\"microsoft.com:CNMTM\"/><xcalcf:feature name=\"microsoft.com:LET_WF\"/><xcalcf:feature name=\"microsoft.com:LAMBDA_WF\"/><xcalcf:feature name=\"microsoft.com:ARRAYTEXT_WF\"/></xcalcf:calcFeatures></ext></extLst></workbook>",
"xl/worksheets/sheet1.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"x14ac xr xr2 xr3\" xmlns:x14ac=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac\" xmlns:xr=\"http://schemas.microsoft.com/office/spreadsheetml/2014/revision\" xmlns:xr2=\"http://schemas.microsoft.com/office/spreadsheetml/2015/revision2\" xmlns:xr3=\"http://schemas.microsoft.com/office/spreadsheetml/2016/revision3\"><dimension ref=\"A1:V16\"/><sheetViews><sheetView tabSelected=\"1\" workbookViewId=\"0\"><selection activeCell=\"A1\" sqref=\"A1\"/></sheetView></sheetViews><sheetFormatPr baseColWidth=\"10\" defaultRowHeight=\"14.4\" x14ac:dyDescent=\"0.3\"/><cols><col min=\"1\" max=\"1\" width=\"16.6640625\" bestFit=\"1\" customWidth=\"1\"/><col min=\"2\" max=\"2\" width=\"9\" bestFit=\"1\" customWidth=\"1\"/><col min=\"3\" max=\"3\" width=\"10.6640625\" bestFit=\"1\" customWidth=\"1\"/><col min=\"4\" max=\"4\" width=\"8.109375\" customWidth=\"1\"/><col min=\"5\" max=\"5\" width=\"11\" bestFit=\"1\" customWidth=\"1\"/><col min=\"6\" max=\"6\" width=\"28.44140625\" customWidth=\"1\"/><col min=\"7\" max=\"7\" width=\"15.6640625\" customWidth=\"1\"/><col min=\"8\" max=\"8\" width=\"15.77734375\" customWidth=\"1\"/><col min=\"9\" max=\"9\" width=\"21\" customWidth=\"1\"/><col min=\"10\" max=\"10\" width=\"36.77734375\" customWidth=\"1\"/><col min=\"11\" max=\"11\" width=\"33.21875\" customWidth=\"1\"/><col min=\"12\" max=\"12\" width=\"19.44140625\" customWidth=\"1\"/><col min=\"13\" max=\"13\" width=\"17.77734375\" customWidth=\"1\"/><col min=\"14\" max=\"14\" width=\"15.77734375\" customWidth=\"1\"/><col min=\"15\" max=\"15\" width=\"40.77734375\" customWidth=\"1\"/><col min=\"16\" max=\"16\" width=\"16.6640625\" bestFit=\"1\" customWidth=\"1\"/><col min=\"17\" max=\"17\" width=\"11.77734375\" bestFit=\"1\" customWidth=\"1\"/><col min=\"18\" max=\"18\" width=\"12.109375\" customWidth=\"1\"/><col min=\"19\" max=\"19\" width=\"39\" customWidth=\"1\"/><col min=\"20\" max=\"20\" width=\"15.44140625\" customWidth=\"1\"/><col min=\"21\" max=\"21\" width=\"21.33203125\" customWidth=\"1\"/><col min=\"22\" max=\"22\" width=\"10.6640625\" bestFit=\"1\" customWidth=\"1\"/></cols><sheetData>{{FILAS}}</sheetData><autoFilter ref=\"A1:V16\"/><pageMargins left=\"0.7\" right=\"0.7\" top=\"0.75\" bottom=\"0.75\" header=\"0.3\" footer=\"0.3\"/></worksheet>",
"xl/theme/theme1.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Tema de Office\"><a:themeElements><a:clrScheme name=\"Office\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"0E2841\"/></a:dk2><a:lt2><a:srgbClr val=\"E8E8E8\"/></a:lt2><a:accent1><a:srgbClr val=\"156082\"/></a:accent1><a:accent2><a:srgbClr val=\"E97132\"/></a:accent2><a:accent3><a:srgbClr val=\"196B24\"/></a:accent3><a:accent4><a:srgbClr val=\"0F9ED5\"/></a:accent4><a:accent5><a:srgbClr val=\"A02B93\"/></a:accent5><a:accent6><a:srgbClr val=\"4EA72E\"/></a:accent6><a:hlink><a:srgbClr val=\"467886\"/></a:hlink><a:folHlink><a:srgbClr val=\"96607D\"/></a:folHlink></a:clrScheme><a:fontScheme name=\"Office\"><a:majorFont><a:latin typeface=\"Aptos Display\" panose=\"02110004020202020204\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"游ゴシック Light\"/><a:font script=\"Hang\" typeface=\"맑은 고딕\"/><a:font script=\"Hans\" typeface=\"等线 Light\"/><a:font script=\"Hant\" typeface=\"新細明體\"/><a:font script=\"Arab\" typeface=\"Times New Roman\"/><a:font script=\"Hebr\" typeface=\"Times New Roman\"/><a:font script=\"Thai\" typeface=\"Tahoma\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"MoolBoran\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Times New Roman\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/><a:font script=\"Geor\" typeface=\"Sylfaen\"/><a:font script=\"Armn\" typeface=\"Arial\"/><a:font script=\"Bugi\" typeface=\"Leelawadee UI\"/><a:font script=\"Bopo\" typeface=\"Microsoft JhengHei\"/><a:font script=\"Java\" typeface=\"Javanese Text\"/><a:font script=\"Lisu\" typeface=\"Segoe UI\"/><a:font script=\"Mymr\" typeface=\"Myanmar Text\"/><a:font script=\"Nkoo\" typeface=\"Ebrima\"/><a:font script=\"Olck\" typeface=\"Nirmala UI\"/><a:font script=\"Osma\" typeface=\"Ebrima\"/><a:font script=\"Phag\" typeface=\"Phagspa\"/><a:font script=\"Syrn\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syrj\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syre\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Sora\" typeface=\"Nirmala UI\"/><a:font script=\"Tale\" typeface=\"Microsoft Tai Le\"/><a:font script=\"Talu\" typeface=\"Microsoft New Tai Lue\"/><a:font script=\"Tfng\" typeface=\"Ebrima\"/></a:majorFont><a:minorFont><a:latin typeface=\"Aptos Narrow\" panose=\"02110004020202020204\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"游ゴシック\"/><a:font script=\"Hang\" typeface=\"맑은 고딕\"/><a:font script=\"Hans\" typeface=\"等线\"/><a:font script=\"Hant\" typeface=\"新細明體\"/><a:font script=\"Arab\" typeface=\"Arial\"/><a:font script=\"Hebr\" typeface=\"Arial\"/><a:font script=\"Thai\" typeface=\"Tahoma\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"DaunPenh\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Arial\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/><a:font script=\"Geor\" typeface=\"Sylfaen\"/><a:font script=\"Armn\" typeface=\"Arial\"/><a:font script=\"Bugi\" typeface=\"Leelawadee UI\"/><a:font script=\"Bopo\" typeface=\"Microsoft JhengHei\"/><a:font script=\"Java\" typeface=\"Javanese Text\"/><a:font script=\"Lisu\" typeface=\"Segoe UI\"/><a:font script=\"Mymr\" typeface=\"Myanmar Text\"/><a:font script=\"Nkoo\" typeface=\"Ebrima\"/><a:font script=\"Olck\" typeface=\"Nirmala UI\"/><a:font script=\"Osma\" typeface=\"Ebrima\"/><a:font script=\"Phag\" typeface=\"Phagspa\"/><a:font script=\"Syrn\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syrj\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syre\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Sora\" typeface=\"Nirmala UI\"/><a:font script=\"Tale\" typeface=\"Microsoft Tai Le\"/><a:font script=\"Talu\" typeface=\"Microsoft New Tai Lue\"/><a:font script=\"Tfng\" typeface=\"Ebrima\"/></a:minorFont></a:fontScheme><a:fmtScheme name=\"Office\"><a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"110000\"/><a:satMod val=\"105000\"/><a:tint val=\"67000\"/></a:schemeClr></a:gs><a:gs pos=\"50000\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"105000\"/><a:satMod val=\"103000\"/><a:tint val=\"73000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"105000\"/><a:satMod val=\"109000\"/><a:tint val=\"81000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"5400000\" scaled=\"0\"/></a:gradFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:satMod val=\"103000\"/><a:lumMod val=\"102000\"/><a:tint val=\"94000\"/></a:schemeClr></a:gs><a:gs pos=\"50000\"><a:schemeClr val=\"phClr\"><a:satMod val=\"110000\"/><a:lumMod val=\"100000\"/><a:shade val=\"100000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"99000\"/><a:satMod val=\"120000\"/><a:shade val=\"78000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"5400000\" scaled=\"0\"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w=\"12700\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln><a:ln w=\"19050\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln><a:ln w=\"25400\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"57150\" dist=\"19050\" dir=\"5400000\" algn=\"ctr\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"63000\"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"><a:tint val=\"95000\"/><a:satMod val=\"170000\"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"93000\"/><a:satMod val=\"150000\"/><a:shade val=\"98000\"/><a:lumMod val=\"102000\"/></a:schemeClr></a:gs><a:gs pos=\"50000\"><a:schemeClr val=\"phClr\"><a:tint val=\"98000\"/><a:satMod val=\"130000\"/><a:shade val=\"90000\"/><a:lumMod val=\"103000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"63000\"/><a:satMod val=\"120000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"5400000\" scaled=\"0\"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults><a:lnDef><a:spPr/><a:bodyPr/><a:lstStyle/><a:style><a:lnRef idx=\"2\"><a:schemeClr val=\"accent1\"/></a:lnRef><a:fillRef idx=\"0\"><a:schemeClr val=\"accent1\"/></a:fillRef><a:effectRef idx=\"1\"><a:schemeClr val=\"accent1\"/></a:effectRef><a:fontRef idx=\"minor\"><a:schemeClr val=\"tx1\"/></a:fontRef></a:style></a:lnDef></a:objectDefaults><a:extraClrSchemeLst/><a:extLst><a:ext uri=\"{05A4C25C-085E-4340-85A3-A5531E510DB2}\"><thm15:themeFamily xmlns:thm15=\"http://schemas.microsoft.com/office/thememl/2012/main\" name=\"Office Theme\" id=\"{2E142A2C-CD16-42D6-873A-C26D2A0506FA}\" vid=\"{1BDDFF52-6CD6-40A5-AB3C-68EB2F1E4D0A}\"/></a:ext></a:extLst></a:theme>",
"xl/_rels/workbook.xml.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"theme/theme1.xml\"/><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId4\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings\" Target=\"sharedStrings.xml\"/></Relationships>"
}
};


/* =========================================================
   SEGUIMIENTO DIARIO DE OT
   - Se importa el "Reporte de Órdenes Finalizadas" de la plataforma
     en cada corte (8am, 12md, 3pm...). La OT es la llave: si ya
     estaba, conserva el corte en que apareció por primera vez.
   - Instaladas = OT distintas finalizadas ese día.
   - Pendientes = (asignadas + relleno) - (instaladas + iniciadas)
                  - suspendidas - reasignadas
   - Los materiales se importan aparte y se cruzan por N° de OT.
   ========================================================= */

const SEG = {

  HOJAS: {
    DIA: 'SEG_DIA',
    OT: 'SEG_OT',
    SUSP: 'SEG_SUSP',
    CORTES: 'SEG_CORTES',
    TIEMPOS: 'SEG_TIEMPOS',
    AUSENCIAS: 'SEG_AUSENCIAS'
  },

  HEADERS: {
    DIA: ['Fecha', 'ID_Movil', 'Movil', 'Asignadas', 'Relleno', 'Reasignadas',
      'Iniciadas', 'Hora_Inicio', 'Justificacion', 'Estado_Movil', 'Obs',
      'Usuario', 'Actualizado', 'Almuerzo_Desde', 'Salida_VB'],
    OT: ['Fecha', 'N_Orden', 'Contrato', 'Cod_Movil', 'ID_Movil', 'Movil',
      'Tecnico_1', 'Tecnico_2', 'Tipo_Orden', 'Averia', 'Servicio',
      'Hora_Ejecuta', 'Hora_Ini', 'Corte', 'Estado', 'Ultimo_Corte', 'Archivo',
      'Hora_Fin', 'Motivo_Sus', 'Movil_Origen', 'Estado_Previo', 'Corte_Finalizada'],
    SUSP: ['ID', 'Fecha', 'Contrato', 'N_Orden', 'ID_Movil', 'Movil', 'Tecnico',
      'Tipo_OT', 'Zona', 'Motivo', 'Observacion', 'Usuario', 'Creado'],
    CORTES: ['Fecha_Hora', 'Fecha', 'Corte', 'Archivo', 'Filas', 'Nuevas',
      'Ya_Estaban', 'Reaparecidas', 'Desaparecidas', 'Ignoradas', 'Usuario'],
    TIEMPOS: ['Fecha', 'N_Orden', 'Tipo', 'ID_Movil', 'Justificacion', 'Usuario', 'Actualizado'],
    AUSENCIAS: ['ID', 'Fecha', 'Tipo', 'ID_Movil', 'Movil', 'Tecnico', 'Zona', 'Motivo', 'Reporto',
      'Cubrio_Ruta', 'Cubierta_Por', 'Penaliza', 'Monto', 'Estado_Pen', 'Fecha_Aplicada',
      'Hora_Salida', 'Autorizo', 'Obs', 'Usuario', 'Creado', 'Actualizado']
  },

  /* Columnas que deben quedarse como texto (fechas, OT, contratos, horas) */
  TEXTO: {
    DIA: ['Fecha', 'ID_Movil', 'Movil', 'Hora_Inicio', 'Almuerzo_Desde', 'Salida_VB'],
    OT: ['Fecha', 'N_Orden', 'Contrato', 'Cod_Movil', 'ID_Movil', 'Movil',
      'Hora_Ejecuta', 'Hora_Ini', 'Hora_Fin', 'Corte', 'Ultimo_Corte', 'Movil_Origen', 'Corte_Finalizada'],
    SUSP: ['ID', 'Fecha', 'Contrato', 'N_Orden', 'ID_Movil', 'Movil', 'Creado'],
    CORTES: ['Fecha_Hora', 'Fecha', 'Corte'],
    TIEMPOS: ['Fecha', 'N_Orden', 'Tipo', 'ID_Movil'],
    AUSENCIAS: ['ID', 'Fecha', 'ID_Movil', 'Movil', 'Fecha_Aplicada', 'Hora_Salida', 'Creado', 'Actualizado']
  },

  PENALIZACIONES: { 'Ausencia': 75000, 'Abandono de ruta': 25000, 'Salida temprano': 0 },
  MOTIVOS_AUS: ['Sin aviso', 'Enfermedad / incapacidad', 'Permiso', 'Vacaciones', 'Falla de vehículo', 'Calamidad / emergencia', 'Salió sin autorización', 'Cita médica', 'Asunto personal / familiar', 'Otro'],

  CORTES: ['6am', '7am', '8am', '9am', '10am', '11am', '12md', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', 'Cierre'],

  MOTIVOS: [
    'SUSPENDIDA CLIENTE NO DESEA EL SERVICIO',
    'SUSPENDIDA CLIENTE NO SE LOCALIZA',
    'SUSPENDIDA FUERA DE RUTA',
    'SUSPENDIDA POR CLIENTE',
    'SUSPENDIDA POR DISTANCIA',
    'SUSPENDIDA POR DUCTOS',
    'SUSPENDIDA POR FALTA DE TIEMPO',
    'SUSPENDIDA POR GARANTIA NO APLICA',
    'SUSPENDIDA POR CLIMA // LLUVIA',
    'SUSPENDIDA POR MOVIL SIN MATERIALES O EQUIPOS',
    'SUSPENDIDA POR NAP SATURADO',
    'SUSPENDIDA POR NAP SIN POTENCIA',
    'SUSPENDIDA POR FALTA DE RED',
    'SUSPENDIDA POR RED SIN ACERO',
    'SUSPENDIDA POR TRABAJO ESPECIAL',
    'SUSPENDIDA POR ZONA PELIGROSA',
    'YA INSTALADA'
  ],

  /* Si la primera OT de una móvil activa se inicia después de esta hora, se marca "inicio tardío" */
  HORA_TARDE: '08:30',

  /* Tiempos estándar en minutos */
  MIN_PRIMARIA: 60,
  MIN_SECUNDARIA: 45,
  MIN_TRASLADO: 30,

  /* Alerta: móvil activa, con OT pendientes y sin iniciar nada por más de estos minutos */
  MIN_ALERTA_SIN_INICIAR: 30,

  /* Almuerzo: minutos que se le dan a una móvil desde que finalizó su última OT */
  MIN_CORTE: 60,
  CORTES_DESDE: '06:00',
  CORTES_HASTA: '17:30',
  MIN_ALMUERZO: 60,

  /* Zona horaria de las horas del reporte */
  TZ: 'America/Costa_Rica'
};

/* Para dar formato de texto una sola vez por ejecución */
const SEG_FORMATEADAS = {};

function segHoja_(clave) {
  const ss = obtenerSpreadsheet_();
  const nombre = SEG.HOJAS[clave];

  /* Una hoja ya verificada (encabezados y formato de texto) no se vuelve a revisar en cada llamada */
  const llave = 'segok_' + clave + '_' + SEG.HEADERS[clave].join('').length;
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  if (cache && cache.get(llave)) {
    const rapida = ss.getSheetByName(nombre);
    if (rapida) return rapida;
  }

  const nueva = !ss.getSheetByName(nombre);
  const sh = asegurarHoja_(ss, nombre, SEG.HEADERS[clave]);
  if (!SEG_FORMATEADAS[clave]) {
    SEG_FORMATEADAS[clave] = true;
    formatearColumnasTexto_(sh, SEG.TEXTO[clave]);
  }
  if (nueva) {
    sh.getRange(1, 1, 1, SEG.HEADERS[clave].length)
      .setFontWeight('bold').setBackground('#b71c1c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  if (cache) { try { cache.put(llave, '1', 21600); } catch (e) { /* sin caché: solo es más lento */ } }
  return sh;
}

function segNorm_(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function segFila_(o) {
  const r = {};
  Object.keys(o || {}).forEach(k => { r[segNorm_(k)] = o[k]; });
  return r;
}

/* Primer valor no vacío entre varios nombres posibles de columna */
function segG_(r) {
  for (let i = 1; i < arguments.length; i++) {
    const v = r[arguments[i]];
    if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '0') return v;
  }
  return '';
}

function segFecha_(v) {
  if (v instanceof Date) return isNaN(v) ? '' : formatearFechaISO_(v);
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + p2_(m[2]) + '-' + p2_(m[1]);
  return '';
}

function segHora_(v) {
  const m = String(v == null ? '' : v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return '';
  const r = p2_(m[1]) + ':' + m[2] + ':' + (m[3] || '00');
  return r === '00:00:00' ? '' : r;
}

function segOrden_(v) {
  return txt_(v).replace(/\.0+$/, '').replace(/\s+/g, '');
}

function segNum_(v) {
  const n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10);
  return isNaN(n) || n < 0 ? 0 : Math.min(n, 9999);
}

/* "SRD - M114" / "SRD- M188" / "114"  ->  "114" */
function segNumMovil_(desc) {
  const s = txt_(desc);
  let m = s.match(/M\s*(\d+)/i);
  if (m) return String(Number(m[1]));
  m = s.match(/^\d{1,3}$/);
  return m ? String(Number(m[0])) : '';
}

/* Hora y fecha de hoy en la zona horaria del reporte (no depende de la zona del proyecto) */
function segHoraAhora_() {
  return Utilities.formatDate(new Date(), SEG.TZ, 'HH:mm');
}

function segHoyISO_() {
  return Utilities.formatDate(new Date(), SEG.TZ, 'yyyy-MM-dd');
}

function segAhora_() {
  return Utilities.formatDate(new Date(), SEG.TZ, 'yyyy-MM-dd HH:mm:ss');
}

function segMapaMoviles_() {
  const moviles = obtenerMoviles_();
  const porTlc = {}, porNum = {}, porId = {};
  moviles.forEach(m => {
    porId[String(m.ID_Movil)] = m;
    const t = txt_(m.ID_Movil_TLC);
    if (t) porTlc[t] = m;
    const n = String(m.Movil == null ? '' : m.Movil).replace(/\D/g, '');
    if (n) porNum[String(Number(n))] = m;
  });
  return { moviles: moviles, porTlc: porTlc, porNum: porNum, porId: porId };
}

/* Devuelve la móvil de la ficha que corresponde al código de plataforma / descripción */
function segResolver_(mm, cod, desc) {
  const c = txt_(cod);
  if (c && mm.porTlc[c]) return mm.porTlc[c];
  const n = segNumMovil_(desc);
  if (n && mm.porNum[n]) return mm.porNum[n];
  return null;
}

function segLeer_(clave, desde, hasta) {
  if (desde || hasta) return leerObjetosPorFecha_(segHoja_(clave), 'Fecha', desde, hasta);
  return leerObjetos_(segHoja_(clave));
}

/* Estado de la móvil en el cronograma -> texto que usa el cliente */
function segEtiquetaEstado_(e) {
  return ({ 'Activa': 'Activa', 'Backup': 'Back up', 'Varada': 'Varado // Suspendido' })[e] || e || '';
}

function segMinHora_(a, b) {
  return (!a || (b && b < a)) ? b : a;
}

/* ---------- Lectura del día ---------- */

function segMin_(hora) {
  const m = String(hora || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? Number(m[1]) * 60 + Number(m[2]) + (Number(m[3] || 0) / 60) : null;
}

function segMinTxt_(min) {
  const h = Math.floor(min / 60), m = Math.floor(min % 60);
  return p2_(h) + ':' + p2_(m);
}

/* Tiempos de ejecución (OT primaria / secundaria) y de traslado entre OT de una misma móvil */
function segCalcularTiempos_(ots, fecha, justif, almuerzos) {
  almuerzos = almuerzos || {};

  const porMovil = {};
  ots.forEach(o => {
    const est = txt_(o.Estado).toUpperCase();
    if (est === 'DESAPARECIDA' || est === 'REASIGNADA' || est === 'SUSPENDIDA') return;
    const ini = segMin_(txt_(o.Hora_Ini));
    if (ini === null) return;
    const clave = txt_(o.ID_Movil) || ('x' + txt_(o.Movil));
    (porMovil[clave] = porMovil[clave] || []).push({
      o: o, ini: ini, fin: est === 'FINALIZADA' ? segMin_(txt_(o.Hora_Fin)) : null, est: est
    });
  });

  const hoy = fecha === segHoyISO_();
  const ahora = hoy ? segMin_(segHoraAhora_()) : null;
  const excesos = [];

  const base = (it, tipo, clave) => ({
    clave: txt_(it.o.N_Orden) + '|' + clave, orden: txt_(it.o.N_Orden), tipoMarca: clave,
    contrato: txt_(it.o.Contrato), idMovil: txt_(it.o.ID_Movil), movil: txt_(it.o.Movil),
    tecnico: txt_(it.o.Tecnico_1), tipoOt: /PRIMARIA/i.test(txt_(it.o.Tipo_Orden)) ? 'Primaria' : 'Secundaria',
    trabajo: txt_(it.o.Averia), tipo: tipo,
    justificacion: justif[txt_(it.o.N_Orden) + '|' + clave] || ''
  });

  Object.keys(porMovil).forEach(k => {

    const lista = porMovil[k].sort((a, b) => a.ini - b.ini);

    lista.forEach((it, i) => {

      const std = /PRIMARIA/i.test(txt_(it.o.Tipo_Orden)) ? SEG.MIN_PRIMARIA : SEG.MIN_SECUNDARIA;

      let dur = null, tipo = '';
      if (it.est === 'FINALIZADA' && it.fin !== null && it.fin >= it.ini) { dur = it.fin - it.ini; tipo = 'Ejecución'; }
      else if (it.est === 'INICIADA' && ahora !== null && ahora >= it.ini) { dur = ahora - it.ini; tipo = 'En curso'; }

      if (dur !== null && dur > std) {
        const e = base(it, tipo, 'EJEC');
        e.inicio = segMinTxt_(it.ini);
        e.fin = it.fin !== null ? segMinTxt_(it.fin) : '';
        e.minutos = Math.round(dur); e.estandar = std; e.exceso = Math.round(dur - std);
        excesos.push(e);
      }

      const prev = lista[i - 1];
      if (prev && prev.fin !== null && it.ini >= prev.fin) {
        let gap = it.ini - prev.fin;
        /* Si a la móvil se le marcó almuerzo justo al terminar la OT anterior, esa hora no cuenta */
        const idm = txt_(it.o.ID_Movil);
        const alm = almuerzos[idm] && almuerzos[idm] === segMinTxt_(prev.fin);
        if (alm) gap = Math.max(0, gap - SEG.MIN_ALMUERZO);
        if (gap > SEG.MIN_TRASLADO) {
          const e = base(it, 'Traslado', 'TRASL');
          e.inicio = segMinTxt_(prev.fin);
          e.fin = segMinTxt_(it.ini);
          e.anterior = txt_(prev.o.N_Orden);
          e.minutos = Math.round(gap); e.estandar = SEG.MIN_TRASLADO; e.exceso = Math.round(gap - SEG.MIN_TRASLADO);
          if (alm) e.conAlmuerzo = true;
          excesos.push(e);
        }
      }
    });
  });

  return excesos.sort((a, b) => b.exceso - a.exceso);
}

function obtenerSeguimientoWeb(token, fecha) {

  requerirSesion_(token, 'consulta');

  fecha = segFecha_(fecha) || segHoyISO_();
  const f = convertirFecha_(fecha);
  const desde14 = formatearFechaISO_(sumarDias_(f, -13));

  const mm = segMapaMoviles_();
  const asigs = leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES));
  const reg = obtenerRegistroMapa_(f, f);

  const otsTodas = segLeer_('OT', desde14, fecha).filter(o => {
    const d = txt_(o.Fecha);
    return d >= desde14 && d <= fecha;
  });
  const suspTodas = segLeer_('SUSP', desde14, fecha).filter(s => {
    const d = txt_(s.Fecha);
    return d >= desde14 && d <= fecha;
  });

  const ots = otsTodas.filter(o => txt_(o.Fecha) === fecha);
  const suspManual = suspTodas.filter(s => txt_(s.Fecha) === fecha);

  /* OT que ya no aparecen en la plataforma y el back office marcó como suspendidas */
  const marcadas = {};
  suspManual.forEach(s => { if (txt_(s.N_Orden)) marcadas[txt_(s.N_Orden)] = 1; });
  const estadoPorOrden = {};
  ots.forEach(o => { estadoPorOrden[txt_(o.N_Orden)] = txt_(o.Estado).toUpperCase(); });
  const dias = segLeer_('DIA', fecha, fecha).filter(d => txt_(d.Fecha) === fecha);
  const log = segLeer_('CORTES', fecha, fecha).filter(c => txt_(c.Fecha) === fecha);

  const justif = {};
  segLeer_('TIEMPOS', fecha, fecha).forEach(j => {
    if (txt_(j.Fecha) === fecha) justif[txt_(j.N_Orden) + '|' + txt_(j.Tipo)] = txt_(j.Justificacion);
  });

  const estadoDe = o => txt_(o.Estado).toUpperCase();

  /* ¿El día viene del reporte de seguimiento completo? Entonces los números salen solos */
  const auto = ots.some(o => ['PENDIENTE', 'INICIADA', 'REASIGNADA', 'SUSPENDIDA'].indexOf(estadoDe(o)) !== -1) ||
    log.some(c => /seguimiento/i.test(txt_(c.Archivo)));

  const filas = {};
  const asegurar = m => {
    const id = String(m.ID_Movil);
    if (!filas[id]) {
      filas[id] = {
        idMovil: id, movil: txt_(m.Movil), tecnico: '', zona: txt_(m.Domicilio),
        estadoCal: '', estadoMovil: '', asignadas: 0, relleno: 0, reasignadas: 0,
        iniciadas: 0, instaladas: 0, suspendidas: 0, pendientes: 0, pendPlataforma: 0,
        horaInicio: '', horaManual: '', almuerzoDesde: '', salidaVB: '', ultimaFin: '', sinIniciarMin: null, enAlmuerzo: false, almuerzoHasta: '', horaAuto: '', justificacion: '', obs: '', tarde: false,
        auto: auto
      };
    }
    return filas[id];
  };

  mm.moviles.forEach(m => {
    const e = reg[claveRegistro_(m.ID_Movil, fecha)];
    if (e && e !== 'Libre') asegurar(m).estadoCal = e;
  });

  const sinMovil = [];
  const lista = [];
  const desaparecidas = [];
  const movidas = [];
  const vistos = {};
  const suspPlat = [];

  ots.forEach(o => {
    const orden = txt_(o.N_Orden);
    const m = mm.porId[txt_(o.ID_Movil)] || segResolver_(mm, o.Cod_Movil, o.Movil);
    const estado = estadoDe(o);
    const origen = txt_(o.Movil_Origen);
    const item = {
      orden: orden, contrato: txt_(o.Contrato), movil: m ? txt_(m.Movil) : txt_(o.Movil),
      idMovil: m ? String(m.ID_Movil) : '', tecnico: txt_(o.Tecnico_1),
      tipo: txt_(o.Tipo_Orden), averia: txt_(o.Averia), hora: txt_(o.Hora_Ejecuta),
      horaIni: txt_(o.Hora_Ini), horaFin: txt_(o.Hora_Fin),
      corte: txt_(o.Corte), estado: estado, motivo: txt_(o.Motivo_Sus),
      movilOrigen: origen, estadoPrevio: txt_(o.Estado_Previo), ultimoCorte: txt_(o.Ultimo_Corte)
    };
    lista.push(item);

    if (estado === 'DESAPARECIDA' && !marcadas[orden]) { desaparecidas.push(item); return; }
    if (estado === 'DESAPARECIDA' && marcadas[orden] && vistos[orden]) return;
    if (vistos[orden]) return;
    vistos[orden] = true;

    if (origen && item.movil && origen !== item.movil) movidas.push({ orden: orden, de: origen, a: item.movil });

    if (!m) { sinMovil.push(item); return; }
    const r = asegurar(m);

    r.horaAuto = segMinHora_(r.horaAuto, segHora_(o.Hora_Ini).slice(0, 5));

    if (estado === 'FINALIZADA') r.instaladas++;
    if (auto) {
      r.asignadas++;
      if (estado === 'INICIADA') r.iniciadas++;
      if (estado === 'REASIGNADA') r.reasignadas++;
      if (estado === 'PENDIENTE') r.pendPlataforma++;
      if (estado === 'SUSPENDIDA') {
        suspPlat.push({
          id: '', contrato: item.contrato, orden: orden, idMovil: String(m.ID_Movil),
          movil: item.movil, tecnico: '', tipo: item.tipo, zona: txt_(m.Domicilio),
          motivo: item.motivo || 'SUSPENDIDA', obs: '', origen: 'plataforma'
        });
      }
    }
  });

  /* Suspendidas: las de la plataforma + las registradas a mano que no estén repetidas */
  const ordenesPlat = {}, contratosPlat = {};
  suspPlat.forEach(s => { ordenesPlat[s.orden] = 1; contratosPlat[s.contrato] = 1; });

  const suspManualFiltradas = suspManual.filter(s =>
    !(txt_(s.N_Orden) && estadoPorOrden[txt_(s.N_Orden)] && estadoPorOrden[txt_(s.N_Orden)] !== 'DESAPARECIDA') &&
    !(txt_(s.N_Orden) && ordenesPlat[txt_(s.N_Orden)]) &&
    !(!txt_(s.N_Orden) && txt_(s.Contrato) && contratosPlat[txt_(s.Contrato)]));

  const suspList = suspManualFiltradas.map(s => ({
    id: txt_(s.ID), contrato: txt_(s.Contrato), orden: txt_(s.N_Orden),
    idMovil: txt_(s.ID_Movil), movil: txt_(s.Movil), tecnico: txt_(s.Tecnico),
    tipo: txt_(s.Tipo_OT), zona: txt_(s.Zona), motivo: txt_(s.Motivo),
    obs: txt_(s.Observacion), origen: 'manual'
  })).concat(suspPlat);

  suspList.forEach(s => {
    const m = mm.porId[s.idMovil];
    if (m) asegurar(m).suspendidas++;
  });

  dias.forEach(d => {
    const m = mm.porId[txt_(d.ID_Movil)];
    if (!m) return;
    const r = asegurar(m);
    if (!auto) {
      r.asignadas = segNum_(d.Asignadas);
      r.relleno = segNum_(d.Relleno);
      r.reasignadas = segNum_(d.Reasignadas);
      r.iniciadas = segNum_(d.Iniciadas);
    }
    r.almuerzoDesde = segHora_(d.Almuerzo_Desde).slice(0, 5);
    r.salidaVB = segHora_(d.Salida_VB).slice(0, 5);
    /* La hora de inicio ya no se edita a mano: sale siempre del reporte */
    r.horaManual = '';
    r.horaInicio = '';
    r.justificacion = txt_(d.Justificacion);
    r.estadoMovil = txt_(d.Estado_Movil);
    r.obs = txt_(d.Obs);
  });

  const tot = { asignadas: 0, relleno: 0, reasignadas: 0, iniciadas: 0, instaladas: 0, suspendidas: 0, pendientes: 0 };

  const resultado = Object.keys(filas).map(id => {
    const r = filas[id];
    const m = mm.porId[id];
    r.tecnico = tecnicoEnFecha_(asigs, id, f, m ? m.Tecnico_Actual : '') || '';
    if (!r.estadoMovil) r.estadoMovil = segEtiquetaEstado_(r.estadoCal);
    if (!r.horaInicio) r.horaInicio = r.horaAuto;
    r.sinCarga = (r.asignadas + r.relleno) === 0;
    r.pendientes = r.sinCarga ? 0 :
      (r.asignadas + r.relleno) - (r.instaladas + r.iniciadas) - r.suspendidas - r.reasignadas;
    r.tarde = (!r.estadoCal || r.estadoCal === 'Activa') && !!r.horaInicio && r.horaInicio > SEG.HORA_TARDE;
    Object.keys(tot).forEach(k => { tot[k] += r[k]; });
    return r;
  });

  resultado.sort((a, b) => (Number(a.movil) || 0) - (Number(b.movil) || 0) || a.movil.localeCompare(b.movil));

  /* Avance por corte: OT que se finalizaron en cada corte (acumulado) */
  const porCorte = {};
  ots.forEach(o => {
    if (estadoDe(o) !== 'FINALIZADA') return;
    const c = txt_(o.Corte_Finalizada) || txt_(o.Corte) || 'Sin corte';
    porCorte[c] = (porCorte[c] || 0) + 1;
  });
  const ordenCorte = c => { const i = SEG.CORTES.indexOf(c); return i < 0 ? 999 : i; };
  let acum = 0;
  const cortes = Object.keys(porCorte).sort((a, b) => ordenCorte(a) - ordenCorte(b) || a.localeCompare(b))
    .map(c => { acum += porCorte[c]; return { corte: c, nuevas: porCorte[c], acumulado: acum }; });

  const motivos = {};
  suspList.forEach(s => { const k = s.motivo || 'Sin motivo'; motivos[k] = (motivos[k] || 0) + 1; });

  const tendencia = [];
  for (let i = 13; i >= 0; i--) {
    const d = formatearFechaISO_(sumarDias_(f, -i));
    const set = {};
    otsTodas.forEach(o => {
      if (txt_(o.Fecha) === d && estadoDe(o) === 'FINALIZADA') set[txt_(o.N_Orden)] = 1;
    });
    tendencia.push({
      fecha: d,
      finalizadas: Object.keys(set).length,
      suspendidas: suspTodas.filter(s => txt_(s.Fecha) === d).length +
        otsTodas.filter(o => txt_(o.Fecha) === d && estadoDe(o) === 'SUSPENDIDA').length
    });
  }

  const tecnicoPorMovil = {};
  resultado.forEach(r => { tecnicoPorMovil[r.idMovil] = r.tecnico; });
  const almuerzos = {};
  resultado.forEach(r => { if (r.almuerzoDesde) almuerzos[r.idMovil] = r.almuerzoDesde; });
  const excesos = segCalcularTiempos_(ots, fecha, justif, almuerzos).map(e => {
    if (tecnicoPorMovil[e.idMovil]) e.tecnico = tecnicoPorMovil[e.idMovil];
    return e;
  });

  /* Alertas: móviles activas con trabajo pendiente que llevan mucho tiempo sin iniciar una OT (solo hoy) */
  const esHoy = fecha === segHoyISO_();
  const alertas = [];
  const almuerzosAct = [];
  const ahora = esHoy ? segMin_(segHoraAhora_()) : null;
  const porId = {};
  ots.forEach(o => {
    if (estadoDe(o) === 'DESAPARECIDA') return;
    (porId[txt_(o.ID_Movil)] = porId[txt_(o.ID_Movil)] || []).push(o);
  });

  resultado.forEach(r => {
    const lista = porId[r.idMovil] || [];
    const iniciada = lista.some(o => estadoDe(o) === 'INICIADA');
    let ultimaFin = null, ultimaOt = '';
    lista.forEach(o => {
      if (estadoDe(o) !== 'FINALIZADA') return;
      const fm = segMin_(txt_(o.Hora_Fin));
      if (fm !== null && (ultimaFin === null || fm > ultimaFin)) { ultimaFin = fm; ultimaOt = txt_(o.N_Orden); }
    });
    r.ultimaFin = ultimaFin !== null ? segMinTxt_(ultimaFin) : '';
    r.iniciada = iniciada;

    if (!esHoy || (r.estadoCal && r.estadoCal !== 'Activa') || iniciada || r.salidaVB) return;
    if (!(r.pendPlataforma > 0 || r.pendientes > 0)) return;

    const base = {
      idMovil: r.idMovil, movil: r.movil, tecnico: r.tecnico, zona: r.zona,
      ultimaOt: ultimaOt, pendientes: r.pendPlataforma || r.pendientes
    };

    /* Almuerzo marcado: se le da 1 hora desde que finalizó */
    if (r.almuerzoDesde && segMin_(r.almuerzoDesde) !== null) {
      const hasta = segMin_(r.almuerzoDesde) + SEG.MIN_ALMUERZO;
      r.almuerzoHasta = segMinTxt_(hasta);
      if (ahora < hasta) {
        r.enAlmuerzo = true;
        almuerzosAct.push(Object.assign({}, base, {
          desde: r.almuerzoDesde, hasta: r.almuerzoHasta, restan: Math.round(hasta - ahora)
        }));
        return;
      }
      const min = Math.round(ahora - hasta);
      if (min > 0) {
        r.sinIniciarMin = min;
        alertas.push(Object.assign({}, base, {
          tipo: 'Después del almuerzo', minutos: min, desde: r.almuerzoHasta,
          nivel: min >= SEG.MIN_ALERTA_SIN_INICIAR ? 'alto' : 'medio', puedeAlmuerzo: false
        }));
      }
      return;
    }

    let desde, tipo;
    if (ultimaFin !== null) { desde = ultimaFin; tipo = 'Parada'; }
    else { desde = segMin_(SEG.HORA_TARDE); tipo = 'Sin iniciar'; }
    const min = Math.round(ahora - desde);
    r.sinIniciarMin = min > 0 ? min : 0;
    if (min <= SEG.MIN_ALERTA_SIN_INICIAR) return;
    alertas.push(Object.assign({}, base, {
      tipo: tipo, minutos: min, desde: segMinTxt_(desde),
      nivel: min >= SEG.MIN_ALERTA_SIN_INICIAR * 2 ? 'alto' : 'medio',
      puedeAlmuerzo: ultimaFin !== null
    }));
  });
  alertas.sort((a, b) => b.minutos - a.minutos);


  /* Último corte subido hoy (para avisar si pasa más de 1 hora sin subir uno) */
  let ultimoCorteHora = '', ultimoCorteNombre = '';
  if (esHoy) {
    segLeer_('CORTES').forEach(c => {
      const fh = segHoraLog_(c.Fecha_Hora);
      if (fh.slice(0, 10) !== fecha) return;
      const hh = fh.slice(11, 16);
      if (hh > ultimoCorteHora) { ultimoCorteHora = hh; ultimoCorteNombre = txt_(c.Corte); }
    });
  }

  tot.desaparecidas = desaparecidas.length;
  tot.movidas = movidas.length;

  return {
    fecha: fecha,
    auto: auto,
    moviles: resultado,
    totales: tot,
    totalOt: Object.keys(vistos).filter(k => true).length,
    ordenes: lista,
    sinMovil: sinMovil,
    desaparecidas: desaparecidas,
    movidas: movidas,
    cortes: cortes,
    motivos: Object.keys(motivos).map(k => ({ motivo: k, total: motivos[k] }))
      .sort((a, b) => b.total - a.total),
    suspendidas: suspList,
    tendencia: tendencia,
    tiempos: {
      primaria: SEG.MIN_PRIMARIA, secundaria: SEG.MIN_SECUNDARIA, traslado: SEG.MIN_TRASLADO,
      excesos: excesos
    },
    log: log.map(c => ({
      hora: (c.Fecha_Hora instanceof Date ? Utilities.formatDate(c.Fecha_Hora, SEG.TZ, 'yyyy-MM-dd HH:mm:ss') : txt_(c.Fecha_Hora)), corte: txt_(c.Corte), archivo: txt_(c.Archivo),
      filas: Number(c.Filas) || 0, nuevas: Number(c.Nuevas) || 0,
      desaparecidas: Number(c.Desaparecidas) || 0, usuario: txt_(c.Usuario)
    })),
    listaCortes: SEG.CORTES,
    listaMotivos: SEG.MOTIVOS,
    horaTarde: SEG.HORA_TARDE,
    ultimoCorteHora: ultimoCorteHora, ultimoCorteNombre: ultimoCorteNombre,
    minCorte: SEG.MIN_CORTE, cortesDesde: SEG.CORTES_DESDE, cortesHasta: SEG.CORTES_HASTA,
    esHoy: esHoy,
    alertas: alertas,
    almuerzos: almuerzosAct,
    minAlmuerzo: SEG.MIN_ALMUERZO,
    minAlerta: SEG.MIN_ALERTA_SIN_INICIAR
  };
}

/* ---------- Justificación de tiempos excedidos ---------- */

function guardarJustificacionTiempoWeb(token, fecha, orden, tipo, texto, idMovil) {

  const ses = requerirSesion_(token, 'operador');

  fecha = segFecha_(fecha);
  orden = segOrden_(orden);
  tipo = txt_(tipo);
  if (!fecha || !orden) throw new Error('Datos incompletos.');
  if (tipo !== 'EJEC' && tipo !== 'TRASL' && tipo !== 'ESPERA') throw new Error('Tipo de exceso no válido.');
  texto = txt_(texto).slice(0, 500);

  return conBloqueo_(() => {

    const sh = segHoja_('TIEMPOS');
    const t = leerTabla_(sh);
    const idx = t.idx;
    const ncol = t.values[0].length;
    const o = {
      Fecha: fecha, N_Orden: orden, Tipo: tipo, ID_Movil: txt_(idMovil),
      Justificacion: texto, Usuario: ses.usuario, Actualizado: segAhora_()
    };

    for (let i = 1; i < t.values.length; i++) {
      const r = t.values[i];
      if (txt_(r[idx.Fecha]) === fecha && txt_(r[idx.N_Orden]) === orden && txt_(r[idx.Tipo]) === tipo) {
        Object.keys(o).forEach(n => { if (idx[n] !== undefined) r[idx[n]] = o[n]; });
        sh.getRange(i + 1, 1, 1, ncol).setValues([r]);
        return { ok: true };
      }
    }

    if (!texto) return { ok: true };
    appendPorEncabezados_(sh, o);
    return { ok: true };
  });
}

/* ---------- Datos manuales del día por móvil ---------- */

function guardarSeguimientoWeb(token, fecha, filas) {

  const ses = requerirSesion_(token, 'operador');

  fecha = segFecha_(fecha);
  if (!fecha) throw new Error('Fecha no válida.');
  if (!Array.isArray(filas) || !filas.length) return { ok: true, guardadas: 0 };
  if (filas.length > 200) throw new Error('Demasiadas filas en un solo guardado.');

  return conBloqueo_(() => {

    const mm = segMapaMoviles_();
    const sh = segHoja_('DIA');
    const t = leerTabla_(sh);
    const idx = t.idx;
    const values = t.values;
    const ncol = values[0].length;

    const existentes = {};
    values.forEach((r, i) => {
      if (i === 0) return;
      existentes[txt_(r[idx.Fecha]) + '|' + txt_(r[idx.ID_Movil])] = i;
    });

    const ahora = segAhora_();
    const nuevas = [];
    let cambios = false;
    let guardadas = 0;

    filas.forEach(d => {
      const id = txt_(d.idMovil);
      const m = mm.porId[id];
      if (!m) return;

      const o = {
        Fecha: fecha, ID_Movil: id, Movil: txt_(m.Movil),
        Asignadas: segNum_(d.asignadas), Relleno: segNum_(d.relleno),
        Reasignadas: segNum_(d.reasignadas), Iniciadas: segNum_(d.iniciadas),
        Justificacion: txt_(d.justificacion).slice(0, 500),
        Estado_Movil: txt_(d.estadoMovil).slice(0, 60),
        Obs: txt_(d.obs).slice(0, 500),
        Usuario: ses.usuario, Actualizado: ahora
      };

      const k = fecha + '|' + id;
      if (existentes[k] !== undefined) {
        const fila = values[existentes[k]];
        Object.keys(o).forEach(n => { if (idx[n] !== undefined) fila[idx[n]] = o[n]; });
        cambios = true;
      } else {
        const fila = new Array(ncol).fill('');
        Object.keys(o).forEach(n => { if (idx[n] !== undefined) fila[idx[n]] = o[n]; });
        nuevas.push(fila);
        existentes[k] = -1;
      }
      guardadas++;
    });

    if (cambios) sh.getRange(1, 1, values.length, ncol).setValues(values);
    if (nuevas.length) {
      const ini = sh.getLastRow() + 1;
      if (ini + nuevas.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), nuevas.length);
      sh.getRange(ini, 1, nuevas.length, ncol).setValues(nuevas);
    }

    return { ok: true, guardadas: guardadas };
  });
}

/* Marca (o quita) el almuerzo de una móvil: 1 hora desde que finalizó su última OT */
function guardarAlmuerzoWeb(token, fecha, idMovil, desde) {

  const ses = requerirSesion_(token, 'operador');

  fecha = segFecha_(fecha);
  if (!fecha) throw new Error('Fecha no válida.');
  idMovil = txt_(idMovil);
  const hora = desde ? segHora_(desde).slice(0, 5) : '';
  if (desde && !hora) throw new Error('Hora no válida.');

  return conBloqueo_(() => {

    const mm = segMapaMoviles_();
    const m = mm.porId[idMovil];
    if (!m) throw new Error('Móvil no encontrada.');

    const sh = segHoja_('DIA');
    const t = leerTabla_(sh);
    const idx = t.idx;
    const ncol = t.values[0].length;

    for (let i = 1; i < t.values.length; i++) {
      const r = t.values[i];
      if (txt_(r[idx.Fecha]) === fecha && txt_(r[idx.ID_Movil]) === idMovil) {
        sh.getRange(i + 1, idx.Almuerzo_Desde + 1).setNumberFormat('@').setValue(hora);
        return { ok: true, desde: hora };
      }
    }

    if (!hora) return { ok: true, desde: '' };

    appendPorEncabezados_(sh, {
      Fecha: fecha, ID_Movil: idMovil, Movil: txt_(m.Movil), Asignadas: 0, Relleno: 0,
      Reasignadas: 0, Iniciadas: 0, Usuario: ses.usuario, Actualizado: segAhora_(), Almuerzo_Desde: hora
    });
    return { ok: true, desde: hora };
  });
}


/* VB de salida: la móvil ya fue autorizada a salir; se corta el seguimiento (sin alertas) y queda lista para el cierre.
   hora = 'AHORA' usa la hora actual; vacío quita el VB. */
function guardarSalidaWeb(token, fecha, idMovil, hora) {

  const ses = requerirSesion_(token, 'operador');

  fecha = segFecha_(fecha);
  if (!fecha) throw new Error('Fecha no válida.');
  idMovil = txt_(idMovil);
  hora = txt_(hora);
  if (hora === 'AHORA') hora = segHoraAhora_();
  hora = hora ? segHora_(hora).slice(0, 5) : '';

  return conBloqueo_(() => {

    const mm = segMapaMoviles_();
    const m = mm.porId[idMovil];
    if (!m) throw new Error('Móvil no encontrada.');

    const sh = segHoja_('DIA');
    const t = leerTabla_(sh);
    const idx = t.idx;

    for (let i = 1; i < t.values.length; i++) {
      const r = t.values[i];
      if (txt_(r[idx.Fecha]) === fecha && txt_(r[idx.ID_Movil]) === idMovil) {
        sh.getRange(i + 1, idx.Salida_VB + 1).setNumberFormat('@').setValue(hora);
        return { ok: true, hora: hora };
      }
    }

    if (!hora) return { ok: true, hora: '' };

    appendPorEncabezados_(sh, {
      Fecha: fecha, ID_Movil: idMovil, Movil: txt_(m.Movil), Asignadas: 0, Relleno: 0,
      Reasignadas: 0, Iniciadas: 0, Usuario: ses.usuario, Actualizado: segAhora_(), Salida_VB: hora
    });
    return { ok: true, hora: hora };
  });
}


/* ---------- Corregir / quitar un corte ya importado ---------- */

function segHoraLog_(v) {
  return v instanceof Date ? Utilities.formatDate(v, SEG.TZ, 'yyyy-MM-dd HH:mm:ss') : txt_(v);
}

/* Cambia el nombre de un corte (p. ej. subido como 12md pero era el de la 1pm).
   Solo cambia el nombre del corte en el registro y en las OT; no altera estados ni horas. */
function corregirCorteWeb(token, fecha, horaLog, corteNuevo) {

  requerirSesion_(token, 'operador');

  fecha = segFecha_(fecha);
  horaLog = txt_(horaLog);
  corteNuevo = txt_(corteNuevo);
  if (!fecha || !horaLog) throw new Error('Datos incompletos.');
  if (SEG.CORTES.indexOf(corteNuevo) === -1) throw new Error('Corte no válido: ' + corteNuevo);

  return conBloqueo_(() => {

    const shL = segHoja_('CORTES');
    const tl = leerTabla_(shL);
    let fila = -1, viejo = '';
    for (let i = 1; i < tl.values.length; i++) {
      const r = tl.values[i];
      if (txt_(r[tl.idx.Fecha]) === fecha && segHoraLog_(r[tl.idx.Fecha_Hora]) === horaLog) { fila = i; viejo = txt_(r[tl.idx.Corte]); break; }
    }
    if (fila < 0) throw new Error('No se encontró ese corte en el registro.');
    if (viejo === corteNuevo) return { ok: true, cambiadas: 0 };

    /* Si el nombre viejo ya existía en un corte anterior, solo se tocan las OT finalizadas después de ese corte */
    let corteAntes = '';
    for (let i = 1; i < tl.values.length; i++) {
      if (i === fila) continue;
      const r = tl.values[i];
      if (txt_(r[tl.idx.Fecha]) === fecha && txt_(r[tl.idx.Corte]) === viejo) {
        const h = segHoraLog_(r[tl.idx.Fecha_Hora]);
        if (h < horaLog && h.slice(11, 16) > corteAntes) corteAntes = h.slice(11, 16);
      }
    }

    shL.getRange(fila + 1, tl.idx.Corte + 1).setValue(corteNuevo);

    const sh = segHoja_('OT');
    const t = leerTabla_(sh);
    const idx = t.idx;
    let min = Infinity, max = -1, cambiadas = 0;

    for (let i = 1; i < t.values.length; i++) {
      const r = t.values[i];
      if (txt_(r[idx.Fecha]) !== fecha) continue;
      let mod = false;

      if (txt_(r[idx.Ultimo_Corte]) === viejo) { r[idx.Ultimo_Corte] = corteNuevo; mod = true; }

      if (txt_(r[idx.Corte_Finalizada]) === viejo) {
        const hf = segHora_(txt_(r[idx.Hora_Fin])).slice(0, 5);
        if (!corteAntes || (hf && hf > corteAntes)) { r[idx.Corte_Finalizada] = corteNuevo; mod = true; }
      }
      if (txt_(r[idx.Corte]) === viejo && !corteAntes) { r[idx.Corte] = corteNuevo; mod = true; }

      if (mod) { cambiadas++; min = Math.min(min, i); max = Math.max(max, i); }
    }

    if (max >= 0) {
      const ncol = t.values[0].length;
      sh.getRange(min + 1, 1, max - min + 1, ncol).setValues(t.values.slice(min, max + 1));
    }
    return { ok: true, cambiadas: cambiadas };
  });
}

/* Quita una línea del registro de cortes. No revierte las OT: para corregir estados se vuelve a importar el reporte correcto. */
function eliminarCorteWeb(token, fecha, horaLog) {

  requerirSesion_(token, 'operador');
  fecha = segFecha_(fecha);
  horaLog = txt_(horaLog);

  return conBloqueo_(() => {
    const sh = segHoja_('CORTES');
    const t = leerTabla_(sh);
    for (let i = 1; i < t.values.length; i++) {
      const r = t.values[i];
      if (txt_(r[t.idx.Fecha]) === fecha && segHoraLog_(r[t.idx.Fecha_Hora]) === horaLog) {
        sh.deleteRow(i + 1);
        return { ok: true };
      }
    }
    throw new Error('No se encontró ese corte en el registro.');
  });
}


/* ---------- Ausencias de móviles activas ---------- */

function segRegistroAus_(o) {
  return {
    id: txt_(o.ID), fecha: txt_(o.Fecha), tipo: txt_(o.Tipo) || 'Ausencia', idMovil: txt_(o.ID_Movil), movil: txt_(o.Movil),
    tecnico: txt_(o.Tecnico), zona: txt_(o.Zona), motivo: txt_(o.Motivo),
    reporto: txt_(o.Reporto), cubrio: txt_(o.Cubrio_Ruta), cubiertaPor: txt_(o.Cubierta_Por),
    penaliza: txt_(o.Penaliza), monto: Number(o.Monto) || 0, estadoPen: txt_(o.Estado_Pen),
    fechaAplicada: txt_(o.Fecha_Aplicada), horaSalida: txt_(o.Hora_Salida).slice(0, 5), autorizo: txt_(o.Autorizo), obs: txt_(o.Obs), usuario: txt_(o.Usuario)
  };
}

function obtenerAusenciasWeb(token, desde, hasta) {

  requerirSesion_(token, 'consulta');

  desde = segFecha_(desde);
  hasta = segFecha_(hasta);
  if (!desde || !hasta) throw new Error('Indica el rango de fechas.');

  const registros = segLeer_('AUSENCIAS', desde, hasta)
    .map(segRegistroAus_)
    .filter(r => r.fecha >= desde && r.fecha <= hasta)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.movil.localeCompare(b.movil));

  const resumen = { ausencias: 0, abandonos: 0, salidas: 0, total: registros.length, sinAviso: 0, sinCubrir: 0, penalizaciones: 0,
    pendientes: 0, montoPendiente: 0, aplicadas: 0, montoAplicado: 0 };
  registros.forEach(r => {
    if (r.tipo === 'Abandono de ruta') resumen.abandonos++; else if (r.tipo === 'Salida temprano') resumen.salidas++; else resumen.ausencias++;
    if (r.reporto === 'No' && r.tipo !== 'Salida temprano') resumen.sinAviso++;
    if (r.cubrio === 'No' && r.tipo !== 'Salida temprano') resumen.sinCubrir++;
    if (r.penaliza === 'Sí') {
      resumen.penalizaciones++;
      if (r.estadoPen === 'Aplicada') { resumen.aplicadas++; resumen.montoAplicado += r.monto; }
      else { resumen.pendientes++; resumen.montoPendiente += r.monto; }
    }
  });

  return { desde: desde, hasta: hasta, registros: registros, resumen: resumen,
    motivos: SEG.MOTIVOS_AUS, penalizaciones: SEG.PENALIZACIONES };
}

function guardarAusenciaWeb(token, d) {

  const ses = requerirSesion_(token, 'operador');
  d = d || {};

  const fecha = segFecha_(d.fecha);
  if (!fecha) throw new Error('Fecha no válida.');
  const motivo = txt_(d.motivo).slice(0, 80);
  if (!motivo) throw new Error('Elige el motivo de la ausencia.');
  const si = v => (txt_(v) === 'Sí' ? 'Sí' : 'No');
  const tipo = SEG.PENALIZACIONES[txt_(d.tipo)] !== undefined ? txt_(d.tipo) : 'Ausencia';
  const cubrio = ['Sí', 'No', 'Parcial'].indexOf(txt_(d.cubrio)) !== -1 ? txt_(d.cubrio) : 'No';
  const penaliza = si(d.penaliza);

  return conBloqueo_(() => {

    const mm = segMapaMoviles_();
    const m = mm.porId[txt_(d.idMovil)];
    if (!m) throw new Error('Móvil no encontrada.');
    const asigs = leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES));
    const f = convertirFecha_(fecha);

    let estado = 'No aplica', monto = 0, aplicada = '';
    if (penaliza === 'Sí') {
      monto = Number(d.monto) > 0 ? Math.round(Number(d.monto)) : SEG.PENALIZACIONES[tipo];
      estado = txt_(d.estadoPen) === 'Aplicada' ? 'Aplicada' : 'Pendiente';
      if (estado === 'Aplicada') aplicada = segFecha_(d.fechaAplicada) || segHoyISO_();
    }

    const o = {
      ID: txt_(d.id) || ('A' + Date.now()),
      Fecha: fecha, Tipo: tipo, ID_Movil: String(m.ID_Movil), Movil: txt_(m.Movil),
      Tecnico: tecnicoEnFecha_(asigs, m.ID_Movil, f, m.Tecnico_Actual) || '',
      Zona: txt_(m.Domicilio), Motivo: motivo, Reporto: si(d.reporto),
      Cubrio_Ruta: cubrio, Cubierta_Por: txt_(d.cubiertaPor).slice(0, 60),
      Penaliza: penaliza, Monto: monto, Estado_Pen: estado, Fecha_Aplicada: aplicada,
      Hora_Salida: (txt_(d.horaSalida) ? segHora_(d.horaSalida).slice(0, 5) : ''), Autorizo: txt_(d.autorizo).slice(0, 60),
      Obs: txt_(d.obs).slice(0, 500), Usuario: ses.usuario, Creado: segAhora_(), Actualizado: segAhora_()
    };

    const sh = segHoja_('AUSENCIAS');
    const t = leerTabla_(sh);

    if (txt_(d.id)) {
      for (let i = 1; i < t.values.length; i++) {
        if (txt_(t.values[i][t.idx.ID]) === o.ID) {
          Object.keys(o).forEach(n => {
            if (n === 'Creado') return;
            if (t.idx[n] !== undefined) t.values[i][t.idx[n]] = o[n];
          });
          sh.getRange(i + 1, 1, 1, t.values[0].length).setValues([t.values[i]]);
          return { ok: true, id: o.ID };
        }
      }
      throw new Error('No se encontró la ausencia que intentas editar.');
    }

    /* Evita duplicar la misma móvil el mismo día */
    for (let i = 1; i < t.values.length; i++) {
      if (txt_(t.values[i][t.idx.Fecha]) === fecha && txt_(t.values[i][t.idx.ID_Movil]) === o.ID_Movil &&
          (txt_(t.values[i][t.idx.Tipo]) || 'Ausencia') === tipo)
        throw new Error('La móvil ' + o.Movil + ' ya tiene registrado «' + tipo + '» el ' + fecha + '. Edítalo en la lista.');
    }

    appendPorEncabezados_(sh, o);
    return { ok: true, id: o.ID };
  });
}

/* Marca una penalización como aplicada o de nuevo pendiente */
function marcarPenalizacionWeb(token, id, aplicada) {

  requerirSesion_(token, 'operador');
  id = txt_(id);

  return conBloqueo_(() => {
    const sh = segHoja_('AUSENCIAS');
    const t = leerTabla_(sh);
    for (let i = 1; i < t.values.length; i++) {
      const r = t.values[i];
      if (txt_(r[t.idx.ID]) !== id) continue;
      if (txt_(r[t.idx.Penaliza]) !== 'Sí') throw new Error('Esta ausencia no tiene penalización.');
      r[t.idx.Estado_Pen] = aplicada ? 'Aplicada' : 'Pendiente';
      r[t.idx.Fecha_Aplicada] = aplicada ? segHoyISO_() : '';
      r[t.idx.Actualizado] = segAhora_();
      sh.getRange(i + 1, 1, 1, t.values[0].length).setValues([r]);
      return { ok: true };
    }
    throw new Error('No se encontró la ausencia.');
  });
}

function eliminarAusenciaWeb(token, id) {

  requerirSesion_(token, 'operador');
  id = txt_(id);

  return conBloqueo_(() => {
    const sh = segHoja_('AUSENCIAS');
    const t = leerTabla_(sh);
    for (let i = 1; i < t.values.length; i++) {
      if (txt_(t.values[i][t.idx.ID]) === id) { sh.deleteRow(i + 1); return { ok: true }; }
    }
    throw new Error('No se encontró la ausencia.');
  });
}

/* ---------- Importar el Reporte de Seguimiento de Órdenes (un corte) ----------
   Trae todas las OT de la ruta del día con su estado. La OT es la llave. */

const SEG_ESTADOS_OT = ['PENDIENTE', 'INICIADA', 'FINALIZADA', 'REASIGNADA', 'SUSPENDIDA'];

function segFechaRuta_(f) {
  const nombres = ['fecha_ruta', 'fec_ejecuta', 'fecha_cierre'];
  for (let i = 0; i < nombres.length; i++) {
    const d = segFecha_(f[nombres[i]]);
    if (d && d >= '2000-01-01') return d;
  }
  return '';
}

function importarFinalizadasWeb(token, fecha, corte, filas, archivo) {

  const ses = requerirSesion_(token, 'operador');

  fecha = segFecha_(fecha);
  if (!fecha) throw new Error('Elige la fecha del corte.');
  corte = txt_(corte).slice(0, 20);
  if (!corte) throw new Error('Elige el corte (8am, 12md, 3pm...).');
  if (!Array.isArray(filas) || !filas.length) throw new Error('El archivo no trae filas.');
  if (filas.length > 3000) throw new Error('El archivo trae demasiadas filas (máximo 3000).');
  archivo = txt_(archivo).slice(0, 120);

  return conBloqueo_(() => {

    const mm = segMapaMoviles_();
    const sh = segHoja_('OT');
    const t = leerTabla_(sh);
    const idx = t.idx;
    const values = t.values;
    const ncol = values[0].length;

    const existentes = {};
    let hayNoFinalizadas = false;
    values.forEach((r, i) => {
      if (i === 0) return;
      if (txt_(r[idx.Fecha]) !== fecha) return;
      existentes[txt_(r[idx.N_Orden])] = i;
      const e = txt_(r[idx.Estado]).toUpperCase();
      if (e !== 'FINALIZADA' && e !== 'DESAPARECIDA') hayNoFinalizadas = true;
    });

    const vistos = {};
    const nuevas = [];
    const ignoradas = [];
    const sinMovil = [];
    const aprender = {};
    const transiciones = {};
    const movidas = [];
    let yaEstaban = 0, reaparecidas = 0, repetidas = 0;
    let minMod = Infinity, maxMod = -1;

    /* Primer recorrido: solo para saber si el archivo es parcial (solo finalizadas) */
    const soloFin = filas.every(f0 => {
      const e = txt_(segG_(segFila_(f0), 'estado_ot')).toUpperCase();
      return !e || e === 'FINALIZADA';
    });

    filas.forEach(f0 => {

      const f = segFila_(f0);
      const orden = segOrden_(segG_(f, 'n_orden', 'norden', 'orden', 'ot'));

      if (!orden) { ignoradas.push({ orden: '', motivo: 'Sin número de OT' }); return; }

      const fe = segFechaRuta_(f);
      if (fe !== fecha) {
        ignoradas.push({ orden: orden, motivo: 'Fecha ' + (fe || 'vacía') + ' distinta a ' + fecha });
        return;
      }

      if (vistos[orden]) { repetidas++; return; }
      vistos[orden] = true;

      const est = txt_(segG_(f, 'estado_ot')).toUpperCase() || 'PENDIENTE';

      const cod = txt_(segG_(f, 'movil', 'codigo_movil'));
      const desc = txt_(segG_(f, 'descripcion_movil', 'nombre_movil'));
      const m = segResolver_(mm, cod, desc);

      if (!m) sinMovil.push({ orden: orden, cod: cod, desc: desc });
      else if (cod && !txt_(m.ID_Movil_TLC)) aprender[String(m.ID_Movil)] = { m: m, cod: cod };

      const nuevo = {
        Contrato: txt_(segG_(f, 'contrato')),
        Cod_Movil: cod, ID_Movil: m ? String(m.ID_Movil) : '',
        Movil: m ? txt_(m.Movil) : (segNumMovil_(desc) || desc),
        Tecnico_1: txt_(segG_(f, 'tecnico_1')), Tecnico_2: txt_(segG_(f, 'tecnico_2')),
        Tipo_Orden: txt_(segG_(f, 'tipo_orden')),
        Averia: txt_(segG_(f, 'tipo_averia', 'averia')),
        Servicio: txt_(segG_(f, 'tiposervicios', 'servicios')),
        Hora_Ejecuta: segHora_(segG_(f, 'hora_ejecuta')),
        Hora_Ini: segHora_(segG_(f, 'hora_ini')),
        Hora_Fin: segHora_(segG_(f, 'hora_fin', 'hora_ejecuta')),
        Motivo_Sus: est === 'SUSPENDIDA' ? txt_(segG_(f, 'motivo_sus')) : ''
      };

      if (existentes[orden] !== undefined) {

        const i = existentes[orden];
        const fila = values[i];
        const prev = txt_(fila[idx.Estado]).toUpperCase();

        if (prev === 'DESAPARECIDA') {
          reaparecidas++;
        } else if (prev === est) {
          yaEstaban++;
        } else {
          const k = prev + ' → ' + est;
          transiciones[k] = (transiciones[k] || 0) + 1;
        }

        if (prev !== est) {
          fila[idx.Estado_Previo] = prev;
          fila[idx.Estado] = est;
          if (est === 'FINALIZADA') fila[idx.Corte_Finalizada] = corte;
        }

        if (nuevo.ID_Movil && txt_(fila[idx.ID_Movil]) !== nuevo.ID_Movil) {
          movidas.push({ orden: orden, de: txt_(fila[idx.Movil]), a: nuevo.Movil });
          if (!txt_(fila[idx.Movil_Origen])) fila[idx.Movil_Origen] = txt_(fila[idx.Movil]);
          fila[idx.ID_Movil] = nuevo.ID_Movil;
          fila[idx.Movil] = nuevo.Movil;
          fila[idx.Cod_Movil] = nuevo.Cod_Movil;
        }

        ['Contrato', 'Tecnico_1', 'Tecnico_2', 'Tipo_Orden', 'Averia', 'Servicio',
          'Hora_Ejecuta', 'Hora_Ini', 'Hora_Fin', 'Motivo_Sus'].forEach(n => {
          if (nuevo[n] && nuevo[n] !== txt_(fila[idx[n]])) fila[idx[n]] = nuevo[n];
        });

        fila[idx.Ultimo_Corte] = corte;
        if (archivo) fila[idx.Archivo] = archivo;
        minMod = Math.min(minMod, i); maxMod = Math.max(maxMod, i);
        return;
      }

      const o = Object.assign({
        Fecha: fecha, N_Orden: orden, Corte: corte, Estado: est, Ultimo_Corte: corte,
        Archivo: archivo, Movil_Origen: nuevo.Movil,
        Corte_Finalizada: est === 'FINALIZADA' ? corte : ''
      }, nuevo);
      const fila = new Array(ncol).fill('');
      Object.keys(o).forEach(n => { if (idx[n] !== undefined) fila[idx[n]] = o[n]; });
      nuevas.push(fila);
    });

    /* OT que estaban en cortes anteriores y ya no aparecen */
    const desaparecidas = [];
    Object.keys(existentes).forEach(orden => {
      if (vistos[orden]) return;
      const i = existentes[orden];
      const fila = values[i];
      const prev = txt_(fila[idx.Estado]).toUpperCase();
      if (prev === 'DESAPARECIDA') return;
      if (soloFin && hayNoFinalizadas && prev !== 'FINALIZADA') return;
      fila[idx.Estado_Previo] = prev;
      fila[idx.Estado] = 'DESAPARECIDA';
      desaparecidas.push({ orden: orden, movil: txt_(fila[idx.Movil]), contrato: txt_(fila[idx.Contrato]), estado: prev });
      minMod = Math.min(minMod, i); maxMod = Math.max(maxMod, i);
    });

    if (maxMod >= 0) {
      sh.getRange(minMod + 1, 1, maxMod - minMod + 1, ncol).setValues(values.slice(minMod, maxMod + 1));
    }

    if (nuevas.length) {
      const ini = sh.getLastRow() + 1;
      if (ini + nuevas.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), nuevas.length);
      sh.getRange(ini, 1, nuevas.length, ncol).setValues(nuevas);
    }

    /* Aprende el ID de la plataforma de las móviles que no lo tenían */
    const aprendidos = [];
    const ids = Object.keys(aprender);
    if (ids.length) {
      const shM = obtenerHoja_(CONFIG.HOJAS.MOVILES);
      const tm = leerTabla_(shM);
      if (tm.idx.ID_Movil_TLC !== undefined && tm.idx.ID_Movil !== undefined) {
        tm.values.forEach((r, i) => {
          if (i === 0) return;
          const a = aprender[String(r[tm.idx.ID_Movil])];
          if (a && !txt_(r[tm.idx.ID_Movil_TLC])) {
            shM.getRange(i + 1, tm.idx.ID_Movil_TLC + 1).setNumberFormat('@').setValue(a.cod);
            aprendidos.push({ movil: txt_(r[tm.idx.Movil]), cod: a.cod });
          }
        });
      }
    }

    const total = Object.keys(vistos).length;

    appendPorEncabezados_(segHoja_('CORTES'), {
      Fecha_Hora: segAhora_(), Fecha: fecha, Corte: corte, Archivo: archivo,
      Filas: filas.length, Nuevas: nuevas.length, Ya_Estaban: yaEstaban,
      Reaparecidas: reaparecidas, Desaparecidas: desaparecidas.length,
      Ignoradas: ignoradas.length, Usuario: ses.usuario
    });

    return {
      ok: true, fecha: fecha, corte: corte,
      filas: filas.length, totalDia: total,
      nuevas: nuevas.length, yaEstaban: yaEstaban, reaparecidas: reaparecidas,
      repetidas: repetidas, transiciones: transiciones,
      movidas: movidas, desaparecidas: desaparecidas,
      ignoradas: ignoradas.slice(0, 50), totalIgnoradas: ignoradas.length,
      sinMovil: sinMovil.slice(0, 50), aprendidos: aprendidos
    };
  });
}

/* ---------- Suspendidas ---------- */

function guardarSuspendidaWeb(token, d) {

  const ses = requerirSesion_(token, 'operador');
  d = d || {};

  const fecha = segFecha_(d.fecha);
  if (!fecha) throw new Error('Fecha no válida.');
  const contrato = txt_(d.contrato).slice(0, 30);
  const orden = segOrden_(d.orden).slice(0, 30);
  if (!contrato && !orden) throw new Error('Indica el contrato o el número de OT.');
  const motivo = txt_(d.motivo).slice(0, 120);
  if (!motivo) throw new Error('Elige el motivo de la suspensión.');

  return conBloqueo_(() => {

    const mm = segMapaMoviles_();
    const m = mm.porId[txt_(d.idMovil)];
    const f = convertirFecha_(fecha);
    const asigs = m ? leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES)) : [];

    const o = {
      ID: txt_(d.id) || ('S' + Date.now()),
      Fecha: fecha, Contrato: contrato, N_Orden: orden,
      ID_Movil: m ? String(m.ID_Movil) : '',
      Movil: m ? txt_(m.Movil) : '',
      Tecnico: m ? (tecnicoEnFecha_(asigs, m.ID_Movil, f, m.Tecnico_Actual) || '') : '',
      Tipo_OT: txt_(d.tipo).slice(0, 60),
      Zona: m ? txt_(m.Domicilio) : txt_(d.zona).slice(0, 60),
      Motivo: motivo,
      Observacion: txt_(d.obs).slice(0, 500),
      Usuario: ses.usuario, Creado: segAhora_()
    };

    const sh = segHoja_('SUSP');
    const t = leerTabla_(sh);

    if (txt_(d.id)) {
      for (let i = 1; i < t.values.length; i++) {
        if (txt_(t.values[i][t.idx.ID]) === o.ID) {
          Object.keys(o).forEach(n => {
            if (n === 'Creado' || n === 'Usuario') return;
            if (t.idx[n] !== undefined) t.values[i][t.idx[n]] = o[n];
          });
          sh.getRange(i + 1, 1, 1, t.values[0].length).setValues([t.values[i]]);
          return { ok: true, id: o.ID };
        }
      }
      throw new Error('No se encontró la suspendida que intentas editar.');
    }

    appendPorEncabezados_(sh, o);
    return { ok: true, id: o.ID };
  });
}

/* El back office marca como suspendidas las OT que ya no aparecen en la plataforma */
function marcarSuspendidasWeb(token, fecha, ordenes, motivo, obs) {

  const ses = requerirSesion_(token, 'operador');

  fecha = segFecha_(fecha);
  if (!fecha) throw new Error('Fecha no válida.');
  motivo = txt_(motivo).slice(0, 120);
  if (!motivo) throw new Error('Elige el motivo de la suspensión.');
  if (!Array.isArray(ordenes) || !ordenes.length) throw new Error('Selecciona al menos una OT.');
  if (ordenes.length > 200) throw new Error('Demasiadas OT en una sola vez.');
  obs = txt_(obs).slice(0, 500);

  return conBloqueo_(() => {

    const mm = segMapaMoviles_();
    const f = convertirFecha_(fecha);
    const asigs = leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES));

    const otPorOrden = {};
    segLeer_('OT', fecha, fecha).forEach(o => {
      if (txt_(o.Fecha) === fecha) otPorOrden[txt_(o.N_Orden)] = o;
    });

    const sh = segHoja_('SUSP');
    const t = leerTabla_(sh);
    const ncol = t.values[0].length;
    const ya = {};
    t.values.forEach((r, i) => {
      if (i > 0 && txt_(r[t.idx.Fecha]) === fecha) ya[txt_(r[t.idx.N_Orden])] = 1;
    });

    const filas = [];
    let omitidas = 0;
    const ahora = segAhora_();

    ordenes.forEach((x, k) => {
      const orden = segOrden_(x);
      const ot = otPorOrden[orden];
      if (!ot || txt_(ot.Estado).toUpperCase() !== 'DESAPARECIDA' || ya[orden]) { omitidas++; return; }
      ya[orden] = 1;

      const m = mm.porId[txt_(ot.ID_Movil)];
      const o = {
        ID: 'S' + Date.now() + '_' + k, Fecha: fecha, Contrato: txt_(ot.Contrato), N_Orden: orden,
        ID_Movil: m ? String(m.ID_Movil) : '', Movil: m ? txt_(m.Movil) : txt_(ot.Movil),
        Tecnico: m ? (tecnicoEnFecha_(asigs, m.ID_Movil, f, m.Tecnico_Actual) || '') : txt_(ot.Tecnico_1),
        Tipo_OT: txt_(ot.Tipo_Orden), Zona: m ? txt_(m.Domicilio) : '',
        Motivo: motivo, Observacion: obs, Usuario: ses.usuario, Creado: ahora
      };
      const fila = new Array(ncol).fill('');
      Object.keys(o).forEach(n => { if (t.idx[n] !== undefined) fila[t.idx[n]] = o[n]; });
      filas.push(fila);
    });

    if (filas.length) {
      const ini = sh.getLastRow() + 1;
      if (ini + filas.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), filas.length);
      sh.getRange(ini, 1, filas.length, ncol).setValues(filas);
    }

    return { ok: true, marcadas: filas.length, omitidas: omitidas };
  });
}

function eliminarSuspendidaWeb(token, id) {

  requerirSesion_(token, 'operador');
  id = txt_(id);
  if (!id) throw new Error('Falta el ID.');

  return conBloqueo_(() => {
    const sh = segHoja_('SUSP');
    const t = leerTabla_(sh);
    for (let i = 1; i < t.values.length; i++) {
      if (txt_(t.values[i][t.idx.ID]) === id) {
        sh.deleteRow(i + 1);
        return { ok: true };
      }
    }
    throw new Error('No se encontró la suspendida.');
  });
}


/* =========================================================
   BODEGA / INVENTARIO
   Bodega general -> móviles. Gasto de bodega = lo que sale a móviles
   o se devuelve al proveedor. Gasto de móvil = órdenes (reporte de materiales).
   ========================================================= */

const INV = {

  HOJAS: {
    MAT: 'INV_MATERIALES', MOV: 'INV_MOVIMIENTOS', CON: 'INV_CONSUMO',
    OBJ: 'INV_OBJETIVO', CARGAS: 'INV_CARGAS', ALE: 'INV_ALERTAS_OK',
    DEVL: 'INV_DEV_LINEAS', DEVH: 'INV_DEV_HISTORIAL', DEVE: 'INV_DEV_ENTREGAS', CORTES: 'INV_CORTES', CONTEO: 'INV_CONTEO', FIR: 'INV_FIRMAS', ALI: 'INV_ALISTOS'
  },

  HEADERS: {
    MAT: ['Clave', 'Material', 'Unidad', 'Minimo_Bodega', 'Activo', 'Alias', 'Orden', 'Codigo', 'Objetivo_Base', 'Categoria', 'Costo_Unitario', 'Stock_Completo'],
    MOV: ['Grupo', 'Fecha', 'Tipo', 'Clave', 'Material', 'Cantidad', 'ID_Movil', 'Movil',
      'Referencia', 'Obs', 'Usuario', 'Creado', 'Concepto', 'Consecutivo', 'Linea', 'Editado'],
    CON: ['Fecha', 'N_Orden', 'ID_Movil', 'Movil', 'Clave', 'Material', 'Cantidad', 'Archivo', 'Carga', 'Contrato'],
    OBJ: ['ID_Movil', 'Clave', 'Objetivo'],
    CARGAS: ['Fecha_Hora', 'Archivo', 'Filas', 'OT', 'Fechas', 'Sin_Movil', 'Usuario'],
    ALE: ['Clave', 'Usuario', 'Fecha_Hora', 'Disponible'],
    DEVL: ['Linea', 'Periodo', 'Archivo', 'Fecha_Cierre', 'N_Orden', 'Contrato', 'ID_Movil', 'Movil', 'Contrata', 'Averia', 'Tipo', 'Servicio',
      'Equipo', 'Equipo_Original', 'Debe', 'Devuelto', 'Justificado', 'Motivo_Justif', 'Justif_Por', 'Justif_Fecha', 'Boletas', 'Fecha_Devolucion', 'Cambio_Motivo', 'Cargado', 'Usuario', 'Recibido_Por'],
    DEVH: ['Fecha_Hora', 'Usuario', 'Linea', 'Accion', 'Detalle'],
    DEVE: ['Entrega', 'Fecha', 'ID_Movil', 'Movil', 'Boleta', 'Equipo', 'Cantidad', 'Linea', 'Usuario', 'Creado'],
    CORTES: ['Corte', 'Fecha', 'Estado', 'Obs', 'Usuario', 'Creado', 'Cerrado_Por', 'Cerrado', 'Tipo', 'Ubicacion'],
    CONTEO: ['Corte', 'Ubicacion', 'Clave', 'Teorico', 'Fisico', 'Justificada', 'Motivo', 'Justif_Por', 'Justif_Fecha'],
    FIR: ['Grupo', 'Consecutivo', 'Nombre', 'Fecha_Hora', 'Usuario', 'Firma'],
    ALI: ['Alisto', 'Estado', 'Fecha', 'ID_Movil', 'Movil', 'Clave', 'Material', 'Cantidad', 'Linea', 'Obs', 'Usuario', 'Creado', 'Alistado', 'Aplicado', 'Grupo_Mov', 'Consecutivo_Mov']
  },

  TEXTO: {
    MAT: ['Clave', 'Alias', 'Codigo'],
    MOV: ['Grupo', 'Fecha', 'Clave', 'ID_Movil', 'Movil', 'Referencia', 'Consecutivo'],
    CON: ['Fecha', 'N_Orden', 'ID_Movil', 'Movil', 'Clave', 'Archivo', 'Carga', 'Contrato'],
    OBJ: ['ID_Movil', 'Clave'],
    CARGAS: ['Fecha_Hora', 'Fechas'],
    ALE: ['Clave', 'Fecha_Hora'],
    DEVL: ['Linea', 'Periodo', 'Archivo', 'Fecha_Cierre', 'N_Orden', 'Contrato', 'ID_Movil', 'Movil', 'Boletas', 'Fecha_Devolucion', 'Justif_Fecha', 'Cargado'],
    DEVH: ['Fecha_Hora', 'Linea'],
    DEVE: ['Entrega', 'Fecha', 'ID_Movil', 'Movil', 'Boleta', 'Linea', 'Creado'],
    CORTES: ['Corte', 'Fecha', 'Cerrado'],
    CONTEO: ['Corte', 'Ubicacion', 'Clave'],
    FIR: ['Grupo', 'Consecutivo', 'Nombre', 'Fecha_Hora'],
    ALI: ['Alisto', 'Fecha', 'ID_Movil', 'Movil', 'Clave', 'Grupo_Mov', 'Consecutivo_Mov']
  },

  TIPOS: {
    INGRESO: 'Ingreso a bodega',
    ENTREGA: 'Entrega a móvil',
    DEV_PROV: 'Devolución a proveedor',
    DEV_MOVIL: 'Devolución de móvil a bodega',
    AJ_BODEGA: 'Ajuste de bodega',
    AJ_MOVIL: 'Ajuste de móvil',
    TRASLADO: 'Traslado entre móviles'
  },

  /* [material, unidad, alias] — salen del Reporte de Materiales por Móvil */
  SEMILLA: [
    ['CABLE RG 6 SIN MENSAJERO BLANCO', 'm', ''], ['CAJA T_PLAY', 'u', ''], ['CALCOMANIAS', 'u', ''],
    ['COLILLA', 'u', ''],
    ['CONECTOR MECÁNICO', 'u', 'CONECTOR MEC NICO'], ['CONTROL STB', 'u', ''], ['EQUIPO T PLAY', 'u', ''],
    ['F.O PLANA', 'm', ''], ['FAJILLAS DE 8', 'u', ''], ['GRAPAS Q', 'u', ''], ['ONU 3 PLAY', 'u', ''],
    ['ONU SOLO @ WIFI', 'u', ''], ['PLACAS F.O', 'u', ''], ['REMATES', 'u', ''], ['ROUTER EERO', 'u', ''],
    ['ROUTER WIFI NET+', 'u', ''], ['TOALLAS LIMPIADORAS SIN PELO', 'u', '']
  ],

  /* Columnas del reporte de materiales que NO son materiales */
  /* Las carruchas son lecturas del carrete (inicio - fin = metros de F.O), no materiales que se descuenten */
  COLS_INFO: ['carrucha_punta_fin', 'carrucha_punta_inicio', 'codigo_movil', 'contrato', 'averia', 'n_orden', 'fecha_cierre', 'close_by', 'n_tap',
    'colilla_tv', 'colilla_internet', 'servicios', 'nombre_movil']
};

const INV_FORMATEADAS = {};

function invHoja_(clave) {
  const ss = obtenerSpreadsheet_();

  /* Una hoja ya verificada (encabezados, formato) no se vuelve a revisar en cada llamada: es lo que más tardaba */
  const llave = 'invok_' + clave + '_' + INV.HEADERS[clave].join('').length;
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  if (cache && cache.get(llave)) {
    const rapida = ss.getSheetByName(INV.HOJAS[clave]);
    if (rapida) return rapida;
  }

  const nueva = !ss.getSheetByName(INV.HOJAS[clave]);
  const sh = asegurarHoja_(ss, INV.HOJAS[clave], INV.HEADERS[clave]);
  if (!INV_FORMATEADAS[clave]) {
    INV_FORMATEADAS[clave] = true;
    formatearColumnasTexto_(sh, INV.TEXTO[clave]);
  }
  if (nueva) {
    sh.getRange(1, 1, 1, INV.HEADERS[clave].length)
      .setFontWeight('bold').setBackground('#1b5e20').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  if (cache) { try { cache.put(llave, '1', 21600); } catch (e) { /* sin caché: solo es más lento */ } }
  return sh;
}

function invClave_(s) {
  return String(s == null ? '' : s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function invFecha_(v) {
  return v instanceof Date ? (isNaN(v) ? '' : formatearFechaISO_(v)) : txt_(v).slice(0, 10);
}

function invNum_(v) {
  const n = Number(String(v == null ? '' : v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function invRedondear_(n) { return Math.round(n * 1000) / 1000; }

/* Categoría de un material: Consumo, De corte (se miden por metros) o Equipos */
function invCategoriaDe_(codigo, material, unidad) {
  const cods = txt_(codigo).split(';').map(a => txt_(a)).filter(a => a);
  if (cods.some(c => /^(4-4-|8-|9-)/.test(c))) return 'Equipos';
  if (cods.some(c => /^(1-2-|2-1-)/.test(c))) return 'De corte';
  if (cods.length) return 'Consumo';
  const n = txt_(material).toUpperCase();
  if (/\b(ONT|ONU|ROUTER|EERO|STB|DONGLE|RECEIVER)\b|EQUIPO|CAJA T/.test(n)) return 'Equipos';
  if (/^(FIBRA|F\.O PLANA|CABLE)/.test(n) || txt_(unidad) === 'm') return 'De corte';
  return 'Consumo';
}

/* Catálogo de materiales (se siembra la primera vez con los del reporte de materiales) */
function invMateriales_() {

  const sh = invHoja_('MAT');

  if (sh.getLastRow() < 2) {
    const filas = INV.SEMILLA.map((x, i) => [invClave_(x[0]), x[0], x[1], 0, 'Sí', x[2], i + 1]);
    sh.getRange(2, 1, filas.length, INV.HEADERS.MAT.length).setValues(filas);
  }

  /* Las carruchas eran lecturas, no materiales: si quedaron del catálogo anterior, se desactivan */
  const tm = leerTabla_(sh);
  if (tm.idx.Activo !== undefined) {
    for (let i = 1; i < tm.values.length; i++) {
      if (/^CARRUCHA_PUNTA/.test(txt_(tm.values[i][tm.idx.Clave])) && txt_(tm.values[i][tm.idx.Activo]) !== 'No') {
        sh.getRange(i + 1, tm.idx.Activo + 1).setValue('No');
      }
    }
  }

  return leerObjetos_(sh).map(o => ({
    clave: txt_(o.Clave), material: txt_(o.Material), unidad: txt_(o.Unidad) || 'u',
    minimo: invNum_(o.Minimo_Bodega), activo: txt_(o.Activo) !== 'No',
    alias: txt_(o.Alias), orden: Number(o.Orden) || 999, codigo: txt_(o.Codigo), base: invNum_(o.Objetivo_Base),
    costo: invNum_(o.Costo_Unitario), completo: invNum_(o.Stock_Completo),
    categoria: txt_(o.Categoria) || invCategoriaDe_(o.Codigo, o.Material, o.Unidad)
  })).filter(m => m.clave)
    .sort((a, b) => a.orden - b.orden || a.material.localeCompare(b.material));
}

/* Reescribe todas las filas de una hoja (debajo del encabezado) */
/* El consumo (INV_CONSUMO) es la hoja que más crece. Sus totales por móvil y material se guardan en caché
   y solo se recalculan cuando algo escribe en esa hoja (cada escritura sube esta versión). */
function invBumpCon_() {
  try { PropertiesService.getScriptProperties().setProperty('INV_CON_VER', String(Date.now())); } catch (e) { /* se recalcula por el TTL */ }
}

function invConsumoTot_() {
  const sh = invHoja_('CON');
  const ult = sh.getLastRow();
  if (ult < 2) return { tot: {} };

  let ver = '0';
  try { ver = PropertiesService.getScriptProperties().getProperty('INV_CON_VER') || '0'; } catch (e) { /* sin versión */ }
  const llave = 'invcon_' + ver + '_' + ult;
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  if (cache) {
    const g = cache.get(llave);
    if (g) { try { return { tot: JSON.parse(g) }; } catch (e) { /* se recalcula */ } }
  }

  /* Solo las columnas que hacen falta, sin armar un objeto por fila */
  const enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const iM = enc.indexOf('ID_Movil'), iC = enc.indexOf('Clave'), iQ = enc.indexOf('Cantidad');
  const c0 = Math.min(iM, iC, iQ), c1 = Math.max(iM, iC, iQ);
  const v = sh.getRange(2, c0 + 1, ult - 1, c1 - c0 + 1).getValues();
  const tot = {};
  v.forEach(r => {
    const m = txt_(r[iM - c0]), c = txt_(r[iC - c0]);
    if (!m || !c) return;
    const q = invNum_(r[iQ - c0]);
    (tot[m] = tot[m] || {})[c] = (tot[m][c] || 0) + q;
  });
  if (cache) { try { cache.put(llave, JSON.stringify(tot), 1800); } catch (e) { /* caché llena: solo es más lento */ } }
  return { tot: tot };
}

function invReescribir_(sh, clave, filasObj) {
  if (clave === 'CON') invBumpCon_();
  const h = INV.HEADERS[clave];
  const ult = sh.getLastRow();
  if (ult > 1) sh.getRange(2, 1, ult - 1, sh.getLastColumn()).clearContent();
  if (!filasObj.length) return;
  sh.getRange(2, 1, filasObj.length, h.length).setValues(filasObj.map(o => h.map(n => (n in o ? o[n] : ''))));
}

function invAgregar_(sh, clave, filasObj) {
  if (!filasObj.length) return;
  if (clave === 'CON') invBumpCon_();
  const h = INV.HEADERS[clave];
  const fila = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(fila, 1, filasObj.length, h.length).setValues(filasObj.map(o => h.map(n => (n in o ? o[n] : ''))));
}

/* Saldos de bodega y de cada móvil a partir de los movimientos y el consumo */
function invSaldos_(movs, cons, hasta) {

  const bodega = {}, movil = {};
  const B = c => (bodega[c] = bodega[c] || { ingresos: 0, entregas: 0, devProv: 0, devMovil: 0, ajuste: 0, disponible: 0 });
  const M = (m, c) => {
    movil[m] = movil[m] || {};
    return (movil[m][c] = movil[m][c] || { entregado: 0, devuelto: 0, ajuste: 0, consumido: 0, trasEntra: 0, trasSale: 0, actual: 0 });
  };

  movs.forEach(r => {
    const c = txt_(r.Clave), q = invNum_(r.Cantidad), m = txt_(r.ID_Movil), t = txt_(r.Tipo);
    if (!c) return;
    if (hasta && invFecha_(r.Fecha) > hasta) return;
    if (t === 'INGRESO') B(c).ingresos += q;
    else if (t === 'ENTREGA') { B(c).entregas += q; M(m, c).entregado += q; }
    else if (t === 'DEV_PROV') B(c).devProv += q;
    else if (t === 'DEV_MOVIL') { B(c).devMovil += q; M(m, c).devuelto += q; }
    else if (t === 'AJ_BODEGA') B(c).ajuste += q;
    else if (t === 'AJ_MOVIL') M(m, c).ajuste += q;
    else if (t === 'TRAS_SALE') M(m, c).trasSale += q;
    else if (t === 'TRAS_ENTRA') M(m, c).trasEntra += q;
  });

  if (cons && cons.tot) {
    /* Totales ya calculados (sin límite de fecha) */
    Object.keys(cons.tot).forEach(m => Object.keys(cons.tot[m]).forEach(c => { M(m, c).consumido += cons.tot[m][c]; }));
  } else {
    (cons || []).forEach(r => {
      const c = txt_(r.Clave), m = txt_(r.ID_Movil);
      if (!c || !m) return;
      if (hasta && invFecha_(r.Fecha) > hasta) return;
      M(m, c).consumido += invNum_(r.Cantidad);
    });
  }

  Object.keys(bodega).forEach(c => {
    const b = bodega[c];
    b.disponible = invRedondear_(b.ingresos + b.devMovil + b.ajuste - b.entregas - b.devProv);
    Object.keys(b).forEach(k => { b[k] = invRedondear_(b[k]); });
  });
  Object.keys(movil).forEach(m => Object.keys(movil[m]).forEach(c => {
    const x = movil[m][c];
    x.actual = invRedondear_(x.entregado + x.ajuste + x.trasEntra - x.trasSale - x.devuelto - x.consumido);
    ['entregado', 'devuelto', 'ajuste', 'consumido', 'trasEntra', 'trasSale'].forEach(k => { x[k] = invRedondear_(x[k]); });
  }));

  return { bodega: bodega, movil: movil };
}

function obtenerBodegaWeb(token) {

  requerirSesion_(token, 'consulta');

  const mats = invMateriales_();
  const movs = leerObjetos_(invHoja_('MOV'));
  const cons = invConsumoTot_();
  const objs = leerObjetos_(invHoja_('OBJ'));
  const s = invSaldos_(movs, cons);

  const objetivos = {};
  objs.forEach(o => {
    const m = txt_(o.ID_Movil), c = txt_(o.Clave);
    if (!m || !c) return;
    (objetivos[m] = objetivos[m] || {})[c] = invNum_(o.Objetivo);
  });

  const mm = segMapaMoviles_();
  const moviles = mm.moviles
    .filter(m => esActiva_(m) || s.movil[String(m.ID_Movil)] || objetivos[String(m.ID_Movil)])
    .map(m => ({
      idMovil: String(m.ID_Movil), movil: txt_(m.Movil), tecnico: txt_(m.Tecnico_Actual),
      zona: txt_(m.Domicilio), activa: esActiva_(m)
    }))
    .sort((a, b) => (Number(a.movil) || 0) - (Number(b.movil) || 0) || a.movil.localeCompare(b.movil));

  const alertasOk = {};
  leerObjetos_(invHoja_('ALE')).forEach(r => { alertasOk[txt_(r.Clave)] = { usuario: txt_(r.Usuario), fecha: txt_(r.Fecha_Hora), disponible: invNum_(r.Disponible) }; });

  const cargas = leerObjetos_(invHoja_('CARGAS')).slice(-8).reverse().map(c => ({
    hora: txt_(c.Fecha_Hora), archivo: txt_(c.Archivo), filas: Number(c.Filas) || 0,
    ot: Number(c.OT) || 0, fechas: txt_(c.Fechas), sinMovil: Number(c.Sin_Movil) || 0, usuario: txt_(c.Usuario)
  }));

  return {
    materiales: mats, moviles: moviles, bodega: s.bodega, stockMovil: s.movil,
    objetivos: objetivos, tipos: INV.TIPOS, cargas: cargas,
    alertasOk: alertasOk
  };
}

/* Consecutivo único de bodega (B-000001...): nunca se reutiliza, aunque se elimine un documento */
function invFormatoConsec_(n) { return 'B-' + ('000000' + n).slice(-6); }

function invNumConsec_(v) { const m = txt_(v).match(/^B-(\d+)$/); return m ? Number(m[1]) : 0; }

/* Dentro de un bloqueo: reparte consecutivo a los documentos que aún no lo tienen */
function invRepartirConsec_() {
  const sh = invHoja_('MOV');
  const t = leerTabla_(sh);
  if (t.idx.Consecutivo === undefined || t.values.length < 2) return;
  const props = PropertiesService.getScriptProperties();
  let n = Number(props.getProperty('INV_CONSEC') || 0);
  const porGrupo = {};
  let cambios = false;
  t.values.slice(1).forEach(r => { n = Math.max(n, invNumConsec_(r[t.idx.Consecutivo])); });
  for (let i = 1; i < t.values.length; i++) {
    const r = t.values[i];
    const g = txt_(r[t.idx.Grupo]);
    if (txt_(r[t.idx.Consecutivo])) { porGrupo[g] = txt_(r[t.idx.Consecutivo]); continue; }
    if (!porGrupo[g]) porGrupo[g] = invFormatoConsec_(++n);
    r[t.idx.Consecutivo] = porGrupo[g];
    cambios = true;
  }
  if (cambios) {
    sh.getRange(2, t.idx.Consecutivo + 1, t.values.length - 1, 1).setValues(t.values.slice(1).map(r => [r[t.idx.Consecutivo]]));
    props.setProperty('INV_CONSEC', String(n));
  }
}

function invSiguienteConsec_() {
  const props = PropertiesService.getScriptProperties();
  let n = Number(props.getProperty('INV_CONSEC') || 0);
  const t = leerTabla_(invHoja_('MOV'));
  if (t.idx.Consecutivo !== undefined) t.values.slice(1).forEach(r => { n = Math.max(n, invNumConsec_(r[t.idx.Consecutivo])); });
  n++;
  props.setProperty('INV_CONSEC', String(n));
  return invFormatoConsec_(n);
}

/* ---------- Alistos: borradores de entrega que se preparan en físico y se aplican cuando llega la móvil ---------- */

function invSiguienteAlisto_(filas) {
  const props = PropertiesService.getScriptProperties();
  let n = Number(props.getProperty('ALI_CONSEC') || 0);
  filas.forEach(r => { const m = /(\d+)$/.exec(txt_(r.Alisto)); if (m) n = Math.max(n, Number(m[1])); });
  n++;
  props.setProperty('ALI_CONSEC', String(n));
  return 'A-' + ('000000' + n).slice(-6);
}

function invAlistoReescribir_(sh, filasObj, idsQuitar) {
  const t = leerTabla_(sh);
  const quedan = t.values.slice(1).filter(r => idsQuitar.indexOf(txt_(r[t.idx.Alisto])) === -1);
  if (t.values.length > 1) sh.getRange(2, 1, t.values.length - 1, t.values[0].length).clearContent();
  if (quedan.length) sh.getRange(2, 1, quedan.length, t.values[0].length).setValues(quedan);
  invAgregar_(sh, 'ALI', filasObj);
}

/* Crea o edita alistos. lista: [{alisto?, fecha, idMovil, obs, lineas:[{clave, cantidad}]}] */
function guardarAlistosWeb(token, lista) {

  const ses = requerirSesion_(token, 'operador');
  lista = lista || [];
  if (!lista.length) throw new Error('No hay alistos para guardar.');

  return conBloqueo_(() => {
    const sh = invHoja_('ALI');
    const existentes = leerObjetos_(sh);
    const porClave = {};
    invMateriales_().forEach(m => { porClave[m.clave] = m; });
    const mm = segMapaMoviles_();
    const ahora = segAhora_();
    const nuevas = [], quitar = [], ids = [];

    lista.forEach(it => {
      const idMovil = txt_(it.idMovil);
      const mv = mm.porId[idMovil];
      if (!mv) throw new Error('Elige la móvil del alisto.');
      const fecha = segFecha_(it.fecha) || ahora.slice(0, 10);
      const sumas = {}, orden = [];
      (it.lineas || []).forEach(l => {
        const c = txt_(l.clave), q = invNum_(l.cantidad);
        if (!c || !(q > 0)) return;
        if (!porClave[c]) throw new Error('Material no válido: ' + c);
        if (sumas[c] === undefined) { sumas[c] = 0; orden.push(c); }
        sumas[c] += q;
      });
      if (!orden.length) throw new Error('El alisto de la M' + txt_(mv.Movil) + ' no tiene materiales con cantidad.');

      let id = txt_(it.alisto), creado = ahora, usuario = ses.usuario;
      if (id) {
        const previas = existentes.filter(r => txt_(r.Alisto) === id);
        if (!previas.length) throw new Error('No se encontró el alisto ' + id + '.');
        if (['APLICADO', 'APLICANDO'].indexOf(txt_(previas[0].Estado)) >= 0) throw new Error('El alisto ' + id + ' ya fue aplicado y no se puede editar.');
        creado = txt_(previas[0].Creado); usuario = txt_(previas[0].Usuario);
        quitar.push(id);
      } else {
        id = invSiguienteAlisto_(existentes.concat(nuevas.map(f => ({ Alisto: f.Alisto }))));
      }
      ids.push(id);
      orden.forEach((c, i) => {
        nuevas.push({ Alisto: id, Estado: 'BORRADOR', Fecha: fecha, ID_Movil: idMovil, Movil: txt_(mv.Movil), Clave: c, Material: porClave[c].material,
          Cantidad: sumas[c], Linea: i + 1, Obs: txt_(it.obs), Usuario: usuario, Creado: creado, Alistado: '', Aplicado: '', Grupo_Mov: '', Consecutivo_Mov: '' });
      });
    });

    invAlistoReescribir_(sh, nuevas, quitar);
    return { ok: true, alistos: ids };
  });
}

function obtenerAlistosWeb(token) {

  requerirSesion_(token, 'consulta');
  const filas = leerObjetos_(invHoja_('ALI'));
  const g = {}, orden = [];
  filas.forEach(r => {
    const id = txt_(r.Alisto);
    if (!id) return;
    if (!g[id]) {
      g[id] = { alisto: id, estado: txt_(r.Estado), fecha: invFecha_(r.Fecha), idMovil: txt_(r.ID_Movil), movil: txt_(r.Movil), obs: txt_(r.Obs), usuario: txt_(r.Usuario),
        creado: txt_(r.Creado), alistado: txt_(r.Alistado), aplicado: txt_(r.Aplicado), grupoMov: txt_(r.Grupo_Mov), consecutivoMov: txt_(r.Consecutivo_Mov), lineas: [] };
      orden.push(id);
    }
    g[id].lineas.push({ clave: txt_(r.Clave), material: txt_(r.Material), cantidad: invNum_(r.Cantidad), linea: Number(r.Linea) || 0 });
  });
  return { alistos: orden.map(i => g[i]).sort((a, b) => b.creado.localeCompare(a.creado)), tipos: INV.TIPOS, materiales: invMateriales_() };
}

/* accion: ALISTAR (ya está preparado en físico) | REABRIR (vuelve a borrador) | ANULAR (se elimina) */
function cambiarEstadoAlistoWeb(token, alisto, accion) {

  const ses = requerirSesion_(token, 'operador');
  alisto = txt_(alisto);
  accion = txt_(accion);

  return conBloqueo_(() => {
    const sh = invHoja_('ALI');
    const t = leerTabla_(sh);
    const filas = [];
    t.values.forEach((r, i) => { if (i > 0 && txt_(r[t.idx.Alisto]) === alisto) filas.push(i); });
    if (!filas.length) throw new Error('No se encontró el alisto.');
    const est = txt_(t.values[filas[0]][t.idx.Estado]);
    if (['APLICADO', 'APLICANDO'].indexOf(est) >= 0) throw new Error('Este alisto ya fue aplicado.');

    if (accion === 'ANULAR') {
      for (let k = filas.length - 1; k >= 0; k--) sh.deleteRow(filas[k] + 1);
      return { ok: true };
    }
    const nuevo = accion === 'ALISTAR' ? 'ALISTADO' : accion === 'REABRIR' ? 'BORRADOR' : '';
    if (!nuevo) throw new Error('Acción no válida.');
    const marca = accion === 'ALISTAR' ? ses.usuario + ' · ' + segAhora_() : '';
    filas.forEach(i => {
      sh.getRange(i + 1, t.idx.Estado + 1).setValue(nuevo);
      sh.getRange(i + 1, t.idx.Alistado + 1).setValue(marca);
    });
    return { ok: true, estado: nuevo };
  });
}

/* Llegó la móvil por el material: se registra la ENTREGA real (con las cantidades finales) y el alisto queda aplicado */
function aplicarAlistoWeb(token, alisto, fecha, lineasFinales) {

  const ses = requerirSesion_(token, 'operador');
  alisto = txt_(alisto);

  const previo = conBloqueo_(() => {
    const sh = invHoja_('ALI');
    const t = leerTabla_(sh);
    const filas = [];
    t.values.forEach((r, i) => { if (i > 0 && txt_(r[t.idx.Alisto]) === alisto) filas.push(i); });
    if (!filas.length) throw new Error('No se encontró el alisto.');
    const est = txt_(t.values[filas[0]][t.idx.Estado]);
    if (['APLICADO', 'APLICANDO'].indexOf(est) >= 0) throw new Error('Este alisto ya fue aplicado.');
    filas.forEach(i => sh.getRange(i + 1, t.idx.Estado + 1).setValue('APLICANDO'));
    const r0 = t.values[filas[0]];
    const lin = filas.map(i => ({ clave: txt_(t.values[i][t.idx.Clave]), cantidad: invNum_(t.values[i][t.idx.Cantidad]), linea: Number(t.values[i][t.idx.Linea]) || 0 }));
    return { estado: est, idMovil: txt_(r0[t.idx.ID_Movil]), obs: txt_(r0[t.idx.Obs]), creado: txt_(r0[t.idx.Creado]), usuario: txt_(r0[t.idx.Usuario]), alistado: txt_(r0[t.idx.Alistado]), lineas: lin };
  });

  const lineas = (lineasFinales && lineasFinales.length ? lineasFinales : previo.lineas).map((l, i) => ({ clave: l.clave, cantidad: l.cantidad, linea: i + 1 }));
  let r;
  try {
    r = guardarMovimientoInvWeb(token, { tipo: 'ENTREGA', fecha: fecha || segAhora_().slice(0, 10), idMovil: previo.idMovil, referencia: alisto, obs: previo.obs, lineas: lineas });
  } catch (e) {
    conBloqueo_(() => {
      const sh = invHoja_('ALI');
      const t = leerTabla_(sh);
      t.values.forEach((row, i) => { if (i > 0 && txt_(row[t.idx.Alisto]) === alisto) sh.getRange(i + 1, t.idx.Estado + 1).setValue(previo.estado); });
    });
    throw e;
  }

  conBloqueo_(() => {
    const sh = invHoja_('ALI');
    const mv = segMapaMoviles_().porId[previo.idMovil] || {};
    const mats = {};
    invMateriales_().forEach(m => { mats[m.clave] = m; });
    const ahora = segAhora_();
    const filas = lineas.map((l, i) => ({
      Alisto: alisto, Estado: 'APLICADO', Fecha: segFecha_(fecha) || ahora.slice(0, 10), ID_Movil: previo.idMovil, Movil: txt_(mv.Movil), Clave: l.clave,
      Material: mats[l.clave] ? mats[l.clave].material : l.clave, Cantidad: l.cantidad, Linea: i + 1, Obs: previo.obs, Usuario: previo.usuario, Creado: previo.creado,
      Alistado: previo.alistado, Aplicado: ses.usuario + ' · ' + ahora, Grupo_Mov: r.grupo, Consecutivo_Mov: r.consecutivo
    }));
    invAlistoReescribir_(sh, filas, [alisto]);
  });
  return r;
}

function obtenerMovimientosInvWeb(token, desde, hasta) {

  requerirSesion_(token, 'consulta');

  desde = segFecha_(desde);
  hasta = segFecha_(hasta);
  if (!desde || !hasta) throw new Error('Indica el rango de fechas.');

  /* Se lee una sola vez; solo si hay documentos sin consecutivo se bloquea y se reparte */
  const shMov = invHoja_('MOV');
  let filasMov = leerObjetos_(shMov);
  if (filasMov.some(r => !txt_(r.Consecutivo))) {
    conBloqueo_(() => invRepartirConsec_());
    filasMov = leerObjetos_(shMov);
  }

  const grupos = {};
  const orden = [];
  filasMov.forEach(r => {
    const f = invFecha_(r.Fecha);
    if (f < desde || f > hasta) return;
    const g = txt_(r.Grupo);
    const tr = txt_(r.Tipo);
    if (tr === 'TRAS_ENTRA') {
      /* Traslado: la fila de entrada solo dice a qué móvil llegó */
      if (!grupos[g]) { grupos[g] = { grupo: g, fecha: f, tipo: 'TRASLADO', idMovil: '', movil: '', referencia: txt_(r.Referencia), obs: txt_(r.Obs), usuario: txt_(r.Usuario), creado: txt_(r.Creado), concepto: txt_(r.Concepto), consecutivo: txt_(r.Consecutivo), lineas: [] }; orden.push(g); }
      grupos[g].idMovilDestino = txt_(r.ID_Movil); grupos[g].movilDestino = txt_(r.Movil);
      return;
    }
    if (!grupos[g]) {
      grupos[g] = {
        grupo: g, fecha: f, tipo: tr === 'TRAS_SALE' ? 'TRASLADO' : tr, idMovil: txt_(r.ID_Movil), movil: txt_(r.Movil),
        referencia: txt_(r.Referencia), obs: txt_(r.Obs), usuario: txt_(r.Usuario), creado: txt_(r.Creado), concepto: txt_(r.Concepto), consecutivo: txt_(r.Consecutivo), editado: txt_(r.Editado), lineas: []
      };
      orden.push(g);
    }
    if (tr === 'TRAS_SALE' && !grupos[g].idMovil) { grupos[g].idMovil = txt_(r.ID_Movil); grupos[g].movil = txt_(r.Movil); }
    grupos[g].lineas.push({ clave: txt_(r.Clave), material: txt_(r.Material), cantidad: invNum_(r.Cantidad), linea: Number(r.Linea) || 0 });
  });

  /* Quién firmó de recibido (sin traer la imagen, que pesa) */
  const shF = invHoja_('FIR');
  const nF = shF.getLastRow() - 1;
  if (nF > 0) {
    shF.getRange(2, 1, nF, 4).getValues().forEach(r => {
      const g = txt_(r[0]);
      if (grupos[g]) grupos[g].firmado = { nombre: txt_(r[2]), hora: txt_(r[3]) };
    });
  }

  return {
    desde: desde, hasta: hasta, tipos: INV.TIPOS, materiales: invMateriales_(),
    movimientos: orden.map(g => grupos[g]).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado.localeCompare(a.creado))
  };
}

/* Un movimiento (varias líneas de material): ingreso, entrega, devolución o ajuste */
function guardarMovimientoInvWeb(token, d) {

  const ses = requerirSesion_(token, 'operador');
  d = d || {};
  const editando = txt_(d.grupo);
  if (editando) requerirSesion_(token, 'admin');

  const tipo = txt_(d.tipo);
  if (!INV.TIPOS[tipo]) throw new Error('Tipo de movimiento no válido.');
  const fecha = segFecha_(d.fecha);
  if (!fecha) throw new Error('Fecha no válida.');
  const esMovil = tipo === 'ENTREGA' || tipo === 'DEV_MOVIL' || tipo === 'AJ_MOVIL' || tipo === 'TRASLADO';
  const esAjuste = tipo === 'AJ_BODEGA' || tipo === 'AJ_MOVIL';

  return conBloqueo_(() => {

    const mats = invMateriales_();
    const porClave = {};
    mats.forEach(m => { porClave[m.clave] = m; });

    let m = null;
    if (esMovil) {
      m = segMapaMoviles_().porId[txt_(d.idMovil)];
      if (!m) throw new Error(tipo === 'TRASLADO' ? 'Elige la móvil que entrega.' : 'Elige la móvil.');
    }
    let destino = null;
    if (tipo === 'TRASLADO') {
      destino = segMapaMoviles_().porId[txt_(d.idMovilDestino)];
      if (!destino) throw new Error('Elige la móvil que recibe.');
      if (String(destino.ID_Movil) === String(m.ID_Movil)) throw new Error('La móvil que entrega y la que recibe son la misma.');
    }

    const suma = {}, linDe = {};
    let nLin = 0;
    (d.lineas || []).forEach(l => {
      const c = txt_(l.clave);
      const q = invNum_(l.cantidad);
      if (!c || !q) return;
      nLin++;
      if (!linDe[c]) linDe[c] = Number(l.linea) || nLin;
      if (!porClave[c]) throw new Error('Material no válido: ' + c);
      if (!esAjuste && q < 0) throw new Error('Las cantidades deben ser mayores que cero.');
      suma[c] = invRedondear_((suma[c] || 0) + q);
    });
    const claves = Object.keys(suma);
    if (!claves.length) throw new Error('Agrega al menos un material con cantidad.');

    /* Documentos de la bodega principal (con concepto): todos los datos son obligatorios */
    if (txt_(d.concepto)) {
      if (!txt_(d.referencia)) throw new Error('Falta el número de documento.');
    }

    /* Edición (solo admin): el documento conserva su grupo, consecutivo, creador y fecha de registro */
    let original = null;
    if (editando) {
      original = leerObjetos_(invHoja_('MOV')).filter(r => txt_(r.Grupo) === editando);
      if (!original.length) throw new Error('No se encontró el documento que quieres editar.');
    } else {
      invRepartirConsec_();
    }
    const consec = editando ? txt_(original[0].Consecutivo) : invSiguienteConsec_();
    const grupo = editando || 'M' + Date.now();
    const ahora = editando ? txt_(original[0].Creado) : segAhora_();
    const usuarioDoc = editando ? txt_(original[0].Usuario) : ses.usuario;
    const fila = (t, c, mv) => ({
      Grupo: grupo, Fecha: fecha, Tipo: t, Clave: c, Material: porClave[c].material, Cantidad: suma[c],
      ID_Movil: mv ? String(mv.ID_Movil) : '', Movil: mv ? txt_(mv.Movil) : '',
      Referencia: txt_(d.referencia).slice(0, 120), Obs: txt_(d.obs).slice(0, 300),
      Usuario: usuarioDoc, Creado: ahora, Concepto: txt_(d.concepto).slice(0, 60), Consecutivo: consec, Linea: linDe[c],
      Editado: editando ? ses.usuario + ' · ' + segAhora_() : ''
    });
    let filas;
    if (tipo === 'TRASLADO') {
      filas = [];
      claves.forEach(c => { filas.push(fila('TRAS_SALE', c, m)); filas.push(fila('TRAS_ENTRA', c, destino)); });
    } else {
      filas = claves.map(c => fila(tipo, c, m));
    }

    if (editando) {
      const shM = invHoja_('MOV');
      const tm = leerTabla_(shM);
      const quedan = tm.values.slice(1).filter(r => txt_(r[tm.idx.Grupo]) !== editando);
      shM.getRange(2, 1, tm.values.length - 1, tm.values[0].length).clearContent();
      if (quedan.length) shM.getRange(2, 1, quedan.length, tm.values[0].length).setValues(quedan);
    }
    if (editando) invQuitarFirma_(editando);
    invAgregar_(invHoja_('MOV'), 'MOV', filas);
    /* Se permite que la bodega quede en negativo (p. ej. un préstamo entre contratistas sin registrar); solo se avisa */
    const sal = invSaldos_(leerObjetos_(invHoja_('MOV')), []);
    const negativos = claves.filter(c => ((sal.bodega[c] || {}).disponible || 0) < -1e-9)
      .map(c => porClave[c].material + ' (' + sal.bodega[c].disponible + ')');
    return { ok: true, grupo: grupo, consecutivo: consec, lineas: claves.length, negativos: negativos };
  });
}

/* Firma de recibido de un documento (imagen PNG dibujada en pantalla). Si el documento se edita después, la firma se descarta. */
function firmarMovimientoInvWeb(token, grupo, nombre, imagen) {

  const ses = requerirSesion_(token, 'operador');
  grupo = txt_(grupo);
  nombre = txt_(nombre).slice(0, 80);
  imagen = String(imagen || '');
  if (!grupo) throw new Error('Falta el documento.');
  if (!nombre) throw new Error('Escribe el nombre de quien recibe.');
  if (imagen.indexOf('data:image/png;base64,') !== 0) throw new Error('La firma no es válida.');
  if (imagen.length > 45000) throw new Error('La firma es demasiado grande. Bórrala y hazla de nuevo con trazos más simples.');

  return conBloqueo_(() => {
    const doc = leerObjetos_(invHoja_('MOV')).filter(r => txt_(r.Grupo) === grupo);
    if (!doc.length) throw new Error('No se encontró el documento.');
    invQuitarFirma_(grupo);
    invAgregar_(invHoja_('FIR'), 'FIR', [{
      Grupo: grupo, Consecutivo: txt_(doc[0].Consecutivo), Nombre: nombre, Fecha_Hora: segAhora_(), Usuario: ses.usuario, Firma: imagen
    }]);
    return { ok: true, nombre: nombre };
  });
}

function obtenerFirmaInvWeb(token, grupo) {

  requerirSesion_(token, 'consulta');
  grupo = txt_(grupo);
  const f = leerObjetos_(invHoja_('FIR')).filter(r => txt_(r.Grupo) === grupo)[0];
  return f ? { nombre: txt_(f.Nombre), hora: txt_(f.Fecha_Hora), usuario: txt_(f.Usuario), imagen: String(f.Firma || '') } : null;
}

function invQuitarFirma_(grupo) {
  const sh = invHoja_('FIR');
  const t = leerTabla_(sh);
  for (let i = t.values.length - 1; i >= 1; i--) {
    if (txt_(t.values[i][t.idx.Grupo]) === grupo) sh.deleteRow(i + 1);
  }
}

function eliminarMovimientoInvWeb(token, grupo) {

  requerirSesion_(token, 'admin');
  grupo = txt_(grupo);
  if (!grupo) throw new Error('Falta el movimiento.');

  return conBloqueo_(() => {
    const sh = invHoja_('MOV');
    const t = leerTabla_(sh);
    let n = 0;
    for (let i = t.values.length - 1; i >= 1; i--) {
      if (txt_(t.values[i][t.idx.Grupo]) === grupo) { sh.deleteRow(i + 1); n++; }
    }
    if (!n) throw new Error('No se encontró el movimiento.');
    invQuitarFirma_(grupo);
    return { ok: true, lineas: n };
  });
}

/* Stock objetivo por móvil y material: lista [{idMovil, clave, cantidad}]; cantidad vacía o 0 lo quita */
function guardarObjetivosWeb(token, lista) {

  requerirSesion_(token, 'admin');
  lista = lista || [];

  return conBloqueo_(() => {
    const sh = invHoja_('OBJ');
    const mapa = {};
    leerObjetos_(sh).forEach(o => {
      const m = txt_(o.ID_Movil), c = txt_(o.Clave);
      if (m && c) mapa[m + '|' + c] = { ID_Movil: m, Clave: c, Objetivo: invNum_(o.Objetivo) };
    });

    lista.forEach(x => {
      const m = txt_(x.idMovil), c = txt_(x.clave), q = invNum_(x.cantidad);
      if (!m || !c) return;
      if (q > 0) mapa[m + '|' + c] = { ID_Movil: m, Clave: c, Objetivo: q };
      else delete mapa[m + '|' + c];
    });

    invReescribir_(sh, 'OBJ', Object.keys(mapa).map(k => mapa[k]));
    return { ok: true, total: Object.keys(mapa).length };
  });
}

/* Costos unitarios (₡) según el adendum del contrato, por código de material */
const INV_COSTOS_ADENDUM = {
  '1-2-17': 196, '1-4-61': 542, '1-8-40': 26.94, '1-8-41': 2148.26, '2-1-11': 200.18, '2-2-02': 254.34,
  '2-4-02': 1200.42, '2-4-03': 1316.70, '2-4-04': 1412.34, '2-5-02': 755.88, '2-5-03': 47.86, '2-7-07': 386,
  '2-7-11': 30000, '4-2-41': 10416, '4-3-18': 5669.10, '4-3-42': 998, '4-4-643': 158182.56, '4-4-644': 100900.92,
  '4-4-655': 52098.86, '5-2-155': 13283.30, '8-1-90': 56340.33, '8-1-902': 89770.86, '8-1-904': 42539.04,
  '8-1-905': 44935.74, '9-1-01': 82268.28
};

/* Carga los costos del adendum por código y, si se indica, deja el stock completo de bodega = N × el stock por móvil */
function aplicarCostosAdendumWeb(token, multiplicador) {

  requerirSesion_(token, 'admin');
  const mult = Number(multiplicador) || 0;

  return conBloqueo_(() => {
    const sh = invHoja_('MAT');
    const t = leerTabla_(sh);
    const iCod = t.idx.Codigo, iCosto = t.idx.Costo_Unitario, iComp = t.idx.Stock_Completo, iBase = t.idx.Objetivo_Base, iAct = t.idx.Activo, iNom = t.idx.Material, iMin = t.idx.Minimo_Bodega;
    if (iCosto === undefined || iComp === undefined) throw new Error('Faltan las columnas de costo; actualiza la pantalla e inténtalo de nuevo.');

    const usados = {};
    let conCosto = 0, conCompleto = 0;
    const sinCosto = [], sinBase = [];

    for (let i = 1; i < t.values.length; i++) {
      const fila = t.values[i];
      const codigos = txt_(fila[iCod]).split(';').map(c => c.trim()).filter(Boolean);
      const hit = codigos.find(c => INV_COSTOS_ADENDUM[c] !== undefined);
      if (hit) {
        fila[iCosto] = INV_COSTOS_ADENDUM[hit];
        usados[hit] = true;
        conCosto++;
      } else if (txt_(fila[iAct]) !== 'No') {
        sinCosto.push(txt_(fila[iNom]));
      }
      if (mult > 0 && txt_(fila[iAct]) !== 'No') {
        const base = invNum_(fila[iBase]);
        if (base > 0) {
          fila[iComp] = invRedondear_(base * mult);
          if (iMin !== undefined) fila[iMin] = Math.ceil(fila[iComp] * 0.2);   /* mínimo en bodega = 20% del stock completo */
          conCompleto++;
        }
        else sinBase.push(txt_(fila[iNom]));
      }
    }

    if (t.values.length > 1) sh.getRange(2, 1, t.values.length - 1, t.values[0].length).setValues(t.values.slice(1));

    return {
      ok: true, conCosto: conCosto, conCompleto: conCompleto,
      codigosSinMaterial: Object.keys(INV_COSTOS_ADENDUM).filter(c => !usados[c]),
      sinCosto: sinCosto.slice(0, 40), sinBase: sinBase.slice(0, 40)
    };
  });
}

function guardarMaterialInvWeb(token, d) {

  requerirSesion_(token, 'admin');
  d = d || {};
  const nombre = txt_(d.material).slice(0, 80);
  if (!nombre) throw new Error('Escribe el nombre del material.');

  return conBloqueo_(() => {
    const sh = invHoja_('MAT');
    const t = leerTabla_(sh);
    const clave = txt_(d.clave) || invClave_(nombre);

    const o = {
      Clave: clave, Material: nombre, Unidad: txt_(d.unidad).slice(0, 12) || 'u',
      Minimo_Bodega: invNum_(d.minimo), Activo: d.activo === false || d.activo === 'No' ? 'No' : 'Sí',
      Alias: txt_(d.alias).slice(0, 400), Codigo: txt_(d.codigo).slice(0, 80)
    };
    if (d.base !== undefined) o.Objetivo_Base = invNum_(d.base);
    if (d.costo !== undefined) o.Costo_Unitario = Math.max(0, invNum_(d.costo));
    if (d.completo !== undefined) o.Stock_Completo = Math.max(0, invNum_(d.completo));
    if (d.categoria !== undefined) o.Categoria = ['Consumo', 'De corte', 'Equipos'].indexOf(txt_(d.categoria)) >= 0 ? txt_(d.categoria) : invCategoriaDe_(d.codigo, nombre, d.unidad);

    for (let i = 1; i < t.values.length; i++) {
      if (txt_(t.values[i][t.idx.Clave]) === clave) {
        if (!txt_(d.clave)) throw new Error('Ya existe un material con ese nombre.');
        Object.keys(o).forEach(n => { t.values[i][t.idx[n]] = o[n]; });
        sh.getRange(i + 1, 1, 1, t.values[0].length).setValues([t.values[i]]);
        return { ok: true, clave: clave };
      }
    }

    if (txt_(d.clave)) throw new Error('No se encontró el material.');
    o.Orden = t.values.length;
    appendPorEncabezados_(sh, o);
    return { ok: true, clave: clave };
  });
}

/* Importa el Reporte de Materiales por Móvil: cada OT descuenta lo que usó del stock de su móvil.
   Si la OT ya estaba cargada se reemplaza (se puede volver a subir el mismo archivo). */
function importarConsumoWeb(token, filas, archivo, mapa) {

  const ses = requerirSesion_(token, 'operador');
  filas = filas || [];
  if (!filas.length) throw new Error('El archivo no trae filas.');
  archivo = txt_(archivo).slice(0, 120);

  return conBloqueo_(() => {

    const horaCarga = segAhora_();
    const mm = segMapaMoviles_();
    const mats = invMateriales_();
    const shMat = invHoja_('MAT');

    const porNombre = {};
    mats.forEach(m => {
      porNombre[invClave_(m.material)] = m.clave;
      String(m.alias || '').split(';').forEach(a => { if (txt_(a)) porNombre[invClave_(a)] = m.clave; });
    });

    /* Columnas de material = las que no son datos de la OT */
    const cols = Object.keys(filas[0]).filter(k => INV.COLS_INFO.indexOf(String(k).toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')) === -1);

    const nuevos = [], ignorados = [];
    let orden = mats.length;
    const colClave = {};
    cols.forEach(k => {
      const ck = invClave_(k);
      if (!ck) return;
      if (mapa[k] === '__IGNORAR__') { ignorados.push(String(k).trim()); return; }
      if (!porNombre[ck]) {
        /* Sin relación con un material oficial: solo se crea si se pidió explícitamente; si no, se ignora la columna */
        let hay = false;
        for (let i = 0; i < filas.length && !hay; i++) hay = invNum_(filas[i][k]) > 0;
        if (!hay) return;
        if (mapa[k] !== '__NUEVO__') { ignorados.push(String(k).trim()); return; }
        orden++;
        invAgregar_(shMat, 'MAT', [{ Clave: ck, Material: String(k).replace(/\u00a0/g, ' ').trim(), Unidad: 'u',
          Minimo_Bodega: 0, Activo: 'Sí', Alias: '', Orden: orden }]);
        porNombre[ck] = ck;
        nuevos.push(String(k).trim());
      }
      colClave[k] = porNombre[ck];
    });

    const nombreDe = {};
    invMateriales_().forEach(m => { nombreDe[m.clave] = m.material; });

    const porOrden = {};
    let sinMovil = 0;
    const fechas = {};

    filas.forEach(f => {
      const ko = Object.keys(f).find(k => /^n_?orden$/i.test(String(k).replace(/[^a-zA-Z_]/g, '')));
      const kc = Object.keys(f).find(k => /^codigo_?movil$/i.test(String(k).replace(/[^a-zA-Z_]/g, '')));
      const kn = Object.keys(f).find(k => /^nombre_?movil$/i.test(String(k).replace(/[^a-zA-Z_]/g, '')));
      const kf = Object.keys(f).find(k => /^fecha_?cierre$/i.test(String(k).replace(/[^a-zA-Z_]/g, '')));
      const kt = Object.keys(f).find(k => /^contrato$/i.test(String(k).replace(/[^a-zA-Z_]/g, '')));

      const nOrden = segOrden_(ko ? f[ko] : '');
      if (!nOrden) return;
      const fecha = segFecha_(kf ? f[kf] : '');
      const m = segResolver_(mm, kc ? f[kc] : '', kn ? f[kn] : '');

      const cant = {};
      cols.forEach(k => {
        if (!colClave[k]) return;
        const q = invNum_(f[k]);
        if (q > 0) cant[colClave[k]] = invRedondear_((cant[colClave[k]] || 0) + q);
      });

      porOrden[nOrden] = { fecha: fecha, m: m, cant: cant, contrato: kt ? txt_(f[kt]).replace(/\.0+$/, '') : '' };
      if (fecha) fechas[fecha] = true;
      if (!m) sinMovil++;
    });

    const ordenes = Object.keys(porOrden);
    if (!ordenes.length) throw new Error('No encontré órdenes en el archivo. ¿Es el Reporte de Materiales por Móvil?');

    /* Reemplaza lo que ya estaba cargado de esas OT */
    const shCon = invHoja_('CON');
    const previas = leerObjetos_(shCon).filter(r => !porOrden[txt_(r.N_Orden)]);

    const nuevas = [];
    let lineas = 0;
    ordenes.forEach(o => {
      const x = porOrden[o];
      if (!x.m) return;
      Object.keys(x.cant).forEach(c => {
        nuevas.push({
          Fecha: x.fecha, N_Orden: o, ID_Movil: String(x.m.ID_Movil), Movil: txt_(x.m.Movil),
          Clave: c, Material: nombreDe[c] || c, Cantidad: x.cant[c], Archivo: archivo, Carga: horaCarga, Contrato: x.contrato
        });
        lineas++;
      });
    });

    invReescribir_(shCon, 'CON', previas.map(r => ({
      Fecha: invFecha_(r.Fecha), N_Orden: txt_(r.N_Orden), ID_Movil: txt_(r.ID_Movil), Movil: txt_(r.Movil),
      Clave: txt_(r.Clave), Material: txt_(r.Material), Cantidad: invNum_(r.Cantidad), Archivo: txt_(r.Archivo), Carga: txt_(r.Carga), Contrato: txt_(r.Contrato)
    })).concat(nuevas));

    /* Cruce con Seguimiento: OT finalizadas que no vinieron en el reporte de materiales */
    const dias = Object.keys(fechas);
    const finSeg = segLeer_('OT', dias.slice().sort()[0], dias.slice().sort().pop()).filter(o => dias.indexOf(txt_(o.Fecha)) !== -1 && txt_(o.Estado).toUpperCase() === 'FINALIZADA');
    const finSet = {};
    finSeg.forEach(o => { finSet[txt_(o.N_Orden)] = o; });
    const sinReporte = finSeg.filter(o => !porOrden[txt_(o.N_Orden)])
      .map(o => ({ orden: txt_(o.N_Orden), movil: txt_(o.Movil), fecha: txt_(o.Fecha) }));
    const noEnSeguimiento = ordenes.filter(o => !finSet[o]).length;

    invAgregar_(invHoja_('CARGAS'), 'CARGAS', [{
      Fecha_Hora: horaCarga, Archivo: archivo, Filas: filas.length, OT: ordenes.length,
      Fechas: dias.sort().join(', '), Sin_Movil: sinMovil, Usuario: ses.usuario
    }]);

    return {
      ok: true, filas: filas.length, ordenes: ordenes.length, lineas: lineas, sinMovil: sinMovil,
      fechas: dias.sort(), materialesNuevos: nuevos, ignorados: ignorados,
      finalizadasSeg: finSeg.length, sinReporte: sinReporte.slice(0, 60), totalSinReporte: sinReporte.length,
      noEnSeguimiento: noEnSeguimiento
    };
  });
}

/* Lista detallada del consumo: una fila por OT con sus materiales */
function obtenerConsumoDetalleWeb(token, desde, hasta) {

  requerirSesion_(token, 'consulta');

  desde = segFecha_(desde);
  hasta = segFecha_(hasta);
  if (!desde || !hasta) throw new Error('Indica el rango de fechas.');

  /* Contrato por OT: el del reporte importado o, si falta, el de Seguimiento */
  const contratoSeg = {};
  try { segLeer_('OT', desde, hasta).forEach(o => { if (txt_(o.Contrato)) contratoSeg[segOrden_(o.N_Orden)] = txt_(o.Contrato); }); } catch (e) { /* sin Seguimiento */ }

  const ots = {};
  leerObjetosPorFecha_(invHoja_('CON'), 'Fecha', desde, hasta).forEach(r => {
    const f = invFecha_(r.Fecha);
    if (f < desde || f > hasta) return;
    const o = txt_(r.N_Orden);
    const x = ots[o] = ots[o] || { orden: o, fecha: f, idMovil: txt_(r.ID_Movil), movil: txt_(r.Movil), archivo: txt_(r.Archivo), carga: txt_(r.Carga), contrato: txt_(r.Contrato) || contratoSeg[segOrden_(o)] || '', items: [] };
    x.items.push({ clave: txt_(r.Clave), material: txt_(r.Material), cantidad: invNum_(r.Cantidad) });
  });

  return Object.keys(ots).map(k => ots[k])
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || (Number(a.movil) || 0) - (Number(b.movil) || 0) || a.orden.localeCompare(b.orden));
}

/* Elimina una importación completa: quita sus líneas de consumo (el stock de las móviles vuelve a lo que era sin ellas) */
function eliminarCargaConsumoWeb(token, hora) {

  requerirSesion_(token, 'admin');
  hora = txt_(hora);
  if (!hora) throw new Error('Indica la importación.');

  return conBloqueo_(() => {

    const shCar = invHoja_('CARGAS');
    const cargas = leerObjetos_(shCar);
    const car = cargas.find(c => txt_(c.Fecha_Hora) === hora);
    if (!car) throw new Error('Esa importación ya no existe. Actualiza la pantalla.');
    const archivo = txt_(car.Archivo);

    const shCon = invHoja_('CON');
    const todas = leerObjetos_(shCon);
    /* Filas de esa carga; las anteriores a esta función (sin marca de carga) se identifican por el nombre del archivo */
    const sale = r => txt_(r.Carga) === hora || (!txt_(r.Carga) && txt_(r.Archivo) === archivo);
    const quedan = todas.filter(r => !sale(r));
    const quitadas = todas.length - quedan.length;
    const otsQuitadas = {};
    todas.filter(sale).forEach(r => { otsQuitadas[txt_(r.N_Orden)] = true; });

    invReescribir_(shCon, 'CON', quedan.map(r => ({
      Fecha: invFecha_(r.Fecha), N_Orden: txt_(r.N_Orden), ID_Movil: txt_(r.ID_Movil), Movil: txt_(r.Movil),
      Clave: txt_(r.Clave), Material: txt_(r.Material), Cantidad: invNum_(r.Cantidad), Archivo: txt_(r.Archivo), Carga: txt_(r.Carga), Contrato: txt_(r.Contrato)
    })));

    shCar.deleteRow(car._fila);

    return { ok: true, lineas: quitadas, ordenes: Object.keys(otsQuitadas).length, archivo: archivo };
  });
}

/* =========================================================
   DEVOLUCIONES DE CAMBIO
   Control semanal de los equipos que las móviles deben devolver tras un cambio de equipo.
   No toca el stock ni los gastos: el gasto de esos equipos ya se reportó aparte.
   ========================================================= */

function devSesion_(token, minimo) {
  const ses = requerirSesion_(token, minimo);
  if ((ses.modulos || []).indexOf('bodega') === -1) throw new Error('No tienes acceso al módulo de Bodega.');
  return ses;
}

/* Una fila de INV_DEV_LINEAS como objeto completo */
function devFila_(r) {
  const o = {};
  INV.HEADERS.DEVL.forEach(h => { o[h] = txt_(r[h]); });
  ['Debe', 'Devuelto', 'Justificado'].forEach(h => { o[h] = invRedondear_(invNum_(r[h])); });
  o.Fecha_Cierre = invFecha_(r.Fecha_Cierre);
  o.Fecha_Devolucion = invFecha_(r.Fecha_Devolucion);
  o._fila = r._fila;
  return o;
}

function devPend_(o) { return invRedondear_(o.Debe - o.Devuelto - o.Justificado); }

function devEscribir_(sh, lineas) {
  invReescribir_(sh, 'DEVL', lineas.map(o => { const c = Object.assign({}, o); delete c._fila; return c; }));
}

function devHist_(ses, linea, accion, detalle) {
  invAgregar_(invHoja_('DEVH'), 'DEVH', [{ Fecha_Hora: segAhora_(), Usuario: ses.usuario, Linea: linea, Accion: accion, Detalle: detalle || '' }]);
}

/* Importa el archivo semanal de devoluciones. filas: [{movil, contrata, averia, tipo, fecha, servicio, contrato, orden, equipos:{EERO:1, ...}}].
   Las líneas que ya estaban (misma OT y equipo) no se tocan: se conserva lo devuelto, justificado o cambiado. */
function importarDevolucionesWeb(token, filas, archivo, periodo) {

  const ses = devSesion_(token, 'operador');
  filas = filas || [];
  if (!filas.length) throw new Error('El archivo no trae filas.');
  archivo = txt_(archivo).slice(0, 120);

  return conBloqueo_(() => {

    const mm = segMapaMoviles_();
    const sh = invHoja_('DEVL');
    const todas = leerObjetos_(sh).map(devFila_);
    const porLinea = {}, cambiadas = {};
    todas.forEach(o => {
      porLinea[o.Linea] = o;
      if (o.Equipo_Original) cambiadas[o.N_Orden + '|' + o.Equipo_Original] = true;
    });

    const fechas = filas.map(f => segFecha_(f.fecha)).filter(Boolean).sort();
    periodo = txt_(periodo).slice(0, 40) || (fechas.length ? fechas[0] + ' al ' + fechas[fechas.length - 1] : segFecha_(new Date()));
    const ahora = segAhora_();

    let nuevas = 0, repetidas = 0, sinMovil = 0, unidades = 0;
    const ots = {}, sinMovilTxt = {};
    const hist = [];

    filas.forEach(f => {
      const orden = segOrden_(f.orden);
      if (!orden) return;
      const m = segResolver_(mm, '', f.movil);
      Object.keys(f.equipos || {}).forEach(eq => {
        const q = invRedondear_(invNum_(f.equipos[eq]));
        if (q <= 0) return;
        const equipo = txt_(eq).slice(0, 40);
        const linea = orden + '|' + equipo;
        if (porLinea[linea] || cambiadas[linea]) { repetidas++; return; }
        if (!m) { sinMovil++; sinMovilTxt[txt_(f.movil)] = true; }
        const o = {
          Linea: linea, Periodo: periodo, Archivo: archivo, Fecha_Cierre: segFecha_(f.fecha), N_Orden: orden, Contrato: txt_(f.contrato).replace(/\.0+$/, ''),
          ID_Movil: m ? String(m.ID_Movil) : '', Movil: m ? txt_(m.Movil) : (segNumMovil_(f.movil) || txt_(f.movil)),
          Contrata: txt_(f.contrata), Averia: txt_(f.averia).slice(0, 120), Tipo: txt_(f.tipo), Servicio: txt_(f.servicio).slice(0, 120),
          Equipo: equipo, Equipo_Original: '', Debe: q, Devuelto: 0, Justificado: 0, Motivo_Justif: '', Justif_Por: '', Justif_Fecha: '',
          Boletas: '', Fecha_Devolucion: '', Cambio_Motivo: '', Cargado: ahora, Usuario: ses.usuario
        };
        porLinea[linea] = o;
        todas.push(o);
        ots[orden] = true;
        nuevas++; unidades += q;
      });
    });

    if (!nuevas && !repetidas) throw new Error('No encontré equipos por devolver en el archivo. ¿Es el reporte semanal de devoluciones?');
    devEscribir_(sh, todas);
    invAgregar_(invHoja_('DEVH'), 'DEVH', [{ Fecha_Hora: ahora, Usuario: ses.usuario, Linea: '', Accion: 'IMPORTAR', Detalle: archivo + ' · ' + periodo + ' · ' + nuevas + ' líneas nuevas, ' + repetidas + ' ya existían' }]);

    return { ok: true, periodo: periodo, nuevas: nuevas, repetidas: repetidas, ordenes: Object.keys(ots).length, unidades: unidades,
      sinMovil: sinMovil, movilesSinFicha: Object.keys(sinMovilTxt) };
  });
}

function devInfo_(o) {
  return { linea: o.Linea, periodo: o.Periodo, archivo: o.Archivo, fecha: o.Fecha_Cierre, orden: o.N_Orden, contrato: o.Contrato, idMovil: o.ID_Movil, movil: o.Movil,
    contrata: o.Contrata, averia: o.Averia, tipo: o.Tipo, servicio: o.Servicio, equipo: o.Equipo, equipoOriginal: o.Equipo_Original,
    debe: o.Debe, devuelto: o.Devuelto, justificado: o.Justificado, pendiente: devPend_(o), motivo: o.Motivo_Justif, justPor: o.Justif_Por, justFecha: o.Justif_Fecha,
    boletas: o.Boletas, fechaDev: o.Fecha_Devolucion, recibidoPor: o.Recibido_Por, cambioMotivo: o.Cambio_Motivo };
}

function obtenerDevolucionesWeb(token) {
  devSesion_(token, 'consulta');
  const lineas = leerObjetos_(invHoja_('DEVL')).map(devFila_).filter(o => o.Debe > 0)
    .sort((a, b) => b.Fecha_Cierre.localeCompare(a.Fecha_Cierre) || a.N_Orden.localeCompare(b.N_Orden)).map(devInfo_);
  const entregas = leerObjetos_(invHoja_('DEVE')).slice(-80).reverse().map(e => ({
    fecha: invFecha_(e.Fecha), movil: txt_(e.Movil), boleta: txt_(e.Boleta), equipo: txt_(e.Equipo), cantidad: invNum_(e.Cantidad), usuario: txt_(e.Usuario), creado: txt_(e.Creado) }));
  return { lineas: lineas, entregas: entregas };
}

function obtenerHistorialDevolucionWeb(token, linea) {
  devSesion_(token, 'consulta');
  linea = txt_(linea);
  return leerObjetos_(invHoja_('DEVH')).filter(h => txt_(h.Linea) === linea).reverse()
    .map(h => ({ hora: txt_(h.Fecha_Hora), usuario: txt_(h.Usuario), accion: txt_(h.Accion), detalle: txt_(h.Detalle) }));
}

function devBuscar_(todas, linea) {
  const o = todas.find(x => x.Linea === txt_(linea));
  if (!o) throw new Error('No se encontró esa línea. Actualiza la pantalla.');
  return o;
}

function devAgregarBoleta_(o, boleta) {
  const b = txt_(boleta);
  if (b && o.Boletas.split(',').map(x => x.trim()).indexOf(b) === -1) o.Boletas = o.Boletas ? o.Boletas + ', ' + b : b;
}

/* Registra que se devolvió (parte de) una línea */
function registrarDevolucionLineaWeb(token, linea, cantidad, fecha, boleta) {

  const ses = devSesion_(token, 'operador');

  return conBloqueo_(() => {
    const sh = invHoja_('DEVL');
    const todas = leerObjetos_(sh).map(devFila_);
    const o = devBuscar_(todas, linea);
    const pend = devPend_(o);
    const q = cantidad === '' || cantidad == null ? pend : invRedondear_(invNum_(cantidad));
    if (q <= 0) throw new Error('Escribe una cantidad mayor a cero.');
    if (q > pend + 1e-9) throw new Error('Solo quedan ' + pend + ' por devolver en esa línea.');
    const dia = segFecha_(fecha) || segFecha_(new Date());
    o.Devuelto = invRedondear_(o.Devuelto + q); o.Fecha_Devolucion = dia; devAgregarBoleta_(o, boleta); o.Recibido_Por = ses.usuario;
    devEscribir_(sh, todas);
    invAgregar_(invHoja_('DEVE'), 'DEVE', [{ Entrega: 'L' + Date.now(), Fecha: dia, ID_Movil: o.ID_Movil, Movil: o.Movil, Boleta: txt_(boleta), Equipo: o.Equipo, Cantidad: q, Linea: o.Linea, Usuario: ses.usuario, Creado: segAhora_() }]);
    devHist_(ses, o.Linea, 'DEVOLUCION', q + ' ' + o.Equipo + (txt_(boleta) ? ' · boleta ' + txt_(boleta) : '') + ' · ' + dia);
    return { ok: true, pendiente: devPend_(o) };
  });
}

/* Recibe de una vez las líneas pendientes indicadas (p. ej. toda la semana) con una sola boleta */
function recibirLineasDevolucionWeb(token, lineas, fecha, boleta) {

  const ses = devSesion_(token, 'operador');
  lineas = lineas || [];
  if (!lineas.length) throw new Error('No hay líneas para recibir.');
  if (!txt_(boleta)) throw new Error('Escribe el número de boleta.');
  return conBloqueo_(() => {
    const sh = invHoja_('DEVL');
    const todas = leerObjetos_(sh).map(devFila_);
    const dia = segFecha_(fecha) || segFecha_(new Date());
    const set = {}; lineas.forEach(l => { set[txt_(l)] = true; });
    const filas = []; let n = 0, und = 0;
    todas.forEach(o => {
      const pend = devPend_(o);
      if (!set[o.Linea] || pend <= 0) return;
      o.Devuelto = invRedondear_(o.Devuelto + pend); o.Fecha_Devolucion = dia; o.Recibido_Por = ses.usuario; devAgregarBoleta_(o, boleta);
      filas.push({ Entrega: 'S' + Date.now(), Fecha: dia, ID_Movil: o.ID_Movil, Movil: o.Movil, Boleta: txt_(boleta), Equipo: o.Equipo, Cantidad: pend, Linea: o.Linea, Usuario: ses.usuario, Creado: segAhora_() });
      devHist_(ses, o.Linea, 'DEVOLUCION', pend + ' ' + o.Equipo + ' · boleta ' + txt_(boleta) + ' · ' + dia + ' (recepción en bloque)');
      n++; und += pend;
    });
    if (!n) throw new Error('Esas líneas ya no tienen equipos pendientes.');
    devEscribir_(sh, todas);
    invAgregar_(invHoja_('DEVE'), 'DEVE', filas);
    return { ok: true, lineas: n, unidades: und };
  });
}

/* Boleta de devolución: cantidades por equipo que se entregaron a Telecable en una boleta. Se aplican a las líneas pendientes de la semana
   (de la más antigua a la más nueva; opcionalmente solo de una móvil). Una boleta no se puede registrar dos veces ni exceder lo pendiente. */
function registrarBoletaDevolucionWeb(token, periodo, fecha, boleta, cantidades, idMovil) {

  const ses = devSesion_(token, 'operador');
  boleta = txt_(boleta); periodo = txt_(periodo); idMovil = txt_(idMovil);
  if (!boleta) throw new Error('Escribe el número de boleta.');
  cantidades = cantidades || {};
  const pedidos = Object.keys(cantidades).map(e => ({ equipo: e, q: invRedondear_(invNum_(cantidades[e])) })).filter(x => x.q > 0);
  if (!pedidos.length) throw new Error('Escribe al menos una cantidad entregada.');
  return conBloqueo_(() => {
    if (leerObjetos_(invHoja_('DEVE')).some(e => txt_(e.Boleta).toLowerCase() === boleta.toLowerCase()))
      throw new Error('La boleta ' + boleta + ' ya fue registrada. No se puede duplicar la entrega.');
    const sh = invHoja_('DEVL');
    const todas = leerObjetos_(sh).map(devFila_);
    const dia = segFecha_(fecha) || segFecha_(new Date());
    const base = todas.filter(o => o.Debe > 0 && txt_(o.Periodo) === periodo && (!idMovil || o.ID_Movil === idMovil));
    const plan = [];
    pedidos.forEach(p => {
      const cand = base.filter(o => o.Equipo === p.equipo && devPend_(o) > 0).sort((a, b) => a.Fecha_Cierre.localeCompare(b.Fecha_Cierre) || a.N_Orden.localeCompare(b.N_Orden));
      const disp = invRedondear_(cand.reduce((a, o) => a + devPend_(o), 0));
      if (p.q > disp + 1e-9) throw new Error('Solo hay ' + disp + ' ' + p.equipo + ' pendientes en esa semana' + (idMovil ? ' para esa móvil' : '') + ' y la boleta trae ' + p.q + '. No se registró nada.');
      let resto = p.q;
      cand.forEach(o => { if (resto <= 0) return; const t = Math.min(resto, devPend_(o)); plan.push({ o: o, t: t }); resto = invRedondear_(resto - t); });
    });
    const filas = []; const id = 'B' + Date.now();
    plan.forEach(x => {
      x.o.Devuelto = invRedondear_(x.o.Devuelto + x.t); x.o.Fecha_Devolucion = dia; x.o.Recibido_Por = ses.usuario; devAgregarBoleta_(x.o, boleta);
      filas.push({ Entrega: id, Fecha: dia, ID_Movil: x.o.ID_Movil, Movil: x.o.Movil, Boleta: boleta, Equipo: x.o.Equipo, Cantidad: x.t, Linea: x.o.Linea, Usuario: ses.usuario, Creado: segAhora_() });
      devHist_(ses, x.o.Linea, 'DEVOLUCION', x.t + ' ' + x.o.Equipo + ' · boleta ' + boleta + ' · ' + dia);
    });
    devEscribir_(sh, todas);
    invAgregar_(invHoja_('DEVE'), 'DEVE', filas);
    return { ok: true, lineas: plan.length, unidades: pedidos.reduce((a, p) => a + p.q, 0) };
  });
}

/* Entrega de una móvil: cantidades por equipo (con una boleta). Se aplican a sus líneas pendientes, de la más antigua a la más nueva */
function registrarEntregaMovilWeb(token, idMovil, fecha, boleta, cantidades) {

  const ses = devSesion_(token, 'operador');
  idMovil = txt_(idMovil);
  cantidades = cantidades || {};
  const dia = segFecha_(fecha) || segFecha_(new Date());

  return conBloqueo_(() => {
    const sh = invHoja_('DEVL');
    const todas = leerObjetos_(sh).map(devFila_);
    const delMovil = todas.filter(o => o.ID_Movil === idMovil);
    if (!delMovil.length) throw new Error('Esa móvil no tiene líneas cargadas.');
    const nombre = 'M' + delMovil[0].Movil;
    const pedidos = Object.keys(cantidades).map(e => ({ equipo: e, q: invRedondear_(invNum_(cantidades[e])) })).filter(x => x.q > 0);
    if (!pedidos.length) throw new Error('Escribe al menos una cantidad devuelta.');

    /* Primero se valida todo, para no dejar una entrega a medias */
    const plan = [];
    pedidos.forEach(p => {
      const cand = delMovil.filter(o => o.Equipo === p.equipo && devPend_(o) > 0).sort((a, b) => a.Fecha_Cierre.localeCompare(b.Fecha_Cierre) || a.N_Orden.localeCompare(b.N_Orden));
      const disp = invRedondear_(cand.reduce((a, o) => a + devPend_(o), 0));
      if (p.q > disp + 1e-9) throw new Error(nombre + ' solo tiene ' + disp + ' ' + p.equipo + ' pendientes y se intentó registrar ' + p.q + '. Revisa la cantidad o carga primero el archivo con esas OT.');
      let resto = p.q;
      cand.forEach(o => { if (resto <= 0) return; const t = Math.min(resto, devPend_(o)); plan.push({ o: o, t: t }); resto = invRedondear_(resto - t); });
    });

    plan.forEach(x => { x.o.Devuelto = invRedondear_(x.o.Devuelto + x.t); x.o.Fecha_Devolucion = dia; x.o.Recibido_Por = ses.usuario; devAgregarBoleta_(x.o, boleta); });
    devEscribir_(sh, todas);

    const id = 'E' + Date.now();
    invAgregar_(invHoja_('DEVE'), 'DEVE', pedidos.map(p => ({ Entrega: id, Fecha: dia, ID_Movil: idMovil, Movil: delMovil[0].Movil, Boleta: txt_(boleta), Equipo: p.equipo, Cantidad: p.q, Linea: '', Usuario: ses.usuario, Creado: segAhora_() })));
    plan.forEach(x => devHist_(ses, x.o.Linea, 'DEVOLUCION', x.t + ' ' + x.o.Equipo + (txt_(boleta) ? ' · boleta ' + txt_(boleta) : '') + ' · entrega de ' + nombre + ' · ' + dia));
    return { ok: true, aplicadas: plan.length, unidades: pedidos.reduce((a, p) => a + p.q, 0) };
  });
}

/* Justifica que no se debe devolver (parte de) una línea. Solo administrador */
function justificarDevolucionWeb(token, linea, cantidad, motivo, quitar) {

  const ses = devSesion_(token, 'admin');

  return conBloqueo_(() => {
    const sh = invHoja_('DEVL');
    const todas = leerObjetos_(sh).map(devFila_);
    const o = devBuscar_(todas, linea);
    if (quitar) {
      if (o.Justificado <= 0) throw new Error('Esa línea no tiene justificación.');
      devHist_(ses, o.Linea, 'QUITAR_JUSTIFICACION', o.Justificado + ' ' + o.Equipo + ' · antes: ' + o.Motivo_Justif);
      o.Justificado = 0; o.Motivo_Justif = ''; o.Justif_Por = ''; o.Justif_Fecha = '';
    } else {
      motivo = txt_(motivo).slice(0, 300);
      if (!motivo) throw new Error('Escribe el motivo de la justificación.');
      const pend = devPend_(o);
      const q = cantidad === '' || cantidad == null ? pend : invRedondear_(invNum_(cantidad));
      if (q <= 0) throw new Error('Esa línea no tiene nada pendiente que justificar.');
      if (q > pend + 1e-9) throw new Error('Solo quedan ' + pend + ' pendientes en esa línea.');
      o.Justificado = invRedondear_(o.Justificado + q);
      o.Motivo_Justif = o.Motivo_Justif ? o.Motivo_Justif + ' | ' + motivo : motivo;
      o.Justif_Por = ses.usuario; o.Justif_Fecha = segAhora_();
      devHist_(ses, o.Linea, 'JUSTIFICAR', q + ' ' + o.Equipo + ' no se devuelven: ' + motivo);
    }
    devEscribir_(sh, todas);
    return { ok: true, pendiente: devPend_(o) };
  });
}

/* Cambia el equipo que se debe devolver (porque lo que corresponde devolver es otro). Mueve la cantidad pendiente indicada a la línea del equipo correcto */
function cambiarEquipoDevolucionWeb(token, linea, nuevoEquipo, cantidad, motivo) {

  const ses = devSesion_(token, 'operador');
  nuevoEquipo = txt_(nuevoEquipo).slice(0, 40);
  if (!nuevoEquipo) throw new Error('Elige el equipo correcto.');

  return conBloqueo_(() => {
    const sh = invHoja_('DEVL');
    const todas = leerObjetos_(sh).map(devFila_);
    const o = devBuscar_(todas, linea);
    if (o.Equipo === nuevoEquipo) throw new Error('Elige un equipo distinto al actual.');
    const pend = devPend_(o);
    const q = cantidad === '' || cantidad == null ? pend : invRedondear_(invNum_(cantidad));
    if (q <= 0) throw new Error('Esa línea no tiene nada pendiente que cambiar.');
    if (q > pend + 1e-9) throw new Error('Solo quedan ' + pend + ' pendientes en esa línea.');
    motivo = txt_(motivo).slice(0, 200) || 'Corresponde a otro equipo';

    const llave = o.N_Orden + '|' + nuevoEquipo;
    let dest = todas.find(x => x.Linea === llave);
    if (dest) { dest.Debe = invRedondear_(dest.Debe + q); dest.Cambio_Motivo = (dest.Cambio_Motivo ? dest.Cambio_Motivo + ' | ' : '') + motivo; }
    else {
      dest = Object.assign({}, o, { Linea: llave, Equipo: nuevoEquipo, Equipo_Original: o.Equipo, Debe: q, Devuelto: 0, Justificado: 0, Motivo_Justif: '', Justif_Por: '', Justif_Fecha: '',
        Boletas: '', Fecha_Devolucion: '', Cambio_Motivo: motivo, Cargado: segAhora_(), Usuario: ses.usuario });
      delete dest._fila;
      todas.push(dest);
    }
    /* La línea original conserva lo ya devuelto o justificado; solo baja lo que pasó al otro equipo (aunque quede en cero, para no volver a cargarla) */
    o.Debe = invRedondear_(o.Debe - q);
    devEscribir_(sh, todas);
    devHist_(ses, o.Linea, 'CAMBIO_EQUIPO', q + ' de ' + o.Equipo + ' pasan a ' + nuevoEquipo + ' · ' + motivo);
    devHist_(ses, llave, 'CAMBIO_EQUIPO', 'Recibe ' + q + ' desde ' + o.Equipo + ' · ' + motivo);
    return { ok: true, linea: llave };
  });
}

/* Deshace lo devuelto en una línea (por error de captura). Solo administrador */
function revertirDevolucionWeb(token, linea) {

  const ses = devSesion_(token, 'admin');

  return conBloqueo_(() => {
    const sh = invHoja_('DEVL');
    const todas = leerObjetos_(sh).map(devFila_);
    const o = devBuscar_(todas, linea);
    if (o.Devuelto <= 0) throw new Error('Esa línea no tiene devoluciones registradas.');
    devHist_(ses, o.Linea, 'REVERTIR_DEVOLUCION', o.Devuelto + ' ' + o.Equipo + ' · boletas: ' + o.Boletas);
    o.Devuelto = 0; o.Boletas = ''; o.Fecha_Devolucion = ''; o.Recibido_Por = '';
    devEscribir_(sh, todas);
    return { ok: true };
  });
}

/* Quita una semana cargada por error, si todavía no tiene devoluciones ni justificaciones. Solo administrador */
function eliminarPeriodoDevolucionesWeb(token, periodo, confirmacion) {

  const ses = devSesion_(token, 'admin');
  periodo = txt_(periodo);
  if (txt_(confirmacion).toUpperCase() !== 'ELIMINAR') throw new Error('Falta la confirmación. Escribe ELIMINAR para borrar la importación.');

  return conBloqueo_(() => {
    const sh = invHoja_('DEVL');
    const todas = leerObjetos_(sh).map(devFila_);
    const delPeriodo = todas.filter(o => o.Periodo === periodo);
    if (!delPeriodo.length) throw new Error('No se encontró esa semana.');
    const set = {}; delPeriodo.forEach(o => { set[o.Linea] = true; });
    const dev = delPeriodo.reduce((a, o) => a + o.Devuelto, 0), jus = delPeriodo.reduce((a, o) => a + o.Justificado, 0);
    devEscribir_(sh, todas.filter(o => !set[o.Linea]));
    /* también se quitan los registros de entrega ligados a esas líneas */
    const she = invHoja_('DEVE');
    const ent = leerObjetos_(she);
    const quedan = ent.filter(e => !set[txt_(e.Linea)]);
    if (quedan.length !== ent.length) invReescribir_(she, 'DEVE', quedan);
    devHist_(ses, '', 'ELIMINAR_SEMANA', periodo + ' · ' + delPeriodo.length + ' líneas (devueltos ' + dev + ', justificados ' + jus + ') · ' + (ent.length - quedan.length) + ' entregas');
    return { ok: true, eliminadas: delPeriodo.length };
  });
}

/* ---------- Alertas de bodega y notificaciones ---------- */

const INV_ALERTA_PCT = 0.20;

/* Materiales cuya bodega llegó al 20% (o menos) del stock completo, o está bajo el mínimo.
   Una alerta «aceptada» no vuelve a salir mientras siga igual; reaparece si el material se recupera y vuelve a caer,
   o si el disponible baja a la mitad de lo que había cuando se aceptó. */
function invAlertasBodega_(sinLimpiar) {
  const mats = invMateriales_();
  const s = invSaldos_(leerObjetos_(invHoja_('MOV')), invConsumoTot_());
  const shAle = invHoja_('ALE');
  const aceptadas = {};
  leerObjetos_(shAle).forEach(r => { aceptadas[txt_(r.Clave)] = { usuario: txt_(r.Usuario), fecha: txt_(r.Fecha_Hora), disponible: invNum_(r.Disponible), _fila: r._fila }; });

  const lista = [], enAlerta = {};
  mats.forEach(m => {
    if (!m.activo) return;
    const disp = (s.bodega[m.clave] || {}).disponible || 0;
    let nivel = '', pct = null;
    if (m.completo > 0) { pct = disp / m.completo; if (pct <= INV_ALERTA_PCT) nivel = 'pct'; }
    if (!nivel && m.minimo > 0 && disp <= m.minimo) nivel = 'min';
    if (!nivel) return;
    enAlerta[m.clave] = true;
    const ok = aceptadas[m.clave];
    const vigente = ok && !(ok.disponible > 0 && disp <= ok.disponible / 2);
    lista.push({ clave: m.clave, material: m.material, unidad: m.unidad, disponible: invRedondear_(disp), completo: m.completo, minimo: m.minimo,
      pct: pct, nivel: nivel, aceptada: vigente ? { usuario: ok.usuario, fecha: ok.fecha } : null });
  });

  /* Limpia aceptaciones de materiales que ya salieron de alerta (o que cayeron a la mitad): así pueden volver a avisar */
  const viejas = Object.keys(aceptadas).filter(c => !enAlerta[c] || (lista.find(x => x.clave === c) || {}).aceptada === null);
  if (viejas.length && !sinLimpiar) {
    try {
      conBloqueo_(() => {
        const t = leerObjetos_(shAle).filter(r => viejas.indexOf(txt_(r.Clave)) === -1);
        invReescribir_(shAle, 'ALE', t.map(r => ({ Clave: txt_(r.Clave), Usuario: txt_(r.Usuario), Fecha_Hora: txt_(r.Fecha_Hora), Disponible: invNum_(r.Disponible) })));
      });
    } catch (e) { /* si está ocupado, se limpia en la próxima consulta */ }
  }
  return lista.sort((a, b) => (a.pct === null ? 1 : a.pct) - (b.pct === null ? 1 : b.pct));
}

/* Acepta (da por enteradas) alertas de bodega: dejan de mostrarse a todos hasta que cambien */
function aceptarAlertasBodegaWeb(token, claves) {

  const ses = requerirSesion_(token, 'operador');
  if ((ses.modulos || []).indexOf('bodega') === -1) throw new Error('No tienes acceso al módulo de Bodega.');
  claves = (claves || []).map(txt_).filter(Boolean);
  if (!claves.length) return { ok: true, aceptadas: 0 };

  return conBloqueo_(() => {
    const disp = {};
    invAlertasBodega_(true).forEach(a => { disp[a.clave] = a.disponible; });
    const sh = invHoja_('ALE');
    const previas = leerObjetos_(sh).filter(r => claves.indexOf(txt_(r.Clave)) === -1)
      .map(r => ({ Clave: txt_(r.Clave), Usuario: txt_(r.Usuario), Fecha_Hora: txt_(r.Fecha_Hora), Disponible: invNum_(r.Disponible) }));
    const ahora = segAhora_();
    const nuevas = claves.filter(c => disp[c] !== undefined).map(c => ({ Clave: c, Usuario: ses.usuario, Fecha_Hora: ahora, Disponible: disp[c] }));
    invReescribir_(sh, 'ALE', previas.concat(nuevas));
    return { ok: true, aceptadas: nuevas.length };
  });
}

/* Notificaciones del usuario: alertas de bodega pendientes + novedades recientes de los módulos a los que tiene acceso */
function obtenerNotificacionesWeb(token) {

  const ses = requerirSesion_(token, 'consulta');
  const mods = ses.modulos || [];
  const tiene = m => mods.indexOf(m) !== -1;
  const hoy = new Date();
  const desde = d => Utilities.formatDate(new Date(hoy.getTime() - d * 86400000), SEG.TZ, 'yyyy-MM-dd HH:mm:ss');
  const eventos = [];
  const out = { alertas: [], eventos: eventos };

  if (tiene('bodega')) {
    try {
      out.alertas = invAlertasBodega_().filter(a => !a.aceptada);

      const d7 = desde(7), d14 = desde(14);
      leerObjetos_(invHoja_('CARGAS')).forEach(c => {
        const f = txt_(c.Fecha_Hora);
        if (f < d7) return;
        eventos.push({ id: 'car|' + f, tipo: 'bodega', icono: '📥', titulo: 'Consumo importado: ' + txt_(c.Archivo), detalle: (Number(c.OT) || 0) + ' OT · por ' + txt_(c.Usuario), fecha: f, vista: 'bodega', propio: txt_(c.Usuario) === ses.usuario });
      });
      leerObjetos_(invHoja_('CORTES')).forEach(c => {
        const f = txt_(c.Cerrado);
        if (txt_(c.Estado) !== 'Cerrado' || !f || f < d14) return;
        eventos.push({ id: 'cor|' + txt_(c.Corte) + '|' + f, tipo: 'bodega', icono: '🧮', titulo: 'Corte de inventario cerrado: ' + txt_(c.Corte), detalle: 'Cerrado por ' + txt_(c.Cerrado_Por) + ' · los saldos quedaron ajustados al físico', fecha: f, vista: 'bodega', propio: txt_(c.Cerrado_Por) === ses.usuario });
      });
    } catch (e) { /* una falla en bodega no debe tumbar las demás notificaciones */ }
  }

  if (tiene('cotizaciones')) {
    try {
      const d14 = desde(14);
      const cots = {};
      leerObjetos_(cotHoja_('COT')).forEach(c => { cots[txt_(c.Cotizacion)] = c; });
      leerObjetos_(cotHoja_('HIS')).forEach(h => {
        const f = txt_(h.Fecha_Hora);
        if (txt_(h.A) !== 'ACEPTADA' || f < d14) return;
        const num = txt_(h.Cotizacion), c = cots[num] || {};
        const nn = /^\d+$/.test(num) && num.length < 7 ? ('000000' + num).slice(-6) : num;
        eventos.push({ id: 'cot|' + num + '|' + f, tipo: 'cotizacion', icono: '✅', titulo: 'Cotización ' + nn + ' aceptada', detalle: (txt_(c.Cliente) || '') + (txt_(c.Proyecto) ? ' · ' + txt_(c.Proyecto) : '') + ' · por ' + txt_(h.Usuario), fecha: f, vista: 'cotizaciones', propio: txt_(h.Usuario) === ses.usuario });
      });
    } catch (e) { /* idem */ }
  }

  if (tiene('cronograma')) {
    try {
      const sh = obtenerSpreadsheet_().getSheetByName(CONFIG.HOJAS.HISTORIAL);
      if (sh) {
        const lim = hoy.getTime() - 7 * 86400000;
        const lotes = {};
        leerObjetos_(sh).forEach(r => {
          if (!(r.Fecha_Hora instanceof Date) || isNaN(r.Fecha_Hora) || r.Fecha_Hora.getTime() < lim) return;
          const k = String(r.Lote || r.Fecha_Hora.getTime());
          const l = lotes[k] = lotes[k] || { ts: r.Fecha_Hora.getTime(), usuario: txt_(r.Usuario), nombre: txt_(r.Nombre) || txt_(r.Usuario), n: 0, sem: txt_(r.Semana), ano: txt_(r.Ano), com: txt_(r.Comentario) };
          l.n++;
        });
        Object.keys(lotes).forEach(k => {
          const l = lotes[k];
          eventos.push({ id: 'cro|' + k, tipo: 'cronograma', icono: '📅', titulo: l.nombre + ' modificó el cronograma (semana ' + l.sem + ')',
            detalle: l.n + ' cambio' + (l.n === 1 ? '' : 's') + (l.com ? ' · ' + l.com : ''),
            fecha: Utilities.formatDate(new Date(l.ts), SEG.TZ, 'yyyy-MM-dd HH:mm:ss'), vista: 'calendario', propio: l.usuario === ses.usuario });
        });
      }
    } catch (e) { /* idem */ }
  }

  out.eventos = eventos.filter(e => !e.propio).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 40);
  return out;
}

/* Consumo (gasto de las móviles) en un rango de fechas */
function obtenerConsumoInvWeb(token, desde, hasta) {

  requerirSesion_(token, 'consulta');

  desde = segFecha_(desde);
  hasta = segFecha_(hasta);
  if (!desde || !hasta) throw new Error('Indica el rango de fechas.');

  const porMaterial = {}, porMovil = {}, otsMovil = {}, ots = {}, porDia = {};
  leerObjetosPorFecha_(invHoja_('CON'), 'Fecha', desde, hasta).forEach(r => {
    const f = invFecha_(r.Fecha);
    if (f < desde || f > hasta) return;
    const c = txt_(r.Clave), m = txt_(r.ID_Movil), q = invNum_(r.Cantidad), o = txt_(r.N_Orden);
    porMaterial[c] = invRedondear_((porMaterial[c] || 0) + q);
    (porMovil[m] = porMovil[m] || { movil: txt_(r.Movil), mats: {} }).mats[c] = invRedondear_((porMovil[m].mats[c] || 0) + q);
    (otsMovil[m] = otsMovil[m] || {})[o] = true;
    ots[o] = true;
    porDia[f] = porDia[f] || {};
    porDia[f][o] = true;
  });

  Object.keys(porMovil).forEach(m => { porMovil[m].ots = Object.keys(otsMovil[m]).length; });

  return {
    desde: desde, hasta: hasta, porMaterial: porMaterial, porMovil: porMovil,
    totalOt: Object.keys(ots).length,
    porDia: Object.keys(porDia).sort().map(f => ({ fecha: f, ots: Object.keys(porDia[f]).length }))
  };
}


/* ---------- Cortes de inventario (conteo físico mensual) ---------- */

/* Saldo teórico al cierre de una fecha: { BODEGA: {clave: n}, [idMovil]: {clave: n} } */
function invTeorico_(hasta, movs, cons) {
  const s = invSaldos_(movs || leerObjetos_(invHoja_('MOV')), cons || leerObjetos_(invHoja_('CON')), hasta);
  const t = { BODEGA: {} };
  Object.keys(s.bodega).forEach(c => { t.BODEGA[c] = s.bodega[c].disponible; });
  Object.keys(s.movil).forEach(m => {
    t[m] = {};
    Object.keys(s.movil[m]).forEach(c => { t[m][c] = s.movil[m][c].actual; });
  });
  return t;
}

function invCorteInfo_(o) {
  return { corte: txt_(o.Corte), fecha: invFecha_(o.Fecha), estado: txt_(o.Estado) || 'Abierto', obs: txt_(o.Obs),
    usuario: txt_(o.Usuario), creado: txt_(o.Creado), cerradoPor: txt_(o.Cerrado_Por), cerrado: txt_(o.Cerrado),
    tipo: txt_(o.Tipo) === 'Individual' ? 'Individual' : 'General', ubicacion: txt_(o.Ubicacion) };
}

/* Una fila de INV_CONTEO como objeto completo (incluye la justificación, para no perderla al reescribir la hoja) */
function invConteoFila_(r) {
  return { Corte: txt_(r.Corte), Ubicacion: txt_(r.Ubicacion), Clave: txt_(r.Clave), Teorico: invNum_(r.Teorico), Fisico: invNum_(r.Fisico),
    Justificada: txt_(r.Justificada), Motivo: txt_(r.Motivo), Justif_Por: txt_(r.Justif_Por), Justif_Fecha: txt_(r.Justif_Fecha) };
}

function obtenerCortesInvWeb(token) {

  requerirSesion_(token, 'consulta');

  const conteo = leerObjetos_(invHoja_('CONTEO'));
  const stats = {};
  conteo.forEach(r => {
    const c = txt_(r.Corte);
    const x = (stats[c] = stats[c] || { contados: 0, diferencias: 0 });
    x.contados++;
    if (Math.abs(invNum_(r.Fisico) - invNum_(r.Teorico)) > 1e-9) x.diferencias++;
  });

  return {
    cortes: leerObjetos_(invHoja_('CORTES')).map(invCorteInfo_).map(c => Object.assign(c, stats[c.corte] || { contados: 0, diferencias: 0 }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
  };
}

/* Crea un corte. General (sin ubicación): cuenta bodega y todas las móviles, uno por mes.
   Individual (con ubicación): cuenta solo una móvil o la bodega, por ejemplo cuando una móvil sale; se puede hacer en cualquier fecha. */
function crearCorteInvWeb(token, fecha, obs, ubicacion) {

  const ses = requerirSesion_(token, 'operador');
  fecha = segFecha_(fecha);
  if (!fecha) throw new Error('Fecha no válida.');
  ubicacion = txt_(ubicacion);

  return conBloqueo_(() => {
    const sh = invHoja_('CORTES');
    const l = leerObjetos_(sh);

    if (!ubicacion) {
      const id = fecha.slice(0, 7);
      if (l.some(o => txt_(o.Corte) === id)) throw new Error('Ya existe el corte general de inventario de ' + id + '. Para contar una sola móvil usa el conteo individual.');
      appendPorEncabezados_(sh, { Corte: id, Fecha: fecha, Estado: 'Abierto', Obs: txt_(obs).slice(0, 200), Usuario: ses.usuario, Creado: segAhora_(), Tipo: 'General', Ubicacion: '' });
      return { ok: true, corte: id };
    }

    let nombre = 'BODEGA';
    if (ubicacion !== 'BODEGA') {
      const m = segMapaMoviles_().porId[ubicacion];
      if (!m) throw new Error('No se encontró esa móvil.');
      nombre = 'M' + txt_(m.Movil);
    }
    /* El nombre no empieza con una fecha: así los ajustes de este corte nunca se confunden con los del general */
    let id = nombre + '_' + fecha, n = 1;
    while (l.some(o => txt_(o.Corte) === id)) { n++; id = nombre + '_' + fecha + '_' + n; }
    appendPorEncabezados_(sh, { Corte: id, Fecha: fecha, Estado: 'Abierto', Obs: txt_(obs).slice(0, 200) || 'Conteo individual', Usuario: ses.usuario, Creado: segAhora_(), Tipo: 'Individual', Ubicacion: ubicacion });
    return { ok: true, corte: id };
  });
}

/* Conteo de un corte: ubicaciones (bodega + móviles activas) x materiales */
function obtenerConteoInvWeb(token, corte) {

  requerirSesion_(token, 'consulta');
  corte = txt_(corte);

  const info = leerObjetos_(invHoja_('CORTES')).map(invCorteInfo_).find(c => c.corte === corte);
  if (!info) throw new Error('No se encontró el corte.');

  const conteo = leerObjetos_(invHoja_('CONTEO')).filter(r => txt_(r.Corte) === corte);
  const fisico = {}, teoricoGuardado = {}, justif = {};
  conteo.forEach(r => {
    const u = txt_(r.Ubicacion), c = txt_(r.Clave);
    if (txt_(r.Justificada) === 'Sí') (justif[u] = justif[u] || {})[c] = { motivo: txt_(r.Motivo), por: txt_(r.Justif_Por), fecha: txt_(r.Justif_Fecha) };
    (fisico[u] = fisico[u] || {})[c] = invNum_(r.Fisico);
    (teoricoGuardado[u] = teoricoGuardado[u] || {})[c] = invNum_(r.Teorico);
  });

  const teorico = info.estado === 'Cerrado' ? teoricoGuardado : invTeorico_(info.fecha);

  const mm = segMapaMoviles_();
  let ubic = [{ id: 'BODEGA', nombre: 'Bodega general', tecnico: '' }].concat(
    mm.moviles.filter(m => esActiva_(m) || fisico[String(m.ID_Movil)] || (info.tipo === 'Individual' && String(m.ID_Movil) === info.ubicacion))
      .sort((a, b) => (Number(a.Movil) || 0) - (Number(b.Movil) || 0))
      .map(m => ({ id: String(m.ID_Movil), nombre: 'M' + txt_(m.Movil), tecnico: txt_(m.Tecnico_Actual) })));
  if (info.tipo === 'Individual') ubic = ubic.filter(u => u.id === info.ubicacion);

  return { info: info, ubicaciones: ubic, materiales: invMateriales_().filter(m => m.activo || Object.keys(fisico).some(u => fisico[u][m.clave] !== undefined)),
    teorico: teorico, fisico: fisico, justif: justif };
}

/* Guarda lo contado: lista [{ubicacion, clave, fisico}]; fisico vacío = no contado */
function guardarConteoInvWeb(token, corte, lista) {

  requerirSesion_(token, 'operador');
  corte = txt_(corte);
  lista = lista || [];

  return conBloqueo_(() => {

    const info = leerObjetos_(invHoja_('CORTES')).map(invCorteInfo_).find(c => c.corte === corte);
    if (!info) throw new Error('No se encontró el corte.');
    if (info.estado === 'Cerrado') throw new Error('Este corte ya está cerrado. Un administrador puede reabrirlo.');

    const teorico = invTeorico_(info.fecha);
    const sh = invHoja_('CONTEO');
    const mapa = {};
    const otros = [];
    leerObjetos_(sh).forEach(r => {
      if (txt_(r.Corte) !== corte) { otros.push(invConteoFila_(r)); return; }
      mapa[txt_(r.Ubicacion) + '|' + txt_(r.Clave)] = invConteoFila_(r);
    });

    lista.forEach(x => {
      const u = txt_(x.ubicacion), c = txt_(x.clave);
      if (!u || !c) return;
      if (info.tipo === 'Individual' && u !== info.ubicacion) return;
      const k = u + '|' + c;
      if (x.fisico === '' || x.fisico === null || x.fisico === undefined) { delete mapa[k]; return; }
      const prev = mapa[k] || {};
      const nuevoFis = invRedondear_(invNum_(x.fisico));
      /* Si cambia lo contado, la justificación anterior ya no aplica */
      const igual = prev.Fisico !== undefined && Math.abs(prev.Fisico - nuevoFis) < 1e-9;
      mapa[k] = { Corte: corte, Ubicacion: u, Clave: c, Teorico: ((teorico[u] || {})[c]) || 0, Fisico: nuevoFis,
        Justificada: igual ? txt_(prev.Justificada) : '', Motivo: igual ? txt_(prev.Motivo) : '', Justif_Por: igual ? txt_(prev.Justif_Por) : '', Justif_Fecha: igual ? txt_(prev.Justif_Fecha) : '' };
    });

    invReescribir_(sh, 'CONTEO', otros.concat(Object.keys(mapa).map(k => mapa[k])));
    return { ok: true, contados: Object.keys(mapa).length };
  });
}

/* Justifica (o quita la justificación de) una diferencia del corte. Una diferencia justificada no se incluye en el documento de cobro.
   lista: [{ubicacion, clave, justificada: true/false, motivo}]. Se puede hacer con el corte abierto o cerrado. */
function justificarDiferenciaInvWeb(token, corte, lista) {

  const ses = requerirSesion_(token, 'admin');
  corte = txt_(corte);
  lista = lista || [];

  return conBloqueo_(() => {

    const sh = invHoja_('CONTEO');
    const todos = leerObjetos_(sh).map(invConteoFila_);
    const ahora = segAhora_();
    let n = 0;

    lista.forEach(x => {
      const f = todos.find(r => r.Corte === corte && r.Ubicacion === txt_(x.ubicacion) && r.Clave === txt_(x.clave));
      if (!f) throw new Error('Esa línea no está guardada en el corte. Guarda el conteo primero.');
      if (x.justificada) {
        if (f.Fisico - f.Teorico >= 0) throw new Error('Solo los faltantes se justifican; un sobrante no genera cobro.');
        const motivo = txt_(x.motivo).slice(0, 300);
        if (!motivo) throw new Error('Escribe el motivo de la justificación.');
        f.Justificada = 'Sí'; f.Motivo = motivo; f.Justif_Por = ses.usuario; f.Justif_Fecha = ahora;
      } else {
        f.Justificada = ''; f.Motivo = ''; f.Justif_Por = ''; f.Justif_Fecha = '';
      }
      n++;
    });

    invReescribir_(sh, 'CONTEO', todos);
    return { ok: true, cambiadas: n };
  });
}

/* Cierra el corte: lo contado pasa a ser el saldo real; las diferencias se ajustan con movimientos */
function cerrarCorteInvWeb(token, corte) {

  const ses = requerirSesion_(token, 'admin');
  corte = txt_(corte);

  return conBloqueo_(() => {

    const shC = invHoja_('CORTES');
    const tc = leerTabla_(shC);
    let fila = -1, info = null;
    for (let i = 1; i < tc.values.length; i++) {
      if (txt_(tc.values[i][tc.idx.Corte]) === corte) { fila = i; info = invCorteInfo_({ Corte: tc.values[i][tc.idx.Corte], Fecha: tc.values[i][tc.idx.Fecha], Estado: tc.values[i][tc.idx.Estado] }); break; }
    }
    if (!info) throw new Error('No se encontró el corte.');
    if (info.estado === 'Cerrado') throw new Error('Este corte ya está cerrado.');

    const sh = invHoja_('CONTEO');
    const todos = leerObjetos_(sh);
    const propios = todos.filter(r => txt_(r.Corte) === corte);
    if (!propios.length) throw new Error('No hay nada contado en este corte.');

    const teorico = invTeorico_(info.fecha);
    const mats = {};
    invMateriales_().forEach(m => { mats[m.clave] = m.material; });
    const mm = segMapaMoviles_();
    const ahora = segAhora_();

    let faltantes = 0, sobrantes = 0;
    const ajustes = [];
    const nuevoConteo = todos.map(r => {
      const o = invConteoFila_(r);
      if (o.Corte !== corte) return o;
      o.Teorico = ((teorico[o.Ubicacion] || {})[o.Clave]) || 0;
      const dif = invRedondear_(o.Fisico - o.Teorico);
      if (Math.abs(dif) > 1e-9) {
        if (dif < 0) faltantes++; else sobrantes++;
        const m = o.Ubicacion === 'BODEGA' ? null : mm.porId[o.Ubicacion];
        ajustes.push({
          Grupo: 'K-' + corte + '-' + o.Ubicacion, Fecha: info.fecha, Tipo: o.Ubicacion === 'BODEGA' ? 'AJ_BODEGA' : 'AJ_MOVIL',
          Clave: o.Clave, Material: mats[o.Clave] || o.Clave, Cantidad: dif,
          ID_Movil: m ? String(m.ID_Movil) : '', Movil: m ? txt_(m.Movil) : '',
          Referencia: 'Corte de inventario ' + corte, Obs: 'Ajuste por conteo físico', Usuario: ses.usuario, Creado: ahora
        });
      }
      return o;
    });

    invReescribir_(sh, 'CONTEO', nuevoConteo);
    invAgregar_(invHoja_('MOV'), 'MOV', ajustes);

    shC.getRange(fila + 1, tc.idx.Estado + 1).setValue('Cerrado');
    shC.getRange(fila + 1, tc.idx.Cerrado_Por + 1).setValue(ses.usuario);
    shC.getRange(fila + 1, tc.idx.Cerrado + 1).setValue(ahora);

    /* Verificación: el saldo actual del sistema contra lo contado. Solo puede diferir si hubo movimientos posteriores a la fecha del corte */
    const actual = invTeorico_('');
    const desv = [];
    nuevoConteo.forEach(o => {
      if (o.Corte !== corte) return;
      const sis = invRedondear_(((actual[o.Ubicacion] || {})[o.Clave]) || 0);
      if (Math.abs(sis - o.Fisico) > 1e-6) desv.push({ ubicacion: o.Ubicacion, material: mats[o.Clave] || o.Clave, sistema: sis, fisico: o.Fisico });
    });

    return { ok: true, contados: propios.length, ajustes: ajustes.length, faltantes: faltantes, sobrantes: sobrantes, desviaciones: desv.length, detalleDesv: desv.slice(0, 15) };
  });
}

/* Reabre el último corte cerrado: se borran sus ajustes y se puede volver a contar */
function reabrirCorteInvWeb(token, corte) {

  requerirSesion_(token, 'admin');
  corte = txt_(corte);

  return conBloqueo_(() => {

    const shC = invHoja_('CORTES');
    const tc = leerTabla_(shC);
    let fila = -1, fecha = '', tipo = 'General', ubic = '';
    const cerrados = [];
    for (let i = 1; i < tc.values.length; i++) {
      const c = txt_(tc.values[i][tc.idx.Corte]);
      const tp = txt_(tc.values[i][tc.idx.Tipo]) === 'Individual' ? 'Individual' : 'General', ub = txt_(tc.values[i][tc.idx.Ubicacion]);
      if (txt_(tc.values[i][tc.idx.Estado]) === 'Cerrado') cerrados.push({ corte: c, fecha: invFecha_(tc.values[i][tc.idx.Fecha]), tipo: tp, ubic: ub });
      if (c === corte) { fila = i; fecha = invFecha_(tc.values[i][tc.idx.Fecha]); tipo = tp; ubic = ub; }
    }
    if (fila < 0) throw new Error('No se encontró el corte.');
    if (txt_(tc.values[fila][tc.idx.Estado]) !== 'Cerrado') throw new Error('Este corte no está cerrado.');
    /* Solo se reabre si no hay un corte cerrado posterior que afecte las mismas ubicaciones */
    if (cerrados.some(o => o.corte !== corte && o.fecha > fecha && (o.tipo === 'General' || tipo === 'General' || o.ubic === ubic)))
      throw new Error('Solo se puede reabrir el último corte cerrado que afecta esas ubicaciones.');

    const shM = invHoja_('MOV');
    const tm = leerTabla_(shM);
    for (let i = tm.values.length - 1; i >= 1; i--) {
      if (txt_(tm.values[i][tm.idx.Grupo]).indexOf('K-' + corte + '-') === 0) shM.deleteRow(i + 1);
    }

    shC.getRange(fila + 1, tc.idx.Estado + 1).setValue('Abierto');
    shC.getRange(fila + 1, tc.idx.Cerrado_Por + 1).setValue('');
    shC.getRange(fila + 1, tc.idx.Cerrado + 1).setValue('');
    return { ok: true };
  });
}


/* Une los renglones de un inventario físico (código + descripción del formato de auditoría) con los materiales del sistema.
   lista: [{codigo, descripcion, clave}] — clave vacía = crear material nuevo.
   Guarda el código y la descripción como alias para que la próxima vez se reconozcan solos. */
function guardarMapeoInvWeb(token, lista) {

  requerirSesion_(token, 'operador');
  lista = lista || [];

  return conBloqueo_(() => {

    const sh = invHoja_('MAT');
    const t = leerTabla_(sh);
    const filaPorClave = {};
    for (let i = 1; i < t.values.length; i++) filaPorClave[txt_(t.values[i][t.idx.Clave])] = i;

    const mapa = {};
    const nuevas = [];
    let creados = 0, cambiados = false;
    let orden = t.values.length;

    lista.forEach(x => {
      const codigo = txt_(x.codigo).slice(0, 30);
      const desc = txt_(x.descripcion).replace(/\s+/g, ' ').slice(0, 120);
      if (!codigo && !desc) return;
      let clave = txt_(x.clave);

      if (!clave || filaPorClave[clave] === undefined) {
        clave = invClave_(desc || codigo);
        if (filaPorClave[clave] !== undefined || nuevas.some(n => n.Clave === clave)) clave = invClave_(codigo + ' ' + desc);
        if (filaPorClave[clave] === undefined && !nuevas.some(n => n.Clave === clave)) {
          orden++;
          nuevas.push({ Clave: clave, Material: desc || codigo, Unidad: txt_(x.unidad).slice(0, 12) || 'u', Minimo_Bodega: 0,
            Activo: 'Sí', Alias: '', Orden: orden, Codigo: codigo });
          creados++;
        }
        mapa[codigo || desc] = clave;
        return;
      }

      const i = filaPorClave[clave];
      const r = t.values[i];
      if (codigo) {
        /* Un material puede tener varios códigos (p. ej. el del PDF y el del control del cliente): se guardan separados por ; */
        const codigos = txt_(r[t.idx.Codigo]).split(';').map(a => txt_(a)).filter(a => a);
        if (codigos.indexOf(codigo) === -1) { codigos.push(codigo); r[t.idx.Codigo] = codigos.join(';').slice(0, 80); cambiados = true; }
      }
      if (desc) {
        const alias = txt_(r[t.idx.Alias]).split(';').map(a => txt_(a)).filter(a => a);
        const yaEsta = alias.some(a => invClave_(a) === invClave_(desc)) || invClave_(txt_(r[t.idx.Material])) === invClave_(desc);
        if (!yaEsta) { alias.push(desc); r[t.idx.Alias] = alias.join(';').slice(0, 400); cambiados = true; }
      }
      mapa[codigo || desc] = clave;
    });

    if (cambiados) sh.getRange(2, 1, t.values.length - 1, t.values[0].length).setValues(t.values.slice(1));
    invAgregar_(sh, 'MAT', nuevas);
    return { ok: true, mapa: mapa, creados: creados };
  });
}


/* ---------- Comparación con el control de inventario del cliente ---------- */

function invDiaAnterior_(iso) {
  const p = iso.split('-');
  const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) - 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

/* Por material, lo que dice el sistema (bodega + todas las móviles) en el rango, para cotejar con el control del cliente */
function compararClienteWeb(token, desde, hasta) {

  requerirSesion_(token, 'consulta');
  desde = segFecha_(desde);
  hasta = segFecha_(hasta);
  if (!desde || !hasta || desde > hasta) throw new Error('Indica un rango de fechas válido.');

  const movs = leerObjetos_(invHoja_('MOV'));
  const cons = leerObjetos_(invHoja_('CON'));
  const ini = invTeorico_(invDiaAnterior_(desde), movs, cons);
  const fin = invTeorico_(hasta, movs, cons);

  const R = {};
  const X = c => (R[c] = R[c] || { inicial: 0, ingresos: 0, consumo: 0, devProv: 0, ajustes: 0, final: 0, bodega: 0, moviles: 0 });

  Object.keys(ini).forEach(u => Object.keys(ini[u]).forEach(c => { X(c).inicial += ini[u][c]; }));
  Object.keys(fin).forEach(u => Object.keys(fin[u]).forEach(c => {
    const x = X(c);
    x.final += fin[u][c];
    if (u === 'BODEGA') x.bodega += fin[u][c]; else x.moviles += fin[u][c];
  }));

  movs.forEach(r => {
    const f = invFecha_(r.Fecha);
    if (f < desde || f > hasta) return;
    const c = txt_(r.Clave), q = invNum_(r.Cantidad), t = txt_(r.Tipo);
    if (!c) return;
    if (t === 'INGRESO') X(c).ingresos += q;
    else if (t === 'DEV_PROV') X(c).devProv += q;
    else if (t === 'AJ_BODEGA' || t === 'AJ_MOVIL') X(c).ajustes += q;
  });
  cons.forEach(r => {
    const f = invFecha_(r.Fecha);
    if (f < desde || f > hasta) return;
    const c = txt_(r.Clave);
    if (c) X(c).consumo += invNum_(r.Cantidad);
  });

  Object.keys(R).forEach(c => Object.keys(R[c]).forEach(k => { R[c][k] = invRedondear_(R[c][k]); }));
  return { desde: desde, hasta: hasta, materiales: R };
}


/* ---------- Catálogo oficial, stock base por móvil y unión de materiales ---------- */

/* lista: [{codigo, descripcion, objetivo}] — los materiales oficiales (los del inventario físico) */
function cargarCatalogoOficialWeb(token, lista, aplicarMoviles, desdeCero) {

  requerirSesion_(token, 'admin');
  lista = lista || [];
  if (!lista.length) throw new Error('No hay materiales para cargar.');

  return conBloqueo_(() => {

    invMateriales_();
    const sh = invHoja_('MAT');
    const t = leerTabla_(sh);
    const filaDe = {};
    for (let i = 1; i < t.values.length; i++) filaDe[txt_(t.values[i][t.idx.Clave])] = i;

    const buscar = (codigo, desc) => {
      for (let i = 1; i < t.values.length; i++) {
        const cods = txt_(t.values[i][t.idx.Codigo]).split(';').map(a => txt_(a));
        if (codigo && cods.indexOf(codigo) !== -1) return i;
      }
      const k = invClave_(desc);
      return filaDe[k] !== undefined ? filaDe[k] : -1;
    };

    const nuevas = [];
    let actualizados = 0, orden = 0;
    const base = {};
    const enLista = {};

    lista.forEach(x => {
      const codigo = txt_(x.codigo).slice(0, 30);
      const desc = txt_(x.descripcion).replace(/\s+/g, ' ').slice(0, 120);
      if (!desc) return;
      orden++;
      const obj = invNum_(x.objetivo);
      const i = buscar(codigo, desc);
      if (i >= 0) {
        const r = t.values[i];
        const viejo = txt_(r[t.idx.Material]);
        if (invClave_(viejo) !== invClave_(desc)) {
          const al = txt_(r[t.idx.Alias]).split(';').map(a => txt_(a)).filter(a => a);
          if (!al.some(a => invClave_(a) === invClave_(viejo))) al.push(viejo);
          r[t.idx.Alias] = al.join(';').slice(0, 400);
          r[t.idx.Material] = desc;
        }
        const cods = txt_(r[t.idx.Codigo]).split(';').map(a => txt_(a)).filter(a => a);
        if (codigo && cods.indexOf(codigo) === -1) cods.push(codigo);
        r[t.idx.Codigo] = cods.join(';').slice(0, 80);
        r[t.idx.Activo] = 'Sí';
        r[t.idx.Unidad] = /^(1-2-|2-1-)/.test(codigo) ? 'm' : 'u';
        if (!txt_(r[t.idx.Categoria])) r[t.idx.Categoria] = invCategoriaDe_(r[t.idx.Codigo], desc, '');
        r[t.idx.Orden] = orden;
        r[t.idx.Objetivo_Base] = obj;
        base[txt_(r[t.idx.Clave])] = obj;
        enLista[txt_(r[t.idx.Clave])] = true;
        actualizados++;
      } else {
        const clave = invClave_(desc);
        nuevas.push({ Clave: clave, Material: desc, Unidad: /^(1-2-|2-1-)/.test(codigo) ? 'm' : 'u', Minimo_Bodega: 0, Activo: 'Sí', Categoria: invCategoriaDe_(codigo, desc, ''),
          Alias: '', Orden: orden, Codigo: codigo, Objetivo_Base: obj });
        filaDe[clave] = -2;
        base[clave] = obj;
        enLista[clave] = true;
      }
    });

    sh.getRange(2, 1, t.values.length - 1, t.values[0].length).setValues(t.values.slice(1));
    invAgregar_(sh, 'MAT', nuevas);

    /* Empezar de cero: se eliminan los materiales que no están en la lista oficial, con todo lo que tengan registrado */
    let eliminados = 0;
    if (desdeCero) {
      const sobran = {};
      invMateriales_().forEach(m => { if (!enLista[m.clave]) sobran[m.clave] = true; });
      eliminados = Object.keys(sobran).length;
      if (eliminados) ['MAT', 'MOV', 'CON', 'OBJ', 'CONTEO'].forEach(k => invQuitarFilas_(invHoja_(k), r => sobran[r]));
    }

    let puestos = 0;
    if (aplicarMoviles !== false) puestos = invAplicarBase_(false).puestos;

    return { ok: true, creados: nuevas.length, actualizados: actualizados, objetivos: puestos, eliminados: eliminados };
  });
}

/* Quita de una hoja las filas cuya Clave cumpla el filtro (sin borrar fila por fila) */
function invQuitarFilas_(sh, esDeBorrar) {
  if (sh.getName() === INV.HOJAS.CON) invBumpCon_();
  const t = leerTabla_(sh);
  if (t.idx.Clave === undefined || t.values.length < 2) return 0;
  const quedan = t.values.slice(1).filter(r => !esDeBorrar(txt_(r[t.idx.Clave])));
  const quitadas = t.values.length - 1 - quedan.length;
  if (!quitadas) return 0;
  sh.getRange(2, 1, t.values.length - 1, t.values[0].length).clearContent();
  if (quedan.length) sh.getRange(2, 1, quedan.length, t.values[0].length).setValues(quedan);
  return quitadas;
}

/* Copia el stock base de cada material a las móviles activas que aún no tienen objetivo (o a todas, si sobrescribir) */
function invAplicarBase_(sobrescribir) {
  const mats = invMateriales_().filter(m => m.activo && m.base > 0);
  const sh = invHoja_('OBJ');
  const mapa = {};
  leerObjetos_(sh).forEach(o => {
    const m = txt_(o.ID_Movil), c = txt_(o.Clave);
    if (m && c) mapa[m + '|' + c] = { ID_Movil: m, Clave: c, Objetivo: invNum_(o.Objetivo) };
  });
  let puestos = 0;
  segMapaMoviles_().moviles.filter(esActiva_).forEach(mv => {
    const id = String(mv.ID_Movil);
    mats.forEach(m => {
      const k = id + '|' + m.clave;
      if (sobrescribir || !mapa[k]) { mapa[k] = { ID_Movil: id, Clave: m.clave, Objetivo: m.base }; puestos++; }
    });
  });
  invReescribir_(sh, 'OBJ', Object.keys(mapa).map(k => mapa[k]));
  return { puestos: puestos };
}

function aplicarObjetivoBaseWeb(token, sobrescribir) {
  requerirSesion_(token, 'admin');
  return conBloqueo_(() => Object.assign({ ok: true }, invAplicarBase_(!!sobrescribir)));
}

/* Une un material del reporte de gastos con el oficial: todo su historial pasa al oficial y su nombre queda como alias */
function unirMaterialInvWeb(token, origen, destino) {

  requerirSesion_(token, 'admin');
  origen = txt_(origen); destino = txt_(destino);
  if (!origen || !destino || origen === destino) throw new Error('Elige dos materiales distintos.');

  return conBloqueo_(() => {

    const sh = invHoja_('MAT');
    const t = leerTabla_(sh);
    let io = -1, id = -1;
    for (let i = 1; i < t.values.length; i++) {
      const c = txt_(t.values[i][t.idx.Clave]);
      if (c === origen) io = i;
      if (c === destino) id = i;
    }
    if (io < 0 || id < 0) throw new Error('No se encontró el material.');

    /* Nombre y alias del origen pasan al destino */
    const al = txt_(t.values[id][t.idx.Alias]).split(';').map(a => txt_(a)).filter(a => a);
    [txt_(t.values[io][t.idx.Material])].concat(txt_(t.values[io][t.idx.Alias]).split(';')).map(a => txt_(a)).filter(a => a).forEach(a => {
      if (!al.some(x => invClave_(x) === invClave_(a)) && invClave_(a) !== invClave_(txt_(t.values[id][t.idx.Material]))) al.push(a);
    });
    t.values[id][t.idx.Alias] = al.join(';').slice(0, 400);
    sh.getRange(id + 1, 1, 1, t.values[0].length).setValues([t.values[id]]);
    sh.deleteRow(io + 1);

    let filas = 0;
    ['MOV', 'CON', 'CONTEO'].forEach(k => {
      const h = invHoja_(k);
      const tt = leerTabla_(h);
      if (tt.idx.Clave === undefined) return;
      const vistos = {};
      /* En el conteo no puede haber dos filas del mismo corte/ubicación/material */
      if (k === 'CONTEO') for (let i = 1; i < tt.values.length; i++) if (txt_(tt.values[i][tt.idx.Clave]) === destino) vistos[txt_(tt.values[i][tt.idx.Corte]) + '|' + txt_(tt.values[i][tt.idx.Ubicacion])] = true;
      for (let i = tt.values.length - 1; i >= 1; i--) {
        if (txt_(tt.values[i][tt.idx.Clave]) !== origen) continue;
        if (k === 'CONTEO' && vistos[txt_(tt.values[i][tt.idx.Corte]) + '|' + txt_(tt.values[i][tt.idx.Ubicacion])]) { h.deleteRow(i + 1); continue; }
        h.getRange(i + 1, tt.idx.Clave + 1).setValue(destino);
        if (tt.idx.Material !== undefined) h.getRange(i + 1, tt.idx.Material + 1).setValue(txt_(t.values[id][t.idx.Material]));
        filas++;
      }
    });

    invBumpCon_();

    /* Objetivos: si la móvil ya tenía el del destino, se queda ese */
    const so = invHoja_('OBJ');
    const to = leerTabla_(so);
    const tiene = {};
    for (let i = 1; i < to.values.length; i++) if (txt_(to.values[i][to.idx.Clave]) === destino) tiene[txt_(to.values[i][to.idx.ID_Movil])] = true;
    for (let i = to.values.length - 1; i >= 1; i--) {
      if (txt_(to.values[i][to.idx.Clave]) !== origen) continue;
      if (tiene[txt_(to.values[i][to.idx.ID_Movil])]) so.deleteRow(i + 1);
      else so.getRange(i + 1, to.idx.Clave + 1).setValue(destino);
    }

    return { ok: true, filas: filas };
  });
}


/* Elimina materiales del catálogo junto con lo registrado de ellos (movimientos, consumo, objetivos, conteos) */
function eliminarMaterialesInvWeb(token, claves) {
  requerirSesion_(token, 'admin');
  const sobran = {};
  (claves || []).forEach(c => { if (txt_(c)) sobran[txt_(c)] = true; });
  const n = Object.keys(sobran).length;
  if (!n) throw new Error('No hay materiales para eliminar.');
  return conBloqueo_(() => {
    ['MAT', 'MOV', 'CON', 'OBJ', 'CONTEO'].forEach(k => invQuitarFilas_(invHoja_(k), r => sobran[r]));
    return { ok: true, eliminados: n };
  });
}


/* Historial de un material (kardex): cada movimiento y el consumo por día, con saldo acumulado de bodega y móviles */
function kardexMaterialWeb(token, clave) {

  requerirSesion_(token, 'consulta');
  clave = txt_(clave);
  if (!clave) throw new Error('Falta el material.');

  const ent = [];
  const trasl = {};
  leerObjetos_(invHoja_('MOV')).forEach(r => {
    if (txt_(r.Clave) !== clave) return;
    const t = txt_(r.Tipo), q = invNum_(r.Cantidad), g = txt_(r.Grupo);
    const base = { fecha: invFecha_(r.Fecha), creado: txt_(r.Creado), grupo: g, consecutivo: txt_(r.Consecutivo), referencia: txt_(r.Referencia),
      concepto: txt_(r.Concepto), movil: txt_(r.Movil), cantidad: q, linea: Number(r.Linea) || 0 };
    if (t === 'INGRESO') ent.push(Object.assign(base, { tipo: t, dB: q, dM: 0 }));
    else if (t === 'DEV_PROV') ent.push(Object.assign(base, { tipo: t, dB: -q, dM: 0 }));
    else if (t === 'ENTREGA') ent.push(Object.assign(base, { tipo: t, dB: -q, dM: q }));
    else if (t === 'DEV_MOVIL') ent.push(Object.assign(base, { tipo: t, dB: q, dM: -q }));
    else if (t === 'AJ_BODEGA') ent.push(Object.assign(base, { tipo: t, dB: q, dM: 0 }));
    else if (t === 'AJ_MOVIL') ent.push(Object.assign(base, { tipo: t, dB: 0, dM: q }));
    else if (t === 'TRAS_SALE') { base.tipo = 'TRASLADO'; base.dB = 0; base.dM = 0; trasl[g] = base; ent.push(base); }
    else if (t === 'TRAS_ENTRA') { if (trasl[g]) trasl[g].destino = txt_(r.Movil); }
  });

  const dias = {};
  leerObjetos_(invHoja_('CON')).forEach(r => {
    if (txt_(r.Clave) !== clave) return;
    const f = invFecha_(r.Fecha);
    const d = dias[f] = dias[f] || { fecha: f, creado: '9999', grupo: '', consecutivo: '', tipo: 'CONSUMO', referencia: '', concepto: '', movil: '', cantidad: 0, dB: 0, dM: 0, ots: {} };
    d.cantidad = invRedondear_(d.cantidad + invNum_(r.Cantidad));
    d.ots[txt_(r.N_Orden)] = true;
  });
  Object.keys(dias).forEach(f => { const d = dias[f]; d.dM = -d.cantidad; d.referencia = Object.keys(d.ots).length + ' OT'; delete d.ots; ent.push(d); });

  ent.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creado.localeCompare(b.creado));
  let b = 0, m = 0;
  ent.forEach(e => {
    b = invRedondear_(b + e.dB); m = invRedondear_(m + e.dM);
    e.saldoB = b; e.saldoM = m; e.saldo = invRedondear_(b + m);
  });

  const mat = invMateriales_().find(x => x.clave === clave) || {};
  return { clave: clave, material: mat.material || clave, codigo: mat.codigo || '', unidad: mat.unidad || '', bodega: b, moviles: m, total: invRedondear_(b + m), movimientos: ent };
}


/* =========================================================
   DIAGNÓSTICO DE RENDIMIENTO
   Se ejecuta a mano desde el editor de Apps Script (elige esta función y pulsa Ejecutar).
   Muestra en el registro cuánto pesa cada hoja y cuánto tarda leer lo más usado.
   ========================================================= */

function diagnosticarRendimiento() {
  const ss = obtenerSpreadsheet_();
  const t = (nombre, fn) => {
    const i = Date.now();
    let r = '';
    try { r = fn(); } catch (e) { r = 'ERROR ' + e.message; }
    Logger.log('  ' + nombre + ': ' + (Date.now() - i) + ' ms ' + (r === undefined ? '' : '(' + r + ')'));
  };

  Logger.log('== Hojas (filas x columnas) ==');
  ss.getSheets().forEach(sh => {
    const f = sh.getLastRow(), c = sh.getLastColumn();
    Logger.log('  ' + sh.getName() + ': ' + f + ' x ' + c + ' = ' + (f * c) + ' celdas');
  });

  Logger.log('== Tiempos de lectura ==');
  const hoy = segHoyISO_();
  const ayer = formatearFechaISO_(sumarDias_(new Date(), -1));
  t('Leer TODA la hoja de OT (como era antes)', () => leerObjetos_(segHoja_('OT')).length + ' filas');
  t('Leer solo las OT de hoy (ahora)', () => segLeer_('OT', hoy, hoy).length + ' filas');
  t('Leer TODO el consumo (como era antes)', () => leerObjetos_(invHoja_('CON')).length + ' filas');
  t('Totales de consumo (se recalcula)', () => { invBumpCon_(); return Object.keys(invConsumoTot_().tot).length + ' móviles'; });
  t('Totales de consumo (desde caché)', () => Object.keys(invConsumoTot_().tot).length + ' móviles');
  t('Movimientos de inventario', () => leerObjetos_(invHoja_('MOV')).length + ' filas');
  t('Registro del calendario (toda la hoja)', () => leerObjetos_(obtenerHoja_(CONFIG.HOJAS.REGISTRO)).length + ' filas');
  t('Registro del calendario (esta semana)', () => Object.keys(obtenerRegistroMapa_(sumarDias_(new Date(), -3), sumarDias_(new Date(), 3))).length + ' celdas');
  t('Móviles', () => obtenerMoviles_().length + ' filas');
  t('Historial de asignaciones', () => leerObjetos_(obtenerHoja_(CONFIG.HOJAS.ASIGNACIONES)).length + ' filas');
  Logger.log('Ver también: ayer = ' + ayer);
}



/* =========================================================
   COTIZACIONES
   Cotizaciones de trabajos (en dólares o colones): consecutivo automático, estados, clientes,
   catálogo de materiales, gastos del proyecto, orden de compra, facturación e informe con fotos.
   ========================================================= */

/* Todas las funciones de Cotizaciones exigen, además del rol, tener el módulo asignado */
function cotSesion_(token, minimo) {
  const ses = requerirSesion_(token, minimo);
  if ((ses.modulos || []).indexOf('cotizaciones') === -1) throw new Error('No tienes acceso al módulo de Cotizaciones.');
  return ses;
}

const COT = {

  HOJAS: { COT: 'COT_COTIZACIONES', LIN: 'COT_LINEAS', GAS: 'COT_GASTOS', FOT: 'COT_FOTOS', HIS: 'COT_HISTORIAL',
    CLI: 'COT_CLIENTES', MAT: 'COT_MATERIALES', DET: 'COT_DETALLE' },

  HEADERS: {
    COT: ['Cotizacion', 'Anio', 'Estado', 'Facturacion', 'Fecha', 'Cliente', 'Proyecto', 'Direccion', 'Correo', 'Telefono', 'Notas', 'Condiciones',
      'IVA_Pct', 'Otros', 'Subtotal', 'Iva', 'Total', 'Creado_Por', 'Creado', 'Modificado', 'Cambio_Estado', 'Estado_Previo',
      'Informe', 'Informe_Fecha', 'Informe_Usuario', 'OC_Numero', 'OC_Archivo', 'OC_Nombre', 'OC_Fecha', 'Num_Factura', 'Fecha_Factura', 'Obs', 'Archivada_Auto',
      'Moneda', 'TC', 'Contacto', 'Utilidad_Pct', 'Pago_Cliente', 'Fecha_Pago_Cliente', 'Ref_Pago'],
    LIN: ['Cotizacion', 'Linea', 'Codigo', 'Descripcion', 'Cantidad', 'Precio', 'Descuento', 'Origen'],
    GAS: ['Gasto', 'Cotizacion', 'Fecha', 'Categoria', 'Descripcion', 'Monto', 'Moneda', 'TC', 'Monto_USD', 'Usuario', 'Creado', 'Tipo', 'Colaborador', 'Pago', 'Fecha_Pago', 'Anulado', 'Motivo_Anulacion', 'Anulado_Por', 'Anulado_Fecha'],
    FOT: ['Foto', 'Cotizacion', 'Tipo', 'Archivo', 'Nombre', 'Usuario', 'Fecha_Hora'],
    HIS: ['Cotizacion', 'Fecha_Hora', 'Usuario', 'De', 'A', 'Nota'],
    CLI: ['ID', 'Nombre', 'Cedula', 'Contacto', 'Telefono', 'Correo', 'Direccion', 'Moneda', 'Notas', 'Activo'],
    MAT: ['ID', 'Material', 'Grupo', 'Unidad', 'Moneda', 'Costo', 'Con_IVA', 'Activo'],
    DET: ['Cotizacion', 'Linea', 'Material', 'Grupo', 'Unidad', 'Cantidad', 'Costo']
  },

  TEXTO: {
    COT: ['Cotizacion', 'Anio', 'Fecha', 'Telefono', 'Cambio_Estado', 'Estado_Previo', 'Informe_Fecha', 'OC_Numero', 'OC_Fecha', 'Num_Factura', 'Fecha_Factura', 'Fecha_Pago_Cliente', 'Ref_Pago'],
    LIN: ['Cotizacion', 'Codigo'],
    GAS: ['Gasto', 'Cotizacion', 'Fecha', 'Fecha_Pago', 'Anulado_Fecha'],
    FOT: ['Foto', 'Cotizacion', 'Fecha_Hora'],
    HIS: ['Cotizacion', 'Fecha_Hora'],
    CLI: ['ID', 'Cedula', 'Telefono'],
    MAT: ['ID', 'Unidad'],
    DET: ['Cotizacion']
  },

  /* Borrador (sin número, se puede editar y eliminar) y los cuatro estados principales.
     La facturación (pendiente / facturada) es un dato aparte de las finalizadas. */
  ESTADOS: { BORRADOR: 'Borrador', ENVIADA: 'Enviada', ACEPTADA: 'Aceptada', FINALIZADA: 'Finalizada', ARCHIVADA: 'Archivada' },

  /* De borrador solo se sale con «Enviar» (que asigna el número consecutivo) */
  TRANS: { BORRADOR: [], ENVIADA: ['ACEPTADA'], ACEPTADA: ['FINALIZADA', 'ENVIADA'], FINALIZADA: ['ACEPTADA'], ARCHIVADA: [] },

  /* Estados de versiones anteriores del módulo */
  LEGADO: { EN_PROCESO: 'ACEPTADA', RECHAZADA: 'ARCHIVADA' },

  /* Pasan solas a Archivada cuando llevan más de este tiempo sin cambiar de estado (solo Enviadas y Facturadas).
     Las Aceptadas y las finalizadas pendientes de facturar NO se archivan solas. */
  DIAS_ARCHIVO: 30,

  CATEGORIAS: ['Combustible', 'Mano de obra', 'Materiales', 'Viáticos', 'Alquiler de equipo', 'Subcontrato', 'Otros'],

  CONDICIONES: 'Total a pagar en 8 días. Cuentas vencidas sujetas a un cargo por servicios de 5% por mes vencido al mes. Basados en el artículo 460 del Código de Comercio de Costa Rica.',

  CARPETA: 'SRD - Cotizaciones',

  TC_DEFECTO: 520,

  /* [material, grupo, unidad, moneda, costo, con IVA] — de la hoja MATERIALES del Excel de cotizaciones */
  SEMILLA_MAT: [["Tubo EMT 3/4\"", "Materiales 3/4\"", "u", "CRC", 4200, "SI"], ["Trasición todo rosca", "Materiales 3/4\"", "u", "CRC", 550, "SI"], ["Caja metal 6x6", "Materiales 3/4\"", "u", "CRC", 6500, "SI"], ["Caja plastica plexo 15 X11 CM", "Materiales 3/4\"", "u", "CRC", 3000, "SI"], ["Conduleta tipo C 3/4\"", "Materiales 3/4\"", "u", "CRC", 1600, "SI"], ["Concetor EMT 3/4\"", "Materiales 3/4\"", "u", "CRC", 500, "SI"], ["Conduleta bota aguas 3/4\"", "Materiales 3/4\"", "u", "CRC", 1400, "SI"], ["Curva EMT 3/4\"", "Materiales 3/4\"", "u", "CRC", 600, "SI"], ["Gaza EMT 3/4\" 1 oreja", "Materiales 3/4\"", "u", "CRC", 125, "SI"], ["Gaza EMT 3/4\" 2 orejas", "Materiales 3/4\"", "u", "CRC", 125, "SI"], ["Gaza EMT 3/4\" p/ riel B line UL", "Materiales 3/4\"", "u", "CRC", 250, "SI"], ["Riel b-line perfil bajo", "Materiales 3/4\"", "u", "CRC", 5000, "SI"], ["Union EMT 3/4 \"", "Materiales 3/4\"", "u", "CRC", 500, "SI"], ["Mastil para antena", "Materiales 3/4\"", "u", "CRC", 35000, "SI"], ["Tubo Biex 3/4\" C/ forro UL mtrs", "Materiales 3/4\"", "u", "CRC", 1250, "SI"], ["Conector biex 3/4\"", "Materiales 3/4\"", "u", "CRC", 600, "SI"], ["Tubo Biex 3/4\" metalico", "Materiales 3/4\"", "u", "USD", 2.2, "NO"], ["Conector biex 3/4\" metalico", "Materiales 3/4\"", "u", "USD", 1, "NO"], ["Tubo 3/4\" CONDUIT PVC SCH 40", "Materiales 3/4\"", "u", "CRC", 2000, "SI"], ["Curva 3/4\" CONDUIT PVC", "Materiales 3/4\"", "u", "CRC", 650, "SI"], ["Conector 3/4\" CONDUIT PVC", "Materiales 3/4\"", "u", "CRC", 300, "SI"], ["Unión 3/4\" CONDUIT PVC", "Materiales 3/4\"", "u", "CRC", 200, "SI"], ["MATERIALES VARIOS", "Materiales 3/4\"", "u", "USD", 50, "NO"], ["Canaleta PVC 1\" pulgadas", "Materiales 3/4\"", "u", "CRC", 5000, "SI"], ["Accesorios", "Materiales 3/4\"", "u", "USD", 2, "NO"], ["barra todo rosca, peras,", "Materiales 3/4\"", "u", "USD", 100, "NO"], ["Tuberia EMT 1\"", "Materiales 1\"", "u", "CRC", 8500, "SI"], ["Tubo Biex 1\" C/ forro UL", "Materiales 1\"", "u", "CRC", 1900, "SI"], ["Union todo rosca 1¨", "Materiales 1\"", "u", "CRC", 1000, "SI"], ["Caja plastica plexo 1\"", "Materiales 1\"", "u", "CRC", 4000, "SI"], ["Caja reg. plastica 1\" 19 x 15 cm", "Materiales 1\"", "u", "CRC", 6500, "SI"], ["Concetor EMT 1\"", "Materiales 1\"", "u", "CRC", 600, "SI"], ["Conduleta tipo C 1\"", "Materiales 1\"", "u", "CRC", 2000, "SI"], ["Conduleta botagua 1\"", "Materiales 1\"", "u", "CRC", 1800, "SI"], ["Conector biex 1\"", "Materiales 1\"", "u", "CRC", 750, "SI"], ["Curva EMT 1\"", "Materiales 1\"", "u", "CRC", 1250, "SI"], ["Gaza EMT 1 oreja 1\" UL", "Materiales 1\"", "u", "CRC", 70, "SI"], ["Gazas p/ riel B line", "Materiales 1\"", "u", "CRC", 200, "SI"], ["Riel B line perfil bajo", "Materiales 1\"", "u", "CRC", 6000, "SI"], ["Union EMT 1\"", "Materiales 1\"", "u", "CRC", 600, "SI"], ["Unión 1\" CONDUIT PVC", "Materiales 1\"", "u", "CRC", 310, "SI"], ["Tubo 1\" CONDUIT PVC SCH 40", "Materiales 1\"", "u", "CRC", 4200, "SI"], ["Conector 1\" CONDUIT PVC", "Materiales 1\"", "u", "CRC", 600, "SI"], ["Curva 1\" CONDUIT PVC", "Materiales 1\"", "u", "CRC", 880, "SI"], ["Pegamento PVC", "Materiales 1\"", "u", "CRC", 5500, "SI"], ["Arena fina", "Materiales 1\"", "u", "CRC", 32000, "SI"], ["Bondex", "Materiales 1\"", "u", "CRC", 18000, "SI"], ["Varilla lisa p/ gancho", "Materiales 1\"", "u", "CRC", 10000, "SI"], ["MATERIALES VARIOS", "Materiales 1\"", "u", "USD", 200, "NO"], ["Tuberia EMT 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 14000, "SI"], ["Biex C/ forro UL 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 6000, "SI"], ["Caja cuadrada metal 8X8 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 7800, "SI"], ["Caja plastica plexo 22X 17 CM 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 8345, "SI"], ["Caja reg. plastica 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 4000, "SI"], ["Concetor 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 990, "SI"], ["Conduleta Botagua 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 2160, "SI"], ["Conduleta tipo C 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 3660, "SI"], ["Conector biex 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 2500, "SI"], ["Curva 1 1/2 \"", "Materiales 1-1/2\"", "u", "CRC", 2800, "SI"], ["Gaza 1oreja 1 1/2 \"", "Materiales 1-1/2\"", "u", "CRC", 250, "SI"], ["Gazas p riel 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 350, "SI"], ["Riel bilay perfil bajo", "Materiales 1-1/2\"", "u", "CRC", 5800, "SI"], ["Union 1 1/2\"", "Materiales 1-1/2\"", "u", "CRC", 990, "SI"], ["Unión 1 1/2\" CONDUIT PVC", "Materiales 1-1/2\"", "u", "CRC", 750, "SI"], ["Tubo 1 1/2 \" CONDUIT PVC", "Materiales 1-1/2\"", "u", "CRC", 6500, "SI"], ["Conector 1 1/2\" CONDUIT PVC", "Materiales 1-1/2\"", "u", "CRC", 750, "SI"], ["Curva 1 1/2\" CONDUIT PVC", "Materiales 1-1/2\"", "u", "CRC", 2000, "SI"], ["Pegamento PVC", "Materiales 1-1/2\"", "u", "CRC", 2500, "SI"], ["MATERIALES VARIOS", "Materiales 1-1/2\"", "u", "USD", 100, "NO"], ["Rollo de piola grande", "Materiales 1-1/2\"", "u", "USD", 6.25, "NO"], ["Duretan tubo", "Materiales 1-1/2\"", "u", "USD", 8, "NO"], ["Tornillos de techo 1/100", "Materiales 1-1/2\"", "u", "USD", 1, "NO"], ["Tuberia EMT 2\"", "Materiales 2\"", "u", "CRC", 14500, "SI"], ["Biex C/ forro UL 2\"", "Materiales 2\"", "u", "CRC", 6500, "SI"], ["Caja cuadrada metal 2\"", "Materiales 2\"", "u", "USD", 20, "NO"], ["Caja plastica plexo 2\"", "Materiales 2\"", "u", "CRC", 8500, "SI"], ["Conector 2\"", "Materiales 2\"", "u", "CRC", 2500, "SI"], ["Conduleta botagua 2\"", "Materiales 2\"", "u", "CRC", 4500, "SI"], ["Conduleta tipo C 2\"", "Materiales 2\"", "u", "CRC", 6500, "SI"], ["Conector biex 2\"", "Materiales 2\"", "u", "CRC", 2500, "SI"], ["Curva 2 \"", "Materiales 2\"", "u", "CRC", 4000, "SI"], ["Gaza 1oreja 2 \"", "Materiales 2\"", "u", "CRC", 300, "SI"], ["Gazas p riel 2\"", "Materiales 2\"", "u", "CRC", 500, "SI"], ["Riel bilay perfil bajo", "Materiales 2\"", "u", "CRC", 6000, "SI"], ["Union 2\"", "Materiales 2\"", "u", "CRC", 2500, "SI"], ["Tuberia EMT 1 1/4\"", "Materiales 1-1/4\"", "u", "USD", 26.37, "NO"], ["Biex C/ forro UL 1 1/4\"", "Materiales 1-1/4\"", "u", "USD", 11.3, "NO"], ["union todo rosca", "Materiales 1-1/4\"", "u", "USD", 6, "NO"], ["Caja plastica plexo 22X 17 CM 1 1/4\"", "Materiales 1-1/4\"", "u", "USD", 15.72, "NO"], ["Caja cuadrada metal 8X8 1 1/4\"", "Materiales 1-1/4\"", "u", "USD", 10, "NO"], ["Concetor 1 1/4\"", "Materiales 1-1/4\"", "u", "USD", 1.85, "NO"], ["Conduleta Botagua 1 1/4\"", "Materiales 1-1/4\"", "u", "USD", 4.1, "NO"], ["Conduleta tipo C 1 1/4\"", "Materiales 1-1/4\"", "u", "USD", 7, "NO"], ["Conector biex 1 1/4\"", "Materiales 1-1/4\"", "u", "USD", 4.75, "NO"], ["Curva 1 1/4 \"", "Materiales 1-1/4\"", "u", "USD", 6, "NO"], ["Gaza 1oreja 1 1/4 \"", "Materiales 1-1/4\"", "u", "USD", 0.75, "NO"], ["Gazas p riel 1 1/4\"", "Materiales 1-1/4\"", "u", "USD", 0.75, "NO"], ["Riel bilay perfil bajo", "Materiales 1-1/4\"", "u", "USD", 10.5, "NO"], ["Union 1 1/4\"", "Materiales 1-1/4\"", "u", "USD", 2.5, "NO"], ["Unión 1 1/4\" CONDUIT PVC", "Materiales 1-1/4\"", "u", "USD", 1.44, "NO"], ["Tubo 1 1/4 \" CONDUIT PVC", "Materiales 1-1/4\"", "u", "USD", 12.25, "NO"], ["Conector 1 1/4\" CONDUIT PVC", "Materiales 1-1/4\"", "u", "USD", 1.51, "NO"], ["Curva 1 1/4\" CONDUIT PVC", "Materiales 1-1/4\"", "u", "USD", 3.75, "NO"], ["Pegamento PVC", "Materiales 1-1/4\"", "u", "USD", 10, "NO"], ["MATERIALES VARIOS", "Materiales 1-1/4\"", "u", "USD", 100, "NO"], ["Rollo de piola grande", "Materiales 1-1/4\"", "u", "USD", 6.25, "NO"], ["Duretan tubo", "Materiales 1-1/4\"", "u", "USD", 8, "NO"], ["Tornillos de techo 1/100", "Materiales 1-1/4\"", "u", "USD", 1, "NO"]]
};

function cotEst_(e) {
  e = txt_(e);
  return COT.ESTADOS[e] ? e : (COT.LEGADO[e] || 'ENVIADA');
}

function cotHoja_(clave) {
  const ss = obtenerSpreadsheet_();
  const llave = 'cotok_' + clave + '_' + COT.HEADERS[clave].join('').length;
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  if (cache && cache.get(llave)) {
    const rapida = ss.getSheetByName(COT.HOJAS[clave]);
    if (rapida) return rapida;
  }
  const nueva = !ss.getSheetByName(COT.HOJAS[clave]);
  const sh = asegurarHoja_(ss, COT.HOJAS[clave], COT.HEADERS[clave]);
  formatearColumnasTexto_(sh, COT.TEXTO[clave]);
  if (nueva) {
    sh.getRange(1, 1, 1, COT.HEADERS[clave].length).setFontWeight('bold').setBackground('#b71c1c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  if (cache) { try { cache.put(llave, '1', 21600); } catch (e) { /* solo es más lento */ } }
  return sh;
}

function cotReescribir_(clave, filasObj) {
  const sh = cotHoja_(clave);
  const h = COT.HEADERS[clave];
  const ult = sh.getLastRow();
  if (ult > 1) sh.getRange(2, 1, ult - 1, Math.max(sh.getLastColumn(), h.length)).clearContent();
  if (!filasObj.length) return;
  sh.getRange(2, 1, filasObj.length, h.length).setValues(filasObj.map(o => h.map(n => (n in o ? o[n] : ''))));
}

function cotAgregar_(clave, filasObj) {
  if (!filasObj.length) return;
  const sh = cotHoja_(clave);
  const h = COT.HEADERS[clave];
  const fila = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(fila, 1, filasObj.length, h.length).setValues(filasObj.map(o => h.map(n => (n in o ? o[n] : ''))));
}

/* Copia de una fila leída de la hoja, lista para volver a escribirla */
function cotCopia_(clave, r) {
  const o = {};
  COT.HEADERS[clave].forEach(h => { o[h] = r[h] instanceof Date ? invFecha_(r[h]) : (r[h] === undefined ? '' : r[h]); });
  return o;
}

function cotHoy_() { return formatearFechaISO_(new Date()); }

function cotDias_(a, b) {
  const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  return Math.round((p(b) - p(a)) / 86400000);
}

function cotRed_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function cotMoneda_(m) { return txt_(m).toUpperCase() === 'CRC' ? 'CRC' : 'USD'; }

/* Un gasto expresado en la moneda de la cotización */
function cotGastoEn_(g, moneda) {
  const monto = invNum_(g.Monto), mg = cotMoneda_(g.Moneda), tc = invNum_(g.TC);
  if (mg === moneda) return monto;
  if (!(tc > 0)) return mg === 'CRC' ? invNum_(g.Monto_USD) : monto;
  return moneda === 'USD' ? monto / tc : monto * tc;
}

function cotFila_(o) {
  return {
    cotizacion: txt_(o.Cotizacion), anio: txt_(o.Anio), estado: cotEst_(o.Estado), facturacion: txt_(o.Facturacion),
    fecha: invFecha_(o.Fecha), cliente: txt_(o.Cliente), contacto: txt_(o.Contacto), proyecto: txt_(o.Proyecto), direccion: txt_(o.Direccion), correo: txt_(o.Correo),
    telefono: txt_(o.Telefono), notas: txt_(o.Notas), condiciones: txt_(o.Condiciones), ivaPct: o.IVA_Pct === '' ? 13 : invNum_(o.IVA_Pct),
    otros: invNum_(o.Otros), subtotal: invNum_(o.Subtotal), iva: invNum_(o.Iva), total: invNum_(o.Total),
    moneda: cotMoneda_(o.Moneda), tc: invNum_(o.TC) || COT.TC_DEFECTO, utilidadPct: invNum_(o.Utilidad_Pct),
    creadoPor: txt_(o.Creado_Por), creado: txt_(o.Creado), modificado: txt_(o.Modificado), cambioEstado: invFecha_(o.Cambio_Estado),
    estadoPrevio: txt_(o.Estado_Previo), informe: txt_(o.Informe), informeFecha: txt_(o.Informe_Fecha), informeUsuario: txt_(o.Informe_Usuario),
    ocNumero: txt_(o.OC_Numero), ocArchivo: txt_(o.OC_Archivo), ocNombre: txt_(o.OC_Nombre), ocFecha: txt_(o.OC_Fecha),
    numFactura: txt_(o.Num_Factura), fechaFactura: invFecha_(o.Fecha_Factura), pagoCliente: txt_(o.Pago_Cliente) === 'PAGADA' ? 'PAGADA' : '', fechaPagoCliente: invFecha_(o.Fecha_Pago_Cliente), refPago: txt_(o.Ref_Pago), obs: txt_(o.Obs), archivadaAuto: txt_(o.Archivada_Auto) === 'SI'
  };
}

function cotTotales_(lineas, ivaPct, otros) {
  let sub = 0;
  lineas.forEach(l => { sub += Math.max(0, invNum_(l.cantidad) * invNum_(l.precio) - invNum_(l.descuento)); });
  sub = cotRed_(sub);
  const iva = cotRed_(sub * (ivaPct / 100));
  return { subtotal: sub, iva: iva, total: cotRed_(sub + iva + invNum_(otros)) };
}

function cotBuscar_(num) {
  const sh = cotHoja_('COT');
  const t = leerTabla_(sh);
  for (let i = 1; i < t.values.length; i++) {
    if (txt_(t.values[i][t.idx.Cotizacion]) === txt_(num)) return { sh: sh, t: t, i: i };
  }
  throw new Error('No encontré la cotización ' + num + '.');
}

/* Cambia campos de una cotización (por nombre de columna) */
function cotActualizar_(f, cambios) {
  Object.keys(cambios).forEach(k => {
    if (f.t.idx[k] === undefined) throw new Error('Falta la columna ' + k + ' en COT_COTIZACIONES. Ejecuta "Configurar / reparar sistema".');
    f.t.values[f.i][f.t.idx[k]] = cambios[k];
  });
  f.t.values[f.i][f.t.idx.Modificado] = segAhora_();
  f.sh.getRange(f.i + 1, 1, 1, f.t.values[0].length).setValues([f.t.values[f.i]]);
}

function cotObjFila_(f) {
  const o = {};
  Object.keys(f.t.idx).forEach(k => { o[k] = f.t.values[f.i][f.t.idx[k]]; });
  return o;
}

function cotHistorial_(num, usuario, de, a, nota) {
  cotAgregar_('HIS', [{ Cotizacion: num, Fecha_Hora: segAhora_(), Usuario: usuario, De: de || '', A: a || '', Nota: nota || '' }]);
}

/* Consecutivo automático 1, 2, 3... (las cotizaciones viejas con formato de año, como 20260090, no cuentan) */
function cotSiguiente_() {
  const props = PropertiesService.getScriptProperties();
  let n = Number(props.getProperty('COT_CONSEC') || 0);
  const t = leerTabla_(cotHoja_('COT'));
  if (t.idx.Cotizacion !== undefined) {
    t.values.slice(1).forEach(r => { const v = Number(txt_(r[t.idx.Cotizacion])); if (v > 0 && v < 1000000) n = Math.max(n, v); });
  }
  n++;
  props.setProperty('COT_CONSEC', String(n));
  return String(n);
}

/* Pasan solas a Archivada solo las Enviadas que el cliente no contestó en más de un mes. Una cotización aceptada o finalizada nunca se archiva. */
function cotArchivarAuto_() {
  const hoy = cotHoy_();
  const toca = o => {
    const e = cotEst_(o.Estado), cambio = invFecha_(o.Cambio_Estado) || invFecha_(o.Fecha);
    if (!cambio || cotDias_(cambio, hoy) <= COT.DIAS_ARCHIVO) return false;
    return e === 'ENVIADA';   /* solo las que el cliente no contestó */
  };
  if (!leerObjetos_(cotHoja_('COT')).some(toca)) return 0;
  return conBloqueo_(() => {
    const f0 = cotHoja_('COT');
    const t = leerTabla_(f0);
    let n = 0;
    for (let i = 1; i < t.values.length; i++) {
      const o = {};
      Object.keys(t.idx).forEach(k => { o[k] = t.values[i][t.idx[k]]; });
      if (!toca(o)) continue;
      const num = txt_(o.Cotizacion), prev = cotEst_(o.Estado);
      t.values[i][t.idx.Estado_Previo] = prev;
      t.values[i][t.idx.Estado] = 'ARCHIVADA';
      t.values[i][t.idx.Cambio_Estado] = hoy;
      t.values[i][t.idx.Archivada_Auto] = 'SI';
      cotHistorial_(num, 'Sistema', prev, 'ARCHIVADA', 'Más de ' + COT.DIAS_ARCHIVO + ' días sin cambios');
      n++;
    }
    if (n) f0.getRange(2, 1, t.values.length - 1, t.values[0].length).setValues(t.values.slice(1));
    return n;
  });
}

/* ---------- Clientes ---------- */

function cotClienteFila_(r) {
  return { id: txt_(r.ID), nombre: txt_(r.Nombre), cedula: txt_(r.Cedula), contacto: txt_(r.Contacto), telefono: txt_(r.Telefono), correo: txt_(r.Correo),
    direccion: txt_(r.Direccion), moneda: cotMoneda_(r.Moneda), notas: txt_(r.Notas), activo: txt_(r.Activo) !== 'No' };
}

function cotClientes_() {
  const sh = cotHoja_('CLI');
  const props = PropertiesService.getScriptProperties();
  if (sh.getLastRow() < 2 && !props.getProperty('COT_CLI_SEMBRADO')) {
    cotAgregar_('CLI', [{ ID: 'C-001', Nombre: 'TELECABLE COSTA RICA, S.A.', Moneda: 'USD', Activo: 'Sí' }]);
    props.setProperty('COT_CLI_SEMBRADO', '1');
  }
  return leerObjetos_(cotHoja_('CLI')).map(cotClienteFila_).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function guardarClienteCotWeb(token, c) {
  cotSesion_(token, 'operador');
  c = c || {};
  const nombre = txt_(c.nombre).replace(/\s+/g, ' ').slice(0, 120);
  if (!nombre) throw new Error('Escribe el nombre del cliente.');
  return conBloqueo_(() => {
    const todos = leerObjetos_(cotHoja_('CLI'));
    if (todos.some(r => txt_(r.ID) !== txt_(c.id) && txt_(r.Nombre).toUpperCase() === nombre.toUpperCase())) throw new Error('Ya existe un cliente con ese nombre.');
    const fila = { ID: txt_(c.id), Nombre: nombre, Cedula: txt_(c.cedula).slice(0, 30), Contacto: txt_(c.contacto).slice(0, 80), Telefono: txt_(c.telefono).slice(0, 60),
      Correo: txt_(c.correo).slice(0, 120), Direccion: txt_(c.direccion).slice(0, 200), Moneda: cotMoneda_(c.moneda), Notas: txt_(c.notas).slice(0, 300), Activo: c.activo === false ? 'No' : 'Sí' };
    if (fila.ID) {
      cotReescribir_('CLI', todos.map(r => txt_(r.ID) === fila.ID ? fila : cotCopia_('CLI', r)));
    } else {
      let n = 0;
      todos.forEach(r => { const m = /(\d+)$/.exec(txt_(r.ID)); if (m) n = Math.max(n, Number(m[1])); });
      fila.ID = 'C-' + ('000' + (n + 1)).slice(-3);
      cotAgregar_('CLI', [fila]);
    }
    return { ok: true, id: fila.ID };
  });
}

function eliminarClienteCotWeb(token, id) {
  cotSesion_(token, 'admin');
  return conBloqueo_(() => {
    cotReescribir_('CLI', leerObjetos_(cotHoja_('CLI')).filter(r => txt_(r.ID) !== txt_(id)).map(r => cotCopia_('CLI', r)));
    return { ok: true };
  });
}

/* ---------- Catálogo de materiales ---------- */

function cotMatFila_(r) {
  return { id: txt_(r.ID), material: txt_(r.Material), grupo: txt_(r.Grupo), unidad: txt_(r.Unidad) || 'u', moneda: cotMoneda_(r.Moneda),
    costo: invNum_(r.Costo), conIva: txt_(r.Con_IVA) === 'SI', activo: txt_(r.Activo) !== 'No' };
}

function cotMateriales_() {
  const sh = cotHoja_('MAT');
  const props = PropertiesService.getScriptProperties();
  if (sh.getLastRow() < 2 && !props.getProperty('COT_MAT_SEMBRADO')) {
    cotAgregar_('MAT', COT.SEMILLA_MAT.map((m, i) => ({ ID: 'M-' + ('0000' + (i + 1)).slice(-4), Material: m[0], Grupo: m[1], Unidad: m[2], Moneda: m[3], Costo: m[4], Con_IVA: m[5], Activo: 'Sí' })));
    props.setProperty('COT_MAT_SEMBRADO', '1');
  }
  return leerObjetos_(cotHoja_('MAT')).map(cotMatFila_);
}

function cotMatObj_(m, id) {
  return { ID: id, Material: txt_(m.material).slice(0, 150), Grupo: txt_(m.grupo).slice(0, 60), Unidad: txt_(m.unidad).slice(0, 12) || 'u', Moneda: cotMoneda_(m.moneda),
    Costo: invNum_(m.costo), Con_IVA: m.conIva ? 'SI' : 'NO', Activo: m.activo === false ? 'No' : 'Sí' };
}

function guardarMaterialCotWeb(token, m) {
  cotSesion_(token, 'operador');
  m = m || {};
  if (!txt_(m.material)) throw new Error('Escribe el nombre del material.');
  return conBloqueo_(() => {
    const todos = leerObjetos_(cotHoja_('MAT'));
    let id = txt_(m.id);
    if (id) {
      cotReescribir_('MAT', todos.map(r => txt_(r.ID) === id ? cotMatObj_(m, id) : cotCopia_('MAT', r)));
    } else {
      let n = 0;
      todos.forEach(r => { const x = /(\d+)$/.exec(txt_(r.ID)); if (x) n = Math.max(n, Number(x[1])); });
      id = 'M-' + ('0000' + (n + 1)).slice(-4);
      cotAgregar_('MAT', [cotMatObj_(m, id)]);
    }
    return { ok: true, id: id };
  });
}

function eliminarMaterialCotWeb(token, id) {
  cotSesion_(token, 'operador');
  return conBloqueo_(() => {
    cotReescribir_('MAT', leerObjetos_(cotHoja_('MAT')).filter(r => txt_(r.ID) !== txt_(id)).map(r => cotCopia_('MAT', r)));
    return { ok: true };
  });
}

/* Importa una lista (la del Excel de cotizaciones u otra): agrega los nuevos y actualiza el costo de los que ya existen (mismo nombre y grupo) */
function importarMaterialesCotWeb(token, lista) {
  cotSesion_(token, 'operador');
  lista = lista || [];
  if (!lista.length) throw new Error('No encontré materiales en el archivo.');
  return conBloqueo_(() => {
    const todos = leerObjetos_(cotHoja_('MAT')).map(r => cotCopia_('MAT', r));
    const llave = (n, g) => invClave_(n) + '|' + invClave_(g);
    const porLlave = {};
    let n = 0;
    todos.forEach((r, i) => { porLlave[llave(r.Material, r.Grupo)] = i; const x = /(\d+)$/.exec(txt_(r.ID)); if (x) n = Math.max(n, Number(x[1])); });
    let nuevos = 0, actualizados = 0;
    lista.forEach(m => {
      if (!txt_(m.material)) return;
      const k = llave(m.material, m.grupo);
      if (porLlave[k] !== undefined) { const o = cotMatObj_(m, todos[porLlave[k]].ID); todos[porLlave[k]] = o; actualizados++; }
      else { n++; porLlave[k] = todos.length; todos.push(cotMatObj_(m, 'M-' + ('0000' + n).slice(-4))); nuevos++; }
    });
    cotReescribir_('MAT', todos);
    PropertiesService.getScriptProperties().setProperty('COT_MAT_SEMBRADO', '1');
    return { ok: true, nuevos: nuevos, actualizados: actualizados };
  });
}

/* ---------- Cotizaciones ---------- */

function obtenerCotizacionesWeb(token) {

  cotSesion_(token, 'consulta');
  try { cotArchivarAuto_(); } catch (e) { /* el listado no debe fallar por esto */ }

  const cots = leerObjetos_(cotHoja_('COT')).map(cotFila_);
  const mon = {};
  cots.forEach(c => { mon[c.cotizacion] = c.moneda; });
  const gastos = {};
  leerObjetos_(cotHoja_('GAS')).forEach(g => {
    const k = txt_(g.Cotizacion);
    if (mon[k] && txt_(g.Tipo) !== 'ADELANTO' && txt_(g.Anulado) !== 'SI') gastos[k] = (gastos[k] || 0) + cotGastoEn_(g, mon[k]);
  });
  const fotos = {};
  leerObjetos_(cotHoja_('FOT')).forEach(g => { fotos[txt_(g.Cotizacion)] = (fotos[txt_(g.Cotizacion)] || 0) + 1; });
  cots.forEach(c => { c.gastos = cotRed_(gastos[c.cotizacion] || 0); c.nFotos = fotos[c.cotizacion] || 0; });

  /* Códigos y descripciones usados antes, con su último precio, para armar cotizaciones más rápido */
  const cat = {};
  leerObjetos_(cotHoja_('LIN')).forEach(l => {
    const d = txt_(l.Descripcion);
    if (d && txt_(l.Origen) !== 'MAT') cat[txt_(l.Codigo) + '|' + d.toUpperCase()] = { codigo: txt_(l.Codigo), descripcion: d, precio: invNum_(l.Precio) };
  });
  [['001-100-001', 'MATERIALES, ACCESORIOS Y MANO DE OBRA'], ['001-100-100', 'VIATICOS Y MOVILIZACION'],
    ['001-200-010', 'RENTA DE GRUA CON CANASTA'], ['001-200-015', 'RENTA DE ANDAMIOS']].forEach(b => { const k = b[0] + '|' + b[1]; if (!cat[k]) cat[k] = { codigo: b[0], descripcion: b[1], precio: 0 }; });

  const colab = {};
  leerObjetos_(cotHoja_('GAS')).forEach(g => { const n = txt_(g.Colaborador); if (n) colab[n] = true; });

  return {
    colaboradores: Object.keys(colab).sort(),
    cotizaciones: cots.sort((a, b) => { const r = c => c.estado === 'BORRADOR' ? Infinity : (Number(c.cotizacion) || 0); return (r(a) === r(b) ? 0 : r(b) - r(a)) || b.cotizacion.localeCompare(a.cotizacion); }),
    estados: COT.ESTADOS, trans: COT.TRANS, categorias: COT.CATEGORIAS, condiciones: COT.CONDICIONES, diasArchivo: COT.DIAS_ARCHIVO,
    catalogo: Object.keys(cat).map(k => cat[k]).slice(0, 400),
    clientes: cotClientes_(), materiales: cotMateriales_(),
    tcDefecto: COT.TC_DEFECTO,
    ultimoConsec: Number(PropertiesService.getScriptProperties().getProperty('COT_CONSEC') || 0)
  };
}

function obtenerCotizacionWeb(token, num) {

  cotSesion_(token, 'consulta');
  num = txt_(num);
  const c = cotFila_(cotObjFila_(cotBuscar_(num)));
  const por = (clave, campo) => leerObjetos_(cotHoja_(clave)).filter(r => txt_(r[campo]) === num);

  c.lineas = por('LIN', 'Cotizacion').sort((a, b) => invNum_(a.Linea) - invNum_(b.Linea))
    .map(l => ({ codigo: txt_(l.Codigo), descripcion: txt_(l.Descripcion), cantidad: invNum_(l.Cantidad), precio: invNum_(l.Precio), descuento: invNum_(l.Descuento), origen: txt_(l.Origen) }));
  c.detalle = por('DET', 'Cotizacion').sort((a, b) => invNum_(a.Linea) - invNum_(b.Linea))
    .map(d => ({ material: txt_(d.Material), grupo: txt_(d.Grupo), unidad: txt_(d.Unidad), cantidad: invNum_(d.Cantidad), costo: invNum_(d.Costo) }));
  c.listaGastos = por('GAS', 'Cotizacion').map(g => ({ id: txt_(g.Gasto), fecha: invFecha_(g.Fecha), categoria: txt_(g.Categoria), descripcion: txt_(g.Descripcion),
    monto: invNum_(g.Monto), moneda: cotMoneda_(g.Moneda), tc: invNum_(g.TC), montoCot: cotRed_(cotGastoEn_(g, c.moneda)), usuario: txt_(g.Usuario),
    tipo: txt_(g.Tipo) === 'ADELANTO' ? 'ADELANTO' : 'GASTO', colaborador: txt_(g.Colaborador), pago: txt_(g.Pago) === 'CANCELADO' ? 'CANCELADO' : 'PENDIENTE', fechaPago: invFecha_(g.Fecha_Pago),
    anulado: txt_(g.Anulado) === 'SI', motivoAnulacion: txt_(g.Motivo_Anulacion), anuladoPor: txt_(g.Anulado_Por), anuladoFecha: txt_(g.Anulado_Fecha) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  c.fotos = por('FOT', 'Cotizacion').map(f => ({ id: txt_(f.Foto), tipo: txt_(f.Tipo), archivo: txt_(f.Archivo), nombre: txt_(f.Nombre), usuario: txt_(f.Usuario), hora: txt_(f.Fecha_Hora) }));
  c.historial = por('HIS', 'Cotizacion').map(h => ({ hora: txt_(h.Fecha_Hora), usuario: txt_(h.Usuario), de: txt_(h.De), a: txt_(h.A), nota: txt_(h.Nota) }))
    .reverse();   /* lo más reciente primero (las filas se agregan en orden) */
  c.gastos = cotRed_(c.listaGastos.filter(g => g.tipo !== 'ADELANTO' && !g.anulado).reduce((s, g) => s + g.montoCot, 0));   /* los adelantos no son un gasto más: se descuentan de lo que se le debe al colaborador */
  return c;
}

/* Crea o actualiza una cotización. Una vez aceptada solo la edita el administrador. */
function guardarCotizacionWeb(token, cot, lineas, detalle) {

  const ses = cotSesion_(token, 'operador');
  cot = cot || {};
  lineas = (lineas || []).filter(l => txt_(l.descripcion) || txt_(l.codigo));
  detalle = (detalle || []).filter(d => txt_(d.material) && invNum_(d.cantidad) > 0);
  if (!txt_(cot.cliente)) throw new Error('Elige o escribe el cliente.');
  if (!lineas.length) throw new Error('Agrega al menos una línea a la cotización.');
  const ivaPct = cot.ivaPct === '' || cot.ivaPct == null ? 13 : invNum_(cot.ivaPct);
  const tot = cotTotales_(lineas, ivaPct, cot.otros);
  const moneda = cotMoneda_(cot.moneda), tc = invNum_(cot.tc) > 0 ? invNum_(cot.tc) : COT.TC_DEFECTO;

  return conBloqueo_(() => {

    let num = txt_(cot.cotizacion);
    const fecha = invFecha_(cot.fecha) || cotHoy_();
    const comunes = {
      Fecha: fecha, Cliente: txt_(cot.cliente), Contacto: txt_(cot.contacto), Proyecto: txt_(cot.proyecto), Direccion: txt_(cot.direccion), Correo: txt_(cot.correo),
      Telefono: txt_(cot.telefono), Notas: txt_(cot.notas), Condiciones: txt_(cot.condiciones) || COT.CONDICIONES, IVA_Pct: ivaPct, Otros: invNum_(cot.otros),
      Subtotal: tot.subtotal, Iva: tot.iva, Total: tot.total, Obs: txt_(cot.obs).slice(0, 1000), Moneda: moneda, TC: tc, Utilidad_Pct: invNum_(cot.utilidadPct)
    };

    if (!num) {
      /* Los borradores llevan una clave interna (B...) y NO gastan número consecutivo: el número se asigna al enviarla */
      num = 'B' + Date.now().toString(36).toUpperCase();
      cotAgregar_('COT', [Object.assign({
        Cotizacion: num, Anio: fecha.slice(0, 4), Estado: 'BORRADOR', Facturacion: '', Creado_Por: ses.usuario, Creado: segAhora_(), Modificado: segAhora_(), Cambio_Estado: cotHoy_()
      }, comunes)]);
      cotHistorial_(num, ses.usuario, '', 'BORRADOR', 'Borrador creado');
    } else {
      const f = cotBuscar_(num);
      const estado = cotEst_(f.t.values[f.i][f.t.idx.Estado]);
      if (estado !== 'BORRADOR')
        throw new Error('La cotización ya fue enviada y no se puede modificar. Si hay un error, archívala y crea una nueva.');
      cotActualizar_(f, comunes);
    }

    const otras = leerObjetos_(cotHoja_('LIN')).filter(l => txt_(l.Cotizacion) !== num).map(l => cotCopia_('LIN', l));
    cotReescribir_('LIN', otras.concat(lineas.map((l, i) => ({
      Cotizacion: num, Linea: i + 1, Codigo: txt_(l.codigo).slice(0, 30), Descripcion: txt_(l.descripcion).slice(0, 300),
      Cantidad: invNum_(l.cantidad), Precio: invNum_(l.precio), Descuento: invNum_(l.descuento), Origen: txt_(l.origen) === 'MAT' ? 'MAT' : ''
    }))));

    const otrosDet = leerObjetos_(cotHoja_('DET')).filter(d => txt_(d.Cotizacion) !== num).map(d => cotCopia_('DET', d));
    cotReescribir_('DET', otrosDet.concat(detalle.map((d, i) => ({
      Cotizacion: num, Linea: i + 1, Material: txt_(d.material).slice(0, 150), Grupo: txt_(d.grupo).slice(0, 60), Unidad: txt_(d.unidad).slice(0, 12),
      Cantidad: invNum_(d.cantidad), Costo: invNum_(d.costo)
    }))));

    return { ok: true, cotizacion: num, subtotal: tot.subtotal, iva: tot.iva, total: tot.total };
  });
}

function cambiarEstadoCotWeb(token, num, nuevo, datos) {

  const ses = cotSesion_(token, 'operador');
  num = txt_(num); nuevo = txt_(nuevo); datos = datos || {};
  if (!COT.ESTADOS[nuevo]) throw new Error('Estado no válido.');

  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    const o = cotObjFila_(f);
    const actual = cotEst_(o.Estado);
    const admin = ses.rol === 'admin';

    if (actual === 'BORRADOR') throw new Error('Un borrador se envía con el botón «Enviar» (así recibe su número).');
    if (nuevo === 'BORRADOR') throw new Error('Una cotización enviada no puede volver a borrador.');
    if (actual === nuevo && txt_(o.Estado) === nuevo) return { ok: true, estado: nuevo };
    if (actual === 'ACEPTADA' && nuevo === 'ENVIADA') {
      /* Si ya hay trabajo registrado no puede devolverse a «enviada» (sería la puerta para archivar algo ya aceptado) */
      const hay = leerObjetos_(cotHoja_('GAS')).some(r => txt_(r.Cotizacion) === num) || leerObjetos_(cotHoja_('FOT')).some(r => txt_(r.Cotizacion) === num) || txt_(o.Informe) || txt_(o.OC_Numero);
      if (hay) throw new Error('Ya tiene gastos, informe, fotos u orden de compra: no puede volver a «enviada».');
    }
    if ((COT.TRANS[actual] || []).indexOf(nuevo) === -1 && !admin)
      throw new Error('No se puede pasar de «' + COT.ESTADOS[actual] + '» a «' + COT.ESTADOS[nuevo] + '».');
    if (nuevo === 'ARCHIVADA') throw new Error('Usa la opción Archivar.');

    const cambios = { Estado: nuevo, Cambio_Estado: cotHoy_() };

    if (nuevo === 'FINALIZADA') {
      const informe = txt_(datos.informe) || txt_(o.Informe);
      if (!informe) throw new Error('Para finalizar el trabajo escribe el informe: qué se realizó.');
      cambios.Informe = informe;
      cambios.Informe_Fecha = segAhora_();
      cambios.Informe_Usuario = ses.usuario;
      cambios.Facturacion = txt_(o.Facturacion) === 'FACTURADA' ? 'FACTURADA' : 'PENDIENTE';
    }
    if (actual === 'FINALIZADA' && nuevo !== 'FINALIZADA') {
      if (txt_(o.Facturacion) === 'FACTURADA' && !admin) throw new Error('Ya está facturada: solo el administrador puede reabrirla.');
      cambios.Facturacion = '';
      cambios.Num_Factura = ''; cambios.Fecha_Factura = '';
    }

    cotActualizar_(f, cambios);
    cotHistorial_(num, ses.usuario, actual, nuevo, txt_(datos.nota));
    return { ok: true, estado: nuevo };
  });
}

function cotCarpeta_() {
  const it = DriveApp.getFoldersByName(COT.CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(COT.CARPETA);
}

function cotGuardarArchivo_(nombre, mime, base64) {
  if (!base64) throw new Error('El archivo llegó vacío.');
  if (String(base64).length > 14 * 1024 * 1024) throw new Error('El archivo es muy pesado (máximo ~10 MB).');
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || 'application/octet-stream', nombre);
  return cotCarpeta_().createFile(blob).getId();
}

function cotSiguienteFoto_() {
  const props = PropertiesService.getScriptProperties();
  let n = Number(props.getProperty('COT_FOTO') || 0);
  leerObjetos_(cotHoja_('FOT')).forEach(r => { const m = /(\d+)$/.exec(txt_(r.Foto)); if (m) n = Math.max(n, Number(m[1])); });
  n++;
  props.setProperty('COT_FOTO', String(n));
  return 'F-' + ('00000' + n).slice(-5);
}

/* Foto del informe de trabajo (el navegador ya la envía reducida) */
/* El informe y las fotos se cargan cuando el cliente ya aceptó (durante o después del trabajo) */
function cotInformeOk_(f) {
  const e = cotEst_(f.t.values[f.i][f.t.idx.Estado]);
  if (e === 'BORRADOR' || e === 'ENVIADA') throw new Error('Esto se carga cuando la cotización ya fue aceptada por el cliente.');
}

function subirFotoCotWeb(token, num, nombre, mime, base64) {

  const ses = cotSesion_(token, 'operador');
  num = txt_(num);
  return conBloqueo_(() => {
    cotInformeOk_(cotBuscar_(num));
    const id = cotSiguienteFoto_();
    const limpio = txt_(nombre).replace(/[^\w.\- ]+/g, '_').slice(0, 60) || 'foto.jpg';
    const archivo = cotGuardarArchivo_('Cot' + num + '_' + id + '_' + limpio, mime || 'image/jpeg', base64);
    cotAgregar_('FOT', [{ Foto: id, Cotizacion: num, Tipo: 'INFORME', Archivo: archivo, Nombre: limpio, Usuario: ses.usuario, Fecha_Hora: segAhora_() }]);
    return { ok: true, id: id };
  });
}

function eliminarFotoCotWeb(token, num, idFoto) {
  cotSesion_(token, 'operador');
  return conBloqueo_(() => {
    const todas = leerObjetos_(cotHoja_('FOT'));
    const esLa = r => txt_(r.Cotizacion) === txt_(num) && txt_(r.Foto) === txt_(idFoto);
    const borrada = todas.filter(esLa)[0];
    cotReescribir_('FOT', todas.filter(r => !esLa(r)).map(r => cotCopia_('FOT', r)));
    if (borrada) { try { DriveApp.getFileById(txt_(borrada.Archivo)).setTrashed(true); } catch (e) { /* ya no estaba */ } }
    return { ok: true };
  });
}

/* Devuelve un archivo (foto u orden de compra) de Drive, solo si pertenece a una cotización */
function obtenerArchivoCotWeb(token, idArchivo) {

  cotSesion_(token, 'consulta');
  idArchivo = txt_(idArchivo);
  const esFoto = leerObjetos_(cotHoja_('FOT')).some(r => txt_(r.Archivo) === idArchivo);
  const esOC = leerObjetos_(cotHoja_('COT')).some(r => txt_(r.OC_Archivo) === idArchivo);
  if (!esFoto && !esOC) throw new Error('Archivo no encontrado.');
  const blob = DriveApp.getFileById(idArchivo).getBlob();
  return { nombre: blob.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

function guardarInformeCotWeb(token, num, texto) {
  const ses = cotSesion_(token, 'operador');
  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    cotInformeOk_(f);
    cotActualizar_(f, { Informe: txt_(texto), Informe_Fecha: segAhora_(), Informe_Usuario: ses.usuario });
    return { ok: true };
  });
}

/* ---------- Gastos del proyecto ---------- */

function guardarGastoCotWeb(token, num, g) {

  const ses = cotSesion_(token, 'operador');
  num = txt_(num); g = g || {};
  if (txt_(g.id)) throw new Error('Los gastos registrados no se editan: se anulan con su motivo y se registra uno nuevo.');
  const monto = invNum_(g.monto);
  if (!(monto > 0)) throw new Error('Escribe el monto del gasto.');
  const moneda = cotMoneda_(g.moneda);

  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    const estado = cotEst_(f.t.values[f.i][f.t.idx.Estado]);
    const monCot = cotMoneda_(f.t.values[f.i][f.t.idx.Moneda]);
    if (['ACEPTADA', 'FINALIZADA'].indexOf(estado) === -1)
      throw new Error('Los gastos se cargan cuando el trabajo está aceptado o finalizado.');
    const tipo = txt_(g.tipo) === 'ADELANTO' ? 'ADELANTO' : 'GASTO';
    const colaborador = txt_(g.colaborador).slice(0, 80);
    if (tipo === 'ADELANTO' && !colaborador) throw new Error('Indica a qué colaborador se le entregó el adelanto.');
    const pago = tipo === 'ADELANTO' ? 'CANCELADO' : (txt_(g.pago) === 'CANCELADO' ? 'CANCELADO' : 'PENDIENTE');
    const tc = moneda === monCot ? 1 : invNum_(g.tc);
    if (moneda !== monCot && !(tc > 0)) throw new Error('El gasto está en otra moneda que la cotización: escribe el tipo de cambio.');

    const todos = leerObjetos_(cotHoja_('GAS'));
    const id = txt_(g.id);
    const usd = moneda === 'USD' ? monto : (tc > 0 && tc !== 1 ? monto / tc : monto);
    const fila = {
      Gasto: id, Cotizacion: num, Fecha: invFecha_(g.fecha) || cotHoy_(), Categoria: tipo === 'ADELANTO' ? 'Adelanto' : (txt_(g.categoria) || 'Otros'), Descripcion: txt_(g.descripcion).slice(0, 200),
      Monto: monto, Moneda: moneda, TC: tc, Monto_USD: cotRed_(usd), Usuario: ses.usuario, Creado: segAhora_(),
      Tipo: tipo, Colaborador: colaborador, Pago: pago, Fecha_Pago: pago === 'CANCELADO' ? (invFecha_(g.fechaPago) || invFecha_(g.fecha) || cotHoy_()) : ''
    };
    if (id) {
      cotReescribir_('GAS', todos.map(r => txt_(r.Gasto) === id ? Object.assign(fila, { Usuario: txt_(r.Usuario), Creado: txt_(r.Creado) }) : cotCopia_('GAS', r)));
    } else {
      let n = 0;
      todos.forEach(r => { const m = /(\d+)$/.exec(txt_(r.Gasto)); if (m) n = Math.max(n, Number(m[1])); });
      fila.Gasto = 'G-' + ('00000' + (n + 1)).slice(-5);
      cotAgregar_('GAS', [fila]);
    }
    cotHistorial_(num, ses.usuario, '', '', (tipo === 'ADELANTO' ? 'Adelanto ' : 'Gasto ') + fila.Gasto + ' registrado: ' + monto + ' ' + moneda + (colaborador ? ' · ' + colaborador : '') + (tipo === 'GASTO' ? ' · ' + fila.Categoria : ''));
    return { ok: true, id: fila.Gasto };
  });
}

/* Marca un gasto como cancelado (pagado) o lo regresa a pendiente de pago */
function marcarPagoGastoCotWeb(token, num, id, pago, fechaPago) {
  const ses = cotSesion_(token, 'operador');
  return conBloqueo_(() => {
    const todos = leerObjetos_(cotHoja_('GAS'));
    const es = r => txt_(r.Cotizacion) === txt_(num) && txt_(r.Gasto) === txt_(id);
    const g = todos.filter(es)[0];
    if (!g) throw new Error('No encontré el gasto.');
    if (txt_(g.Anulado) === 'SI') throw new Error('Ese gasto está anulado.');
    if (txt_(g.Tipo) === 'ADELANTO') throw new Error('Un adelanto ya se entregó: no tiene estado de pago.');
    const cancelado = txt_(pago) === 'CANCELADO';
    /* Un gasto cancelado (pagado) queda cerrado: solo el administrador puede regresarlo a pendiente */
    if (!cancelado && ses.rol !== 'admin') throw new Error('Un gasto cancelado solo lo puede reabrir el administrador.');
    cotReescribir_('GAS', todos.map(r => { const o = cotCopia_('GAS', r); if (es(r)) { o.Pago = cancelado ? 'CANCELADO' : 'PENDIENTE'; o.Fecha_Pago = cancelado ? (invFecha_(fechaPago) || cotHoy_()) : ''; } return o; }));
    cotHistorial_(num, ses.usuario, '', '', 'Gasto ' + txt_(id) + (cancelado ? ' marcado como cancelado (pagado)' : ' reabierto: vuelve a pendiente de pago'));
    return { ok: true };
  });
}

/* Los gastos no se borran: el administrador los anula con motivo. Quedan visibles, no suman en los totales y registran quién y cuándo. */
function anularGastoCotWeb(token, num, id, motivo) {
  const ses = cotSesion_(token, 'admin');
  motivo = txt_(motivo);
  if (motivo.length < 3) throw new Error('Escribe el motivo de la anulación.');
  return conBloqueo_(() => {
    const todos = leerObjetos_(cotHoja_('GAS'));
    const es = r => txt_(r.Cotizacion) === txt_(num) && txt_(r.Gasto) === txt_(id);
    const g = todos.filter(es)[0];
    if (!g) throw new Error('No encontré el gasto.');
    if (txt_(g.Anulado) === 'SI') throw new Error('Ese gasto ya está anulado.');
    cotReescribir_('GAS', todos.map(r => { const o = cotCopia_('GAS', r); if (es(r)) { o.Anulado = 'SI'; o.Motivo_Anulacion = motivo.slice(0, 200); o.Anulado_Por = ses.usuario; o.Anulado_Fecha = segAhora_(); } return o; }));
    cotHistorial_(num, ses.usuario, '', '', 'Gasto ' + txt_(id) + ' ANULADO (' + invNum_(g.Monto) + ' ' + cotMoneda_(g.Moneda) + '): ' + motivo);
    return { ok: true };
  });
}

function eliminarGastoCotWeb() {
  throw new Error('Los gastos no se eliminan: el administrador los anula con su motivo.');
}

/* ---------- Orden de compra y facturación ---------- */

function guardarOCCotWeb(token, num, numero, nombre, mime, base64) {

  const ses = cotSesion_(token, 'operador');
  num = txt_(num);
  if (!txt_(numero)) throw new Error('Escribe el número de la orden de compra.');

  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    cotInformeOk_(f);
    const o = cotObjFila_(f);
    if (txt_(o.Facturacion) === 'FACTURADA' && ses.rol !== 'admin') throw new Error('Ya está facturada: solo el administrador puede cambiar la orden de compra.');
    let archivo = txt_(o.OC_Archivo), nom = txt_(o.OC_Nombre);
    if (base64) {
      if (archivo) { try { DriveApp.getFileById(archivo).setTrashed(true); } catch (e) { /* ya no estaba */ } }
      nom = txt_(nombre).replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'orden_de_compra';
      archivo = cotGuardarArchivo_('Cot' + num + '_OC_' + nom, mime, base64);
    }
    if (!archivo) throw new Error('Adjunta el archivo de la orden de compra (PDF o foto).');
    cotActualizar_(f, { OC_Numero: txt_(numero).slice(0, 60), OC_Archivo: archivo, OC_Nombre: nom, OC_Fecha: segAhora_() });
    cotHistorial_(num, ses.usuario, '', '', 'Orden de compra ' + txt_(numero) + ' cargada');
    return { ok: true };
  });
}

function facturarCotWeb(token, num, numFactura, fechaFactura) {

  const ses = cotSesion_(token, 'operador');
  num = txt_(num);
  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    const o = cotObjFila_(f);
    if (cotEst_(o.Estado) !== 'FINALIZADA') throw new Error('Solo se factura un trabajo finalizado.');
    if (!txt_(o.OC_Numero) || !txt_(o.OC_Archivo)) throw new Error('No se puede pasar a Facturada sin la orden de compra. Cárgala primero (número y archivo).');
    cotActualizar_(f, { Facturacion: 'FACTURADA', Num_Factura: txt_(numFactura).slice(0, 40), Fecha_Factura: invFecha_(fechaFactura) || cotHoy_(), Pago_Cliente: '', Fecha_Pago_Cliente: '', Ref_Pago: '', Cambio_Estado: cotHoy_() });
    cotHistorial_(num, ses.usuario, 'PENDIENTE', 'FACTURADA', txt_(numFactura) ? 'Factura ' + txt_(numFactura) : '');
    return { ok: true };
  });
}

/* Pago de la factura por parte del cliente (para el estado de cuenta de lo pendiente de cobrar) */
function registrarPagoFacturaCotWeb(token, num, fecha, ref) {
  const ses = cotSesion_(token, 'operador');
  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    const o = cotObjFila_(f);
    if (txt_(o.Facturacion) !== 'FACTURADA') throw new Error('Solo se registra el pago de una cotización ya facturada.');
    const dia = invFecha_(fecha) || cotHoy_();
    cotActualizar_(f, { Pago_Cliente: 'PAGADA', Fecha_Pago_Cliente: dia, Ref_Pago: txt_(ref).slice(0, 80), Cambio_Estado: cotHoy_() });
    cotHistorial_(num, ses.usuario, 'FACTURADA', 'PAGADA', 'Pago recibido el ' + dia + (txt_(ref) ? ' · ' + txt_(ref) : ''));
    return { ok: true };
  });
}

function revertirPagoFacturaCotWeb(token, num) {
  const ses = cotSesion_(token, 'admin');
  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    cotActualizar_(f, { Pago_Cliente: '', Fecha_Pago_Cliente: '', Ref_Pago: '', Cambio_Estado: cotHoy_() });
    cotHistorial_(num, ses.usuario, 'PAGADA', 'FACTURADA', 'Pago revertido');
    return { ok: true };
  });
}

function revertirFacturaCotWeb(token, num) {
  const ses = cotSesion_(token, 'admin');
  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    cotActualizar_(f, { Facturacion: 'PENDIENTE', Num_Factura: '', Fecha_Factura: '', Pago_Cliente: '', Fecha_Pago_Cliente: '', Ref_Pago: '', Cambio_Estado: cotHoy_() });
    cotHistorial_(num, ses.usuario, 'FACTURADA', 'PENDIENTE', 'Factura revertida');
    return { ok: true };
  });
}

/* ---------- Archivar ---------- */

function archivarCotWeb(token, num) {
  const ses = cotSesion_(token, 'operador');
  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    const actual = cotEst_(f.t.values[f.i][f.t.idx.Estado]);
    if (actual === 'ARCHIVADA') return { ok: true };
    if (actual === 'BORRADOR') throw new Error('Un borrador no se archiva: se envía o se elimina.');
    if (actual !== 'ENVIADA') throw new Error('Solo se archivan las cotizaciones enviadas a las que el cliente no respondió. Una cotización aceptada o finalizada no se archiva.');
    cotActualizar_(f, { Estado_Previo: actual, Estado: 'ARCHIVADA', Cambio_Estado: cotHoy_(), Archivada_Auto: '' });
    cotHistorial_(num, ses.usuario, actual, 'ARCHIVADA', 'Archivada manualmente');
    return { ok: true };
  });
}

function desarchivarCotWeb(token, num) {
  const ses = cotSesion_(token, 'operador');
  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    const prev = cotEst_(f.t.values[f.i][f.t.idx.Estado_Previo] || 'ENVIADA');
    cotActualizar_(f, { Estado: prev === 'ARCHIVADA' ? 'ENVIADA' : prev, Estado_Previo: '', Cambio_Estado: cotHoy_(), Archivada_Auto: '' });   /* el reloj de 30 días vuelve a empezar */
    cotHistorial_(num, ses.usuario, 'ARCHIVADA', prev, 'Desarchivada');
    return { ok: true, estado: prev };
  });
}

/* Envía un borrador: le asigna el siguiente número consecutivo y la deja bloqueada (ya no se edita) */
function enviarCotWeb(token, num) {
  const ses = cotSesion_(token, 'operador');
  num = txt_(num);
  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    if (cotEst_(f.t.values[f.i][f.t.idx.Estado]) !== 'BORRADOR') throw new Error('Esta cotización ya fue enviada.');
    const nuevo = cotSiguiente_();
    cotActualizar_(f, { Cotizacion: nuevo, Estado: 'ENVIADA', Cambio_Estado: cotHoy_() });
    ['LIN', 'DET', 'HIS'].forEach(k => {
      cotReescribir_(k, leerObjetos_(cotHoja_(k)).map(r => { const o = cotCopia_(k, r); if (txt_(o.Cotizacion) === num) o.Cotizacion = nuevo; return o; }));
    });
    cotHistorial_(nuevo, ses.usuario, 'BORRADOR', 'ENVIADA', 'Cotización enviada');
    return { ok: true, cotizacion: nuevo };
  });
}

/* Las cotizaciones no se eliminan: solo se archivan. La única excepción son los borradores (nunca tuvieron número). */
function eliminarCotizacionWeb(token, num) {
  cotSesion_(token, 'operador');
  num = txt_(num);
  return conBloqueo_(() => {
    const f = cotBuscar_(num);
    if (cotEst_(f.t.values[f.i][f.t.idx.Estado]) !== 'BORRADOR') throw new Error('Solo se pueden eliminar borradores. Las cotizaciones enviadas se archivan.');
    ['COT', 'LIN', 'GAS', 'HIS', 'FOT', 'DET'].forEach(k => {
      const campo = 'Cotizacion';
      cotReescribir_(k, leerObjetos_(cotHoja_(k)).filter(r => txt_(r[campo]) !== num).map(r => cotCopia_(k, r)));
    });
    return { ok: true };
  });
}

/* El administrador puede ajustar el último consecutivo usado (p. ej. para seguir el número de las cotizaciones hechas en Excel) */
function configurarConsecutivoCotWeb(token, ultimo) {
  cotSesion_(token, 'admin');
  ultimo = Math.floor(Number(ultimo));
  if (!(ultimo >= 0)) throw new Error('Escribe un número válido.');
  let max = 0;
  leerObjetos_(cotHoja_('COT')).forEach(r => { const v = Number(txt_(r.Cotizacion)); if (v > 0 && v < 1000000) max = Math.max(max, v); });
  if (ultimo < max) throw new Error('Ya existe la cotización ' + max + ': el último número no puede ser menor.');
  PropertiesService.getScriptProperties().setProperty('COT_CONSEC', String(ultimo));
  return { ok: true, siguiente: String(ultimo + 1) };
}


/* =====================================================================
   AJUSTES PARA EL NUEVO SERVIDOR (reemplazan funciones de arriba)
   ===================================================================== */

function conBloqueo_(fn) { return fn(); }   // el control de concurrencia lo hace la base de datos

function usuarioPorCorreo_(correo) {
  const c = String(correo || '').trim().toLowerCase();
  if (!c) return null;
  return leerObjetos_(obtenerHoja_(CONFIG.HOJAS.USUARIOS))
    .find(x => String(x.Correo || '').trim().toLowerCase() === c) || null;
}

/* Valida a quien llama (el correo ya fue verificado con Supabase) y su rol */
function requerirSesion_(token, minimo) {
  const reg = usuarioPorCorreo_(AUTH_EMAIL);
  if (!reg || String(reg.Activo) !== 'SI') throw new Error('SESION_EXPIRADA');
  const rol = String(reg.Rol || '').toLowerCase();
  if ((NIVEL_ROL[rol] || 0) < (NIVEL_ROL[minimo] || 99)) {
    throw new Error('No tienes permiso para realizar esta acción.');
  }
  return {
    usuario: normalizarUsuario_(reg.Usuario),
    nombre: String(reg.Nombre || reg.Usuario),
    rol: rol,
    modulos: modulosDe_(rol, reg.Modulos)
  };
}

/* Paso 1 del ingreso: encuentra el usuario por nombre de usuario o correo */
function loginPaso1_(entrada) {
  const e = String(entrada || '').trim().toLowerCase();
  const reg = e.indexOf('@') !== -1 ? usuarioPorCorreo_(e) : buscarUsuario_(e);
  if (!reg || String(reg.Activo) !== 'SI' || !String(reg.Correo || '').trim()) return null;
  const rol = String(reg.Rol || '').toLowerCase();
  const previo = (reg.Ultimo_Acceso instanceof Date && !isNaN(reg.Ultimo_Acceso))
    ? Utilities.formatDate(reg.Ultimo_Acceso, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : '';
  return {
    correo: String(reg.Correo).trim().toLowerCase(),
    usuario: normalizarUsuario_(reg.Usuario),
    nombre: String(reg.Nombre || reg.Usuario),
    rol: rol,
    modulos: modulosDe_(rol, reg.Modulos),
    foto: String(reg.Foto || ''),
    accesoPrevio: previo,
    cambiarClave: String(reg.Debe_Cambiar_Clave || '') === 'SI'
  };
}

/* Paso 2: anota el último acceso */
function loginPaso2_(usuario) {
  const reg = buscarUsuario_(usuario);
  if (!reg) return;
  const sh = obtenerHoja_(CONFIG.HOJAS.USUARIOS);
  const { idx } = leerTabla_(sh);
  sh.getRange(reg._fila, idx.Ultimo_Acceso + 1).setValue(new Date());
}

function refrescarWeb() { return null; }   // lo atiende el servidor antes de llegar aquí

function logoutWeb() { return { ok: true }; }

function cambiarClaveWeb(token, actual, nueva) {
  const ses = requerirSesion_(token, 'consulta');
  nueva = String(nueva || '');
  if (nueva.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  guardarUsuario_({ usuario: ses.usuario, clave: nueva, debeCambiar: false });
  return { ok: true };
}

/* Crea o actualiza un usuario. Las contraseñas las guarda Supabase Auth (nunca esta hoja). */
function guardarUsuario_(d) {

  const sh = obtenerHoja_(CONFIG.HOJAS.USUARIOS);
  asegurarColumnasHoja_(sh, CONFIG.HEADERS.USUARIOS);
  const { idx } = leerTabla_(sh);
  exigirColumnas_(idx, CONFIG.HEADERS.USUARIOS, 'USUARIOS');

  const u = normalizarUsuario_(d.usuario);
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) {
    throw new Error('El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.');
  }

  const existente = buscarUsuario_(u);

  const rol = String(d.rol || (existente ? existente.Rol : '')).toLowerCase();
  if (ROLES.indexOf(rol) === -1) throw new Error('Rol no válido.');

  const nombre = String(d.nombre || (existente ? existente.Nombre : '') || u).trim();
  const clave = d.clave ? String(d.clave) : '';

  if (clave && clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (!existente && !clave) throw new Error('Debes indicar una contraseña para el usuario nuevo.');

  const activo = (d.activo === undefined || d.activo === null)
    ? (existente ? String(existente.Activo) === 'SI' : true)
    : !!d.activo;

  const admins = leerObjetos_(sh).filter(x => {
    const esEste = normalizarUsuario_(x.Usuario) === u;
    const rolX = esEste ? rol : String(x.Rol).toLowerCase();
    const activoX = esEste ? activo : String(x.Activo) === 'SI';
    return rolX === 'admin' && activoX;
  }).length + ((!existente && rol === 'admin' && activo) ? 1 : 0);

  if (admins < 1) throw new Error('Debe quedar al menos un administrador activo.');

  const correo = d.correo ? String(d.correo).trim().toLowerCase()
    : (existente ? String(existente.Correo || '').trim().toLowerCase() : '');
  if ((clave || !activo || (existente && String(existente.Activo) === 'SI' && !activo)) && !correo) {
    throw new Error('El usuario necesita un correo para poder ingresar.');
  }

  if (!existente) {
    appendPorEncabezados_(sh, {
      Usuario: u, Nombre: nombre, Rol: rol, Salt: '', Hash: '',
      Activo: activo ? 'SI' : 'NO', Creado: new Date(), Ultimo_Acceso: '',
      Correo: correo, Debe_Cambiar_Clave: d.debeCambiar ? 'SI' : 'NO',
      Modulos: limpiarModulos_(d.modulos) || ''
    });
  } else {
    const fila = existente._fila;
    const set = (n, v) => sh.getRange(fila, idx[n] + 1).setValue(v);
    set('Nombre', nombre);
    set('Rol', rol);
    set('Activo', activo ? 'SI' : 'NO');
    if (d.correo) set('Correo', correo);
    if (d.debeCambiar !== undefined) set('Debe_Cambiar_Clave', d.debeCambiar ? 'SI' : 'NO');
    if (limpiarModulos_(d.modulos) !== undefined) set('Modulos', limpiarModulos_(d.modulos));
  }

  if (clave) REQ.efectos.push({ t: 'clave', correo: correo, clave: clave });
  if (existente && (String(existente.Activo) === 'SI') !== activo) REQ.efectos.push({ t: 'activo', correo: correo, activo: activo });

  return { ok: true, creado: !existente };
}

function prepararSistemaWeb(token) {

  requerirSesion_(token, 'admin');

  const ss = obtenerSpreadsheet_();

  migrarOMantenerMoviles_(ss);

  asegurarHoja_(ss, CONFIG.HOJAS.ASIGNACIONES, CONFIG.HEADERS.ASIGNACIONES);
  asegurarHoja_(ss, CONFIG.HOJAS.REGISTRO, CONFIG.HEADERS.REGISTRO);
  asegurarHoja_(ss, CONFIG.HOJAS.USUARIOS, CONFIG.HEADERS.USUARIOS);
  asegurarHoja_(ss, CONFIG.HOJAS.HISTORIAL, CONFIG.HEADERS.HISTORIAL);
  asegurarHoja_(ss, CONFIG.HOJAS.CAMBIOS, CONFIG.HEADERS.CAMBIOS);
  Object.keys(SEG.HOJAS).forEach(k => segHoja_(k));
  Object.keys(INV.HOJAS).forEach(k => invHoja_(k));
  prepararFormatosMoviles_();
  obtenerPepper_();

  asegurarHoja_(ss, CONFIG.HOJAS.LISTAS, [
    'Estados', '', 'Estados_Movil', '', 'Domicilios', '', 'Contratas', '', 'Año', 'Semana'
  ]);

  asegurarHoja_(ss, CONFIG.HOJAS.CALENDARIO, ['']);
  asegurarHoja_(ss, CONFIG.HOJAS.RESUMEN, ['Estado', 'Cantidad']);

  prepararListas_();
  generarSemanas_();
  sincronizarAsignacionesIniciales_();
  completarFichaAsignaciones_();
  actualizarCalendario_();
  actualizarResumen_();
  formatearHojas_();

  }

return {loginWeb: loginWeb, miPerfilWeb: miPerfilWeb, guardarFotoPerfilWeb: guardarFotoPerfilWeb, validarSesionWeb: validarSesionWeb, logoutWeb: logoutWeb, cambiarClaveWeb: cambiarClaveWeb, listarUsuariosWeb: listarUsuariosWeb, crearUsuarioWeb: crearUsuarioWeb, actualizarUsuarioWeb: actualizarUsuarioWeb, obtenerDatosWeb: obtenerDatosWeb, obtenerSemanasWeb: obtenerSemanasWeb, obtenerCalendarioWeb: obtenerCalendarioWeb, obtenerRotacionBackupWeb: obtenerRotacionBackupWeb, guardarCalendarioWeb: guardarCalendarioWeb, obtenerHistorialWeb: obtenerHistorialWeb, agregarMovilWeb: agregarMovilWeb, actualizarMovilWeb: actualizarMovilWeb, obtenerHistorialMovilWeb: obtenerHistorialMovilWeb, darDeBajaMovilWeb: darDeBajaMovilWeb, reactivarMovilWeb: reactivarMovilWeb, exportarCalendarioClienteExcelWeb: exportarCalendarioClienteExcelWeb, obtenerResumenWeb: obtenerResumenWeb, obtenerFichasWeb: obtenerFichasWeb, guardarFichasWeb: guardarFichasWeb, obtenerPersonalWeb: obtenerPersonalWeb, buscarPersonaWeb: buscarPersonaWeb, obtenerVehiculosWeb: obtenerVehiculosWeb, deshacerSinTecnicosWeb: deshacerSinTecnicosWeb, guardarSalidaPersonalWeb: guardarSalidaPersonalWeb, obtenerCambiosFichasWeb: obtenerCambiosFichasWeb, exportarFichasExcelWeb: exportarFichasExcelWeb, obtenerSeguimientoWeb: obtenerSeguimientoWeb, guardarJustificacionTiempoWeb: guardarJustificacionTiempoWeb, guardarSeguimientoWeb: guardarSeguimientoWeb, guardarAlmuerzoWeb: guardarAlmuerzoWeb, guardarSalidaWeb: guardarSalidaWeb, corregirCorteWeb: corregirCorteWeb, eliminarCorteWeb: eliminarCorteWeb, obtenerAusenciasWeb: obtenerAusenciasWeb, guardarAusenciaWeb: guardarAusenciaWeb, marcarPenalizacionWeb: marcarPenalizacionWeb, eliminarAusenciaWeb: eliminarAusenciaWeb, importarFinalizadasWeb: importarFinalizadasWeb, guardarSuspendidaWeb: guardarSuspendidaWeb, marcarSuspendidasWeb: marcarSuspendidasWeb, eliminarSuspendidaWeb: eliminarSuspendidaWeb, obtenerBodegaWeb: obtenerBodegaWeb, guardarAlistosWeb: guardarAlistosWeb, obtenerAlistosWeb: obtenerAlistosWeb, cambiarEstadoAlistoWeb: cambiarEstadoAlistoWeb, aplicarAlistoWeb: aplicarAlistoWeb, obtenerMovimientosInvWeb: obtenerMovimientosInvWeb, guardarMovimientoInvWeb: guardarMovimientoInvWeb, firmarMovimientoInvWeb: firmarMovimientoInvWeb, obtenerFirmaInvWeb: obtenerFirmaInvWeb, eliminarMovimientoInvWeb: eliminarMovimientoInvWeb, guardarObjetivosWeb: guardarObjetivosWeb, aplicarCostosAdendumWeb: aplicarCostosAdendumWeb, guardarMaterialInvWeb: guardarMaterialInvWeb, importarConsumoWeb: importarConsumoWeb, obtenerConsumoDetalleWeb: obtenerConsumoDetalleWeb, eliminarCargaConsumoWeb: eliminarCargaConsumoWeb, importarDevolucionesWeb: importarDevolucionesWeb, obtenerDevolucionesWeb: obtenerDevolucionesWeb, obtenerHistorialDevolucionWeb: obtenerHistorialDevolucionWeb, registrarDevolucionLineaWeb: registrarDevolucionLineaWeb, recibirLineasDevolucionWeb: recibirLineasDevolucionWeb, registrarBoletaDevolucionWeb: registrarBoletaDevolucionWeb, registrarEntregaMovilWeb: registrarEntregaMovilWeb, justificarDevolucionWeb: justificarDevolucionWeb, cambiarEquipoDevolucionWeb: cambiarEquipoDevolucionWeb, revertirDevolucionWeb: revertirDevolucionWeb, eliminarPeriodoDevolucionesWeb: eliminarPeriodoDevolucionesWeb, aceptarAlertasBodegaWeb: aceptarAlertasBodegaWeb, obtenerNotificacionesWeb: obtenerNotificacionesWeb, obtenerConsumoInvWeb: obtenerConsumoInvWeb, obtenerCortesInvWeb: obtenerCortesInvWeb, crearCorteInvWeb: crearCorteInvWeb, obtenerConteoInvWeb: obtenerConteoInvWeb, guardarConteoInvWeb: guardarConteoInvWeb, justificarDiferenciaInvWeb: justificarDiferenciaInvWeb, cerrarCorteInvWeb: cerrarCorteInvWeb, reabrirCorteInvWeb: reabrirCorteInvWeb, guardarMapeoInvWeb: guardarMapeoInvWeb, compararClienteWeb: compararClienteWeb, cargarCatalogoOficialWeb: cargarCatalogoOficialWeb, aplicarObjetivoBaseWeb: aplicarObjetivoBaseWeb, unirMaterialInvWeb: unirMaterialInvWeb, eliminarMaterialesInvWeb: eliminarMaterialesInvWeb, kardexMaterialWeb: kardexMaterialWeb, guardarClienteCotWeb: guardarClienteCotWeb, eliminarClienteCotWeb: eliminarClienteCotWeb, guardarMaterialCotWeb: guardarMaterialCotWeb, eliminarMaterialCotWeb: eliminarMaterialCotWeb, importarMaterialesCotWeb: importarMaterialesCotWeb, obtenerCotizacionesWeb: obtenerCotizacionesWeb, obtenerCotizacionWeb: obtenerCotizacionWeb, guardarCotizacionWeb: guardarCotizacionWeb, cambiarEstadoCotWeb: cambiarEstadoCotWeb, subirFotoCotWeb: subirFotoCotWeb, eliminarFotoCotWeb: eliminarFotoCotWeb, obtenerArchivoCotWeb: obtenerArchivoCotWeb, guardarInformeCotWeb: guardarInformeCotWeb, guardarGastoCotWeb: guardarGastoCotWeb, marcarPagoGastoCotWeb: marcarPagoGastoCotWeb, anularGastoCotWeb: anularGastoCotWeb, eliminarGastoCotWeb: eliminarGastoCotWeb, guardarOCCotWeb: guardarOCCotWeb, facturarCotWeb: facturarCotWeb, registrarPagoFacturaCotWeb: registrarPagoFacturaCotWeb, revertirPagoFacturaCotWeb: revertirPagoFacturaCotWeb, revertirFacturaCotWeb: revertirFacturaCotWeb, archivarCotWeb: archivarCotWeb, desarchivarCotWeb: desarchivarCotWeb, enviarCotWeb: enviarCotWeb, eliminarCotizacionWeb: eliminarCotizacionWeb, configurarConsecutivoCotWeb: configurarConsecutivoCotWeb, loginPaso1_: loginPaso1_, loginPaso2_: loginPaso2_, refrescarWeb: refrescarWeb, prepararSistemaWeb: prepararSistemaWeb};
})();

/* =====================================================================
   Acceso a Supabase, carga/guardado de hojas y atención de /api
   ===================================================================== */
function claveSecreta_() { return ENV.SUPABASE_SECRET; }
function clavePublica_() { return ENV.SUPABASE_PUBLISHABLE || PUBLICA_POR_DEFECTO; }

async function rpc_(nombre, args) {
  const r = await fetch(ENV.SUPABASE_URL + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: claveSecreta_(), 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  if (!r.ok) throw new Error('Error de base de datos (' + r.status + '): ' + (await r.text()).slice(0, 300));
  return r.json();
}

const NO_CACHEAR = n => n.startsWith('__F_');

/* Trae a STORE las hojas pedidas (solo descarga las que cambiaron) */
async function asegurarHojas_(nombres) {
  const conocidas = {};
  nombres.forEach(n => { const e = STORE.get(n); if (e) conocidas[n] = e.v; });
  const res = await rpc_('gas_cargar', { p_nombres: nombres, p_conocidas: conocidas });
  for (const n of nombres) {
    const x = res[n];
    if (x === null || x === undefined) STORE.set(n, { v: 0, rows: [], existe: false });
    else if (x.igual) { /* sigue igual */ }
    else STORE.set(n, { v: x.v, rows: revivir_(x.d), existe: true });
  }
}
function armarRequest_(nombres) {
  REQ = { hojas: new Map(), efectos: [], faltan: new Set() };
  for (const n of nombres) {
    const e = STORE.get(n);
    REQ.hojas.set(n, new Hoja(n, e.rows.map(r => r.slice()), e.v, e.existe));
  }
}

/* Guarda lo modificado; devuelve true, o false si otra persona cambió alguna hoja */
async function guardarCambios_() {
  const cambios = [];
  for (const h of REQ.hojas.values()) {
    if (h._borrada) { if (h._v > 0) cambios.push({ n: h._n, v: h._v, m: 'borrar' }); continue; }
    if (h._min === Infinity) continue;
    if (h._existe && h._v > 0 && h._min >= h._base) {
      const nuevas = serializar_(h._r.slice(h._base));
      // las filas vacías al final no cuentan: se descartan
      if (!nuevas.length) continue;
      cambios.push({ n: h._n, v: h._v, m: 'agregar', desde: h._base, d: nuevas });
    } else {
      cambios.push({ n: h._n, v: h._v, m: 'reemplazo', d: serializar_(h._r) });
    }
  }
  if (!cambios.length) return true;
  const res = await rpc_('gas_aplicar', { p_cambios: cambios });
  if (!res.ok) return false;
  for (const h of REQ.hojas.values()) {
    const nv = res.versiones[h._n];
    if (nv === undefined) continue;
    if (nv === 0 || NO_CACHEAR(h._n)) STORE.delete(h._n);
    else STORE.set(h._n, { v: nv, rows: h._r, existe: true });
  }
  return true;
}

const BASE_HOJAS = ['USUARIOS', '__PROPS'];

/* Ejecuta una función del sistema original con control de concurrencia */
async function ejecutar_(fn, args, email) {
  const f = API[fn];
  if (!f) throw new Error('Función no disponible: ' + fn);
  const aprendidas = APRENDIDO.get(fn) || [];
  for (let intento = 0; intento < 6; intento++) {
    const nombres = new Set([...BASE_HOJAS, ...aprendidas]);
    await asegurarHojas_([...nombres]);
    let resultado;
    for (let vueltas = 0; ; vueltas++) {
      if (vueltas > 80) throw new Error('Demasiadas hojas distintas en una sola operación.');
      armarRequest_([...nombres]);
      AUTH_EMAIL = email || '';
      try {
        resultado = f.apply(null, args);
      } catch (e) {
        if (!(e instanceof NeedSheet) && !REQ.faltan.size) throw e;
        if (e instanceof NeedSheet) REQ.faltan.add(e.hoja);
      }
      if (REQ.faltan.size) {           // faltaban hojas (aunque el código original haya capturado el error): se repite con ellas
        const nuevas = [...REQ.faltan].filter(n => !nombres.has(n));
        if (!nuevas.length) throw new Error('No se pudo cargar la hoja ' + [...REQ.faltan].join(', '));
        nuevas.forEach(n => nombres.add(n));
        await asegurarHojas_(nuevas);
        continue;
      }
      break;
    }
    APRENDIDO.set(fn, [...nombres].filter(n => !BASE_HOJAS.includes(n) && !n.startsWith('__F_')));
    const efectos = REQ.efectos;
    if (await guardarCambios_()) {
      return { resultado, efectos };
    }
    // otra persona guardó antes: se reintenta con datos frescos
    for (const n of nombres) STORE.delete(n);
  }
  throw new Error('Hubo muchos cambios simultáneos. Inténtalo de nuevo.');
}

/* ---------- Autenticación (Supabase Auth) ---------- */
const TOKENS_OK = new Map();
async function correoDeToken_(token) {
  token = String(token || '');
  if (!token || token.length > 4000) throw new Error('SESION_EXPIRADA');
  const hit = TOKENS_OK.get(token);
  if (hit && hit.hasta > RealDate.now()) return hit.email;
  const r = await fetch(ENV.SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: clavePublica_(), Authorization: 'Bearer ' + token }
  });
  if (!r.ok) throw new Error('SESION_EXPIRADA');
  const u = await r.json();
  const email = String(u.email || '').trim().toLowerCase();
  if (!email) throw new Error('SESION_EXPIRADA');
  if (TOKENS_OK.size > 500) TOKENS_OK.clear();
  TOKENS_OK.set(token, { email, hasta: RealDate.now() + 120000 });
  return email;
}
async function authToken_(grant, cuerpo) {
  const r = await fetch(ENV.SUPABASE_URL + '/auth/v1/token?grant_type=' + grant, {
    method: 'POST',
    headers: { apikey: clavePublica_(), 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo)
  });
  if (!r.ok) return null;
  return r.json();
}
async function admin_(metodo, ruta, cuerpo) {
  const r = await fetch(ENV.SUPABASE_URL + '/auth/v1/admin' + ruta, {
    method: metodo,
    headers: { apikey: claveSecreta_(), Authorization: 'Bearer ' + claveSecreta_(), 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) { /* texto */ }
  return { ok: r.ok, status: r.status, json: j, texto: t };
}
async function buscarAuthPorCorreo_(correo) {
  for (let pag = 1; pag <= 20; pag++) {
    const r = await admin_('GET', '/users?page=' + pag + '&per_page=200');
    if (!r.ok) throw new Error('No se pudo consultar los usuarios de acceso.');
    const lista = (r.json && r.json.users) || [];
    const u = lista.find(x => String(x.email || '').toLowerCase() === correo);
    if (u) return u;
    if (lista.length < 200) return null;
  }
  return null;
}
/* Aplica cambios de acceso pedidos por la lógica (crear usuario, clave, bloqueo) */
async function aplicarEfectos_(efectos) {
  for (const e of efectos) {
    if (e.t === 'clave') {
      let u = await buscarAuthPorCorreo_(e.correo);
      if (!u) {
        const r = await admin_('POST', '/users', { email: e.correo, password: e.clave, email_confirm: true });
        if (!r.ok) throw new Error('No se pudo crear el acceso: ' + ((r.json && (r.json.msg || r.json.message)) || r.texto).slice(0, 200));
      } else {
        const r = await admin_('PUT', '/users/' + u.id, { password: e.clave });
        if (!r.ok) throw new Error('No se pudo cambiar la contraseña: ' + ((r.json && (r.json.msg || r.json.message)) || r.texto).slice(0, 200));
      }
    } else if (e.t === 'activo') {
      const u = await buscarAuthPorCorreo_(e.correo);
      if (u) await admin_('PUT', '/users/' + u.id, { ban_duration: e.activo ? 'none' : '876000h' });
    }
  }
}

/* ---------- Atención de /api ---------- */
const PUBLICAS = new Set(['loginWeb', 'refrescarWeb']);

async function atender_(fn, args) {
  if (fn === 'loginWeb') {
    const u = String(args[0] || '').trim();
    const clave = String(args[1] || '');
    if (!u || !clave) throw new Error('Usuario o contraseña incorrectos.');
    const p = await ejecutar_('loginPaso1_', [u], '');
    const info = p.resultado;
    if (!info || !info.correo) throw new Error('Usuario o contraseña incorrectos.');
    const t = await authToken_('password', { email: info.correo, password: clave });
    if (!t || !t.access_token) throw new Error('Usuario o contraseña incorrectos.');
    try { await ejecutar_('loginPaso2_', [info.usuario], info.correo); } catch (e) { /* no es crítico */ }
    delete info.correo;
    return Object.assign({ token: t.access_token, refresh: t.refresh_token }, info);
  }
  if (fn === 'refrescarWeb') {
    const t = await authToken_('refresh_token', { refresh_token: String(args[0] || '') });
    if (!t || !t.access_token) throw new Error('SESION_EXPIRADA');
    return { token: t.access_token, refresh: t.refresh_token };
  }
  const token = args[0];
  const email = await correoDeToken_(token);
  if (fn === 'cambiarClaveWeb') {
    // se comprueba la contraseña actual antes de cambiarla
    const ok = await authToken_('password', { email, password: String(args[1] || '') });
    if (!ok) throw new Error('La contraseña actual no es correcta.');
  }
  const r = await ejecutar_(fn, args, email);
  if (r.efectos.length) await aplicarEfectos_(r.efectos);
  return r.resultado;
}

export default {
  async fetch(request, env) {
    ENV = env;
    const url = new URL(request.url);
    if (url.pathname !== '/api') return env.ASSETS.fetch(request);
    const cab = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (request.method !== 'POST') return new Response('{"ok":false,"error":"Método no permitido"}', { status: 405, headers: cab });
    let salida;
    try {
      const cuerpo = await request.json();
      const fn = String(cuerpo.fn || '');
      if (!Object.prototype.hasOwnProperty.call(API, fn) || fn.endsWith('_')) throw new Error('Función no disponible.');
      const args = Array.isArray(cuerpo.args) ? cuerpo.args : [];
      const r = await atender_(fn, args);
      salida = { ok: true, r: r === undefined ? null : r };
    } catch (e) {
      salida = { ok: false, error: String((e && e.message) || e) };
    }
    return new Response(JSON.stringify(salida), { headers: cab });
  }
};
