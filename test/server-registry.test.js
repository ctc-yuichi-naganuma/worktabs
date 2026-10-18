const assert = require('node:assert/strict');
const test = require('node:test');
const { createServerRegistry } = require('../src/code-server/server-registry');

function setup() {
  const made = [];
  const registry = createServerRegistry({
    createWsl: (distro) => {
      const manager = { distro, prepared: [], prepare(options) { this.prepared.push(options); return Promise.resolve(); } };
      made.push(manager);
      return manager;
    },
  });
  return { registry, made };
}

test('a WSL folder gets its distribution\'s manager, made once whatever the case of its name', () => {
  const { registry, made } = setup();
  const ubuntu = registry.forFolder('\\\\wsl.localhost\\Ubuntu\\home\\me\\app');
  assert.equal(ubuntu.distro, 'Ubuntu');
  assert.equal(registry.forFolder('\\\\wsl.localhost\\ubuntu\\home\\me\\other'), ubuntu);
  assert.equal(made.length, 1);
  assert.equal(registry.wsl.get('ubuntu'), ubuntu);
});

test('other folders get the local manager once it is set', () => {
  const { registry } = setup();
  assert.equal(registry.forFolder('C:\\src\\app'), null);
  assert.deepEqual(registry.all(), []);
  const local = { local: true };
  registry.setLocal(local);
  assert.equal(registry.local(), local);
  assert.equal(registry.forFolder('/src/app'), local);
  const wsl = registry.wslFor('Debian');
  assert.deepEqual(registry.all(), [local, wsl]);
});

test('prepareWsl readies each distribution of the folders once, without installing', () => {
  const { registry, made } = setup();
  registry.prepareWsl(['/src/app', '\\\\wsl.localhost\\Ubuntu\\a', '\\\\wsl.localhost\\UBUNTU\\b', '\\\\wsl.localhost\\Debian\\c']);
  assert.deepEqual(made.map((manager) => manager.distro.toLowerCase()), ['ubuntu', 'debian']);
  assert.deepEqual(made.map((manager) => manager.prepared), [[{ install: false }], [{ install: false }]]);
});
