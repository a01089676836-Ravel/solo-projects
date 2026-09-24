import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = resolve(ROOT, 'agent-skills', 'manifest.json');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

function validateManifest(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.skills) || !value.skills.length)
    throw new Error('Invalid Agent skill manifest');
  const ids = new Set();
  for (const skill of value.skills) {
    for (const field of ['id', 'version', 'purpose', 'prompt']) {
      if (typeof skill[field] !== 'string' || !skill[field].trim())
        throw new Error(`Invalid Agent skill field: ${field}`);
    }
    if (ids.has(skill.id)) throw new Error(`Duplicate Agent skill: ${skill.id}`);
    ids.add(skill.id);
    if (!Array.isArray(skill.requiredInputs) || !Array.isArray(skill.forbiddenActions))
      throw new Error(`Invalid Agent skill arrays: ${skill.id}`);
  }
  return true;
}

validateManifest(manifest);

const skillsById = new Map(manifest.skills.map(skill => [skill.id, Object.freeze({
  ...skill,
  requiredInputs: Object.freeze([...skill.requiredInputs]),
  forbiddenActions: Object.freeze([...skill.forbiddenActions])
})]));

export const AGENT_SKILL_MANIFEST = Object.freeze([...skillsById.values()]);

export function getAgentSkillManifest() {
  return AGENT_SKILL_MANIFEST.map(skill => ({
    id: skill.id,
    version: skill.version,
    purpose: skill.purpose,
    requiredInputs: [...skill.requiredInputs],
    forbiddenActions: [...skill.forbiddenActions]
  }));
}

export function selectAgentSkills(event) {
  if (!event || typeof event !== 'object') throw new Error('Event is required to select skills');
  const ids = event.state === 'NORMAL'
    ? ['verification-first', 'grounding-gate']
    : ['verification-first', 'grounding-gate', 'safe-escalation', 'recovery-verification'];
  return ids.map(id => skillsById.get(id));
}

export function buildSkillContext(event) {
  return selectAgentSkills(event).map(skill => ({
    id: skill.id,
    version: skill.version,
    purpose: skill.purpose,
    prompt: skill.prompt
  }));
}

export function validateAgentSkillFiles() {
  return AGENT_SKILL_MANIFEST.map(skill => {
    const path = resolve(ROOT, 'agent-skills', skill.id, 'SKILL.md');
    const markdown = readFileSync(path, 'utf8');
    if (!markdown.includes(`# ${skill.id}`)) throw new Error(`Skill document heading mismatch: ${skill.id}`);
    return { id: skill.id, path, bytes: Buffer.byteLength(markdown, 'utf8') };
  });
}
