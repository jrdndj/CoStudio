"use client";

import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { Download, GitBranch, Link2, Plus, Trash2 } from "lucide-react";
import type { WorkflowGraph, WorkflowNode, WorkflowPreference } from "../lib/study-types";
import { workflowSvg } from "../lib/workflow-svg";
import "@xyflow/react/dist/style.css";
import "./modules.css";

export const preferences = {
  welcome: "AI welcome",
  conditional: "AI involvement conditional",
  human: "Human only",
  undecided: "Undecided",
} as const;

type WorkflowNodeData = WorkflowNode["data"];

type FlowNode = Node<WorkflowNodeData, "activity">;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function coordinate(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeWorkflow(value: unknown): WorkflowGraph {
  const source = object(value);
  const seen = new Set<string>();
  const nodes = (Array.isArray(source.nodes) ? source.nodes : []).flatMap((entry, index) => {
    const node = object(entry);
    const data = object(node.data);
    const position = object(node.position);
    const id = typeof node.id === "string" && node.id ? node.id : `activity-${index + 1}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const rawPreference = data.preference ?? node.preference;
    const preference = typeof rawPreference === "string" && Object.hasOwn(preferences, rawPreference)
      ? rawPreference as WorkflowPreference
      : "undecided";
    const label = data.label ?? node.label ?? node.title;
    const notes = data.notes ?? node.notes ?? node.description;
    return [{
      id,
      position: { x: coordinate(position.x ?? node.x, 32 + (index % 3) * 300), y: coordinate(position.y ?? node.y, 30 + Math.floor(index / 3) * 120) },
      data: {
        label: typeof label === "string" ? label : "Untitled activity",
        preference,
        ...(typeof notes === "string" ? { notes } : {}),
      },
    }];
  });
  const edgeIds = new Set<string>();
  const rawEdges = source.edges ?? source.connections;
  const edges = (Array.isArray(rawEdges) ? rawEdges : []).flatMap((entry, index) => {
    const edge = object(entry);
    const sourceId = edge.source ?? edge.from;
    const targetId = edge.target ?? edge.to;
    const id = typeof edge.id === "string" && edge.id ? edge.id : `connection-${index + 1}`;
    if (edgeIds.has(id) || typeof sourceId !== "string" || typeof targetId !== "string" || !seen.has(sourceId) || !seen.has(targetId)) return [];
    edgeIds.add(id);
    return [{ id, source: sourceId, target: targetId, ...(typeof edge.label === "string" ? { label: edge.label } : {}) }];
  });
  return { nodes, edges };
}

function ActivityNode({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div className={`flow-activity${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <strong>{data.label}</strong>
      <span className={`flow-preference flow-preference-${data.preference}`}>{preferences[data.preference]}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { activity: ActivityNode };
const nodeBounds: [[number, number], [number, number]] = [[-6000, -6000], [6000, 6000]];

export function WorkflowEditor({ graph, onChange, height = 370, label = "Creative workflow map" }: {
  graph: WorkflowGraph;
  onChange?: (graph: WorkflowGraph) => void;
  height?: number;
  label?: string;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [target, setTarget] = useState("");
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const selected = graph.nodes.find((node) => node.id === selectedId);
  const editable = Boolean(onChange);
  const nodes: FlowNode[] = useMemo(() => graph.nodes.map((node) => ({
    ...node, type: "activity", selected: node.id === selectedId, measured: measured[node.id],
    ariaLabel: `${node.data.label}. ${preferences[node.data.preference]}`,
  })), [graph.nodes, measured, selectedId]);
  const edges = useMemo(() => graph.edges.map((edge) => ({
    ...edge, selected: edge.id === selectedEdgeId, markerEnd: { type: MarkerType.ArrowClosed },
  })), [graph.edges, selectedEdgeId]);

  function updateNodes(changes: NodeChange<FlowNode>[]) {
    const dimensions = changes.flatMap((change) => change.type === "dimensions" && change.dimensions ? [[change.id, change.dimensions] as const] : []);
    if (dimensions.length) setMeasured((current) => ({ ...current, ...Object.fromEntries(dimensions) }));
    for (const change of changes) {
      if (change.type === "select") setSelectedId((current) => change.selected ? change.id : current === change.id ? "" : current);
    }
    if (!onChange) return;
    const positions = new Map<string, WorkflowNode["position"]>();
    for (const change of changes) {
      if (change.type === "position" && change.position) positions.set(change.id, change.position);
    }
    if (positions.size) onChange({ ...graph, nodes: graph.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position } : node;
    }) });
  }

  function updateEdges(changes: EdgeChange[]) {
    for (const change of changes) {
      if (change.type === "select") setSelectedEdgeId((current) => change.selected ? change.id : current === change.id ? "" : current);
    }
  }

  function addActivity() {
    const id = crypto.randomUUID();
    const index = graph.nodes.length;
    onChange?.({ ...graph, nodes: [...graph.nodes, {
      id, position: { x: 32 + (index % 3) * 255, y: 32 + Math.floor(index / 3) * 115 },
      data: { label: "New activity", preference: "undecided", notes: "" },
    }] });
    setSelectedId(id);
    setSelectedEdgeId("");
  }

  function updateSelected(update: Partial<WorkflowNodeData>) {
    if (selected) onChange?.({ ...graph, nodes: graph.nodes.map((node) => node.id === selected.id ? { ...node, data: { ...node.data, ...update } } : node) });
  }

  function connect(source: string | null, target: string | null) {
    if (!source || !target || source === target || graph.edges.length >= 120 || graph.edges.some((edge) => edge.source === source && edge.target === target)) return;
    onChange?.({ ...graph, edges: [...graph.edges, { id: crypto.randomUUID(), source, target }] });
    setTarget("");
  }

  function removeActivity() {
    if (!selected) return;
    onChange?.({ nodes: graph.nodes.filter((node) => node.id !== selected.id), edges: graph.edges.filter((edge) => edge.source !== selected.id && edge.target !== selected.id) });
    setSelectedId("");
  }

  function removeConnection() {
    onChange?.({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selectedEdgeId) });
    setSelectedEdgeId("");
  }

  return (
    <div className="module-flow">
      {editable && <div className="module-toolbar flow-toolbar">
        <button type="button" className="button" onClick={addActivity} disabled={graph.nodes.length >= 60}><Plus size={16} /> Add activity</button>
        {!!graph.nodes.length && <label className="flow-select">Activity <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setSelectedEdgeId(""); setTarget(""); }}>
          <option value="">Select an activity</option>
          {graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.data.label || "Untitled activity"}</option>)}
        </select></label>}
        {selectedEdgeId && <button type="button" className="button module-danger" onClick={removeConnection}><Trash2 size={15} /> Remove connection</button>}
      </div>}
      <div className="flow-surface" style={{ height }} aria-label={label}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={updateNodes}
          onEdgesChange={updateEdges}
          onConnect={editable ? ({ source, target }) => connect(source, target) : undefined}
          onNodeClick={(_, node) => { setSelectedId(node.id); setSelectedEdgeId(""); setTarget(""); }}
          onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedId(""); }}
          onPaneClick={() => { setSelectedId(""); setSelectedEdgeId(""); }}
          nodesDraggable={editable}
          nodesConnectable={editable}
          nodeExtent={nodeBounds}
          deleteKeyCode={null}
          fitView
          minZoom={0.25}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {!graph.nodes.length && <div className="flow-empty"><GitBranch size={25} aria-hidden="true" /><strong>Start with an activity</strong><span>Map a part of your music-making process here.</span></div>}
      </div>
      {selected && (editable ? <div className="flow-inspector">
        <label className="form-field">Activity name<input value={selected.data.label} maxLength={100} onChange={(event) => updateSelected({ label: event.target.value })} /></label>
        <label className="form-field">Role of AI<select value={selected.data.preference} onChange={(event) => updateSelected({ preference: event.target.value as WorkflowPreference })}>
          {Object.entries(preferences).map(([value, title]) => <option value={value} key={value}>{title}</option>)}
        </select></label>
        <label className="form-field flow-notes">Notes<textarea value={selected.data.notes || ""} rows={2} maxLength={1000} onChange={(event) => updateSelected({ notes: event.target.value })} placeholder="Why does this level of AI involvement suit this step?" /></label>
        <div className="flow-inspector-actions">
          {graph.nodes.length > 1 && <div className="flow-connect">
            <label className="flow-select">Connect to<select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Select an activity</option>
              {graph.nodes.filter((node) => node.id !== selected.id && !graph.edges.some((edge) => edge.source === selected.id && edge.target === node.id)).map((node) => <option key={node.id} value={node.id}>{node.data.label}</option>)}
            </select></label>
            <button className="button" type="button" disabled={!target || graph.edges.length >= 120} onClick={() => connect(selected.id, target)}><Link2 size={16} /> Connect</button>
          </div>}
          <button className="button module-danger" type="button" onClick={removeActivity}><Trash2 size={16} /> Remove activity</button>
        </div>
      </div> : selected.data.notes && <div className="flow-read-notes"><strong>{selected.data.label}</strong><p>{selected.data.notes}</p></div>)}
    </div>
  );
}

async function workflowPng(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    const scale = Math.min(3, 4600 / Math.max(image.width, image.height));
    canvas.width = Math.ceil(image.width * scale);
    canvas.height = Math.ceil(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable in this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadWorkflow(graph: WorkflowGraph, title: string, kind: "svg" | "png") {
  const { svg } = workflowSvg(title, graph);
  const source = kind === "svg" ? URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" })) : await workflowPng(svg);
  const anchor = document.createElement("a");
  anchor.href = source;
  anchor.download = `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "creative-workflow"}.${kind}`;
  anchor.click();
  if (kind === "svg") window.setTimeout(() => URL.revokeObjectURL(source), 1000);
}

export function WorkflowDownloads({ graph, title, onError }: { graph: WorkflowGraph; title: string; onError: (message: string) => void }) {
  function run(kind: "svg" | "png") {
    void downloadWorkflow(graph, title, kind).catch((error: unknown) => onError(error instanceof Error ? error.message : "The diagram could not be exported."));
  }
  return <div className="module-toolbar"><button type="button" className="button" disabled={!graph.nodes.length} onClick={() => run("svg")}><Download size={15} /> SVG</button><button type="button" className="button" disabled={!graph.nodes.length} onClick={() => run("png")}><Download size={15} /> PNG</button></div>;
}
