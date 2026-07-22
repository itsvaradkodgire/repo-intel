/* pages3.js — Phase 2 semantic + AI intelligence pages (ADDITIVE).
 * Registers NEW routes only. Does not touch Phase 1 pages/modules. Mechanical
 * pages (semantic, health, trace, impact) work with AI OFF; AI pages degrade
 * gracefully to a "configure AI" prompt. */
(function(){
'use strict';
var A=window.RIAPP,h=A.h,el=A.el,esc=A.esc,num=A.num,baseName=A.baseName,route=A.route,nav=A.nav;
var layerColor=A.layerColor;
function D(){return A.D;}function IDX(){return A.IDX;}
var U=A.ui,view=U.view,pt=U.pt,card=U.card,backBtn=U.backBtn,table=U.table,methodBadge=U.methodBadge;
function AI(){return window.RIAI;}

function sevColor(s){return s==='high'?'var(--red)':s==='medium'?'var(--amber)':'var(--green)';}
function domColor(kind){return kind==='business'?'#5b9dff':'#36d0c4';}

// ================= MODULES & DOMAINS =================
route('semantic',function(content){
  var d=D();var s=d.semantic;
  var v=view(pt('Modules & Domains','Semantic modules inferred mechanically from directory structure, naming, routes, and data access. No AI required. Click a module to explore or explain it.'));
  if(!s){v.appendChild(el('<div class="callout">Semantic layer unavailable for this index.</div>'));content.innerHTML='';content.appendChild(v);return;}
  // subsystems row
  var subs=card('Architecture layers (subsystems)',null);
  var sg=h('div',{class:'tag-row'});
  s.subsystems.forEach(function(x){sg.appendChild(el('<span class="chip" style="border-left:2px solid '+layerColor(x.layer)+'">'+esc(x.layer)+' <span class="mini">'+x.files+'</span></span>'));});
  subs.appendChild(sg);v.appendChild(subs);
  // domain grid
  var grid=h('div',{class:'grid',style:'grid-template-columns:repeat(auto-fill,minmax(280px,1fr))'});
  s.domains.forEach(function(dm){
    var c=h('div',{class:'card',style:'margin:0;cursor:pointer',onclick:function(){nav('domain/'+encodeURIComponent(dm.id));}});
    c.appendChild(el('<h2 style="margin-bottom:5px"><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+domColor(dm.kind)+'"></span> '+esc(dm.label)+'</h2>'));
    c.appendChild(el('<div class="mini" style="margin-bottom:7px">'+esc(dm.dir)+' &middot; '+dm.kind+'</div>'));
    c.appendChild(el('<div class="tag-row"><span class="badge b-tag">'+dm.fileCount+' files</span><span class="badge b-tag">'+num(dm.loc)+' LOC</span>'+(dm.routes?'<span class="badge b-accent">'+dm.routes+' routes</span>':'')+(dm.tables.length?'<span class="badge b-amber">'+dm.tables.length+' tables</span>':'')+'</div>'));
    grid.appendChild(c);
  });
  v.appendChild(grid);
  content.innerHTML='';content.appendChild(v);
});
route('domain',function(content,id){
  var d=D();var s=d.semantic;var dm=s&&s.domains.find(function(x){return x.id===id;});
  if(!dm){content.innerHTML='<div class="view"><div class="callout danger">Module not found</div></div>';return;}
  var v=view([]);v.appendChild(backBtn('Modules & Domains','semantic'));
  v.appendChild(el('<div class="detail-head"><h1 style="font-family:var(--sans)">'+esc(dm.label)+'</h1><span class="badge b-tag">'+dm.kind+'</span></div>'));
  v.appendChild(el('<div class="detail-sub">'+esc(dm.dir)+' &middot; '+dm.fileCount+' files &middot; '+num(dm.loc)+' LOC</div>'));
  v.appendChild(explainBar({kind:'domain',title:dm.label,query:dm.label+' '+dm.dir}));
  if(dm.tables.length)v.appendChild(card('Database tables','<div class="tag-row">'+dm.tables.map(function(t){return '<span class="chip wr" onclick="RINAV(\'table/'+encodeURIComponent(t)+'\')">'+esc(t)+'</span>';}).join('')+'</div>'));
  var rts=d.routes.filter(function(r){return dm.files.indexOf(r.file)>=0;});
  if(rts.length)v.appendChild(card('API routes ('+rts.length+')','<div class="tag-row">'+rts.slice(0,40).map(function(r){return '<span class="chip" onclick="RINAV(\'api/'+encodeURIComponent(r.method+' '+r.path+' @'+r.file)+'\')">'+methodBadge(r.method)+' '+esc(r.path)+'</span>';}).join('')+'</div>'));
  v.appendChild(card('Files ('+dm.fileCount+')','<div class="tag-row">'+dm.files.slice(0,120).map(function(p){return '<span class="chip" onclick="RINAV(\'file/'+encodeURIComponent(p)+'\')">'+esc(baseName(p))+'</span>';}).join('')+'</div>'));
  content.innerHTML='';content.appendChild(v);
});

// ================= REPOSITORY HEALTH =================
route('health',function(content){
  var d=D();var s=d.semantic;
  var v=view(pt('Repository Health','Mechanical health scores (0-100) computed from the static-analysis metrics. Higher is better. These are heuristics for orientation, not grades.'));
  if(!s){v.appendChild(el('<div class="callout">Unavailable.</div>'));content.innerHTML='';content.appendChild(v);return;}
  var hh=s.health;
  // overall gauge
  var ov=card(null,null);
  ov.appendChild(el('<div style="display:flex;align-items:center;gap:20px"><div style="font-size:52px;font-weight:800;font-family:var(--mono);color:'+scoreColor(hh.overall)+'">'+hh.overall+'</div><div><div style="font-size:15px;font-weight:650">Overall health</div><div class="mini">composite of the 8 sub-scores below</div></div></div>'));
  v.appendChild(ov);
  // sub-score bars
  var sc=card('Sub-scores',null);
  hh.scores.forEach(function(x){
    sc.appendChild(h('div',{class:'bar-row',style:'cursor:default'},[
      h('div',{style:'width:140px;font-size:12.5px;color:var(--dim)',text:x.label}),
      h('div',{class:'bar-track'},[h('div',{class:'bar-fill',style:'width:'+x.value+'%;background:'+scoreColor(x.value)})]),
      h('div',{style:'width:34px;text-align:right;font-family:var(--mono);font-size:12.5px;color:'+scoreColor(x.value),text:String(x.value)})
    ]));
  });
  v.appendChild(sc);
  // evidence
  var ev=hh.evidence;
  v.appendChild(card('Evidence (from static analysis)',el('<div class="kv">'+
    kvline('Documented files',ev.docFiles+' / '+ev.totalFiles)+
    kvline('Test files',ev.testFiles)+
    kvline('Circular dependencies',ev.circular)+
    kvline('Dead files',ev.dead)+
    kvline('Complex functions',ev.complexFns)+
    kvline('Large files',ev.largeFiles)+
    kvline('High-severity security',ev.highSec)+
    kvline('Layer violations',ev.layerViolations)+
    '</div>')));
  v.appendChild(explainBar({kind:'health',title:'repository health',query:'architecture health documentation testing coupling'}));
  // critical + risk
  var two=h('div',{class:'two'});
  var cm=card('Critical modules (graph centrality)',null);
  s.criticalModules.slice(0,10).forEach(function(m){cm.appendChild(el('<div class="bar-row" onclick="RINAV(\'file/'+encodeURIComponent(m.path)+'\')"><span class="mono" style="font-size:12px">'+esc(baseName(m.path))+'</span><span class="mini" style="margin-left:auto">fan-in '+m.fanIn+' &middot; score '+m.score+'</span></div>'));});
  two.appendChild(cm);
  var ra=card('Risk areas',null);
  if(!s.riskAreas.length)ra.appendChild(el('<div class="empty">No notable risk areas.</div>'));
  s.riskAreas.slice(0,10).forEach(function(r){ra.appendChild(el('<div style="margin:6px 0;cursor:pointer" onclick="RINAV(\'trace/impact/file/'+encodeURIComponent(r.path)+'\')"><span class="mono" style="font-size:12px">'+esc(baseName(r.path))+'</span> <span class="mini">'+esc(r.reasons.join('; '))+'</span></div>'));});
  two.appendChild(ra);
  v.appendChild(two);
  content.innerHTML='';content.appendChild(v);
});
function kvline(k,val){return '<div class="k">'+esc(k)+'</div><div class="v">'+esc(String(val))+'</div>';}
function scoreColor(v){return v>=75?'var(--green)':v>=50?'var(--amber)':'var(--red)';}

// ================= TRACE & IMPACT =================
route('trace',function(content,arg){
  // arg may be "impact/file/<path>" or "request/<method>/<path>" etc when deep-linked
  var d=D();
  if(arg){ return renderTraceResult(content,arg); }
  var v=view(pt('Trace & Impact','Follow data, requests, and business flows through the code, or see what breaks if you remove something. All computed from the knowledge graph (no AI).'));
  // three pickers
  var two=h('div',{class:'two'});
  // impact picker
  var ic=card('Impact analysis &mdash; "what breaks if I delete this?"',null);
  var fileSel=pickerInput('file path...',d.files.filter(function(f){return f.functions;}).map(function(f){return f.path;}));
  var ib=h('button',{class:'btn sm',text:'Analyze impact'});
  ib.addEventListener('click',function(){if(fileSel.value)nav('trace/impact/file/'+encodeURIComponent(fileSel.value));});
  ic.appendChild(fileSel.wrap);ic.appendChild(el('<div style="height:8px"></div>'));ic.appendChild(ib);
  two.appendChild(ic);
  // request picker
  var rc=card('Follow request',null);
  if(d.routes.length){
    var routeSel=h('select',{style:'width:100%'});
    d.routes.slice(0,300).forEach(function(r){routeSel.appendChild(h('option',{value:r.method+'|'+r.path+'|'+r.file,text:r.method+' '+r.path}));});
    var rb=h('button',{class:'btn sm',text:'Follow request',style:'margin-top:8px'});
    rb.addEventListener('click',function(){var p=routeSel.value.split('|');nav('trace/request/'+encodeURIComponent(p[0])+'/'+encodeURIComponent(p[1])+'/'+encodeURIComponent(p[2]));});
    rc.appendChild(routeSel);rc.appendChild(el('<div style="height:4px"></div>'));rc.appendChild(rb);
  } else rc.appendChild(el('<div class="mini">No API routes detected.</div>'));
  two.appendChild(rc);
  v.appendChild(two);
  var two2=h('div',{class:'two'});
  // data picker
  var dc=card('Follow data (table lifecycle)',null);
  if(d.tables.length){
    var tblSel=h('select',{style:'width:100%'});d.tables.forEach(function(t){tblSel.appendChild(h('option',{value:t.name,text:t.name}));});
    var db=h('button',{class:'btn sm',text:'Follow data',style:'margin-top:8px'});
    db.addEventListener('click',function(){nav('trace/data/'+encodeURIComponent(tblSel.value));});
    dc.appendChild(tblSel);dc.appendChild(el('<div style="height:4px"></div>'));dc.appendChild(db);
  } else dc.appendChild(el('<div class="mini">No database tables detected.</div>'));
  two2.appendChild(dc);
  // flow picker
  var fc=card('Follow business flow',null);
  if(d.flows.length){
    var flSel=h('select',{style:'width:100%'});d.flows.forEach(function(f){flSel.appendChild(h('option',{value:f.id,text:f.name}));});
    var fb=h('button',{class:'btn sm',text:'Follow flow',style:'margin-top:8px'});
    fb.addEventListener('click',function(){nav('trace/flow/'+encodeURIComponent(flSel.value));});
    fc.appendChild(flSel);fc.appendChild(el('<div style="height:4px"></div>'));fc.appendChild(fb);
  } else fc.appendChild(el('<div class="mini">No flows inferred.</div>'));
  two2.appendChild(fc);
  v.appendChild(two2);
  content.innerHTML='';content.appendChild(v);
});
function pickerInput(ph,options){
  var wrap=h('div');var inp=h('input',{placeholder:ph,style:'width:100%',list:'ri-picker-list'});
  var dl=h('datalist',{id:'ri-picker-list'});options.slice(0,2000).forEach(function(o){dl.appendChild(h('option',{value:o}));});
  wrap.appendChild(inp);wrap.appendChild(dl);
  return {wrap:wrap,get value(){return inp.value;}};
}
function renderTraceResult(content,arg){
  var parts=arg.split('/');var kind=parts[0];
  var v=view([]);v.appendChild(backBtn('Trace & Impact','trace'));
  var id=D().source.id;
  var q;
  if(kind==='impact'){
    var target=decodeURIComponent(parts.slice(2).join('/'));
    q='/api/impact?id='+id+'&kind='+parts[1]+'&target='+encodeURIComponent(target);
    v.appendChild(el('<div class="detail-head"><h1 style="font-family:var(--sans)">Impact: '+esc(baseName(target))+'</h1></div>'));
    v.appendChild(el('<div class="detail-sub">what breaks if you delete <span class="mono">'+esc(target)+'</span></div>'));
  } else if(kind==='request'){
    q='/api/trace?id='+id+'&kind=request&method='+encodeURIComponent(parts[1])+'&path='+encodeURIComponent(parts[2])+'&file='+encodeURIComponent(parts.slice(3).join('/'));
    v.appendChild(el('<div class="detail-head"><h1 style="font-family:var(--sans)">Follow request</h1></div>'));
  } else if(kind==='data'){
    q='/api/trace?id='+id+'&kind=data&table='+encodeURIComponent(parts.slice(1).join('/'));
    v.appendChild(el('<div class="detail-head"><h1 style="font-family:var(--sans)">Follow data: '+esc(parts[1])+'</h1></div>'));
  } else if(kind==='flow'){
    q='/api/trace?id='+id+'&kind=flow&flow='+encodeURIComponent(parts.slice(1).join('/'));
    v.appendChild(el('<div class="detail-head"><h1 style="font-family:var(--sans)">Follow flow</h1></div>'));
  }
  var body=h('div');body.appendChild(el('<div class="callout">Loading trace...</div>'));
  v.appendChild(body);content.innerHTML='';content.appendChild(v);
  fetch(q).then(function(r){return r.json();}).then(function(res){
    body.innerHTML='';
    if(res.error){body.appendChild(el('<div class="callout danger">'+esc(res.error)+'</div>'));return;}
    if(kind==='impact')renderImpact(body,res);
    else if(kind==='request')renderRequest(body,res);
    else if(kind==='data')renderData(body,res);
    else if(kind==='flow')nav('flow/'+encodeURIComponent(parts.slice(1).join('/')));
  }).catch(function(e){body.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
}
function renderImpact(body,res){
  var g=h('div',{class:'grid mgrid'});
  g.appendChild(h('div',{class:'metric'},[h('div',{class:'v',style:'color:'+sevColor(res.severity),text:res.severity.toUpperCase()}),h('div',{class:'l',text:'Blast radius'})]));
  Object.keys(res.summary).forEach(function(k){g.appendChild(h('div',{class:'metric'},[h('div',{class:'v',text:num(res.summary[k])}),h('div',{class:'l',text:k})]));});
  body.appendChild(g);
  if(res.affectedFiles&&res.affectedFiles.length)body.appendChild(card('Affected files ('+res.affectedFiles.length+')','<div class="tag-row">'+res.affectedFiles.slice(0,120).map(function(p){return '<span class="chip" onclick="RINAV(\'file/'+encodeURIComponent(p)+'\')">'+esc(baseName(p))+'</span>';}).join('')+'</div>'));
  if(res.affectedFunctions&&res.affectedFunctions.length)body.appendChild(card('Affected functions ('+res.affectedFunctions.length+')','<div class="tag-row">'+res.affectedFunctions.slice(0,80).map(function(f){return '<span class="chip" onclick="RINAV(\'function/'+encodeURIComponent(f.id)+'\')">'+esc(f.name)+'</span>';}).join('')+'</div>'));
  if(res.affectedRoutes&&res.affectedRoutes.length)body.appendChild(card('Routes that would break','<div class="tag-row">'+res.affectedRoutes.map(function(r){return '<span class="chip">'+methodBadge(r.method)+' '+esc(r.path)+'</span>';}).join('')+'</div>'));
  if(res.affectedTables&&res.affectedTables.length)body.appendChild(card('Tables it accesses','<div class="tag-row">'+res.affectedTables.map(function(t){return '<span class="chip wr" onclick="RINAV(\'table/'+encodeURIComponent(t)+'\')">'+esc(t)+'</span>';}).join('')+'</div>'));
  if(res.affectedFlows&&res.affectedFlows.length)body.appendChild(card('Business flows affected','<div class="tag-row">'+res.affectedFlows.map(function(f){return '<span class="chip" onclick="RINAV(\'flow/'+encodeURIComponent(f.id)+'\')">'+esc(f.name)+'</span>';}).join('')+'</div>'));
  if(res.affectedTests&&res.affectedTests.length)body.appendChild(card('Tests affected','<div class="tag-row">'+res.affectedTests.slice(0,60).map(function(p){return '<span class="chip" onclick="RINAV(\'file/'+encodeURIComponent(p)+'\')">'+esc(baseName(p))+'</span>';}).join('')+'</div>'));
}
function renderRequest(body,res){
  if(!res){body.appendChild(el('<div class="callout danger">Route not found.</div>'));return;}
  var box=card('Request lifecycle',null);var steps=h('div');
  res.steps.forEach(function(s,i){
    var node=h('div',{class:'flow-node k-'+(s.kind==='route'?'entry':'function')});
    node.appendChild(el('<div class="fl">'+esc(s.label)+'</div>'));
    if(s.detail)node.appendChild(el('<div class="fd">'+esc(s.detail)+'</div>'));
    if(s.ref&&IDX().fileByPath[s.ref]){node.style.cursor='pointer';node.addEventListener('click',(function(r){return function(){nav('file/'+encodeURIComponent(r));};})(s.ref));}
    steps.appendChild(h('div',{class:'flow-step'},[node]));
    if(i<res.steps.length-1)steps.appendChild(h('div',{class:'flow-arrow',text:'\u2193'}));
  });
  box.appendChild(steps);body.appendChild(box);
  if(res.tables.length)body.appendChild(card('Tables touched','<div class="tag-row">'+res.tables.map(function(t){return '<span class="chip">'+esc(t)+'</span>';}).join('')+'</div>'));
}
function renderData(body,res){
  var box=card('Data lifecycle: '+esc(res.target),null);var steps=h('div');
  res.stages.forEach(function(st,i){
    if(!st.sites.length)return;
    var node=h('div',{class:'flow-node k-function'});
    node.appendChild(el('<div class="fl">'+esc(st.label)+' <span class="mini">('+st.sites.length+' site'+(st.sites.length>1?'s':'')+')</span></div>'));
    node.appendChild(el('<div class="fd">'+st.sites.slice(0,6).map(function(s){return esc(baseName(s.file))+':'+s.line;}).join(', ')+'</div>'));
    steps.appendChild(h('div',{class:'flow-step'},[node]));
    steps.appendChild(h('div',{class:'flow-arrow',text:'\u2193'}));
  });
  box.appendChild(steps);body.appendChild(box);
  // reader/writer files
  var files={};res.stages.forEach(function(st){st.sites.forEach(function(s){files[s.file]=1;});});
  body.appendChild(card('Files touching this table','<div class="tag-row">'+Object.keys(files).slice(0,60).map(function(p){return '<span class="chip" onclick="RINAV(\'file/'+encodeURIComponent(p)+'\')">'+esc(baseName(p))+'</span>';}).join('')+'</div>'));
}

// ================= AI-DRIVEN PAGES (degrade gracefully) =================
route('overview',function(content){
  aiPage(content,'AI Overview','A plain-English explanation of the whole repository, generated from the analysis. Grounded in the index; cites files.',function(body){
    generateInto(body,'/api/ai/generate',{kind:'overview'},'overview');
  });
});
route('learn',function(content){
  var d=D();var s=d.semantic;
  var v=view(pt('Learn Repository','A guided path through the codebase for a new engineer. Ordering + time estimate are mechanical; AI explains each step when configured.'));
  if(s&&s.learningPath){
    var lp=s.learningPath;
    v.appendChild(el('<div class="callout"><b>Estimated learning time: ~'+Math.round(lp.estimatedMinutes/60*10)/10+' hours</b> ('+lp.estimatedMinutes+' min) across '+lp.steps.length+' steps. This is a reading-time heuristic from code size.</div>'));
    lp.steps.forEach(function(st,i){
      var c=h('div',{class:'card'});
      c.appendChild(el('<h2><span style="color:var(--accent)">'+st.order+'.</span> '+esc(st.label)+'</h2>'));
      c.appendChild(el('<div class="mini" style="margin-bottom:6px">'+esc(st.why)+' &middot; '+st.files+' files'+(st.routes?', '+st.routes+' routes':'')+(st.tables.length?', tables: '+st.tables.map(esc).join(', '):'')+'</div>'));
      var actions=h('div',{class:'tag-row'});
      var open=h('span',{class:'chip',text:'Open module'});open.addEventListener('click',(function(id){return function(){nav('domain/'+encodeURIComponent(id));};})(st.id));
      actions.appendChild(open);
      var teach=h('span',{class:'chip',text:'\u2727 Teach me this'});
      var out=h('div',{style:'margin-top:8px'});
      teach.addEventListener('click',(function(step,outEl){return function(){
        if(!AI().aiReady()){outEl.innerHTML='<div class="callout warn">Configure AI in Settings to generate teaching notes. The mechanical outline above works without AI.</div>';return;}
        outEl.innerHTML='<div class="mini">generating...</div>';var acc='';
        AI().streamGenerate('/api/ai/generate',{id:D().source.id,kind:'mentor',step:step,config:AI().getCfg()},function(t){acc+=t;outEl.innerHTML=AI().renderMd(acc);},function(name,data){if(name==='error')outEl.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';});
      };})(st,out));
      actions.appendChild(teach);
      c.appendChild(actions);c.appendChild(out);
      v.appendChild(c);
    });
  } else v.appendChild(el('<div class="callout">Learning path unavailable.</div>'));
  content.innerHTML='';content.appendChild(v);
});

// ================= COMMIT INTELLIGENCE =================
route('commit',function(content){
  var d=D();
  var v=view(pt('Commit Intelligence','Diff two refs and get a structural change report. The diff is mechanical; AI explains impact when configured.'));
  var input=(d.source&&d.source.input)||d.manifest.root;
  var fbc=h('div',{class:'card'});fbc.appendChild(el('<h2>Compare two refs</h2>'));
  var row=h('div',{class:'filter-bar'});
  var baseI=h('input',{placeholder:'base ref',style:'flex:1'});var headI=h('input',{placeholder:'head ref',style:'flex:1'});
  var btn=h('button',{class:'btn sm',text:'Analyze change'});
  row.appendChild(baseI);row.appendChild(headI);row.appendChild(btn);fbc.appendChild(row);
  var note=h('div',{class:'mini'});fbc.appendChild(note);v.appendChild(fbc);
  var out=h('div');v.appendChild(out);
  content.innerHTML='';content.appendChild(v);
  var id=d.source&&d.source.id;
  if(id)fetch('/api/refs?id='+id).then(function(r){return r.json();}).then(function(refs){
    if(refs.error){note.textContent='(refs unavailable: '+refs.error+')';return;}
    note.innerHTML='branches: '+(refs.branches||[]).slice(0,8).map(esc).join(', ');
    if(refs.branches&&refs.branches.length>1){baseI.value=refs.branches[1];headI.value=refs.branches[0];}
  }).catch(function(){});
  btn.addEventListener('click',function(){
    if(!baseI.value||!headI.value)return;
    btn.disabled=true;btn.textContent='Analyzing...';out.innerHTML='<div class="callout">Cloning + analyzing both refs...</div>';
    var cfg=AI().aiReady()?AI().getCfg():null;
    var acc='';var diff=null;var aiBox=null;
    AI().streamGenerate('/api/commit-intel',{input:input,baseRef:baseI.value,headRef:headI.value,config:cfg},
      function(t){acc+=t;if(aiBox)aiBox.innerHTML=AI().renderMd(acc);},
      function(name,data){
        if(name==='diff'){diff=data;out.innerHTML='';renderCommitDiff(out,diff,baseI.value,headI.value);if(cfg){var c=card('\u2727 AI change analysis',null);aiBox=h('div');aiBox.innerHTML='<div class="mini">generating...</div>';c.appendChild(aiBox);out.appendChild(c);}else{out.appendChild(el('<div class="callout warn">Configure AI in Settings for a narrative impact analysis. The structural diff above is mechanical.</div>'));}}
        else if(name==='error'){if(aiBox)aiBox.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';}
        else if(name==='done'){btn.disabled=false;btn.textContent='Analyze change';}
      }
    ).then(function(){
      btn.disabled=false;btn.textContent='Analyze change';
      // non-AI path returns JSON not SSE
      if(!diff){ fetch('/api/commit-intel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:input,baseRef:baseI.value,headRef:headI.value})}).then(function(r){return r.json();}).then(function(res){if(res.diff){out.innerHTML='';renderCommitDiff(out,res.diff,baseI.value,headI.value);out.appendChild(el('<div class="callout warn">Configure AI in Settings for a narrative analysis.</div>'));}}); }
    }).catch(function(e){btn.disabled=false;btn.textContent='Analyze change';if(!diff)out.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
  });
});
function renderCommitDiff(out,diff,base,head){
  var g=h('div',{class:'grid mgrid'});
  [['Risk',diff.riskLabel.toUpperCase(),sevColor(diff.riskLabel)],['Files Δ',(diff.deltas.files>=0?'+':'')+diff.deltas.files],['Functions Δ',(diff.deltas.functions>=0?'+':'')+diff.deltas.functions],['Routes Δ',(diff.deltas.routes>=0?'+':'')+diff.deltas.routes],['LOC Δ',(diff.deltas.loc>=0?'+':'')+num(diff.deltas.loc)]].forEach(function(x){g.appendChild(h('div',{class:'metric'},[h('div',{class:'v',style:x[2]?'color:'+x[2]:'',text:x[1]}),h('div',{class:'l',text:x[0]})]));});
  out.appendChild(g);
  function lc(title,added,removed,changed){var c=card(title,null);
    if(added&&added.length)c.appendChild(el('<h3 style="color:var(--green)">Added ('+added.length+')</h3><div class="tag-row">'+added.slice(0,50).map(function(x){return '<span class="chip">'+esc(typeof x==='string'?x:(x.name||'')).slice(0,60)+'</span>';}).join('')+'</div>'));
    if(removed&&removed.length)c.appendChild(el('<h3 style="color:var(--red)">Removed ('+removed.length+')</h3><div class="tag-row">'+removed.slice(0,50).map(function(x){return '<span class="chip">'+esc(typeof x==='string'?x:(x.name||''))+'</span>';}).join('')+'</div>'));
    if(changed&&changed.length)c.appendChild(el('<h3 style="color:var(--amber)">Changed ('+changed.length+')</h3><div class="tag-row">'+changed.slice(0,50).map(function(x){return '<span class="chip">'+esc(x.name||x)+'</span>';}).join('')+'</div>'));
    if((!added||!added.length)&&(!removed||!removed.length)&&(!changed||!changed.length))c.appendChild(el('<div class="mini">no changes</div>'));
    return c;}
  out.appendChild(lc('Routes',diff.routes.added,diff.routes.removed));
  out.appendChild(lc('Tables',diff.tables.added,diff.tables.removed));
  out.appendChild(lc('Functions',diff.functions.added,diff.functions.removed,diff.functions.changed));
  out.appendChild(lc('Dependencies',diff.dependencies.added,diff.dependencies.removed,diff.dependencies.changed));
}

// ---- AI page scaffold + generate helper ----
function aiPage(content,titleT,desc,onReady){
  var v=view(pt(titleT,desc));
  if(!AI().aiReady()){
    v.appendChild(el('<div class="ai-off-note"><div style="font-size:32px;margin-bottom:8px">&#9211;</div><div style="font-size:15px;margin-bottom:6px">AI is not configured.</div><div class="mini" style="margin-bottom:14px">This page needs an AI provider. Everything else in the platform works without it.</div><span class="btn sm" onclick="RINAV(\'settings\')">Open AI Settings</span></div>'));
    content.innerHTML='';content.appendChild(v);return;
  }
  var actions=h('div',{class:'filter-bar'});
  var regen=h('button',{class:'btn sm',text:'\u21bb Regenerate'});
  actions.appendChild(regen);v.appendChild(actions);
  var body=h('div');v.appendChild(body);
  content.innerHTML='';content.appendChild(v);
  regen.addEventListener('click',function(){onReady(body);});
  onReady(body);
}
function generateInto(body,url,extra,kind){
  body.innerHTML='<div class="mini">generating from repository analysis...</div>';
  var acc='';
  AI().streamGenerate(url,Object.assign({id:D().source.id,config:AI().getCfg()},extra),
    function(t){acc+=t;body.innerHTML='<div class="jsdoc" style="background:transparent;border:none;padding:0">'+AI().renderMd(acc)+'</div>';},
    function(name,data){if(name==='error')body.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';}
  );
}

// ---- Global Explain widget (used by detail pages via explainBar) ----
var MODES=[['beginner','Beginner'],['senior','Senior'],['architecture','Architecture'],['performance','Performance'],['security','Security']];
function explainBar(subject){
  var wrap=h('div',{class:'card',style:'border-style:dashed'});
  var head=h('div',{style:'display:flex;align-items:center;gap:10px;flex-wrap:wrap'});
  head.appendChild(el('<div style="font-size:13px;font-weight:650">\u2727 AI Explain</div>'));
  var modeSel=h('div',{class:'tag-row'});
  var out=h('div',{style:'margin-top:10px'});
  MODES.forEach(function(m){
    var chip=h('span',{class:'chip',text:m[1]});
    chip.addEventListener('click',function(){runExplain(subject,m[0],out);});
    modeSel.appendChild(chip);
  });
  head.appendChild(modeSel);wrap.appendChild(head);wrap.appendChild(out);
  if(!AI().aiReady())out.appendChild(el('<div class="mini" style="margin-top:6px">Configure AI in Settings to enable explanations.</div>'));
  return wrap;
}
function runExplain(subject,mode,out){
  if(!AI().aiReady()){out.innerHTML='<div class="callout warn">Configure AI in Settings to use Explain.</div>';return;}
  out.innerHTML='<div class="mini">explaining ('+mode+' mode)...</div>';var acc='';
  AI().streamGenerate('/api/ai/generate',{id:D().source.id,kind:'explain',subject:subject,mode:mode,config:AI().getCfg()},
    function(t){acc+=t;out.innerHTML='<div class="jsdoc">'+AI().renderMd(acc)+'</div>';},
    function(name,data){if(name==='error')out.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';}
  );
}
// expose explainBar so any page can embed it
window.RIEXPLAIN=explainBar;

// ================= AI SETTINGS v2 (profiles + top_p + connection test) =================
// Overrides the Phase 1 settings route (registered later == wins). The Phase 1
// version remains in ai.js as a fallback and shares the same storage key so
// existing configs keep working.
var PROFILES_KEY='ri_ai_profiles';
function getProfiles(){try{return JSON.parse(localStorage.getItem(PROFILES_KEY))||[];}catch(e){return[];}}
function saveProfiles(p){localStorage.setItem(PROFILES_KEY,JSON.stringify(p));}
route('settings',function(content){
  var v=view(pt('AI Settings','AI is optional &mdash; the whole platform works without it. Configure one or more provider profiles and switch instantly. Keys are stored in your browser and relayed per-request by the local server.'));
  var cfg=AI().getCfg();var PROVIDERS=AI().PROVIDERS;
  var profiles=getProfiles();

  // ---- profiles bar ----
  var pc=card('Profiles',null);
  var plist=h('div',{class:'tag-row'});
  function renderProfiles(){
    plist.innerHTML='';
    if(!profiles.length){plist.appendChild(el('<span class="mini">No saved profiles yet. Configure below and Save as profile.</span>'));}
    profiles.forEach(function(pr,i){
      var active=cfg.provider===pr.provider&&cfg.model===pr.model&&cfg.baseUrl===pr.baseUrl;
      var chip=h('span',{class:'chip',style:active?'border-color:var(--accent);color:var(--accent)':'',text:(pr.name||pr.provider+'/'+pr.model)});
      chip.addEventListener('click',function(){AI().setCfg(pr);cfg=pr;fill();renderProfiles();status.innerHTML='<span class="status-dot ok"></span>Switched to '+esc(pr.name||pr.model)+'.';});
      var del=h('span',{class:'mini',style:'cursor:pointer;margin-left:4px',text:'\u00d7'});
      del.addEventListener('click',function(e){e.stopPropagation();profiles.splice(i,1);saveProfiles(profiles);renderProfiles();});
      chip.appendChild(del);plist.appendChild(chip);
    });
  }
  pc.appendChild(plist);v.appendChild(pc);

  // ---- config form ----
  var c=card('Provider configuration',null);
  var provSel=h('select');PROVIDERS.forEach(function(p){provSel.appendChild(h('option',{value:p.id,text:p.label}));});
  var baseI=h('input',{});var keyI=h('input',{type:'password',placeholder:'API key (blank for local providers)'});
  var modelSel=h('select');modelSel.style.display='none';var modelI=h('input',{placeholder:'model name'});
  var tempI=h('input',{type:'number',step:'0.1',min:'0',max:'2'});
  var toppI=h('input',{type:'number',step:'0.05',min:'0',max:'1'});
  var maxI=h('input',{type:'number',step:'128',min:'128'});
  var streamI=h('input',{type:'checkbox'});
  var nameI=h('input',{placeholder:'profile name (optional)'});
  var status=h('div',{class:'mini',style:'margin-top:6px'});

  function fill(){
    provSel.value=cfg.provider||'openai';
    baseI.value=cfg.baseUrl||(PROVIDERS.find(function(x){return x.id===provSel.value;})||{}).base||'';
    keyI.value=cfg.apiKey||'';modelI.value=cfg.model||'';
    tempI.value=cfg.temperature!=null?cfg.temperature:0.2;
    toppI.value=cfg.topP!=null?cfg.topP:1;
    maxI.value=cfg.maxTokens||1024;streamI.checked=cfg.stream!==false;
    nameI.value=cfg.name||'';
  }
  provSel.addEventListener('change',function(){var p=PROVIDERS.find(function(x){return x.id===provSel.value;});baseI.value=p?p.base:'';modelSel.style.display='none';modelI.style.display='';});
  fill();

  c.appendChild(fld('Provider',provSel));
  c.appendChild(fld('Base URL',baseI));
  c.appendChild(fld('API Key',keyI));
  var mwrap=h('div');var mrow=h('div',{style:'display:flex;gap:8px'});modelSel.style.flex='1';modelI.style.flex='1';
  var disc=h('button',{class:'btn ghost sm',text:'Discover'});
  mrow.appendChild(modelSel);mrow.appendChild(modelI);mrow.appendChild(disc);mwrap.appendChild(mrow);
  c.appendChild(fld('Model',mwrap));
  var g=h('div',{style:'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px'});
  g.appendChild(fld('Temperature',tempI));g.appendChild(fld('Top P',toppI));g.appendChild(fld('Max tokens',maxI));
  c.appendChild(g);
  c.appendChild(fld('Stream responses',streamI));
  c.appendChild(fld('Profile name',nameI));
  c.appendChild(status);

  function collect(){return{name:nameI.value.trim(),provider:provSel.value,baseUrl:baseI.value.trim(),apiKey:keyI.value,model:(modelSel.style.display!=='none'&&modelSel.value)?modelSel.value:modelI.value.trim(),temperature:parseFloat(tempI.value),topP:parseFloat(toppI.value),maxTokens:parseInt(maxI.value,10),stream:streamI.checked};}

  disc.addEventListener('click',function(){
    status.textContent='Discovering models...';
    fetch('/api/ai/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:collect()})}).then(function(r){return r.json();}).then(function(res){
      if(res.ok&&res.models.length){modelSel.innerHTML='';res.models.forEach(function(m){modelSel.appendChild(h('option',{value:m,text:m}));});modelSel.style.display='';modelI.style.display='none';status.innerHTML='<span class="status-dot ok"></span>Found '+res.models.length+' models (newest first if provider sorts).';}
      else{modelSel.style.display='none';modelI.style.display='';status.innerHTML='<span class="status-dot err"></span>Discovery unavailable ('+esc(res.error||'none')+'). Enter a model manually.';}
    }).catch(function(e){status.innerHTML='<span class="status-dot err"></span>'+esc(e.message);});
  });

  var testBtn=h('button',{class:'btn ghost sm',text:'Test connection'});
  testBtn.addEventListener('click',function(){
    status.innerHTML='<span class="status-dot off"></span>Testing...';
    fetch('/api/ai/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:collect()})}).then(function(r){return r.json();}).then(function(res){
      if(res.ok)status.innerHTML='<span class="status-dot ok"></span>Connected. '+esc(res.detail||'');
      else status.innerHTML='<span class="status-dot err"></span>Failed: '+esc(res.error||'unknown');
    }).catch(function(e){status.innerHTML='<span class="status-dot err"></span>'+esc(e.message);});
  });
  var saveBtn=h('button',{class:'btn sm',text:'Save & activate'});
  saveBtn.addEventListener('click',function(){var nc=collect();if(!nc.model){status.innerHTML='<span class="status-dot err"></span>Set a model first.';return;}AI().setCfg(nc);cfg=nc;status.innerHTML='<span class="status-dot ok"></span>Active configuration saved.';});
  var saveProfBtn=h('button',{class:'btn ghost sm',text:'Save as profile'});
  saveProfBtn.addEventListener('click',function(){var nc=collect();if(!nc.model){status.innerHTML='<span class="status-dot err"></span>Set a model first.';return;}nc.name=nc.name||(nc.provider+'/'+nc.model);var ix=profiles.findIndex(function(p){return p.name===nc.name;});if(ix>=0)profiles[ix]=nc;else profiles.push(nc);saveProfiles(profiles);AI().setCfg(nc);cfg=nc;renderProfiles();status.innerHTML='<span class="status-dot ok"></span>Profile "'+esc(nc.name)+'" saved & activated.';});
  var clearBtn=h('button',{class:'btn ghost sm',text:'Disable AI'});
  clearBtn.addEventListener('click',function(){localStorage.removeItem(AI().CFG_KEY);cfg={};fill();status.innerHTML='<span class="status-dot off"></span>AI disabled. The platform still works fully.';});
  c.appendChild(el('<hr class="sep">'));
  var brow=h('div',{class:'tag-row'});[testBtn,saveBtn,saveProfBtn,clearBtn].forEach(function(b){brow.appendChild(b);});c.appendChild(brow);
  v.appendChild(c);
  v.appendChild(el('<div class="callout"><b>AI is never required and never invents facts.</b> All answers are grounded in the static-analysis index with file citations; when evidence is missing the assistant says "Unable to determine from repository analysis." Supported: OpenAI-compatible (OpenAI, OpenRouter, Groq, Together, DeepSeek, Mistral, LM Studio, custom), Anthropic Claude, Google Gemini, and Ollama.</div>'));
  renderProfiles();
  content.innerHTML='';content.appendChild(v);
});
function fld(label,input){var f=h('div',{class:'field'});f.appendChild(h('label',{html:label}));f.appendChild(input);return f;}

// ---- Additive enhancement of EXISTING detail pages (file/function/table) ----
// We do NOT modify Phase 1 page modules. Instead, after any render, if we are on
// a file/function/table detail view, we append an AI Explain bar + Impact action
// to the rendered content. Idempotent (guards against double-inject).
function enhanceDetail(){
  var hash=location.hash.replace(/^#\/?/,'');
  var parts=hash.split('/');var page=parts[0];var arg=parts.slice(1).join('/');
  if(!D())return;
  var content=document.getElementById('content');if(!content)return;
  var vv=content.querySelector('.view');if(!vv)return;
  if(vv.querySelector('.ri-enh'))return; // already enhanced
  var subject=null;var impact=null;
  if(page==='file'&&arg){var p=decodeURIComponent(arg);subject={kind:'file',title:p,query:p};impact={kind:'file',target:p};}
  else if(page==='function'&&arg){var id=decodeURIComponent(arg);var fn=IDX().fnById[id];if(fn){subject={kind:'function',title:fn.name,query:fn.name+' '+fn.file};impact={kind:'function',target:id};}}
  else if(page==='table'&&arg){var t=decodeURIComponent(arg);subject={kind:'table',title:t,query:t};impact={kind:'table',target:t};}
  if(!subject)return;
  var box=h('div',{class:'ri-enh'});
  // impact button
  var ia=h('div',{class:'filter-bar',style:'margin-top:6px'});
  var ib=h('span',{class:'btn ghost sm',text:'\u2325 What breaks if I delete this?'});
  ib.addEventListener('click',function(){nav('trace/impact/'+impact.kind+'/'+encodeURIComponent(impact.target));});
  ia.appendChild(ib);
  box.appendChild(ia);
  box.appendChild(explainBar(subject));
  vv.appendChild(box);
}
window.addEventListener('hashchange',function(){setTimeout(enhanceDetail,30);});
// also run once shortly after load in case we deep-linked
setTimeout(function(){ if(D()) enhanceDetail(); },200);
})();
