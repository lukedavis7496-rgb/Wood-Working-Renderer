import { readFileSync } from 'node:fs';
import { SpecError } from './core/spec';
import type { ProjectSpec } from './core/types';
import { formatPlan, plan } from './output/plan';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: npm run plan -- <spec.json> [--json]');
  process.exit(1);
}

try {
  const spec = JSON.parse(readFileSync(file, 'utf8')) as ProjectSpec;
  const result = plan(spec);
  if (args.includes('--json')) {
    const { model, ...rest } = result;
    console.log(JSON.stringify({ spec: model.spec, warnings: model.warnings, hardware: model.hardware, assemblySteps: model.assemblySteps, ...rest }, null, 2));
  } else {
    console.log(formatPlan(result));
  }
} catch (e) {
  console.error(e instanceof SpecError ? e.message : `Error: ${(e as Error).message}`);
  process.exit(1);
}
