// The GraphQL queries and gh api calls that GitHub is asked (pull requests and their checks,
// visibility, approved pull requests, the account's repositories), and reading their answers. No
// commands run here; the client in github-client.js runs gh with them.
const { parseWslPath } = require('../wsl/wsl');

// ---- Pull requests of branches -------------------------------------------------------------

// Pull requests asked for each branch: a branch can have had several (one closed, then another),
// and a fork's branch of the same name comes too.
const PULLS_PER_BRANCH = 10;
// Checks asked for each commit, for their names in the title of the mark: a push to main and the
// tag of a release run a few workflows of a few jobs each. The total comes too.
const CHECKS_PER_COMMIT = 30;
// What the checks of a commit came to (GitHub's StatusState), and a commit status from another
// service.
const CHECKS = { SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending' };
// How a finished check run ended (GitHub's CheckConclusionState); any other ending is a failure.
const CONCLUSIONS = { SUCCESS: 'success', NEUTRAL: 'success', SKIPPED: 'skipped', CANCELLED: 'cancelled', STALE: 'cancelled' };
// A full commit id, as `git worktree list` gives it. GitHub has no SHA-256 repositories.
const OID = /^[0-9a-f]{40}$/;

// The checks of a commit: the outcome of each, when it last moved, and the branch or tag whose
// push it ran for. The names are GitHub's own for a GitHub Actions job ("CI / Test
// (ubuntu-latest)"), as `gh pr checks` reads them.
const COMMIT_FIELDS = [
  'fragment commit on Commit { oid statusCheckRollup { state',
  `contexts(first: ${CHECKS_PER_COMMIT}) { totalCount nodes {`,
  '... on CheckRun { name status conclusion startedAt completedAt',
  'checkSuite { branch { name prefix } workflowRun { workflow { name } } } }',
  '... on StatusContext { context state createdAt } } } } }',
].join(' ');

// One GraphQL query for the pull requests of all `branches`: a field for each (b0, b1, ...) with
// the branch as a variable. Unlike a list of the repository's pull requests (gh pr list), none is
// missed past a limit, however many the repository has. A branch made from a pull request
// (`numbers`: branch -> its number; see setBranchLink in worktrees.js) also asks for that one
// (p0, p1, ...), which finds it from a fork, or under another name, too. By its address
// (resource) rather than its number (pullRequest): a number the repository does not have (its
// remote was changed since) fails the whole query with pullRequest, while resource is null.
// The commits of `heads` (the worktrees' HEADs) come in the same query (h0, h1, ...), for a row
// without a pull request: null when GitHub does not have one (not pushed yet), as for a number.
function pullsQuery(repo, branches, numbers = {}, heads = []) {
  const [owner, name] = repo.slug.split('/');
  const numbered = branches.map((branch, i) => [i, numbers[branch]]).filter(([, number]) => Number.isInteger(number));
  const fields = [
    ...branches.map(
      (_, i) => `b${i}: pullRequests(headRefName: $b${i}, first: ${PULLS_PER_BRANCH}, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ...pull } }`,
    ),
    ...heads.map((_, i) => `h${i}: object(oid: $h${i}) { ...commit }`),
  ];
  const params = [
    ...branches.map((_, i) => `$b${i}: String!`),
    ...numbered.map(([i]) => `$p${i}: URI!`),
    ...heads.map((_, i) => `$h${i}: GitObjectID!`),
  ];
  const query = [
    `query($owner: String!, $name: String!, ${params.join(', ')}) {`,
    `repository(owner: $owner, name: $name) { ${fields.join(' ')} }`,
    ...numbered.map(([i]) => `p${i}: resource(url: $p${i}) { ... on PullRequest { ...pull } }`),
    '} fragment pull on PullRequest { number title state isDraft isCrossRepository headRefOid',
    'commits(last: 1) { nodes { commit { ...commit } } } mergeCommit { ...commit } }',
    COMMIT_FIELDS,
  ].join(' ');
  const values = [
    ...branches.map((branch, i) => [`b${i}`, branch]),
    ...numbered.map(([i, number]) => [`p${i}`, `${repo.url}/pull/${number}`]),
    ...heads.map((oid, i) => [`h${i}`, oid]),
  ];
  return { query, variables: { owner, name, ...Object.fromEntries(values) } };
}

// A time GitHub gives (ISO 8601) in ms, or null.
function timeOf(text) {
  const time = typeof text === 'string' ? Date.parse(text) : NaN;
  return Number.isFinite(time) ? time : null;
}

// One check of a commit: a check run (a GitHub Actions job, named after its workflow as GitHub
// shows it) or a commit status (from another service). { name, state: 'success' | 'failure' |
// 'pending' | 'cancelled' | 'skipped', at: when it last moved (ms) or null, ref: the branch or tag
// whose push or pull request it ran for (refs/heads/main, refs/tags/v1.0.0) or null }, or null.
function readCheck(node) {
  if (!node) return null;
  if (typeof node.name === 'string') {
    const suite = node.checkSuite || {};
    const workflow = suite.workflowRun && suite.workflowRun.workflow;
    const finished = node.status === 'COMPLETED';
    return {
      name: workflow && workflow.name ? `${workflow.name} / ${node.name}` : node.name,
      state: finished ? CONCLUSIONS[node.conclusion] || 'failure' : 'pending',
      at: timeOf(node.completedAt) ?? timeOf(node.startedAt),
      ref: suite.branch && suite.branch.name ? `${suite.branch.prefix || ''}${suite.branch.name}` : null,
    };
  }
  if (typeof node.context === 'string') return { name: node.context, state: CHECKS[node.state] || 'pending', at: timeOf(node.createdAt), ref: null };
  return null;
}

// What the checks of a commit (as pullsQuery asks for it) came to: { oid, state: 'success' |
// 'failure' | 'pending', runs (readCheck), total, at }, or null without checks. `at`: the last
// time one of them started or finished (ms), null when none says. The side bar shows those of a
// merge commit or a HEAD only for a while, and of a HEAD only those of its own branch
// (recentChecks and ownChecks in sidebar/checks.js).
function readChecks(commit) {
  const rollup = commit && commit.statusCheckRollup;
  const state = rollup && CHECKS[rollup.state];
  if (!state) return null;
  const contexts = rollup.contexts || {};
  const runs = (contexts.nodes || []).map(readCheck).filter(Boolean);
  const times = runs.map((run) => run.at).filter((at) => at !== null);
  return {
    oid: String(commit.oid || ''),
    state,
    runs,
    total: Number.isInteger(contexts.totalCount) ? contexts.totalCount : runs.length,
    at: times.length ? Math.max(...times) : null,
  };
}

// The pull request of each branch from the answer to pullsQuery: branch -> { number, title,
// state: 'draft' | 'open' | 'merged' | 'closed', head: its last commit (a full id) or null,
// checks (readChecks) }.
// Picked as `gh pr view <branch>` picks it: from the repository's own branches (a fork's branch
// of the same name is someone else's), an open one first, else the newest. A branch in `numbers`
// has the one it was made from, as long as the repository has it. An open one has the checks of
// its last commit; a merged one those of its merge commit (the push to the branch it went into);
// a closed one none, as they no longer matter.
function readPulls(answer, branches, numbers = {}) {
  const data = (answer && answer.data) || {};
  const fields = data.repository || {};
  const found = new Map();
  branches.forEach((branch, i) => {
    const made = Number.isInteger(numbers[branch]) && data[`p${i}`];
    const named = ((fields[`b${i}`] && fields[`b${i}`].nodes) || []).filter((pull) => pull && !pull.isCrossRepository);
    const pulls = made && Number.isInteger(made.number) ? [made] : named;
    const pull = pulls.find((p) => p.state === 'OPEN') || pulls[0];
    if (!pull || !Number.isInteger(pull.number)) return;
    const open = pull.state === 'OPEN';
    const merged = pull.state === 'MERGED';
    const last = pull.commits && pull.commits.nodes && pull.commits.nodes[0] && pull.commits.nodes[0].commit;
    found.set(branch, {
      number: pull.number,
      title: String(pull.title || ''),
      state: open ? (pull.isDraft ? 'draft' : 'open') : merged ? 'merged' : 'closed',
      head: OID.test(pull.headRefOid) ? pull.headRefOid : null,
      checks: readChecks(open ? last : merged ? pull.mergeCommit : null),
    });
  });
  return found;
}

// The checks of each of `heads` from the answer to pullsQuery: oid -> checks (readChecks), for
// those GitHub has with checks.
function readHeads(answer, heads) {
  const fields = (answer && answer.data && answer.data.repository) || {};
  const found = new Map();
  heads.forEach((oid, i) => {
    const checks = readChecks(fields[`h${i}`]);
    if (checks) found.set(oid, checks);
  });
  return found;
}

// Whether the pull request (readPulls) was merged with `head` as its last commit: a branch at
// `head` then has no commit that was not merged. After a squash or rebase merge its commits are
// on no other branch, and once GitHub deletes the branch and a fetch prunes it, on no remote
// branch either (unsharedCommits in worktrees.js counts them), but GitHub keeps them with the
// pull request (refs/pull/<number>/head). A commit added after the merge makes them differ, as
// does one pushed to the pull request from elsewhere and not pulled.
function mergedAtHead(pull, head) {
  return Boolean(pull) && pull.state === 'merged' && OID.test(String(head)) && pull.head === head;
}

// The page of a commit's checks.
function checksUrl(repo, oid) {
  return OID.test(oid) ? `${repo.url}/commit/${oid}/checks` : null;
}

// Whether a command Claude ran makes GitHub start checks a moment later: a push (of a branch or
// a tag), a pull request made, merged or marked ready, a release made, a workflow run or run
// again. Their checks are read again soon after (see main.js), since GitHub takes a few seconds
// to add them to the commit. git takes options before its command (git -C <folder> push).
function startsChecks(command) {
  if (typeof command !== 'string') return false;
  const git = /\bgit(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+push\b/;
  const gh = /\bgh\s+(?:pr\s+(?:create|merge|ready)|release\s+create|workflow\s+run|run\s+rerun)\b/;
  return git.test(command) || gh.test(command);
}

// ---- Visibility of repositories ------------------------------------------------------------

// GitHub's RepositoryVisibility.
const VISIBILITIES = { PUBLIC: 'public', PRIVATE: 'private', INTERNAL: 'internal' };

// `repos` ([folder, url] each) in the groups that repoVisibility and approvedPulls ask about: by
// where gh runs for them (in its distribution for a folder in WSL, signed in there; see pageUrl)
// and by host. [{ folder: the first of them, folders: all of them, urls: without duplicates }].
function visibilityGroups(repos) {
  const groups = new Map();
  for (const [folder, url] of repos) {
    const wsl = parseWslPath(folder);
    const key = `${wsl ? wsl.distro.toLowerCase() : ''}\n${new URL(url).host}`;
    const group = groups.get(key) || { folder, folders: [], urls: [] };
    group.folders.push(folder);
    if (!group.urls.includes(url)) group.urls.push(url);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// One GraphQL query for the visibility of the repositories at `urls` (https://<host>/<owner>/
// <name>), a field for each (r0, r1, ...) with the owner and name as variables. By owner and name
// (repository) rather than by address (resource): repository follows a repository that was
// renamed or moved to another owner, as its old address does, while resource answers null. Its
// address now comes too, for telling which repositories of the account are cloned (see
// unclonedGroups in clone.js). A repository that is gone, or that the account cannot see, makes
// the answer have errors, and gh fail (see repoVisibility).
function visibilityQuery(urls) {
  const params = urls.map((_, i) => `$o${i}: String!, $n${i}: String!`);
  const fields = urls.map((_, i) => `r${i}: repository(owner: $o${i}, name: $n${i}) { visibility url }`);
  const variables = urls.flatMap((url, i) => {
    const [, owner, name] = new URL(url).pathname.split('/');
    return [
      [`o${i}`, owner],
      [`n${i}`, name],
    ];
  });
  return { query: `query(${params.join(', ')}) { ${fields.join(' ')} }`, variables: Object.fromEntries(variables) };
}

// The visibility of each of `urls` from the answer to visibilityQuery: url -> { visibility:
// 'public' | 'private' | 'internal', current: the address GitHub has it at now (null when it did
// not say) }, for those GitHub told.
function readVisibility(answer, urls) {
  const data = (answer && answer.data) || {};
  const found = new Map();
  urls.forEach((url, i) => {
    const repo = data[`r${i}`];
    const visibility = repo && VISIBILITIES[repo.visibility];
    if (visibility) found.set(url, { visibility, current: /^https?:\/\//i.test(repo.url) ? repo.url : null });
  });
  return found;
}

// GitHub's answer that a failed gh wrote, when it has data; else null.
function answerOf(error) {
  try {
    const answer = JSON.parse(error.stdout);
    return answer && answer.data ? answer : null;
  } catch {
    return null;
  }
}

// ---- Approved pull requests ----------------------------------------------------------------

// The open pull requests of the account gh is signed in to, in every repository, newest first:
// those approved and not merged are found among them (readApproved). Not a search
// (review:approved), which is not clear about repositories that do not require reviews. One page:
// an account with more open is not usual. The reviews are the latest of each person who can
// write to the repository, those that count for GitHub's own decision.
const APPROVED_QUERY = [
  'query { viewer { pullRequests(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {',
  'nodes { number title url isDraft reviewDecision repository { url isArchived }',
  'latestOpinionatedReviews(first: 30, writersOnly: true) { nodes { state } } } } } }',
].join(' ');

// Whether an open pull request (as APPROVED_QUERY asks for it) waits only to be merged as far as
// its review goes: not a draft, and approved as GitHub decides it (reviewDecision) where the base
// branch requires reviews. Where it does not, GitHub decides nothing (null), and the latest
// reviews decide: one approved it and none asks for changes.
function isApproved(pull) {
  if (!pull || pull.isDraft !== false) return false;
  if (pull.reviewDecision) return pull.reviewDecision === 'APPROVED';
  const states = ((pull.latestOpinionatedReviews && pull.latestOpinionatedReviews.nodes) || []).map((review) => review && review.state);
  return states.includes('APPROVED') && !states.includes('CHANGES_REQUESTED');
}

// The approved pull requests (isApproved) in the answer to APPROVED_QUERY: [{ repo: the web
// address of the repository it would be merged into, number, title, url }]. Those of archived
// repositories, which cannot be merged, are left out, as are those GitHub did not let the account
// see (null: an organization's SAML single sign-on, for one).
function readApproved(answer) {
  const viewer = answer && answer.data && answer.data.viewer;
  const nodes = (viewer && viewer.pullRequests && viewer.pullRequests.nodes) || [];
  return nodes
    .filter((pull) => isApproved(pull) && Number.isInteger(pull.number) && pull.repository && pull.repository.isArchived === false)
    .filter((pull) => /^https?:\/\//i.test(pull.repository.url) && /^https?:\/\//i.test(pull.url))
    .map((pull) => ({ repo: pull.repository.url, number: pull.number, title: String(pull.title || ''), url: pull.url }));
}

// ---- Repositories of the account -----------------------------------------------------------

// The repositories that the account gh is signed in to owns (its forks too) and those of the
// organizations it is a member of, in one list: not those of other people it only collaborates
// on. gh api follows the pages (--paginate); the --hostname of a GitHub Enterprise Server makes
// it ask that server's /api/v3.
const OWNED_PATH = 'user/repos?affiliation=owner,organization_member&per_page=100';
// What gh writes of each: a line of JSON (--jq writes each object on a line of its own).
const OWNED_JQ = '.[] | {owner: .owner.login, type: .owner.type, name: .name, url: .html_url, fork: .fork, archived: .archived, visibility: .visibility, description: .description, pushed: .pushed_at}';
// A name GitHub gives an owner or a repository, which goes on command lines and into paths
// (clone.js): nothing that git could take for an option or a path for a parent folder.
const GITHUB_NAME = /^(?!-)(?!\.{1,2}$)[\w.-]+$/;

// The repositories on `host` in what gh wrote for OWNED_JQ: [{ host, owner, type: 'user' | 'org',
// name, url (on GitHub), fork, visibility ('public' | 'private' | 'internal', or null), description,
// pushedAt: the last push (ms) or null }]. Archived ones, and lines of another shape, are left out.
function readOwnedRepos(output, host) {
  const found = [];
  for (const line of String(output).split(/\r?\n/)) {
    let repo;
    try {
      repo = JSON.parse(line);
    } catch {
      continue;
    }
    if (!repo || repo.archived !== false || !GITHUB_NAME.test(repo.owner) || !GITHUB_NAME.test(repo.name)) continue;
    if (typeof repo.url !== 'string' || !/^https?:\/\/[^/]+\/[^/]+\/[^/]+$/i.test(repo.url)) continue;
    const visibility = typeof repo.visibility === 'string' ? repo.visibility.toLowerCase() : null;
    found.push({
      host: host.toLowerCase(),
      owner: repo.owner,
      type: repo.type === 'Organization' ? 'org' : 'user',
      name: repo.name,
      url: repo.url,
      fork: repo.fork === true,
      visibility: Object.values(VISIBILITIES).includes(visibility) ? visibility : null,
      description: typeof repo.description === 'string' ? repo.description : '',
      pushedAt: timeOf(repo.pushed),
    });
  }
  return found;
}

module.exports = {
  APPROVED_QUERY,
  OID,
  OWNED_JQ,
  OWNED_PATH,
  answerOf,
  checksUrl,
  isApproved,
  mergedAtHead,
  pullsQuery,
  readApproved,
  readChecks,
  readHeads,
  readOwnedRepos,
  readPulls,
  readVisibility,
  startsChecks,
  visibilityGroups,
  visibilityQuery,
};
