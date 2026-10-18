const { t } = require('../i18n');

// A tab's most urgent badge can be an error while another conversation is still working.
// Stopping must consider every busy conversation, including those from another provider.
function sessionRisks(conversations) {
  const seen = new Set();
  return conversations.flatMap(({ agent = 'claude', state }) => {
    if (state !== 'working' && state !== 'waiting') return [];
    const key = `${agent}:${state}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const name = agent === 'codex' ? 'Codex' : 'Claude';
    return [state === 'working'
      ? t('{agent} is working. The turn in progress will be interrupted.', { agent: name })
      : t('{agent} is waiting for approval. The turn in progress will be interrupted.', { agent: name })];
  });
}

module.exports = { sessionRisks };
