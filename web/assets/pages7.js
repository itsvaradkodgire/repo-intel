/* pages7.js — Phase 6 Product Consolidation & UX (ADDITIVE).
 *
 * Adds the coherent product shell on top of every existing page:
 *   home    a 10-second repository overview (what/size/health/organization/start)
 *   map     the flagship Repository Map: ONE graph, MANY lenses
 *           (Business / Technical / API / Database / Infrastructure / Security)
 *   command palette (Cmd/Ctrl-K), onboarding coach, menu toggle, keyboard nav.
 *
 * Nothing is removed. Every legacy route still works; this layer just gives the
 * app one front door and one map instead of many. Internal terminology
 * ("Repository Brain", "Semantic Graph", "Embedding Index") is hidden behind
 * user-facing concepts. */
(function(){
'use strict';
var A=window.RIAPP,h=A.h,el=A.el,esc=A.esc,num=A.num,baseName=A.baseName,route=A.route,nav=A.nav;
var langColor=A.langColor,layerColor=A.layerColor;
function D(){return A.D;}function IDX(){return A.IDX;}
var U=A.ui,view=U.view,pt=U.pt,card=U.card;
function AI(){return window.RIAI;}
function intel(){return D().intel;}
function bid(){return D().source&&D().source.id;}

var KIND_COLOR={business:'#5b9dff',integration:'#3dd69a',infrastructure:'#f5b13d','cross-cutting':'#a98bff',technical:'#64748b'};
function kindColor(k){return KIND_COLOR[k]||'#64748b';}
function scoreColor(v){return v>=75?'var(--green)':v>=50?'var(--amber)':'var(--red)';}
function confWord(c){return c&&c.confidenceLabel?c.confidenceLabel:'';}

// ======================================================================
// HOME — answer in 10 seconds: what / how big / how healthy / how organized / where to start
// ======================================================================
route('home',function(content){
  var d=D();var c=d.manifest.counts;var git=d.source&&d.source.git;
  var it=intel();var prod=it&&it.product;
  var health=(d.semantic&&d.semantic.health)||null;
  var repoName=baseName(((d.source&&d.source.input)||d.manifest.root).replace(/\.git$/,''));
  var v=view([]);

  // onboarding coach (first visit only)
  if(!localStorage.getItem('ri_coach_seen')){
    var coach=el('<div class="coach"><div class="cx">\uD83D\uDC4B</div><div class="cc">Welcome. This is your repository, explained. Start with the <b>Repository Map</b> to see how it fits together, ask the <b>AI Assistant</b> anything, or take the <b>Guided Tour</b>. Press <span class="kbd">\u2318K</span> to jump anywhere.</div><div class="dismiss" title="Dismiss">\u00d7</div></div>');
    coach.querySelector('.dismiss').addEventListener('click',function(){coach.remove();localStorage.setItem('ri_coach_seen','1');});
    v.appendChild(coach);
  }

  // ---- HERO ----
  var hero=h('div',{class:'hero'});
  var typeStr=prod?prod.productType:(c.routes>0?'web service':'software project');
  hero.appendChild(el('<h1>'+esc(repoName)+'</h1>'));
  var subText=prod&&prod.summary?prod.summary:('A '+typeStr+' with '+num(c.files)+' files across '+d.languages.slice(0,3).map(function(l){return l.label;}).join(', ')+'.');
  hero.appendChild(el('<div class="sub">'+esc(subText)+'</div>'));
  if(prod)hero.appendChild(el('<div class="hero-conf"><span class="badge '+(prod.confidenceLabel==='confident'?'b-green':prod.confidenceLabel==='likely'?'b-accent':'b-amber')+'">'+esc(prod.confidenceLabel)+'</span></div>'));
  // pills: size, health, stack, git
  var pills=h('div',{class:'pills'});
  function pill(html){pills.appendChild(el('<span class="pill">'+html+'</span>'));}
  pill('<b>'+num(c.loc)+'</b> lines');
  pill('<b>'+num(c.files)+'</b> files');
  if(c.routes)pill('<b>'+num(c.routes)+'</b> APIs');
  if(c.tables)pill('<b>'+num(c.tables)+'</b> tables');
  if(health)pill('<span class="dotc" style="background:'+scoreColor(health.overall)+'"></span>Health <b>'+health.overall+'</b>');
  if(git&&git.branch)pill('<span style="opacity:.6">git</span> <b>'+esc(git.branch)+'</b>');
  hero.appendChild(pills);
  v.appendChild(hero);

  // ---- QUICK ACTIONS ----
  var qaGrid=h('div',{class:'qa-grid'});
  function qa(ic,t,dsc,go,color){
    var e=h('div',{class:'qa',role:'button',tabindex:'0',onclick:function(){nav(go);}});
    e.innerHTML='<div class="qic" style="color:'+(color||'var(--accent)')+'">'+ic+'</div><div><div class="qt">'+esc(t)+'</div><div class="qd">'+esc(dsc)+'</div></div>';
    e.addEventListener('keydown',function(ev){if(ev.key==='Enter')nav(go);});
    qaGrid.appendChild(e);
  }
  if(D().trace&&D().trace.available)qa('\u2315','Investigate the code','Ask how a feature works or where a value comes from. Verified from code.','investigate','#5b9dff');
  qa('\u25C9','Open the Repository Map','See every system and how they connect. One map, many lenses.','map','#5b9dff');
  if(AI().aiReady())qa('\u2727','Ask the AI Assistant','Ask anything about how this code works. Grounded, cited answers.','ai','#a98bff');
  else qa('\u2727','Turn on the AI Assistant','Bring any provider for grounded, cited explanations. Optional.','settings','#a98bff');
  qa('\u25B6','Take the Guided Tour','A newcomer-friendly walkthrough of the systems that matter.','tour','#3dd69a');
  qa('\u2609','Beginner Mode','A jargon-free explanation, as if onboarding a new engineer.','beginner','#f5b13d');
  v.appendChild(qaGrid);

  // ---- TOP SYSTEMS (what it does) ----
  if(it&&it.systemMap&&it.systemMap.nodes.length){
    var biz=it.capabilities.business.filter(function(x){return x.confidence>=0.4;}).slice(0,6);
    if(biz.length){
      v.appendChild(secH('What it does','Top capabilities, inferred from the code','capmap'));
      var grid=h('div',{class:'grid',style:'grid-template-columns:repeat(auto-fill,minmax(240px,1fr))'});
      biz.forEach(function(x){
        var t=h('div',{class:'sys-tile',style:'border-left-color:'+kindColor(x.kind),role:'button',tabindex:'0',onclick:function(){nav('stories/'+encodeURIComponent(x.id));}});
        t.innerHTML='<div class="st-t">'+esc(x.label)+' <span class="badge '+(x.confidence>=.75?'b-green':x.confidence>=.5?'b-accent':'b-amber')+'" style="font-size:9px">'+esc(x.confidenceLabel)+'</span></div><div class="st-w">'+esc(x.why)+'</div>';
        grid.appendChild(t);
      });
      v.appendChild(grid);
    }
  }

  // ---- HEALTH + ORGANIZATION (two col) ----
  var two=h('div',{class:'two',style:'margin-top:20px'});
  // health ring
  if(health){
    var hc=card('How healthy is it?',null);
    var ring=h('div',{class:'ring-wrap'});
    var circ=2*Math.PI*34;
    var off=circ*(1-health.overall/100);
    ring.appendChild(el('<svg class="ring" viewBox="0 0 80 80"><circle class="track" cx="40" cy="40" r="34"/><circle class="val" cx="40" cy="40" r="34" stroke="'+scoreColor(health.overall)+'" stroke-dasharray="'+circ.toFixed(1)+'" stroke-dashoffset="'+circ.toFixed(1)+'" data-off="'+off.toFixed(1)+'"/><text x="40" y="46" text-anchor="middle" class="ring-c" fill="'+scoreColor(health.overall)+'">'+health.overall+'</text></svg>'));
    var bars=h('div',{style:'flex:1'});
    health.scores.slice(0,4).forEach(function(s){
      bars.appendChild(el('<div class="bar-row" style="cursor:default"><div style="width:96px;font-size:11.5px;color:var(--dim)">'+esc(s.label)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+s.value+'%;background:'+scoreColor(s.value)+'"></div></div><div style="width:26px;text-align:right;font-family:var(--mono);font-size:11px">'+s.value+'</div></div>'));
    });
    ring.appendChild(bars);hc.appendChild(ring);
    hc.appendChild(el('<div class="mini" style="margin-top:10px"><span class="c-link" onclick="RINAV(\'health\')">Full health report \u2192</span></div>'));
    two.appendChild(hc);
  }
  // organization / stack
  var oc=card('How is it organized?',null);
  var maxL=Math.max.apply(null,d.languages.map(function(l){return l.files;}));
  d.languages.slice(0,5).forEach(function(l){
    oc.appendChild(el('<div class="bar-row" style="cursor:default"><div style="width:96px;font-size:11.5px;color:var(--dim)">'+esc(l.label)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(l.files/maxL*100)+'%;background:'+langColor(l.id)+'"></div></div><div style="width:34px;text-align:right;font-family:var(--mono);font-size:11px">'+l.files+'</div></div>'));
  });
  var domCount=(d.semantic&&d.semantic.domains.length)||0;
  oc.appendChild(el('<div class="mini" style="margin-top:10px">'+domCount+' modules \u00b7 '+((d.metrics&&Object.keys(d.metrics.layerCounts||{}).length)||0)+' layers \u00b7 <span class="c-link" onclick="RINAV(\'architecture\')">Architecture \u2192</span></div>'));
  two.appendChild(oc);
  v.appendChild(two);

  // ---- WHERE TO START ----
  if(it&&it.tour&&it.tour.stops.length){
    v.appendChild(secH('Where should I start?','A suggested reading order \u00b7 ~'+it.tour.estimatedMinutes+' min','tour'));
    var startWrap=h('div',{style:'display:flex;flex-wrap:wrap;gap:6px;align-items:center'});
    it.tour.stops.slice(0,7).forEach(function(s,i){
      if(i)startWrap.appendChild(el('<span class="flow-arrow" style="padding:0 2px">\u2192</span>'));
      var chip=h('span',{class:'chip',style:'cursor:pointer',onclick:function(){nav('stories/'+encodeURIComponent(s.id));}});chip.textContent=s.label;startWrap.appendChild(chip);
    });
    v.appendChild(startWrap);
    v.appendChild(el('<div style="margin-top:14px"><button class="btn sm" onclick="RINAV(\'tour\')">\u25B6 Start the guided tour</button></div>'));
  }

  content.innerHTML='';content.appendChild(v);
  // animate the health ring after mount
  setTimeout(function(){var rv=content.querySelector('.ring .val');if(rv)rv.style.strokeDashoffset=rv.dataset.off;},60);
});
function secH(title,sub,moreGo){
  var s=h('div',{class:'sec-h'});
  s.appendChild(el('<h2>'+esc(title)+'</h2>'));
  if(sub)s.appendChild(el('<span class="mini">'+esc(sub)+'</span>'));
  if(moreGo)s.appendChild(el('<span class="more" onclick="RINAV(\''+moreGo+'\')">View all \u2192</span>'));
  return s;
}

// ======================================================================
// REPOSITORY MAP — one graph, many lenses. The flagship.
// ======================================================================
var LENSES=[
  {id:'business',label:'Business',color:'#5b9dff',desc:'Product capabilities and how they depend on each other'},
  {id:'technical',label:'Technical',color:'#36d0c4',desc:'Modules and how they import each other'},
  {id:'api',label:'API',color:'#38bdf8',desc:'Systems that expose HTTP endpoints'},
  {id:'database',label:'Database',color:'#f5b13d',desc:'Systems that read and write data'},
  {id:'infra',label:'Infrastructure',color:'#a98bff',desc:'Jobs, storage, deploy, config'},
  {id:'security',label:'Security',color:'#f76d6d',desc:'Auth and security-sensitive systems'}
];
var mapLens='business';
route('map',function(content){
  var it=intel();
  var v=view(pt('Repository Map','One map of the whole repository. Switch the lens to see it through a different perspective. Click any node to go deeper.'));
  // lens bar
  var bar=h('div',{class:'lens-bar'});
  LENSES.forEach(function(L){
    var b=h('div',{class:'lens'+(mapLens===L.id?' active':''),role:'button',tabindex:'0'});
    b.innerHTML='<span class="ld" style="background:'+L.color+'"></span>'+esc(L.label);
    b.addEventListener('click',function(){mapLens=L.id;A.render();});
    b.addEventListener('keydown',function(e){if(e.key==='Enter'){mapLens=L.id;A.render();}});
    bar.appendChild(b);
  });
  var cur=LENSES.filter(function(L){return L.id===mapLens;})[0];
  bar.appendChild(el('<span class="lens-desc">'+esc(cur.desc)+'</span>'));
  v.appendChild(bar);

  var shell=h('div',{class:'map-shell'});
  var box=h('div',{class:'graph-box',style:'height:600px'});
  var gEl=h('div',{style:'width:100%;height:100%'});
  var controls=h('div',{class:'graph-controls'});
  box.appendChild(gEl);box.appendChild(controls);
  box.appendChild(h('div',{class:'graph-hint',text:'scroll = zoom \u00b7 drag = pan \u00b7 click a node to open'}));
  var legend=h('div',{class:'graph-legend'});box.appendChild(legend);
  shell.appendChild(box);
  // side panel
  var side=h('div',{class:'map-side'});
  side.appendChild(mapSidePanel(it,cur));
  shell.appendChild(side);
  v.appendChild(shell);
  content.innerHTML='';content.appendChild(v);

  // build graph data for the lens
  var data=buildLensGraph(it,mapLens);
  if(!data.nodes.length){
    box.innerHTML='<div class="empty" style="padding:60px">Nothing to show for this lens in this repository.</div>';
    return;
  }
  var g=window.Graph(gEl,{onClick:function(n){if(n.goto)nav(n.goto);}});
  g.render({nodes:data.nodes,links:data.links,directed:true,iters:320});
  legend.innerHTML=data.legend;
  [['+',function(){g.zoomIn();}],['\u2212',function(){g.zoomOut();}],['\u2b1a',function(){g.fit();}]].forEach(function(cc){var b=h('button',{text:cc[0],title:'zoom'});b.addEventListener('click',cc[1]);controls.appendChild(b);});
  // re-fit once the grid layout has settled so the map is centered in its box
  requestAnimationFrame(function(){g.fit();setTimeout(function(){g.fit();},120);});
});

function mapSidePanel(it,lens){
  var c=card('The '+lens.label+' lens',null);
  c.appendChild(el('<div class="mini" style="margin-bottom:10px">'+esc(lens.desc)+'.</div>'));
  if(!it){c.appendChild(el('<div class="empty-hint">Re-analyze this repository to unlock the full map (capabilities, systems, and reasons).</div>'));return c;}
  // list the systems in this lens
  var caps=it.capabilities.capabilities.filter(lensFilter(lens.id)).slice(0,10);
  if(caps.length){
    c.appendChild(el('<div class="mini" style="margin-bottom:6px">'+caps.length+' system(s) in view</div>'));
    caps.forEach(function(x){
      var row=h('div',{class:'bar-row',style:'cursor:pointer',onclick:function(){nav('stories/'+encodeURIComponent(x.id));}});
      row.innerHTML='<span class="ld" style="width:9px;height:9px;border-radius:50%;background:'+kindColor(x.kind)+';display:inline-block"></span><span style="font-size:12.5px;margin-left:6px">'+esc(x.label)+'</span><span class="mini" style="margin-left:auto">'+x.evidence.fileCount+'</span>';
      c.appendChild(row);
    });
  } else c.appendChild(el('<div class="empty-hint">No systems match this lens.</div>'));
  c.appendChild(el('<hr class="sep">'));
  c.appendChild(el('<div class="mini">Other perspectives: <span class="c-link" onclick="RINAV(\'architecture\')">Architecture</span> \u00b7 <span class="c-link" onclick="RINAV(\'graph\')">File dependencies</span> \u00b7 <span class="c-link" onclick="RINAV(\'flows\')">Flows</span></div>'));
  return c;
}
function lensFilter(lensId){
  // works for both capability objects (with .evidence) and systemMap nodes (flat)
  return function(x){
    var routes=x.evidence?x.evidence.routes.length:(x.routes||0);
    var tables=x.evidence?x.evidence.tables.length:((x.tables&&x.tables.length)||0);
    if(lensId==='business')return x.kind==='business';
    if(lensId==='technical')return x.kind==='technical'||x.kind==='cross-cutting';
    if(lensId==='api')return routes>0;
    if(lensId==='database')return tables>0;
    if(lensId==='infra')return x.kind==='infrastructure'||x.kind==='integration';
    if(lensId==='security')return x.id==='auth'||x.id==='security'||/auth|security|permission/.test(x.id);
    return true;
  };
}
// Build {nodes,links,legend} for a lens from intel.systemMap (falls back to the
// dependency graph if intel is unavailable, so the Map always works).
function buildLensGraph(it,lensId){
  if(it&&it.systemMap&&it.systemMap.nodes.length){
    var sm=it.systemMap;
    var keep=sm.nodes.filter(lensFilter(lensId));
    // for api/db/security lenses, also pull in directly-connected systems for context
    var keepIds={};keep.forEach(function(n){keepIds[n.id]=1;});
    if(lensId==='api'||lensId==='database'||lensId==='security'){
      sm.edges.forEach(function(e){if(keepIds[e.source]||keepIds[e.target]){keepIds[e.source]=1;keepIds[e.target]=1;}});
    }
    var nodes=sm.nodes.filter(function(n){return keepIds[n.id];}).slice(0,30).map(function(n){
      return {id:n.id,label:n.label.length>20?n.label.slice(0,18)+'…':n.label,color:kindColor(n.kind),r:Math.min(22,9+Math.sqrt(n.files||1)*1.7),goto:'stories/'+encodeURIComponent(n.id)};
    });
    var nid={};nodes.forEach(function(n){nid[n.id]=1;});
    var links=sm.edges.filter(function(e){return nid[e.source]&&nid[e.target];}).map(function(e){return {source:e.source,target:e.target,weight:e.strength};});
    var legend=LENSES.map(function(L){return '<span class="lg"><span class="dot" style="background:'+L.color+'"></span>'+L.label+'</span>';}).join('');
    return {nodes:nodes,links:links,legend:'<span class="lg" style="color:var(--faint2)">click a node to open its story</span>'};
  }
  // fallback: module dependency graph (from mechanical semantic domains)
  var d=D();var doms=(d.semantic&&d.semantic.domains)||[];
  var nodes=doms.slice(0,24).map(function(dm){return {id:dm.id,label:baseName(dm.label),color:'#5b9dff',r:Math.min(20,8+Math.sqrt(dm.fileCount)*1.5),goto:'domain/'+encodeURIComponent(dm.id)};});
  return {nodes:nodes,links:[],legend:'<span class="lg" style="color:var(--faint2)">module overview</span>'};
}

// ======================================================================
// COMMAND PALETTE (Cmd/Ctrl-K) — jump to any page, file, function, table
// ======================================================================
var cmdkSel=0,cmdkItems=[];
function cmdkOpen(){
  var ov=document.getElementById('cmdk-overlay');var inp=document.getElementById('cmdk-input');
  ov.classList.add('show');inp.value='';cmdkRender('');inp.focus();
}
function cmdkClose(){document.getElementById('cmdk-overlay').classList.remove('show');}
window.RICMDK=cmdkOpen;
function cmdkSources(){
  var d=D();if(!d)return[];
  var items=[];
  // pages (primary + advanced)
  (window.RI_NAV_ADVANCED||[]).concat([]).forEach(function(){});
  var pages=[
    {t:'Home',go:'home',ic:'\u2302',g:'Go to'},{t:'Repository Map',go:'map',ic:'\u25C9',g:'Go to'},
    {t:'Overview',go:'product',ic:'\u2637',g:'Go to'},{t:'Architecture',go:'architecture',ic:'\u25F0',g:'Go to'},
    {t:'Capabilities',go:'capmap',ic:'\u25C8',g:'Go to'},{t:'Health & Quality',go:'health',ic:'\u2665',g:'Go to'},
    {t:'AI Assistant',go:'ai',ic:'\u2727',g:'Go to'},{t:'Guided Tour',go:'tour',ic:'\u25B6',g:'Go to'},
    {t:'Beginner Mode',go:'beginner',ic:'\u2609',g:'Go to'},{t:'Ask a Question',go:'ask',ic:'\u2315',g:'Go to'},
    {t:'Files',go:'files',ic:'\u25B8',g:'Go to'},{t:'Functions',go:'functions',ic:'\u0192',g:'Go to'},
    {t:'API Explorer',go:'apis',ic:'\u21C4',g:'Go to'},{t:'Database',go:'database',ic:'\u25A4',g:'Go to'},
    {t:'Business Flows',go:'flows',ic:'\u2933',g:'Go to'},{t:'Trace & Impact',go:'trace',ic:'\u2325',g:'Go to'},
    {t:'Security',go:'security',ic:'\u26E8',g:'Go to'},{t:'Compare Versions',go:'compare',ic:'\u21C5',g:'Go to'}
  ];
  (window.RI_NAV_ADVANCED||[]).forEach(function(n){pages.push({t:n.label,go:n.page,ic:n.ic,g:'Tools'});});
  return pages;
}
function cmdkRender(q){
  var list=document.getElementById('cmdk-list');var ql=q.toLowerCase().trim();
  var out=[];
  // page/tool matches
  cmdkSources().forEach(function(p){if(!ql||p.t.toLowerCase().indexOf(ql)>=0)out.push(p);});
  // symbol matches when typing
  if(ql.length>=2){
    var d=D();var added=0;
    d.functions.forEach(function(fn){if(added<8&&fn.name.toLowerCase().indexOf(ql)>=0){out.push({t:fn.name+'()',go:'function/'+encodeURIComponent(fn.id),ic:'\u0192',g:'Functions',meta:baseName(fn.file)});added++;}});
    var af=0;d.files.forEach(function(f){if(af<6&&f.path.toLowerCase().indexOf(ql)>=0){out.push({t:baseName(f.path),go:'file/'+encodeURIComponent(f.path),ic:'\u25B8',g:'Files',meta:f.lang||''});af++;}});
    var at=0;d.tables.forEach(function(t){if(at<5&&t.name.toLowerCase().indexOf(ql)>=0){out.push({t:t.name,go:'table/'+encodeURIComponent(t.name),ic:'\u25A4',g:'Tables'});at++;}});
  }
  cmdkItems=out.slice(0,40);if(cmdkSel>=cmdkItems.length)cmdkSel=0;
  var lastG=null;var html='';
  cmdkItems.forEach(function(it,i){
    if(it.g!==lastG){html+='<div class="cmdk-group">'+esc(it.g)+'</div>';lastG=it.g;}
    html+='<div class="cmdk-item'+(i===cmdkSel?' sel':'')+'" data-i="'+i+'"><span class="cic">'+it.ic+'</span><span>'+esc(it.t)+'</span>'+(it.meta?'<span class="cmeta">'+esc(it.meta)+'</span>':'')+'</div>';
  });
  if(!cmdkItems.length)html='<div class="empty" style="padding:24px">No matches</div>';
  list.innerHTML=html;
  Array.prototype.forEach.call(list.querySelectorAll('.cmdk-item'),function(it){it.addEventListener('click',function(){cmdkGo(+it.dataset.i);});});
}
function cmdkGo(i){var it=cmdkItems[i];if(!it)return;cmdkClose();nav(it.go);}

document.addEventListener('DOMContentLoaded',function(){
  // menu toggle (mobile)
  var mt=document.getElementById('menu-toggle');
  if(mt)mt.addEventListener('click',function(){document.getElementById('sidebar').classList.toggle('open');});
  // command palette input handlers
  var inp=document.getElementById('cmdk-input');var ov=document.getElementById('cmdk-overlay');
  if(inp){
    inp.addEventListener('input',function(){cmdkSel=0;cmdkRender(inp.value);});
    inp.addEventListener('keydown',function(e){
      if(e.key==='ArrowDown'){e.preventDefault();cmdkSel=Math.min(cmdkSel+1,cmdkItems.length-1);cmdkRender(inp.value);}
      else if(e.key==='ArrowUp'){e.preventDefault();cmdkSel=Math.max(cmdkSel-1,0);cmdkRender(inp.value);}
      else if(e.key==='Enter'){e.preventDefault();cmdkGo(cmdkSel);}
      else if(e.key==='Escape'){cmdkClose();}
    });
  }
  if(ov)ov.addEventListener('click',function(e){if(e.target===ov)cmdkClose();});
  // global Cmd/Ctrl-K
  document.addEventListener('keydown',function(e){
    if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){
      if(document.getElementById('app').classList.contains('on')){e.preventDefault();
        if(document.getElementById('cmdk-overlay').classList.contains('show'))cmdkClose();else cmdkOpen();}
    }
    else if(e.key==='g'&&document.activeElement===document.body){/* reserved for g-then-key nav */}
  });
});
})();
