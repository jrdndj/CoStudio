import type { WorkflowGraph } from "@/lib/study-types";

export function xml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character] ?? character).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

const colors = {
  welcome: { fill: "#deefea", label: "AI welcome" },
  conditional: { fill: "#f5e8cf", label: "AI involvement conditional" },
  human: { fill: "#e8dff4", label: "Human only" },
  undecided: { fill: "#e9edf2", label: "Undecided" },
};

function wrap(value: string, limit: number, lines: number) {
  const result: string[] = [];
  for (const word of value.split(/\s+/)) {
    const last = result.at(-1);
    if (last && last.length + word.length + 1 <= limit) result[result.length - 1] += ` ${word}`;
    else result.push(word.length > limit ? `${word.slice(0, limit - 1)}…` : word);
  }
  if (result.length > lines) result[lines - 1] = `${result[lines - 1].slice(0, limit - 1)}…`;
  return result.slice(0, lines).map(xml);
}

export function workflowSvg(title: string, graph: WorkflowGraph) {
  const margin = 36;
  const boxWidth = 242;
  const boxHeight = 96;
  const xs = graph.nodes.map((node) => node.position.x);
  const ys = graph.nodes.map((node) => node.position.y);
  const x0 = Math.floor(Math.min(...(xs.length ? xs : [0]))) - margin;
  const y0 = Math.floor(Math.min(...(ys.length ? ys : [0]))) - margin - 46;
  const width = Math.max(520, Math.ceil(Math.max(...xs)) + boxWidth + margin - x0);
  const height = Math.max(230, Math.ceil(Math.max(...ys)) + boxHeight + margin - y0);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges.map(({ source, target, label }) => {
    const from = nodes.get(source)?.position;
    const to = nodes.get(target)?.position;
    if (!from || !to) return "";
    const x = from.x + boxWidth;
    const y = from.y + boxHeight / 2;
    const targetY = to.y + boxHeight / 2;
    const middle = (x + to.x) / 2;
    const labelMarkup = label ? `<text x="${middle}" y="${(y + targetY) / 2 - 6}" text-anchor="middle" fill="#434a5e" font-size="13">${wrap(label, 28, 1)[0]}</text>` : "";
    return `<path d="M ${x} ${y} C ${middle} ${y}, ${middle} ${targetY}, ${to.x} ${targetY}" fill="none" stroke="#807fa0" stroke-width="2" marker-end="url(#arrow)"/>${labelMarkup}`;
  }).join("");
  const boxes = graph.nodes.map(({ position, data }) => {
    const lines = wrap(data.label, 25, 2);
    const label = lines.map((line, index) => `<text x="16" y="${27 + index * 21}" fill="#1c2232" font-size="16" font-weight="600">${line}</text>`).join("");
    const color = colors[data.preference];
    const description = data.notes ? `${data.label} — ${data.notes}` : data.label;
    return `<g transform="translate(${position.x} ${position.y})"><title>${xml(description)}</title><rect width="${boxWidth}" height="${boxHeight}" rx="12" fill="${color.fill}" stroke="#adb3c0"/>${label}<text x="16" y="76" fill="#464c60" font-size="14">${color.label}</text></g>`;
  }).join("");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x0} ${y0} ${width} ${height}" role="img">`,
    `<title>${xml(title)}</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#807fa0"/></marker></defs>`,
    `<rect x="${x0}" y="${y0}" width="${width}" height="${height}" fill="#fcfbfd"/><g font-family="sans-serif"><text x="${x0 + margin}" y="${y0 + 39}" fill="#252939" font-weight="700" font-size="24">${wrap(title, 44, 1)[0]}</text>${edges}${boxes}</g></svg>`,
  ].join("");
  return { svg, width, height };
}
