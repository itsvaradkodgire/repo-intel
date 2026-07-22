/* pages4.js — Phase 3 Semantic Graph page + Time Machine (ADDITIVE).
 * New routes only. Renders index.semanticGraph via the sgraph.js renderer with
 * progressive expand/collapse, layers, intent modes, heatmaps, search, an
 * inspector, and AI reasoning/story mode when configured. */
(function(){
'use strict';
var A=window.RIAPP,h=A.h,el=A.el,esc=A.esc,num=A.num,baseName=A.baseName,route=A.route,nav=A.nav;
function D(){return A.D;}function IDX(){return A.IDX;}
var U=A.ui,view=U.view,pt=U.pt,card=U.card,backBtn=U.backBtn;
function AI(){return window.RIAI;}

// ---------- shared model helpers over index.semanticGraph ----------
function SG(){return D().semanticGraph;}
function nodeMap(){var m={};SG().nodes.forEach(function(n){m[n.id]=n;});return m;}

// A view-state: which container node ids are "expanded". We render the frontier:
// for each expanded node, show its children; collapsed nodes are shown as a single
// semantic node. Edges are lifted to the nearest visible ancestor.
function computeVisible(expanded, restrictSet){
  var nm=nodeMap();var sg=SG();
  var visible=new Set();
  // start from repo's children (domains) unless an intent restrictSet is given
  function addFrontier(id){
    var n=nm[id];if(!n)return;
    if(expanded.has(id)&&n.children&&n.children.length){ n.children.forEach(addFrontier); }
    else visible.add(id);
  }
  if(restrictSet){
    // show restricted nodes and expand into them
    restrictSet.forEach(function(id){var n=nm[id];if(!n){return;}addFrontier(id);});
  } else {
    var repo=sg.nodes.find(function(x){return x.kind==='repo';});
    (repo.children||[]).forEach(addFrontier);
    // include standalone tables at top level when relevant
  }
  return visible;
}
// map any node id to its nearest visible ancestor (for edge lifting)
function nearestVisible(id, visible){
  var nm=nodeMap();var cur=nm[id];
  while(cur){ if(visible.has(cur.id))return cur.id; cur=cur.parent?nm[cur.parent]:null; }
  return null;
}
function ancestorChain(id){var nm=nodeMap();var chain=[];var cur=nm[id];while(cur){chain.unshift(cur);cur=cur.parent?nm[cur.parent]:null;}return chain;}

// build render payload (nodes+links) for a visible set
function buildPayload(visible, heatKey){
  var nm=nodeMap();var sg=SG();
  var nodes=[];
  visible.forEach(function(id){
    var n=nm[id];if(!n)return;
    var heat=null;
    if(heatKey){ heat = n.metric ? n.metric[heatKey] : aggregateHeat(n, heatKey, nm); }
    nodes.push({id:n.id,label:n.label,kind:n.kind,files:n.files,functions:n.functions,count:countLabel(n),
      expandable:!!(n.children&&n.children.length),expanded:false,heat:heat,r:null});
  });
  // lift edges to visible ancestors
  var agg={};
  sg.edges.forEach(function(e){
    var s=nearestVisible(e.source,visible),t=nearestVisible(e.target,visible);
    if(!s||!t||s===t)return;
    var key=s+'->'+t;
    if(!agg[key])agg[key]={source:s,target:t,verb:e.verb,explanation:e.explanation,weight:0,verbs:{}};
    agg[key].weight+=e.count||1;agg[key].verbs[e.verb]=(agg[key].verbs[e.verb]||0)+(e.count||1);
  });
  var links=Object.keys(agg).map(function(k){var a=agg[k];var topVerb=Object.keys(a.verbs).sort(function(x,y){return a.verbs[y]-a.verbs[x];})[0];a.verb=topVerb;return a;});
  return {nodes:nodes,links:links};
}
// aggregate heat for a container node = max of descendant file heats (hotspot)
function aggregateHeat(n, key, nm){
  var stack=(n.children||[]).slice();var best=null;var guard=0;
  while(stack.length&&guard++<6000){
    var c=nm[stack.pop()];if(!c)continue;
    if(c.metric&&c.metric[key]!=null){if(best==null||c.metric[key]>best)best=c.metric[key];}
    if(c.children&&c.children.length)stack.push.apply(stack,c.children);
  }
  return best;
}
function countLabel(n){ if(n.kind==='domain'||n.kind==='module')return n.files+' files'; if(n.kind==='file')return (n.functions||0)+' fn'; return null; }

// ================= SEMANTIC GRAPH PAGE =================
var sgState={expanded:new Set(),layer:'all',intent:null,heat:null,search:''};
route('sgraph',function(content){
  var d=D();
  if(!d.semanticGraph){var v0=view(pt('Semantic Graph','Unavailable for this index.'));content.innerHTML='';content.appendChild(v0);return;}
  var v=view(pt('Semantic Graph','An AI-aware, layered knowledge map. Click a node to expand it (repo \u2192 domain \u2192 module \u2192 file \u2192 class/function). Switch layers, apply intent views, overlay heatmaps, and ask the graph questions. Every node & edge is factual; AI only explains.'));

  // ---- toolbar ----
  var bar=h('div',{class:'filter-bar'});
  // layer select
  var laySel=h('select');laySel.appendChild(h('option',{value:'all',text:'All layers'}));
  Object.keys(d.semanticGraph.layers).forEach(function(L){if(d.semanticGraph.layers[L].nodes.length)laySel.appendChild(h('option',{value:L,text:L[0].toUpperCase()+L.slice(1)+' layer'}));});
  laySel.value=sgState.layer;
  // intent select
  var intSel=h('select');intSel.appendChild(h('option',{value:'',text:'Intent: full graph'}));
  d.semanticGraph.intents.forEach(function(i){intSel.appendChild(h('option',{value:i.id,text:i.label}));});
  if(sgState.intent)intSel.value=sgState.intent;
  // heatmap select
  var heatSel=h('select');heatSel.appendChild(h('option',{value:'',text:'Heatmap: off'}));
  [['h_criticality','Criticality'],['h_mostImported','Most imported'],['h_mostCoupled','Most coupled'],['h_complexity','Highest complexity'],['h_leastTested','Least tested'],['h_risk','Highest risk']].forEach(function(x){heatSel.appendChild(h('option',{value:x[0],text:x[1]}));});
  if(sgState.heat)heatSel.value=sgState.heat;
  // search
  var searchI=h('input',{class:'grow',placeholder:'Search nodes in graph...',value:sgState.search});
  var expandAllBtn=h('button',{class:'btn ghost sm',text:'Expand domains'});
  var resetBtn=h('button',{class:'btn ghost sm',text:'Reset'});
  bar.appendChild(laySel);bar.appendChild(intSel);bar.appendChild(heatSel);bar.appendChild(searchI);bar.appendChild(expandAllBtn);bar.appendChild(resetBtn);
  v.appendChild(bar);

  // ---- graph + inspector layout ----
  var wrap=h('div',{style:'display:grid;grid-template-columns:1fr 320px;gap:14px;align-items:start'});
  var box=h('div',{class:'graph-box',style:'height:660px'});
  var controls=h('div',{class:'graph-controls'});
  var gEl=h('div',{style:'width:100%;height:100%'});
  box.appendChild(gEl);box.appendChild(controls);
  var legend=h('div',{class:'graph-legend'});box.appendChild(legend);
  var hint=h('div',{class:'graph-hint',text:'click node = expand/collapse · hover = explain'});box.appendChild(hint);
  wrap.appendChild(box);
  var inspector=h('div',{class:'card',style:'margin:0;max-height:660px;overflow:auto'});
  inspector.appendChild(el('<div class="mini">Hover or click a node/edge to inspect it. Use "Explain This Graph" for a narrated tour.</div>'));
  wrap.appendChild(inspector);
  v.appendChild(wrap);

  // ---- story / reasoning bar ----
  var story=h('div',{class:'card'});
  var storyBar=h('div',{class:'filter-bar'});
  var explainBtn=h('button',{class:'btn sm',text:'\u2727 Explain This Graph'});
  var modeSel=h('select');[['beginner','Beginner'],['intermediate','Intermediate'],['senior','Senior Engineer'],['architecture','Architecture'],['security','Security'],['performance','Performance']].forEach(function(m){modeSel.appendChild(h('option',{value:m[0],text:m[1]+' mode'}));});
  storyBar.appendChild(explainBtn);storyBar.appendChild(modeSel);storyBar.appendChild(el('<span class="mini">Narrate the current view for a chosen audience. Grounded in the graph.</span>'));
  story.appendChild(storyBar);
  var storyOut=h('div');story.appendChild(storyOut);
  v.appendChild(story);

  content.innerHTML='';content.appendChild(v);

  // ---- render ----
  var g=window.SemanticGraph(gEl,{
    onNodeClick:function(n){toggleExpand(n.id);},
    onNodeHover:function(n){if(n)showNodeInspector(inspector,n.id);},
    onEdgeHover:function(l){if(l)showEdgeInspector(inspector,l);},
    onEdgeClick:function(l){showEdgeInspector(inspector,l);}
  });
  function draw(){
    var restrict=null;
    if(sgState.intent){var it=d.semanticGraph.intents.find(function(x){return x.id===sgState.intent;});if(it)restrict=new Set(expandForIntent(it.nodeIds));}
    var visible=computeVisible(sgState.expanded,restrict);
    // layer filter
    if(sgState.layer!=='all'){var lay=new Set(d.semanticGraph.layers[sgState.layer].nodes);visible=new Set([...visible].filter(function(id){return nodeInLayer(id,lay);}));}
    var payload=buildPayload(visible,sgState.heat);
    g.setHeat(sgState.heat||null);
    // search highlight
    if(sgState.search){var q=sgState.search.toLowerCase();var ss=new Set(payload.nodes.filter(function(n){return n.label.toLowerCase().indexOf(q)>=0;}).map(function(n){return n.id;}));g.setSearch(ss.size?ss:null);}else g.setSearch(null);
    g.render(payload);
    legend.innerHTML=legendHtml();
    controls.innerHTML='';[['+',function(){g.zoomIn();}],['\u2212',function(){g.zoomOut();}],['\u2b1a',function(){g.fit();}]].forEach(function(cc){var b=h('button',{text:cc[0]});b.addEventListener('click',cc[1]);controls.appendChild(b);});
  }
  function toggleExpand(id){var nm=nodeMap();var n=nm[id];if(!n||!n.children||!n.children.length)return;if(sgState.expanded.has(id))sgState.expanded.delete(id);else sgState.expanded.add(id);draw();}
  function expandForIntent(nodeIds){ // ensure ancestors expanded so these show
    nodeIds.forEach(function(id){var chain=ancestorChain(id);chain.slice(0,-1).forEach(function(a){sgState.expanded.add(a.id);});});
    return nodeIds;
  }
  laySel.addEventListener('change',function(){sgState.layer=laySel.value;draw();});
  intSel.addEventListener('change',function(){sgState.intent=intSel.value||null;draw();});
  heatSel.addEventListener('change',function(){sgState.heat=heatSel.value||null;draw();});
  searchI.addEventListener('input',function(){sgState.search=searchI.value;draw();});
  expandAllBtn.addEventListener('click',function(){var repo=d.semanticGraph.nodes.find(function(x){return x.kind==='repo';});(repo.children||[]).forEach(function(id){sgState.expanded.add(id);});draw();});
  resetBtn.addEventListener('click',function(){sgState={expanded:new Set(),layer:'all',intent:null,heat:null,search:''};laySel.value='all';intSel.value='';heatSel.value='';searchI.value='';draw();});

  explainBtn.addEventListener('click',function(){
    if(!AI().aiReady()){storyOut.innerHTML='<div class="callout warn">Configure AI in Settings to narrate the graph. The graph itself works fully without AI.</div>';return;}
    var restrict=sgState.intent?d.semanticGraph.intents.find(function(x){return x.id===sgState.intent;}):null;
    var visible=[...computeVisible(sgState.expanded,restrict?new Set(restrict.nodeIds):null)];
    storyOut.innerHTML='<div class="mini">narrating ('+modeSel.value+' mode)...</div>';var acc='';
    AI().streamGenerate('/api/ai/graph',{id:D().source.id,kind:'story',mode:modeSel.value,visible:visible.slice(0,60),layer:sgState.layer,intent:sgState.intent,config:AI().getCfg()},
      function(t){acc+=t;storyOut.innerHTML='<div class="jsdoc">'+AI().renderMd(acc)+'</div>';},
      function(name,data){if(name==='error')storyOut.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';});
  });

  draw();
});

function nodeInLayer(id,laySet){
  // a node is in-layer if it or any descendant is in the layer set (so containers stay)
  if(laySet.has(id))return true;
  var nm=nodeMap();var n=nm[id];if(!n)return false;
  var stack=(n.children||[]).slice();var guard=0;
  while(stack.length&&guard++<5000){var c=stack.pop();if(laySet.has(c))return true;var cn=nm[c];if(cn&&cn.children)stack.push.apply(stack,cn.children);}
  return false;
}
function legendHtml(){
  var kinds=[['domain','Domain'],['module','Module'],['file','File'],['class','Class'],['function','Function'],['table','Table']];
  return kinds.map(function(k){return '<div class="lg"><span class="dot" style="background:'+window.SemanticGraph.kindColor(k[0])+'"></span>'+k[1]+'</div>';}).join('')+
    (sgState.heat?'<div class="lg"><span class="dot" style="background:linear-gradient(90deg,#3dd69a,#f5b13d,#f76d6d)"></span>heat: '+sgState.heat.replace('h_','')+'</div>':'');
}

// ---- inspector ----
function showNodeInspector(box,id){
  var nm=nodeMap();var n=nm[id];if(!n)return;
  var chain=ancestorChain(id).map(function(a){return a.label;}).join(' \u203a ');
  var html='<div style="font-size:13px;font-weight:650;margin-bottom:2px">'+esc(n.label)+' <span class="badge b-tag">'+n.kind+'</span></div>';
  html+='<div class="mini" style="margin-bottom:8px">'+esc(chain)+'</div>';
  // mechanical facts
  var kv=[];
  if(n.files!=null)kv.push(['Files',n.files]);
  if(n.loc!=null)kv.push(['LOC',num(n.loc)]);
  if(n.functions!=null)kv.push(['Functions',n.functions]);
  if(n.routes!=null&&n.routes)kv.push(['Routes',n.routes]);
  if(n.tables&&n.tables.length)kv.push(['Tables',n.tables.slice(0,6).join(', ')]);
  if(n.layers)kv.push(['Layers',n.layers.join(', ')]);
  if(n.metric){kv.push(['Fan-in (importers)',n.metric.fanIn]);kv.push(['Fan-out',n.metric.fanOut]);kv.push(['Complexity',n.metric.complexity]);kv.push(['Criticality',Math.round((n.metric.h_criticality||0)*100)+'%']);}
  html+='<div class="kv" style="grid-template-columns:130px 1fr">'+kv.map(function(p){return '<div class="k">'+esc(p[0])+'</div><div class="v">'+esc(String(p[1]))+'</div>';}).join('')+'</div>';
  box.innerHTML=html;
  // actions
  var acts=h('div',{class:'tag-row',style:'margin-top:10px'});
  if(n.kind==='file'){var open=h('span',{class:'chip',text:'Open file'});open.addEventListener('click',function(){nav('file/'+encodeURIComponent(n.path));});acts.appendChild(open);
    var imp=h('span',{class:'chip',text:'\u2325 Impact'});imp.addEventListener('click',function(){nav('trace/impact/file/'+encodeURIComponent(n.path));});acts.appendChild(imp);}
  if(n.kind==='domain'){var od=h('span',{class:'chip',text:'Open module'});od.addEventListener('click',function(){nav('domain/'+encodeURIComponent(n.id));});acts.appendChild(od);}
  if(n.kind==='table'){var ot=h('span',{class:'chip',text:'Open table'});ot.addEventListener('click',function(){nav('table/'+encodeURIComponent(n.label));});acts.appendChild(ot);}
  if(n.kind==='function'){var of=h('span',{class:'chip',text:'Open function'});of.addEventListener('click',function(){var f=D().functions.find(function(x){return x.file===n.path&&x.name===n.label&&x.line===n.line;});if(f)nav('function/'+encodeURIComponent(f.id));});acts.appendChild(of);}
  // AI reason button
  var reason=h('span',{class:'chip',text:'\u2727 Why is this here?'});
  reason.addEventListener('click',function(){reasonNode(box,n);});
  acts.appendChild(reason);
  box.appendChild(acts);
  var out=h('div',{style:'margin-top:8px'});box.appendChild(out);box._aiout=out;
}
function reasonNode(box,n){
  var out=box._aiout;if(!out)return;
  if(!AI().aiReady()){out.innerHTML='<div class="callout warn">Configure AI in Settings to explain nodes.</div>';return;}
  out.innerHTML='<div class="mini">reasoning...</div>';var acc='';
  AI().streamGenerate('/api/ai/graph',{id:D().source.id,kind:'node',nodeId:n.id,nodeKind:n.kind,label:n.label,path:n.path||null,config:AI().getCfg()},
    function(t){acc+=t;out.innerHTML='<div class="jsdoc" style="font-size:12px">'+AI().renderMd(acc)+'</div>';},
    function(name,data){if(name==='error')out.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';});
}
function showEdgeInspector(box,l){
  var nm=nodeMap();var s=nm[l.source],t=nm[l.target];
  var html='<div style="font-size:13px;font-weight:650;margin-bottom:6px">Relationship</div>';
  html+='<div class="jsdoc" style="font-size:12.5px">'+esc((s?s.label:l.source))+' <b style="color:var(--accent)">'+esc(l.verb)+'</b> '+esc((t?t.label:l.target))+'<div class="mini" style="margin-top:5px">'+esc(l.explanation||'')+' &middot; '+num(l.weight)+' underlying edge(s)</div></div>';
  box.innerHTML=html;
}

// ================= TIME MACHINE =================
route('timemachine',function(content){
  var d=D();
  var v=view(pt('Time Machine','Compare two refs and see how the architecture changed: added / removed / changed domains, modules, routes, tables, and dependencies. AI narrates the impact when configured.'));
  var input=(d.source&&d.source.input)||d.manifest.root;
  var c=h('div',{class:'card'});c.appendChild(el('<h2>Compare two refs</h2>'));
  var rowf=h('div',{class:'filter-bar'});
  var baseI=h('input',{placeholder:'base ref',style:'flex:1'});var headI=h('input',{placeholder:'head ref',style:'flex:1'});
  var btn=h('button',{class:'btn sm',text:'Animate changes'});
  rowf.appendChild(baseI);rowf.appendChild(headI);rowf.appendChild(btn);c.appendChild(rowf);
  var note=h('div',{class:'mini'});c.appendChild(note);v.appendChild(c);
  var out=h('div');v.appendChild(out);
  content.innerHTML='';content.appendChild(v);
  var id=d.source&&d.source.id;
  if(id)fetch('/api/refs?id='+id).then(function(r){return r.json();}).then(function(refs){if(refs.error){note.textContent='(refs unavailable: '+refs.error+')';return;}note.innerHTML='branches: '+(refs.branches||[]).slice(0,8).map(esc).join(', ');if(refs.branches&&refs.branches.length>1){baseI.value=refs.branches[1];headI.value=refs.branches[0];}}).catch(function(){});
  btn.addEventListener('click',function(){
    if(!baseI.value||!headI.value)return;btn.disabled=true;btn.textContent='Analyzing...';out.innerHTML='<div class="callout">Cloning + analyzing both refs...</div>';
    var cfg=AI().aiReady()?AI().getCfg():null;var diff=null;var aiBox=null;var acc='';
    AI().streamGenerate('/api/commit-intel',{input:input,baseRef:baseI.value,headRef:headI.value,config:cfg},
      function(t){acc+=t;if(aiBox)aiBox.innerHTML=AI().renderMd(acc);},
      function(name,data){
        if(name==='diff'){diff=data;out.innerHTML='';animateDiff(out,diff,baseI.value,headI.value);if(cfg){var cc=card('\u2727 AI architecture &amp; business impact',null);aiBox=h('div');aiBox.innerHTML='<div class="mini">narrating...</div>';cc.appendChild(aiBox);out.appendChild(cc);}else out.appendChild(el('<div class="callout warn">Configure AI in Settings for narrated impact.</div>'));}
        else if(name==='error'){if(aiBox)aiBox.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';}
        else if(name==='done'){btn.disabled=false;btn.textContent='Animate changes';}
      }
    ).then(function(){btn.disabled=false;btn.textContent='Animate changes';if(!diff){fetch('/api/commit-intel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:input,baseRef:baseI.value,headRef:headI.value})}).then(function(r){return r.json();}).then(function(res){if(res.diff){out.innerHTML='';animateDiff(out,res.diff,baseI.value,headI.value);out.appendChild(el('<div class="callout warn">Configure AI in Settings for narrated impact.</div>'));}});}}).catch(function(e){btn.disabled=false;btn.textContent='Animate changes';if(!diff)out.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
  });
});
function animateDiff(out,diff,base,head){
  var g=h('div',{class:'grid mgrid'});
  [['Risk',diff.riskLabel.toUpperCase(),diff.riskLabel==='high'?'var(--red)':diff.riskLabel==='medium'?'var(--amber)':'var(--green)'],['Routes +/-',(diff.routes.added.length)+' / '+(diff.routes.removed.length)],['Tables +/-',(diff.tables.added.length)+' / '+(diff.tables.removed.length)],['Functions +/-',(diff.functions.added.length)+' / '+(diff.functions.removed.length)],['Files +/-',(diff.files.added.length)+' / '+(diff.files.removed.length)]].forEach(function(x){g.appendChild(h('div',{class:'metric'},[h('div',{class:'v',style:x[2]?'color:'+x[2]:'',text:x[1]}),h('div',{class:'l',text:x[0]})]));});
  out.appendChild(g);
  // animated node list: added (green, slide in), removed (red, fade)
  var anim=card('Change animation ('+base+' \u2192 '+head+')',null);
  var lanes=h('div',{class:'two'});
  lanes.appendChild(changeLane('Added',diff.routes.added.map(function(x){return 'route '+x;}).concat(diff.tables.added.map(function(x){return 'table '+x;})).concat(diff.files.added.slice(0,30)),'var(--green)'));
  lanes.appendChild(changeLane('Removed',diff.routes.removed.map(function(x){return 'route '+x;}).concat(diff.tables.removed.map(function(x){return 'table '+x;})).concat(diff.files.removed.slice(0,30)),'var(--red)'));
  anim.appendChild(lanes);out.appendChild(anim);
  // stagger reveal
  var chips=anim.querySelectorAll('.tm-chip');
  chips.forEach(function(cp,i){cp.style.opacity='0';cp.style.transform='translateY(6px)';setTimeout(function(){cp.style.transition='all .3s';cp.style.opacity='1';cp.style.transform='none';},60*i);});
}
function changeLane(title,items,color){
  var c=card('<span style="color:'+color+'">'+title+' ('+items.length+')</span>',null);
  if(!items.length){c.appendChild(el('<div class="mini">none</div>'));return c;}
  var row=h('div',{class:'tag-row'});
  items.slice(0,60).forEach(function(it){row.appendChild(el('<span class="chip tm-chip" style="border-left:2px solid '+color+'">'+esc(String(it).split('/').pop())+'</span>'));});
  c.appendChild(row);return c;
}
})();
