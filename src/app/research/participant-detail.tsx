'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Clock3, FileImage, UserRound, Workflow } from 'lucide-react';
import Pictorial from './pictorial';
import {
  dateTime, decisionLabels, modeLabels, outputLabels, researchRequest,
  type ParticipantDataset, type ParticipantSummary, type ResearchConfig,
} from './research-client';

type Artefact = ParticipantDataset['artefacts'][number];
type DetailTab = 'episodes' | 'diary' | 'activities';

const diaryLabels: Record<string, string> = {
  goal: 'What were you trying to accomplish?',
  usedAI: 'Did you use AI during this activity?',
  why: 'Why did you use or choose not to use AI?',
  changes: 'What did you keep, modify or reject?',
  intention: 'Did the resulting work reflect your creative intentions?',
  differently: 'What would you want the AI or creative environment to do differently?',
};

function rows(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
}

function plainValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function RevisionTree({ artefacts, selected, onSelect }: {
  artefacts: Artefact[]; selected: string; onSelect: (id: string) => void;
}) {
  const grouped = new Map<string | null, Artefact[]>();
  const ids = new Set(artefacts.map(item => item.id));
  for (const item of artefacts) {
    const parent = item.parentId && ids.has(item.parentId) ? item.parentId : null;
    grouped.set(parent, [...(grouped.get(parent) ?? []), item]);
  }
  function branch(parent: string | null, seen: Set<string>): ReactNode {
    const children = (grouped.get(parent) ?? []).filter(item => !seen.has(item.id));
    if (children.length === 0) return null;
    return <ul className="research-revisions">
      {children.map(item => <li key={item.id}>
        <button type="button" aria-pressed={selected === item.id} onClick={() => onSelect(item.id)}>
          <strong>{item.title}</strong>
          <span>{item.backend} · {outputLabels[item.outputType] ?? item.outputType} · {item.decision ? decisionLabels[item.decision] ?? item.decision : item.status}</span>
        </button>
        {branch(item.id, new Set([...seen, item.id]))}
      </li>)}
    </ul>;
  }
  return branch(null, new Set());
}

function ArtefactDetail({ artefact, dataset, pseudonym }: { artefact: Artefact; dataset: ParticipantDataset; pseudonym: string }) {
  const [pictorial, setPictorial] = useState(false);
  const annotations = dataset.annotations.filter(item => item.artefactId === artefact.id);
  const graph = artefact.workflow as { nodes?: { id: string; data: { label: string; preference?: string; notes?: string } }[]; edges?: { id: string; source: string; target: string; label?: string }[] } | null;
  const nodes = new Map(graph?.nodes?.map(node => [node.id, node.data.label]) ?? []);
  return <>
    <section className="research-card research-inset">
      <div className="research-section-head">
        <div><h3>{artefact.title}</h3><p>{dateTime(artefact.createdAt)} · {modeLabels[artefact.mode] ?? artefact.mode} · {artefact.backend}</p></div>
        <span className="research-pill">{artefact.backend === 'WIZARD' && artefact.origin === 'human' ? 'Researcher response' : artefact.origin === 'human' ? 'Human contribution' : 'AI contribution'}</span>
      </div>
      <dl className="research-record">
        <dt>Submitted prompt · {artefact.promptSource}</dt><dd className="research-pre">{artefact.prompt}</dd>
        <dt>Output</dt><dd className="research-pre">{artefact.text || artefact.status}</dd>
        {artefact.decision && <><dt>Decision</dt><dd>{decisionLabels[artefact.decision] ?? artefact.decision}</dd></>}
        {artefact.reflection && <><dt>Reflection</dt><dd className="research-pre">{artefact.reflection}</dd></>}
      </dl>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {artefact.imageUrl && <img className="research-artefact-image" src={artefact.imageUrl} alt={artefact.title} />}
      {graph?.nodes?.length ? <details className="research-disclosure">
        <summary>Workflow nodes and connections</summary>
        <ul className="research-list">{graph.nodes.map(node => <li key={node.id}><strong>{node.data.label}</strong><span>{node.data.preference}</span>{node.data.notes && <span>{node.data.notes}</span>}</li>)}</ul>
        {graph.edges?.length ? <ul className="research-list">{graph.edges.map(edge => <li key={edge.id}>{nodes.get(edge.source) ?? edge.source} to {nodes.get(edge.target) ?? edge.target} {edge.label && `· ${edge.label}`}</li>)}</ul> : null}
      </details> : null}
      {annotations.length > 0 && <div className="research-stack"><h4>Participant annotations</h4>{annotations.map(item => <blockquote className="research-pre" key={item.id}>{item.text}<footer>{dateTime(item.createdAt)}</footer></blockquote>)}</div>}
      <details className="research-disclosure">
        <summary>Generation provenance</summary>
        <dl className="research-record">
          <dt>Artefact ID</dt><dd><code>{artefact.id}</code></dd>
          {artefact.parentId && <><dt>Parent ID</dt><dd><code>{artefact.parentId}</code></dd></>}
          {artefact.model && <><dt>Model</dt><dd>{artefact.model}</dd></>}
          {artefact.systemPrompt && <><dt>Effective system prompt</dt><dd className="research-pre">{artefact.systemPrompt}</dd></>}
          {artefact.imagePrompt && <><dt>Effective image prompt</dt><dd className="research-pre">{artefact.imagePrompt}</dd></>}
          <dt>Parameters</dt><dd><pre>{JSON.stringify(artefact.parameters, null, 2)}</pre></dd>
        </dl>
      </details>
      {artefact.status === 'completed' && <button type="button" className="research-button" aria-expanded={pictorial} onClick={() => setPictorial(value => !value)}><FileImage aria-hidden="true" size={16} /> {pictorial ? 'Close pictorial editor' : 'Prepare pictorial export'}</button>}
    </section>
    {pictorial && <Pictorial dataset={dataset} initialId={artefact.id} pseudonym={pseudonym} />}
  </>;
}

function DiaryRecords({ dataset }: { dataset: ParticipantDataset }) {
  if (!dataset.diary.length) return <p>Diary entries will appear after the participant submits them.</p>;
  return <div className="research-stack">
    {[...dataset.diary].reverse().map(entry => {
      const upload = dataset.uploads.find(item => item.id === entry.attachmentId);
      return <section className="research-card research-inset" key={entry.id}>
        <h3>{dateTime(entry.createdAt)}</h3>
        {entry.artefactId && <p>Artefact <code>{entry.artefactId}</code></p>}
        <dl className="research-record">{rows(entry.answers).map(([key, value]) => (
          <div key={key}><dt>{diaryLabels[key] ?? key}</dt><dd className="research-pre">{plainValue(value)}</dd></div>
        ))}</dl>
        {upload && <figure className="research-upload">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="research-artefact-image" src={upload.dataUrl} alt={upload.name} />
          <figcaption>{upload.name}</figcaption>
        </figure>}
      </section>;
    })}
  </div>;
}

function ActivityRecords({ dataset, config }: { dataset: ParticipantDataset; config: ResearchConfig }) {
  const [eventType, setEventType] = useState('all');
  const eventTypes = [...new Set(dataset.events.map(item => item.type))].sort();
  const pending = config.questionnaires.filter(instrument => instrument.items.length > 0
    && !dataset.questionnaires.some(response => response.instrumentId === instrument.id && response.version === instrument.version));
  return <div className="research-stack">
    <section className="research-card research-inset">
      <h3>Questionnaire responses</h3>
      {pending.length > 0 && <p>Pending {pending.map(item => item.name).join(', ')}</p>}
      {dataset.questionnaires.length === 0 && <p>Questionnaire submissions will appear here.</p>}
      {[...dataset.questionnaires].reverse().map(response => {
        const instrument = config.questionnaires.find(item => item.id === response.instrumentId && item.version === response.version);
        return <details className="research-disclosure" key={response.id}>
          <summary>{instrument?.name ?? response.instrumentId} · {response.version} · {response.timing} · {dateTime(response.createdAt)}</summary>
          {response.activity && <p>Activity {response.activity}</p>}
          <dl className="research-record">{rows(response.responses).map(([id, value]) => <div key={id}><dt>{instrument?.items.find(item => item.id === id)?.label ?? id}</dt><dd className="research-pre">{plainValue(value)}</dd></div>)}</dl>
        </details>;
      })}
    </section>
    <section className="research-card research-inset">
      <h3>Workflow snapshots and Future Studio</h3>
      {dataset.workflows.length === 0 && dataset.futureProposals.length === 0 && <p>Saved workflows and Future Studio proposals will appear here.</p>}
      {[...dataset.workflows].reverse().map(snapshot => <details className="research-disclosure" key={snapshot.id}>
        <summary>{snapshot.title} · {dateTime(snapshot.createdAt)}</summary>
        <pre>{JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges }, null, 2)}</pre>
      </details>)}
      {dataset.futureProposals.map(proposal => <details className="research-disclosure" key={proposal.id}>
        <summary>Future Studio · {proposal.finalized ? 'Final proposal' : 'Draft'}</summary>
        <dl className="research-record"><dt>Environment</dt><dd className="research-pre">{proposal.description}</dd><dt>Acceptable AI behaviours</dt><dd className="research-pre">{proposal.acceptable}</dd><dt>Unacceptable AI behaviours</dt><dd className="research-pre">{proposal.unacceptable}</dd></dl>
      </details>)}
    </section>
    <section className="research-card research-inset">
      <div className="research-section-head">
        <div><h3>Interaction log</h3><p>Server timestamps stored in UTC.</p></div>
        <label>Event type<select value={eventType} onChange={event => setEventType(event.target.value)}><option value="all">All events</option>{eventTypes.map(type => <option key={type}>{type}</option>)}</select></label>
      </div>
      {[...dataset.events].reverse().filter(item => eventType === 'all' || item.type === eventType).map(event => (
        <details className="research-disclosure" key={event.id}>
          <summary><span>{event.type}</span> <time dateTime={event.createdAt}>{event.createdAt}</time></summary>
          <dl className="research-record"><dt>Event ID</dt><dd>{event.id}</dd><dt>Session</dt><dd>{event.sessionId}</dd>{event.artefactId && <><dt>Artefact ID</dt><dd>{event.artefactId}</dd></>}</dl>
          <pre>{JSON.stringify(event.data, null, 2)}</pre>
        </details>
      ))}
    </section>
  </div>;
}

function Withdraw({ id, publicId, onDeleted }: { id: string; publicId: string; onDeleted: () => Promise<void> }) {
  const [confirmation, setConfirmation] = useState('');
  const [protocolConfirmed, setProtocolConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await researchRequest('deleteParticipant', { id, confirmation, protocolConfirmed });
      await onDeleted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete participant data.'); }
    finally { setPending(false); }
  }
  return <details className="research-disclosure research-withdraw">
    <summary>Withdraw participant and delete records</summary>
    <p>This permanently deletes CoStudio records for this participant and disables their study code. Apply the approved protocol to any existing exports or copies.</p>
    <form className="research-stack" onSubmit={remove}>
      <label>Type {publicId} to confirm<input autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      <label className="research-check"><input type="checkbox" checked={protocolConfirmed} onChange={event => setProtocolConfirmed(event.target.checked)} /> I confirmed this action against the approved withdrawal procedure.</label>
      {error && <p className="research-error" role="alert">{error}</p>}
      <button type="submit" className="research-button danger" disabled={pending || confirmation !== publicId || !protocolConfirmed}>{pending ? 'Deleting participant…' : 'Permanently delete participant'}</button>
    </form>
  </details>;
}

export default function ParticipantDetail({ dataset, profile, config, exportLinks, pseudonym, onDeleted }: {
  dataset: ParticipantDataset; profile: ParticipantSummary; config: ResearchConfig;
  exportLinks: ReactNode; pseudonym: string; onDeleted: () => Promise<void>;
}) {
  const [tab, setTab] = useState<DetailTab>('episodes');
  const [selected, setSelected] = useState(dataset.artefacts.filter(item => item.parentId === null).at(-1)?.id ?? '');
  const participant = dataset.participants[0];
  const artefact = dataset.artefacts.find(item => item.id === selected);
  const pendingQuestionnaires = config.questionnaires.filter(item => item.items.length > 0
    && !dataset.questionnaires.some(response => response.instrumentId === item.id && response.version === item.version)).length;
  return (
    <div className="research-detail">
      <section className="research-card">
        <div className="research-section-head">
          <div><h2><UserRound aria-hidden="true" size={19} /> {profile.publicId}</h2><p>{profile.role ?? 'Onboarding'} · Enrolled {dateTime(profile.createdAt)}</p></div>
          {exportLinks}
        </div>
        <div className="research-participant-status">
          <span className="research-pill">{profile.consentAt ? 'Consent recorded' : 'Consent pending'}</span>
          <span className="research-pill"><Clock3 size={14} aria-hidden="true" /> {profile._count.sessions} sessions</span>
          <span className="research-pill"><Workflow size={14} aria-hidden="true" /> {profile._count.workflows} workflow snapshots</span>
          <span className="research-pill">{profile.future?.finalized ? 'Future Studio saved' : 'Future Studio pending'}</span>
          <span className="research-pill">{pendingQuestionnaires} questionnaires pending</span>
        </div>
        {participant && <details className="research-disclosure">
          <summary>Onboarding and study selections</summary>
          <dl className="research-record">
            {[
              ['Consent version', participant.consentVersion],
              ['Primary role', participant.role],
              ['Additional roles', Array.isArray(participant.roles) ? participant.roles.join(', ') : null],
              ['Active role', participant.activeRole],
              ['Creative stage', participant.stage],
              ['Collaboration mode', modeLabels[participant.mode] ?? participant.mode],
              ['Years of musical experience', participant.experience],
              ['Genres', participant.genres],
              ['Status', participant.status],
              ['Creative tools', participant.tools],
              ['Prior generative AI experience', participant.aiExperience],
            ].map(([label, value]) => value !== null && value !== '' && <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </details>}
      </section>
      <nav className="research-tabs research-inner-tabs" aria-label="Participant record sections">
        <button type="button" aria-pressed={tab === 'episodes'} onClick={() => setTab('episodes')}>Negotiation episodes <span>{dataset.artefacts.length}</span></button>
        <button type="button" aria-pressed={tab === 'diary'} onClick={() => setTab('diary')}>Diary <span>{dataset.diary.length}</span></button>
        <button type="button" aria-pressed={tab === 'activities'} onClick={() => setTab('activities')}>Study activity <span>{dataset.events.length}</span></button>
      </nav>
      {tab === 'episodes' && (artefact
        ? <div className="research-stack">
          <section className="research-card research-inset"><h3>Artefact revision tree</h3><RevisionTree artefacts={dataset.artefacts} selected={selected} onSelect={setSelected} /></section>
          <ArtefactDetail key={artefact.id} artefact={artefact} dataset={dataset} pseudonym={pseudonym} />
        </div>
        : <section className="research-card"><p>Artefacts and revisions will appear here after the participant creates them.</p></section>)}
      {tab === 'diary' && <DiaryRecords dataset={dataset} />}
      {tab === 'activities' && <ActivityRecords dataset={dataset} config={config} />}
      <Withdraw id={profile.id} publicId={profile.publicId} onDeleted={onDeleted} />
    </div>
  );
}
