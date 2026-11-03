import { useEffect, useMemo } from 'react';
import { getSoftblockJobOptions } from './openJobs';

export default function SoftblockJobFields({ jobs, value, onChange, disabled = false }) {
  const { companies, positions } = useMemo(
    () => getSoftblockJobOptions(jobs, value.company_name), [jobs, value.company_name]
  );
  const company = companies.includes(value.company_name) ? value.company_name : '';
  const position = positions.includes(value.job_position) ? value.job_position : '';

  // Clear a selection if its job was deleted or closed during the refresh cycle.
  useEffect(() => {
    if (company !== value.company_name || position !== value.job_position) {
      onChange({ company_name: company, job_position: position });
    }
  }, [company, position, value, onChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
      <label className="form-label" style={{ marginBottom: 0 }}>Company Name
        <select className="form-select" value={company} disabled={disabled || !companies.length}
          onChange={event => onChange({ company_name: event.target.value, job_position: '' })}>
          <option value="">{companies.length ? 'Select a company' : 'No open jobs available'}</option>
          {companies.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className="form-label" style={{ marginBottom: 0 }}>Job Position
        <select className="form-select" value={position} disabled={disabled || !company}
          onChange={event => onChange({ company_name: company, job_position: event.target.value })}>
          <option value="">{company ? 'Select an open job position' : 'Select a company first'}</option>
          {positions.map(role => <option key={role} value={role}>{role}</option>)}
        </select>
      </label>
      {!companies.length && (
        <div role="status" style={{ fontSize: 12, color: '#4B5563' }}>
          Add an open job with a company name in the Jobs tab to soft-block an employee.
        </div>
      )}
    </div>
  );
}
