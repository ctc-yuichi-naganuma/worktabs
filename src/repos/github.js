// Keep the app's GitHub API on one client while callers and tests can create isolated clients.
const { currentBranch, defaultBranch, mainRemote } = require('./worktrees');
const { runAt, runGit } = require('../commands');
const { createGithubClient } = require('./github-client');

module.exports = { ...createGithubClient({ currentBranch, defaultBranch, mainRemote, runAt, runGit }), createGithubClient };
