// The GitHub pages of a repository, in a bar that comes up under its icon when the mouse rests on
// it (hoverIntent in hover.js), over the rows below: they do not move, and a repository takes no
// row of its own for them. The bar is apart from the tree, which is made again on every render;
// after each, it goes back under the icon, or away with it (place). Icons only: the side bar is
// narrow, and the repository's name is on the row above.
// The page gives it its elements, state, and selectors; it wires its own pointer and key events.

// Between the icon's row and the bar, for the notch that points at the icon.
const GITHUB_BAR_GAP = 6;

function createGithubBar({ barEl, reposEl, state, host, dom, t, buttons, groups, load, approvedOf, hoverIntent, document, window }) {
  const { el, icon } = dom;
  const githubBar = hoverIntent({ show: showGithubBar, hide: hideGithubBar });

  function githubMarkOf(key) {
    return [...document.querySelectorAll('#repos .gh-mark')].find((mark) => mark.dataset.key === key) || null;
  }

  function showGithubBar(key) {
    const group = groups().find((g) => g.key === key);
    if (!group || !githubMarkOf(key)) return githubBar.close();
    // A collapsed repository has not read where its remote is yet: the bar goes away if it is not
    // on GitHub after all.
    load(group);
    fillGithubBar(group);
    barEl.hidden = false;
    placeGithubBar();
  }

  function hideGithubBar() {
    barEl.hidden = true;
    barEl.replaceChildren();
    for (const mark of document.querySelectorAll('.gh-mark.open')) mark.classList.remove('open');
  }

  // The buttons, made again when the repository's page on GitHub, or its pull requests approved and
  // not merged, have been read since.
  function fillGithubBar(group) {
    const repo = state.github.get(group.key);
    const slug = repo ? repo.slug : '';
    const approved = approvedOf(group);
    const key = JSON.stringify([group.key, slug, approved]);
    if (barEl.childElementCount && barEl.dataset.key === key) return;
    barEl.dataset.key = key;
    barEl.setAttribute('aria-label', repo ? `GitHub（${repo.slug}）` : 'GitHub');
    const pages = el('div', 'gh-pages');
    pages.append(
      ...buttons.map(({ page, icon: name, title }) => {
        const button = el('button', 'icon-button');
        button.type = 'button';
        button.title = page === 'repo' && repo ? `${title}\n${repo.url}` : title;
        button.setAttribute('aria-label', title);
        button.append(icon(name));
        button.addEventListener('click', () => {
          githubBar.close();
          host.openGithub(group.path, page);
        });
        return button;
      }),
    );
    barEl.replaceChildren(pages);
    if (approved.length) barEl.append(approvedRow(group, approved));
  }

  // The pull requests of one's own approved and not merged (the dot on the icon), under the GitHub
  // buttons, as the worktree rows show a pull request: each opens. They wrap in a narrow side bar.
  function approvedRow(group, pulls) {
    const row = el('div', 'gh-approved');
    row.append(el('span', 'gh-approved-label', t('Approved')));
    for (const pull of pulls) {
      const button = el('button', 'pull open');
      button.type = 'button';
      button.title = [t('PR #{number} approved, not merged', { number: pull.number }), pull.title, t('Click to open the PR on GitHub')].filter(Boolean).join('\n');
      button.setAttribute('aria-label', t('PR #{number} approved', { number: pull.number }));
      button.append(icon('pulls'), `#${pull.number}`);
      button.addEventListener('click', () => {
        githubBar.close();
        host.openPull(group.path, pull.number);
      });
      row.append(button);
    }
    return row;
  }

  // Under the icon's row, its first button under the icon; over the row when the window ends first.
  function placeGithubBar() {
    const key = githubBar.shown;
    if (key === null) return;
    const mark = githubMarkOf(key);
    const group = groups().find((g) => g.key === key);
    if (!mark || !group || state.github.get(key) === null) return githubBar.close();
    fillGithubBar(group);
    for (const other of document.querySelectorAll('.gh-mark.open')) if (other !== mark) other.classList.remove('open');
    mark.classList.add('open');
    const glyph = mark.firstElementChild.getBoundingClientRect();
    const row = mark.closest('.row').getBoundingClientRect();
    const button = barEl.querySelector('.gh-pages button');
    const inset = button ? button.getBoundingClientRect().left - barEl.getBoundingClientRect().left + button.offsetWidth / 2 : 0;
    const center = glyph.left + glyph.width / 2;
    const left = Math.max(2, Math.round(center - inset));
    barEl.style.left = `${left}px`;
    // Measured where it is: the pull requests under the buttons wrap to the side bar's width.
    const height = barEl.offsetHeight;
    const below = row.bottom + GITHUB_BAR_GAP + height <= window.innerHeight;
    barEl.classList.toggle('above', !below);
    barEl.style.top = `${Math.round(below ? row.bottom + GITHUB_BAR_GAP : row.top - GITHUB_BAR_GAP - height)}px`;
    // The notch (8px, inside the bar's 1px edge) at the icon's middle, even where the bar is pushed
    // off the side bar's edge.
    barEl.style.setProperty('--notch', `${Math.round(center - left - 1 - 4)}px`);
  }

  // The buttons come up as the mouse rests on a repository's icon. Which icon the mouse is on is
  // followed over the whole tree, by the repository: the tree is made again under the mouse on
  // every render, and an icon taken out from under it hears nothing of the mouse leaving it. The
  // one put in its place is the same icon to the mouse; so is a part of it (its svg and path). A
  // press on the icon folds or unfolds its repository and takes the buttons away, which come again
  // only once the mouse has come back onto it.
  let overMark = null;
  reposEl.addEventListener('pointerover', (event) => {
    const key = event.target.closest('.gh-mark')?.dataset.key ?? null;
    if (key === overMark) return;
    if (overMark !== null) githubBar.leave();
    overMark = key;
    if (key !== null) githubBar.enter(key);
  });
  reposEl.addEventListener('pointerleave', () => {
    if (overMark === null) return;
    overMark = null;
    githubBar.leave();
  });
  barEl.addEventListener('pointerenter', () => githubBar.enterBar());
  barEl.addEventListener('pointerleave', () => githubBar.leave());
  window.addEventListener('pointerdown', (event) => {
    if (!barEl.contains(event.target)) githubBar.close();
  });
  reposEl.addEventListener('scroll', () => githubBar.close());
  window.addEventListener('blur', () => githubBar.close());
  window.addEventListener('resize', () => githubBar.close());
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') githubBar.close();
  });

  return { place: placeGithubBar, close: () => githubBar.close() };
}

if (typeof module === 'object') module.exports = { createGithubBar };
