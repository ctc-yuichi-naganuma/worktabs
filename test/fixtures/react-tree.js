// Shared mounted/alternate fixture for all private React integration probes.
function mountReact(element, props, { alternateProps = null } = {}) {
  const rootState = {};
  const build = (values) => {
    const root = { stateNode: rootState }; const contexts = []; let parent = root;
    for (const memoizedProps of values.slice().reverse()) {
      const context = { memoizedProps, return: parent }; contexts.unshift(context);
      parent.child = context; parent = context;
    }
    const leaf = { stateNode: element, return: parent }; parent.child = leaf;
    return { root, contexts, leaf };
  };
  const current = build(props); rootState.current = current.root;
  const alternate = alternateProps ? build(alternateProps) : null;
  element.__reactFiber$fixture = alternate ? alternate.leaf : current.leaf;
  return { element, root: current.root, context: current.contexts[0], contexts: current.contexts, alternate };
}
module.exports = { mountReact };
