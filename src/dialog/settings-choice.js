// Agent selection in the settings form, separate from the page so the invariant can be tested.
// The page loads this as a plain script; the tests require it.
/**
 * @typedef {{ checked: boolean, value: string }} AgentInput
 */
/**
 * @param {ArrayLike<AgentInput>} inputs
 * @param {AgentInput} [required]
 * @returns {string[]}
 */
function readAgentChoices(inputs, required) {
  const agents = Array.from(inputs).filter((input) => input.checked).map((input) => input.value);
  if (agents.length || !required) return agents;
  required.checked = true;
  return [required.value];
}

if (typeof module === 'object') module.exports = { readAgentChoices };
