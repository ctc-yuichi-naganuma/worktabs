const assert = require('node:assert/strict');
const test = require('node:test');
const { MAX_PULL_BRANCHES, createGithubPages } = require('../src/repos/github-pages');

const repo = { url: 'https://github.com/octo/hello', branch: 'fix' };

function setup({ found = repo, pulls = null } = {}) {
  const opened = [];
  const asked = [];
  const pages = createGithubPages({
    githubRepo: async () => found,
    pageUrl: async (r, page) => `${r.url}/${page}`,
    checksUrl: (r, oid) => (oid ? `${r.url}/commit/${oid}/checks` : null),
    branchPulls: async (r, branches, options) => {
      asked.push({ branches, options });
      if (!pulls) throw new Error('gh is not signed in');
      return pulls;
    },
    hasBranchPage: (r) => r.branch !== 'main',
    openExternal: (url) => opened.push(url),
  });
  return { pages, opened, asked };
}

test('pages open only for a repository on GitHub, and a number must be a positive integer', async () => {
  const { pages, opened } = setup();
  await pages.openGithub('/src/hello', 'actions');
  await pages.openNumbered('/src/hello', 'pull', 12);
  await pages.openNumbered('/src/hello', 'issues', 0);
  await pages.openNumbered('/src/hello', 'issues', '3');
  await pages.openChecks('/src/hello', 'abc');
  await pages.openChecks('/src/hello', '');
  assert.deepEqual(opened, ['https://github.com/octo/hello/actions', 'https://github.com/octo/hello/pull/12', 'https://github.com/octo/hello/commit/abc/checks']);
  const outside = setup({ found: null });
  await outside.pages.openGithub('/src/other', 'repo');
  assert.deepEqual(outside.opened, []);
  assert.equal(await outside.pages.repoInfo('/src/other'), null);
});

test('the branch page is there for a branch other than the default', async () => {
  assert.equal(await setup().pages.branchPage('/src/hello'), 'fix');
  assert.equal(await setup({ found: { ...repo, branch: 'main' } }).pages.branchPage('/src/hello'), null);
  assert.deepEqual(await setup().pages.repoInfo('/src/hello'), { ...repo, branchPage: true });
});

test('pull requests are asked for at most so many branches, and a failure reads as null', async () => {
  const branches = Array.from({ length: MAX_PULL_BRANCHES + 5 }, (_, i) => `b${i}`);
  const { pages, asked } = setup({ pulls: { pulls: new Map([['b1', { number: 1 }]]), heads: new Map([['abc', { state: 'SUCCESS' }]]) } });
  const read = await pages.pullRequests('/src/hello', branches, new Map([['b1', 7]]), ['abc']);
  assert.deepEqual(read, { pulls: { b1: { number: 1 } }, heads: { abc: { state: 'SUCCESS' } } });
  assert.equal(asked[0].branches.length, MAX_PULL_BRANCHES);
  assert.deepEqual(asked[0].options, { folder: '/src/hello', numbers: { b1: 7 }, heads: ['abc'] });
  assert.equal(await setup().pages.pullRequests('/src/hello', ['b1']), null);
  assert.equal(await setup({ found: null }).pages.pullRequests('/src/hello', ['b1']), null);
});
