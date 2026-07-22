/* sgraph.js — Phase 3 interactive SEMANTIC graph renderer (self-contained SVG).
 * SEPARATE from graph.js (which is untouched). Supports progressive expand/
 * collapse (Google-Maps style), force layout, zoom/pan/drag, hover explanations,
 * click callbacks, heatmap overlay, layer/subset filtering, and search highlight.
 *
 * Data model: it renders a "visible set" of semantic node ids from
 * index.semanticGraph. The page controls which ids are visible; this module lays
 * them out and draws aggregated edges between visible ancestors. */
(function(){
'use strict';
function svgEl(tag,attrs){var e=document.createElementNS('http://www.w3.org/2000/svg',tag);if(attrs)for(var k in attrs)e.setAttribute(k,attrs[k]);return e;}
function seeded(seed){var s=seed%2147483647;if(s<=0)s+=2147483646;return function(){s=(s*16807)%2147483647;return (s-1)/2147483646;};}

function SemanticGraph(container,cfg){
  cfg=cfg||{};
  var W=container.clientWidth||1000, H=container.clientHeight||680;
  var svg=svgEl('svg',{width:'100%',height:'100%',viewBox:'0 0 '+W+' '+H});
  svg.style.display='block';svg.style.cursor='grab';
  container.innerHTML='';container.appendChild(svg);
  var defs=svgEl('defs');
  var mk=svgEl('marker',{id:'sgarrow',viewBox:'0 0 10 10',refX:'16',refY:'5',markerWidth:'6',markerHeight:'6',orient:'auto-start-reverse'});
  mk.appendChild(svgEl('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#6b7a90'}));defs.appendChild(mk);svg.appendChild(defs);
  var root=svgEl('g');svg.appendChild(root);
  var edgeLayer=svgEl('g');var nodeLayer=svgEl('g');root.appendChild(edgeLayer);root.appendChild(nodeLayer);
  var tf={x:0,y:0,s:1};
  function applyTf(){root.setAttribute('transform','translate('+tf.x+','+tf.y+') scale('+tf.s+')');}
  var panning=false,ps=null;
  svg.addEventListener('mousedown',function(e){if(e.target.closest('.sgnode'))return;panning=true;ps={x:e.clientX-tf.x,y:e.clientY-tf.y};svg.style.cursor='grabbing';});
  window.addEventListener('mousemove',function(e){if(panning){tf.x=e.clientX-ps.x;tf.y=e.clientY-ps.y;applyTf();}});
  window.addEventListener('mouseup',function(){panning=false;svg.style.cursor='grab';});
  svg.addEventListener('wheel',function(e){e.preventDefault();var r=svg.getBoundingClientRect();var mx=e.clientX-r.left,my=e.clientY-r.top;var dl=e.deltaY<0?1.15:1/1.15;var ns=Math.max(0.08,Math.min(6,tf.s*dl));tf.x=mx-((mx-tf.x)*ns)/tf.s;tf.y=my-((my-tf.y)*ns)/tf.s;tf.s=ns;applyTf();},{passive:false});

  var state={nodes:[],links:[],byId:{}};
  var heat=null;      // heatmap key or null
  var searchSet=null; // Set of highlighted ids or null

  function simulate(nodes,links){
    var rand=seeded(99);var byId={};
    nodes.forEach(function(n){if(n.x==null){n.x=W/2+(rand()-0.5)*W*0.7;n.y=H/2+(rand()-0.5)*H*0.7;}n.vx=0;n.vy=0;byId[n.id]=n;});
    var edges=links.map(function(l){return{s:byId[l.source],t:byId[l.target],w:l.weight||1};}).filter(function(e){return e.s&&e.t;});
    var k=Math.sqrt((W*H)/Math.max(nodes.length,1))*0.9;var iters=nodes.length>60?230:300;
    for(var it=0;it<iters;it++){
      var temp=0.1*(1-it/iters)+0.005;
      for(var i=0;i<nodes.length;i++){var a=nodes[i];var fx=0,fy=0;for(var j=0;j<nodes.length;j++){if(i===j)continue;var b=nodes[j];var dx=a.x-b.x,dy=a.y-b.y;var d2=dx*dx+dy*dy;if(d2<0.01){dx=rand()-0.5;dy=rand()-0.5;d2=0.01;}var d=Math.sqrt(d2);var rep=(k*k)/d;fx+=(dx/d)*rep;fy+=(dy/d)*rep;}a.vx=(a.vx+fx)*0.9;a.vy=(a.vy+fy)*0.9;}
      for(var e2=0;e2<edges.length;e2++){var ed=edges[e2];var dx2=ed.s.x-ed.t.x,dy2=ed.s.y-ed.t.y;var dd=Math.sqrt(dx2*dx2+dy2*dy2)||0.01;var att=(dd*dd)/k*Math.min(ed.w,4)*0.4;var ax=(dx2/dd)*att,ay=(dy2/dd)*att;ed.s.vx-=ax;ed.s.vy-=ay;ed.t.vx+=ax;ed.t.vy+=ay;}
      for(var q=0;q<nodes.length;q++){var n=nodes[q];if(n.fixed)continue;var sp=Math.sqrt(n.vx*n.vx+n.vy*n.vy)||0.01;var lim=Math.min(sp,temp*1000)/sp;n.x+=n.vx*lim;n.y+=n.vy*lim;n.x=Math.max(40,Math.min(W-40,n.x));n.y=Math.max(40,Math.min(H-40,n.y));}
    }
    return byId;
  }

  function render(data){
    // data: { nodes:[{id,label,kind,color,r,expandable,expanded,layers,heat}], links:[{source,target,verb,explanation,weight}] }
    edgeLayer.innerHTML='';nodeLayer.innerHTML='';
    var nodes=data.nodes.map(function(n){return Object.assign({},n);});
    var links=data.links;
    var byId=simulate(nodes,links);
    state={nodes:nodes,links:links,byId:byId};
    var edgeEls=[];
    links.forEach(function(l){
      var s=byId[l.source],t=byId[l.target];if(!s||!t)return;
      var g=svgEl('g',{class:'sgedge'});
      var line=svgEl('line',{x1:s.x,y1:s.y,x2:t.x,y2:t.y,stroke:'#3a4d6b90','stroke-width':Math.min(1+Math.log2((l.weight||1)+1)*0.5,4),'marker-end':'url(#sgarrow)'});
      line.dataset.s=l.source;line.dataset.t=l.target;
      g.appendChild(line);
      // verb label at midpoint
      if(l.verb){var mxp=(s.x+t.x)/2,myp=(s.y+t.y)/2;var tl=svgEl('text',{x:mxp,y:myp-2,'text-anchor':'middle',fill:'#7f93b5','font-size':9,'font-family':'ui-monospace,monospace'});tl.textContent=l.verb;g.appendChild(tl);}
      g.addEventListener('mouseenter',function(){if(cfg.onEdgeHover)cfg.onEdgeHover(l,{x:(s.x*tf.s+tf.x),y:(s.y*tf.s+tf.y)});line.setAttribute('stroke','#5b9dff');});
      g.addEventListener('mouseleave',function(){if(cfg.onEdgeHover)cfg.onEdgeHover(null);line.setAttribute('stroke','#3a4d6b90');});
      g.addEventListener('click',function(ev){ev.stopPropagation();if(cfg.onEdgeClick)cfg.onEdgeClick(l);});
      edgeLayer.appendChild(g);edgeEls.push(line);
    });
    var nodeEls={};
    nodes.forEach(function(n){
      var g=svgEl('g',{class:'sgnode',transform:'translate('+n.x+','+n.y+')'});g.style.cursor='pointer';
      var r=n.r||nodeRadius(n);
      var fill=n.color||kindColor(n.kind);
      if(heat&&n.heat!=null){fill=heatColor(n.heat);}
      var circ=svgEl('circle',{r:r,fill:fill,stroke:'#0b1220','stroke-width':1.6});
      if(n.expandable&&!n.expanded){circ.setAttribute('stroke','#5b9dff');circ.setAttribute('stroke-width','2.4');circ.setAttribute('stroke-dasharray','3 2');}
      g.appendChild(circ);
      // expand indicator
      if(n.expandable){var pm=svgEl('text',{x:0,y:r-3,'text-anchor':'middle',fill:'#cfe0f5','font-size':Math.min(r,11),'font-weight':700});pm.textContent=n.expanded?'\u2212':'+';g.appendChild(pm);}
      var label=svgEl('text',{x:0,y:r+13,'text-anchor':'middle',fill:'#cbd6e8','font-size':Math.max(9,Math.min(12,r*0.9)),'font-family':'ui-monospace,monospace'});
      label.textContent=n.label;g.appendChild(label);
      if(n.count!=null&&n.kind!=='function'){var sub=svgEl('text',{x:0,y:r+24,'text-anchor':'middle',fill:'#5c7095','font-size':9,'font-family':'ui-monospace,monospace'});sub.textContent=n.count;g.appendChild(sub);}
      nodeLayer.appendChild(g);nodeEls[n.id]={g:g,circ:circ,node:n};
      var dragging=false,moved=false,st=null;
      g.addEventListener('mousedown',function(e){e.stopPropagation();dragging=true;moved=false;st={x:e.clientX,y:e.clientY,nx:n.x,ny:n.y};});
      window.addEventListener('mousemove',function(e){if(!dragging)return;moved=true;n.x=st.nx+(e.clientX-st.x)/tf.s;n.y=st.ny+(e.clientY-st.y)/tf.s;g.setAttribute('transform','translate('+n.x+','+n.y+')');edgeEls.forEach(function(line){if(line.dataset.s===n.id){line.setAttribute('x1',n.x);line.setAttribute('y1',n.y);}if(line.dataset.t===n.id){line.setAttribute('x2',n.x);line.setAttribute('y2',n.y);}});});
      window.addEventListener('mouseup',function(){if(dragging&&!moved){if(cfg.onNodeClick)cfg.onNodeClick(n);}dragging=false;});
      g.addEventListener('mouseenter',function(){highlight(n.id);if(cfg.onNodeHover)cfg.onNodeHover(n);});
      g.addEventListener('mouseleave',function(){highlight(null);if(cfg.onNodeHover)cfg.onNodeHover(null);});
    });
    function highlight(id){
      var nb=new Set();if(id){nb.add(id);links.forEach(function(l){if(l.source===id)nb.add(l.target);if(l.target===id)nb.add(l.source);});}
      for(var nid in nodeEls){var dim=(id&&!nb.has(nid))||(searchSet&&!searchSet.has(nid));nodeEls[nid].g.style.opacity=dim?0.14:1;}
      edgeEls.forEach(function(line){if(!id){line.style.opacity=searchSet?0.25:1;return;}var on=line.dataset.s===id||line.dataset.t===id;line.style.opacity=on?1:0.06;});
    }
    // apply search highlight persistently
    if(searchSet){for(var nid in nodeEls){nodeEls[nid].g.style.opacity=searchSet.has(nid)?1:0.14;}}
    fit();
    api._nodeEls=nodeEls;api._edgeEls=edgeEls;
  }

  function fit(){
    if(!state.nodes.length)return;
    var minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
    state.nodes.forEach(function(n){minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x);maxY=Math.max(maxY,n.y);});
    var pad=80;var bw=maxX-minX+pad*2,bh=maxY-minY+pad*2;var s=Math.min(W/bw,H/bh,2);tf.s=s;tf.x=(W-(minX+maxX)*s)/2;tf.y=(H-(minY+maxY)*s)/2;applyTf();
  }

  var api={
    render:render,fit:fit,
    zoomIn:function(){tf.s=Math.min(6,tf.s*1.25);applyTf();},
    zoomOut:function(){tf.s=Math.max(0.08,tf.s*0.8);applyTf();},
    setHeat:function(k){heat=k;},
    setSearch:function(set){searchSet=set;},
  };
  return api;
}

function nodeRadius(n){
  if(n.kind==='repo')return 26;
  if(n.kind==='domain')return 16+Math.min(Math.sqrt(n.files||1)*2,14);
  if(n.kind==='module')return 11+Math.min(Math.sqrt(n.files||1)*2,10);
  if(n.kind==='file')return 7+Math.min((n.functions||0)*0.25,7);
  if(n.kind==='table')return 9;
  if(n.kind==='class')return 7;
  return 5;
}
function kindColor(k){return{repo:'#e2e8f0',domain:'#5b9dff',module:'#36d0c4',file:'#8ea3c0',class:'#a98bff',function:'#3dd69a',table:'#f5b13d'}[k]||'#64748b';}
function heatColor(v){ // 0..1 -> green->amber->red
  v=Math.max(0,Math.min(1,v));
  var r,g,b;
  if(v<0.5){var t=v/0.5;r=Math.round(61+(245-61)*t);g=Math.round(214+(177-214)*t);b=Math.round(154+(61-154)*t);}
  else{var t2=(v-0.5)/0.5;r=Math.round(245+(247-245)*t2);g=Math.round(177+(109-177)*t2);b=Math.round(61+(109-61)*t2);}
  return 'rgb('+r+','+g+','+b+')';
}

window.SemanticGraph=SemanticGraph;
window.SemanticGraph.kindColor=kindColor;
window.SemanticGraph.heatColor=heatColor;
})();
