import sharp from "sharp";
import type { WorkflowGraph } from "@/lib/study-types";
import { workflowSvg } from "@/lib/workflow-svg";

export { xml } from "@/lib/workflow-svg";

export async function renderWorkflow(title: string, graph: WorkflowGraph) {
  const { svg, width, height } = workflowSvg(title, graph);
  const rasterWidth = Math.round((width / Math.max(width, height)) * 2400);
  const rasterHeight = Math.round((height / Math.max(width, height)) * 2400);
  const rasterSvg = svg.replace(`width="${width}" height="${height}"`, `width="${rasterWidth}" height="${rasterHeight}"`);
  const png = await sharp(Buffer.from(rasterSvg)).png().toBuffer();
  return { svg, png: `data:image/png;base64,${png.toString("base64")}` };
}
