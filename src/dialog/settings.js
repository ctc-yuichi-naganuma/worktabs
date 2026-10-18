// The settings dialog: agent choices that affect which provider Worktabs opens and which one
// suggests branch names.
const settingsEl = document.getElementById('settings');
const settingsSaveEl = /** @type {HTMLButtonElement} */ (document.getElementById('settings-save'));
const settingsCancelEl = /** @type {HTMLButtonElement} */ (document.getElementById('settings-cancel'));
const settingsDefaultAgentEl = /** @type {HTMLSelectElement} */ (document.getElementById('settings-default-agent'));
const settingsBranchAgentEl = /** @type {HTMLSelectElement} */ (document.getElementById('settings-branch-agent'));
const settingsCodexApprovalEl = /** @type {HTMLSelectElement} */ (document.getElementById('settings-codex-approval'));
const AGENT_LABELS = { claude: 'Claude Code', codex: 'Codex' };

let settingsDialog = null;

function agentInputs() {
  return /** @type {NodeListOf<HTMLInputElement>} */ (settingsEl.querySelectorAll('input[name="settings-agents"]'));
}

function option(value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function fillAgentSelect(select, agents, selected) {
  select.replaceChildren(...agents.map((agent) => option(agent, AGENT_LABELS[agent])));
  select.value = agents.includes(selected) ? selected : agents[0];
}

function fillBranchSelect(agents, selected) {
  settingsBranchAgentEl.replaceChildren(option('default', t('Same as the default agent')), ...agents.map((agent) => option(agent, AGENT_LABELS[agent])));
  settingsBranchAgentEl.value = selected === 'default' || agents.includes(selected) ? selected : 'default';
}

function updateSettingsChoices(required) {
  const inputs = agentInputs();
  const agents = readAgentChoices(inputs, required || inputs[0]);
  fillAgentSelect(settingsDefaultAgentEl, agents, settingsDefaultAgentEl.value);
  fillBranchSelect(agents, settingsBranchAgentEl.value);
}

function showSettingsForm(dialog) {
  settingsDialog = dialog;
  const inputs = agentInputs();
  const enabled = new Set(dialog.agents);
  for (const input of inputs) input.checked = enabled.has(input.value);
  const agents = readAgentChoices(inputs, inputs[0]);
  fillAgentSelect(settingsDefaultAgentEl, agents, dialog.defaultAgent);
  fillBranchSelect(agents, dialog.branchAgent);
  settingsCodexApprovalEl.value = dialog.codexApprovalMode || 'auto-review';
  settingsEl.hidden = false;
  showSettingsSection(dialog.section || 'general');
}

function hideSettingsForm() {
  settingsDialog = null;
  settingsEl.hidden = true;
  hideExtensionManager();
}

function showSettingsSection(section) {
  const extensions = section === 'extensions';
  document.getElementById('settings-general').hidden = extensions;
  document.getElementById('settings-extensions').hidden = !extensions;
  document.getElementById('settings-general-tab').setAttribute('aria-selected', String(!extensions));
  document.getElementById('settings-extensions-tab').setAttribute('aria-selected', String(extensions));
  settingsEl.classList.toggle('extensions-open', extensions);
  settingsSaveEl.hidden = extensions;
  if (extensions) showExtensionManager();
  else { hideExtensionManager(); settingsDefaultAgentEl.focus(); }
}

document.getElementById('settings-general-tab').addEventListener('click', () => showSettingsSection('general'));
document.getElementById('settings-extensions-tab').addEventListener('click', () => showSettingsSection('extensions'));

async function saveSettings() {
  if (!settingsDialog) return;
  settingsSaveEl.disabled = true;
  const inputs = agentInputs();
  const agents = readAgentChoices(inputs, inputs[0]);
  const result = await window.host.settings.save({
    agents,
    defaultAgent: settingsDefaultAgentEl.value,
    branchAgent: settingsBranchAgentEl.value,
    codexApprovalMode: settingsCodexApprovalEl.value,
  });
  settingsSaveEl.disabled = false;
  if (result && result.error) return;
  window.host.answer(settingsDialog.id, 0, false);
}

function settingsFormKey(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    window.host.answer(settingsDialog.id, 1, false);
  } else if (event.key === 'Enter' && event.ctrlKey && !settingsSaveEl.hidden) {
    event.preventDefault();
    saveSettings();
  }
}

settingsEl.addEventListener('change', (event) => {
  const target = /** @type {HTMLInputElement | null} */ (event.target);
  if (target && target.name === 'settings-agents') updateSettingsChoices(target);
});
settingsSaveEl.addEventListener('click', saveSettings);
settingsCancelEl.addEventListener('click', () => {
  if (settingsDialog) window.host.answer(settingsDialog.id, 1, false);
});
