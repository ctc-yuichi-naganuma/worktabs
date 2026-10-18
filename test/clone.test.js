const assert = require('node:assert/strict');
const test = require('node:test');
const {
  checkDestination,
  cloneCommand,
  cloneDestination,
  cloneFailure,
  cloneRoots,
  clonedKeys,
  defaultDestination,
  destinationIn,
  folderKey,
  isHiddenOwner,
  mergeOwned,
  repoKey,
  rootOf,
  unclonedGroups,
} = require('../src/repos/clone');
const { windowsPath } = require('../src/wsl/wsl');

// A repository of the account, as readOwnedRepos in github.js gives it.
const owned = (owner, name, fields = {}) => {
  const host = fields.host || 'github.com';
  return {
    host,
    owner,
    type: 'user',
    name,
    url: `https://${host}/${owner}/${name}`,
    fork: false,
    visibility: 'public',
    description: '',
    pushedAt: null,
    ...fields,
  };
};

// The names of the repositories in each group, by owner.
const names = (groups) => groups.map((group) => [group.key, group.repos.map((repo) => repo.name)]);

test('repoKey and folderKey tell a repository by host, owner and name, whatever the case', () => {
  assert.equal(repoKey('https://github.com/WorkTabs/WorkTabs'), 'github.com/worktabs/worktabs');
  assert.equal(repoKey('https://ghe.example.com:8443/team/app.git'), 'ghe.example.com/team/app');
  assert.equal(repoKey('https://github.com/worktabs'), null);
  assert.equal(repoKey('https://github.com/o/r/tree/main'), null);
  assert.equal(repoKey('not a url'), null);
  assert.equal(folderKey('C:\\repos\\github.com\\WorkTabs\\WorkTabs'), 'github.com/worktabs/worktabs');
  assert.equal(folderKey('/Users/me/ghq/github.com/o/r'), 'github.com/o/r');
  assert.equal(folderKey(windowsPath('Ubuntu', '/home/me/ghq/github.com/o/r')), 'github.com/o/r');
  assert.equal(folderKey('C:\\r'), null);
});

test('unclonedGroups leaves out the repositories cloned, by remote whatever its case, in Windows or WSL', () => {
  const list = [owned('o', 'a'), owned('o', 'b'), owned('o', 'c'), owned('o', 'd'), owned('o', 'e')];
  const cloned = clonedKeys({
    urls: [
      // Read from a remote in Windows, and from one in WSL.
      'https://github.com/O/A',
      'https://github.com/o/b',
    ],
    folders: ['C:\\work\\c', windowsPath('Ubuntu', '/home/me/work/d')],
  });
  assert.deepEqual(names(unclonedGroups(list, cloned)), [['github.com/o', ['c', 'd', 'e']]]);
});

test('unclonedGroups takes a repository renamed or moved since it was cloned for cloned, by where GitHub has it now', () => {
  const list = [owned('o', 'new-name'), owned('p', 'moved')];
  // The remotes still have the old addresses; GitHub told the new ones (readVisibility).
  const cloned = clonedKeys({ urls: ['https://github.com/o/old-name', 'https://github.com/o/new-name', 'https://github.com/o/moved', 'https://github.com/p/moved'] });
  assert.deepEqual(unclonedGroups(list, cloned), []);
});

test('unclonedGroups takes a repository where ghq puts it for cloned, before its remote is read', () => {
  const list = [owned('o', 'a'), owned('o', 'b'), owned('o', 'c'), owned('team', 'app', { host: 'ghe.example.com' }), owned('o', 'd')];
  const cloned = clonedKeys({
    folders: [
      'C:\\repos\\github.com\\o\\a',
      windowsPath('Ubuntu', '/home/me/ghq/github.com/O/B'),
      '/Users/me/ghq/github.com/o/c',
      'C:\\repos\\ghe.example.com\\team\\app',
      // Not in ghq's order: told by its remote only.
      'C:\\work\\d',
    ],
  });
  assert.deepEqual(names(unclonedGroups(list, cloned)), [['github.com/o', ['d']]]);
});

test('unclonedGroups puts the account first and the organizations by name, the repositories pushed to last first', () => {
  const at = (day) => Date.parse(`2026-09-${String(day).padStart(2, '0')}T00:00:00Z`);
  const list = [
    owned('zeta', 'z', { type: 'org' }),
    owned('Alpha', 'b', { type: 'org', pushedAt: at(10) }),
    owned('Alpha', 'a', { type: 'org', pushedAt: at(10) }),
    owned('Alpha', 'c', { type: 'org', pushedAt: at(20) }),
    owned('me', 'work', { host: 'ghe.example.com' }),
    owned('beta', 'x', { type: 'org', host: 'ghe.example.com' }),
    owned('me', 'old', { pushedAt: at(1) }),
    owned('me', 'new', { pushedAt: at(30) }),
    owned('me', 'never'),
  ];
  const groups = unclonedGroups(list, new Set());
  assert.deepEqual(names(groups), [
    ['github.com/me', ['new', 'old', 'never']],
    ['ghe.example.com/me', ['work']],
    ['github.com/alpha', ['c', 'a', 'b']],
    ['ghe.example.com/beta', ['x']],
    ['github.com/zeta', ['z']],
  ]);
  assert.deepEqual(
    groups.map(({ host, owner, type, hidden }) => ({ host, owner, type, hidden })),
    [
      { host: 'github.com', owner: 'me', type: 'user', hidden: 'me' },
      { host: 'ghe.example.com', owner: 'me', type: 'user', hidden: 'ghe.example.com/me' },
      { host: 'github.com', owner: 'Alpha', type: 'org', hidden: 'Alpha' },
      { host: 'ghe.example.com', owner: 'beta', type: 'org', hidden: 'ghe.example.com/beta' },
      { host: 'github.com', owner: 'zeta', type: 'org', hidden: 'zeta' },
    ],
  );
  assert.deepEqual(groups[0].repos[0], {
    key: 'github.com/me/new',
    url: 'https://github.com/me/new',
    name: 'new',
    fork: false,
    visibility: 'public',
    description: '',
    pushedAt: at(30),
  });
});

test('unclonedGroups leaves out the owners hiddenGithubOwners names, on any host or on one', () => {
  const list = [
    owned('big-org', 'a', { type: 'org' }),
    owned('big-org', 'b', { type: 'org', host: 'ghe.example.com' }),
    owned('team', 'c', { type: 'org', host: 'ghe.example.com' }),
    owned('team', 'd', { type: 'org' }),
    owned('me', 'e'),
  ];
  const groups = unclonedGroups(list, new Set(), [' BIG-ORG ', 'ghe.example.com/Team', 42]);
  assert.deepEqual(names(groups), [
    ['github.com/me', ['e']],
    ['github.com/team', ['d']],
  ]);
  assert.equal(isHiddenOwner(['team'], 'ghe.example.com', 'Team'), true);
  assert.equal(isHiddenOwner(['github.com/team'], 'ghe.example.com', 'team'), false);
  assert.equal(isHiddenOwner(undefined, 'github.com', 'team'), false);
});

test('mergeOwned keeps what a host that failed had, and drops the hosts gh is no longer signed in to', () => {
  const previous = [owned('o', 'a'), owned('team', 'b', { host: 'ghe.example.com' }), owned('x', 'c', { host: 'gone.example.com' })];
  const fresh = [owned('o', 'new')];
  const merged = mergeOwned(previous, ['github.com', 'ghe.example.com'], new Map([['github.com', fresh], ['ghe.example.com', null]]));
  assert.deepEqual(merged.map((repo) => repo.name), ['new', 'b']);
  // Signed out of every host: none.
  assert.deepEqual(mergeOwned(previous, [], new Map()), []);
});

test('cloneRoots finds ghq roots and parent folders, the places with the most repositories first', () => {
  const roots = cloneRoots([
    { path: 'C:\\repos\\github.com\\o\\a', url: 'https://github.com/o/a' },
    { path: 'C:\\repos\\github.com\\o\\b', url: 'https://github.com/O/B' },
    // Its remote is not GitHub's, or not read: the folders still look as ghq names them.
    { path: 'C:\\repos\\gitlab.com\\g\\c', url: null },
    { path: 'C:\\work\\d', url: 'https://github.com/o/d' },
    // In ghq's order by its folders, but its remote is another repository: by its parent.
    { path: 'C:\\repos\\github.com\\o\\fork', url: 'https://github.com/someone/fork' },
    { path: 'C:\\work\\e', url: null },
    // Too shallow for ghq's order.
    { path: 'C:\\x\\y', url: null },
  ]);
  assert.deepEqual(roots, [
    { root: 'C:\\repos', ghq: true, count: 3 },
    { root: 'C:\\work', ghq: false, count: 2 },
    { root: 'C:\\repos\\github.com\\o', ghq: false, count: 1 },
    { root: 'C:\\x', ghq: false, count: 1 },
  ]);
});

test('cloneRoots works on paths in WSL and on macOS', () => {
  assert.deepEqual(
    cloneRoots([
      { path: windowsPath('Ubuntu', '/home/me/ghq/github.com/o/a'), url: 'https://github.com/o/a' },
      { path: windowsPath('Ubuntu', '/home/me/src/b'), url: null },
    ]),
    [
      { root: windowsPath('Ubuntu', '/home/me/ghq'), ghq: true, count: 1 },
      { root: windowsPath('Ubuntu', '/home/me/src'), ghq: false, count: 1 },
    ],
  );
  assert.deepEqual(cloneRoots([{ path: '/Users/me/ghq/github.com/o/a', url: 'https://github.com/o/a' }]), [{ root: '/Users/me/ghq', ghq: true, count: 1 }]);
});

test('cloneDestination puts a repository in ghq order under a ghq root, else by its name', () => {
  const repo = owned('o', 'app');
  assert.equal(cloneDestination('C:\\repos', true, repo), 'C:\\repos\\github.com\\o\\app');
  assert.equal(cloneDestination('C:\\work\\', false, repo), 'C:\\work\\app');
  assert.equal(cloneDestination(windowsPath('Ubuntu', '/home/me/ghq'), true, repo), windowsPath('Ubuntu', '/home/me/ghq/github.com/o/app'));
  assert.equal(cloneDestination('/Users/me/src', false, repo), '/Users/me/src/app');
  // A GitHub Enterprise Server's folder is its host, without a port.
  assert.equal(cloneDestination('/srv', true, owned('team', 'x', { url: 'https://ghe.example.com:8443/team/x' })), '/srv/ghe.example.com/team/x');
});

test('destinationIn follows the choice at a folder, else whether it is a ghq root', () => {
  const repo = owned('o', 'app');
  const roots = [
    { root: 'C:\\repos', ghq: true, count: 3 },
    { root: 'C:\\work', ghq: false, count: 2 },
  ];
  const nothing = () => false;
  assert.equal(destinationIn('c:\\Repos\\', roots, repo, nothing), 'c:\\Repos\\github.com\\o\\app');
  assert.equal(destinationIn('C:\\work', roots, repo, nothing), 'C:\\work\\app');
  // A folder picked that already has a folder of a host in it.
  const seen = [];
  const ghqRoot = (p) => {
    seen.push(p);
    return p === 'D:\\src\\github.com';
  };
  assert.equal(destinationIn('D:\\src', roots, repo, ghqRoot), 'D:\\src\\github.com\\o\\app');
  assert.equal(destinationIn('D:\\other', roots, repo, ghqRoot), 'D:\\other\\app');
  assert.deepEqual(seen, ['D:\\src\\github.com', 'D:\\other\\github.com']);
});

test('rootOf and defaultDestination start the next clone where the last one went', () => {
  const repo = owned('o', 'app');
  const next = owned('o', 'next');
  assert.equal(rootOf('D:\\src\\github.com\\O\\app', repo), 'D:\\src');
  assert.equal(rootOf('D:\\src\\app', repo), 'D:\\src');
  assert.equal(rootOf('/Users/me/ghq/github.com/o/app', repo), '/Users/me/ghq');
  const roots = [{ root: 'C:\\work', ghq: false, count: 2 }];
  assert.equal(defaultDestination(roots, 'D:\\src', next, (p) => p === 'D:\\src\\github.com'), 'D:\\src\\github.com\\o\\next');
  assert.equal(defaultDestination(roots, null, next), 'C:\\work\\next');
  assert.equal(defaultDestination([], null, next), '');
});

test('checkDestination wants a full path to a folder that is not there yet', () => {
  const exists = (p) => p === 'C:\\repos\\app' || p === '/Users/me/app';
  const win = { exists, platform: 'win32' };
  assert.deepEqual(checkDestination('  C:\\repos\\new  ', win), { dest: 'C:\\repos\\new', error: null });
  assert.deepEqual(checkDestination('\\\\wsl.localhost\\Ubuntu\\home\\me\\new', win), { dest: '\\\\wsl.localhost\\Ubuntu\\home\\me\\new', error: null });
  assert.match(checkDestination('', win).error, /Enter the folder/);
  assert.match(checkDestination('repos\\new', win).error, /full path/);
  assert.match(checkDestination('\\repos\\new', win).error, /full path/);
  assert.match(checkDestination('C:\\repos\\app', win).error, /already exists/);
  const mac = { exists, platform: 'darwin' };
  assert.deepEqual(checkDestination('/Users/me/new', mac), { dest: '/Users/me/new', error: null });
  assert.match(checkDestination('~/new', mac).error, /full path/);
  assert.match(checkDestination('/Users/me/app', mac).error, /already exists/);
});

test('cloneCommand clones with ghq, or with git into the folder, over https or SSH', () => {
  const repo = owned('o', 'app');
  assert.deepEqual(cloneCommand(repo, { ghq: true, ssh: false }), { command: 'ghq', args: ['get', 'github.com/o/app'] });
  assert.deepEqual(cloneCommand(repo, { ghq: true, ssh: true }), { command: 'ghq', args: ['get', '-p', 'github.com/o/app'] });
  assert.deepEqual(cloneCommand(repo, { ghq: false, ssh: false, dest: 'C:\\work\\app' }), {
    command: 'git',
    args: ['clone', '--', 'https://github.com/o/app.git', 'C:\\work\\app'],
  });
  assert.deepEqual(cloneCommand(repo, { ghq: false, ssh: true, dest: '/Users/me/src/app' }), {
    command: 'git',
    args: ['clone', '--', 'git@github.com:o/app.git', '/Users/me/src/app'],
  });
  // In WSL, git runs there and takes the Linux path.
  assert.deepEqual(cloneCommand(repo, { ghq: false, ssh: false, dest: windowsPath('Ubuntu', '/home/me/src/app') }).args, [
    'clone',
    '--',
    'https://github.com/o/app.git',
    '/home/me/src/app',
  ]);
  // GitHub Enterprise Server: its own host (and https port).
  const enterprise = owned('team', 'x', { host: 'ghe.example.com', url: 'https://ghe.example.com:8443/team/x' });
  assert.deepEqual(cloneCommand(enterprise, { ghq: true, ssh: false }).args, ['get', 'ghe.example.com:8443/team/x']);
  assert.deepEqual(cloneCommand(enterprise, { ghq: false, ssh: false, dest: '/srv/x' }).args[2], 'https://ghe.example.com:8443/team/x.git');
  assert.deepEqual(cloneCommand(enterprise, { ghq: false, ssh: true, dest: '/srv/x' }).args[2], 'git@ghe.example.com:team/x.git');
});

test('cloneFailure shows what git said, and how to give git credentials when https was refused', () => {
  const repo = owned('o', 'app');
  const refused = Object.assign(new Error('Command failed: git clone'), {
    code: 128,
    stderr: "Cloning into 'app'...\nfatal: could not read Username for 'https://github.com': terminal prompts disabled\n",
  });
  const https = cloneFailure(refused, repo, { ssh: false });
  assert.equal(https.type, 'error');
  assert.equal(https.message, 'Could not clone o/app.');
  assert.match(https.detail, /^Cloning into 'app'\.\.\.\nfatal: could not read Username/);
  assert.match(https.detail, /gh auth setup-git/);
  assert.doesNotMatch(https.detail, /SSH/);

  const denied = Object.assign(new Error('Command failed: ghq get'), { code: 1, stderr: 'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n' });
  const ssh = cloneFailure(denied, repo, { ssh: true, ghq: true });
  assert.match(ssh.detail, /ssh -T git@github\.com/);
  assert.doesNotMatch(ssh.detail, /gh auth setup-git/);

  // Nothing that reads as a refusal: what it said alone.
  const other = cloneFailure(Object.assign(new Error('x'), { stderr: 'fatal: destination path exists' }), repo);
  assert.equal(other.detail, 'fatal: destination path exists');

  assert.equal(cloneFailure(Object.assign(new Error('spawn ghq ENOENT'), { code: 'ENOENT' }), repo, { ghq: true }).detail, 'ghq is not found.');
  assert.match(cloneFailure(Object.assign(new Error('timed out'), { killed: true, stderr: '' }), repo).detail, /^Stopped it, as it had not finished in 10 minutes/);
});
