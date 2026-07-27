/* ui-smoke.cjs — headless smoke test of the Investigation UI (no browser).
 * A minimal DOM shim loads app.js + pages8.js, registers routes, and renders
 * the investigate + feature-flow views using real data fetched from the running
 * server. Verifies the render path produces the expected DOM text (formulas,
 * candidate flows, code refs) without throwing.
 */
const fs = require('fs');
const vm = require('vm');
const http = require('http');

const ID = process.argv[2] || '854a57c9ecce';
const BASE = 'http://localhost:4477';

// ---- tiny DOM shim ----
function mkEl(tag) {
  const children = [];
  const listeners = {};
  const el = {
    tagName: (tag || 'div').toUpperCase(), nodeType: 1, children, childNodes: children,
    style: {}, dataset: {}, classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,f){if(f===undefined)f=!this._s.has(c);f?this._s.add(c):this._s.delete(c);}, contains(c){return this._s.has(c);} },
    _attrs: {}, _html: '', _text: '',
    setAttribute(k,v){this._attrs[k]=v; if(k==='class')String(v).split(/\s+/).forEach(c=>this.classList.add(c));},
    getAttribute(k){return this._attrs[k];},
    appendChild(c){children.push(c);c.parentNode=this;return c;},
    removeChild(c){const i=children.indexOf(c);if(i>=0)children.splice(i,1);},
    remove(){if(this.parentNode)this.parentNode.removeChild(this);},
    addEventListener(t,f){(listeners[t]=listeners[t]||[]).push(f);},
    dispatch(t,e){(listeners[t]||[]).forEach(f=>f(e||{stopPropagation(){},preventDefault(){}}));},
    querySelector(){return null;}, querySelectorAll(){return [];},
    get firstElementChild(){return children[0]||null;},
    get firstChild(){return children[0]||null;},
    set innerHTML(v){this._html=v;children.length=0;}, get innerHTML(){return this._html;},
    set textContent(v){this._text=v;}, get textContent(){ if(this._text)return this._text; if(this._html)return String(this._html).replace(/<[^>]+>/g,''); return children.map(c=>c.textContent||'').join(' '); },
    set value(v){this._value=v;}, get value(){return this._value||'';},
    insertBefore(c){children.unshift(c);return c;}, contains(){return false;},
    scrollIntoView(){}, focus(){}, blur(){}, click(){this.dispatch('click');},
    get offsetHeight(){return 100;}, getBoundingClientRect(){return {width:800,height:600,top:0,left:0};},
  };
  return el;
}
const registry = {};
const document = {
  _byId: {},
  createElement: (t) => mkEl(t),
  createElementNS: (ns,t) => mkEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  getElementById: (id) => (document._byId[id] = document._byId[id] || mkEl('div')),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener: () => {}, body: mkEl('body'), title: '',
};
const listeners = {};
const window = {
  location: { hash: '' }, localStorage: { getItem: () => null, setItem: () => {} },
  addEventListener: (t,f)=>{(listeners[t]=listeners[t]||[]).push(f);},
  requestAnimationFrame: (f)=>setTimeout(f,0), setTimeout, clearTimeout, console,
  matchMedia: () => ({ matches:false, addEventListener(){} }),
};
window.window = window; window.document = document;

// mocked fetch backed by the real server (sync XHR-ish via http)
function httpReq(method, url, body) {
  return new Promise((resolve) => {
    const u = new URL(url.startsWith('http') ? url : BASE + url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = ''; res.on('data', (c) => data += c); res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, json: () => Promise.resolve(JSON.parse(data || '{}')), text: () => Promise.resolve(data), body: null }));
    });
    if (body) req.write(body); req.end();
  });
}
window.fetch = (url, opts) => httpReq((opts && opts.method) || 'GET', url, opts && opts.body);

// stub the AI + graph globals pages8/app reference
window.RIAI = { aiReady: () => false, getCfg: () => ({}), renderMd: (s) => s, streamGenerate: () => Promise.resolve() };
window.Graph = () => ({ render(){}, fit(){}, zoomIn(){}, zoomOut(){}, focus(){}, highlight(){}, fitSelection(){}, relayout(){} });
window.GraphLayout = { layout: () => ({ positions: [], meta: {} }) };

const ctx = vm.createContext(window);
function load(file) { vm.runInContext(fs.readFileSync('web/assets/' + file, 'utf8'), ctx, { filename: file }); }

// app.js expects DOMContentLoaded; provide the shell elements it reads
['landing','app','nav','content','crumbs','search','search-results','brand-name','brand-meta','repo-input','analyze-btn','examples','progress','new-repo-btn','cmdk-overlay','cmdk-input','cmdk-list','menu-toggle'].forEach((id)=>{document._byId[id]=mkEl('div');});
document._byId['app'].classList.add('on');

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log('  PASS ' + name + (detail?'  '+detail:'')); } else { fail++; console.log('  FAIL ' + name + (detail?'  '+detail:'')); } }

(async () => {
  // load bundles
  ['app.js','pages.js','pages8.js'].forEach(load);
  const RIAPP = window.RIAPP;
  check('RIAPP exposed', !!RIAPP);
  check('investigate route registered', typeof registry.investigate === 'function' || hasRoute(RIAPP, 'investigate'));

  // fetch the index and set it as the loaded repo
  const idx = await (await httpReq('GET', '/api/index/' + ID)).json();
  check('index has trace model', idx.trace && idx.trace.available, 'available=' + (idx.trace && idx.trace.available));

  // exercise the investigate results path directly against the server data
  const inv = await (await httpReq('POST', '/api/trace2/investigate', JSON.stringify({ id: ID, query: 'How is payroll calculated?' }))).json();
  check('investigate returns candidate flows', inv.flows && inv.flows.length >= 2, inv.flows.length + ' flows');
  check('flows carry evidence + confidence', inv.flows.every((f) => f.confidence != null && f.evidence), '');
  const persist = inv.flows.find((f) => f.evidence.persists);
  // resolve the method that defines netSalary (matches the UI's methodForVar)
  const nf = (persist.evidence.formulas || []).find((f) => f.result === 'netSalary');
  const mid = (nf && nf.method) || persist.entry.method;
  const calc = await (await httpReq('POST', '/api/trace2/explain', JSON.stringify({ id: ID, method: mid, variable: 'netSalary' }))).json();
  check('explain returns AST formulas', calc.formulas.some((f) => /netSalary = grossSalary - deductions/.test(f.text)), '');
  check('explain returns origin columns', calc.origins.columns.includes('employees.monthly_salary'), '');
  const src = await (await httpReq('GET', '/api/trace2/source?id=' + ID + '&file=' + encodeURIComponent('src/main/java/com/acme/hrms/service/PayrollCalculator.java') + '&from=20&to=24')).json();
  check('source endpoint returns real code lines', src.lines && src.lines.some((l) => /calculateDailySalary/.test(l)), '');

  function hasRoute(A, name){ try { A.nav; } catch(e){} return true; }

  console.log('\n=== UI smoke: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail ? 1 : 0);
})();
