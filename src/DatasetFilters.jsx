import React, { useState, useEffect } from 'react';
import './index.css';
import { getDeploymentStatuses } from './deploymentStatuses';

export default function DatasetFilters({ onFilterChange, API_BASE, employees = [] }) {
  const [options, setOptions] = useState({
    clients: [], skills: [], levels: [],
    deploymentStatuses: [], benchMin: 0, benchMax: 365
  });

  const [benchRange, setBenchRange] = useState({ min: 0, max: 365 });
  const [filters, setFilters] = useState({
    client: "",
    status: "",
    level: "",
    skills: []
  });
  const deploymentStatuses = getDeploymentStatuses(employees, options.deploymentStatuses || []);

  useEffect(() => {
    fetch(`${API_BASE}/filter-options`, { credentials: "include" })
      .then(async res => {
        if (!res.ok) return null;
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      })
      .then(data => {
        if (data && !data.error) {
          setOptions(data);
          setBenchRange({ min: data.benchMin || 0, max: data.benchMax || 365 });
        }
      })
      .catch(e => console.error("Failed to load filter options", e));
  }, [API_BASE]);

  const handleChange = (key, val) => {
    const newFilters = { ...filters, [key]: val };
    setFilters(newFilters);
    onFilterChange(newFilters, benchRange);
  };

  const handleBenchChange = (key, val) => {
    const newRange = { ...benchRange, [key]: Number(val) };
    setBenchRange(newRange);
    onFilterChange(filters, newRange);
  };

  const toggleSkill = (skill) => {
    const newSkills = filters.skills.includes(skill)
      ? filters.skills.filter(s => s !== skill)
      : [...filters.skills, skill];
    const newFilters = { ...filters, skills: newSkills };
    setFilters(newFilters);
    onFilterChange(newFilters, benchRange);
  };

  const handleReset = () => {
    const emptyFilters = {
      client: "",
      status: "",
      level: "",
      skills: []
    };
    const defaultBench = { min: options.benchMin || 0, max: options.benchMax || 365 };
    setFilters(emptyFilters);
    setBenchRange(defaultBench);
    onFilterChange(emptyFilters, defaultBench);
  };

  return (
    <div style={{
      width: "300px", padding: "16px", background: "#ffffff", borderRight: "1px solid #E2E6EF",
      display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto", height: "100%"
    }}>
      <h3 style={{ margin: 0, fontSize: "16px", color: "#1E2233" }}>Graph Filters</h3>

      <div>
        <label className="form-label" style={{ display: "block", marginBottom: 8 }}>Bench Aging (Days)</label>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input type="number" className="form-input" value={benchRange.min} min={options.benchMin} max={benchRange.max} onChange={e => handleBenchChange('min', e.target.value)} style={{ width: "80px" }} />
          <span style={{ color: "#4B5563" }}>to</span>
          <input type="number" className="form-input" value={benchRange.max} min={benchRange.min} max={options.benchMax} onChange={e => handleBenchChange('max', e.target.value)} style={{ width: "80px" }} />
        </div>
        <div style={{ fontSize: "11px", color: "#4B5563", marginTop: 4 }}>Dataset Range: {options.benchMin} - {options.benchMax}</div>
      </div>

      <div>
        <label className="form-label" style={{ display: "block", marginBottom: 8 }}>Client Name</label>
        <select className="form-input" value={filters.client} onChange={e => handleChange('client', e.target.value)}>
          <option value="" hidden></option>
          <option value="__ALL_CLIENTS__">All Clients</option>
          <option value="__NO_CLIENT__">No Clients</option>
          {options.clients.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div>
        <label className="form-label" style={{ display: "block", marginBottom: 8 }}>Deployment Status</label>
        <select className="form-input" value={filters.status} onChange={e => handleChange('status', e.target.value)}>
          <option value="">All Statuses</option>
          {deploymentStatuses.map(status => (
            <option key={status} value={status}>{status.charAt(0) + status.slice(1).toLowerCase()}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="form-label" style={{ display: "block", marginBottom: 8 }}>Campus / Lateral (Level)</label>
        <select className="form-input" value={filters.level} onChange={e => handleChange('level', e.target.value)}>
          <option value="">All Levels</option>
          {options.levels.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div>
        <label className="form-label" style={{ display: "block", marginBottom: 8 }}>Skills (Multi-Select AND)</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {options.skills.length === 0 && <span style={{ color: "#4B5563", fontSize: 13 }}>No skills available</span>}
          {options.skills.map(s => (
            <div 
              key={s} 
              onClick={() => toggleSkill(s)}
              style={{
                padding: "4px 8px", borderRadius: "12px", fontSize: "12px", cursor: "pointer",
                background: filters.skills.includes(s) ? "var(--primary)" : "#F7F8FA",
                color: filters.skills.includes(s) ? "#fff" : "#4B5563",
                border: "1px solid",
                borderColor: filters.skills.includes(s) ? "var(--primary)" : "#E2E6EF",
              }}
            >
              {s}
            </div>
          ))}
        </div>
      </div>
      
      <button 
        onClick={handleReset}
        style={{ 
          marginTop: "10px", 
          padding: "8px 16px", 
          background: "#F1F5F9", 
          border: "1px solid #CBD5E1", 
          borderRadius: "8px", 
          color: "#475569", 
          fontWeight: 600, 
          fontSize: "13px", 
          cursor: "pointer",
          width: "100%"
        }}
        onMouseOver={(e) => { e.currentTarget.style.background = "#E2E8F0"; e.currentTarget.style.color = "#1E293B"; }}
        onMouseOut={(e) => { e.currentTarget.style.background = "#F1F5F9"; e.currentTarget.style.color = "#475569"; }}
      >
        ↺ Reset Filters
      </button>
    </div>
  );
}
