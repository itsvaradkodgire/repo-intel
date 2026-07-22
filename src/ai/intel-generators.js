/**
 * intel-generators.js — Phase 5 grounded AI narration for the intel layer.
 *
 * The AI NEVER invents product features, systems, journeys, or reasons. It only
 * narrates the mechanical intel model (index.intel) already computed from static
 * analysis. Every prompt embeds the concrete intel facts + a strict grounding
 * rule, and every prompt requires a Confidence line. If a fact is absent the model
 * must say "Unable to determine from repository analysis."
 *
 * AI is optional everywhere: the pages fully work from the mechanical model with
 * no key; these generators just add narrative when a provider is configured.
 */

const GROUND = `You must ground every statement ONLY in the provided intelligence model, which was produced by static analysis of the real source code. NEVER invent product features, systems, user journeys, tables, or reasons. If the model lacks something, say "Unable to determine from repository analysis." Refer to systems by their exact labels. Keep it concrete.`;

function productFacts(intel){
  const p=intel.product, sm=intel.systemMap;
  const lines=[];
  lines.push('PRODUCT TYPE: '+p.productType+` (confidence ${p.productTypeConfidence})`);
  lines.push('DETECTED SUMMARY: '+p.summary);
  lines.push('LIKELY PROBLEM SOLVED: '+p.problemSolved);
  lines.push('INFERRED USERS: '+p.users.join(', '));
  lines.push('CORE BUSINESS SYSTEMS (with confidence):');
  for(const f of p.coreFeatures) lines.push(`  - ${f.label} [${f.confidenceLabel} ${f.confidence}] — ${f.why}`);
  if(p.possibleFeatures.length) lines.push('POSSIBLE (low-confidence) SYSTEMS: '+p.possibleFeatures.map((f)=>f.label).join(', '));
  if(p.integrations.length) lines.push('INTEGRATIONS: '+p.integrations.map((i)=>i.label+(i.deps.length?` (${i.deps.slice(0,3).join(', ')})`:'')).join('; '));
  lines.push('STACK: '+(p.stack.languages.join(', ')||'?')+(p.stack.frameworks.length?` / ${p.stack.frameworks.join(', ')}`:''));
  lines.push('SYSTEM MAP: '+sm.stats.systems+' systems, '+sm.stats.links+' links.');
  lines.push('KEY SYSTEM RELATIONSHIPS (why-graph):');
  for(const e of sm.edges.slice(0,14)){
    const s=sm.nodes.find((n)=>n.id===e.source), t=sm.nodes.find((n)=>n.id===e.target);
    lines.push(`  - ${s?s.label:e.source} → ${t?t.label:e.target}: ${e.why}`);
  }
  return lines.join('\n');
}

// ---- Product Overview narrative ----
export function productOverviewMessages(intel){
  return [
    { role:'system', content:`You are a senior architect writing a product-level overview of a codebase for a new team member. ${GROUND}` },
    { role:'system', content: productFacts(intel) },
    { role:'user', content:
`Write a Product Overview with these markdown sections (## headers):
## What This Product Does
## Who Uses It
## The Problem It Solves
## Core Capabilities
## How The Systems Fit Together
## Notable Integrations & Stack

Base everything on the detected systems and their confidence. If confidence for a capability is "possibly" or lower, hedge with "likely"/"possibly". If the product intent is unclear (technical/library code), say so plainly. End with "Confidence: high|medium|low".` },
  ];
}

// ---- System story narrative for one capability ----
export function systemStoryMessages(intel, systemId){
  const story = intel.stories.stories.find((s)=>s.id===systemId);
  const cap = intel.capabilities.capabilities.find((c)=>c.id===systemId);
  if(!story && !cap) return null;
  const s = story || {};
  const ev=[];
  ev.push('SYSTEM: '+(cap?cap.label:systemId)+` [${cap?cap.confidenceLabel:'?'} ${cap?cap.confidence:''}]`);
  ev.push('PURPOSE: '+(s.purpose||(cap?cap.why:'')));
  if(s.responsibilities&&s.responsibilities.length) ev.push('KEY FUNCTIONS (evidence): '+s.responsibilities.join(', '));
  if(s.inputs) ev.push('INPUTS: '+s.inputs.join('; '));
  if(s.outputs) ev.push('OUTPUTS: '+s.outputs.join('; '));
  if(s.dependencies&&s.dependencies.length) ev.push('DEPENDS ON: '+s.dependencies.map((d)=>d.label+' ('+d.why+')').join('; '));
  if(s.consumers&&s.consumers.length) ev.push('CONSUMED BY: '+s.consumers.map((c)=>c.label).join(', '));
  if(cap&&cap.evidence.tables.length) ev.push('TABLES: '+cap.evidence.tables.join(', '));
  if(cap&&cap.evidence.routes.length) ev.push('ROUTES: '+cap.evidence.routes.slice(0,8).join(', '));
  if(s.risks&&s.risks.length) ev.push('RISK FILES: '+s.risks.map((r)=>r.path+' ('+r.reasons.join('; ')+')').join(' | '));
  return [
    { role:'system', content:`You explain one system of a product to a new engineer. ${GROUND} Cover purpose, responsibilities, inputs, outputs, dependencies, consumers, business value, and risks.` },
    { role:'system', content: ev.join('\n') },
    { role:'user', content:`Tell the story of the "${cap?cap.label:systemId}" system: what it does, why it exists, what it consumes and produces, who depends on it, its business value, and one risk to watch. Under 220 words. End with "Confidence: high|medium|low".` },
  ];
}

// ---- Guided tour narrative for one stop ----
export function tourStopMessages(intel, systemId){
  const stop = intel.tour.stops.find((s)=>s.id===systemId);
  const cap = intel.capabilities.capabilities.find((c)=>c.id===systemId);
  if(!cap) return null;
  const facts=[
    'TOUR STOP: '+cap.label+` [${cap.confidenceLabel} ${cap.confidence}]`,
    'WHY IT EXISTS: '+cap.why,
    'FILES: '+cap.evidence.fileCount+(cap.evidence.routes.length?`, ROUTES: ${cap.evidence.routes.slice(0,6).join(', ')}`:'')+(cap.evidence.tables.length?`, TABLES: ${cap.evidence.tables.slice(0,6).join(', ')}`:''),
    stop&&stop.teaser?('CONNECTIONS: '+stop.teaser):'',
    'EXAMPLE SYMBOLS: '+(cap.evidence.symbols.slice(0,8).join(', ')||'n/a'),
  ].filter(Boolean).join('\n');
  return [
    { role:'system', content:`You are a friendly guide walking a brand-new engineer through a codebase, one system at a time. ${GROUND} Assume no prior knowledge; explain like onboarding. Avoid jargon.` },
    { role:'system', content: facts },
    { role:'user', content:`We're at the "${cap.label}" stop of the tour. In 3-5 sentences, explain what this system does, why it matters to the product, and what to look at first. Beginner-friendly. End with "Confidence: high|medium|low".` },
  ];
}

// ---- User journey narrative ----
export function journeyMessages(intel, journeyId){
  const j = intel.journeys.journeys.find((x)=>x.id===journeyId);
  if(!j) return null;
  const facts=['USER JOURNEY: '+j.label+` (persona: ${j.persona}, ${j.confidenceLabel})`,
    'STEPS (each backed by a real system):'];
  j.steps.forEach((s,i)=>facts.push(`  ${i+1}. ${s.label}${s.entry?` (entry: ${s.entry})`:''}`));
  return [
    { role:'system', content:`You narrate an inferred user journey through a product. ${GROUND} Each step corresponds to a real detected system.` },
    { role:'system', content: facts.join('\n') },
    { role:'user', content:`Walk through the "${j.label}" journey as a ${j.persona} experiences it, step by step, referencing the real systems. Note where the journey may be incomplete (missing steps). Under 180 words. End with "Confidence: high|medium|low".` },
  ];
}

// ---- Why-edge explanation ----
export function whyEdgeMessages(intel, sourceId, targetId){
  const sm=intel.systemMap;
  const e = sm.edges.find((x)=>x.source===sourceId&&x.target===targetId);
  if(!e) return null;
  const s=sm.nodes.find((n)=>n.id===sourceId), t=sm.nodes.find((n)=>n.id===targetId);
  const facts=[`EDGE: ${s?s.label:sourceId} → ${t?t.label:targetId}`,
    'RELATIONSHIP TYPES: '+e.rels.join(', ')+` (strength ${e.strength})`,
    'MECHANICAL REASON: '+e.why,
    'EXAMPLES: '+e.samples.join('; ')];
  return [
    { role:'system', content:`You explain WHY one system depends on another, in business terms. ${GROUND}` },
    { role:'system', content: facts.join('\n') },
    { role:'user', content:`Explain why "${s?s.label:sourceId}" depends on "${t?t.label:targetId}". Give the business reason and the technical mechanism. 2-4 sentences. End with "Confidence: high|medium|low".` },
  ];
}

// ---- Intent answer narrative (grounds on the mechanical intent result) ----
export function intentNarrativeMessages(intel, intentResult){
  const ev=intentResult.evidence;
  const facts=['QUESTION: '+intentResult.query,
    'MECHANICAL ANSWER: '+intentResult.answer,
    intentResult.target?('TARGET SYSTEM: '+intentResult.target.label+` [${intentResult.target.confidence}] — ${intentResult.target.why}`):'',
    ev.routes.length?('ROUTES: '+ev.routes.slice(0,10).join(', ')):'',
    ev.tables.length?('TABLES: '+ev.tables.slice(0,10).join(', ')):'',
    ev.functions.length?('FUNCTIONS: '+ev.functions.slice(0,12).map((f)=>f.name+' @ '+f.file+':'+f.line).join('; ')):'',
    ev.files.length?('FILES: '+ev.files.slice(0,12).join(', ')):'',
  ].filter(Boolean).join('\n');
  return [
    { role:'system', content:`You answer a developer's question about a codebase using ONLY the evidence the analyzer selected. ${GROUND} Cite files as path:line.` },
    { role:'system', content: facts },
    { role:'user', content:`Answer: "${intentResult.query}". Use the evidence above; cite concrete files. If the evidence is insufficient, say "Unable to determine from repository analysis." End with "Confidence: high|medium|low".` },
  ];
}

// ---- Product scorecard narrative ----
export function scorecardMessages(intel){
  const sc=intel.scorecard;
  const facts=['PRODUCT SCORECARD (overall '+sc.overall+'/100):',
    ...sc.scores.map((s)=>`  - ${s.label}: ${s.value}/100`),
    'WEAKEST AREAS: '+sc.recommendations.map((r)=>r.area).join(', ')];
  return [
    { role:'system', content:`You are a principal engineer giving a candid architecture/product assessment from a scorecard. ${GROUND}` },
    { role:'system', content: facts.join('\n') },
    { role:'user', content:`Summarize the product's maturity in 4-6 sentences: strengths, the biggest weaknesses, and the top 3 concrete improvements. Reference the scores. End with "Confidence: high|medium|low".` },
  ];
}
