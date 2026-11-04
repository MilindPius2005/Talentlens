export function getDeploymentStatuses(employees = [], additionalStatuses = []) {
  return [...new Set([
    ...additionalStatuses,
    ...employees.map(employee => employee.deployment_status || employee.status),
  ].filter(status => typeof status === 'string' && status.trim())
    .map(status => status.trim().toUpperCase()))].sort();
}

// API employees already carry the assignment-aware deployment status. Reconcile
// visible graphs when polling delivers an edit made in another screen/session.
export function reconcileEmployeeGraph(graph, employees, status = '', rootNode = null) {
  const byId = new Map(employees.map(employee => [employee.id, employee]));
  const byName = new Map(employees.filter(employee => employee.name).map(employee => [employee.name, employee]));
  let changed = false;
  const nodes = [];
  for (const node of graph.nodes) {
    if (node.type !== 'Employee') {
      nodes.push(node);
      continue;
    }
    const employee = byId.get(node.id) || byName.get(node.label);
    let current = node;
    // A graph response may be newer than the last employee poll.
    if (employee && (!node.updated_at || !employee.updated_at || employee.updated_at >= node.updated_at)
        && Object.keys(employee).some(key => employee[key] !== node[key])) {
      current = { ...node, ...employee };
      changed = true;
    }
    const deployment = (current.deployment_status || current.status || '').trim().toUpperCase();
    if (status && deployment !== status.trim().toUpperCase()) {
      changed = true;
      if (node.id === rootNode || node.label === rootNode) return { nodes: [], links: [] };
      continue;
    }
    nodes.push(current);
  }
  if (!changed) return graph;
  const ids = new Set(nodes.map(node => node.id));
  const id = value => typeof value === 'object' ? value.id : value;
  return { ...graph, nodes, links: graph.links.filter(link => ids.has(id(link.source)) && ids.has(id(link.target))) };
}
