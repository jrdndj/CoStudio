'use client';

import { Copy, FileUp, KeyRound, Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MODES, ROLES, STAGES } from '@/lib/study-types';
import { dateTime, modeLabels, outputLabels, researchRequest, type ResearchConfig, type ResearchOverview } from './research-client';

function useResearchForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function run(operation: () => Promise<void>) {
    setPending(true);
    setError('');
    setMessage('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The operation failed.'); }
    finally { setPending(false); }
  }
  return { pending, error, setError, message, setMessage, run };
}

function Feedback({ error, message }: { error: string; message: string }) {
  return <>{error && <p className="research-error" role="alert">{error}</p>}{message && <p className="research-notice" role="status">{message}</p>}</>;
}

export function CodeManager({ codes, onChange }: { codes: ResearchOverview['codes']; onChange: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [days, setDays] = useState('');
  const [issued, setIssued] = useState('');
  const form = useResearchForm();

  function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.run(async () => {
      const result = await researchRequest<{ code: string }>('createCode', { code, expiresInDays: days ? Number(days) : null });
      setIssued(result.code);
      setCode('');
      await onChange();
    });
  }

  return (
    <section className="research-card">
      <div className="research-section-head"><h2>Study codes</h2><KeyRound aria-hidden="true" size={18} /></div>
      <form className="research-stack" onSubmit={issue}>
        <label>Custom code, optional<input value={code} onChange={event => setCode(event.target.value)} placeholder="Generate a secure code" maxLength={64} autoComplete="off" /></label>
        <label>Days to expiration, optional<input type="number" min={1} max={365} value={days} onChange={event => setDays(event.target.value)} placeholder="No expiry" /></label>
        <button className="research-button primary" type="submit" disabled={form.pending}>{form.pending ? 'Creating code…' : 'Create study code'}</button>
      </form>
      {issued && <div className="research-issued">
        <label>New study code<input value={issued} readOnly onFocus={event => event.target.select()} /></label>
        <button className="research-button compact" type="button" onClick={() => {
          void navigator.clipboard.writeText(issued).then(() => form.setMessage('Study code copied.')).catch(() => form.setError('Select the code and copy it from the field.'));
        }}><Copy size={14} aria-hidden="true" /> Copy code</button>
        <p>Copy this code now. CoStudio stores a one-way hash after creation.</p>
      </div>}
      <Feedback {...form} />
      {codes.length > 0 && <details className="research-disclosure">
        <summary>Issued codes <span>{codes.length}</span></summary>
        <ul className="research-list">
          {codes.map(item => <li key={item.id}>
            <strong>{item.participant?.publicId ?? (item.expiresAt && Date.parse(item.expiresAt) <= Date.now() ? 'Expired' : 'Available')}</strong>
            <span>{item.id.slice(-8)} · {dateTime(item.createdAt)}</span>
            {item.expiresAt && <span>Expires {dateTime(item.expiresAt)}</span>}
          </li>)}
        </ul>
      </details>}
    </section>
  );
}

export function ResearchSettings({ config, onChange }: { config: ResearchConfig; onChange: () => Promise<void> }) {
  const [consentText, setConsentText] = useState(config.consentText);
  const [consentVersion, setConsentVersion] = useState(config.consentVersion);
  const [allowedModes, setAllowedModes] = useState(config.allowedModes);
  const [suggestions, setSuggestions] = useState(config.suggestions);
  const [filterRole, setFilterRole] = useState<string>('all');
  const [questionnaireJson, setQuestionnaireJson] = useState(JSON.stringify(config.questionnaires, null, 2));
  const form = useResearchForm();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.run(async () => {
      let questionnaires;
      try { questionnaires = JSON.parse(questionnaireJson); }
      catch { throw new Error('Questionnaires must be valid JSON.'); }
      await researchRequest('saveConfig', {
        config: { consentText, consentVersion, allowedModes, suggestions, questionnaires },
        expectedConfigVersion: config.configVersion,
      });
      await onChange();
    });
  }

  return (
    <form className="research-settings" onSubmit={save}>
      <div className="research-section-head">
        <div><h2>Study configuration</h2><p>Configuration version <code>{config.configVersion}</code></p></div>
        <button className="research-button primary" type="submit" disabled={form.pending}><Save aria-hidden="true" size={16} />{form.pending ? 'Saving…' : 'Save configuration'}</button>
      </div>
      <Feedback {...form} />
      <div className="research-config-grid">
        <section className="research-card">
          <h3>Research information and consent</h3>
          <p>Paste the text approved for the study. Assign a new version when the text changes.</p>
          <div className="research-stack">
            <label>Consent version<input maxLength={100} value={consentVersion} required onChange={event => setConsentVersion(event.target.value)} /></label>
            <label>Researcher-approved content<textarea rows={8} maxLength={30000} value={consentText} required onChange={event => setConsentText(event.target.value)} /></label>
          </div>
        </section>
        <section className="research-card">
          <h3>Available collaboration modes</h3>
          <p>Participants can select any enabled mode.</p>
          {MODES.map(mode => <label className="research-check" key={mode}>
            <input type="checkbox" checked={allowedModes.includes(mode)} onChange={event => setAllowedModes(current => event.target.checked ? [...current, mode] : current.filter(item => item !== mode))} />
            {modeLabels[mode]}
          </label>)}
        </section>
      </div>
      <section className="research-card">
        <div className="research-section-head">
          <div><h3>Suggested prompts</h3><p>Edit the prompts shown for each musical role and creative stage.</p></div>
          <button className="research-button" type="button" onClick={() => {
            const role = ROLES.find(value => value === filterRole) ?? 'Composer';
            setSuggestions(current => [...current, { id: crypto.randomUUID(), role, stage: 'Initiate', text: '' }]);
          }}>Add prompt</button>
        </div>
        <label className="research-role-filter">Filter by role<select value={filterRole} onChange={event => setFilterRole(event.target.value)}><option value="all">All roles</option>{ROLES.map(role => <option key={role}>{role}</option>)}</select></label>
        <div className="research-suggestions">
          {suggestions.filter(suggestion => filterRole === 'all' || suggestion.role === filterRole).map(suggestion => {
            const edit = (update: Partial<ResearchConfig['suggestions'][number]>) => setSuggestions(current => current.map(row => row.id === suggestion.id ? { ...row, ...update } : row));
            return <div className="research-suggestion" key={suggestion.id}>
              <label>Role<select value={suggestion.role} onChange={event => edit({ role: event.target.value as typeof suggestion.role })}>{ROLES.map(role => <option key={role}>{role}</option>)}</select></label>
              <label>Stage<select value={suggestion.stage} onChange={event => edit({ stage: event.target.value as typeof suggestion.stage })}>{STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></label>
              <label>Prompt<textarea rows={2} maxLength={3000} required value={suggestion.text} onChange={event => edit({ text: event.target.value })} /></label>
              <button className="research-button ghost compact" type="button" onClick={() => setSuggestions(current => current.filter(row => row.id !== suggestion.id))} aria-label={`Remove prompt ${suggestion.text.slice(0, 45)}`}>Remove</button>
            </div>;
          })}
        </div>
      </section>
      <section className="research-card">
        <div className="research-section-head">
          <div><h3>Questionnaires</h3><p>Import approved instrument wording. Raw item responses retain their instrument version.</p></div>
          <label className="research-button research-file-button"><FileUp aria-hidden="true" size={16} /> Import JSON
            <input type="file" accept=".json,application/json" aria-label="Import questionnaire JSON" onChange={event => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 2_000_000) { form.setError('Questionnaire JSON must be under 2 MB.'); return; }
              void file.text().then(contents => {
                const imported = JSON.parse(contents);
                const questionnaires = Array.isArray(imported) ? imported : imported.questionnaires;
                if (!Array.isArray(questionnaires)) throw new Error('Expected an array of questionnaire definitions.');
                setQuestionnaireJson(JSON.stringify(questionnaires, null, 2));
                form.setError('');
                form.setMessage('Questionnaires loaded. Save the configuration to use them.');
              }).catch(cause => form.setError(cause instanceof Error ? cause.message : 'Could not read questionnaire JSON.'));
            }} />
          </label>
        </div>
        <details className="research-disclosure">
          <summary>Questionnaire JSON fields</summary>
          <p>Each instrument has <code>id</code>, <code>name</code>, <code>version</code>, <code>timing</code> and an <code>items</code> array. Timing is <code>activity</code>, <code>session</code> or <code>deployment</code>.</p>
          <p>Each item needs <code>id</code>, <code>label</code> and <code>type</code>. Supported types are <code>likert</code>, <code>slider</code>, <code>choice</code>, <code>pairwise</code> and <code>open</code>. Add <code>required</code>, <code>min</code>, <code>max</code>, <code>step</code> or <code>options</code> as needed.</p>
        </details>
        <label>Questionnaire configuration<textarea className="research-code-input" rows={14} value={questionnaireJson} onChange={event => setQuestionnaireJson(event.target.value)} spellCheck={false} /></label>
      </section>
    </form>
  );
}

function fileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image.'));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

function WizardItem({ item, onChange }: { item: ResearchOverview['wizard'][number]; onChange: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [graph, setGraph] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const form = useResearchForm();
  const workflow = item.outputType === 'workflow';
  const visual = ['storyboard', 'moodboard', 'concept'].includes(item.outputType);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.run(async () => {
      let graphData;
      if (workflow) {
        try { graphData = JSON.parse(graph); }
        catch { throw new Error('Workflow response must be valid JSON.'); }
      }
      if (visual && !image) throw new Error('Attach a raster image.');
      if (image && image.size > 8 * 1024 * 1024) throw new Error('Use an image under 8 MB.');
      await researchRequest('fulfillWizard', {
        id: item.id, title, text, workflow: graphData, image: image ? await fileDataUrl(image) : undefined,
      });
      await onChange();
    });
  }

  return <form className="research-card research-stack" onSubmit={submit}>
    <div className="research-section-head"><h3>{outputLabels[item.outputType] ?? item.outputType}</h3><span className="research-pill">{item.participant.publicId}</span></div>
    <div className="research-subtext">{modeLabels[item.mode] ?? item.mode} · {dateTime(item.createdAt)}</div>
    <blockquote className="research-pre">{item.prompt}</blockquote>
    <label>Response title<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={150} /></label>
    <label>Response text<textarea rows={5} value={text} onChange={event => setText(event.target.value)} required={item.outputType === 'text'} maxLength={25000} /></label>
    {workflow && <label>Workflow graph JSON<textarea rows={8} className="research-code-input" spellCheck={false} value={graph} onChange={event => setGraph(event.target.value)} required placeholder={'{"nodes":[{"id":"start","position":{"x":0,"y":0},"data":{"label":"Start","preference":"undecided"}}],"edges":[]}'} /></label>}
    {visual && <label>Response image<input accept="image/png,image/jpeg,image/webp" type="file" required onChange={event => setImage(event.target.files?.[0] ?? null)} /></label>}
    <Feedback {...form} />
    <button className="research-button primary" type="submit" disabled={form.pending}>{form.pending ? 'Submitting…' : 'Send researcher response'}</button>
  </form>;
}

export function WizardQueue({ queue, onChange }: { queue: ResearchOverview['wizard']; onChange: () => Promise<void> }) {
  return <div className="research-stack">
    <div className="research-section-head"><div><h2>Wizard queue</h2><p>Researcher responses are recorded with the WIZARD backend source.</p></div><button type="button" className="research-button ghost" onClick={onChange}>Refresh queue</button></div>
    {queue.length === 0 && <section className="research-card"><p>No generation requests are waiting.</p></section>}
    {queue.map(item => <WizardItem item={item} key={item.id} onChange={onChange} />)}
  </div>;
}
