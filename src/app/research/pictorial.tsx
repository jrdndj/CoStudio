'use client';

import { useState } from 'react';
import { ImageDown, LockKeyhole } from 'lucide-react';
import type { WorkflowGraph } from '@/lib/study-types';
import { workflowSvg } from '@/lib/workflow-svg';
import type { ParticipantDataset } from './research-client';
import { decisionLabels, outputLabels } from './research-client';

type Artefact = ParticipantDataset['artefacts'][number];
type Frame = { label: string; text: string; image?: string | null; includeImage?: boolean };

function describeOutput(artefact: Artefact) {
  const text = [artefact.title, artefact.text].filter(Boolean);
  const graph = artefact.workflow as { nodes?: { id: string; data: { label: string; notes?: string } }[]; edges?: { source: string; target: string }[] } | null;
  if (graph?.nodes?.length) {
    const labels = new Map(graph.nodes.map(node => [node.id, node.data.label]));
    text.push(graph.nodes.map(node => [node.data.label, node.data.notes].filter(Boolean).join(' · ')).join('\n'));
    if (graph.edges?.length) {
      text.push(graph.edges.map(edge => `${labels.get(edge.source) ?? edge.source} → ${labels.get(edge.target) ?? edge.target}`).join('\n'));
    }
  }
  return text.join('\n\n');
}

function displayImage(artefact: Artefact) {
  if (artefact.imageUrl) return artefact.imageUrl;
  const graph = artefact.workflow as unknown as WorkflowGraph | null;
  if (!graph || !graph.nodes.length) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(workflowSvg(artefact.title, graph).svg)}`;
}

function episodeFrames(dataset: ParticipantDataset, initial: Artefact, revision: Artefact | undefined): Frame[] {
  const annotations = dataset.annotations.filter(item => item.artefactId === initial.id);
  const decisionEvents = dataset.events.filter(item => item.artefactId === initial.id
    && ['ARTEFACT_ACCEPTED', 'ARTEFACT_ADAPTED', 'ARTEFACT_REJECTED', 'ALTERNATIVES_REQUESTED', 'ARTEFACT_SAVED'].includes(item.type));
  const decisions = decisionEvents.map(event => {
    const payload = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {};
    const label = typeof payload.decision === 'string' ? decisionLabels[payload.decision] : event.type.replace(/^ARTEFACT_/, '').replaceAll('_', ' ').toLowerCase();
    return [label, typeof payload.reflection === 'string' ? payload.reflection : ''].filter(Boolean).join(' · ');
  });
  const negotiation = [
    ...(decisions.length ? decisions : [initial.decision ? decisionLabels[initial.decision] : '', initial.reflection || '']),
    ...annotations.map(item => item.text),
  ].filter(Boolean).join('\n\n');
  const finalNotes = revision
    ? [revision.reflection, ...dataset.annotations.filter(item => item.artefactId === revision.id).map(item => item.text)].filter(Boolean).join('\n\n')
    : initial.reflection || '';
  return [
    { label: 'Participant prompt', text: initial.prompt },
    { label: `Initial output · ${initial.backend}`, text: describeOutput(initial), image: displayImage(initial) },
    { label: 'Participant annotation or decision', text: negotiation },
    { label: 'Revised prompt', text: revision?.prompt ?? '' },
    { label: revision ? `Revised output · ${revision.backend}` : 'Revised output', text: revision ? describeOutput(revision) : '', image: revision ? displayImage(revision) : null },
    { label: 'Final reflection', text: finalNotes },
  ];
}

function fitLines(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && context.measureText(`${line} ${word}`).width > width) {
        lines.push(line);
        line = '';
      }
      if (context.measureText(word).width > width) {
        for (const character of word) {
          if (context.measureText(line + character).width > width) {
            lines.push(line);
            line = '';
          }
          line += character;
        }
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function loadImage(source: string) {
  const image = new Image();
  image.src = source;
  return image.decode().then(() => image);
}

function toPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('The image could not be encoded.'));
  }, 'image/png'));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportPictorial(frames: Frame[], pseudonym: string, caption: string) {
  const width = 1060;
  const height = 1400;
  const margin = 64;
  const lineHeight = 31;
  const content = width - margin * 2;
  const bodyFont = '21px system-ui, sans-serif';
  const pages: HTMLCanvasElement[] = [];
  let cursor = margin;
  const startPage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Pictorial export requires canvas support.');
    context.scale(2, 2);
    context.textBaseline = 'top';
    context.fillStyle = '#f4f4f5';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#191923';
    context.font = '700 38px system-ui, sans-serif';
    context.fillText('CoStudio creative negotiation', margin, margin, content);
    context.font = '600 21px system-ui, sans-serif';
    context.fillStyle = '#555568';
    context.fillText(pseudonym, margin, margin + 55, content);
    cursor = margin + 92;
    if (!pages.length && caption.trim()) {
      context.font = bodyFont;
      for (const line of fitLines(context, caption.trim(), content)) {
        context.fillText(line, margin, cursor, content);
        cursor += lineHeight;
      }
    }
    cursor += 16;
    pages.push(canvas);
    context.fillStyle = '#555568';
    context.font = '16px system-ui, sans-serif';
    context.fillText(`Page ${pages.length}`, margin, height - 42);
    return context;
  };
  let context = startPage();
  for (const frame of frames) {
    if (cursor + 120 > height - margin) context = startPage();
    const heading = (continued = false) => {
      context.fillStyle = '#4a3b76';
      context.font = '700 24px system-ui, sans-serif';
      context.fillText(continued ? `${frame.label} (continued)` : frame.label, margin, cursor, content);
      cursor += 39;
      context.fillStyle = '#191923';
      context.font = bodyFont;
    };
    heading();
    const lines = fitLines(context, frame.text.trim() || '—', content);
    for (const line of lines) {
      if (cursor + lineHeight > height - margin) {
        context = startPage();
        heading(true);
      }
      context.fillText(line, margin, cursor, content);
      cursor += lineHeight;
    }
    if (frame.image && frame.includeImage) {
      const image = await loadImage(frame.image);
      const scale = Math.min(content / image.width, 645 / image.height);
      const imageWidth = image.width * scale;
      const imageHeight = image.height * scale;
      if (cursor + imageHeight + 22 > height - margin) {
        context = startPage();
        heading(true);
      }
      context.drawImage(image, margin, cursor + 10, imageWidth, imageHeight);
      cursor += imageHeight + 24;
    }
    cursor += 30;
  }
  const images = await Promise.all(pages.map(toPng));
  if (images.length === 1) {
    downloadBlob(images[0], 'costudio-pictorial.png');
  } else {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const [index, image] of images.entries()) {
      zip.file(`costudio-pictorial-${String(index + 1).padStart(2, '0')}.png`, await image.arrayBuffer());
    }
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'costudio-pictorial.zip');
  }
}

export default function Pictorial({ dataset, initialId, pseudonym }: {
  dataset: ParticipantDataset; initialId: string; pseudonym: string;
}) {
  const initial = dataset.artefacts.find(artefact => artefact.id === initialId);
  function isDescendant(artefact: Artefact) {
    let parent = artefact.parentId;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      if (parent === initialId) return true;
      visited.add(parent);
      parent = dataset.artefacts.find(item => item.id === parent)?.parentId ?? null;
    }
    return false;
  }
  const revisions = dataset.artefacts.filter(artefact => artefact.status === 'completed' && isDescendant(artefact));
  const [revisionId, setRevisionId] = useState(revisions.at(-1)?.id ?? '');
  const [frames, setFrames] = useState<Frame[]>(() => initial ? episodeFrames(dataset, initial, revisions.at(-1)) : []);
  const [label, setLabel] = useState(pseudonym);
  const [caption, setCaption] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!initial) return null;
  const clearReview = () => { setReviewed(false); setPermission(false); };
  const changeFrame = (index: number, changes: Partial<Frame>) => {
    setFrames(current => current.map((frame, key) => key === index ? { ...frame, ...changes } : frame));
    clearReview();
  };
  const download = async () => {
    setBusy(true);
    setError('');
    try { await exportPictorial(frames, label.trim(), caption); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Export failed.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="research-card research-pictorial">
      <div className="research-section-head">
        <div><h3>Pictorial export</h3><p>Prepare a six-part sequence for a publication or research presentation.</p></div>
        <LockKeyhole aria-hidden="true" size={19} />
      </div>
      <div className="research-fields">
        <label>Participant pseudonym<input maxLength={40} value={label} onChange={event => { setLabel(event.target.value); clearReview(); }} /></label>
        <label>Revised version<select value={revisionId} onChange={event => {
          const id = event.target.value;
          setRevisionId(id);
          setFrames(episodeFrames(dataset, initial, revisions.find(artefact => artefact.id === id)));
          clearReview();
        }}>
          <option value="">No revised version</option>
          {revisions.map(artefact => <option key={artefact.id} value={artefact.id}>{artefact.title} · {outputLabels[artefact.outputType] ?? artefact.outputType} · {artefact.id.slice(-7)}</option>)}
        </select></label>
        <label className="research-wide">Caption<textarea maxLength={400} rows={2} value={caption} onChange={event => { setCaption(event.target.value); clearReview(); }} /></label>
      </div>
      <div className="research-pictorial-frames">
        {frames.map((frame, index) => (
          <div className="research-pictorial-frame" key={frame.label}>
            <label>{frame.label}<textarea rows={3} value={frame.text} onChange={event => changeFrame(index, { text: event.target.value })} /></label>
            {frame.image && <>
              <label className="research-check"><input type="checkbox" checked={Boolean(frame.includeImage)} onChange={event => changeFrame(index, { includeImage: event.target.checked })} /> Include image in the export</label>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {frame.includeImage && <img src={frame.image} alt={frame.label} />}
            </>}
          </div>
        ))}
      </div>
      <fieldset className="research-review">
        <legend>Publication checks</legend>
        <label className="research-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed the pseudonym, text and images and applied the required redactions.</label>
        <label className="research-check"><input type="checkbox" checked={permission} onChange={event => setPermission(event.target.checked)} /> Publication permission is recorded under the approved study protocol.</label>
      </fieldset>
      {error && <p className="research-error" role="alert">{error}</p>}
      <button className="research-button primary" type="button" disabled={!reviewed || !permission || !label.trim() || busy} onClick={download}><ImageDown size={16} aria-hidden="true" /> {busy ? 'Preparing images…' : 'Download high-resolution pictorial'}</button>
    </section>
  );
}
