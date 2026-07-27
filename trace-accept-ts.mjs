/**
 * trace-accept-ts.mjs — acceptance harness for TypeScript/TSX/JS deep tracing.
 *
 * Mirrors trace-accept.mjs (Java) against the ts-hrms reference repo. Validates
 * that the SAME normalized evidence graph produces real formulas, DB-column
 * origins (Supabase select projections), persistence detection (Supabase insert),
 * conditional guards (ternary predicates), and correct flow discovery for TS.
 *
 * Static analysis is the source of truth: every assertion checks verified AST
 * evidence, never AI output. Run: node trace-accept-ts.mjs
 */
import { buildTraceModel, investigateFeature, explainCalculation } from './src/trace/index.js';
import fs from 'fs';
import path from 'path';

const ROOT = process.env.TS_HRMS || '/Users/varadkodgire/.gemini/antigravity/scratch/ts-hrms';
let pass = 0, fail = 0;
const G = (s) => `\x1b[32m${s}\x1b[0m`, R = (s) => `\x1b[31m${s}\x1b[0m`;
function ok(cond, msg) { if (cond) { pass++; console.log('  ' + G('PASS') + ' ' + msg); } else { fail++; console.log('  ' + R('FAIL') + ' ' + msg); } }

function walk(d) { let out = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) out = out.concat(walk(p)); else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(p); } return out; }
const langOf = (f) => f.endsWith('.tsx') ? 'tsx' : f.endsWith('.ts') ? 'typescript' : f.endsWith('.jsx') ? 'javascript' : 'javascript';

const files = walk(ROOT).map((p) => ({ path: path.relative(ROOT, p), lang: langOf(p) }));
const labelOf = { typescript: 'TypeScript', tsx: 'TSX', javascript: 'JavaScript' };
const languages = [...new Set(files.map((f) => labelOf[f.lang]))].map((l) => ({ label: l }));
const model = await buildTraceModel({ files, languages }, ROOT);

const sindex = model._sindex;
const methodByName = (n) => sindex && sindex.methods.find((m) => m.name === n);
const explain = (mn, v) => { const m = methodByName(mn); return m ? explainCalculation(model, m.id, v) : null; };

console.log('\n########## TEST 0 — Model builds for TypeScript ##########');
ok(model.available === true, 'trace model available for a TypeScript repo');
ok(model.stats && model.stats.methods >= 8, `extracted methods (${model.stats && model.stats.methods})`);
ok(model.stats && model.stats.dbAccess >= 3, `detected DB access sites (${model.stats && model.stats.dbAccess})`);
const caps = model.capabilities || [];
ok(caps.some((c) => c.language === 'TypeScript' && c.level === 'fullstack'), 'capability: TypeScript reported as fullstack');

console.log('\n########## TEST 1 — Real formulas from AST (net salary chain) ##########');
const net = explain('calculateNetSalary', 'netSalary');
const fTexts = (net.formulas || []).map((f) => f.text);
ok(fTexts.some((t) => /netSalary = grossSalary - deductions/.test(t)), 'netSalary = grossSalary - deductions');
ok(fTexts.some((t) => /grossSalary = dailySalary [*×] payableDays/.test(t)), 'grossSalary = dailySalary × payableDays');
ok(fTexts.some((t) => /dailySalary = monthlySalary \/ WORKING_DAYS/.test(t)), 'dailySalary = monthlySalary / WORKING_DAYS');
ok(fTexts.some((t) => /deductions = tax \+ penaltyAmount/.test(t)), 'deductions = tax + penaltyAmount');

console.log('\n########## TEST 2 — DB-column origins (Supabase select projection) ##########');
const day = explain('calculateDailySalary', 'dailySalary');
ok((day.origins.columns || []).includes('employees.monthly_salary'), 'monthlySalary traces to employees.monthly_salary');

console.log('\n########## TEST 3 — Conditional guards (ternary predicate) ##########');
const pay = explain('getPayableDays', 'payableDays');
ok((pay.conditions || []).some((c) => /worked_hours < HALF_DAY_THRESHOLD/.test(c)), 'captures ternary condition worked_hours < HALF_DAY_THRESHOLD');

console.log('\n########## TEST 4 — Flow discovery: payroll run persists via Supabase insert ##########');
const inv = investigateFeature(model, 'payroll');
const runFlow = (inv.flows || []).find((f) => f.entry && f.entry.name === 'generatePayroll');
ok(!!runFlow, 'discovers generatePayroll as a flow entry');
ok(runFlow && runFlow.evidence.persists === true, 'recognizes Supabase .insert() as persistence');
ok(runFlow && runFlow.evidence.tables.includes('payroll'), 'flow writes to payroll table');
ok(runFlow && runFlow.evidence.tables.includes('employees'), 'flow reads employees table');
ok(runFlow && (runFlow.evidence.formulas || []).length >= 4, `flow carries the calculation formulas (${runFlow && runFlow.evidence.formulas.length})`);

console.log('\n########## TEST 5 — Persisted columns captured from insert object ##########');
ok(runFlow && runFlow.evidence.columns.some((c) => c === 'payroll.net_salary'), 'insert projects payroll.net_salary');
ok(runFlow && runFlow.evidence.columns.some((c) => c === 'payroll.gross_salary'), 'insert projects payroll.gross_salary');

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
