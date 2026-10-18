// The checks of a commit as the side bar shows them (readChecks in github.js reads them), apart
// from the page so they can be tested: whether they still show, and the lines of their mark's
// title. The page loads this as a plain script; the tests require it.

// In the tests, the UI language's `t`; a page has its own (src/i18n/page.js).
if (typeof module === 'object') var { t } = require('../i18n');

// What a check came to, in GitHub's words.
function checkLabel(state) {
  const labels = { success: t('Successful'), failure: t('Failed'), pending: t('In progress'), cancelled: t('Cancelled'), skipped: t('Skipped') };
  return labels[state] || state;
}
// Failed ones first, as GitHub lists them: they are what to look at.
const CHECK_ORDER = ['failure', 'cancelled', 'pending', 'success', 'skipped'];
const CHECKS_HOUR = 60 * 60 * 1000;
// How long the checks of a merge commit or a worktree's HEAD show after one of them last started
// or finished. Passed ones for the while of the push or merge they follow, so that the rows of
// old merged pull requests, and a default branch not pulled for days, do not each carry a ✓ of
// long ago; failed and running ones for a day, since they ask for something to be done.
const CHECKS_RECENT = { success: CHECKS_HOUR, failure: 24 * CHECKS_HOUR, pending: 24 * CHECKS_HOUR };
// Checks named in a mark's title, at most.
const CHECKS_LISTED = 10;

// `checks` while they still show at `now` (CHECKS_RECENT), else null. Checks that do not say when
// they ran show.
function recentChecks(checks, now) {
  if (!checks) return null;
  return checks.at === null || now - checks.at <= CHECKS_RECENT[checks.state] ? checks : null;
}

// The checks of a worktree's HEAD that are its own: those of a push to its `branch`, those of a
// tag (a release) on the default branch, and those that do not say (from another service). Not
// those that ran for another branch on the same commit: a branch just made from main has main's
// last commit, with main's checks. What they came to is then worked out from them alone. All of
// them on a detached HEAD (no branch). Null when none is left.
function ownChecks(checks, branch, defaultBranch) {
  if (!checks || !branch) return checks || null;
  const own = (ref) => !ref || ref === `refs/heads/${branch}` || (branch === defaultBranch && ref.startsWith('refs/tags/'));
  const runs = checks.runs.filter((run) => own(run.ref));
  if (runs.length === checks.runs.length) return checks;
  if (!runs.length) return null;
  const has = (...states) => runs.some((run) => states.includes(run.state));
  const times = runs.map((run) => run.at).filter((at) => at !== null);
  return {
    ...checks,
    // As GitHub sums them up: a cancelled check fails the commit.
    state: has('failure', 'cancelled') ? 'failure' : has('pending') ? 'pending' : 'success',
    runs,
    // Those past the ones read may be its own too.
    total: runs.length + checks.total - checks.runs.length,
    at: times.length ? Math.max(...times) : null,
  };
}

// A line for each check with its outcome, failed ones first ("CI / Test (windows-latest): Failed"),
// then how many more there are past CHECKS_LISTED or past those read.
function checksLines(checks) {
  const runs = [...checks.runs].sort((a, b) => CHECK_ORDER.indexOf(a.state) - CHECK_ORDER.indexOf(b.state));
  const lines = runs.slice(0, CHECKS_LISTED).map((run) => `${run.name}: ${checkLabel(run.state)}`);
  const more = Math.max(checks.total, runs.length) - lines.length;
  if (more > 0) lines.push(t('and {count} more checks', { count: more }));
  return lines;
}

if (typeof module === 'object') module.exports = { checkLabel, checksLines, ownChecks, recentChecks };
