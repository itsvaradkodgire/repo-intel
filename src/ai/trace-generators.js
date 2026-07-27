/**
 * trace-generators.js — grounded AI explanations for verified traces.
 *
 * The AI ONLY explains the static-analysis result it is given. It must not
 * invent functions, formulas, APIs, columns, or lineage. Every prompt embeds the
 * verified evidence (formulas extracted from the AST, origin columns, steps with
 * file:line) and instructs the model to translate it into developer-friendly
 * language, cite the evidence, and say "Unable to verify from static analysis."
 * when the evidence is missing.
 */

const GROUND = `You explain results produced by static analysis of real source code. Rules:
- Use ONLY the provided evidence (formulas, variables, columns, files, lines).
- NEVER invent functions, formulas, APIs, database columns, or data lineage.
- Cite evidence as file:line where given.
- If the evidence does not answer something, say "Unable to verify from static analysis."
- Be concrete and concise; write for a developer new to this code.`;

export function traceExplainMessages(kind, payload, body) {
  if (!payload) return null;
  if (kind === 'calculation') return calculationMessages(payload);
  if (kind === 'flow') return flowMessages(payload);
  if (kind === 'variable') return variableMessages(payload, body);
  return null;
}

function calculationMessages(calc) {
  const facts = [];
  facts.push('CALCULATION OF: ' + calc.variable);
  if (calc.inputs && calc.inputs.length) facts.push('INPUTS: ' + calc.inputs.map((i) => i.name + (i.type ? ':' + i.type : '') + ' (' + i.kind + ')').join(', '));
  if (calc.formulas && calc.formulas.length) {
    facts.push('FORMULAS (extracted from the AST):');
    for (const f of calc.formulas) facts.push('  ' + f.text + '   [' + f.file + ':' + f.line + ']' + (f.condition ? '  when ' + f.condition : ''));
  }
  if (calc.origins) {
    if (calc.origins.columns && calc.origins.columns.length) facts.push('ORIGIN DB COLUMNS: ' + calc.origins.columns.join(', '));
    if (calc.origins.constants && calc.origins.constants.length) facts.push('CONSTANTS: ' + calc.origins.constants.join(', '));
    if (calc.origins.parameters && calc.origins.parameters.length) facts.push('ENTRY PARAMETERS: ' + calc.origins.parameters.join(', '));
  }
  if (calc.conditions && calc.conditions.length) facts.push('CONDITIONS AFFECTING IT: ' + calc.conditions.join(' ; '));
  return [
    { role: 'system', content: 'You are a senior engineer explaining how a value is computed. ' + GROUND },
    { role: 'system', content: facts.join('\n') },
    { role: 'user', content: `Explain, step by step, how "${calc.variable}" is calculated, using the extracted formulas and their real inputs/origins. Note any condition that changes the result. Reference file:line. End with "Confidence: high|medium|low".` },
  ];
}

function flowMessages(flow) {
  const ev = flow.evidence || {};
  const facts = [];
  facts.push('FEATURE FLOW: ' + flow.name + '  (confidence ' + flow.confidence + ')');
  facts.push('ENTRY: ' + flow.entry.class + '.' + flow.entry.name + '()  [' + flow.entry.file + ':' + flow.entry.line + ']');
  if (ev.controllers && ev.controllers.length) facts.push('CONTROLLERS: ' + ev.controllers.join(', '));
  if (ev.services && ev.services.length) facts.push('SERVICES: ' + ev.services.join(', '));
  if (ev.calculators && ev.calculators.length) facts.push('CALCULATORS: ' + ev.calculators.join(', '));
  if (ev.repositories && ev.repositories.length) facts.push('REPOSITORIES: ' + ev.repositories.join(', '));
  if (ev.tables && ev.tables.length) facts.push('TABLES: ' + ev.tables.join(', '));
  if (ev.columns && ev.columns.length) facts.push('COLUMNS: ' + ev.columns.join(', '));
  facts.push('PERSISTS: ' + (ev.persists ? 'yes' : 'no'));
  if (ev.formulas && ev.formulas.length) { facts.push('FORMULAS:'); for (const f of ev.formulas.slice(0, 12)) facts.push('  ' + f.result + ' = ' + f.expr + '  [' + f.file + ':' + f.line + ']'); }
  return [
    { role: 'system', content: 'You are a senior engineer walking a newcomer through a feature implementation. ' + GROUND },
    { role: 'system', content: facts.join('\n') },
    { role: 'user', content: `Explain this "${flow.name}" flow end to end: the entry point, what data it reads, the calculations it performs, and where the result goes. Use only the evidence. Reference file:line. End with "Confidence: high|medium|low".` },
  ];
}

function variableMessages(trace, body) {
  const dir = trace.direction;
  const facts = [];
  facts.push((dir === 'forward' ? 'FORWARD' : 'BACKWARD') + ' TRACE of: ' + trace.target.variable + ' in ' + trace.target.class + '.' + trace.target.methodName + '()');
  const steps = (trace.steps || []).slice(0, 24);
  facts.push('EVIDENCE STEPS:');
  for (const s of steps) facts.push('  ' + s.from + ' -' + s.type + '-> ' + s.to + '  [' + s.confidence + '] ' + (s.file ? s.file + ':' + s.line : ''));
  if (trace.summary) {
    if (trace.summary.columns) facts.push('ORIGIN COLUMNS: ' + trace.summary.columns.join(', '));
    if (trace.summary.persisted) facts.push('PERSISTED TO: ' + trace.summary.persisted.join(', '));
    if (trace.summary.responseFields) facts.push('RESPONSE FIELDS: ' + [...new Set(trace.summary.responseFields)].join(', '));
  }
  return [
    { role: 'system', content: 'You explain where a value comes from or goes, from a verified data-flow trace. ' + GROUND },
    { role: 'system', content: facts.join('\n') },
    { role: 'user', content: `In plain language, explain ${dir === 'forward' ? 'what happens to' : 'where the value of'} "${trace.target.variable}" ${dir === 'forward' ? 'after it is computed' : 'comes from'}, following the evidence steps. Reference file:line. End with "Confidence: high|medium|low".` },
  ];
}
