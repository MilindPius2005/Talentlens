export function getSoftblockJobOptions(jobs = [], companyName = '') {
  const openJobs = jobs.filter(job => String(job.status || '').trim().toUpperCase() === 'OPEN')
    .map(job => ({ company: String(job.client || '').trim(), role: String(job.role || '').trim() }))
    .filter(job => job.company && job.role);
  return {
    companies: [...new Set(openJobs.map(job => job.company))].sort((a, b) => a.localeCompare(b)),
    positions: [...new Set(openJobs.filter(job => job.company === companyName).map(job => job.role))]
      .sort((a, b) => a.localeCompare(b)),
  };
}

export function isOpenJobSelection(jobs, selection) {
  return getSoftblockJobOptions(jobs, selection.company_name).positions.includes(selection.job_position);
}
