import { getEmployeeLocations, getLocationValues } from './employeeLocations.js';

function companyName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return !name || ['na', 'n/a', 'none', 'null', 'nan', 'no client', 'no clients'].includes(name.toLowerCase()) ? null : name;
}

export function getCurrentCompanies(employees = [], jobs = []) {
  return [...new Set([
    ...employees.flatMap(employee => [employee.client_name, ...(employee.client_names || [])]),
    ...jobs.map(job => job.client),
  ].map(companyName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function getReferencedLocations(employees = [], jobs = []) {
  return getLocationValues([...employees.flatMap(getEmployeeLocations), ...jobs.map(job => job.location).filter(Boolean)]);
}

export function pruneDeletedJobNodes(graph, companies, jobs, employees = []) {
  const activeCompanies = new Set(companies), jobIds = new Set(jobs.map(job => job.id));
  const locations = new Set(getReferencedLocations(employees, jobs));
  const nodes = graph.nodes.filter(node =>
    (node.type !== 'Client' || activeCompanies.has(node.label || node.id)) &&
    (node.type !== 'Job' || jobIds.has(node.id)) &&
    (node.type !== 'Location' || locations.has(node.label || node.id)));
  if (nodes.length === graph.nodes.length) return graph;
  const ids = new Set(nodes.map(node => node.id));
  const nodeId = value => typeof value === 'object' ? value.id : value;
  return { ...graph, nodes, links: graph.links.filter(link => ids.has(nodeId(link.source)) && ids.has(nodeId(link.target))) };
}
