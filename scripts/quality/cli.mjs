import { parseArgs } from 'node:util';
import { runQuality } from './gate.mjs';
import { writeReport, publishSummary, summary } from './report.mjs';
const { values } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string', default: 'HEAD' }, output: { type: 'string', default: 'coverage/pr-quality.json' } } });
const report = await runQuality({ cwd: process.cwd(), base: values.base, head: values.head });
writeReport(report, values.output);
publishSummary(report);
console.log(summary(report));
process.exitCode = report.status === 'passed' ? 0 : report.status === 'failed' ? 1 : 2;
