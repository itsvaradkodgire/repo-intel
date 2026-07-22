/* pages6.js — Phase 5 Intent & Business Intelligence UI (ADDITIVE).
 * New routes: system (System Map, default landing), product (Product Overview),
 * capmap (Capability Map), journeys, stories, tour, ask (Intent Search),
 * scorecard, beginner (Beginner Mode). Everything reads index.intel (mechanical);
 * AI is optional narration only. Fully backward compatible. */
(function(){
'use strict';
var A=window.RIAPP,h=A.h,el=A.el,esc=A.esc,num=A.num,baseName=A.baseName,route=A.route,nav=A.nav;
function D(){return A.D;}
var U=A.ui,view=U.view,pt=U.pt,card=U.card,table=U.table;
function AI(){return window.RIAI;}
function bid(){return D().source.id;}
function intel(){return D().intel;}

var KIND_COLOR={business:'#5b9dff',integration:'#3dd69a',infrastructure:'#f5b13d','cross-cutting':'#a98bff',technical:'#64748b'};
var KIND_LABEL={business:'Business',integration:'Integration',infrastructure:'Infrastructure','cross-cutting':'Cross-cutting',technical:'Technical'};
function kindColor(k){return KIND_COLOR[k]||'#64748b';}
function confBadge(label){var m={confident:'b-green',likely:'b-accent',possibly:'b-amber',low:'b-tag'};return m[label]||'b-tag';}
function confChip(c){return '<span class="badge '+confBadge(c.confidenceLabel)+'" title="confidence '+c.confidence+'">'+esc(c.confidenceLabel||'')+'</span>';}
function noIntel(content){content.innerHTML='';content.appendChild(view([pt('Not available','This view needs the Phase 5 intelligence layer.'),el('<div class="callout warn">This repository was analyzed before the intelligence layer existed. Click <b>Analyze another repo</b> and re-analyze to unlock System Map, Product Overview, Journeys, and more. (All existing pages keep working.)</div>')]));}

// ============ shared: capability card ============
function capCard(c,opts){
  opts=opts||{};
  var card=h('div',{class:'card clk',style:'border-left:3px solid '+kindColor(c.kind)+';cursor:pointer'});
  card.addEventListener('click',function(){nav('stories/'+encodeURIComponent(c.id));});
  var head=h('div',{style:'display:flex;align-items:center;gap:8px;flex-wrap:wrap'});
  head.appendChild(el('<h2 style="margin:0">'+esc(c.label)+'</h2>'));
  head.appendChild(el(confChip(c)));
  head.appendChild(el('<span class="badge b-tag" style="opacity:.7">'+esc(KIND_LABEL[c.kind]||c.kind)+'</span>'));
  card.appendChild(head);
  card.appendChild(el('<div class="mini" style="margin:6px 0 8px">'+esc(c.why)+'</div>'));
  var stats=h('div',{class:'tag-row'});
  if(c.evidence.fileCount||c.files)stats.appendChild(el('<span class="chip" style="cursor:default">'+(c.evidence?c.evidence.fileCount:c.files)+' files</span>'));
  if(c.evidence&&c.evidence.routes.length)stats.appendChild(el('<span class="chip" style="cursor:default">'+c.evidence.routes.length+' routes</span>'));
  if(c.evidence&&c.evidence.tables.length)stats.appendChild(el('<span class="chip" style="cursor:default">'+c.evidence.tables.length+' tables</span>'));
  if(c.evidence&&c.evidence.deps.length)stats.appendChild(el('<span class="chip b-green" style="cursor:default">'+esc(c.evidence.deps.slice(0,3).join(', '))+'</span>'));
  card.appendChild(stats);
  return card;
}

// ============ SYSTEM MAP (default landing) ============
route('system',function(content){
  if(!intel()||!intel().systemMap){return noIntel(content);}
  var sm=intel().systemMap,prod=intel().product;
  var v=view(pt('System Map','The systems this product is built from, and how they interact. Organized by what each part does, not by folders. Every link explains why the dependency exists.'));
  // summary line
  v.appendChild(el('<div class="callout"><b>'+esc(prod.productType)+'</b> '+confChip(prod)+' &nbsp;·&nbsp; '+sm.stats.systems+' systems, '+sm.stats.links+' links, '+sm.stats.business+' business capabilities. '+esc(prod.summary)+'</div>'));
  // quick nav
  var qn=h('div',{class:'tag-row',style:'margin-bottom:14px'});
  [['\u2637 Product Overview','product'],['\u25F0 Capability Map','capmap'],['\u2933 User Journeys','journeys'],['\u25C8 System Stories','stories'],['\u2691 Scorecard','scorecard'],['\u2315 Ask the Repo','ask'],['\u25B6 Guided Tour','tour']].forEach(function(a){var c=h('span',{class:'chip'});c.innerHTML=a[0];c.addEventListener('click',function(){nav(a[1]);});qn.appendChild(c);});
  v.appendChild(qn);
  // the map
  var mapCard=card('System interaction map <span class="mini">(click a system for its story; hover a link for the reason)</span>',null);
  var mapHost=h('div',{style:'position:relative'});
  mapCard.appendChild(mapHost);
  v.appendChild(mapCard);
  // business spine
  if(sm.spine&&sm.spine.length){
    var spineCard=card('Suggested product flow <span class="mini">(business systems by dependency order)</span>',null);
    var flow=h('div',{style:'display:flex;align-items:center;flex-wrap:wrap;gap:6px'});
    sm.spine.forEach(function(s,i){
      if(i)flow.appendChild(el('<span class="flow-arrow">\u2192</span>'));
      var n=h('span',{class:'chip',style:'cursor:pointer;border-color:'+kindColor('business')});n.textContent=s.label;n.addEventListener('click',(function(id){return function(){nav('stories/'+encodeURIComponent(id));};})(s.id));flow.appendChild(n);
    });
    spineCard.appendChild(flow);
    v.appendChild(spineCard);
  }
  content.innerHTML='';content.appendChild(v);
  renderSystemMap(mapHost,sm);
});

// SVG force-ish system map (deterministic circular layout + curved edges w/ why tooltips)
function renderSystemMap(host,sm){
  var nodes=sm.nodes.slice(0,26);
  var idset={};nodes.forEach(function(n){idset[n.id]=n;});
  var edges=sm.edges.filter(function(e){return idset[e.source]&&idset[e.target];}).slice(0,60);
  var W=Math.max(host.clientWidth||900,760),H=560,cx=W/2,cy=H/2;
  // place business in inner ring, others outer
  var biz=nodes.filter(function(n){return n.kind==='business';});
  var other=nodes.filter(function(n){return n.kind!=='business';});
  var pos={};
  function ring(list,r,off){list.forEach(function(n,i){var a=(i/list.length)*Math.PI*2+(off||0);pos[n.id]={x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r};});}
  ring(biz,Math.min(H,W)*0.24,-Math.PI/2);
  ring(other,Math.min(H,W)*0.42,-Math.PI/2+0.3);
  var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;background:var(--panel);border-radius:8px" id="sysmap-svg">';
  svg+='<defs><marker id="mk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5a6a85"/></marker></defs>';
  // edges
  var maxS=Math.max.apply(null,edges.map(function(e){return e.strength;}).concat([1]));
  edges.forEach(function(e,i){
    var a=pos[e.source],b=pos[e.target];if(!a||!b)return;
    var w=1+Math.round(e.strength/maxS*4);
    var mx=(a.x+b.x)/2,my=(a.y+b.y)/2-18;
    var reads=e.rels.indexOf('reads')>=0;
    svg+='<path d="M'+a.x.toFixed(1)+','+a.y.toFixed(1)+' Q'+mx.toFixed(1)+','+my.toFixed(1)+' '+b.x.toFixed(1)+','+b.y.toFixed(1)+'" fill="none" stroke="'+(reads?'#f5b13d':'#3a4761')+'" stroke-width="'+w+'" opacity="0.5" marker-end="url(#mk)" class="sm-edge" data-i="'+i+'"><title>'+esc(e.why)+'</title></path>';
  });
  // nodes
  nodes.forEach(function(n){
    var p=pos[n.id];if(!p)return;
    var r=n.kind==='business'?Math.min(34,16+Math.sqrt(n.files||1)*2.2):Math.min(24,12+Math.sqrt(n.files||1)*1.6);
    var col=kindColor(n.kind);
    svg+='<g class="sm-node" data-id="'+esc(n.id)+'" style="cursor:pointer">';
    svg+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+r.toFixed(1)+'" fill="'+col+'" fill-opacity="0.18" stroke="'+col+'" stroke-width="1.5"/>';
    svg+='<text x="'+p.x.toFixed(1)+'" y="'+(p.y+r+12).toFixed(1)+'" text-anchor="middle" font-size="11" fill="var(--text)" font-family="var(--sans)">'+esc(n.label.length>22?n.label.slice(0,20)+'…':n.label)+'</text>';
    svg+='</g>';
  });
  svg+='</svg>';
  // legend
  var leg='<div class="tag-row" style="margin-top:8px">';
  Object.keys(KIND_LABEL).forEach(function(k){leg+='<span class="mini" style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:50%;background:'+kindColor(k)+';display:inline-block"></span>'+esc(KIND_LABEL[k])+'</span>&nbsp;&nbsp;';});
  leg+='<span class="mini" style="margin-left:auto">amber link = data hand-off (reads a table another system writes)</span></div>';
  host.innerHTML=svg+leg;
  Array.prototype.forEach.call(host.querySelectorAll('.sm-node'),function(g){g.addEventListener('click',function(){nav('stories/'+encodeURIComponent(g.dataset.id));});});
}

// ============ PRODUCT OVERVIEW ============
route('product',function(content){
  if(!intel()){return noIntel(content);}
  var p=intel().product;
  var v=view(pt('Product Overview','What this application does, who it is for, and the problem it solves. Inferred from static analysis with explicit confidence. AI can narrate this, but every conclusion is grounded in code.'));
  // headline
  v.appendChild(el('<div class="callout" style="border-left:3px solid var(--accent)"><div style="font-size:16px;margin-bottom:4px"><b>'+esc(p.productType)+'</b> '+confChip(p)+'</div><div class="mini">'+esc(p.summary)+'</div></div>'));
  var g=h('div',{class:'two'});
  // problem + users
  var left=card('The problem it solves',[el('<div>'+esc(p.problemSolved)+'</div>')]);
  var uCard=card('Who uses it',null);
  var urow=h('div',{class:'tag-row'});
  p.users.forEach(function(u){urow.appendChild(el('<span class="chip" style="cursor:default">'+esc(u)+'</span>'));});
  uCard.appendChild(urow);
  left.appendChild(uCard);
  g.appendChild(left);
  // stack
  var stack=card('Technology stack',null);
  stack.appendChild(el('<div class="mini">Languages</div>'));
  var lr=h('div',{class:'tag-row',style:'margin-bottom:8px'});p.stack.languages.forEach(function(l){lr.appendChild(el('<span class="chip" style="cursor:default">'+esc(l)+'</span>'));});stack.appendChild(lr);
  if(p.stack.frameworks.length){stack.appendChild(el('<div class="mini">Frameworks</div>'));var fr=h('div',{class:'tag-row'});p.stack.frameworks.forEach(function(f){fr.appendChild(el('<span class="chip b-accent" style="cursor:default">'+esc(f)+'</span>'));});stack.appendChild(fr);}
  g.appendChild(stack);
  v.appendChild(g);
  // core features
  var feat=card('Core capabilities <span class="mini">(with confidence)</span>',null);
  if(!p.coreFeatures.length)feat.appendChild(el('<div class="empty">No distinct product capabilities were detected with confidence. This looks like technical or library code.</div>'));
  p.coreFeatures.forEach(function(f){
    var row=h('div',{class:'bar-row clk',onclick:(function(id){return function(){nav('stories/'+encodeURIComponent(id));};})(f.id)});
    row.innerHTML='<span class="mono" style="font-size:13px">'+esc(f.label)+'</span> '+confChip(f)+'<span class="mini" style="margin-left:auto">'+esc(f.why)+'</span>';
    feat.appendChild(row);
  });
  v.appendChild(feat);
  if(p.possibleFeatures.length){
    var pf=card('Possibly present <span class="mini">(low confidence — referenced but not clearly implemented)</span>',null);
    var pr=h('div',{class:'tag-row'});p.possibleFeatures.forEach(function(f){pr.appendChild(el('<span class="chip b-amber" style="cursor:default">'+esc(f.label)+'</span>'));});pf.appendChild(pr);v.appendChild(pf);
  }
  if(p.integrations.length){
    var ic=card('External integrations',null);
    p.integrations.forEach(function(i){ic.appendChild(el('<div class="bar-row"><span class="mono" style="font-size:13px">'+esc(i.label)+'</span> '+confChip(i)+'<span class="mini" style="margin-left:auto">'+esc(i.deps.slice(0,4).join(', '))+'</span></div>'));});
    v.appendChild(ic);
  }
  // AI narrative (optional)
  aiNarrative(v,'product',{},'Narrate this product overview');
  content.innerHTML='';content.appendChild(v);
});

// ============ CAPABILITY MAP ============
route('capmap',function(content,arg){
  if(!intel()||!intel().capabilityMap){return noIntel(content);}
  var cm=intel().capabilityMap;
  var v=view(pt('Capability Map','Start from business capabilities, drill into sub-capabilities, then the files, APIs, tables, tests, and docs that implement them. Begin with what the product does, not where the code lives.'));
  // filter by kind
  var bar=h('div',{class:'tag-row',style:'margin-bottom:12px'});
  var kinds=['all','business','integration','infrastructure','cross-cutting','technical'];
  var activeKind=arg||'all';
  kinds.forEach(function(k){var c=h('span',{class:'chip'+(k===activeKind?' b-accent':''),style:k!=='all'?'border-left:3px solid '+kindColor(k):''});c.textContent=k==='all'?'All':KIND_LABEL[k];c.addEventListener('click',function(){nav('capmap/'+k);});bar.appendChild(c);});
  v.appendChild(bar);
  var list=cm.capabilities.filter(function(c){return activeKind==='all'||c.kind===activeKind;});
  if(!list.length)v.appendChild(el('<div class="empty">No capabilities of this kind detected.</div>'));
  list.forEach(function(c){
    var cd=h('div',{class:'card',style:'border-left:3px solid '+kindColor(c.kind)});
    var head=h('div',{style:'display:flex;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer'});
    head.innerHTML='<h2 style="margin:0">'+esc(c.label)+'</h2> '+confChip(c)+' <span class="mini">'+c.fileCount+' files · '+c.loc+' LOC</span>';
    head.addEventListener('click',(function(id){return function(){nav('stories/'+encodeURIComponent(id));};})(c.id));
    cd.appendChild(head);
    cd.appendChild(el('<div class="mini" style="margin:4px 0 8px">'+esc(c.why)+'</div>'));
    // sub-capabilities
    if(c.subCapabilities.length){
      var subWrap=h('div',{style:'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px'});
      c.subCapabilities.forEach(function(s){
        var sc=h('div',{style:'background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:6px 10px'});
        sc.innerHTML='<div style="font-size:12.5px"><b>'+esc(s.label)+'</b></div><div class="mini">'+s.fileCount+' files · '+s.loc+' LOC</div>';
        subWrap.appendChild(sc);
      });
      cd.appendChild(subWrap);
    }
    // linked artifacts
    var links=h('div',{class:'tag-row'});
    if(c.apis.length)links.appendChild(el('<span class="chip b-accent" style="cursor:default" title="'+esc(c.apis.slice(0,10).join('\n'))+'">'+c.apis.length+' APIs</span>'));
    if(c.tables.length)links.appendChild(el('<span class="chip b-amber" style="cursor:default" title="'+esc(c.tables.join(', '))+'">'+c.tables.length+' tables</span>'));
    if(c.testCount)links.appendChild(el('<span class="chip b-green" style="cursor:default">'+c.testCount+' tests</span>'));
    if(c.docs.length)links.appendChild(el('<span class="chip" style="cursor:default">'+c.docs.length+' docs</span>'));
    if(c.deps.length)links.appendChild(el('<span class="chip" style="cursor:default">'+esc(c.deps.slice(0,3).join(', '))+'</span>'));
    cd.appendChild(links);
    v.appendChild(cd);
  });
  content.innerHTML='';content.appendChild(v);
});

// ============ USER JOURNEYS ============
route('journeys',function(content){
  if(!intel()||!intel().journeys){return noIntel(content);}
  var js=intel().journeys.journeys;
  var v=view(pt('User Journeys','How real users move through the product, inferred from the systems that exist. Each step links to the capability that implements it; missing steps are noted.'));
  if(!js.length)v.appendChild(el('<div class="empty">No user journeys could be inferred (no recognizable end-to-end capability sequences).</div>'));
  js.forEach(function(j){
    var jc=card(esc(j.label)+' '+confChip(j)+' <span class="mini">'+esc(j.persona)+' · '+j.coverage+'% coverage</span>',null);
    var flow=h('div',{style:'display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px'});
    j.steps.forEach(function(s,i){
      if(i)flow.appendChild(el('<span class="flow-arrow">\u2192</span>'));
      var n=h('div',{class:'flow-node clk',style:'cursor:pointer',title:s.entry||''});
      n.innerHTML='<div style="font-size:12.5px"><b>'+esc(s.label)+'</b></div>'+(s.entry?'<div class="mini">'+esc(baseName(String(s.entry)))+'</div>':'');
      n.addEventListener('click',(function(id){return function(){nav('stories/'+encodeURIComponent(id));};})(s.id));
      flow.appendChild(n);
    });
    jc.appendChild(flow);
    if(AI().aiReady()){var b=h('button',{class:'btn ghost sm',text:'\u2727 Narrate journey'});b.addEventListener('click',function(){b.remove();var out=h('div',{style:'margin-top:8px'});out.innerHTML='<div class="mini">generating...</div>';jc.appendChild(out);var acc='';AI().streamGenerate('/api/ai/intel',{id:bid(),kind:'journey',journeyId:j.id,config:AI().getCfg()},function(t){acc+=t;out.innerHTML=AI().renderMd(acc);},function(name,data){if(name==='error')out.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';});});jc.appendChild(b);}
    v.appendChild(jc);
  });
  content.innerHTML='';content.appendChild(v);
});

// ============ SYSTEM STORIES ============
route('stories',function(content,arg){
  if(!intel()||!intel().stories){return noIntel(content);}
  var stories=intel().stories.stories;
  if(arg){return renderStory(content,arg);}
  var v=view(pt('System Stories','Every major system explained as a story: its purpose, what it consumes and produces, who depends on it, its business value, and its risks.'));
  var grid=h('div',{class:'two'});
  stories.forEach(function(s){
    var c=capCardFromStory(s);grid.appendChild(c);
  });
  if(!stories.length)v.appendChild(el('<div class="empty">No system stories available.</div>'));
  v.appendChild(grid);
  content.innerHTML='';content.appendChild(v);
});
function capCardFromStory(s){
  var card=h('div',{class:'card clk',style:'border-left:3px solid '+kindColor(s.kind)+';cursor:pointer'});
  card.addEventListener('click',function(){nav('stories/'+encodeURIComponent(s.id));});
  card.innerHTML='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">'+esc(s.label)+'</h2>'+confChip(s)+'</div><div class="mini" style="margin:6px 0">'+esc(s.purpose)+'</div>';
  var meta=h('div',{class:'tag-row'});
  if(s.dependencies.length)meta.appendChild(el('<span class="chip" style="cursor:default">depends on '+s.dependencies.length+'</span>'));
  if(s.consumers.length)meta.appendChild(el('<span class="chip" style="cursor:default">used by '+s.consumers.length+'</span>'));
  if(s.risks.length)meta.appendChild(el('<span class="chip b-amber" style="cursor:default">'+s.risks.length+' risk file(s)</span>'));
  card.appendChild(meta);
  return card;
}
function renderStory(content,id){
  var s=intel().stories.stories.find(function(x){return x.id===id;});
  var cap=intel().capabilities.capabilities.find(function(x){return x.id===id;});
  if(!s&&!cap){content.innerHTML='';content.appendChild(view([pt('System not found',''),el('<div class="callout warn">No story for "'+esc(id)+'".</div>')]));return;}
  s=s||{label:cap.label,kind:cap.kind,purpose:cap.why,confidence:cap.confidence,confidenceLabel:cap.confidenceLabel,responsibilities:[],inputs:[],outputs:[],dependencies:[],consumers:[],risks:[],businessValue:'',files:cap.evidence.files};
  var v=view([h('div',{class:'detail-head'},[h('span',{class:'ic',text:'\u25C8'}),h('div',{},[h('h1',{class:'pt',style:'margin:0',text:s.label}),h('div',{class:'detail-sub',html:confChip(s)+' <span class="mini">'+esc(KIND_LABEL[s.kind]||s.kind)+' system</span>'})])])]);
  v.appendChild(el('<div class="callout"><b>Purpose.</b> '+esc(s.purpose)+'</div>'));
  var g=h('div',{class:'two'});
  g.appendChild(kv('Inputs',s.inputs));
  g.appendChild(kv('Outputs',s.outputs));
  v.appendChild(g);
  var g2=h('div',{class:'two'});
  g2.appendChild(depCard('Depends on',s.dependencies,true));
  g2.appendChild(depCard('Consumed by',s.consumers,false));
  v.appendChild(g2);
  if(s.responsibilities&&s.responsibilities.length){var rc=card('Key functions <span class="mini">(evidence)</span>',null);var rr=h('div',{class:'tag-row'});s.responsibilities.forEach(function(f){rr.appendChild(el('<span class="chip mono" style="cursor:default;font-size:11px">'+esc(f)+'()</span>'));});rc.appendChild(rr);v.appendChild(rc);}
  v.appendChild(el('<div class="callout" style="border-left:3px solid var(--green)"><b>Business value.</b> '+esc(s.businessValue||'')+'</div>'));
  if(s.risks&&s.risks.length){var rk=card('Risks to watch',null);s.risks.forEach(function(r){rk.appendChild(el('<div class="bar-row clk" onclick="RINAV(\'file/'+encodeURIComponent(r.path)+'\')"><span class="mono" style="font-size:12px">'+esc(baseName(r.path))+'</span><span class="mini" style="margin-left:auto">'+esc(r.reasons.join('; '))+'</span></div>'));});v.appendChild(rk);}
  // files
  if(s.files&&s.files.length){var fc=card('Implementation files',null);var fr=h('div',{class:'tag-row'});s.files.slice(0,20).forEach(function(p){var c=h('span',{class:'chip mono',style:'cursor:pointer;font-size:11px'});c.textContent=baseName(p);c.addEventListener('click',(function(pp){return function(){nav('file/'+encodeURIComponent(pp));};})(p));fr.appendChild(c);});fc.appendChild(fr);v.appendChild(fc);}
  aiNarrative(v,'story',{systemId:id},'Tell this system\u2019s story');
  content.innerHTML='';content.appendChild(v);
}
function kv(title,items){var c=card(title,null);(items||[]).forEach(function(i){c.appendChild(el('<div class="bar-row"><span style="font-size:13px">'+esc(i)+'</span></div>'));});if(!items||!items.length)c.appendChild(el('<div class="empty">—</div>'));return c;}
function depCard(title,deps,out){
  var c=card(title,null);
  if(!deps.length){c.appendChild(el('<div class="empty">None detected</div>'));return c;}
  deps.forEach(function(d){
    var row=h('div',{class:'bar-row clk',style:'cursor:pointer',onclick:(function(id){return function(){nav('stories/'+encodeURIComponent(id));};})(d.id)});
    row.innerHTML='<span class="mono" style="font-size:12.5px">'+esc(d.label)+'</span><span class="mini" style="margin-left:auto;max-width:60%;text-align:right">'+esc(d.why||'')+'</span>';
    c.appendChild(row);
  });
  return c;
}

// ============ GUIDED TOUR ============
route('tour',function(content){
  if(!intel()||!intel().tour){return noIntel(content);}
  var tour=intel().tour;
  var v=view(pt('AI Repository Tour','A guided walkthrough of the systems that matter, ordered for a newcomer. Adapts to repository complexity. Works offline; AI narrates each stop if configured.'));
  v.appendChild(el('<div class="callout" style="border-left:3px solid var(--accent)">'+esc(tour.intro)+'</div>'));
  if(!tour.stops.length){content.innerHTML='';content.appendChild(v);return;}
  var prog=h('div',{class:'mini',style:'margin-bottom:10px'});
  v.appendChild(prog);
  var stage=h('div');v.appendChild(stage);
  var i=0;
  function show(){
    var s=tour.stops[i];
    prog.textContent='Stop '+(i+1)+' of '+tour.stops.length+' · ~'+tour.estimatedMinutes+' min total';
    stage.innerHTML='';
    var c=h('div',{class:'card',style:'border-left:3px solid '+kindColor(s.kind)});
    c.innerHTML='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="badge b-accent">'+(i+1)+'</span><h2 style="margin:0">'+esc(s.label)+'</h2><span class="badge '+confBadge(s.confidence>=.75?'confident':s.confidence>=.5?'likely':'possibly')+'">'+esc(KIND_LABEL[s.kind]||s.kind)+'</span></div>'+
      '<div class="mini" style="margin:8px 0"><b>Why it exists.</b> '+esc(s.why)+'</div>'+
      '<div class="mini"><b>Connections.</b> '+esc(s.teaser)+'</div>'+
      '<div class="mini" style="margin-top:6px">'+s.files+' files'+(s.entry?' · entry: <span class="mono">'+esc(baseName(String(s.entry)))+'</span>':'')+'</div>';
    var btns=h('div',{class:'tag-row',style:'margin-top:12px'});
    var openBtn=h('button',{class:'btn ghost sm',text:'Open system \u2192'});openBtn.addEventListener('click',function(){nav('stories/'+encodeURIComponent(s.id));});
    btns.appendChild(openBtn);
    if(AI().aiReady()){var nb=h('button',{class:'btn ghost sm',text:'\u2727 Explain this stop'});nb.addEventListener('click',function(){nb.remove();var out=h('div',{style:'margin-top:10px'});out.innerHTML='<div class="mini">generating...</div>';c.appendChild(out);var acc='';AI().streamGenerate('/api/ai/intel',{id:bid(),kind:'tour',systemId:s.id,config:AI().getCfg()},function(t){acc+=t;out.innerHTML=AI().renderMd(acc);},function(name,data){if(name==='error')out.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';});});btns.appendChild(nb);}
    c.appendChild(btns);
    stage.appendChild(c);
    var navb=h('div',{style:'display:flex;gap:8px;margin-top:12px'});
    if(i>0){var pv=h('button',{class:'btn sm ghost',text:'\u2190 Previous'});pv.addEventListener('click',function(){i--;show();});navb.appendChild(pv);}
    if(i<tour.stops.length-1){var nx=h('button',{class:'btn sm',text:'Continue to '+tour.stops[i+1].label+' \u2192'});nx.addEventListener('click',function(){i++;show();});navb.appendChild(nx);}
    else navb.appendChild(el('<div class="callout" style="flex:1">Tour complete. You\u2019ve seen the '+tour.stops.length+' most important systems. Explore the <span class="c-link" onclick="RINAV(\'system\')">System Map</span> next.</div>'));
    stage.appendChild(navb);
  }
  show();
  content.innerHTML='';content.appendChild(v);
});

// ============ INTENT SEARCH (Ask the Repo) ============
route('ask',function(content,arg){
  if(!intel()){return noIntel(content);}
  var v=view(pt('Ask the Repository','Ask in plain language: "how are users authenticated?", "where is salary calculated?", "how are emails sent?". The Brain translates your intent into a graph query over the code and answers with evidence.'));
  var bar=h('div',{class:'filter-bar'});
  var q=h('input',{class:'grow',placeholder:'Ask a question about how this product works...',value:arg||''});
  var go=h('button',{class:'btn sm',text:'Ask'});
  bar.appendChild(q);bar.appendChild(go);v.appendChild(bar);
  var ex=h('div',{class:'tag-row',style:'margin-bottom:12px'});
  ['how are users authenticated?','where is salary calculated?','how are emails sent?','how is caching implemented?','where is data written to the database?','how does AI work?'].forEach(function(t){var c=h('span',{class:'chip',text:t});c.addEventListener('click',function(){q.value=t;run();});ex.appendChild(c);});
  v.appendChild(ex);
  var out=h('div');v.appendChild(out);
  function run(){
    if(!q.value.trim())return;
    out.innerHTML='<div class="mini">translating intent into a graph query...</div>';
    fetch('/api/intel/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:bid(),query:q.value})}).then(function(r){return r.json();}).then(function(res){
      out.innerHTML='';
      if(res.error){out.innerHTML='<div class="callout danger">'+esc(res.error)+'</div>';return;}
      // answer card
      var ac=h('div',{class:'card',style:'border-left:3px solid var(--accent)'});
      ac.innerHTML='<div style="margin-bottom:4px"><span class="badge b-tag">'+esc(res.op)+'</span>'+(res.target?' <span class="badge '+confBadge(res.target.confidence>=.75?'confident':res.target.confidence>=.5?'likely':'possibly')+'">'+esc(res.target.label)+'</span>':'')+'</div><div>'+AI().renderMd(res.answer)+'</div>';
      out.appendChild(ac);
      // evidence
      var ev=res.evidence;
      if(ev.functions.length){var fc=card('Functions ('+ev.functions.length+')',null);ev.functions.forEach(function(f){fc.appendChild(el('<div class="bar-row clk" onclick="RIAPP_openRef(\''+encodeURIComponent(f.file)+'\')"><span class="mono" style="font-size:12px">'+esc(f.name)+'()</span><span class="mini" style="margin-left:auto">'+esc(f.file)+':'+f.line+'</span></div>'));});out.appendChild(fc);}
      if(ev.tables.length){var tc=card('Tables ('+ev.tables.length+')',null);var tr=h('div',{class:'tag-row'});ev.tables.forEach(function(t){var c=h('span',{class:'chip b-amber',style:'cursor:pointer'});c.textContent=t;c.addEventListener('click',(function(tt){return function(){nav('table/'+encodeURIComponent(tt));};})(t));tr.appendChild(c);});tc.appendChild(tr);out.appendChild(tc);}
      if(ev.routes.length){var rc=card('Endpoints ('+ev.routes.length+')',null);var rr=h('div',{class:'tag-row'});ev.routes.forEach(function(r){rr.appendChild(el('<span class="chip b-accent" style="cursor:default">'+esc(r)+'</span>'));});rc.appendChild(rr);out.appendChild(rc);}
      if(ev.files.length){var flc=card('Files ('+ev.files.length+')',null);var flr=h('div',{class:'tag-row'});ev.files.forEach(function(p){var c=h('span',{class:'chip mono',style:'cursor:pointer;font-size:11px'});c.textContent=baseName(p);c.addEventListener('click',(function(pp){return function(){nav('file/'+encodeURIComponent(pp));};})(p));flr.appendChild(c);});flc.appendChild(flr);out.appendChild(flc);}
      if(res.related&&res.related.length){out.appendChild(el('<div class="mini" style="margin-top:8px">Related systems: '+res.related.map(function(r){return '<span class="c-link" onclick="RINAV(\'stories/'+encodeURIComponent(r.id)+'\')">'+esc(r.label)+'</span>';}).join(', ')+'</div>'));}
      // AI narrative
      if(AI().aiReady()){var narr=card('\u2727 AI answer (grounded in the evidence above)',null);var no=h('div');no.innerHTML='<div class="mini">generating...</div>';narr.appendChild(no);out.appendChild(narr);var acc='';AI().streamGenerate('/api/ai/intel',{id:bid(),kind:'intent',query:q.value,config:AI().getCfg()},function(t){acc+=t;no.innerHTML=AI().renderMd(acc);},function(name,data){if(name==='error')no.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';});}
    }).catch(function(e){out.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
  }
  go.addEventListener('click',run);q.addEventListener('keydown',function(e){if(e.key==='Enter')run();});
  if(arg)run();
  content.innerHTML='';content.appendChild(v);
});

// ============ SCORECARD ============
route('scorecard',function(content){
  if(!intel()||!intel().scorecard){return noIntel(content);}
  var sc=intel().scorecard;
  var v=view(pt('Product Scorecard','A product-level maturity assessment: architecture, modularity, domain separation, AI readiness, and more, with concrete recommendations.'));
  // overall gauge
  v.appendChild(el('<div class="callout" style="border-left:3px solid '+scoreColor(sc.overall)+'"><span style="font-size:26px;font-weight:700;color:'+scoreColor(sc.overall)+'">'+sc.overall+'</span> <span class="mini">/ 100 overall product maturity</span></div>'));
  var grid=h('div',{class:'grid mgrid'});
  sc.scores.forEach(function(s){
    var m=h('div',{class:'metric'});
    m.innerHTML='<div class="v" style="color:'+scoreColor(s.value)+'">'+s.value+'</div><div class="l">'+esc(s.label)+'</div><div class="bar-track" style="margin-top:6px"><div class="bar-fill" style="width:'+s.value+'%;background:'+scoreColor(s.value)+'"></div></div>';
    grid.appendChild(m);
  });
  v.appendChild(grid);
  // recommendations
  if(sc.recommendations.length){var rc=card('Recommendations',null);sc.recommendations.forEach(function(r){rc.appendChild(el('<div class="bar-row"><span class="badge b-amber">'+r.value+'</span><span style="font-size:13px;margin-left:8px"><b>'+esc(r.area)+'.</b> '+esc(r.advice)+'</span></div>'));});v.appendChild(rc);}
  aiNarrative(v,'scorecard',{},'Summarize the assessment');
  content.innerHTML='';content.appendChild(v);
});
function scoreColor(v){return v>=75?'var(--green)':v>=50?'var(--amber)':'var(--red)';}

// ============ BEGINNER MODE ============
route('beginner',function(content){
  if(!intel()){return noIntel(content);}
  var p=intel().product,tour=intel().tour,js=intel().journeys.journeys;
  var v=view(pt('Beginner Mode','A jargon-free explanation of this repository, as if onboarding a brand-new engineer. No prior knowledge assumed.'));
  v.appendChild(el('<div class="callout" style="border-left:3px solid var(--green)"><b>In plain English.</b> This is '+esc(aOrAn(p.productType))+' '+esc(p.productType)+'. '+esc(p.problemSolved)+'</div>'));
  // what can users do
  var wc=card('What can people do with it?',null);
  if(p.coreFeatures.length){p.coreFeatures.forEach(function(f){wc.appendChild(el('<div class="bar-row"><span style="font-size:13px">\u2022 '+esc(plainFeature(f.label))+'</span><span class="mini" style="margin-left:auto">'+esc(f.confidenceLabel)+'</span></div>'));});}
  else wc.appendChild(el('<div class="empty">This looks like technical/library code rather than a user-facing product.</div>'));
  v.appendChild(wc);
  // where to start
  if(tour.stops.length){
    var sc=card('Where should I start reading?',null);
    sc.appendChild(el('<div class="mini" style="margin-bottom:8px">Follow these in order. Estimated time: about '+tour.estimatedMinutes+' minutes.</div>'));
    tour.stops.slice(0,6).forEach(function(s,i){sc.appendChild(el('<div class="bar-row clk" onclick="RINAV(\'stories/'+encodeURIComponent(s.id)+'\')"><span class="badge b-tag">'+(i+1)+'</span><span style="font-size:13px;margin-left:8px">'+esc(s.label)+'</span><span class="mini" style="margin-left:auto">'+esc(plainWhy(s.why))+'</span></div>'));});
    var tb=h('button',{class:'btn sm',style:'margin-top:10px',text:'\u25B6 Take the guided tour'});tb.addEventListener('click',function(){nav('tour');});sc.appendChild(tb);
    v.appendChild(sc);
  }
  // a typical journey
  if(js.length){var jc=card('A typical thing a user does',null);var j=js[0];var flow=h('div',{style:'display:flex;align-items:center;flex-wrap:wrap;gap:6px'});jc.appendChild(el('<div class="mini" style="margin-bottom:8px">Example: <b>'+esc(j.label)+'</b> (as '+esc(aOrAn(j.persona))+' '+esc(j.persona)+')</div>'));j.steps.forEach(function(s,i){if(i)flow.appendChild(el('<span class="flow-arrow">\u2192</span>'));flow.appendChild(el('<span class="chip" style="cursor:default">'+esc(s.label)+'</span>'));});jc.appendChild(flow);v.appendChild(jc);}
  aiNarrative(v,'product',{},'Explain like I\u2019m new here');
  content.innerHTML='';content.appendChild(v);
});
function aOrAn(w){return /^[aeiou]/i.test(String(w))?'an':'a';}
function plainFeature(l){return l.replace(/ & /g,' and ').replace(/\//g,' or ');}
function plainWhy(w){return w;}

// ============ shared: optional AI narrative block ============
function aiNarrative(container,kind,extra,label){
  if(!AI().aiReady()){container.appendChild(el('<div class="callout warn" style="margin-top:8px">Everything above is computed from static analysis (no AI needed). Configure AI in <span class="c-link" onclick="RINAV(\'settings\')">Settings</span> for a narrated explanation.</div>'));return;}
  var wrap=card('\u2727 '+label+' <span class="mini">(AI, grounded in the analysis)</span>',null);
  var btn=h('button',{class:'btn ghost sm',text:'Generate'});
  var out=h('div',{style:'margin-top:8px'});
  btn.addEventListener('click',function(){btn.disabled=true;out.innerHTML='<div class="mini">generating...</div>';var acc='';AI().streamGenerate('/api/ai/intel',Object.assign({id:bid(),kind:kind,config:AI().getCfg()},extra),function(t){acc+=t;out.innerHTML=AI().renderMd(acc);},function(name,data){btn.disabled=false;if(name==='error')out.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';});});
  wrap.appendChild(btn);wrap.appendChild(out);container.appendChild(wrap);
}
})();
