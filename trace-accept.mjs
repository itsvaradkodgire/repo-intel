/* trace-accept.mjs — Trace Engine acceptance tests (Node ESM).
 * Runs the 5 acceptance tests from the spec against the spring-hrms reference repo.
 */
import fs from 'fs';
import path from 'path';
import { buildTraceModel, investigateFeature, explainCalculation, traceVariable, getMethodDetail } from './src/trace/index.js';

const DIR = '/Users/varadkodgire/.gemini/antigravity/scratch/spring-hrms';

// build a minimal universalIndex-like object (only fields the trace engine needs)
function walk(d, base) { let o = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) o = o.concat(walk(p, base)); else o.push(path.relative(base, p)); } return o; }
const files = walk(DIR, DIR).map((rel) => ({ path: rel, lang: rel.endsWith('.java') ? 'java' : (rel.endsWith('.jsx') ? 'javascript' : 'other') }));
const universalIndex = { files, languages: [{ label: 'Java' }], routes: [] };

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name + (detail ? '  ' + detail : '')); } else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (detail ? '  ' + detail : '')); } }

const model = await buildTraceModel(universalIndex, DIR);
model._universalIndex = universalIndex;
console.log('\n=== Trace model ===');
console.log(JSON.stringify(model.stats));

// ---------- ACCEPTANCE TEST 1: "How is payroll calculated?" ----------
console.log('\n########## TEST 1 — Investigate: "How is payroll calculated?" ##########');
const t1 = investigateFeature(model, 'How is payroll calculated?');
console.log('candidate flows: ' + t1.flows.length);
t1.flows.forEach((f) => console.log('  - ' + f.name + '  [' + f.confidenceLabel + ' ' + f.confidence + ']  entry=' + f.entry.name + '  services=' + JSON.stringify(f.evidence.services) + ' calc=' + JSON.stringify(f.evidence.calculators) + ' persists=' + f.evidence.persists + ' cols=' + f.evidence.columns.length));
check('T1 finds >=2 candidate payroll flows', t1.flows.length >= 2);
check('T1 identifies a persisting run', t1.flows.some((f) => f.evidence.persists));
check('T1 identifies a preview (non-persisting)', t1.flows.some((f) => !f.evidence.persists && /preview/i.test(f.name + JSON.stringify(f.evidence.services))));
check('T1 surfaces calculators', t1.flows.some((f) => f.evidence.calculators.length));
check('T1 surfaces DB columns', t1.flows.some((f) => f.evidence.columns.length));
// deep explain of the top flow's net salary
const monthly = model._sindex.methods.find((m) => m.containingClass.endsWith('MonthlyPayrollService') && m.name === 'generatePayroll');
const calc = explainCalculation(model, monthly.id, 'netSalary');
console.log('  net salary formulas:');
calc.formulas.forEach((f) => console.log('    ' + f.text + '  @' + path.basename(f.file) + ':' + f.line));
console.log('  inputs: ' + calc.inputs.map((i) => i.name + ':' + i.type).join(', '));
console.log('  origin columns: ' + JSON.stringify(calc.origins.columns));
console.log('  conditions: ' + JSON.stringify(calc.conditions));
check('T1 extracts netSalary formula from code', calc.formulas.some((f) => /netSalary = grossSalary - deductions/.test(f.text)));
check('T1 extracts dailySalary formula', calc.formulas.some((f) => /dailySalary = monthlySalary . WORKING_DAYS/.test(f.text.replace('×', 'x').replace('/', '/')) || /monthlySalary/.test(f.text)));
check('T1 traces origin to employees.monthly_salary', calc.origins.columns.includes('employees.monthly_salary'));
check('T1 captures a condition affecting the calc', calc.conditions.length > 0);

// ---------- ACCEPTANCE TEST 2: "Where does this value come from?" ----------
console.log('\n########## TEST 2 — Trace backward: netSalary origin ##########');
const t2 = traceVariable(model, monthly.id, 'netSalary', 'backward');
console.log('  origin columns: ' + JSON.stringify(t2.summary.columns));
console.log('  step count: ' + t2.steps.length + ' (all evidence-backed)');
check('T2 reaches a DB column origin', t2.summary.columns.length >= 1);
check('T2 all steps carry file+line evidence', t2.steps.every((s) => s.file && s.line));
check('T2 all steps carry a confidence label', t2.steps.every((s) => s.confidence));

// ---------- ACCEPTANCE TEST 3: "What happens to this value?" ----------
console.log('\n########## TEST 3 — Trace forward: grossSalary fate ##########');
const t3 = traceVariable(model, monthly.id, 'grossSalary', 'forward');
console.log('  persisted: ' + JSON.stringify(t3.summary.persisted));
console.log('  response fields: ' + JSON.stringify([...new Set(t3.summary.responseFields)]));
check('T3 shows persistence to a DB column', t3.summary.persisted.length >= 1);
check('T3 shows flow into a response DTO', t3.summary.responseFields.length >= 1);

// ---------- ACCEPTANCE TEST 4: unnamed feature (CompensationProcessor) ----------
console.log('\n########## TEST 4 — Discover unnamed feature: "How does payroll work?" ##########');
const t4 = investigateFeature(model, 'How does payroll work?');
const foundHidden = t4.flows.some((f) => f.members.some((m) => /Compensation|Wage/.test(m.class)));
console.log('  flows touching CompensationProcessor/WageCalculator: ' + (foundHidden ? 'YES' : 'no'));
t4.flows.forEach((f) => console.log('    - ' + f.name + ' members=' + f.members.map((m) => m.class.split('.').pop()).join(',')));
check('T4 discovers the non-"payroll"-named compensation pipeline', foundHidden);

// ---------- ACCEPTANCE TEST 5: two implementations shown, not merged ----------
console.log('\n########## TEST 5 — Two implementations of PayrollService ##########');
const impls = t1.flows.filter((f) => f.entry.class.endsWith('MonthlyPayrollService') || f.entry.class.endsWith('PayrollPreviewService'));
const bindings = model._sindex.diBindings.get('com.acme.hrms.service.PayrollService') || [];
console.log('  PayrollService implementations: ' + bindings.map((b) => b.name).join(', '));
check('T5 knows both PayrollService implementations', bindings.length === 2 && bindings.some((b) => b.name === 'MonthlyPayrollService') && bindings.some((b) => b.name === 'PayrollPreviewService'));
check('T5 keeps the two flows separate (not merged)', new Set(t1.flows.map((f) => f.entry.class)).size >= 2);

// ---------- LOOSE ENDS ----------
console.log('\n########## Loose-end detection ##########');
model.looseEnds.forEach((le) => console.log('  [' + le.kind + '/' + le.confidence + '] ' + le.detail));
check('Loose-end: detects the persisted-not-exposed attendance penalty', model.looseEnds.some((le) => /penalty/i.test(le.symbol || le.detail)));

console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
