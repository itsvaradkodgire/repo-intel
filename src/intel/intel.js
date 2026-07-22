/**
 * intel.js — Phase 5 Intent & Business Intelligence orchestrator (ADDITIVE).
 *
 * Ties the mechanical Phase-5 engines together into a single `intel` object that
 * is attached to the analysis index (index.intel), leaving every existing field
 * untouched. Fully deterministic + offline. The AI layer only narrates this.
 *
 * Produces:
 *   capabilities   discovered systems (business/technical/integration/infra/xcut)
 *   systemMap      capability graph + why-graph edges + business spine
 *   product        product overview (what/who/why/features/stack)
 *   capabilityMap  capability -> sub -> implementation -> files/apis/tables/tests/docs
 *   journeys       inferred user journeys
 *   stories        per-system stories (purpose/inputs/outputs/deps/consumers/risk)
 *   scorecard      product maturity scores + recommendations
 *   tour           an adaptive guided repository tour
 */
import { discoverCapabilities } from './capabilities.js';
import { buildSystemMap } from './systemmap.js';
import { buildProductOverview, buildCapabilityMap, buildJourneys, buildStories, buildScorecard } from './product.js';

export function buildIntel(index){
  const capResult = discoverCapabilities(index);
  const systemMap = buildSystemMap(index, capResult);
  const product = buildProductOverview(index, capResult, systemMap);
  const capabilityMap = buildCapabilityMap(index, capResult);
  const journeys = buildJourneys(index, capResult);
  const stories = buildStories(index, capResult, systemMap);
  const scorecard = buildScorecard(index, capResult, systemMap);
  const tour = buildTour(index, capResult, systemMap, stories);

  return {
    capabilities: capResult,
    systemMap,
    product,
    capabilityMap,
    journeys,
    stories,
    scorecard,
    tour,
    stats: {
      systems: capResult.stats.total,
      business: capResult.stats.business,
      confident: capResult.stats.confident,
      links: systemMap.stats.links,
      journeys: journeys.stats.total,
      stories: stories.stats.total,
    },
  };
}

// ---------------- Adaptive Guided Tour ----------------
// Orders the systems a newcomer should learn: foundational/infra first, then the
// most important business capabilities by confidence + connectivity, and gives a
// time estimate that adapts to repository complexity.
function buildTour(index, capResult, systemMap, stories){
  const capById = new Map(capResult.capabilities.map((c)=>[c.id,c]));
  // connectivity (how central each system is in the system map)
  const degree=new Map();
  for(const e of systemMap.edges){ degree.set(e.source,(degree.get(e.source)||0)+e.strength); degree.set(e.target,(degree.get(e.target)||0)+e.strength); }

  const learnOrder = (c)=>{
    if(c.kind==='cross-cutting'&&/config/.test(c.id)) return 0;   // config first
    if(c.kind==='infrastructure') return 1;
    if(c.id==='auth') return 2;                                    // auth is the gateway
    if(c.kind==='technical'&&c.id==='data-access') return 3;      // data model
    if(c.kind==='business') return 4;
    if(c.kind==='integration') return 6;
    if(c.kind==='technical') return 7;
    return 5;
  };
  const stops = capResult.capabilities
    .filter((c)=>c.confidence>=0.4)
    .sort((a,b)=> (learnOrder(a)-learnOrder(b)) || ((degree.get(b.id)||0)-(degree.get(a.id)||0)) || (b.confidence-a.confidence))
    .slice(0,12)
    .map((c,i)=>({
      order:i+1, id:c.id, label:c.label, kind:c.kind, why:c.why,
      confidence:c.confidence, files:c.evidence.fileCount,
      entry: c.evidence.routes[0] || c.evidence.files[0] || null,
      teaser: tourTeaser(c, systemMap, capById),
    }));

  // time estimate adapts to size + number of systems
  const loc = index.manifest.counts.loc;
  const minutes = Math.round(Math.min(loc/300 + stops.length*3.5, 90));

  return {
    intro: stops.length
      ? `This repository contains ${capResult.stats.total} systems (${capResult.stats.business} product capabilit${capResult.stats.business===1?'y':'ies'}). A focused tour of the ${stops.length} most important would take about ${minutes} minutes.`
      : 'This repository has no strongly-detected product systems; it looks like technical or library code. A short skim should suffice.',
    estimatedMinutes: minutes,
    stops,
  };
}
function tourTeaser(cap, systemMap, capById){
  const outs = systemMap.edges.filter((e)=>e.source===cap.id).slice(0,2);
  if(outs.length) return `Depends on ${outs.map((e)=>capById.get(e.target)?capById.get(e.target).label:e.target).join(', ')}.`;
  const ins = systemMap.edges.filter((e)=>e.target===cap.id).slice(0,2);
  if(ins.length) return `Used by ${ins.map((e)=>capById.get(e.source)?capById.get(e.source).label:e.source).join(', ')}.`;
  return cap.why;
}
