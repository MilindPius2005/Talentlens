export function getLocationValues(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;\n]/) : [];
  return [...new Set(values.filter(item => typeof item === 'string').map(item => item.trim())
    .filter(item => item && !['na', 'n/a', 'none', 'null', 'nan'].includes(item.toLowerCase())))];
}

export function getEmployeeLocations(employee) {
  return getLocationValues(employee.locations ?? employee.location);
}

export function getLocationOptions(employees = [], serverLocations = []) {
  // The loaded roster is current; server facets are a fallback while it loads.
  const values = employees.length ? employees.flatMap(getEmployeeLocations) : serverLocations;
  return getLocationValues(values).sort((a, b) => a.localeCompare(b));
}
