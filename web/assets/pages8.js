/* pages8.js — Trace Engine Investigation UI (ADDITIVE).
 *
 * The new center of the product: code investigation. Routes:
 *   investigate            question box + suggested types + candidate flows
 *   investigate/<query>    results for a concept query
 *   flow/<flowId>          a candidate flow with tabs (Overview/Flow/Calculations/
 *                          Variables/API/Database/Code/Issues)
 *   explain/<methodId>/<var>   Explain Calculation for one value
 *   tracevar/<methodId>/<var>/<dir>   Trace a variable backward/forward
 *   method2/<methodId>     method detail (calls/callers/locals/returns)
 * Every explanation is inspectable: clicking evidence opens the real source range.
 * AI is optional and only narrates verified evidence.
 */
(function(){
'use strict';
var A=window.RIAPP,h=A.h,el=A.el,esc=A.esc,num=A.num,baseName=A.baseName,route=A.route,nav=A.nav;
var U=A.ui,view=U.view,pt=U.pt,card=U.card;
function D(){return A.D;}
function AI(){return window.RIAI;}
function bid(){return D().source&&D().source.id;}
function traceAvail(){var t=D().trace;return t&&t.available;}

function confBadge(c){var m={verified:'b-green',high:'b-green',inferred:'b-amber',medium:'b-amber',possible:'b-tag',low:'b-tag',unknown:'b-tag'};return m[c]||'b-tag';}
function api(pathUrl,body){return fetch(pathUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json();});}
function apiGet(pathUrl){return fetch(pathUrl).then(function(r){return r.json();});}

// ---- code evidence popover: click a file:line to see the real source ----
function codeRef(file,line,label){
  if(!file)return esc(label||'');
  var l=line||1;
  var txt=label||(baseName(file)+':'+l);
  return '<span class="code-ref" data-file="'+esc(file)+'" data-line="'+l+'" title="View source">'+esc(txt)+'</span>';
}
function wireCodeRefs(container){
  Array.prototype.forEach.call(container.querySelectorAll('.code-ref'),function(elm){
    if(elm._wired)return;elm._wired=true;
    elm.addEventListener('click',function(e){e.stopPropagation();openSource(elm.dataset.file,+elm.dataset.line);});
  });
}
function openSource(file,line){
  var from=Math.max(1,line-6),to=line+8;
  var ov=document.getElementById('src-pop')||(function(){var d=el('<div id="src-pop"></div>');document.body.appendChild(d);return d;})();
  ov.innerHTML='<div class="src-pop-inner"><div class="src-pop-head"><span class="mono">'+esc(file)+':'+line+'</span><span class="src-pop-x">\u00d7</span></div><div class="src-pop-body mini">loading...</div></div>';
  ov.style.display='flex';
  ov.querySelector('.src-pop-x').addEventListener('click',function(){ov.style.display='none';});
  ov.addEventListener('click',function(e){if(e.target===ov)ov.style.display='none';});
  apiGet('/api/trace2/source?id='+bid()+'&file='+encodeURIComponent(file)+'&from='+from+'&to='+to).then(function(r){
    if(r.error){ov.querySelector('.src-pop-body').innerHTML='<span class="sev-high">'+esc(r.error)+'</span>';return;}
    var html=r.lines.map(function(ln,i){var n=r.from+i;var hot=n===line;return '<div class="src-line'+(hot?' hot':'')+'"><span class="src-ln">'+n+'</span><code>'+esc(ln)+'</code></div>';}).join('');
    ov.querySelector('.src-pop-body').innerHTML='<div class="src-code">'+html+'</div>';
  });
}

// ================= INVESTIGATE (landing + results) =================
route('investigate',function(content,arg){
  var v=view([]);
  v.appendChild(el('<h1 class="pt" style="font-size:24px">Investigate the code</h1>'));
  v.appendChild(el('<div class="pd">Ask how a feature works, where a value comes from, or what a calculation does. Answers are built from verified code evidence, not guesses.</div>'));

  if(!traceAvail()){
    v.appendChild(el('<div class="callout warn">Deep code tracing currently targets <b>Java / Spring</b>. This repository is '+esc((D().languages||[]).slice(0,3).map(function(l){return l.label;}).join(', '))+'. Analyze a Java/Spring repository to use full investigation. (All other views still work.)</div>'));
    content.innerHTML='';content.appendChild(v);return;
  }

  // question box
  var bar=h('div',{class:'invq'});
  var q=h('input',{class:'invq-input',placeholder:'e.g. How is payroll calculated?  \u00b7  Where does netSalary come from?',value:arg||''});
  var go=h('button',{class:'btn',text:'Investigate'});
  bar.appendChild(q);bar.appendChild(go);v.appendChild(bar);

  // suggested types + example questions
  var sug=h('div',{class:'inv-sugg'});
  [['\u2699 Feature','How is payroll calculated?'],['\u2192 Data','Where does netSalary come from?'],['\u0192 Calculation','How is net salary calculated?'],['\u21C4 API','What API sends payroll data?'],['{} Code','Where is grossSalary defined?']].forEach(function(s){
    var c=h('span',{class:'chip'});c.innerHTML=esc(s[0]);c.title=s[1];c.addEventListener('click',function(){q.value=s[1];run();});sug.appendChild(c);
  });
  v.appendChild(sug);

  var out=h('div');v.appendChild(out);
  // trace model at-a-glance
  var t=D().trace;
  out.appendChild(el('<div class="mini" style="margin:10px 0">Indexed: '+t.stats.classes+' classes \u00b7 '+t.stats.methods+' methods \u00b7 '+t.stats.controllers+' controllers \u00b7 '+t.stats.services+' services \u00b7 '+t.stats.repositories+' repositories \u00b7 '+t.stats.entities+' entities'+(t.looseEnds&&t.looseEnds.length?' \u00b7 <span class="sev-medium">'+t.looseEnds.length+' loose ends</span>':'')+'</div>'));

  function run(){
    if(!q.value.trim())return;
    location.hash='#/investigate/'+encodeURIComponent(q.value.trim());
    results(out,q.value.trim());
  }
  go.addEventListener('click',run);
  q.addEventListener('keydown',function(e){if(e.key==='Enter')run();});
  content.innerHTML='';content.appendChild(v);
  if(arg)results(out,arg);
});

function results(out,query){
  out.innerHTML='<div class="mini">investigating with static analysis...</div>';
  api('/api/trace2/investigate',{id:bid(),query:query}).then(function(r){
    out.innerHTML='';
    if(r.error){out.innerHTML='<div class="callout danger">'+esc(r.error)+'</div>';return;}
    if(r.available===false){out.innerHTML='<div class="callout warn">'+esc(r.reason||'unavailable')+'</div>';return;}
    if(!r.flows||!r.flows.length){out.appendChild(el('<div class="empty">No candidate flows found for "'+esc(query)+'". Try another term.</div>'));return;}
    out.appendChild(el('<div class="sec-h" style="margin-top:6px"><h2>Found '+r.flows.length+' candidate flow'+(r.flows.length>1?'s':'')+'</h2><span class="mini">ranked by evidence \u00b7 select one to investigate</span></div>'));
    if(r.flows.length>1)out.appendChild(el('<div class="callout" style="border-color:var(--amber)">Multiple implementations exist. They are shown separately, never merged.</div>'));
    r.flows.forEach(function(f){
      var c=h('div',{class:'flow-card',onclick:(function(id){return function(){nav('feature/'+encodeURIComponent(id));};})(f.id)});
      var conf=Math.round(f.confidence*100);
      c.innerHTML=
        '<div class="flow-card-head"><span class="flow-name">'+esc(f.name)+'</span>'+
        '<span class="badge '+confBadge(f.confidenceLabel)+'">'+f.confidenceLabel+' '+conf+'%</span></div>'+
        '<div class="mini" style="margin:4px 0 8px">Entry: <span class="mono">'+esc(f.entry.class.split('.').pop())+'.'+esc(f.entry.name)+'()</span></div>'+
        '<div class="ev-badges">'+
        badgeIf(f.evidence.entryPoints&&f.evidence.entryPoints.length,'API entry')+
        badgeIf(f.evidence.services&&f.evidence.services.length,f.evidence.services.length+' service(s)')+
        badgeIf(f.evidence.calculators&&f.evidence.calculators.length,f.evidence.calculators.length+' calculator(s)')+
        badgeIf(f.evidence.persists,'persists to DB')+
        badgeIf(f.evidence.columns&&f.evidence.columns.length,f.evidence.columns.length+' column(s)')+
        badgeIf(f.evidence.formulas&&f.evidence.formulas.length,f.evidence.formulas.length+' formula(s)')+
        '</div>';
      out.appendChild(c);
    });
  }).catch(function(e){out.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
}
function badgeIf(cond,label){return cond?'<span class="ev-badge">'+esc(label)+'</span>':'';}

// ================= FLOW DETAIL (tabs) =================
var _flowCache={};
route('feature',function(content,arg){
  if(!traceAvail()){content.innerHTML='';content.appendChild(view([pt('Flow','')," "]));return;}
  // arg is a flowId; we re-run investigate for its query context by asking broadly
  var v=view([]);
  v.appendChild(el('<div style="margin-bottom:10px"><span class="btn ghost sm" onclick="RINAV(\'investigate\')">\u2190 Investigate</span></div>'));
  var head=h('div');v.appendChild(head);
  var tabsEl=h('div',{class:'seg',style:'margin:14px 0'});v.appendChild(tabsEl);
  var body=h('div');v.appendChild(body);
  content.innerHTML='';content.appendChild(v);
  body.innerHTML='<div class="mini">loading flow...</div>';

  // fetch the flow by re-investigating (server discovers deterministically)
  var seedQuery=guessQuery(arg);
  api('/api/trace2/investigate',{id:bid(),query:seedQuery}).then(function(r){
    var flow=(r.flows||[]).find(function(f){return f.id===arg;});
    if(!flow){body.innerHTML='<div class="callout warn">Flow not found. <span class="c-link" onclick="RINAV(\'investigate\')">Investigate again</span>.</div>';return;}
    _flowCache[arg]=flow;
    head.innerHTML='<h1 class="pt">'+esc(flow.name)+'</h1><div class="pd">Entry <span class="mono">'+esc(flow.entry.class.split('.').pop())+'.'+esc(flow.entry.name)+'()</span> \u00b7 '+codeRef(flow.entry.file,flow.entry.line,baseName(flow.entry.file)+':'+flow.entry.line)+' \u00b7 confidence '+Math.round(flow.confidence*100)+'%</div>';
    wireCodeRefs(head);
    var tabs=['Overview','Flow','Calculations','Variables','API','Database','Code','Issues'];
    var active='Overview';
    tabs.forEach(function(t){var b=h('button',{class:(t===active?'active':''),text:t});b.addEventListener('click',function(){active=t;draw();Array.prototype.forEach.call(tabsEl.children,function(x){x.classList.toggle('active',x.textContent===t);});});tabsEl.appendChild(b);});
    function draw(){renderFlowTab(body,flow,active);}
    draw();
  }).catch(function(e){body.innerHTML='<div class="callout danger">'+esc(e.message)+'</div>';});
});
function guessQuery(flowId){
  // flowId = 'flow:method:com.acme.hrms.service.MonthlyPayrollService#...'
  var m=/service\.(\w+?)(Service|Controller|Processor|Calculator)?#/i.exec(flowId)||/\.(\w+)#/.exec(flowId);
  return m?m[1]:'flow';
}
function renderFlowTab(body,flow,tab){
  body.innerHTML='';
  var ev=flow.evidence||{};
  if(tab==='Overview'){
    var c=card('What this flow does',null);
    c.appendChild(el('<div class="kv"><div class="k">Entry point</div><div class="v">'+esc(flow.entry.class.split('.').pop())+'.'+esc(flow.entry.name)+'()</div>'+
      '<div class="k">Persists</div><div class="v">'+(ev.persists?'yes \u2014 writes to '+(ev.tables||[]).join(', '):'no (read/compute only)')+'</div>'+
      '<div class="k">Controllers</div><div class="v">'+esc((ev.controllers||[]).join(', ')||'\u2014')+'</div>'+
      '<div class="k">Services</div><div class="v">'+esc((ev.services||[]).join(', ')||'\u2014')+'</div>'+
      '<div class="k">Calculators</div><div class="v">'+esc((ev.calculators||[]).join(', ')||'\u2014')+'</div>'+
      '<div class="k">Repositories</div><div class="v">'+esc((ev.repositories||[]).join(', ')||'\u2014')+'</div>'+
      '<div class="k">DB columns</div><div class="v">'+esc((ev.columns||[]).join(', ')||'\u2014')+'</div></div>'));
    body.appendChild(c);
    aiTraceBlock(body,'flow',{flowId:flow.id,query:guessQuery(flow.id)},'Explain this flow');
  } else if(tab==='Flow'){
    var c=card('Call chain (verified)',null);
    var chain=h('div',{class:'trace-chain'});
    flow.members.slice(0,24).forEach(function(m,i){
      var st=m.stereotype?('<span class="badge b-tag" style="opacity:.7">'+m.stereotype+'</span>'):'';
      chain.appendChild(el('<div class="trace-node">'+(i>0?'<span class="trace-arrow">\u2193</span>':'')+'<div class="trace-node-body"><span class="mono">'+esc(m.class.split('.').pop())+'.'+esc(m.name)+'()</span> '+st+' '+codeRef(m.file,m.line,'src')+'</div></div>'));
    });
    c.appendChild(chain);body.appendChild(c);wireCodeRefs(body);
  } else if(tab==='Calculations'){
    if(!ev.formulas||!ev.formulas.length){body.appendChild(el('<div class="empty">No formulas extracted in this flow.</div>'));return;}
    var c=card('Formulas extracted from code',null);
    ev.formulas.forEach(function(f){
      c.appendChild(el('<div class="formula-row"><span class="mono formula-eq">'+esc(f.result)+' = '+esc(f.expr)+'</span>'+codeRef(f.file,f.line,baseName(f.file)+':'+f.line)+'</div>'));
    });
    body.appendChild(c);wireCodeRefs(body);
    // let the user explain a specific result
    var picks=[...new Set(ev.formulas.map(function(f){return f.result;}))];
    var pc=card('Explain a calculation',null);
    var row=h('div',{class:'tag-row'});
    picks.forEach(function(p){var b=h('span',{class:'chip',text:p});b.addEventListener('click',function(){explainVar(body,flow,p);});row.appendChild(b);});
    pc.appendChild(row);body.appendChild(pc);
  } else if(tab==='Variables'){
    var vars=[...new Set((ev.formulas||[]).map(function(f){return f.result;}))];
    if(!vars.length){body.appendChild(el('<div class="empty">No traceable variables in this flow.</div>'));return;}
    var c=card('Trace a variable',null);
    c.appendChild(el('<div class="mini" style="margin-bottom:8px">Pick a value to trace where it comes from (backward) or where it goes (forward).</div>'));
    vars.forEach(function(vn){
      var row=h('div',{class:'bar-row',style:'cursor:default'});
      row.innerHTML='<span class="mono">'+esc(vn)+'</span>';
      var b1=h('button',{class:'btn ghost sm',text:'\u2191 Origin',style:'margin-left:auto'});b1.addEventListener('click',function(){traceVarView(body,flow,vn,'backward');});
      var b2=h('button',{class:'btn ghost sm',text:'\u2193 Consumers',style:'margin-left:6px'});b2.addEventListener('click',function(){traceVarView(body,flow,vn,'forward');});
      row.appendChild(b1);row.appendChild(b2);
      c.appendChild(row);
    });
    body.appendChild(c);
  } else if(tab==='API'){
    var t=D().trace;var links=(t.crossLayer&&t.crossLayer.links)||[];
    if(!links.length){body.appendChild(el('<div class="empty">No API endpoints bound in this repository.</div>'));return;}
    var c=card('API contract (route \u2192 controller \u2192 DTO)',null);
    links.forEach(function(l){
      c.appendChild(el('<div class="bar-row" style="cursor:default"><span class="badge b-accent">'+esc(l.route.method)+'</span><span class="mono" style="margin-left:8px">'+esc(l.route.path)+'</span><span class="mini" style="margin-left:auto">req '+esc((l.requestDto||'\u2014').split('.').pop())+' \u2192 res '+esc((l.responseDto||'\u2014').split('.').pop())+'</span></div>'));
    });
    body.appendChild(c);
  } else if(tab==='Database'){
    if(!ev.columns||!ev.columns.length){body.appendChild(el('<div class="empty">No database columns touched by this flow.</div>'));return;}
    var c=card('Database lineage',null);
    c.appendChild(el('<div class="mini" style="margin-bottom:6px">Columns this flow reads or writes (verified via @Entity/@Column mapping):</div>'));
    var tr=h('div',{class:'tag-row'});
    ev.columns.forEach(function(col){tr.appendChild(el('<span class="chip b-amber" style="cursor:default">'+esc(col)+'</span>'));});
    c.appendChild(tr);body.appendChild(c);
  } else if(tab==='Code'){
    var c=card('Members (open source)',null);
    flow.members.forEach(function(m){
      c.appendChild(el('<div class="bar-row" style="cursor:default"><span class="mono" style="font-size:12px">'+esc(m.class.split('.').pop())+'.'+esc(m.name)+'()</span>'+codeRef(m.file,m.line,baseName(m.file)+':'+m.line)+'</div>'));
    });
    body.appendChild(c);wireCodeRefs(body);
  } else if(tab==='Issues'){
    var t=D().trace;var les=(t.looseEnds||[]);
    if(!les.length){body.appendChild(el('<div class="empty">No loose ends detected.</div>'));return;}
    var c=card('Potential loose ends <span class="mini">(not necessarily bugs)</span>',null);
    les.forEach(function(le){
      c.appendChild(el('<div class="bar-row" style="cursor:default"><span class="badge '+confBadge(le.confidence)+'">'+esc(le.kind)+'</span><span style="font-size:12.5px;margin-left:8px">'+esc(le.detail)+'</span>'+(le.file?codeRef(le.file,le.line,''):'')+'</div>'));
    });
    body.appendChild(c);wireCodeRefs(body);
  }
}

// resolve the method that actually defines a variable (from the flow formulas),
// falling back to the flow entry method.
function methodForVar(flow,variable){
  var f=(flow.evidence.formulas||[]).find(function(x){return x.result===variable;});
  return (f&&f.method)||flow.entry.method;
}

// ---- explain calculation (inline) ----
function explainVar(container,flow,variable){
  var panel=document.getElementById('explain-panel')||(function(){var d=h('div',{id:'explain-panel'});container.appendChild(d);return d;})();
  panel.innerHTML='<div class="mini">extracting calculation...</div>';
  var methodId=methodForVar(flow,variable);
  api('/api/trace2/explain',{id:bid(),method:methodId,variable:variable}).then(function(r){
    if(r.error){panel.innerHTML='<div class="callout danger">'+esc(r.error)+'</div>';return;}
    var html='<div class="card"><h2>How <span class="mono">'+esc(variable)+'</span> is calculated</h2>';
    if(r.inputs&&r.inputs.length)html+='<div class="mini" style="margin-bottom:8px">Inputs: '+r.inputs.map(function(i){return '<span class="chip" style="cursor:default">'+esc(i.name)+(i.type?':'+esc(i.type):'')+'</span>';}).join('')+'</div>';
    html+='<div class="formula-list">';
    r.formulas.forEach(function(f){html+='<div class="formula-row"><span class="mono formula-eq">'+esc(f.text)+'</span>'+codeRef(f.file,f.line,baseName(f.file)+':'+f.line)+(f.condition?'<span class="mini"> when '+esc(f.condition)+'</span>':'')+'</div>';});
    html+='</div>';
    if(r.origins&&r.origins.columns&&r.origins.columns.length)html+='<div class="mini" style="margin-top:8px">Origin columns: '+r.origins.columns.map(function(c){return '<span class="chip b-amber" style="cursor:default">'+esc(c)+'</span>';}).join('')+'</div>';
    if(r.conditions&&r.conditions.length)html+='<div class="mini" style="margin-top:6px">Conditions: '+r.conditions.map(function(c){return '<code>'+esc(c)+'</code>';}).join(' ; ')+'</div>';
    html+='</div>';
    panel.innerHTML=html;wireCodeRefs(panel);
    aiTraceBlock(panel,'calculation',{method:methodId,variable:variable},'Explain in plain language');
  });
}
function traceVarView(container,flow,variable,direction){
  var panel=document.getElementById('explain-panel')||(function(){var d=h('div',{id:'explain-panel'});container.appendChild(d);return d;})();
  panel.innerHTML='<div class="mini">tracing '+esc(variable)+' '+(direction==='forward'?'forward':'backward')+'...</div>';
  var methodId=methodForVar(flow,variable);
  api('/api/trace2/variable',{id:bid(),method:methodId,variable:variable,direction:direction}).then(function(r){
    if(r.error){panel.innerHTML='<div class="callout danger">'+esc(r.error)+'</div>';return;}
    var title=direction==='forward'?('Where <span class="mono">'+esc(variable)+'</span> goes'):('Where <span class="mono">'+esc(variable)+'</span> comes from');
    var html='<div class="card"><h2>'+title+'</h2>';
    var seen={};
    var steps=(r.steps||[]).filter(function(s){var k=s.from+s.type+s.to;if(seen[k])return false;seen[k]=1;return true;}).slice(0,26);
    html+='<div class="trace-chain">';
    steps.forEach(function(s){
      html+='<div class="trace-node"><span class="trace-arrow">'+(direction==='forward'?'\u2193':'\u2191')+'</span><div class="trace-node-body"><span class="mono">'+esc(s.from)+'</span> <span class="mini">'+esc(s.type)+'</span> <span class="mono">'+esc(s.to)+'</span> <span class="badge '+confBadge(s.confidence)+'">'+esc(s.confidence)+'</span> '+(s.file?codeRef(s.file,s.line,''):'')+'</div></div>';
    });
    html+='</div>';
    if(r.summary){
      if(r.summary.columns&&r.summary.columns.length)html+='<div class="mini" style="margin-top:8px">Origin columns: '+r.summary.columns.map(function(c){return '<span class="chip b-amber" style="cursor:default">'+esc(c)+'</span>';}).join('')+'</div>';
      if(r.summary.persisted&&r.summary.persisted.length)html+='<div class="mini" style="margin-top:8px">Persisted to: '+r.summary.persisted.map(function(c){return '<span class="chip b-amber" style="cursor:default">'+esc(c)+'</span>';}).join('')+'</div>';
      if(r.summary.responseFields&&r.summary.responseFields.length)html+='<div class="mini" style="margin-top:6px">Response fields: '+[...new Set(r.summary.responseFields)].map(function(c){return '<span class="chip b-accent" style="cursor:default">'+esc(c)+'</span>';}).join('')+'</div>';
    }
    html+='</div>';
    panel.innerHTML=html;wireCodeRefs(panel);
    aiTraceBlock(panel,'variable',{method:methodId,variable:variable,direction:direction},'Explain in plain language');
  });
}

// ---- optional AI narration of verified evidence ----
function aiTraceBlock(container,kind,extra,label){
  if(!AI().aiReady())return;
  var wrap=card('\u2727 '+label+' <span class="mini">(AI, grounded in the evidence above)</span>',null);
  var btn=h('button',{class:'btn ghost sm',text:'Generate'});
  var o=h('div',{style:'margin-top:8px'});
  btn.addEventListener('click',function(){btn.disabled=true;o.innerHTML='<div class="mini">generating...</div>';var acc='';
    AI().streamGenerate('/api/ai/trace',Object.assign({id:bid(),kind:kind,config:AI().getCfg()},extra),
      function(t){acc+=t;o.innerHTML=AI().renderMd(acc);},
      function(name,data){btn.disabled=false;if(name==='error')o.innerHTML='<div class="callout danger">'+esc(data.message)+'</div>';});});
  wrap.appendChild(btn);wrap.appendChild(o);container.appendChild(wrap);
}
})();
