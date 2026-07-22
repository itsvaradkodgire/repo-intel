/* pages.js — dashboard, architecture, explorers + detail views. */
(function(){
'use strict';
var A=window.RIAPP,h=A.h,el=A.el,esc=A.esc,num=A.num,baseName=A.baseName,route=A.route,nav=A.nav;
var langColor=A.langColor,layerColor=A.layerColor;
function D(){return A.D;}function IDX(){return A.IDX;}
function view(kids){return h('div',{class:'view'},kids);}
function pt(t,d){return[h('h1',{class:'pt',text:t}),d?h('div',{class:'pd',text:d}):null];}
function card(titleHtml,body){var c=h('div',{class:'card'});if(titleHtml)c.appendChild(el('<h2>'+titleHtml+'</h2>'));(Array.isArray(body)?body:[body]).forEach(function(b){if(b)c.appendChild(typeof b==='string'?el(b):b);});return c;}
function backBtn(label,go){return el('<div style="margin-bottom:14px"><span class="btn ghost sm" onclick="RINAV(\''+go+'\')">&larr; '+esc(label)+'</span></div>');}
function chips(arr,fn){return arr.length?'<div class="tag-row">'+arr.map(fn).join('')+'</div>':'<span class="mini">none</span>';}
function methodBadge(m){var c=({GET:'b-get',POST:'b-post',PATCH:'b-patch',PUT:'b-put',DELETE:'b-delete'})[m]||'b-any';return '<span class="badge '+c+'">'+esc(m)+'</span>';}
A.ui={view:view,pt:pt,card:card,backBtn:backBtn,chips:chips,methodBadge:methodBadge};

// sortable table
function table(headers,rows,sortCol){
  var st={col:sortCol!=null?sortCol:-1,dir:1};
  var t=h('table',{class:'data'});var thead=h('thead');var tr=h('tr');
  headers.forEach(function(hd,i){var th=h('th',{text:hd});th.addEventListener('click',function(){if(st.col===i)st.dir*=-1;else{st.col=i;st.dir=1;}draw();});tr.appendChild(th);});
  thead.appendChild(tr);t.appendChild(thead);var tb=h('tbody');t.appendChild(tb);
  function draw(){var data=rows.slice();
    if(st.col>=0)data.sort(function(a,b){var av=a.sort?a.sort[st.col]:a.cells[st.col],bv=b.sort?b.sort[st.col]:b.cells[st.col];if(typeof av==='number'&&typeof bv==='number')return(av-bv)*st.dir;return String(av).localeCompare(String(bv))*st.dir;});
    tb.innerHTML='';data.forEach(function(r){var rtr=h('tr',r.onclick?{class:'row-link',onclick:r.onclick}:{});r.cells.forEach(function(c){var td=h('td');td.innerHTML=(c&&c.html!==undefined)?c.html:(c==null?'':String(c));rtr.appendChild(td);});tb.appendChild(rtr);});
  }
  draw();return t;
}
A.ui.table=table;

// ============ DASHBOARD ============
route('dashboard',function(content){
  var d=D();var c=d.manifest.counts;var m=d.metrics.summary;
  var v=view([]);
  v.appendChild(el('<h1 class="pt">'+esc(baseName((d.source&&d.source.input||d.manifest.root).replace(/\.git$/,'')))+'</h1>'));
  var git=d.source&&d.source.git;
  v.appendChild(el('<div class="pd">'+esc((d.source&&d.source.input)||d.manifest.root)+(git&&git.branch?' &middot; <span class="mono">'+esc(git.branch)+'</span>':'')+(git&&git.commit?' @ <span class="mono">'+esc(git.commit.slice(0,8))+'</span>':'')+' &middot; analyzed in '+(d.manifest.tookMs/1000).toFixed(1)+'s</div>'));

  var metrics=[
    {v:num(c.files),l:'Files',go:'files',cls:'accent'},
    {v:num(c.functions),l:'Functions',go:'functions'},
    {v:num(c.classes),l:'Classes / types',go:'classes'},
    {v:num(c.routes),l:'API routes',go:'apis',cls:'accent'},
    {v:num(c.tables),l:'DB tables',go:'database',cls:'green'},
    {v:num(c.dependencies),l:'Dependencies',go:'deps'},
    {v:num(d.flows.length),l:'Business flows',go:'flows',cls:'accent'},
    {v:num(c.loc),l:'Lines of code'},
    {v:num(m.dead),l:'Dead files',go:'quality',cls:m.dead?'amber':'green'},
    {v:num(m.circular),l:'Circular deps',go:'quality',cls:m.circular?'red':'green'},
    {v:num(c.securityFindings),l:'Security signals',go:'security',cls:c.securityFindings?'amber':'green'},
    {v:num(c.languages),l:'Languages'}
  ];
  var g=h('div',{class:'grid mgrid'});
  metrics.forEach(function(mm){g.appendChild(h('div',{class:'metric'+(mm.go?' clk':''),onclick:mm.go?function(){nav(mm.go);}:null},[h('div',{class:'v '+(mm.cls||''),text:mm.v}),h('div',{class:'l',text:mm.l})]));});
  v.appendChild(g);

  var two=h('div',{class:'two'});
  // languages
  var lc=card('Languages',null);
  var maxL=Math.max.apply(null,d.languages.map(function(l){return l.files;}));
  d.languages.slice(0,12).forEach(function(l){
    var pct=Math.round(l.files/maxL*100);
    lc.appendChild(h('div',{class:'bar-row',onclick:function(){nav('files');}},[
      h('div',{style:'width:110px;font-size:12px;font-family:var(--mono);color:var(--dim)',text:l.label}),
      h('div',{class:'bar-track'},[h('div',{class:'bar-fill',style:'width:'+pct+'%;background:'+langColor(l.id)})]),
      h('div',{style:'width:36px;text-align:right;font-family:var(--mono);font-size:12px',text:String(l.files)})
    ]));
  });
  two.appendChild(lc);
  // layers
  var lyc=card('Files by layer',null);
  var lk=d.metrics.layerCounts;var maxLy=Math.max.apply(null,Object.values(lk));
  Object.keys(lk).sort(function(a,b){return lk[b]-lk[a];}).forEach(function(k){
    lyc.appendChild(h('div',{class:'bar-row'},[
      h('div',{style:'width:110px;font-size:12px;font-family:var(--mono);color:var(--dim)',text:k}),
      h('div',{class:'bar-track'},[h('div',{class:'bar-fill',style:'width:'+Math.round(lk[k]/maxLy*100)+'%;background:'+layerColor(k)})]),
      h('div',{style:'width:36px;text-align:right;font-family:var(--mono);font-size:12px',text:String(lk[k])})
    ]));
  });
  two.appendChild(lyc);
  v.appendChild(two);

  // top flows + top complex
  var two2=h('div',{class:'two'});
  var fc=card('Top business flows',null);
  if(!d.flows.length)fc.appendChild(el('<div class="empty">No flows inferred.</div>'));
  d.flows.slice(0,6).forEach(function(fl){
    fc.appendChild(el('<div class="bar-row" onclick="RINAV(\'flow/'+encodeURIComponent(fl.id)+'\')"><span style="font-size:12.5px">'+esc(fl.name)+'</span><span class="mini" style="margin-left:auto">'+fl.functionCount+' fns'+(fl.tablesWritten.length?' &middot; '+fl.tablesWritten.length+' writes':'')+'</span></div>'));
  });
  two2.appendChild(fc);
  var cc=card('Most complex functions',null);
  d.metrics.complexFunctions.slice(0,7).forEach(function(f){
    cc.appendChild(el('<div class="bar-row" onclick="RINAV(\'function/'+encodeURIComponent(f.id)+'\')"><span class="mono" style="font-size:12px">'+esc(f.name)+'</span><span class="mini" style="margin-left:auto">cx '+f.complexity+' &middot; '+baseName(f.file)+'</span></div>'));
  });
  if(!d.metrics.complexFunctions.length)cc.appendChild(el('<div class="empty">None above threshold.</div>'));
  two2.appendChild(cc);
  v.appendChild(two2);

  content.innerHTML='';content.appendChild(v);
});

// ============ ARCHITECTURE (graphs) ============
var archMode='layer';
route('architecture',function(content){
  var v=view(pt('Architecture','Interactive views of the codebase structure. Drag nodes, scroll to zoom, drag background to pan, hover to highlight, click to open.'));
  var sw=h('div',{class:'filter-bar'});
  [['layer','Layered structure'],['module','Module graph'],['db','Database schema']].forEach(function(mo){
    var b=h('button',{class:'btn ghost sm',text:mo[1],style:archMode===mo[0]?'border-color:var(--accent);color:var(--accent)':''});
    b.addEventListener('click',function(){archMode=mo[0];nav('architecture');});sw.appendChild(b);
  });
  v.appendChild(sw);
  var box=h('div',{class:'graph-box'});var controls=h('div',{class:'graph-controls'});var gEl=h('div',{style:'width:100%;height:100%'});
  box.appendChild(gEl);box.appendChild(controls);box.appendChild(h('div',{class:'graph-hint',text:'scroll=zoom · drag=pan · hover=highlight'}));
  var legend=h('div',{class:'graph-legend'});box.appendChild(legend);v.appendChild(box);
  content.innerHTML='';content.appendChild(v);
  var data=archMode==='layer'?layerData():archMode==='module'?moduleData():dbData();
  var g=window.Graph(gEl,{onClick:function(n){if(n.goto)nav(n.goto);}});
  g.render(data.graph);legend.innerHTML=data.legend;
  [['+',function(){g.zoomIn();}],['\u2212',function(){g.zoomOut();}],['\u2b1a',function(){g.fit();}]].forEach(function(cc){var b=h('button',{text:cc[0]});b.addEventListener('click',cc[1]);controls.appendChild(b);});
});
function layerData(){
  var d=D();var lk=d.metrics.layerCounts;
  var order=['ui','api','service','data','lib','config','other','test'];
  // compute file->layer using graph nodes
  var fileLayer={};d.graph.nodes.forEach(function(n){if(n.type==='file')fileLayer[n.path]=n.layer;});
  var nodes=[];Object.keys(lk).forEach(function(l){nodes.push({id:l,label:l+' ('+lk[l]+')',layer:l,color:layerColor(l),r:8+Math.min(Math.sqrt(lk[l])*2.2,20)});});
  // edges between layers
  var em=new Map();
  d.files.forEach(function(f){var fl=fileLayer[f.path];(f.imports||[]).forEach(function(imp){if(imp.resolved&&fileLayer[imp.resolved]){var tl=fileLayer[imp.resolved];if(tl!==fl){var k=fl+'->'+tl;em.set(k,(em.get(k)||0)+1);}}});});
  var links=[...em.entries()].map(function(e){var p=e[0].split('->');return{source:p[0],target:p[1],weight:e[1]};});
  return{graph:{nodes:nodes,links:links,layered:true,directed:true,layerOrder:order},legend:'Rows are architectural layers (ui &rarr; api &rarr; service &rarr; data). Node size = file count. Arrows = import direction.'};
}
function require_layer(f){return f.layer;}
function moduleData(){
  var d=D();
  // cluster by top-2 dir
  var keyOf={};var counts={};
  d.files.forEach(function(f){if(f.meta&&!f.functions)return;var segs=f.path.split('/');var key=segs.length>1?segs.slice(0,Math.min(2,segs.length-1)).join('/'):'(root)';keyOf[f.path]=key;counts[key]=(counts[key]||0)+1;});
  var nodes=Object.keys(counts).map(function(k){return{id:k,label:baseName(k)||k,color:'#5b9dff',r:5+Math.min(Math.sqrt(counts[k])*2,16)};});
  var em=new Map();
  d.files.forEach(function(f){var from=keyOf[f.path];if(!from)return;(f.imports||[]).forEach(function(imp){if(imp.resolved&&keyOf[imp.resolved]){var to=keyOf[imp.resolved];if(to!==from){var k=from+'->'+to;em.set(k,(em.get(k)||0)+1);}}});});
  var links=[...em.entries()].map(function(e){var p=e[0].split('->');return{source:p[0],target:p[1],weight:e[1]};});
  return{graph:{nodes:nodes,links:links,directed:true,iters:260},legend:'Nodes = directories sized by file count. Edges = imports between directories.'};
}
function dbData(){
  var d=D();
  var domainColor='#f5b13d';
  var nodes=d.tables.slice(0,120).map(function(t){return{id:t.name,label:t.name,color:'#3dd69a',r:5+Math.min((t.accesses||1)*0.3,14),goto:'table/'+encodeURIComponent(t.name)};});
  // edges: files that read+write same tables create table-table affinity? Instead show table<-file? keep tables only.
  var links=[];
  // connect tables co-accessed by the same file (affinity)
  var fileTables={};d.dbAccess.forEach(function(hh){if(!hh.table)return;(fileTables[hh.file]=fileTables[hh.file]||new Set()).add(hh.table);});
  var seen=new Set();
  Object.values(fileTables).forEach(function(set){var arr=[...set].slice(0,8);for(var i=0;i<arr.length;i++)for(var j=i+1;j<arr.length;j++){var k=arr[i]<arr[j]?arr[i]+'|'+arr[j]:arr[j]+'|'+arr[i];if(!seen.has(k)){seen.add(k);links.push({source:arr[i],target:arr[j],weight:1});}}});
  return{graph:{nodes:nodes,links:links.slice(0,400),directed:false,iters:300},legend:'Nodes = database tables (size = access count). Edges connect tables used together in the same file.'};
}

// ============ FILES ============
route('files',function(content,arg){
  var d=D();
  var v=view(pt('Files',num(d.files.length)+' files. Filter by path or language. Click a file for its purpose, imports, dependents, symbols, and risks.'));
  var fb=h('div',{class:'filter-bar'});
  var q=h('input',{class:'grow',placeholder:'Filter files...',value:arg||''});
  var langSel=h('select');langSel.appendChild(h('option',{value:'',text:'All languages'}));
  var langs={};d.files.forEach(function(f){if(f.lang)langs[f.lang]=1;});
  Object.keys(langs).sort().forEach(function(l){langSel.appendChild(h('option',{value:l,text:l}));});
  var note=h('span',{class:'count-note'});
  fb.appendChild(q);fb.appendChild(langSel);fb.appendChild(note);v.appendChild(fb);
  var wrap=h('div',{class:'card',style:'padding:0;max-height:70vh;overflow:auto'});v.appendChild(wrap);
  content.innerHTML='';content.appendChild(v);
  function draw(){
    var term=q.value.toLowerCase().trim(),lang=langSel.value;
    var list=d.files.filter(function(f){if(lang&&f.lang!==lang)return false;if(term&&f.path.toLowerCase().indexOf(term)<0)return false;return true;});
    note.textContent=list.length+' files';
    var rows=list.slice(0,800).map(function(f){return{onclick:function(){nav('file/'+encodeURIComponent(f.path));},
      cells:['<span class="mono">'+esc(f.path)+'</span>','<span class="badge b-tag" style="color:'+langColor(f.lang)+'">'+(f.lang||'—')+'</span>',f.loc,(f.functions?f.functions.length:0),(f.importedBy?f.importedBy.length:0)],
      sort:[f.path,f.lang||'',f.loc,(f.functions?f.functions.length:0),(f.importedBy?f.importedBy.length:0)]};});
    wrap.innerHTML='';wrap.appendChild(table(['Path','Lang','LOC','Fns','Used by'],rows,2));
  }
  q.addEventListener('input',draw);langSel.addEventListener('change',draw);draw();
});

// ============ FILE DETAIL ============
route('file',function(content,p){
  var d=D();var f=IDX().fileByPath[p];
  if(!f){content.innerHTML='<div class="view"><div class="callout danger">File not found: '+esc(p)+'</div></div>';return;}
  var v=view([]);v.appendChild(backBtn('Files','files'));
  v.appendChild(el('<div class="detail-head"><h1>'+esc(baseName(f.path))+'</h1><span class="badge b-tag" style="color:'+langColor(f.lang)+'">'+(f.lang||'—')+'</span><span class="badge b-tag">'+(f.layer||layerOf(f))+'</span></div>'));
  v.appendChild(el('<div class="detail-sub">'+esc(f.path)+'</div>'));
  if(f.doc)v.appendChild(el('<div class="jsdoc"><b>Purpose (from file header):</b> '+esc(f.doc)+'</div>'));
  var fns=IDX().fnsByFile[f.path]||[];var classes=IDX().classesByFile[f.path]||[];
  v.appendChild(card('Overview',kvBox([['Language',f.lang||'—'],['Lines of code',num(f.loc)+' ('+num(f.sloc||f.loc)+' non-blank)'],['Functions',fns.length],['Classes/types',classes.length],['Total complexity',f.complexity||0],['Imported by',(f.importedBy?f.importedBy.length:0)+' file(s)'],['Complexity',(f.loc>600||(f.complexity||0)>100)?'Very high — consider splitting':(f.loc>300?'High':(f.complexity>25?'Moderate':'Low'))]])));
  // deps
  var internal=(f.imports||[]).filter(function(i){return i.resolved;});
  var external=(f.imports||[]).filter(function(i){return i.external&&i.source;});
  v.appendChild(card('Dependencies ('+internal.length+' internal, '+external.length+' external)',[
    '<h3>Imports (internal)</h3>',internal.length?'<div class="tag-row">'+internal.map(function(i){return '<span class="chip" onclick="RINAV(\'file/'+encodeURIComponent(i.resolved)+'\')">'+esc(baseName(i.resolved))+'</span>';}).join('')+'</div>':'<span class="mini">none</span>',
    '<h3>External</h3>',external.length?'<div class="tag-row">'+external.slice(0,60).map(function(i){return '<span class="chip">'+esc(i.source)+'</span>';}).join('')+'</div>':'<span class="mini">none</span>'
  ]));
  v.appendChild(card('Depended on by ('+(f.importedBy?f.importedBy.length:0)+')',(f.importedBy&&f.importedBy.length)?'<div class="tag-row">'+f.importedBy.map(function(pp){return '<span class="chip" onclick="RINAV(\'file/'+encodeURIComponent(pp)+'\')">'+esc(baseName(pp))+'</span>';}).join('')+'</div>':'<div class="mini">Nothing imports this file (possible entrypoint or dead code).</div>'));
  // routes/tables
  var routes=IDX().routesByFile[f.path]||[];
  if(routes.length)v.appendChild(card('API routes exposed',chips(routes,function(r){return '<span class="chip" onclick="RINAV(\'api/'+encodeURIComponent(r.method+' '+r.path+' @'+r.file)+'\')">'+methodBadge(r.method)+' '+esc(r.path)+'</span>';})));
  var tw=new Set(),tr=new Set();
  (d.dbAccess||[]).forEach(function(hh){if(hh.file!==f.path||!hh.table)return;var write=/write|insert|update|delete|create|save|upsert|ddl/i.test(hh.kind+' '+(hh.op||''));if(write)tw.add(hh.table);else tr.add(hh.table);});
  if(tw.size||tr.size)v.appendChild(card('Database access',[tw.size?'<h3>Writes</h3>'+chips([...tw],function(t){return tableChip(t,'wr');}):'',tr.size?'<h3>Reads</h3>'+chips([...tr],function(t){return tableChip(t,'rd');}):'']));
  // functions
  if(fns.length){var rows=fns.sort(function(a,b){return a.line-b.line;}).map(function(fn){return{onclick:function(){nav('function/'+encodeURIComponent(fn.id));},cells:['<span class="mono">'+esc(fn.name)+'</span>',':'+fn.line,fn.loc,fn.complexity,(fn.calledBy?fn.calledBy.length:0)],sort:[fn.name,fn.line,fn.loc,fn.complexity,0]};});
    v.appendChild(card('Functions ('+fns.length+')',table(['Name','Line','LOC','Cx','Callers'],rows,1)));}
  if(classes.length)v.appendChild(card('Classes / types ('+classes.length+')','<div class="tag-row">'+classes.map(function(c){return '<span class="chip" onclick="RINAV(\'class/'+encodeURIComponent(c.id)+'\')">'+esc(c.name)+'</span>';}).join('')+'</div>'));
  content.innerHTML='';content.appendChild(v);
});
function layerOf(f){return f.layer||'other';}
function kvBox(pairs){var b=h('div',{class:'kv'});pairs.forEach(function(p){if(p[1]==null||p[1]==='')return;b.appendChild(h('div',{class:'k',text:p[0]}));b.appendChild(h('div',{class:'v',html:String(p[1])}));});return b;}
function tableChip(t,mode){return '<span class="chip '+(mode||'')+'" onclick="RINAV(\'table/'+encodeURIComponent(t)+'\')">'+esc(t)+'</span>';}
A.ui.kvBox=kvBox;A.ui.tableChip=tableChip;

// ============ FUNCTIONS ============
route('functions',function(content,arg){
  var d=D();
  var v=view(pt('Functions',num(d.functions.length)+' functions. Click one for its call graph, complexity, and data effects.'));
  var fb=h('div',{class:'filter-bar'});
  var q=h('input',{class:'grow',placeholder:'Filter by name or file...',value:arg||''});
  var note=h('span',{class:'count-note'});fb.appendChild(q);fb.appendChild(note);v.appendChild(fb);
  var wrap=h('div',{class:'card',style:'padding:0;max-height:70vh;overflow:auto'});v.appendChild(wrap);
  content.innerHTML='';content.appendChild(v);
  function draw(){var term=q.value.toLowerCase().trim();
    var list=d.functions.filter(function(fn){return !term||fn.name.toLowerCase().indexOf(term)>=0||fn.file.toLowerCase().indexOf(term)>=0;});
    note.textContent=list.length+' functions';
    var rows=list.slice(0,700).map(function(fn){return{onclick:function(){nav('function/'+encodeURIComponent(fn.id));},
      cells:['<span class="mono">'+esc(fn.name)+'</span>','<span class="mono mini">'+esc(baseName(fn.file))+'</span>',fn.loc,fn.complexity,(fn.resolvedCalls?fn.resolvedCalls.length:(fn.calls?fn.calls.length:0)),(fn.calledBy?fn.calledBy.length:0)],
      sort:[fn.name,baseName(fn.file),fn.loc,fn.complexity,(fn.calls?fn.calls.length:0),(fn.calledBy?fn.calledBy.length:0)]};});
    wrap.innerHTML='';wrap.appendChild(table(['Function','File','LOC','Cx','Calls','Callers'],rows,3));
  }
  q.addEventListener('input',draw);draw();
});

// ============ FUNCTION DETAIL ============
route('function',function(content,id){
  var fn=IDX().fnById[id];
  if(!fn){content.innerHTML='<div class="view"><div class="callout danger">Function not found</div></div>';return;}
  var v=view([]);v.appendChild(backBtn('Functions','functions'));
  v.appendChild(el('<div class="detail-head"><h1>'+esc(fn.name)+'()</h1>'+(fn.async?'<span class="badge b-accent">async</span>':'')+'<span class="badge b-tag">'+(fn.lang||'')+'</span></div>'));
  v.appendChild(el('<div class="detail-sub"><span class="c-link" onclick="RINAV(\'file/'+encodeURIComponent(fn.file)+'\')">'+esc(fn.file)+'</span> : '+fn.line+'–'+(fn.endLine||fn.line)+'</div>'));
  if(fn.doc)v.appendChild(el('<div class="jsdoc">'+esc(fn.doc)+'</div>'));
  v.appendChild(card('Overview',kvBox([['Lines of code',fn.loc],['Cyclomatic complexity',fn.complexity+' ('+(fn.complexity>20?'high':fn.complexity>10?'moderate':'low')+')'],['Async',fn.async?'yes':'no'],['Calls (resolved)',(fn.resolvedCalls?fn.resolvedCalls.length:0)],['Called by',(fn.calledBy?fn.calledBy.length:0)]])));
  // call graph
  var calls=(fn.resolvedCalls||[]);var callers=(fn.calledBy||[]);
  v.appendChild(card('Call graph',[
    '<h3>Calls ('+(fn.calls?fn.calls.length:0)+')</h3>',
    calls.length?'<div class="tag-row">'+calls.map(function(cid){var c=IDX().fnById[cid];return c?'<span class="chip" onclick="RINAV(\'function/'+encodeURIComponent(cid)+'\')">'+esc(c.name)+'</span>':'';}).join('')+'</div>':'',
    (fn.calls&&fn.calls.length)?'<div class="tag-row" style="margin-top:4px">'+fn.calls.slice(0,30).map(function(nm){return '<span class="chip" style="cursor:default;opacity:.6">'+esc(nm)+'</span>';}).join('')+'</div><div class="mini">(all call-site names; resolved ones are clickable above)</div>':'<span class="mini">leaf function</span>',
    '<h3>Called by ('+callers.length+')</h3>',
    callers.length?'<div class="tag-row">'+callers.map(function(cid){var c=IDX().fnById[cid];return c?'<span class="chip" onclick="RINAV(\'function/'+encodeURIComponent(cid)+'\')">'+esc(c.name)+'</span>':'';}).join('')+'</div>':'<span class="mini">No resolved in-repo callers (entrypoint, handler, or called dynamically).</span>'
  ]));
  content.innerHTML='';content.appendChild(v);
});

// ============ CLASSES ============
route('classes',function(content,arg){
  var d=D();
  var v=view(pt('Classes / Types',num(d.classes.length)+' classes, structs, interfaces, enums, and traits.'));
  var fb=h('div',{class:'filter-bar'});var q=h('input',{class:'grow',placeholder:'Filter...',value:arg||''});var note=h('span',{class:'count-note'});fb.appendChild(q);fb.appendChild(note);v.appendChild(fb);
  var wrap=h('div',{class:'card',style:'padding:0;max-height:70vh;overflow:auto'});v.appendChild(wrap);content.innerHTML='';content.appendChild(v);
  function draw(){var term=q.value.toLowerCase().trim();
    var list=d.classes.filter(function(c){return !term||c.name.toLowerCase().indexOf(term)>=0||c.file.toLowerCase().indexOf(term)>=0;});
    note.textContent=list.length+' items';
    var rows=list.slice(0,800).map(function(c){return{onclick:function(){nav('class/'+encodeURIComponent(c.id));},cells:['<span class="mono">'+esc(c.name)+'</span>','<span class="badge b-purple">'+esc(c.kind)+'</span>','<span class="mono mini">'+esc(baseName(c.file))+'</span>',c.loc],sort:[c.name,c.kind,baseName(c.file),c.loc]};});
    wrap.innerHTML='';wrap.appendChild(table(['Name','Kind','File','LOC'],rows,0));
  }
  q.addEventListener('input',draw);draw();
});
route('class',function(content,id){
  var d=D();var c=d.classes.find(function(x){return x.id===id;});
  if(!c){content.innerHTML='<div class="view"><div class="callout danger">Not found</div></div>';return;}
  var v=view([]);v.appendChild(backBtn('Classes','classes'));
  v.appendChild(el('<div class="detail-head"><h1>'+esc(c.name)+'</h1><span class="badge b-purple">'+esc(c.kind)+'</span></div>'));
  v.appendChild(el('<div class="detail-sub"><span class="c-link" onclick="RINAV(\'file/'+encodeURIComponent(c.file)+'\')">'+esc(c.file)+'</span> : '+c.line+'</div>'));
  if(c.doc)v.appendChild(el('<div class="jsdoc">'+esc(c.doc)+'</div>'));
  var methods=(IDX().fnsByFile[c.file]||[]).filter(function(fn){return fn.line>=c.line&&fn.line<=(c.endLine||c.line+c.loc);});
  v.appendChild(card('Methods / functions in scope ('+methods.length+')',methods.length?'<div class="tag-row">'+methods.map(function(m){return '<span class="chip" onclick="RINAV(\'function/'+encodeURIComponent(m.id)+'\')">'+esc(m.name)+'</span>';}).join('')+'</div>':'<span class="mini">none detected</span>'));
  content.innerHTML='';content.appendChild(v);
});
})();
