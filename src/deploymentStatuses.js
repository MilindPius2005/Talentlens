export function getDeploymentStatuses(employees = [], additionalStatuses = []) {
  return [...new Set([
    ...additionalStatuses,
    ...employees.map(employee => employee.deployment_status || employee.status),
  ].filter(status => typeof status === 'string' && status.trim())
    .map(status => status.trim().toUpperCase()))].sort();
}
