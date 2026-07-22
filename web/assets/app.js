/* app.js — Repository Intelligence Platform: shell, router, analyze flow, search. */
(function(){
'use strict';
var D=null;                       // the loaded index
var IDX={};                       // derived indexes
var A={};                         // shared helpers exposed to page modules

// ---- tiny DOM helper ----
function h(tag,attrs,kids){
  var e=document.createElement(tag);
  if(attrs)for(var k in attrs){
    if(k==='class')e.className=attrs[k];
    else if(k==='html')e.innerHTML=attrs[k];
    else if(k==='text')e.textContent=attrs[k];
    else if(k.slice(0,2)==='on'&&typeof attrs[k]==='function')e.addEventListener(k.slice(2),attrs[k]);
    else if(attrs[k]!=null)e.setAttribute(k,attrs[k]);
  }
  if(kids!=null)(Array.isArray(kids)?kids:[kids]).forEach(function(c){if(c==null)return;e.appendChild(typeof c==='string'?document.createTextNode(c):c);});
  return e;
}
function el(html){var d=document.createElement('div');d.innerHTML=html;return d.firstElementChild;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function num(n){return(n==null?0:n).toLocaleString();}
function baseName(p){return String(p).split('/').pop();}

var LANG_COLORS={typescript:'#3178c6',tsx:'#3178c6',javascript:'#f7df1e',python:'#3572A5',go:'#00ADD8',rust:'#dea584',java:'#b07219',kotlin:'#A97BFF',csharp:'#178600',php:'#4F5D95',ruby:'#701516',c:'#555555',cpp:'#f34b7d',swift:'#F05138',dart:'#00B4AB',scala:'#c22d40',lua:'#000080',elixir:'#6e4a7e',solidity:'#AA6746',bash:'#89e051'};
function langColor(l){return LANG_COLORS[l]||'#64748b';}
var LAYER_COLORS={api:'#5b9dff',service:'#3dd69a',data:'#f5b13d',ui:'#a98bff',lib:'#36d0c4',config:'#94a3b8',test:'#5c7095',other:'#64748b'};
function layerColor(l){return LAYER_COLORS[l]||'#64748b';}

// ---- analyze (SSE) ----
function startAnalyze(input,ref){
  var prog=document.getElementById('progress');
  prog.innerHTML='';
  var btn=document.getElementById('analyze-btn');btn.disabled=true;btn.textContent='Analyzing...';
  function line(msg,cls){var d=h('div',{class:cls||''});d.textContent=msg;prog.appendChild(d);prog.scrollTop=prog.scrollHeight;}
  line('Starting...');
  fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:input,ref:ref})})
    .then(function(res){
      var reader=res.body.getReader();var dec=new TextDecoder();var buf='';
      function pump(){return reader.read().then(function(r){
        if(r.done)return;
        buf+=dec.decode(r.value,{stream:true});
        var evs=buf.split('\n\n');buf=evs.pop();
        evs.forEach(function(block){
          var ev=block.match(/event: (.*)/),dm=block.match(/data: ([\s\S]*)/);
          if(!dm)return;var data;try{data=JSON.parse(dm[1]);}catch(e){return;}
          var name=ev?ev[1].trim():'message';
          if(name==='progress')line(data.message);
          else if(name==='error'){line('ERROR: '+data.message,'err');btn.disabled=false;btn.textContent='Analyze';}
          else if(name==='done'){line('Done. Loading explorer...');loadIndex(data.id);}
        });
        return pump();
      });}
      return pump();
    })
    .catch(function(e){line('ERROR: '+e.message,'err');btn.disabled=false;btn.textContent='Analyze';});
}

function loadIndex(id){
  fetch('/api/index/'+id).then(function(r){return r.json();}).then(function(index){
    D=index;buildIndexes();
    localStorage.setItem('ri_last_id',id);
    document.getElementById('landing').style.display='none';
    document.getElementById('app').classList.add('on');
    var name=(D.source&&D.source.input)||D.manifest.root;
    document.getElementById('brand-name').textContent=baseName(name.replace(/\.git$/,''));
    document.getElementById('brand-meta').textContent=D.languages.slice(0,3).map(function(l){return l.label;}).join(' · ')+' · '+num(D.manifest.counts.loc)+' LOC';
    buildNav();setupSearch();
    if(!location.hash||location.hash==='#')location.hash=(D.intel&&D.intel.systemMap)?'#/system':'#/dashboard';
    render();
  });
}

function buildIndexes(){
  IDX.fileByPath={};D.files.forEach(function(f){IDX.fileByPath[f.path]=f;});
  IDX.fnById={};D.functions.forEach(function(f){IDX.fnById[f.id]=f;});
  IDX.fnsByFile={};D.functions.forEach(function(f){(IDX.fnsByFile[f.file]=IDX.fnsByFile[f.file]||[]).push(f);});
  IDX.classesByFile={};D.classes.forEach(function(c){(IDX.classesByFile[c.file]=IDX.classesByFile[c.file]||[]).push(c);});
  IDX.tableByName={};D.tables.forEach(function(t){IDX.tableByName[t.name]=t;});
  IDX.routesByFile={};D.routes.forEach(function(r){(IDX.routesByFile[r.file]=IDX.routesByFile[r.file]||[]).push(r);});
  IDX.flowById={};D.flows.forEach(function(f){IDX.flowById[f.id]=f;});
  // routes touching a table
  IDX.filesUsingTable={};
  D.tables.forEach(function(t){IDX.filesUsingTable[t.name]=(t.readBy||[]).concat(t.writtenBy||[]);});
}

// ---- router ----
var routes={};
function route(name,fn){routes[name]=fn;}
window.RINAV=function(hash){location.hash='#/'+hash;};
function current(){var hash=location.hash.replace(/^#\/?/,'')||'dashboard';var parts=hash.split('/');return{page:parts[0],arg:parts.slice(1).join('/')};}
function render(){
  if(!D)return;
  var r=current();var content=document.getElementById('content');content.scrollTop=0;
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.page===r.page);});
  var fn=routes[r.page]||routes.dashboard;
  try{fn(content,r.arg?decodeURIComponent(r.arg):'');}
  catch(err){content.innerHTML='<div class="view"><div class="callout danger">Render error: '+esc(err.message)+'<br><pre>'+esc(err.stack||'')+'</pre></div></div>';}
  setCrumbs(r);
}
function setCrumbs(r){
  var labels={dashboard:'Dashboard',architecture:'Architecture',files:'Files',functions:'Functions',classes:'Classes',apis:'API Explorer',database:'Database',flows:'Business Flows',graph:'Dependency Graph',quality:'Code Quality',security:'Security',deps:'Dependencies',ai:'AI Assistant',settings:'Settings',compare:'Compare',semantic:'Modules & Domains',health:'Repository Health',overview:'AI Overview',learn:'Learn Repository',trace:'Trace & Impact',commit:'Commit Intelligence',sgraph:'Semantic Graph',timemachine:'Time Machine',brain:'Repository Brain',search:'Semantic Search',insights:'Repository Insights',timeline:'Graph Timeline',system:'System Map',product:'Product Overview',capmap:'Capability Map',journeys:'User Journeys',stories:'System Stories',tour:'Guided Tour',ask:'Ask the Repo',scorecard:'Product Scorecard',beginner:'Beginner Mode'};
  var label=labels[r.page]||r.page;
  var html='<span class="c-link" onclick="RINAV(\'dashboard\')">Home</span> / '+esc(label);
  if(r.arg)html+=' / <span class="mono">'+esc(baseName(decodeURIComponent(r.arg)))+'</span>';
  document.getElementById('crumbs').innerHTML=html;
}
window.addEventListener('hashchange',render);

// ---- nav ----
var NAV=[
  {sec:'Product Intelligence'},
  {page:'system',label:'System Map',ic:'\u25C9'},
  {page:'product',label:'Product Overview',ic:'\u2637'},
  {page:'capmap',label:'Capability Map',ic:'\u25F0'},
  {page:'journeys',label:'User Journeys',ic:'\u2933'},
  {page:'stories',label:'System Stories',ic:'\u25C8'},
  {page:'tour',label:'Guided Tour',ic:'\u25B6'},
  {page:'ask',label:'Ask the Repo',ic:'\u2315'},
  {page:'scorecard',label:'Product Scorecard',ic:'\u2691'},
  {page:'beginner',label:'Beginner Mode',ic:'\u2609'},
  {sec:'Overview'},
  {page:'dashboard',label:'Dashboard',ic:'\u25A0'},
  {page:'brain',label:'Repository Brain',ic:'\u25C9'},
  {page:'search',label:'Semantic Search',ic:'\u2315'},
  {page:'architecture',label:'Architecture',ic:'\u25C9'},
  {page:'sgraph',label:'Semantic Graph',ic:'\u2b21'},
  {page:'graph',label:'Dependency Graph',ic:'\u2b23'},
  {sec:'Explore'},
  {page:'files',label:'Files',ic:'\u25B8',count:function(){return D.manifest.counts.files;}},
  {page:'functions',label:'Functions',ic:'\u0192',count:function(){return D.manifest.counts.functions;}},
  {page:'classes',label:'Classes / Types',ic:'{}',count:function(){return D.manifest.counts.classes;}},
  {page:'apis',label:'API Explorer',ic:'\u21C4',count:function(){return D.manifest.counts.routes;}},
  {page:'database',label:'Database',ic:'\u25A4',count:function(){return D.manifest.counts.tables;}},
  {page:'deps',label:'Dependencies',ic:'\u25C8',count:function(){return D.manifest.counts.dependencies;}},
  {sec:'Understand'},
  {page:'flows',label:'Business Flows',ic:'\u2933',count:function(){return D.flows.length;}},
  {page:'semantic',label:'Modules & Domains',ic:'\u25F0',count:function(){return D.semantic?D.semantic.domains.length:0;}},
  {page:'insights',label:'Repository Insights',ic:'\u2691'},
  {page:'timeline',label:'Graph Timeline',ic:'\u29D6'},
  {page:'health',label:'Repository Health',ic:'\u2665'},
  {page:'quality',label:'Code Quality',ic:'\u2691'},
  {page:'security',label:'Security',ic:'\u26E8',count:function(){return D.security.length;}},
  {page:'compare',label:'Compare Versions',ic:'\u21C5'},
  {page:'timemachine',label:'Time Machine',ic:'\u29D6'},
  {sec:'AI Intelligence'},
  {page:'ai',label:'AI Assistant',ic:'\u2727'},
  {page:'overview',label:'AI Overview',ic:'\u2637'},
  {page:'learn',label:'Learn Repository',ic:'\u25C8'},
  {page:'trace',label:'Trace &amp; Impact',ic:'\u2325'},
  {page:'commit',label:'Commit Intelligence',ic:'\u2338'},
  {page:'settings',label:'AI Settings',ic:'\u2699'}
];
function buildNav(){
  var nav=document.getElementById('nav');nav.innerHTML='';
  NAV.forEach(function(n){
    if(n.sec){nav.appendChild(h('div',{class:'nav-sec',text:n.sec}));return;}
    var kids=[h('span',{class:'ic',text:n.ic}),h('span',{text:n.label})];
    if(n.count){try{kids.push(h('span',{class:'ct',text:num(n.count())}));}catch(e){}}
    nav.appendChild(h('div',{class:'nav-item','data-page':n.page,onclick:function(){window.RINAV(n.page);}},kids));
  });
}

// ---- search ----
var searchIndex=null;
function buildSearchIndex(){
  var idx=[];
  D.files.forEach(function(f){idx.push({kind:'file',name:f.path,label:baseName(f.path),meta:f.lang||'',go:'file/'+encodeURIComponent(f.path)});});
  D.functions.forEach(function(fn){idx.push({kind:'fn',name:fn.name,label:fn.name,meta:baseName(fn.file),go:'function/'+encodeURIComponent(fn.id)});});
  D.classes.forEach(function(c){idx.push({kind:'class',name:c.name,label:c.name,meta:baseName(c.file),go:'class/'+encodeURIComponent(c.id)});});
  D.routes.forEach(function(r){idx.push({kind:'api',name:r.method+' '+r.path,label:r.method+' '+r.path,meta:r.framework,go:'api/'+encodeURIComponent(r.method+' '+r.path+' @'+r.file)});});
  D.tables.forEach(function(t){idx.push({kind:'table',name:t.name,label:t.name,meta:'table',go:'table/'+encodeURIComponent(t.name)});});
  D.flows.forEach(function(fl){idx.push({kind:'flow',name:fl.name,label:fl.name,meta:fl.kind,go:'flow/'+encodeURIComponent(fl.id)});});
  D.dependencies.forEach(function(d){idx.push({kind:'dep',name:d.name,label:d.name,meta:d.ecosystem,go:'deps'});});
  searchIndex=idx;return idx;
}
var KIND_BADGE={file:'b-tag',fn:'b-green',api:'b-accent',table:'b-amber',class:'b-purple',flow:'b-pink',dep:'b-tag'};
function runSearch(q){
  var idx=searchIndex||buildSearchIndex();q=q.toLowerCase().trim();if(!q)return[];
  var terms=q.split(/\s+/);var scored=[];
  for(var i=0;i<idx.length;i++){var it=idx[i];var name=it.name.toLowerCase();var ok=true,score=0;
    for(var t=0;t<terms.length;t++){var pos=name.indexOf(terms[t]);if(pos<0){ok=false;break;}score+=pos===0?3:1;if(name===terms[t])score+=5;}
    if(ok)scored.push([score-name.length*0.002,it]);
  }
  scored.sort(function(a,b){return b[0]-a[0];});return scored.slice(0,40).map(function(s){return s[1];});
}
function setupSearch(){
  var input=document.getElementById('search');var box=document.getElementById('search-results');var sel=-1,results=[];
  function close(){box.classList.remove('show');sel=-1;}
  function open(res){results=res;if(!res.length){close();return;}
    box.innerHTML=res.map(function(r,i){return '<div class="sr-item" data-i="'+i+'"><span class="sr-kind '+(KIND_BADGE[r.kind]||'b-tag')+'">'+r.kind+'</span><span class="sr-name">'+esc(r.label)+'</span><span class="sr-meta">'+esc(r.meta||'')+'</span></div>';}).join('');
    box.classList.add('show');
    Array.prototype.forEach.call(box.querySelectorAll('.sr-item'),function(it){it.addEventListener('click',function(){go(results[+it.dataset.i]);});});
  }
  function go(r){close();input.value='';window.RINAV(r.go);}
  input.addEventListener('input',function(){open(runSearch(input.value));});
  input.addEventListener('keydown',function(e){
    if(e.key==='Escape'){close();input.blur();}
    else if(e.key==='ArrowDown'){e.preventDefault();sel=Math.min(sel+1,results.length-1);hi();}
    else if(e.key==='ArrowUp'){e.preventDefault();sel=Math.max(sel-1,0);hi();}
    else if(e.key==='Enter'&&results.length)go(results[sel<0?0:sel]);
  });
  function hi(){Array.prototype.forEach.call(box.querySelectorAll('.sr-item'),function(it,i){it.classList.toggle('sel',i===sel);if(i===sel)it.scrollIntoView({block:'nearest'});});}
  document.addEventListener('click',function(e){if(!e.target.closest('#search-wrap'))close();});
  document.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();input.focus();}else if(e.key==='/'&&document.activeElement!==input&&document.getElementById('app').classList.contains('on')){e.preventDefault();input.focus();}});
}

// ---- expose to page modules ----
A={h:h,el:el,esc:esc,num:num,baseName:baseName,route:route,nav:window.RINAV,render:render,
   get D(){return D;},get IDX(){return IDX;},langColor:langColor,layerColor:layerColor};
window.RIAPP=A;
window.RIRENDER=render;

// ---- boot ----
document.addEventListener('DOMContentLoaded',function(){
  var examples=['https://github.com/pallets/flask','https://github.com/gin-gonic/gin','https://github.com/expressjs/express','https://github.com/psf/requests'];
  var exBox=document.getElementById('examples');
  examples.forEach(function(u){var c=h('div',{class:'ex-chip',text:u.replace('https://github.com/','')});c.addEventListener('click',function(){document.getElementById('repo-input').value=u;});exBox.appendChild(c);});
  document.getElementById('analyze-btn').addEventListener('click',function(){var v=document.getElementById('repo-input').value.trim();if(v)startAnalyze(v);});
  document.getElementById('repo-input').addEventListener('keydown',function(e){if(e.key==='Enter'){var v=e.target.value.trim();if(v)startAnalyze(v);}});
  document.getElementById('new-repo-btn').addEventListener('click',function(){location.hash='';document.getElementById('app').classList.remove('on');document.getElementById('landing').style.display='flex';var b=document.getElementById('analyze-btn');b.disabled=false;b.textContent='Analyze';});
  // restore last analyzed repo across reloads (server keeps a disk cache)
  var lastId=localStorage.getItem('ri_last_id');
  if(lastId){
    fetch('/api/index/'+lastId).then(function(r){return r.ok?r.json():null;}).then(function(index){
      if(index&&index.manifest){loadIndex(lastId);}
    }).catch(function(){});
  }
});
})();
