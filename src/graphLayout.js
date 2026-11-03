export function getLinkNodeId(value) {
  return typeof value === 'object' ? value.id : value;
}

// Linear traversal, including deep graphs: no recursive subtree recalculation.
export function buildLayout(nodes, links, rootNodeId, width, height) {
  if (!nodes.length) return new Map();
  const adjacency = new Map(nodes.map(node => [node.id, []]));
  for (const link of links) {
    const source = getLinkNodeId(link.source), target = getLinkNodeId(link.target);
    if (!adjacency.has(source) || !adjacency.has(target)) continue;
    adjacency.get(source).push(target);
    adjacency.get(target).push(source);
  }
  const root = adjacency.has(rootNodeId) ? rootNodeId : nodes[0].id;
  const depths = new Map([[root, 0]]);
  const children = new Map([[root, []]]);
  const order = [root];
  let maxDepth = 0;
  for (let index = 0; index < order.length; index++) {
    const current = order[index];
    for (const neighbor of adjacency.get(current)) {
      if (depths.has(neighbor)) continue;
      const depth = depths.get(current) + 1;
      maxDepth = Math.max(maxDepth, depth);
      depths.set(neighbor, depth);
      children.get(current).push(neighbor);
      children.set(neighbor, []);
      order.push(neighbor);
    }
  }
  const widths = new Map();
  for (let index = order.length - 1; index >= 0; index--) {
    const id = order[index];
    widths.set(id, children.get(id).reduce((sum, child) => sum + widths.get(child), 0) || 100);
  }
  const verticalGap = Math.max(120, Math.min(180, (height - 120) / Math.max(maxDepth, 1)));
  const left = new Map([[root, (width - widths.get(root)) / 2]]);
  const positions = new Map();
  for (const id of order) {
    let cursor = left.get(id);
    for (const child of children.get(id)) {
      left.set(child, cursor);
      cursor += widths.get(child);
    }
  }
  for (let index = order.length - 1; index >= 0; index--) {
    const id = order[index], descendants = children.get(id);
    const x = descendants.length
      ? (positions.get(descendants[0]).x + positions.get(descendants.at(-1)).x) / 2
      : left.get(id) + 50;
    positions.set(id, { x, y: 80 + depths.get(id) * verticalGap });
  }
  let disconnectedX = 50;
  for (const node of nodes) {
    if (positions.has(node.id)) continue;
    positions.set(node.id, { x: disconnectedX, y: 80 + (maxDepth + 1) * verticalGap });
    disconnectedX += 100;
  }
  return positions;
}
