const roles = ['Producer', 'Composer', 'Performer', 'Vocalist', 'Lyricist', 'Improviser', 'Other'];
const stages = ['Initiate', 'Explore', 'Develop', 'Refine', 'Prepare'];
const modes = ['guide', 'collaborate', 'lead', 'independent'];
const itemTypes = ['likert', 'slider', 'choice', 'pairwise', 'open'];
const timings = ['activity', 'session', 'deployment'];

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${name} must contain 1 to ${max} characters.`);
  }
  return value.trim();
}

function membership(value: unknown, options: string[], name: string) {
  if (typeof value !== 'string' || !options.includes(value)) {
    throw new Error(`${name} must be one of ${options.join(', ')}.`);
  }
  return value;
}

function list(value: unknown, max: number, name: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Error(`${name} must be an array of up to ${max} entries.`);
  }
  return value;
}

function requireUnique(values: string[], name: string) {
  if (new Set(values).size !== values.length) throw new Error(`${name} must be unique.`);
}

function number(value: unknown, name: string) {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    throw new Error(`${name} must be a finite number between -1,000,000 and 1,000,000.`);
  }
  return value;
}

export function parseResearchConfig(input: unknown) {
  const config = asRecord(input);
  const allowedModes = list(config.allowedModes, 4, 'Available modes').map(value => membership(value, modes, 'Mode'));
  if (allowedModes.length === 0) throw new Error('Enable at least one collaboration mode.');
  requireUnique(allowedModes, 'Modes');
  const suggestions = list(config.suggestions, 500, 'Suggested prompts').map(value => {
    const suggestion = asRecord(value);
    return {
      id: text(suggestion.id, 'Suggestion ID', 100),
      role: membership(suggestion.role, roles, 'Musical role'),
      stage: membership(suggestion.stage, stages, 'Creative stage'),
      text: text(suggestion.text, 'Suggested prompt', 3000),
    };
  });
  requireUnique(suggestions.map(value => value.id), 'Suggestion IDs');

  const questionnaires = list(config.questionnaires, 40, 'Questionnaires').map(value => {
    const instrument = asRecord(value);
    const items = list(instrument.items, 120, 'Questionnaire items').map(raw => {
      const item = asRecord(raw);
      const type = membership(item.type, itemTypes, 'Question type');
      const min = number(item.min, 'Minimum');
      const max = number(item.max, 'Maximum');
      const step = number(item.step, 'Step');
      if (step !== null && step <= 0) throw new Error('Question steps must be positive.');
      if (type === 'likert' || type === 'slider') {
        const minimum = min ?? 1;
        const maximum = max ?? 7;
        const interval = step ?? 1;
        if (minimum >= maximum) throw new Error('Minimum must be below maximum.');
        if (interval > maximum - minimum) throw new Error('Question scale steps must fit within the scale.');
        if (type === 'likert' && (![minimum, maximum, interval].every(Number.isInteger) || (maximum - minimum) / interval > 50)) {
          throw new Error('Likert endpoints and step must be integers with up to 51 choices.');
        }
      }
      const options = item.options === undefined ? [] : list(item.options, 51, 'Question choices').map(value => text(value, 'Choice', 1000));
      requireUnique(options, 'Question choices');
      if (type === 'pairwise' && options.length !== 2) throw new Error('Pairwise items require exactly two choices.');
      if (type === 'choice' && options.length < 2) throw new Error('Multiple choice items require at least two choices.');
      if (item.required !== undefined && typeof item.required !== 'boolean') throw new Error('Required must be a boolean.');
      return {
        id: text(item.id, 'Question ID', 100),
        type,
        label: text(item.label, 'Question wording', 5000),
        ...(item.required === undefined ? {} : { required: item.required }),
        ...(min === null ? {} : { min }),
        ...(max === null ? {} : { max }),
        ...(step === null ? {} : { step }),
        ...(options.length === 0 ? {} : { options }),
      };
    });
    requireUnique(items.map(item => item.id), 'Question item IDs');
    return {
      id: text(instrument.id, 'Instrument ID', 100),
      name: text(instrument.name, 'Instrument name'),
      timing: membership(instrument.timing, timings, 'Instrument timing'),
      version: text(instrument.version, 'Instrument version', 100),
      items,
    };
  });
  requireUnique(questionnaires.map(item => item.id), 'Instrument IDs');

  return {
    consentText: text(config.consentText, 'Consent content', 30000),
    consentVersion: text(config.consentVersion, 'Consent version', 100),
    allowedModes,
    suggestions,
    questionnaires,
  };
}
