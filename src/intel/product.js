/**
 * product.js — Phase 5 product-level intelligence (ADDITIVE, mechanical).
 *
 * Derives, purely from static analysis + discovered capabilities:
 *   productOverview  what the app does, who uses it, core features, problem solved
 *   capabilityMap    capability -> sub-capabilities -> implementation -> files/apis/tables/tests/docs
 *   journeys         inferred user journeys (ordered capability steps) w/ evidence
 *   stories          per-system story: purpose/inputs/outputs/deps/consumers/risks/value
 *   scorecard        product-level maturity scores + recommendations
 *
 * Everything carries confidence and links back to evidence. Where evidence is
 * missing we say so instead of guessing.
 */
import { confidenceLabel } from './taxonomy.js';

function lc(s){ return String(s||'').toLowerCase(); }
function isTestPath(p){ return /(^|\/)(tests?|specs?|__tests__|e2e|fixtures?|mocks?)(\/|$)|\.(test|spec)\.|_test\.|test_/.test(lc(p)); }
function isDocPath(p){ return /\.(md|mdx|rst|txt|adoc)$/i.test(p) || /(^|\/)(docs?|documentation)(\/|$)/i.test(lc(p)); }

// ---------------- Product Overview ----------------
export function buildProductOverview(index, capResult, systemMap){
  const biz = capResult.business.filter((c)=>c.confidence>=0.5);
  const bizLikely = capResult.business.filter((c)=>c.confidence>=0.28 && c.confidence<0.5);
  const integrations = capResult.integration.filter((c)=>c.confidence>=0.5);
  const infra = capResult.infrastructure.filter((c)=>c.confidence>=0.4);

  // audience: union of users across confident business capabilities
  const users = [...new Set(biz.flatMap((c)=>c.users))];

  // "what does it do": a grounded sentence built from the top business systems
  const topLabels = biz.slice(0,6).map((c)=>c.label);
  const langs = index.languages.slice(0,3).map((l)=>l.label);
  const frameworks = [...new Set((index.routes||[]).map((r)=>r.framework))].filter(Boolean);

  // overall product-type inference (grounded, hedged)
  let productType='software application', typeConf=0.4;
  const hasRoutes = index.manifest.counts.routes>0;
  const hasTables = index.manifest.counts.tables>0;
  const hasUI = index.files.some((f)=>/\.(vue|jsx|tsx|svelte)$/.test(f.path) || /(^|\/)(components?|pages?|views?)(\/|$)/.test(lc(f.path)));
  if(hasRoutes && hasTables && hasUI){ productType='full-stack web application'; typeConf=0.7; }
  else if(hasRoutes && hasTables){ productType='backend web service with a database'; typeConf=0.68; }
  else if(hasRoutes){ productType='web service / API'; typeConf=0.6; }
  else if(hasUI){ productType='front-end application'; typeConf=0.55; }
  else if(biz.length===0 && capResult.technical.some((c)=>c.id==='api-layer')){ productType='library or framework'; typeConf=0.5; }

  // problem solved: phrase from the dominant business capability
  const primary = biz[0];
  const problem = primary
    ? `Helps ${(primary.users[0]||'users')} with ${primary.label.toLowerCase()}${biz[1]?` and ${biz[1].label.toLowerCase()}`:''}.`
    : 'Unable to determine a specific business problem from repository analysis (no strong product capabilities detected; this looks like technical/library code).';

  const confidence = biz.length ? Math.min(0.9, 0.4 + biz.length*0.08) : 0.3;

  return {
    productType, productTypeConfidence: Math.round(typeConf*100)/100,
    summary: biz.length
      ? `A ${productType} that provides ${listPhrase(topLabels)}.`
      : `A ${productType}. No distinct product features were detected with confidence; treat this as ${productType} code.`,
    problemSolved: problem,
    users: users.length?users:['Unable to determine from repository analysis'],
    coreFeatures: biz.map((c)=>({ id:c.id, label:c.label, confidence:c.confidence, confidenceLabel:c.confidenceLabel, why:c.why })),
    possibleFeatures: bizLikely.map((c)=>({ id:c.id, label:c.label, confidence:c.confidence })),
    integrations: integrations.map((c)=>({ id:c.id, label:c.label, confidence:c.confidence, deps:c.evidence.deps })),
    infrastructure: infra.map((c)=>({ id:c.id, label:c.label, confidence:c.confidence })),
    stack: { languages:langs, frameworks },
    workflows: (systemMap.spine||[]).slice(0,8),
    confidence: Math.round(confidence*100)/100,
    confidenceLabel: confidenceLabel(confidence),
  };
}

function listPhrase(arr){
  if(!arr.length) return 'several capabilities';
  if(arr.length===1) return arr[0];
  if(arr.length===2) return arr[0]+' and '+arr[1];
  return arr.slice(0,-1).join(', ')+', and '+arr[arr.length-1];
}

// ---------------- Capability Map ----------------
// capability -> sub-capabilities (grouped by sub-directory of impl files) ->
// implementation files, plus linked apis/tables/tests/docs.
export function buildCapabilityMap(index, capResult){
  const fileByPath = new Map(index.files.map((f)=>[f.path,f]));
  const routesByFile = new Map();
  for(const r of (index.routes||[])){ (routesByFile.get(r.file)||routesByFile.set(r.file,[]).get(r.file)).push(r); }
  // doc files near a directory
  const docFiles = index.files.filter((f)=>isDocPath(f.path)).map((f)=>f.path);

  const capabilities = capResult.capabilities.filter((c)=>c.confidence>=0.28).map((cap)=>{
    const implFiles = cap.evidence.files.filter((p)=>!isTestPath(p));
    const testFiles = cap.evidence.files.filter(isTestPath);
    // group impl files into sub-capabilities by their most meaningful path segment
    const groups=new Map();
    for(const p of implFiles){
      const segs=p.split('/');
      const seg = segs.length>1 ? segs[segs.length-2] : segs[0];
      if(!groups.has(seg)) groups.set(seg,[]);
      groups.get(seg).push(p);
    }
    const subs=[...groups.entries()].map(([seg,files])=>({
      label:titleCase(seg.replace(/[-_]/g,' ')),
      dir:seg, files:files.slice(0,30), fileCount:files.length,
      loc:files.reduce((s,p)=>s+((fileByPath.get(p)||{}).loc||0),0),
    })).sort((a,b)=>b.fileCount-a.fileCount).slice(0,8);

    // linked apis / tables / tests / docs
    const apis=[]; for(const p of implFiles){ for(const r of (routesByFile.get(p)||[])) apis.push(r.method+' '+r.path); }
    const relatedDocs = docFiles.filter((d)=>{
      const base=lc(d);
      return cap.id.split('-').some((tok)=>base.includes(tok)) || base.includes(lc(cap.label.split(' ')[0]));
    });

    return {
      id:cap.id, label:cap.label, kind:cap.kind, why:cap.why,
      confidence:cap.confidence, confidenceLabel:cap.confidenceLabel,
      fileCount:implFiles.length, loc:cap.loc,
      subCapabilities:subs,
      apis:[...new Set(apis)].slice(0,24),
      tables:cap.evidence.tables,
      tests:testFiles.slice(0,20), testCount:testFiles.length,
      docs:relatedDocs.slice(0,8),
      deps:cap.evidence.deps,
    };
  });
  return { capabilities, stats:{ total:capabilities.length } };
}

// ---------------- User Journeys ----------------
// A journey is an ordered sequence of capabilities a user moves through. We infer
// them from known journey templates, keeping only steps whose capability EXISTS
// (with evidence) in this repo; each step links to its capability evidence.
const JOURNEY_TEMPLATES = [
  { id:'onboarding', label:'New User Onboarding', persona:'end user',
    steps:['auth','user-mgmt','profile','notifications'] },
  { id:'candidate', label:'Candidate / Applicant Flow', persona:'candidate',
    steps:['auth','user-mgmt','resume','matching','notifications'] },
  { id:'hr-cycle', label:'HR Operations Cycle', persona:'HR staff',
    steps:['auth','employee','attendance','leave','payroll','analytics'] },
  { id:'commerce', label:'Purchase Flow', persona:'customer',
    steps:['auth','search','inventory','payments','notifications'] },
  { id:'content', label:'Content Publishing', persona:'editor',
    steps:['auth','content','search','notifications'] },
  { id:'learning', label:'Learning Path', persona:'learner',
    steps:['auth','learning','analytics','notifications'] },
  { id:'support', label:'Messaging / Support', persona:'end user',
    steps:['auth','messaging','notifications'] },
  { id:'admin', label:'Administration', persona:'administrator',
    steps:['auth','admin','analytics'] },
];

export function buildJourneys(index, capResult){
  const have = new Map(capResult.capabilities.filter((c)=>c.confidence>=0.28).map((c)=>[c.id,c]));
  // route lookup so a step can point to a concrete entrypoint
  const journeys=[];
  for(const tpl of JOURNEY_TEMPLATES){
    const steps=[];
    for(const capId of tpl.steps){
      const cap = have.get(capId);
      if(!cap) continue; // only include steps that actually exist here
      steps.push({
        id:capId, label:cap.label, confidence:cap.confidence,
        entry: cap.evidence.routes[0] || (cap.evidence.files[0]||null),
        files:cap.evidence.files.slice(0,4),
      });
    }
    // a journey is meaningful only if it has >=2 real steps and starts somewhere sensible
    if(steps.length>=2){
      const conf = steps.reduce((s,x)=>s+x.confidence,0)/steps.length;
      journeys.push({ id:tpl.id, label:tpl.label, persona:tpl.persona, steps,
        coverage:Math.round(steps.length/tpl.steps.length*100),
        confidence:Math.round(conf*100)/100, confidenceLabel:confidenceLabel(conf) });
    }
  }
  journeys.sort((a,b)=> (b.steps.length-a.steps.length) || (b.confidence-a.confidence));
  return { journeys, stats:{ total:journeys.length } };
}

// ---------------- System Stories ----------------
// Per major system: purpose, inputs, outputs, dependencies, consumers, risks, value.
export function buildStories(index, capResult, systemMap){
  const capById = new Map(capResult.capabilities.map((c)=>[c.id,c]));
  const edges = systemMap.edges;
  const risk = (index.semantic && index.semantic.riskAreas) || [];
  const riskByFile = new Map(risk.map((r)=>[r.path,r]));

  const stories = capResult.capabilities.filter((c)=>c.confidence>=0.4 && (c.kind==='business'||c.kind==='integration'||c.kind==='infrastructure')).map((cap)=>{
    const outgoing = edges.filter((e)=>e.source===cap.id);
    const incoming = edges.filter((e)=>e.target===cap.id);
    // inputs: tables read + routes exposed + upstream systems
    const inputs=[];
    if(cap.evidence.routes.length) inputs.push(`${cap.evidence.routes.length} HTTP endpoint(s)`);
    if(cap.evidence.deps.length) inputs.push(`external libs: ${cap.evidence.deps.slice(0,3).join(', ')}`);
    outgoing.filter((e)=>e.rels.includes('reads')).forEach((e)=>inputs.push(`data from ${capById.get(e.target)?capById.get(e.target).label:e.target}`));
    // outputs: tables written + systems that depend on it
    const outputs=[];
    if(cap.evidence.tables.length) outputs.push(`persists: ${cap.evidence.tables.slice(0,5).join(', ')}`);
    // risks: risky files owned by this capability
    const capRisks = cap.evidence.files.map((p)=>riskByFile.get(p)).filter(Boolean)
      .sort((a,b)=>b.risk-a.risk).slice(0,3).map((r)=>({ path:r.path, reasons:r.reasons }));

    return {
      id:cap.id, label:cap.label, kind:cap.kind, confidence:cap.confidence, confidenceLabel:cap.confidenceLabel,
      purpose:cap.why,
      responsibilities: cap.evidence.symbols.slice(0,8),
      inputs: inputs.length?inputs:['Unable to determine from repository analysis'],
      outputs: outputs.length?outputs:['Unable to determine from repository analysis'],
      dependencies: outgoing.slice(0,6).map((e)=>({ id:e.target, label:capById.get(e.target)?capById.get(e.target).label:e.target, why:e.why })),
      consumers: incoming.slice(0,6).map((e)=>({ id:e.source, label:capById.get(e.source)?capById.get(e.source).label:e.source, why:e.why })),
      businessValue: businessValue(cap),
      risks: capRisks,
      files: cap.evidence.files.slice(0,10),
    };
  });
  return { stories, stats:{ total:stories.length } };
}
function businessValue(cap){
  if(cap.kind==='business') return `Directly delivers "${cap.label}" to ${cap.users[0]||'users'}.`;
  if(cap.kind==='integration') return `Connects the product to an external ${cap.label.toLowerCase()} system.`;
  if(cap.kind==='infrastructure') return `Operational backbone enabling ${cap.label.toLowerCase()}.`;
  return `Supports the product through ${cap.label.toLowerCase()}.`;
}

// ---------------- Product Scorecard ----------------
export function buildScorecard(index, capResult, systemMap){
  const sem = index.semantic;
  const health = sem ? sem.health : null;
  const biz = capResult.business.filter((c)=>c.confidence>=0.5);

  // domain separation: how cleanly capabilities own distinct files (low overlap = good)
  const fileOwners = new Map();
  for(const c of capResult.capabilities){ for(const p of c.evidence.files){ fileOwners.set(p,(fileOwners.get(p)||0)+1); } }
  const shared = [...fileOwners.values()].filter((n)=>n>1).length;
  const domainSeparation = clampScore(1 - shared/Math.max(fileOwners.size,1));

  // business modularity: business systems that are cohesive (>=3 files) & distinct
  const cohesive = biz.filter((c)=>c.evidence.fileCount>=3).length;
  const businessModularity = clampScore(biz.length ? cohesive/Math.max(biz.length,1) : 0.3);

  // feature coupling: average cross-system links per business system (lower better)
  const bizIds=new Set(biz.map((c)=>c.id));
  const crossLinks=systemMap.edges.filter((e)=>bizIds.has(e.source)&&bizIds.has(e.target)).length;
  const featureCoupling = clampScore(1 - crossLinks/Math.max(biz.length*2,4));

  // ai readiness: presence of structured boundaries + docs + tests
  const aiReadiness = clampScore(((health?health.scores.find((s)=>s.key==='documentation').value/100:0.3)*0.4)
    + (domainSeparation*0.3) + ((health?health.scores.find((s)=>s.key==='testing').value/100:0.2)*0.3));

  const onboarding = clampScore(1 - (
    (index.manifest.counts.files>400?0.3:0) +
    (crossLinks>biz.length*2?0.2:0) +
    ((health?100-health.scores.find((s)=>s.key==='documentation').value:60)/100*0.3)
  ));

  const scores=[
    { key:'architectureMaturity', label:'Architecture maturity', value: health?health.scores.find((s)=>s.key==='architecture').value:50 },
    { key:'businessModularity', label:'Business modularity', value: Math.round(businessModularity*100) },
    { key:'technicalModularity', label:'Technical modularity', value: health?health.scores.find((s)=>s.key==='coupling').value:50 },
    { key:'domainSeparation', label:'Domain separation', value: Math.round(domainSeparation*100) },
    { key:'featureCoupling', label:'Feature decoupling', value: Math.round(featureCoupling*100) },
    { key:'aiReadiness', label:'AI readiness', value: Math.round(aiReadiness*100) },
    { key:'documentation', label:'Documentation quality', value: health?health.scores.find((s)=>s.key==='documentation').value:50 },
    { key:'maintainability', label:'Maintainability', value: health?health.scores.find((s)=>s.key==='maintainability').value:50 },
    { key:'onboarding', label:'Onboarding ease', value: Math.round(onboarding*100) },
  ];
  const overall = Math.round(scores.reduce((s,x)=>s+x.value,0)/scores.length);

  // recommendations from the weakest scores
  const recs=[];
  const weak = scores.slice().sort((a,b)=>a.value-b.value).slice(0,3);
  for(const w of weak){ recs.push(recommend(w, { biz, crossLinks, index, capResult })); }

  return { overall, scores, recommendations:recs.filter(Boolean) };
}
function recommend(score, ctx){
  const m={
    documentation:'Add module-level docstrings and a docs/ overview; documentation is the weakest onboarding lever.',
    featureCoupling:`Business systems are cross-linked ${ctx.crossLinks} time(s); consider clearer interfaces between them.`,
    domainSeparation:'Some files are claimed by multiple capabilities; split shared files so each system owns its code.',
    onboarding:'High onboarding cost: add a guided tour and reduce cross-system coupling.',
    aiReadiness:'Improve AI readiness with clearer module boundaries, docstrings, and tests.',
    businessModularity:'Several business capabilities are thin; consolidate or flesh out their modules.',
    maintainability:'Reduce large/complex files flagged in Repository Health to improve maintainability.',
    architectureMaturity:'Address circular dependencies and establish clearer layering (see Architecture).',
    technicalModularity:'High coupling detected; reduce fan-in on hub modules.',
  };
  return m[score.key] ? { area:score.label, value:score.value, advice:m[score.key] } : null;
}

function clampScore(x){ return Math.max(0,Math.min(1,x)); }
function titleCase(s){ return String(s).replace(/\b\w/g,(c)=>c.toUpperCase()); }
