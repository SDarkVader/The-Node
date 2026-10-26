/** Read and export already recorded private evidence; never executes a society or model. */
import { parseArgs } from 'node:util';
import { readSocietyResults, writeSocietyResults, writeSocietyRawResults } from '../src/society/report.js';

const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, raw: { type: 'boolean', default: false } } });
if (!values.input || !values.output) throw Error('society_report_input_and_fresh_output_required');
const report = readSocietyResults(values.input);
const files = values.raw ? writeSocietyRawResults(report, values.output) : writeSocietyResults(report, values.output);
console.log(JSON.stringify({ files, counts: report.counts,
  controlled: report.controlled, integrityIssues: report.integrityIssues.length, providerCalls: 0 }, null, 2));
