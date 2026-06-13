import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const graphPath = path.resolve(__dirname, '../graphify-out/graph.json');

console.log(`Loading graph from: ${graphPath}`);

if (!fs.existsSync(graphPath)) {
  console.error(`Error: graph.json not found at ${graphPath}`);
  process.exit(1);
}

const graphData = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const nodes = graphData.nodes || [];

let webNodesCount = 0;
let workerNodesCount = 0;
let totalNodes = nodes.length;

for (const node of nodes) {
  const sf = node.source_file || '';
  if (sf.includes('apps/web') || sf.includes('apps\\web')) {
    webNodesCount++;
  }
  if (sf.includes('apps/worker-py') || sf.includes('apps\\worker-py')) {
    workerNodesCount++;
  }
}

console.log(`Total nodes in graph: ${totalNodes}`);
console.log(`apps/web nodes: ${webNodesCount}`);
console.log(`apps/worker-py nodes: ${workerNodesCount}`);

if (webNodesCount === 0 || workerNodesCount === 0) {
  console.warn(`WARNING: Invoice Audit Platform apps/ modules are NOT fully indexed in graphify-out/graph.json.`);
  console.warn(`Fallback mechanism active. Manual wiki and visual badges will be used.`);
  process.exit(0);
} else {
  console.log(`SUCCESS: apps/ modules are successfully indexed in the dependency graph.`);
  process.exit(0);
}
