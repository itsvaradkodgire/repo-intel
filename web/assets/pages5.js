/* pages5.js — Phase 4 Repository Brain UI (ADDITIVE).
 * New routes: brain, search (semantic), insights, timeline. Every page queries
 * the Brain (/api/brain/*), never re-analyzing. Backward compatible. */
(function(){
'use strict';
var A=window.RIAPP,h=A.h,el=A.el,esc=A.esc,num=A.num,baseName=A.baseName,route=A.route,nav=A.nav;
function D(){return A.D;}function IDX(){return A.IDX;}
var U=A.ui,view=U.view,pt=U.pt,card=U.card,table=U.table;
function AI(){return window.RIAI;}
function bid(){return D().source.id;}

// ================= REPOSITORY BRAIN =================
route('brain',function(content){
  var v=view(pt('Repository Brain','The persistent, central intelligence layer. Every page reads from here instead of re-analyzing. It stores the knowledge graph, semantic graph, embeddings, insights, AI memory, plugin contributions, and an incremental change history.'));
  var body=h('div');body.appendChild(el('<div class="callout">Loading the Brain...</div>'));
  v.appendChild(body);content.innerHTML='';content.appendChild(v);
  fetch('/api/brain?id='+bid()).then(function(r){return r.json();}).then(function(b){
    body.innerHTML='';
    if(b.error){body.appendChild(el('<div class="callout danger">'+esc(b.error)+'</div>'));return;}
    // stored knowledge grid
    var s=b.stored;
    var g=h('div',{class:'grid mgrid'});
    [['Knowledge graph',(s.knowledgeGraph?s.knowledgeGraph.nodes:0)+' nodes','accent'],
     ['Graph edges',(s.knowledgeGraph?s.knowledgeGraph.edges:0),''],
     ['Semantic graph',(s.semanticGraph?s.semanticGraph.nodes:0)+' nodes','accent'],
     ['Business domains',s.domains,''],
     ['Embeddings',num(s.embeddings),'green'],
     ['Plugin nodes',s.pluginNodes,''],
     ['Insight lists',s.insights,''],
     ['AI memory',s.memory,s.memory?'green':''],
     ['Change events',s.history,'']].forEach(function(x){g.appendChild(h('div',{class:'metric'},[h('div',{class:'v '+(x[2]||''),text:String(x[1])}),h('div',{class:'l',text:x[0]})]));});
    body.appendChild(g);

    // quick actions
    var qa=card('The Brain powers every feature',null);
    var row=h('div',{class:'tag-row'});
    [['\u2315 Semantic Search','search'],['\u2691 Insights','insights'],['\u29D6 Timeline','timeline'],['\u2b21 Semantic Graph','sgraph'],['\u2727 AI Assistant','ai']].forEach(function(a){var c=h('span',{class:'chip',text:a[0]});c.addEventListener('click',function(){nav(a[1]);});row.appendChild(c);});
    qa.appendChild(row);
    body.appendChild(qa);

    // incremental reindex
    var re=card('Incremental analysis',null);
    re.appendChild(el('<div class="mini" style="margin-bottom:8px">The Brain updates only what changed. Trigger a re-index to detect added / modified / deleted files and re-parse just those (nothing else is rebuilt).</div>'));
    var reBtn=h('button',{class:'btn sm',text:'\u21bb Re-index changes'});
    var reOut=h('span',{class:'mini',style:'margin-left:10px'});
    reBtn.addEventListener('click',function(){reBtn.disabled=true;reOut.textContent='scanning...';
      fetch('/api/brain/reindex',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:bid()})}).then(function(r){return r.json();}).then(function(res){reBtn.disabled=false;
        if(res.error){reOut.innerHTML='<span class="sev-high">'+esc(res.error)+'</span>';return;}
        if(res.note)reOut.innerHTML='<span class="status-dot ok"></span>'+esc(res.note)+' ('+res.unchanged+' unchanged)';
        else reOut.innerHTML='<span class="status-dot ok"></span>Re-indexed: +'+res.added+' / ~'+res.modified+' / -'+res.deleted+' ('+res.reparsed+' re-parsed, '+res.unchanged+' unchanged)';
      }).catch(function(e){reBtn.disabled=false;reOut.innerHTML='<span class="sev-high">'+esc(e.message)+'</span>';});
    });
    re.appendChild(reBtn);re.appendChild(reOut);
    body.appendChild(re);

    // plugins
    var pl=card('Analyzer plugins (SDK-contributed)',null);
    pl.appendChild(el('<div class="mini" style="margin-bottom:6px">Plugins extend the Brain with extra graph nodes, layers, and insights. Built-ins:</div>'));
    var prow=h('div',{class:'tag-row'});
    (b.available||[]).forEach(function(p){prow.appendChild(el('<span class="chip" style="cursor:default" title="'+esc(p.description)+'">'+esc(p.label)+'</span>'));});
    pl.appendChild(prow);
    body.appendChild(pl);

    // AI memory
    var mem=card('AI memory &amp; change history',null);
    var memBody=h('div');memBody.appendChild(el('<div class="mini">loading...</div>'));mem.appendChild(memBody);
    body.appendChild(mem);
    fetch('/api/brain/memory?id='+bid()).then(function(r){return r.json();}).then(function(m){
      memBody.innerHTML='';
      memBody.appendChild(el('<div class="mini" style="margin-bottom:6px">'+m.memory.length+' cached AI explanation(s). The Brain reuses these across sessions and regenerates only when a node changes.</div>'));
      if(m.history.length){var hist=h('div',{class:'section-scroll',style:'max-height:200px'});m.history.slice().reverse().forEach(function(hh){hist.appendChild(el('<div class="mini">'+esc((hh.at||'').slice(0,19).replace('T',' '))+' &middot; <b>'+esc(hh.event)+'</b> '+esc(Object.keys(hh).filter(function(k){return k!=='at'&&k!=='event';}).map(function(k){return k+':'+hh[k];}).join(' '))+'</div>'));});mem.appendChild(hist);}
      var clr=h('button',{class:'btn ghost sm',text:'Clear AI memory',style:'margin-top:8px'});
      clr.addEventListener('click',function(){fetch('/api/brain/memory?id='+bid(),{method:'DELETE'}).then(function(r){return r.json();}).then(function(x){memBody.innerHTML='<div class="mini"><span class="status-dot ok"></span>Cleared '+x.cleared+' memory entries.</div>';});});
      mem.appendChild(clr);
    });
  }).catch(function(e){body.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
});

// ================= SEMANTIC SEARCH =================
route('search',function(content,arg){
  var v=view(pt('Semantic Search','Ask in natural language. The Brain answers first from its offline embedding index (no AI needed); optionally get an AI narrative grounded in the results.'));
  var bar=h('div',{class:'filter-bar'});
  var q=h('input',{class:'grow',placeholder:'e.g. "how does authentication work" or "where is the database written"',value:arg||''});
  var goBtn=h('button',{class:'btn sm',text:'Search'});
  bar.appendChild(q);bar.appendChild(goBtn);v.appendChild(bar);
  // example chips
  var ex=h('div',{class:'tag-row',style:'margin-bottom:12px'});
  ['how does routing work','where is data written to the database','find everything about configuration','error handling','template rendering'].forEach(function(t){var c=h('span',{class:'chip',text:t});c.addEventListener('click',function(){q.value=t;run();});ex.appendChild(c);});
  v.appendChild(ex);
  var results=h('div');v.appendChild(results);
  var aiCard=h('div');v.appendChild(aiCard);
  content.innerHTML='';content.appendChild(v);
  function run(){
    if(!q.value.trim())return;
    results.innerHTML='<div class="mini">querying the Repository Brain...</div>';aiCard.innerHTML='';
    fetch('/api/brain/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:bid(),query:q.value})}).then(function(r){return r.json();}).then(function(res){
      results.innerHTML='';
      if(res.error){results.innerHTML='<div class="callout danger">'+esc(res.error)+'</div>';return;}
      var c=card('Results ('+res.results.length+') <span class="mini">from '+esc(res.source)+'</span>',null);
      if(!res.results.length)c.appendChild(el('<div class="empty">No matches.</div>'));
      res.results.forEach(function(x){
        var row=h('div',{class:'bar-row',onclick:(function(it){return function(){openResult(it);};})(x)});
        row.appendChild(el('<span class="badge '+badgeFor(x.type)+'">'+x.type+'</span>'));
        row.appendChild(el('<span class="mono" style="font-size:12.5px;margin-left:8px">'+esc(x.label)+'</span>'));
        row.appendChild(el('<span class="mini" style="margin-left:auto">'+esc(x.ref?baseName(x.ref):'')+' &middot; '+Math.round(x.score*100)+'%</span>'));
        c.appendChild(row);
      });
      results.appendChild(c);
      // optional AI narrative
      if(AI().aiReady()){
        var narr=card('\u2727 AI answer (grounded in these results)',null);var out=h('div');out.innerHTML='<div class="mini">generating...</div>';narr.appendChild(out);aiCard.appendChild(narr);
        var acc='';
        AI().streamGenerate('/api/ai/chat',{id:bid(),question:q.value,history:[],config:AI().getCfg()},
          function(t){acc+=t;out.innerHTML=AI().renderMd(acc);},
          function(name,data){if(name==='error')out.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';});
      } else {
        aiCard.appendChild(el('<div class="callout warn">Results above come straight from the Brain (offline). Configure AI in Settings for a narrated answer with citations.</div>'));
      }
    }).catch(function(e){results.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
  }
  goBtn.addEventListener('click',run);
  q.addEventListener('keydown',function(e){if(e.key==='Enter')run();});
  if(arg)run();
});
function badgeFor(t){return{file:'b-tag',function:'b-green',fn:'b-green',class:'b-purple',route:'b-accent',table:'b-amber',domain:'b-pink'}[t]||'b-tag';}
function openResult(x){
  if(x.type==='file')nav('file/'+encodeURIComponent(x.ref.split(':')[0]||x.ref));
  else if(x.type==='function'||x.type==='fn'){var id=x.id.replace(/^fn:/,'');nav('function/'+encodeURIComponent(id));}
  else if(x.type==='class'){var cid=x.id.replace(/^class:/,'');nav('class/'+encodeURIComponent(cid));}
  else if(x.type==='route')nav('apis');
  else if(x.type==='table')nav('table/'+encodeURIComponent(x.label));
  else if(x.type==='domain')nav('domain/'+encodeURIComponent(x.id));
}

// ================= INSIGHTS =================
route('insights',function(content){
  var v=view(pt('Repository Insights','Continuously ranked signals computed by the Brain: the modules that matter most, are riskiest, or need attention. Git churn is used where available.'));
  var body=h('div');body.appendChild(el('<div class="callout">Loading insights...</div>'));v.appendChild(body);content.innerHTML='';content.appendChild(v);
  fetch('/api/brain/insights?id='+bid()).then(function(r){return r.json();}).then(function(ins){
    body.innerHTML='';
    if(ins.error){body.appendChild(el('<div class="callout danger">'+esc(ins.error)+'</div>'));return;}
    if(!ins.hasGit)body.appendChild(el('<div class="callout warn">This clone has no git history (shallow), so churn-based insights (most modified / unstable / fastest growing) are unavailable. The rest are graph-derived.</div>'));
    var groups=[
      ['Most critical modules','mostCritical','criticality'],
      ['Highest risk','highestRisk','risk'],
      ['Most complex','mostComplex','complexity'],
      ['Most coupled','mostCoupled',null],
      ['Least documented','leastDocumented',null],
      ['Most modified (churn)','mostModified','churn'],
      ['Most unstable','mostUnstable',null],
      ['Fastest growing','fastestGrowing','churn'],
    ];
    var grid=h('div',{class:'two'});
    groups.forEach(function(gr){
      var items=ins[gr[1]]||[];if(!items.length)return;
      var c=card(gr[0],null);
      items.slice(0,10).forEach(function(it){
        var metric=gr[2]?(' &middot; '+gr[2]+' '+it[gr[2]]):(it.fanIn!=null?(' &middot; fan-in '+it.fanIn):'');
        c.appendChild(el('<div class="bar-row" onclick="RINAV(\'file/'+encodeURIComponent(it.path)+'\')"><span class="mono" style="font-size:12px">'+esc(it.label)+'</span><span class="mini" style="margin-left:auto">'+esc((it.path.split('/').slice(-2,-1)[0]||'')+metric)+'</span></div>'));
      });
      grid.appendChild(c);
    });
    body.appendChild(grid);
  }).catch(function(e){body.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
});

// ================= TIMELINE =================
route('timeline',function(content){
  var v=view(pt('Graph Timeline','Repository evolution sampled across git history: how code size, routes, tables, and tests grew over time. Full semantic diffs live in Time Machine / Compare.'));
  var body=h('div');body.appendChild(el('<div class="callout">Loading timeline...</div>'));v.appendChild(body);content.innerHTML='';content.appendChild(v);
  fetch('/api/brain/timeline?id='+bid()).then(function(r){return r.json();}).then(function(tl){
    body.innerHTML='';
    if(tl.error){body.appendChild(el('<div class="callout danger">'+esc(tl.error)+'</div>'));return;}
    if(!tl.available||!tl.points.length){body.appendChild(el('<div class="callout warn">No timeline available. This usually means a shallow clone (one commit). Re-analyze with a full history to see evolution.</div>'));return;}
    body.appendChild(el('<div class="mini" style="margin-bottom:10px">'+tl.totalCommits+' commits, sampled at '+tl.sampled+' points.</div>'));
    // chart: code files over time (bar sparkline)
    var chart=card('Code files over time',null);
    var maxCode=Math.max.apply(null,tl.points.map(function(p){return p.code;}));
    var barsWrap=h('div',{style:'display:flex;align-items:flex-end;gap:3px;height:160px;padding:8px 0'});
    tl.points.forEach(function(p,i){
      var pct=Math.round(p.code/maxCode*100);
      var bar=h('div',{style:'flex:1;background:var(--accent);opacity:0;border-radius:3px 3px 0 0;height:'+pct+'%',title:p.date.slice(0,10)+': '+p.code+' code files'});
      barsWrap.appendChild(bar);
      setTimeout(function(){bar.style.transition='opacity .3s';bar.style.opacity='0.8';},40*i);
    });
    chart.appendChild(barsWrap);
    chart.appendChild(el('<div class="mini" style="display:flex;justify-content:space-between"><span>'+esc(tl.points[0].date.slice(0,10))+'</span><span>'+esc(tl.points[tl.points.length-1].date.slice(0,10))+'</span></div>'));
    body.appendChild(chart);
    // evolution table
    var rows=tl.points.map(function(p){return{cells:['<span class="mono mini">'+esc(p.hash)+'</span>','<span class="mini">'+esc(p.date.slice(0,10))+'</span>',p.code,p.routes,p.tables,p.tests,'<span class="mini">'+esc(p.subject)+'</span>']};});
    body.appendChild(card('Evolution',table(['Commit','Date','Code','Routes~','Tables~','Tests','Subject'],rows)));
  }).catch(function(e){body.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
});
})();
