/* pages2.js — API, database, deps, flows, quality, security, graph, compare. */
(function(){
'use strict';
var A=window.RIAPP,h=A.h,el=A.el,esc=A.esc,num=A.num,baseName=A.baseName,route=A.route,nav=A.nav;
var langColor=A.langColor,layerColor=A.layerColor;
function D(){return A.D;}function IDX(){return A.IDX;}
var U=A.ui,view=U.view,pt=U.pt,card=U.card,backBtn=U.backBtn,chips=U.chips,methodBadge=U.methodBadge,table=U.table,kvBox=U.kvBox,tableChip=U.tableChip;

// ============ API EXPLORER ============
route('apis',function(content,arg){
  var d=D();
  var v=view(pt('API Explorer',num(d.routes.length)+' HTTP routes discovered across frameworks. Method, path, framework, and defining file.'));
  var fb=h('div',{class:'filter-bar'});
  var q=h('input',{class:'grow',placeholder:'Filter by path, method, framework...',value:arg||''});
  var fwSel=h('select');fwSel.appendChild(h('option',{value:'',text:'All frameworks'}));
  var fws={};d.routes.forEach(function(r){fws[r.framework]=1;});Object.keys(fws).sort().forEach(function(f){fwSel.appendChild(h('option',{value:f,text:f}));});
  var note=h('span',{class:'count-note'});fb.appendChild(q);fb.appendChild(fwSel);fb.appendChild(note);v.appendChild(fb);
  if(!d.routes.length)v.appendChild(el('<div class="callout">No HTTP routes were detected. This repository may be a library, CLI, or use a routing style not yet recognized.</div>'));
  var wrap=h('div',{class:'card',style:'padding:0;max-height:70vh;overflow:auto'});v.appendChild(wrap);content.innerHTML='';content.appendChild(v);
  function draw(){var term=q.value.toLowerCase().trim(),fw=fwSel.value;
    var list=d.routes.filter(function(r){if(fw&&r.framework!==fw)return false;return !term||(r.method+' '+r.path+' '+r.framework).toLowerCase().indexOf(term)>=0;});
    note.textContent=list.length+' routes';
    var rows=list.map(function(r){return{onclick:function(){nav('api/'+encodeURIComponent(r.method+' '+r.path+' @'+r.file));},cells:[methodBadge(r.method),'<span class="mono">'+esc(r.path)+'</span>','<span class="badge b-tag">'+esc(r.framework)+'</span>','<span class="mono mini">'+esc(baseName(r.file))+'</span>'],sort:[r.method,r.path,r.framework,baseName(r.file)]};});
    wrap.innerHTML='';wrap.appendChild(table(['','Path','Framework','File'],rows,1));
  }
  q.addEventListener('input',draw);fwSel.addEventListener('change',draw);draw();
});
route('api',function(content,key){
  var d=D();
  var atIdx=key.lastIndexOf(' @');var mp=key.slice(0,atIdx),file=key.slice(atIdx+2);
  var sp=mp.indexOf(' ');var method=mp.slice(0,sp),path=mp.slice(sp+1);
  var r=d.routes.find(function(x){return x.method===method&&x.path===path&&x.file===file;})||d.routes.find(function(x){return x.method===method&&x.path===path;});
  if(!r){content.innerHTML='<div class="view"><div class="callout danger">Route not found</div></div>';return;}
  var v=view([]);v.appendChild(backBtn('API Explorer','apis'));
  v.appendChild(el('<div class="detail-head"><h1>'+methodBadge(r.method)+' '+esc(r.path)+'</h1><span class="badge b-tag">'+esc(r.framework)+'</span></div>'));
  v.appendChild(el('<div class="detail-sub"><span class="c-link" onclick="RINAV(\'file/'+encodeURIComponent(r.file)+'\')">'+esc(r.file)+'</span>'+(r.line?' : '+r.line:'')+'</div>'));
  v.appendChild(card('Contract',kvBox([['Method',methodBadge(r.method)],['Path','<span class="mono">'+esc(r.path)+'</span>'],['Framework',r.framework],['Defined in','<span class="mono">'+esc(r.file)+'</span>']])));
  // functions in the defining file + tables touched
  var fns=IDX().fnsByFile[r.file]||[];
  if(fns.length)v.appendChild(card('Handlers / functions in this file','<div class="tag-row">'+fns.slice(0,20).map(function(fn){return '<span class="chip" onclick="RINAV(\'function/'+encodeURIComponent(fn.id)+'\')">'+esc(fn.name)+'</span>';}).join('')+'</div>'));
  var tw=new Set(),tr=new Set();
  (d.dbAccess||[]).forEach(function(hh){if(hh.file!==r.file||!hh.table)return;var write=/write|insert|update|delete|create|save|upsert/i.test(hh.kind+' '+(hh.op||''));if(write)tw.add(hh.table);else tr.add(hh.table);});
  if(tw.size||tr.size)v.appendChild(card('Database tables in this file',[tw.size?'<h3>Writes</h3>'+chips([...tw],function(t){return tableChip(t,'wr');}):'',tr.size?'<h3>Reads</h3>'+chips([...tr],function(t){return tableChip(t,'rd');}):'']));
  // related flow
  var flows=d.flows.filter(function(fl){return(fl.routes||[]).some(function(rr){return rr.file===r.file;});});
  if(flows.length)v.appendChild(card('Business process','<div class="tag-row">'+flows.map(function(fl){return '<span class="chip" onclick="RINAV(\'flow/'+encodeURIComponent(fl.id)+'\')">'+esc(fl.name)+'</span>';}).join('')+'</div>'));
  content.innerHTML='';content.appendChild(v);
});

// ============ DATABASE ============
route('database',function(content,arg){
  var d=D();
  var v=view(pt('Database Explorer',num(d.tables.length)+' tables referenced across the code (SQL DDL, ORM calls, query builders). Click one for readers, writers, and related files.'));
  if(!d.tables.length){v.appendChild(el('<div class="callout">No database tables detected. The repository may not use a recognized database/ORM, or accesses use a style not yet detected.</div>'));content.innerHTML='';content.appendChild(v);return;}
  var fb=h('div',{class:'filter-bar'});var q=h('input',{class:'grow',placeholder:'Filter tables...',value:arg||''});var note=h('span',{class:'count-note'});fb.appendChild(q);fb.appendChild(note);v.appendChild(fb);
  var wrap=h('div',{class:'card',style:'padding:0;max-height:70vh;overflow:auto'});v.appendChild(wrap);content.innerHTML='';content.appendChild(v);
  function draw(){var term=q.value.toLowerCase().trim();
    var list=d.tables.filter(function(t){return !term||t.name.toLowerCase().indexOf(term)>=0;});
    note.textContent=list.length+' tables';
    var rows=list.map(function(t){return{onclick:function(){nav('table/'+encodeURIComponent(t.name));},cells:['<span class="mono">'+esc(t.name)+'</span>','<span class="mini">'+t.kinds.join(', ')+'</span>',t.readBy.length,t.writtenBy.length,t.accesses],sort:[t.name,t.kinds.join(),t.readBy.length,t.writtenBy.length,t.accesses]};});
    wrap.innerHTML='';wrap.appendChild(table(['Table','Access kinds','Readers','Writers','Total'],rows,4));
  }
  q.addEventListener('input',draw);draw();
});
route('table',function(content,name){
  var d=D();var t=IDX().tableByName[name];
  if(!t){content.innerHTML='<div class="view"><div class="callout danger">Table not found: '+esc(name)+'</div></div>';return;}
  var v=view([]);v.appendChild(backBtn('Database','database'));
  v.appendChild(el('<div class="detail-head"><h1>'+esc(t.name)+'</h1><span class="badge b-amber">table</span></div>'));
  v.appendChild(el('<div class="detail-sub">'+t.accesses+' access site(s)'+(t.definedIn?' &middot; defined in '+esc(t.definedIn):'')+'</div>'));
  v.appendChild(card('Access',kvBox([['Access kinds',t.kinds.join(', ')],['Defined in (DDL)',t.definedIn?'<span class="mono">'+esc(t.definedIn)+'</span>':'not found (referenced only)'],['Read by',t.readBy.length+' file(s)'],['Written by',t.writtenBy.length+' file(s)']])));
  v.appendChild(card('Written by ('+t.writtenBy.length+')',t.writtenBy.length?'<div class="tag-row">'+t.writtenBy.map(function(p){return '<span class="chip wr" onclick="RINAV(\'file/'+encodeURIComponent(p)+'\')">'+esc(baseName(p))+'</span>';}).join('')+'</div>':'<span class="mini">none</span>'));
  v.appendChild(card('Read by ('+t.readBy.length+')',t.readBy.length?'<div class="tag-row">'+t.readBy.map(function(p){return '<span class="chip rd" onclick="RINAV(\'file/'+encodeURIComponent(p)+'\')">'+esc(baseName(p))+'</span>';}).join('')+'</div>':'<span class="mini">none</span>'));
  content.innerHTML='';content.appendChild(v);
});

// ============ DEPENDENCIES ============
route('deps',function(content,arg){
  var d=D();
  var v=view(pt('Dependencies',num(d.dependencies.length)+' external dependencies from '+[...new Set(d.dependencies.map(function(x){return x.ecosystem;}))].join(', ')+' manifests.'));
  var fb=h('div',{class:'filter-bar'});var q=h('input',{class:'grow',placeholder:'Filter...',value:arg||''});
  var scSel=h('select');['','runtime','dev','peer'].forEach(function(s){scSel.appendChild(h('option',{value:s,text:s||'All scopes'}));});
  var note=h('span',{class:'count-note'});fb.appendChild(q);fb.appendChild(scSel);fb.appendChild(note);v.appendChild(fb);
  var wrap=h('div',{class:'card',style:'padding:0;max-height:70vh;overflow:auto'});v.appendChild(wrap);content.innerHTML='';content.appendChild(v);
  function draw(){var term=q.value.toLowerCase().trim(),sc=scSel.value;
    var list=d.dependencies.filter(function(x){if(sc&&x.scope!==sc)return false;return !term||x.name.toLowerCase().indexOf(term)>=0;});
    note.textContent=list.length+' deps';
    var rows=list.map(function(x){return{cells:['<span class="mono">'+esc(x.name)+'</span>','<span class="mini mono">'+esc(x.version||'')+'</span>','<span class="badge b-tag">'+esc(x.scope||'')+'</span>',x.ecosystem],sort:[x.name,x.version||'',x.scope||'',x.ecosystem]};});
    wrap.innerHTML='';wrap.appendChild(table(['Package','Version','Scope','Ecosystem'],rows,0));
  }
  q.addEventListener('input',draw);scSel.addEventListener('change',draw);draw();
});

// ============ FLOWS ============
route('flows',function(content){
  var d=D();
  var v=view(pt('Business Flows',d.flows.length+' workflows inferred from routes + call chains + database writes. Click one for its step diagram.'));
  if(!d.flows.length){v.appendChild(el('<div class="callout">No flows inferred.</div>'));content.innerHTML='';content.appendChild(v);return;}
  var grid=h('div',{class:'grid',style:'grid-template-columns:repeat(auto-fill,minmax(300px,1fr))'});
  d.flows.forEach(function(fl){
    var c=h('div',{class:'card',style:'margin:0;cursor:pointer',onclick:function(){nav('flow/'+encodeURIComponent(fl.id));}});
    c.appendChild(el('<h2 style="margin-bottom:6px">'+esc(fl.name)+'</h2>'));
    c.appendChild(el('<div class="mini" style="margin-bottom:8px">'+esc(fl.trigger)+'</div>'));
    c.appendChild(el('<div class="tag-row"><span class="badge b-tag">'+fl.functionCount+' functions</span>'+(fl.tablesWritten.length?'<span class="badge b-amber">'+fl.tablesWritten.length+' writes</span>':'')+(fl.routes&&fl.routes.length?'<span class="badge b-accent">'+fl.routes.length+' routes</span>':'')+'</div>'));
    grid.appendChild(c);
  });
  v.appendChild(grid);content.innerHTML='';content.appendChild(v);
});
route('flow',function(content,id){
  var fl=IDX().flowById[id];
  if(!fl){content.innerHTML='<div class="view"><div class="callout danger">Flow not found</div></div>';return;}
  var v=view([]);v.appendChild(backBtn('Business Flows','flows'));
  v.appendChild(el('<div class="detail-head"><h1 style="font-family:var(--sans)">'+esc(fl.name)+'</h1><span class="badge b-tag">'+esc(fl.kind)+'</span></div>'));
  v.appendChild(el('<div class="detail-sub" style="font-family:var(--sans)">'+esc(fl.trigger)+'</div>'));
  var sc=card('Flow steps',null);var box=h('div');
  fl.steps.forEach(function(s,i){
    var node=h('div',{class:'flow-node k-'+s.kind});
    node.appendChild(el('<div class="fl">'+(s.kind==='entry'?'&#9635; ':'&#9881; ')+esc(s.label)+'</div>'));
    if(s.writes&&s.writes.length)node.appendChild(el('<div class="fd">writes: '+s.writes.map(esc).join(', ')+'</div>'));
    if(s.ref&&IDX().fileByPath[s.ref]){node.style.cursor='pointer';node.addEventListener('click',(function(rr){return function(){nav('file/'+encodeURIComponent(rr));};})(s.ref));}
    box.appendChild(h('div',{class:'flow-step'},[node]));
    if(i<fl.steps.length-1)box.appendChild(h('div',{class:'flow-arrow',text:'\u2193'}));
  });
  sc.appendChild(box);v.appendChild(sc);
  var two=h('div',{class:'two'});
  two.appendChild(card('Entry routes',(fl.routes&&fl.routes.length)?'<div class="tag-row">'+fl.routes.map(function(r){return '<span class="chip" onclick="RINAV(\'api/'+encodeURIComponent(r.method+' '+r.path+' @'+r.file)+'\')">'+methodBadge(r.method)+' '+esc(r.path)+'</span>';}).join('')+'</div>':'<span class="mini">no HTTP routes (domain-keyword flow)</span>'));
  two.appendChild(card('Database writes',fl.tablesWritten.length?'<div class="tag-row">'+fl.tablesWritten.map(function(t){return tableChip(t,'wr');}).join('')+'</div>':'<span class="mini">no writes detected</span>'));
  v.appendChild(two);
  v.appendChild(card('Mermaid diagram',' <div class="mermaid-src">'+esc(mermaidFlow(fl))+'</div>'));
  content.innerHTML='';content.appendChild(v);
});
function mermaidFlow(fl){var lines=['flowchart TD'];fl.steps.forEach(function(s,i){var id='S'+i;var label=s.label.replace(/"/g,"'").slice(0,40);lines.push('  '+id+'['+label+']');if(i>0)lines.push('  S'+(i-1)+' --> '+id);});return lines.join('\n');}

// ============ DEPENDENCY GRAPH ============
route('graph',function(content){
  var d=D();
  var v=view(pt('Dependency Graph','File-level import graph (largest connected region). Scroll to zoom, drag to pan, hover to isolate a file\u2019s dependencies, click to open.'));
  var box=h('div',{class:'graph-box'});var controls=h('div',{class:'graph-controls'});var gEl=h('div',{style:'width:100%;height:100%'});
  box.appendChild(gEl);box.appendChild(controls);box.appendChild(h('div',{class:'graph-hint',text:'showing up to 300 most-connected files'}));v.appendChild(box);
  content.innerHTML='';content.appendChild(v);
  // build file import graph, keep top-connected
  var deg={};d.files.forEach(function(f){deg[f.path]=(f.importedBy?f.importedBy.length:0)+((f.imports||[]).filter(function(i){return i.resolved;}).length);});
  var top=d.files.filter(function(f){return deg[f.path]>0;}).sort(function(a,b){return deg[b.path]-deg[a.path];}).slice(0,300);
  var keep=new Set(top.map(function(f){return f.path;}));
  var nodes=top.map(function(f){return{id:f.path,label:baseName(f.path),color:layerColor(f.layer),r:4+Math.min(deg[f.path]*0.6,14),goto:'file/'+encodeURIComponent(f.path)};});
  var links=[];d.files.forEach(function(f){if(!keep.has(f.path))return;(f.imports||[]).forEach(function(imp){if(imp.resolved&&keep.has(imp.resolved))links.push({source:f.path,target:imp.resolved,weight:1});});});
  var g=window.Graph(gEl,{onClick:function(n){if(n.goto)nav(n.goto);}});
  g.render({nodes:nodes,links:links.slice(0,900),directed:true,iters:240});
  [['+',function(){g.zoomIn();}],['\u2212',function(){g.zoomOut();}],['\u2b1a',function(){g.fit();}]].forEach(function(cc){var b=h('button',{text:cc[0]});b.addEventListener('click',cc[1]);controls.appendChild(b);});
});

// ============ CODE QUALITY ============
route('quality',function(content){
  var d=D();var m=d.metrics;
  var v=view(pt('Code Quality','Mechanically detected signals from the import graph and AST. Static signals, not verdicts.'));
  var g=h('div',{class:'grid mgrid'});
  [['Circular deps',m.summary.circular,m.summary.circular?'red':'green'],['Dead files',m.summary.dead,m.summary.dead?'amber':'green'],['Large files',m.summary.largeFiles,'amber'],['Large functions',m.summary.largeFunctions,'amber'],['Complex functions',m.summary.complexFunctions,'amber'],['Duplicate names',m.summary.duplicateNames,''],['Duplicate blocks',m.summary.duplicateBlocks,'amber'],['Layer violations',m.summary.layerViolations,m.summary.layerViolations?'amber':'green'],['Parse errors',m.summary.parseErrors,m.summary.parseErrors?'amber':'green'],['Undocumented fns',m.undocumentedFunctions,'']].forEach(function(x){
    g.appendChild(h('div',{class:'metric'},[h('div',{class:'v '+x[2],text:num(x[1])}),h('div',{class:'l',text:x[0]})]));
  });
  v.appendChild(g);
  // circular
  var cd=card('Circular dependencies',null);
  if(!m.circularDependencies.length)cd.appendChild(el('<div class="callout">None found. The import graph is acyclic.</div>'));
  else m.circularDependencies.slice(0,40).forEach(function(cy){cd.appendChild(el('<div class="mini" style="margin:5px 0">'+cy.slice(0,8).map(function(p){return '<span class="chip" onclick="RINAV(\'file/'+encodeURIComponent(p)+'\')">'+esc(baseName(p))+'</span>';}).join(' &rarr; ')+(cy.length>8?' ...':'')+'</div>'));});
  v.appendChild(cd);
  v.appendChild(card('Dead files (no importer, not an entrypoint)',m.deadFiles.length?'<div class="tag-row">'+m.deadFiles.slice(0,120).map(function(p){return '<span class="chip" onclick="RINAV(\'file/'+encodeURIComponent(p)+'\')">'+esc(p)+'</span>';}).join('')+'</div>':'<div class="callout">None.</div>'));
  var lf=m.largeFiles.slice(0,30).map(function(f){return{onclick:function(){nav('file/'+encodeURIComponent(f.path));},cells:['<span class="mono">'+esc(f.path)+'</span>',num(f.loc)],sort:[f.path,f.loc]};});
  v.appendChild(card('Largest files',table(['File','LOC'],lf,1)));
  var cf=m.complexFunctions.slice(0,30).map(function(f){return{onclick:function(){nav('function/'+encodeURIComponent(f.id));},cells:['<span class="mono">'+esc(f.name)+'</span>','<span class="mono mini">'+esc(baseName(f.file))+'</span>',f.complexity],sort:[f.name,baseName(f.file),f.complexity]};});
  v.appendChild(card('Highest complexity functions',table(['Function','File','Cx'],cf,2)));
  if(m.duplicateBlocks.length){var db=card('Possible duplicate logic (identical name+shape in multiple places)',null);m.duplicateBlocks.slice(0,30).forEach(function(d2){db.appendChild(el('<div style="margin:6px 0"><span class="mono" style="color:var(--amber)">'+esc(d2.name)+'</span> <span class="mini">'+d2.loc+' LOC &times;'+d2.occurrences.length+'</span> <div class="tag-row">'+d2.occurrences.map(function(o){return '<span class="chip" onclick="RINAV(\'file/'+encodeURIComponent(o.file)+'\')">'+esc(baseName(o.file))+':'+o.line+'</span>';}).join('')+'</div></div>'));});v.appendChild(db);}
  if(m.layerViolations.length){var lv=card('Layer violations (heuristic)',null);m.layerViolations.slice(0,40).forEach(function(x){lv.appendChild(el('<div class="mini" style="margin:4px 0">'+esc(x.rule)+': <span class="c-link" onclick="RINAV(\'file/'+encodeURIComponent(x.from)+'\')">'+esc(baseName(x.from))+'</span> &rarr; <span class="c-link" onclick="RINAV(\'file/'+encodeURIComponent(x.to)+'\')">'+esc(baseName(x.to))+'</span></div>'));});v.appendChild(lv);}
  content.innerHTML='';content.appendChild(v);
});

// ============ SECURITY ============
route('security',function(content){
  var d=D();
  var v=view(pt('Security','Static security signals: potential secrets, dangerous calls, and risky configuration. These are heuristics to review, not confirmed vulnerabilities.'));
  var bySev={high:[],medium:[],low:[]};d.security.forEach(function(s){(bySev[s.severity]||bySev.low).push(s);});
  var g=h('div',{class:'grid mgrid'});
  [['High',bySev.high.length,'red'],['Medium',bySev.medium.length,'amber'],['Low',bySev.low.length,''],['Total',d.security.length,'']].forEach(function(x){g.appendChild(h('div',{class:'metric'},[h('div',{class:'v '+x[2],text:num(x[1])}),h('div',{class:'l',text:x[0]+' severity'})]));});
  v.appendChild(g);
  if(!d.security.length){v.appendChild(el('<div class="callout">No security signals detected by the static rules.</div>'));content.innerHTML='';content.appendChild(v);return;}
  ['high','medium','low'].forEach(function(sev){
    if(!bySev[sev].length)return;
    var c=card('<span class="sev-'+sev+'">'+sev.toUpperCase()+' ('+bySev[sev].length+')</span>',null);
    var byType={};bySev[sev].forEach(function(s){(byType[s.kind]=byType[s.kind]||[]).push(s);});
    Object.keys(byType).forEach(function(kind){
      var arr=byType[kind];
      c.appendChild(el('<div style="margin:8px 0"><div style="font-size:12.5px;margin-bottom:3px">'+esc(kind)+' <span class="mini">('+arr.length+')</span></div><div class="tag-row">'+arr.slice(0,40).map(function(s){return '<span class="chip" onclick="RINAV(\'file/'+encodeURIComponent(s.file)+'\')">'+esc(baseName(s.file))+':'+s.line+(s.snippet?' <span class="mini">'+esc(s.snippet)+'</span>':'')+'</span>';}).join('')+'</div></div>'));
    });
    v.appendChild(c);
  });
  content.innerHTML='';content.appendChild(v);
});

// ============ COMPARE ============
route('compare',function(content){
  var d=D();
  var v=view(pt('Compare Versions','Analyze two refs (branches, tags, or commits) of this repository and diff the architecture. Requires a full git clone (not a shallow/local snapshot).'));
  var input=(d.source&&d.source.input)||d.manifest.root;
  var fb=h('div',{class:'card'});
  fb.appendChild(el('<h2>Select two refs</h2>'));
  var row=h('div',{class:'filter-bar'});
  var baseI=h('input',{placeholder:'base ref (e.g. main, v1.0.0, sha)',style:'flex:1'});
  var headI=h('input',{placeholder:'head ref (e.g. develop, HEAD)',style:'flex:1'});
  var btn=h('button',{class:'btn sm',text:'Compare'});
  row.appendChild(baseI);row.appendChild(headI);row.appendChild(btn);fb.appendChild(row);
  var refsNote=h('div',{class:'mini'});fb.appendChild(refsNote);
  v.appendChild(fb);
  var out=h('div');v.appendChild(out);
  content.innerHTML='';content.appendChild(v);
  // load refs
  var id=d.source&&d.source.id;
  if(id)fetch('/api/refs?id='+id).then(function(r){return r.json();}).then(function(refs){
    if(refs.error){refsNote.textContent='(refs unavailable: '+refs.error+')';return;}
    refsNote.innerHTML='branches: '+(refs.branches||[]).slice(0,8).map(esc).join(', ')+(refs.tags&&refs.tags.length?' &middot; tags: '+refs.tags.slice(0,8).map(esc).join(', '):'');
    if(refs.branches&&refs.branches.length>1){baseI.value=refs.branches[0];headI.value=refs.branches[1];}
  }).catch(function(){});
  btn.addEventListener('click',function(){
    if(!baseI.value||!headI.value)return;
    btn.disabled=true;btn.textContent='Comparing...';out.innerHTML='<div class="callout">Cloning + analyzing both refs, this may take a moment...</div>';
    fetch('/api/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:input,baseRef:baseI.value,headRef:headI.value})})
      .then(function(r){return r.json();}).then(function(res){
        btn.disabled=false;btn.textContent='Compare';
        if(res.error){out.innerHTML='<div class="callout danger">'+esc(res.error)+'</div>';return;}
        renderDiff(out,res.diff,baseI.value,headI.value);
      }).catch(function(e){btn.disabled=false;btn.textContent='Compare';out.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
  });
});
function renderDiff(out,diff,base,head){
  out.innerHTML='';
  var g=h('div',{class:'grid mgrid'});
  [['Risk',diff.riskLabel.toUpperCase(),diff.riskLabel==='high'?'red':diff.riskLabel==='medium'?'amber':'green'],['Files Δ',(diff.deltas.files>=0?'+':'')+diff.deltas.files,''],['Functions Δ',(diff.deltas.functions>=0?'+':'')+diff.deltas.functions,''],['Routes Δ',(diff.deltas.routes>=0?'+':'')+diff.deltas.routes,''],['LOC Δ',(diff.deltas.loc>=0?'+':'')+num(diff.deltas.loc),'']].forEach(function(x){g.appendChild(h('div',{class:'metric'},[h('div',{class:'v '+x[2],text:x[1]}),h('div',{class:'l',text:x[0]})]));});
  out.appendChild(g);
  function listCard(title,added,removed,changed){
    var c=card(title,null);
    if(added&&added.length)c.appendChild(el('<h3 style="color:var(--green)">Added ('+added.length+')</h3><div class="tag-row">'+added.slice(0,60).map(function(x){return '<span class="chip">'+esc(typeof x==='string'?x:(x.name+' @'+baseName(x.file||'')))+'</span>';}).join('')+'</div>'));
    if(removed&&removed.length)c.appendChild(el('<h3 style="color:var(--red)">Removed ('+removed.length+')</h3><div class="tag-row">'+removed.slice(0,60).map(function(x){return '<span class="chip">'+esc(typeof x==='string'?x:(x.name+' @'+baseName(x.file||'')))+'</span>';}).join('')+'</div>'));
    if(changed&&changed.length)c.appendChild(el('<h3 style="color:var(--amber)">Changed ('+changed.length+')</h3><div class="tag-row">'+changed.slice(0,60).map(function(x){return '<span class="chip">'+esc(x.name||x)+(x.complexityDelta?' cxΔ'+(x.complexityDelta>0?'+':'')+x.complexityDelta:'')+'</span>';}).join('')+'</div>'));
    if((!added||!added.length)&&(!removed||!removed.length)&&(!changed||!changed.length))c.appendChild(el('<div class="mini">no changes</div>'));
    return c;
  }
  out.appendChild(listCard('Routes ('+base+' → '+head+')',diff.routes.added,diff.routes.removed));
  out.appendChild(listCard('Files',diff.files.added,diff.files.removed,diff.files.changed));
  out.appendChild(listCard('Functions',diff.functions.added,diff.functions.removed,diff.functions.changed));
  out.appendChild(listCard('Tables',diff.tables.added,diff.tables.removed));
  out.appendChild(listCard('Dependencies',diff.dependencies.added,diff.dependencies.removed,diff.dependencies.changed));
}
})();
