/**
 * plugins.js — plugin system + SDK (ADDITIVE, Phase 4).
 *
 * A minimal, documented plugin contract lets analyzers contribute extra graph
 * nodes/edges, metadata, layers, and insights WITHOUT touching core code. Plugins
 * are pure functions over the analysis index; the Brain runs them and merges
 * their contributions. This makes the platform extensible (Terraform / K8s /
 * Docker / Cloud / Security analyzers, etc.).
 *
 * SDK (what a plugin receives + may return):
 *   plugin = {
 *     id, label, description,
 *     appliesTo(index) -> boolean,          // cheap guard
 *     contribute(index, sdk) -> {
 *        nodes:[{id,type,label,...meta}],   // extra graph nodes
 *        edges:[{source,target,type,...}],  // extra edges
 *        layers:{ <name>:{nodes:[],edges:[]} },
 *        insights:[{ id, label, items:[] }],
 *        tags:{ <nodeId>:[...tags] }
 *     }
 *   }
 * The sdk gives read helpers (files/routes/tables/find) so plugins never re-walk.
 */

function makeSdk(index){
  return {
    files: index.files,
    routes: index.routes,
    tables: index.tables,
    dependencies: index.dependencies,
    infra: index.infra,
    findFiles: (re)=> index.files.filter((f)=>re.test(f.path)),
    fileNode: (p)=> 'file:'+p,
  };
}

// ---- built-in plugins ----

// Infrastructure plugin: surfaces Docker / CI / IaC / deploy config as graph
// nodes + an infrastructure layer + an insight. All from index.infra (factual).
const infraPlugin = {
  id:'infra', label:'Infrastructure', description:'Docker, CI/CD, IaC and deploy configuration as graph nodes.',
  appliesTo:(index)=> (index.infra||[]).length>0,
  contribute:(index, sdk)=>{
    const nodes=[], edges=[], tags={};
    const bySystem={};
    for(const inf of index.infra){
      const id='infra:'+inf.system+':'+inf.file;
      nodes.push({ id, type:'infra', label:inf.file.split('/').pop(), system:inf.system, kind:inf.type, path:inf.file, layers:['infrastructure'] });
      (bySystem[inf.system]=bySystem[inf.system]||[]).push(inf.file);
      // link infra file to the repo file node if present
      if(index.files.find((f)=>f.path===inf.file)) edges.push({ source:'file:'+inf.file, target:id, type:'configures' });
    }
    const insights=[{ id:'infra-systems', label:'Infrastructure systems', items:Object.keys(bySystem).map((s)=>({ label:s, count:bySystem[s].length, files:bySystem[s].slice(0,10) })) }];
    return { nodes, edges, layers:{ infrastructure:{ nodes:nodes.map((n)=>n.id), edges:[] } }, insights, tags };
  },
};

// Security plugin: promotes security findings into graph tags + an insight.
const securityPlugin = {
  id:'security', label:'Security', description:'Security findings as node tags + a risk insight.',
  appliesTo:(index)=> (index.security||[]).length>0,
  contribute:(index)=>{
    const tags={}; const bySev={high:[],medium:[],low:[]};
    for(const s of index.security){ const nid='file:'+s.file; (tags[nid]=tags[nid]||[]).push('security:'+s.type); (bySev[s.severity]||bySev.low).push(s); }
    const insights=[{ id:'security-findings', label:'Security findings by severity', items:[{label:'high',count:bySev.high.length},{label:'medium',count:bySev.medium.length},{label:'low',count:bySev.low.length}] }];
    return { nodes:[], edges:[], layers:{}, insights, tags };
  },
};

// Dependency plugin: external dependency nodes as an ecosystem cluster + insight.
const depsPlugin = {
  id:'deps', label:'External dependencies', description:'Runtime dependency ecosystems as an insight.',
  appliesTo:(index)=> (index.dependencies||[]).length>0,
  contribute:(index)=>{
    const byEco={}; for(const d of index.dependencies){ (byEco[d.ecosystem]=byEco[d.ecosystem]||[]).push(d.name); }
    const insights=[{ id:'dep-ecosystems', label:'Dependency ecosystems', items:Object.keys(byEco).map((e)=>({ label:e, count:byEco[e].length })) }];
    return { nodes:[], edges:[], layers:{}, insights, tags:{} };
  },
};

const REGISTRY = [infraPlugin, securityPlugin, depsPlugin];

export function registerPlugin(plugin){ if(plugin && plugin.id && typeof plugin.contribute==='function') REGISTRY.push(plugin); }
export function listPlugins(){ return REGISTRY.map((p)=>({ id:p.id, label:p.label, description:p.description })); }

// Run all applicable plugins, merge contributions.
export function runPlugins(index){
  const sdk = makeSdk(index);
  const merged = { nodes:[], edges:[], layers:{}, insights:[], tags:{}, ran:[] };
  for(const p of REGISTRY){
    try {
      if(p.appliesTo && !p.appliesTo(index)) continue;
      const c = p.contribute(index, sdk) || {};
      merged.ran.push({ id:p.id, label:p.label });
      (c.nodes||[]).forEach((n)=>merged.nodes.push(n));
      (c.edges||[]).forEach((e)=>merged.edges.push(e));
      (c.insights||[]).forEach((i)=>merged.insights.push({ plugin:p.id, ...i }));
      for(const L in (c.layers||{})){ merged.layers[L]=merged.layers[L]||{nodes:[],edges:[]}; (c.layers[L].nodes||[]).forEach((x)=>merged.layers[L].nodes.push(x)); }
      for(const nid in (c.tags||{})){ merged.tags[nid]=(merged.tags[nid]||[]).concat(c.tags[nid]); }
    } catch(e){ merged.ran.push({ id:p.id, error:e.message }); }
  }
  return merged;
}
