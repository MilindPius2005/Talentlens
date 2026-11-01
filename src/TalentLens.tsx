// @ts-nocheck — This legacy component uses dynamic JavaScript data shapes.
import { useState, useEffect, useRef } from "react";
import * as d3 from "d3";
import DatasetFilters from './DatasetFilters';
import OntologyGraph from './OntologyGraph';
import SearchBar from './SearchBar';
import { useOntologyExplorer } from './useOntologyExplorer';
import { getDeploymentStatuses } from './deploymentStatuses';

const API_BASE = (import.meta.env.VITE_API_BASE || "/api").trim().replace(/\/+$/, "");

async function parseJsonSafe(res) {
  try {
    if (!res) return null;
    const text = await res.text();
    if (!text || !text.trim()) return null;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}


// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  navy:"#0D1B3E", navyM:"#152347", teal:"#0A7C88", tealL:"#E0F4F5",
  violet:"#5B4FCF", violetL:"#EEEAFB", amber:"#B8710F", amberL:"#FBF3E0",
  green:"#1A7A50", greenL:"#E2F5EC", red:"#C0392B", redL:"#FDECEA",
  slate:"#4B5563", muted:"#8B929E", line:"#E2E6EF", bg:"#F7F8FA",
  card:"#FFFFFF", text:"#1E2233",
};

const css = `

  /* Graph CSS from Knowledge Graphs */
  .graph-stage { position: relative; width: 100%; height: 100%; overflow: hidden; background-image: linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px); background-size: 34px 34px; }
  .graph-svg { display: block; width: 100%; height: 100%; }
  .graph-link { stroke: rgba(0,0,0,0.15); stroke-width: 1.4; }
  .graph-node { stroke: rgba(0,0,0,0.2); stroke-width: 1.4; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.1)); cursor: pointer; transition: r 180ms ease, stroke-width 180ms ease, opacity 180ms ease; }
  .graph-node:hover { stroke-width: 3; }
  .graph-node.root { stroke: #0f172a; }
  .graph-node.expanded { filter: drop-shadow(0 0 6px rgba(10,124,136,0.35)); }
  .graph-label { pointer-events: auto; cursor: pointer; fill: #1E2233; paint-order: stroke; stroke: #ffffff; stroke-width: 4px; stroke-linejoin: round; font-size: 11px; font-weight: 600; }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: ${T.bg}; color: ${T.text}; font-size: 14px; }
  button { cursor: pointer; border: none; outline: none; font-family: inherit; }
  input, select, textarea { font-family: inherit; outline: none; }
  .app { display: flex; height: 100vh; overflow: hidden; }
  .sidebar { width: 220px; background: ${T.navy}; display: flex;
             flex-direction: column; flex-shrink: 0; overflow-y: auto; }
  .sidebar-logo { padding: 20px 20px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .sidebar-logo-text { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: -0.3px; }
  .sidebar-logo-sub { font-size: 10px; color: rgba(255,255,255,0.4);
    letter-spacing: 1.5px; text-transform: uppercase; margin-top: 2px; }
  .nav-section { padding: 16px 12px 8px; font-size: 9px; color: rgba(255,255,255,0.3);
    letter-spacing: 1.5px; text-transform: uppercase; }
  .nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px;
    border-radius: 8px; cursor: pointer; color: rgba(255,255,255,0.6); font-size: 13.5px;
    font-weight: 500; margin: 1px 8px; transition: all 0.15s; }
  .nav-item:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .nav-item.active { background: ${T.teal}; color: #fff; }
  .nav-item .badge { margin-left: auto; background: ${T.amber}; color: #fff;
    font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px; }
  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .ticker { background: ${T.navy}; color: #fff; padding: 10px 24px;
    display: flex; align-items: center; gap: 24px; flex-shrink: 0; }
  .ticker-label { font-size: 10px; color: rgba(255,255,255,0.4);
    letter-spacing: 1.5px; text-transform: uppercase; }
  .ticker-value { font-size: 22px; font-weight: 700; color: ${T.amber}; font-variant-numeric: tabular-nums; }
  .ticker-divider { width: 1px; height: 32px; background: rgba(255,255,255,0.12); }
  .ticker-stat { display: flex; flex-direction: column; gap: 1px; }
  .page { flex: 1; overflow-y: auto; padding: 24px; }
  .page-header { margin-bottom: 20px; }
  .page-title { font-size: 22px; font-weight: 700; color: ${T.text}; }
  .page-sub { font-size: 13px; color: ${T.muted}; margin-top: 3px; }
  .card { background: ${T.card}; border-radius: 12px; border: 1px solid ${T.line}; padding: 20px; }
  .card-title { font-size: 13px; font-weight: 600; color: ${T.slate}; margin-bottom: 14px;
    text-transform: uppercase; letter-spacing: 0.5px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .grid4 { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; }
  .stat-card { background: ${T.card}; border-radius: 12px; border: 1px solid ${T.line}; padding: 18px 20px; }
  .stat-value { font-size: 32px; font-weight: 700; line-height: 1; }
  .stat-label { font-size: 12px; color: ${T.muted}; margin-top: 6px; }
  .stat-delta { font-size: 11px; margin-top: 4px; font-weight: 500; }
  .delta-down { color: ${T.red}; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; font-weight: 600; color: ${T.muted};
    text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 14px;
    border-bottom: 1px solid ${T.line}; white-space: nowrap; }
  td { padding: 12px 14px; border-bottom: 1px solid ${T.line}; font-size: 13.5px; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: ${T.bg}; }
  .badge-status { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px;
    border-radius: 20px; font-size: 11.5px; font-weight: 600; }
  .badge-available { background: ${T.tealL}; color: ${T.teal}; }
  .badge-softblock { background: ${T.amberL}; color: ${T.amber}; }
  .badge-training { background: ${T.violetL}; color: ${T.violet}; }
  .badge-mapped { background: ${T.greenL}; color: ${T.green}; }
  .badge-open { background: ${T.tealL}; color: ${T.teal}; }
  .badge-closed { background: ${T.bg}; color: ${T.muted}; border: 1px solid ${T.line}; }
  .badge-passed { background: ${T.greenL}; color: ${T.green}; }
  .badge-rejected { background: ${T.redL}; color: ${T.red}; }
  .badge-pending { background: ${T.amberL}; color: ${T.amber}; }
  .aging-wrap { display: flex; align-items: center; gap: 8px; }
  .aging-bar-bg { flex: 1; height: 6px; background: ${T.line}; border-radius: 3px; overflow: hidden; min-width: 60px; }
  .aging-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }
  .aging-days { font-size: 12px; font-weight: 600; min-width: 36px; }
  .skill-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .skill-chip { padding: 2px 8px; background: ${T.bg}; border: 1px solid ${T.line};
    border-radius: 6px; font-size: 11px; color: ${T.slate}; }
  .skill-chip.matched { background: ${T.tealL}; border-color: ${T.teal}; color: ${T.teal}; }
  .skill-chip.missing { background: ${T.redL}; border-color: ${T.red}; color: ${T.red}; }
  .skill-chip.gap { background: ${T.amberL}; border-color: ${T.amber}; color: ${T.amber}; }
  .btn { display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px;
    border-radius: 8px; font-size: 13px; font-weight: 600; transition: all 0.15s; }
  .btn-primary { background: ${T.teal}; color: #fff; }
  .btn-primary:hover { background: #0a6e78; }
  .btn-ghost { background: transparent; color: ${T.slate}; border: 1px solid ${T.line}; }
  .btn-ghost:hover { background: ${T.bg}; }
  .btn-violet { background: ${T.violet}; color: #fff; }
  .btn-sm { padding: 5px 11px; font-size: 12px; }
  .btn-amber { background: ${T.amber}; color: #fff; }
  .form-group { margin-bottom: 14px; }
  .form-label { display: block; font-size: 12px; font-weight: 600; color: ${T.slate}; margin-bottom: 5px; }
  .form-input { width: 100%; padding: 9px 12px; border: 1px solid ${T.line}; border-radius: 8px;
    font-size: 13.5px; color: ${T.text}; background: ${T.card}; }
  .form-select { width: 100%; padding: 9px 12px; border: 1px solid ${T.line}; border-radius: 8px;
    font-size: 13.5px; color: ${T.text}; background: ${T.card}; }
  .form-textarea { width: 100%; padding: 9px 12px; border: 1px solid ${T.line}; border-radius: 8px;
    font-size: 13.5px; color: ${T.text}; background: ${T.card}; resize: vertical; min-height: 80px; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(13,27,62,0.5); display: flex;
    align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .modal { background: ${T.card}; border-radius: 16px; padding: 28px; width: 100%;
    max-width: 540px; max-height: 88vh; overflow-y: auto; }
  .modal-title { font-size: 18px; font-weight: 700; margin-bottom: 20px; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;
    padding-top: 16px; border-top: 1px solid ${T.line}; }
  .ai-panel { background: ${T.violetL}; border: 1px solid #D8CFF3; border-radius: 10px;
    padding: 14px 16px; margin-top: 12px; }
  .ai-panel-title { font-size: 11px; font-weight: 700; color: ${T.violet};
    text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
  .ai-panel-body { font-size: 13px; color: #3B3080; line-height: 1.6; }
  .score-wrap { display: flex; align-items: center; gap: 8px; }
  .score-bar-bg { flex: 1; height: 8px; background: ${T.line}; border-radius: 4px; overflow: hidden; }
  .score-bar { height: 100%; border-radius: 4px; }
  .score-label { font-size: 12px; font-weight: 700; min-width: 36px; text-align: right; }
  .alert-item { display: flex; align-items: flex-start; gap: 14px; padding: 14px 0; border-bottom: 1px solid ${T.line}; }
  .alert-item:last-child { border-bottom: none; }
  .alert-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
  .empty { text-align: center; padding: 48px 24px; color: ${T.muted}; }
  .empty-icon { font-size: 36px; margin-bottom: 12px; }
  .empty-title { font-size: 15px; font-weight: 600; color: ${T.slate}; margin-bottom: 6px; }
  .loading { display: flex; align-items: center; gap: 8px; color: ${T.muted}; font-size: 13px; }
  .spinner { width: 16px; height: 16px; border: 2px solid ${T.line}; border-top-color: ${T.violet};
    border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 3px; }
`;

// ─── Seed data ────────────────────────────────────────────────────────────────
const INITIAL_EMPLOYEES = [];
const INITIAL_JOBS = [];
const INITIAL_ALERTS = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}
function agingColor(days) {
  if (days < 30) return T.green;
  if (days < 45) return T.amber;
  return T.red;
}
function agingPct(days) { return Math.min(100, (days / 90) * 100); }
function statusBadge(status) {
  const map = {
    AVAILABLE:["badge-status badge-available","● Available"],
    DEPLOYED:["badge-status badge-mapped","✓ Deployed"],
    SOFTBLOCKED:["badge-status badge-softblock","◐ Soft-blocked"],
    TRAINING:["badge-status badge-training","◈ Training"],
    MAPPED:["badge-status badge-mapped","✓ Mapped"],
  };
  const [cls, label] = map[status] || ["badge-status", status ? status.charAt(0) + status.slice(1).toLowerCase() : ""];
  return <span className={cls}>{label}</span>;
}
function matchScore(employee, job) {
  if (!job) return 0;
  const reqs = job.required_skills;
  let matched = 0;
  reqs.forEach(req => {
    const empSkill = employee.skills.find(s => s.name === req.name);
    if (empSkill && empSkill.proficiency >= req.min_proficiency) matched++;
  });
  const base = matched / reqs.length;
  let penalty = 0;
  employee.interviews.forEach(iv => {
    const fg = iv.feedback?.gaps || [];
    fg.forEach(g => { if (reqs.some(r => r.name === g.skill)) penalty += g.severity === "high" ? 0.15 : 0.08; });
  });
  return Math.max(0, Math.min(1, base - penalty));
}
function ScoreBar({ score }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? T.green : pct >= 40 ? T.amber : T.red;
  return (
    <div className="score-wrap">
      <div className="score-bar-bg"><div className="score-bar" style={{ width: pct+"%", background: color }} /></div>
      <span className="score-label" style={{ color }}>{pct}%</span>
    </div>
  );
}
function AgingBar({ days }) {
  const color = agingColor(days);
  return (
    <div className="aging-wrap">
      <div className="aging-bar-bg"><div className="aging-bar" style={{ width: agingPct(days)+"%", background: color }} /></div>
      <span className="aging-days" style={{ color }}>{days}d</span>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ employees, jobs, alerts, user, onLogout }) {
  const available = employees.filter(e => e.status === "AVAILABLE");
  const softblocked = employees.filter(e => e.status === "SOFTBLOCKED");
  const critical = available.filter(e => daysSince(e.available_since) >= 45);
  const openJobs = jobs.filter(j => j.status === "OPEN");
  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Live view of your bench — every idle day is a cost</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #E2E6EF", borderRadius: 12, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#4B5563", textTransform: "uppercase", letterSpacing: 0.5 }}>Profile Details</div>
          <div><div style={{ fontSize: 11, color: "#8B929E" }}>Name</div><div style={{ fontSize: 14, fontWeight: 600 }}>{user?.name || "Loading..."}</div></div>
          <div><div style={{ fontSize: 11, color: "#8B929E" }}>Email</div><div style={{ fontSize: 13 }}>{user?.email || "..."}</div></div>
          <button className="btn btn-ghost" style={{ marginTop: 4, width: "100%", justifyContent: "center" }} onClick={onLogout}>Logout</button>
        </div>
      </div>
      <div className="grid4" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-value" style={{ color: T.teal }}>{available.length}</div><div className="stat-label">Available on bench</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: T.amber }}>{critical.length}</div><div className="stat-label">Critical (45+ days)</div>{critical.length > 0 && <div className="stat-delta delta-down">↑ Needs attention</div>}</div>
        <div className="stat-card"><div className="stat-value" style={{ color: T.green }}>{openJobs.length}</div><div className="stat-label">Open jobs</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: T.amber }}>{softblocked.length}</div><div className="stat-label">Soft-blocked employees</div></div>
      </div>
      <div className="grid3" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-title">Recent HR alerts</div>
          {alerts.slice(-4).reverse().map(a => (
            <div key={a.id} className="alert-item">
              <div className="alert-dot" style={{ background:
                a.type==="SOFTBLOCK" ? T.amber :
                a.type==="RELEASE" ? T.green :
                a.type==="SOFTBLOCK_EXPIRY" ? T.red :
                (a.threshold >= 45 ? T.red : T.amber) }} />
              <div>
                <div style={{ fontSize:13, fontWeight:600 }}>{a.employee}</div>
                <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
                  {a.type === "SOFTBLOCK"
                    ? <>Soft-blocked for {a.job_description}{a.company_name ? ` @ ${a.company_name}` : ''} · by {a.softblocked_by} · {a.sent_at}</>
                    : a.type === "RELEASE"
                    ? <>Released{a.job_description ? <> from {a.job_description}</> : ""} · {a.sent_at}</>
                    : a.type === "SOFTBLOCK_EXPIRY"
                    ? <>⏰ Soft-block period ended for {a.job_description} · needs action · {a.sent_at}</>
                    : <>Day {a.threshold} alert · {a.sent_at} · {a.bench_age} days on bench</>}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-title">Bench aging snapshot</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {available.map(e => {
              const days = daysSince(e.available_since);
              return (
                <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:110, fontSize:13, fontWeight:500, flexShrink:0 }}>{e.name.split(" ")[0]}</div>
                  <AgingBar days={days} />
                  {days >= 45 && <span style={{ fontSize:11, color:T.red, fontWeight:700 }}>ALERT</span>}
                </div>
              );
            })}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Soft-blocked personnel</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {softblocked.length === 0 && <div style={{ fontSize:12, color:T.muted }}>No employees are currently soft-blocked.</div>}
            {softblocked.map(e => (
              <div key={e.id} style={{ display:"flex", flexDirection:"column", gap:2, paddingBottom:8, borderBottom:`1px solid ${T.line}` }}>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:13, fontWeight:600 }}>{e.name}</span>
                  <span style={{ fontSize:11, color:T.amber }}>{e.softblock_expiry ? "Expires " + e.softblock_expiry : ""}</span>
                </div>
                <div style={{ fontSize:12, color:T.muted }}>{[e.softblock_job, e.softblock_company].filter(Boolean).join(' @ ') || "Opportunity"}</div>
                <div style={{ fontSize:11, color:T.muted }}>By {e.softblock_manager || "Manager"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-title">Skill supply overview</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {(() => {
            const skillMap = {};
            employees.forEach(e => (e.skills || []).forEach(s => {
              const skillName = typeof s === "string" ? s : s?.name;
              if (!skillName) return;
              if (!skillMap[skillName]) skillMap[skillName] = 0;
              if (e.status === "AVAILABLE") skillMap[skillName]++;
            }));
            return Object.entries(skillMap).sort((a,b)=>b[1]-a[1]).map(([skill,count]) => (
              <div key={skill} style={{ padding:"6px 12px", background:T.bg, border:`1px solid ${T.line}`, borderRadius:8, fontSize:12, display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontWeight:600 }}>{skill}</span>
                <span style={{ background:T.teal, color:"#fff", padding:"1px 6px", borderRadius:10, fontSize:10, fontWeight:700 }}>{count}</span>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Employees ────────────────────────────────────────────────────────────────
function Employees({ employees, setEmployees, user, setAlerts, pendingRequests = [] }) {
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ name:"", status:"AVAILABLE", available_since:"", skills:"" });

  function addEmployee() {
    const e = {
      id: "E" + String(Date.now()).slice(-4), name: form.name, status: form.status, local_only: true,
      available_since: form.available_since, last_alerted: 0, interviews: [],
      skills: form.skills.split(",").map(s => { const [name, proficiency] = s.trim().split(":"); return { name: name?.trim(), proficiency: parseInt(proficiency) || 3 }; }).filter(s => s.name),
    };
    setEmployees(prev => [...prev, e]);
    setShowAdd(false);
    setForm({ name:"", status:"AVAILABLE", available_since:"", skills:"" });
  }

  return (
    <div>
      <div className="page-header" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div><div className="page-title">Employees</div><div className="page-sub">Bench roster — click any row to see full profile</div></div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add employee</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Deployment Status</th><th>Bench age</th><th>Skills</th><th>Interviews</th><th>Alert</th></tr></thead>
            <tbody>
              {employees.map(e => {
                const days = e.status !== "MAPPED" ? daysSince(e.available_since) : 0;
                const needsAlert = days >= 30 && e.status !== "MAPPED";
                const isPending = pendingRequests.some(r => r.employee_id === e.id || r.employee_name === e.name);
                return (
                  <tr key={e.id} style={{ cursor:"pointer", background: isPending ? "#FBF3E0" : "transparent" }} onClick={() => setSelected(e)}>
                    <td style={{ fontWeight:600 }}>{e.name} {isPending && <span style={{ fontSize: 10, padding: "2px 6px", background: "#B8710F", color: "#fff", borderRadius: 10, marginLeft: 6 }}>PENDING</span>}</td>
                    <td>{statusBadge(e.deployment_status || e.status)}</td>
                    <td style={{ minWidth:140 }}><AgingBar days={days} /></td>
                    <td><div className="skill-chips">{e.skills.slice(0,3).map(s => <span key={s.name} className="skill-chip">{s.name} {s.proficiency}</span>)}{e.skills.length > 3 && <span className="skill-chip">+{e.skills.length-3}</span>}</div></td>
                    <td style={{ color: T.muted }}>{e.interviews.length}</td>
                    <td>{needsAlert && days >= 45 ? <span style={{ color:T.red, fontSize:11, fontWeight:700 }}>Day {days} ●</span> : needsAlert ? <span style={{ color:T.amber, fontSize:11, fontWeight:700 }}>Day 30 ●</span> : <span style={{ color:T.line }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {selected && <EmployeeDetail emp={selected} user={user} setAlerts={setAlerts} onClose={() => setSelected(null)} onUpdate={(updated) => { setEmployees(prev => prev.map(e => e.id === updated.id ? updated : e)); setSelected(updated); }} />}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Add employee</div>
            <div className="form-group"><label className="form-label">Full name</label><input className="form-input" value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="Priya Sharma" /></div>
            <div className="form-group"><label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
                <option>AVAILABLE</option><option>SOFTBLOCKED</option><option>TRAINING</option><option>MAPPED</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Available since</label><input type="date" className="form-input" value={form.available_since} onChange={e => setForm(f=>({...f,available_since:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">Skills (name:level, comma separated)</label><input className="form-input" value={form.skills} onChange={e => setForm(f=>({...f,skills:e.target.value}))} placeholder="React:4, Node.js:3, AWS:3" /></div>
            <div className="modal-actions"><button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button><button className="btn btn-primary" onClick={addEmployee}>Add employee</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmployeeDetail({ emp, user, onClose, onUpdate, setAlerts }) {
  const [actionLoading, setActionLoading] = useState(false);
  const [showSoftblockForm, setShowSoftblockForm] = useState(false);
  const [sbForm, setSbForm] = useState({ company_name: "", job_position: "" });
  
  const days = daysSince(emp.available_since);

  async function executeAction(action, payload = {}) {
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/employees/${encodeURIComponent(emp.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const resData = await parseJsonSafe(res);
          const todayStr = new Date().toISOString().split("T")[0];
          onUpdate({
            ...emp,
            ...resData?.employee,
            status: action === "softblock" ? "SOFTBLOCKED" : "AVAILABLE",
            deployment_status: resData?.employee?.deployment_status || (action === "softblock" ? "SOFTBLOCKED" : "AVAILABLE"),
            softblock_job: action === "softblock" ? payload.job_position : null,
            softblock_company: action === "softblock" ? payload.company_name : null,
            softblock_manager: action === "softblock" ? (payload.manager_name || user?.name || "Admin") : null,
            softblock_start: action === "softblock" ? todayStr : null,
            softblock_expiry: action === "softblock" ? new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0] : null
          });
          if (setAlerts) {
            if (action === "softblock") {
              const newAlert = resData?.alert || {
                id: "SB" + String(Date.now()).slice(-6),
                type: "SOFTBLOCK",
                employee: emp.name,
                employee_id: emp.id,
                job_description: payload.job_position,
                company_name: payload.company_name,
                softblocked_by: payload.manager_name || user?.name || "Admin",
                expiry_date: new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
                sent_at: todayStr,
                recipient: "hr@company.com"
              };
              setAlerts(prev => [newAlert, ...prev]);
            } else if (action === "release") {
              const newAlert = resData?.alert || {
                id: "REL" + String(Date.now()).slice(-6),
                type: "RELEASE",
                employee: emp.name,
                employee_id: emp.id,
                job_description: emp.softblock_job || "Opportunity",
                sent_at: todayStr,
                recipient: "hr@company.com"
              };
              setAlerts(prev => [newAlert, ...prev]);
            }
          }

        setShowSoftblockForm(false);
      }
    } catch (e) {
      console.error(e);
      alert("Action failed.");
    }
    setActionLoading(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:600 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"start", marginBottom:20 }}>
          <div><div className="modal-title" style={{ marginBottom:4 }}>{emp.name}</div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>{statusBadge(emp.status)}<span style={{ fontSize:12, color:T.muted }}>{days} days on bench · since {emp.available_since}</span></div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ marginBottom:16 }}>
          <div className="card-title">Skills</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {emp.skills.map(s => (
              <div key={s.name} style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ width:130, fontSize:13, fontWeight:500 }}>{s.name}</span>
                <div style={{ display:"flex", gap:3 }}>{[1,2,3,4,5].map(n => <div key={n} style={{ width:18, height:6, borderRadius:3, background: n <= s.proficiency ? T.teal : T.line }} />)}</div>
                <span style={{ fontSize:11, color:T.muted }}>L{s.proficiency}</span>
              </div>
            ))}
          </div>
        </div>
        {emp.interviews.length > 0 && (
          <div style={{ marginBottom:16 }}>
            <div className="card-title">Interview history</div>
            {emp.interviews.map(iv => (
              <div key={iv.id} style={{ padding:"10px 0", borderBottom:`1px solid ${T.line}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                  <span style={{ fontWeight:600, fontSize:13 }}>{iv.client} · Round {iv.round}</span>
                  <span className={`badge-status badge-${iv.result?.toLowerCase()}`}>{iv.result}</span>
                </div>
                <div style={{ fontSize:12, color:T.muted }}>{iv.date} · {iv.type}</div>
                {iv.feedback?.gaps?.length > 0 && <div style={{ marginTop:6, display:"flex", gap:4, flexWrap:"wrap" }}>{iv.feedback.gaps.map(g => <span key={g.skill} className="skill-chip gap">⚠ {g.skill} ({g.severity})</span>)}</div>}
                {iv.feedback?.strengths?.length > 0 && <div style={{ marginTop:4, display:"flex", gap:4, flexWrap:"wrap" }}>{iv.feedback.strengths.map(s => <span key={s} className="skill-chip matched">✓ {s}</span>)}</div>}
              </div>
            ))}
          </div>
        )}

        {showSoftblockForm && (
          <div style={{ padding: 12, background: T.amberL, borderRadius: 8, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: T.amber, marginBottom: 8 }}>Soft-block Details</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input type="text" className="form-input" placeholder="Company Name" value={sbForm.company_name} onChange={e => setSbForm(prev => ({...prev, company_name: e.target.value}))} />
              <input type="text" className="form-input" placeholder="Job Position" value={sbForm.job_position} onChange={e => setSbForm(prev => ({...prev, job_position: e.target.value}))} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => executeAction("softblock", sbForm)} disabled={actionLoading || !sbForm.company_name.trim() || !sbForm.job_position.trim()}>{actionLoading ? "..." : "Submit"}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSoftblockForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ display:"flex", gap:8, flexWrap: "wrap" }}>
          {emp.status === "SOFTBLOCKED" ? (
            <button className="btn btn-primary btn-sm" onClick={() => executeAction("release")} disabled={actionLoading}>{actionLoading ? "..." : "Release from soft-block"}</button>
          ) : (emp.status === "AVAILABLE" || emp.status === "TRAINING") ? (
            <button className="btn btn-amber btn-sm" onClick={() => setShowSoftblockForm(true)}>◐ Soft-block</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────
function Jobs({ jobs, setJobs, employees }) {
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [jobError, setJobError] = useState("");
  const [form, setForm] = useState({ role:"", client:"", location:"", description:"", skills:"" });
  async function addJob() {
    if (busy) return;
    setJobError("");
    const j = {
      role: form.role.trim(), client: form.client.trim(),
      location: form.location.trim(), description: form.description,
      required_skills: form.skills.split(",").map(s => { const [name, min_proficiency] = s.trim().split(":"); return { name: name?.trim(), min_proficiency: parseInt(min_proficiency) || 3 }; }).filter(s => s.name),
    };
    if (!j.role) { setJobError("Enter a role title."); return; }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(j)
      });
      const data = await parseJsonSafe(response);
      if (!response.ok || !data?.job) throw new Error(data?.error || "Could not save the job.");
      setJobs(prev => prev.some(item => item.id === data.job.id) ? prev : [...prev, data.job]);
      setShowAdd(false);
      setForm({ role:"", client:"", location:"", description:"", skills:"" });
    } catch(e) {
      setJobError(e.message || "Could not save the job.");
    } finally {
      setBusy(false);
    }
  }
  async function deleteJob(job) {
    if (busy || !window.confirm(`Delete ${job.role}${job.client ? ` at ${job.client}` : ""}?`)) return;
    setBusy(true);
    setJobError("");
    try {
      const response = await fetch(`${API_BASE}/jobs/${encodeURIComponent(job.id)}`, {
        method: 'DELETE', credentials: 'include',
      });
      const data = await parseJsonSafe(response);
      if (!response.ok) throw new Error(data?.error || "Could not delete the job.");
      setJobs(prev => prev.filter(item => item.id !== job.id));
      if (selected?.id === job.id) setSelected(null);
    } catch(e) {
      setJobError(e.message || "Could not delete the job.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="page-header" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div><div className="page-title">Jobs</div><div className="page-sub">Open opportunities — click to find matching employees</div></div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ New job</button>
      </div>
      <div className="card">
        {jobError && <div role="alert" style={{ color:T.red, padding:"12px 16px" }}>{jobError}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Role</th><th>Client</th><th>Location</th><th>Required skills</th><th>Opened</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} style={{ cursor:"pointer" }} onClick={() => setSelected(j)}>
                  <td style={{ fontWeight:600 }}>{j.role}</td>
                  <td>{j.client}</td>
                  <td style={{ color:T.muted }}>{j.location}</td>
                  <td><div className="skill-chips">{j.required_skills.map(s => <span key={s.name} className="skill-chip">{s.name} L{s.min_proficiency}+</span>)}</div></td>
                  <td style={{ color:T.muted }}>{j.open_date}</td>
                  <td><span className={`badge-status badge-${j.status?.toLowerCase()}`}>{j.status}</span></td>
                  <td><button className="btn btn-ghost btn-sm" style={{ color:T.red }} disabled={busy} onClick={event => { event.stopPropagation(); deleteJob(j); }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {selected && <JobMatch job={selected} employees={employees} onClose={() => setSelected(null)} />}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">New job</div>
            {[["Role title","role","Senior Frontend Developer"],["Client","client","Acme Corp"],["Location","location","Bangalore"]].map(([label,key,ph]) => (
              <div key={key} className="form-group"><label className="form-label">{label}</label><input className="form-input" value={form[key]} onChange={e => setForm(f=>({...f,[key]:e.target.value}))} placeholder={ph} /></div>
            ))}
            <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} placeholder="Describe the role and requirements..." /></div>
            <div className="form-group"><label className="form-label">Required skills (name:min-level, comma separated)</label><input className="form-input" value={form.skills} onChange={e => setForm(f=>({...f,skills:e.target.value}))} placeholder="React:4, TypeScript:3, Node.js:3" /></div>
            {jobError && <div role="alert" style={{ color:T.red, marginBottom:8 }}>{jobError}</div>}
            <div className="modal-actions"><button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={addJob}>{busy ? "Saving..." : "Create job"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function JobMatch({ job, employees, onClose }) {
  const available = employees.filter(e => e.status === "AVAILABLE" || e.status === "TRAINING");
  const ranked = available.map(e => {
    const score = matchScore(e, job);
    const matched = job.required_skills.filter(req => { const sk = e.skills.find(s => s.name === req.name); return sk && sk.proficiency >= req.min_proficiency; }).map(r => r.name);
    const missing = job.required_skills.filter(req => !matched.includes(req.name)).map(r => r.name);
    const gaps = e.interviews.flatMap(i => i.feedback?.gaps?.map(g=>g.skill) || []).filter(g => job.required_skills.some(r => r.name === g));
    return { ...e, score, matched, missing, gaps };
  }).sort((a,b) => b.score - a.score);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:680 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"start", marginBottom:4 }}>
          <div className="modal-title">{job.role} — {job.client}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ marginBottom:16, display:"flex", gap:8, flexWrap:"wrap" }}>{job.required_skills.map(s => <span key={s.name} className="skill-chip">{s.name} L{s.min_proficiency}+</span>)}</div>
        <div className="card-title" style={{ marginBottom:12 }}>Ranked candidates ({ranked.length})</div>
        {ranked.map((e, idx) => (
          <div key={e.id} style={{ padding:"14px 0", borderBottom: idx < ranked.length-1 ? `1px solid ${T.line}` : "none" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
              <div style={{ width:24, height:24, borderRadius:"50%", background: idx === 0 ? T.teal : T.bg, border: `2px solid ${idx===0?T.teal:T.line}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color: idx===0?"#fff":T.muted, flexShrink:0 }}>{idx+1}</div>
              <div style={{ flex:1 }}><div style={{ fontWeight:600, fontSize:14 }}>{e.name}</div><div style={{ fontSize:12, color:T.muted }}>{daysSince(e.available_since)}d on bench</div></div>
              <div style={{ width:160 }}><ScoreBar score={e.score} /></div>
            </div>
            <div style={{ paddingLeft:36 }}>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:6 }}>
                {e.matched.map(s => <span key={s} className="skill-chip matched">✓ {s}</span>)}
                {e.missing.map(s => <span key={s} className="skill-chip missing">✗ {s}</span>)}
                {e.gaps.map(s => <span key={s} className="skill-chip gap">⚠ {s}</span>)}
              </div>
            </div>
          </div>
        ))}
        {ranked.length === 0 && <div className="empty"><div className="empty-icon">🔍</div><div className="empty-title">No available employees found</div><div>Everyone is currently mapped or unavailable.</div></div>}
      </div>
    </div>
  );
}

// ─── Interviews ───────────────────────────────────────────────────────────────
function Interviews({ employees, setEmployees }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ employee_id:"", client:"", round:1, type:"CLIENT", result:"", feedback_text:"" });
  const allInterviews = employees.flatMap(e => e.interviews.map(i => ({ ...i, employee: e.name, emp_id: e.id, emp_skills: e.skills }))).sort((a,b) => new Date(b.date) - new Date(a.date));
  function saveInterview() {
    const interview = { id: "I" + String(Date.now()).slice(-4), date: new Date().toISOString().split("T")[0], round: Number(form.round), type: form.type, client: form.client, result: form.result, feedback: { sentiment:"", recommendation:"", gaps:[], strengths:[] } };
    setEmployees(prev => prev.map(e => e.id === form.employee_id ? { ...e, interviews: [...e.interviews, interview] } : e));
    setShowAdd(false);
    setForm({ employee_id:"", client:"", round:1, type:"CLIENT", result:"", feedback_text:"" });
  }
  return (
    <div>
      <div className="page-header" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div><div className="page-title">Interviews</div><div className="page-sub">Log interviews and track skill gaps</div></div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Log interview</button>
      </div>
      <div className="card">
        {allInterviews.length === 0 ? (
          <div className="empty"><div className="empty-icon">💬</div><div className="empty-title">No interviews logged yet</div><div>Log an interview to start tracking feedback and skill gaps.</div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Client</th><th>Date</th><th>Round</th><th>Result</th><th>Gaps flagged</th><th>Strengths</th></tr></thead>
              <tbody>
                {allInterviews.map(iv => (
                  <tr key={iv.id}>
                    <td style={{ fontWeight:600 }}>{iv.employee}</td>
                    <td>{iv.client}</td>
                    <td style={{ color:T.muted }}>{iv.date}</td>
                    <td style={{ color:T.muted }}>R{iv.round}</td>
                    <td><span className={`badge-status badge-${iv.result?.toLowerCase()}`}>{iv.result||"—"}</span></td>
                    <td><div className="skill-chips">{(iv.feedback?.gaps||[]).map(g => <span key={g.skill} className="skill-chip gap">⚠ {g.skill}</span>)}{(!iv.feedback?.gaps?.length) && <span style={{ color:T.line }}>—</span>}</div></td>
                    <td><div className="skill-chips">{(iv.feedback?.strengths||[]).map(s => <span key={s} className="skill-chip matched">✓ {s}</span>)}{(!iv.feedback?.strengths?.length) && <span style={{ color:T.line }}>—</span>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" style={{ maxWidth:560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">Log interview</div>
            <div className="grid2">
              <div className="form-group"><label className="form-label">Employee</label>
                <select className="form-select" value={form.employee_id} onChange={e => setForm(f=>({...f,employee_id:e.target.value}))}>
                  <option value="">Select...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Client</label><input className="form-input" value={form.client} onChange={e => setForm(f=>({...f,client:e.target.value}))} placeholder="Acme Corp" /></div>
              <div className="form-group"><label className="form-label">Round</label><input type="number" className="form-input" value={form.round} min={1} onChange={e => setForm(f=>({...f,round:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">Result</label>
                <select className="form-select" value={form.result} onChange={e => setForm(f=>({...f,result:e.target.value}))}>
                  <option value="">Select...</option><option>PASSED</option><option>REJECTED</option><option>OFFERED</option><option>PENDING</option>
                </select>
              </div>
            </div>
            <div className="form-group"><label className="form-label">Feedback notes (free text)</label><textarea className="form-textarea" style={{ minHeight:100 }} value={form.feedback_text} onChange={e => setForm(f=>({...f,feedback_text:e.target.value}))} placeholder="e.g. Strong on React and frontend, but struggled with system design questions..." /></div>
            <div className="modal-actions"><button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button><button className="btn btn-primary" onClick={saveInterview} disabled={!form.employee_id || !form.client || !form.result}>Save interview</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Alerts ───────────────────────────────────────────────────────────────────
function Alerts({ employees, alerts, onUnblock, onSnooze }) {
  const sortedAlerts = [...alerts].sort((a,b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
  return (
    <div>
      <div className="page-header" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div><div className="page-title">HR Alerts</div><div className="page-sub">Employee changes and bench reminders update automatically</div></div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:16, marginBottom:20 }}>
        <div className="stat-card"><div className="stat-value" style={{ color:T.amber }}>{employees.filter(e => e.status==="AVAILABLE" && daysSince(e.available_since)>=30 && daysSince(e.available_since)<45).length}</div><div className="stat-label">Day 30 threshold (first alert)</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color:T.amber }}>{employees.filter(e => e.status==="SOFTBLOCKED").length}</div><div className="stat-label">Active soft-blocks</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color:T.red }}>{alerts.filter(a=>a.type==="SOFTBLOCK_EXPIRY").length}</div><div className="stat-label">Soft-block reminders pending</div></div>
      </div>
      <div className="card">
        <div className="card-title" style={{ marginBottom:16 }}>Alert history</div>
        {sortedAlerts.length === 0 ? (
          <div className="empty"><div className="empty-icon">🔔</div><div className="empty-title">No activity yet</div><div>Employee changes and bench reminders will appear here automatically.</div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Type</th><th>Details</th><th>Sent</th><th>Recipient</th></tr></thead>
              <tbody>
                {sortedAlerts.map(a => (
                  <tr key={a.id}>
                    <td style={{ fontWeight:600 }}>{a.employee}</td>
                    <td>
                      {a.type === "SOFTBLOCK"
                        ? <span className="badge-status badge-softblock">◐ Soft-block</span>
                        : a.type === "RELEASE"
                        ? <span className="badge-status badge-mapped">✓ Released</span>
                        : a.type === "SOFTBLOCK_EXPIRY"
                        ? <span className="badge-status badge-rejected">⏰ Reminder</span>
                        : a.type === "SNOOZE"
                        ? <span className="badge-status badge-softblock">◷ Snoozed</span>
                        : a.type === "INGESTION"
                        ? <span className="badge-status badge-mapped">↑ Ingested</span>
                        : a.type === "JOB_CREATED"
                        ? <span className="badge-status badge-mapped">+ Job</span>
                        : a.type === "JOB_DELETED"
                        ? <span className="badge-status badge-rejected">− Job deleted</span>
                        : <span className={`badge-status ${a.threshold >= 45 ? "badge-rejected" : "badge-softblock"}`}>Day {a.threshold}</span>}
                    </td>
                    <td style={{ fontWeight:600, color: a.type==="SOFTBLOCK" ? T.amber : a.type==="RELEASE" ? T.green : a.type==="SOFTBLOCK_EXPIRY" ? T.red : (a.bench_age>=45?T.red:T.amber) }}>
                      {a.type === "SOFTBLOCK" ? (
                        <div>
                          <div>{a.job_description || "Opportunity"}{a.company_name ? ` @ ${a.company_name}` : ""} <span style={{ fontWeight:400, color:T.muted }}>· by {a.softblocked_by || "Admin"}{a.expiry_date ? ` · expires ${a.expiry_date}` : ""}</span></div>
                          {employees.some(e => (e.id === a.employee_id || e.name === a.employee) && e.status === "SOFTBLOCKED") && <div style={{ display:"flex", gap:8, marginTop:6 }}>
                            <button className="btn btn-ghost btn-sm" style={{ color:T.green, borderColor:T.green }} onClick={() => onUnblock && onUnblock(a)}>Release</button>
                          </div>}
                        </div>
                      ) : a.type === "RELEASE" ? (
                        <>Released{a.job_description ? <> from {a.job_description}</> : ""}</>
                      ) : a.type === "SNOOZE" ? (
                        <>Reminder snoozed until {a.expiry_date}</>
                      ) : a.type === "INGESTION" ? (
                        <>{a.rows_processed} employees from {a.filename}{a.neo4j_pending ? " · graph sync pending" : ""}</>
                      ) : a.type === "JOB_CREATED" ? (
                        <>{a.job_description}{a.company_name ? ` @ ${a.company_name}` : ""}{a.neo4j_pending ? " · graph sync pending" : ""}</>
                      ) : a.type === "JOB_DELETED" ? (
                        <>{a.job_description}{a.company_name ? ` @ ${a.company_name}` : ""} removed{a.neo4j_pending ? " · graph sync pending" : ""}</>
                      ) : a.type === "SOFTBLOCK_EXPIRY" ? (
                        <div>
                          <div>{a.job_description} <span style={{ fontWeight:400, color:T.muted }}>· blocked by {a.softblocked_by} · period ended {a.expiry_date}</span></div>
                          <div style={{ display:"flex", gap:8, marginTop:8 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => onUnblock && onUnblock(a)}>Unblock</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => onSnooze && onSnooze(a)}>Snooze 15 days</button>
                          </div>
                        </div>
                      ) : `${a.bench_age} days`}
                    </td>
                    <td style={{ color:T.muted }}>{a.sent_at}</td>
                    <td style={{ color:T.muted }}>{a.recipient}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── colour tokens (match TalentLens palette) ────────────────────────────────
const COL = {
  navy:"#0D1B3E", navyM:"#152347", teal:"#0A7C88", tealL:"#E0F4F5",
  violet:"#5B4FCF", violetL:"#EEEAFB", amber:"#B8710F", amberL:"#FBF3E0",
  green:"#1A7A50", greenL:"#E2F5EC", red:"#C0392B", redL:"#FDECEA",
  slate:"#4B5563", muted:"#8B929E", line:"#E2E6EF", bg:"#F7F8FA",
  card:"#FFFFFF", text:"#1E2233",
};

// ─── raw graph data — Aisha Patel is a working EXAMPLE: her 15-day soft-block
// period already ended (expiry in the past), so the expiry reminder fires
// immediately with Unblock / Snooze options in the Alerts tab. ────────────────
const EMPLOYEES = [
  { id:"E001", name:"Priya Sharma", status:"AVAILABLE", bench_days:59, location:"Bangalore",
    skills:[{id:"SK_REACT",name:"React",prof:5},{id:"SK_NODE",name:"Node.js",prof:4},{id:"SK_AWS",name:"AWS",prof:3},{id:"SK_TS",name:"TypeScript",prof:4}],
    interviews:[
      { id:"I001", client:"Acme Corp", round:1, result:"REJECTED", date:"2026-06-01", feedback:{ id:"F001", sentiment:"mixed", rec:"no", gaps:[{id:"SK_SYSDES",name:"System Design",severity:"high"}], strengths:["React","TypeScript"] }},
      { id:"I002", client:"TechCo", round:1, result:"PASSED", date:"2026-06-15", feedback:{ id:"F002", sentiment:"positive", rec:"yes", gaps:[], strengths:["React","Node.js"] }},
    ]},
  { id:"E002", name:"Arjun Mehta", status:"AVAILABLE", bench_days:44, location:"Mumbai",
    skills:[{id:"SK_PYTHON",name:"Python",prof:5},{id:"SK_ML",name:"ML",prof:4},{id:"SK_AWS",name:"AWS",prof:4},{id:"SK_FASTAPI",name:"FastAPI",prof:3}],
    interviews:[{ id:"I003", client:"DataCorp", round:1, result:"REJECTED", date:"2026-06-10", feedback:{ id:"F003", sentiment:"negative", rec:"no", gaps:[{id:"SK_AWS",name:"AWS",severity:"medium"},{id:"SK_SYSDES",name:"System Design",severity:"high"}], strengths:["Python","ML"] }}]},
  { id:"E003", name:"Meera Nair", status:"TRAINING", bench_days:49, location:"Remote",
    skills:[{id:"SK_REACT",name:"React",prof:4},{id:"SK_VUE",name:"Vue.js",prof:4},{id:"SK_CSS",name:"CSS",prof:5},{id:"SK_NODE",name:"Node.js",prof:3}],
    interviews:[]},
  { id:"E004", name:"Ravi Kumar", status:"AVAILABLE", bench_days:32, location:"Pune",
    skills:[{id:"SK_JAVA",name:"Java",prof:5},{id:"SK_SPRING",name:"Spring Boot",prof:4},{id:"SK_K8S",name:"Kubernetes",prof:3}],
    interviews:[]},
  { id:"E005", name:"Aisha Patel", status:"SOFTBLOCKED", bench_days:84, location:"Bangalore",
    skills:[{id:"SK_SQL",name:"SQL",prof:3},{id:"SK_AGILE",name:"Agile",prof:4}],
    softblock_job:"ML Engineer @ DataVision",
    softblock_manager:"Karan Mehta",
    softblock_start:"2026-06-10",
    softblock_expiry:"2026-06-25",
    interviews:[{ id:"I004", client:"StartupX", round:1, result:"REJECTED", date:"2026-05-20", feedback:{ id:"F004", sentiment:"mixed", rec:"no", gaps:[{id:"SK_AGILE",name:"Technical depth",severity:"medium"}], strengths:[] }}]},
  { id:"E006", name:"Dev Krishnan", status:"AVAILABLE", bench_days:23, location:"Chennai",
    skills:[{id:"SK_REACT",name:"React",prof:3},{id:"SK_TS",name:"TypeScript",prof:3},{id:"SK_GQL",name:"GraphQL",prof:4}],
    interviews:[]},
];

const SKILLS_LIST = [
  {id:"SK_REACT",name:"React"},{id:"SK_NODE",name:"Node.js"},{id:"SK_AWS",name:"AWS"},{id:"SK_TS",name:"TypeScript"},
  {id:"SK_PYTHON",name:"Python"},{id:"SK_ML",name:"ML"},{id:"SK_JAVA",name:"Java"},{id:"SK_K8S",name:"Kubernetes"},
  {id:"SK_VUE",name:"Vue.js"},{id:"SK_CSS",name:"CSS"},{id:"SK_GQL",name:"GraphQL"},{id:"SK_SQL",name:"SQL"},
  {id:"SK_SYSDES",name:"System Design"},{id:"SK_FASTAPI",name:"FastAPI"},{id:"SK_SPRING",name:"Spring Boot"},{id:"SK_AGILE",name:"Agile"},
];

const STATUSES = ["ALL","AVAILABLE","SOFTBLOCKED","TRAINING"];
const LOCATIONS = ["ALL","Bangalore","Mumbai","Remote","Pune","Chennai"];

const GRAPH_JOBS = [
  { id:"J001", role:"Senior Frontend Developer", client:"Acme Corp" },
  { id:"J002", role:"ML Engineer", client:"DataVision" },
  { id:"J003", role:"Backend Java Engineer", client:"FinServ Ltd" },
];
const SOFTBLOCK_DAYS = 15;
// API_BASE defined at top of file

function buildTree(skillFilter, statusFilter, employeesList, nameQuery, locationFilter) {
  let employees = employeesList || EMPLOYEES;
  if (statusFilter !== "ALL") employees = employees.filter(e => e.status === statusFilter);
  if (skillFilter !== "ALL") employees = employees.filter(e => e.skills.some(s => s.id === skillFilter));
  if (locationFilter && locationFilter !== "ALL") employees = employees.filter(e => e.location === locationFilter);
  if (nameQuery && nameQuery.trim()) {
    const q = nameQuery.trim().toLowerCase();
    employees = employees.filter(e => e.name.toLowerCase().includes(q));
  }
  return {
    id:"__root__", type:"root", name:"TalentLens",
    children: employees.map(e => ({
      id:e.id, type:"Employee", name:e.name, status:e.status, bench_days:e.bench_days, location:e.location,
      softblock_job:e.softblock_job||null, softblock_manager:e.softblock_manager||null, softblock_expiry:e.softblock_expiry||null,
      _raw:e, _expanded:false, children:[],
    })),
  };
}

function buildEmployeeSubtree(e) {
  const children = [];
  if (e.skills.length) children.push({ id:e.id+"_skills", type:"_group", name:"Skills", _groupColor:COL.slate, children: e.skills.map(s => ({ id:e.id+"_"+s.id, type:"Skill", name:s.name, proficiency:s.prof, skill_id:s.id, children:[] })) });
  if (e.interviews.length) children.push({
    id:e.id+"_interviews", type:"_group", name:"Interviews", _groupColor:COL.violet,
    children: e.interviews.map(iv => ({
      id:iv.id, type:"Interview", name:iv.client+" R"+iv.round, result:iv.result, date:iv.date,
      children: iv.feedback ? [{
        id:iv.feedback.id, type:"Feedback", name:iv.feedback.sentiment, sentiment:iv.feedback.sentiment, recommendation:iv.feedback.rec,
        children: [
          ...(iv.feedback.gaps||[]).map(g => ({ id:iv.id+"_gap_"+g.id, type:"Skill", name:"⚠ "+g.name, severity:g.severity, isGap:true, children:[] })),
          ...(iv.feedback.strengths||[]).map((s,i) => ({ id:iv.id+"_str_"+i, type:"Skill", name:"✓ "+s, isStrength:true, children:[] })),
        ],
      }] : [],
    })),
  });
  return children;
}

function statusColor(s) {
  if (s === "AVAILABLE") return COL.teal;
  if (s === "SOFTBLOCKED") return COL.amber;
  if (s === "TRAINING") return COL.violet;
  return COL.green;
}

function Pill({ label, fg, bg }) {
  return <span style={{ display:"inline-flex", alignItems:"center", padding:"2px 9px", borderRadius:20, fontSize:11, fontWeight:600, background:bg, color:fg }}>{label}</span>;
}

function statusPill(status) {
  const map = {
    AVAILABLE:[COL.teal,COL.tealL,"Available"], SOFTBLOCKED:[COL.amber,COL.amberL,"Soft-blocked"],
    TRAINING:[COL.violet,COL.violetL,"Training"], positive:[COL.green,COL.greenL,"Positive"],
    mixed:[COL.amber,COL.amberL,"Mixed"], negative:[COL.red,COL.redL,"Negative"],
    PASSED:[COL.green,COL.greenL,"Passed"], REJECTED:[COL.red,COL.redL,"Rejected"],
  };
  const [fg,bg,lbl] = map[status] || [COL.muted, COL.bg, status||"—"];
  return <Pill label={lbl} fg={fg} bg={bg} />;
}

function Detail({ node, employees, onClose, onSoftblock, onRelease }) {
  if (!node || node.type === "root" || node.type === "_group") return null;
  const emp = node.type === "Employee" ? employees.find(e => e.id === node.id) : null;
  return (
    <div style={{ width:260, background:COL.card, borderLeft:`1px solid ${COL.line}`, display:"flex", flexDirection:"column", overflow:"hidden", flexShrink:0 }}>
      <div style={{ padding:"14px 14px 10px", borderBottom:`1px solid ${COL.line}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
          <div style={{ width:32, height:32, borderRadius:"50%", background: node.type==="Skill" ? (node.isGap?COL.red:node.isStrength?COL.green:COL.slate) : node.type==="Interview" ? COL.violet : node.type==="Feedback" ? "#9B59B6" : COL.teal, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:700, flexShrink:0 }}>{node.name.replace(/[✓⚠]/g,"").trim().charAt(0)}</div>
          <div style={{ flex:1, minWidth:0 }}><div style={{ fontWeight:700, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{node.name}</div><div style={{ fontSize:11, color:COL.muted, marginTop:1 }}>{node.type}</div></div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:COL.muted, fontSize:15, padding:2 }}>✕</button>
        </div>
        {node.type === "Employee" && <>
          {statusPill(node.status)}
          <div style={{ fontSize:12, color:COL.muted, marginTop:5 }}>{node.bench_days} days on bench</div>
          {node.status === "SOFTBLOCKED" && (node.softblock_job || emp?.softblock_job) && (
            <div style={{ marginTop:8, padding:"8px 10px", background:COL.amberL, borderRadius:8, fontSize:11, color:COL.amber }}>
              <div style={{ fontWeight:700 }}>◐ Soft-blocked for:</div>
              <div style={{ marginTop:2 }}>{node.softblock_job || emp?.softblock_job}</div>
              {(node.softblock_manager || emp?.softblock_manager) && <div style={{ marginTop:2 }}>Manager: {node.softblock_manager || emp?.softblock_manager}</div>}
              {(node.softblock_expiry || emp?.softblock_expiry) && <div style={{ marginTop:2, color:COL.muted }}>Expires: {node.softblock_expiry || emp?.softblock_expiry}</div>}
            </div>
          )}
          <div style={{ marginTop:10 }}>
            {node.status === "SOFTBLOCKED" ? (
              <button onClick={()=>onRelease(emp||node)} style={{ width:"100%", padding:"7px 0", borderRadius:8, border:"none", background:COL.greenL, color:COL.green, fontWeight:600, fontSize:12, cursor:"pointer" }}>Release from soft-block</button>
            ) : (node.status==="AVAILABLE" || node.status==="TRAINING") ? (
              <button onClick={()=>onSoftblock(emp||node)} style={{ width:"100%", padding:"7px 0", borderRadius:8, border:"none", background:COL.amberL, color:COL.amber, fontWeight:600, fontSize:12, cursor:"pointer" }}>◐ Soft-block for opportunity</button>
            ) : null}
          </div>
        </>}
        {node.type === "Interview" && <>{statusPill(node.result)}<div style={{ fontSize:12, color:COL.muted, marginTop:5 }}>{node.date}</div></>}
        {node.type === "Feedback" && <>{statusPill(node.sentiment)}<div style={{ fontSize:12, color:COL.muted, marginTop:5 }}>Recommendation: {node.recommendation}</div></>}
        {node.type === "Skill" && node.proficiency && (
          <div style={{ display:"flex", gap:3, marginTop:5 }}>
            {[1,2,3,4,5].map(n=><div key={n} style={{ width:16, height:5, borderRadius:3, background: n<=node.proficiency ? COL.teal : COL.line }}/>)}
            <span style={{ fontSize:11, color:COL.muted, marginLeft:4 }}>L{node.proficiency}</span>
          </div>
        )}
        {node.type === "Skill" && node.severity && <div style={{ marginTop:5 }}><Pill label={"Gap: "+node.severity} fg={COL.red} bg={COL.redL}/></div>}
      </div>
      {emp && (
        <div style={{ flex:1, overflow:"auto", padding:"10px 14px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:COL.muted, textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:8 }}>All skills</div>
          {emp.skills.map(s=>(
            <div key={s.id} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7 }}>
              <span style={{ fontSize:12, flex:1 }}>{s.name}</span>
              <div style={{ display:"flex", gap:2 }}>{[1,2,3,4,5].map(n=><div key={n} style={{ width:12, height:4, borderRadius:2, background: n<=s.prof ? COL.teal : COL.line }}/>)}</div>
              <span style={{ fontSize:10, color:COL.muted, width:20 }}>L{s.prof}</span>
            </div>
          ))}
          {emp.interviews.length > 0 && <>
            <div style={{ fontSize:10, fontWeight:700, color:COL.muted, textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:8, marginTop:12 }}>Interviews</div>
            {emp.interviews.map(iv=>(
              <div key={iv.id} style={{ marginBottom:10, padding:"8px 10px", background:COL.bg, borderRadius:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}><span style={{ fontWeight:600, fontSize:12 }}>{iv.client} R{iv.round}</span>{statusPill(iv.result)}</div>
                <div style={{ fontSize:11, color:COL.muted }}>{iv.date}</div>
                {iv.feedback?.gaps?.length>0 && <div style={{ marginTop:5, display:"flex", gap:4, flexWrap:"wrap" }}>{iv.feedback.gaps.map(g=><span key={g.id} style={{ fontSize:10, padding:"1px 7px", background:COL.redL, color:COL.red, borderRadius:10, fontWeight:600 }}>⚠ {g.name}</span>)}</div>}
              </div>
            ))}
          </>}
        </div>
      )}
    </div>
  );
}

function GraphExplorer({ alerts, setAlerts, liveEmployees, setLiveEmployees }) {
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const [skillFilter, setSkillFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showAdvSearch, setShowAdvSearch] = useState(false);
  const [nameQuery, setNameQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [treeData, setTreeData] = useState(() => buildTree("ALL","ALL",liveEmployees,"","ALL"));
  const [selected, setSelected] = useState(null);
  const [softblockModal, setSoftblockModal] = useState(null);
  const [sbCompanyName, setSbCompanyName] = useState("");
  const [sbJobPosition, setSbJobPosition] = useState("");

  useEffect(()=>{
    const newTree = buildTree(skillFilter, statusFilter, liveEmployees, nameQuery, locationFilter);
    setTreeData(newTree);
    setSelected(prev => { if (!prev) return null; const match = newTree.children.find(c=>c.id===prev.id); return match || null; });
  },[skillFilter, statusFilter, liveEmployees, nameQuery, locationFilter]);

  function toggleEmployee(nodeData) {
    setTreeData(prev => {
      const clone = JSON.parse(JSON.stringify(prev));
      const empNode = clone.children.find(c=>c.id===nodeData.id);
      if (!empNode) return prev;
      if (empNode._expanded) { empNode._expanded=false; empNode.children=[]; }
      else { const raw = liveEmployees.find(e=>e.id===nodeData.id); if (raw) { empNode._expanded=true; empNode.children=buildEmployeeSubtree(raw); } }
      return clone;
    });
    setSelected(nodeData);
  }

  function executeSoftblock(emp, companyName, jobPosition) {
    const today = new Date().toISOString().split("T")[0];
    const expiry = new Date(Date.now()+SOFTBLOCK_DAYS*86400000).toISOString().split("T")[0];
    setLiveEmployees(prev => prev.map(e => e.id===emp.id ? { ...e, status:"SOFTBLOCKED", softblock_job:jobPosition, softblock_company:companyName, softblock_start:today, softblock_expiry:expiry } : e));

    fetch(`${API_BASE}/employees/${emp.id}/softblock`, {
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_name: companyName, job_position: jobPosition }),
    }).catch(()=>{});

    if (setAlerts) {
      setAlerts(prev => [...prev, {
        id: "SB" + String(Date.now()).slice(-6),
        type: "SOFTBLOCK",
        employee: emp.name,
        employee_id: emp.id,
        job_description: jobPosition,
        company_name: companyName,
        softblocked_by: 'Admin',
        sent_at: today,
        recipient: "hr@company.com",
      }]);
    }

    setSoftblockModal(null);
    setSbCompanyName("");
    setSbJobPosition("");
  }

  function executeRelease(emp) {
    const releasedFrom = emp.softblock_job || null;
    const today = new Date().toISOString().split("T")[0];

    setLiveEmployees(prev => prev.map(e => e.id===emp.id ? { ...e, status:"AVAILABLE", softblock_job:null, softblock_company:null, softblock_manager:null, softblock_start:null, softblock_expiry:null } : e));

    fetch(`${API_BASE}/employees/${emp.id}/release`, { method: "POST", credentials: "include" }).catch(()=>{});

    if (setAlerts) {
      setAlerts(prev => [...prev, {
        id: "REL" + String(Date.now()).slice(-6),
        type: "RELEASE",
        employee: emp.name,
        employee_id: emp.id,
        job_description: releasedFrom,
        sent_at: today,
        recipient: "hr@company.com",
      }]);
    }
  }

  useEffect(()=>{
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const W = svgRef.current.clientWidth || 900;
    const H = svgRef.current.clientHeight || 600;
    const g = svg.append("g");
    gRef.current = g;
    const zoom = d3.zoom().scaleExtent([0.2,2.5]).on("zoom", e => g.attr("transform", e.transform));
    svg.call(zoom);
    const root = d3.hierarchy(treeData, d => d.children && d.children.length ? d.children : null);
    const empCount = treeData.children.length || 1;
    const treeW = Math.max(W-60, empCount*180);
    const treeH = Math.max(H-80, 400);
    const treeLayout = d3.tree().size([treeW, treeH]).separation((a,b)=>{ const base = a.parent===b.parent ? 1 : 1.4; return a.depth===1 ? base*1.6 : base; });
    treeLayout(root);
    const minX = d3.min(root.descendants(), d=>d.x);
    const maxX = d3.max(root.descendants(), d=>d.x);
    const tW = maxX-minX;
    const offsetX = (W-tW)/2 - minX;
    root.descendants().forEach(d=>{ d.x += offsetX; d.y += 40; });
    g.append("g").selectAll("path").data(root.links()).join("path")
      .attr("fill","none")
      .attr("stroke", d=>{
        const t=d.target.data.type;
        if (t==="Employee") return COL.teal;
        if (t==="Skill" && d.target.data.isGap) return COL.red;
        if (t==="Skill" && d.target.data.isStrength) return COL.green;
        if (t==="Skill") return COL.slate;
        if (t==="Interview") return COL.violet;
        if (t==="Feedback") return "#9B59B6";
        if (t==="_group") return d.target.data._groupColor || COL.muted;
        return COL.line;
      })
      .attr("stroke-width", d=>d.source.depth===0?1.5:1)
      .attr("stroke-opacity", d=>d.source.depth===0?0.4:0.55)
      .attr("stroke-dasharray", d=>d.target.data.type==="_group"?"4 3":null)
      .attr("d", d=>`M${d.source.x},${d.source.y} C${d.source.x},${(d.source.y+d.target.y)/2} ${d.target.x},${(d.source.y+d.target.y)/2} ${d.target.x},${d.target.y}`);
    const node = g.append("g").selectAll("g").data(root.descendants()).join("g")
      .attr("transform", d=>`translate(${d.x},${d.y})`)
      .attr("cursor", d=> (d.data.type==="Employee" || (d.data.type==="Skill" && d.data.skill_id)) ? "pointer" : "default")
      .on("click",(e,d)=>{
        e.stopPropagation();
        if (d.data.type==="Employee") toggleEmployee(d.data);
        else if (d.data.type==="Skill" && d.data.skill_id) { setSkillFilter(d.data.skill_id); setSelected(null); }
        else if (d.data.type!=="root" && d.data.type!=="_group") setSelected(d.data);
      });
    node.filter(d=>d.data.type==="root").append("circle").attr("r",6).attr("fill",COL.navy).attr("stroke","#fff").attr("stroke-width",1.5);
    const groupNodes = node.filter(d=>d.data.type==="_group");
    groupNodes.append("rect").attr("x",-44).attr("y",-11).attr("width",88).attr("height",22).attr("rx",11).attr("fill", d=>d.data._groupColor||COL.muted).attr("opacity",0.12).attr("stroke", d=>d.data._groupColor||COL.muted).attr("stroke-width",1);
    groupNodes.append("text").attr("text-anchor","middle").attr("dominant-baseline","central").attr("font-size",10).attr("font-weight","600").attr("fill", d=>d.data._groupColor||COL.muted).text(d=>d.data.name);
    const empNodes = node.filter(d=>d.data.type==="Employee");
    empNodes.append("circle").attr("r",26).attr("fill","none").attr("stroke", d=>statusColor(d.data.status)).attr("stroke-width",2.5).attr("stroke-dasharray", d=>d.data.status==="SOFTBLOCKED"?"4 3":null).attr("opacity",0.85);
    empNodes.append("circle").attr("r",22).attr("fill",COL.teal).attr("stroke","#fff").attr("stroke-width",2.5);
    empNodes.append("circle").attr("r",22).attr("fill","none").attr("stroke", d=>d.data._expanded?COL.amber:"transparent").attr("stroke-width",2);
    empNodes.append("text").attr("text-anchor","middle").attr("dominant-baseline","central").attr("font-size",11).attr("font-weight","700").attr("fill","#fff").text(d=>d.data.name.split(" ").map(w=>w[0]).join("").slice(0,2));
    empNodes.append("text").attr("text-anchor","middle").attr("y",36).attr("font-size",11.5).attr("font-weight","700").attr("fill",COL.text).text(d=>d.data.name);
    empNodes.append("text").attr("text-anchor","middle").attr("y",50).attr("font-size",9.5).attr("fill",d=>statusColor(d.data.status)).text(d=>d.data.status.charAt(0)+d.data.status.slice(1).toLowerCase());
    empNodes.filter(d=>d.data.bench_days>=30).append("g").call(g=>{
      g.append("circle").attr("cx",18).attr("cy",-18).attr("r",10).attr("fill", d=>d.data.bench_days>=45?COL.red:COL.amber).attr("stroke","#fff").attr("stroke-width",1.5);
      g.append("text").attr("x",18).attr("y",-18).attr("text-anchor","middle").attr("dominant-baseline","central").attr("font-size",7.5).attr("font-weight","800").attr("fill","#fff").text(d=>d.data.bench_days+"d");
    });
    empNodes.append("text").attr("text-anchor","middle").attr("y",-28).attr("font-size",10).attr("fill",COL.muted).text(d=>d.data._expanded?"▲ collapse":"▼ expand");
    const leafNodes = node.filter(d=>d.data.type!=="root" && d.data.type!=="Employee" && d.data.type!=="_group");
    leafNodes.append("circle").attr("r", d=>{ if (d.data.type==="Skill") return d.data.isGap?14:12; if (d.data.type==="Interview") return 14; if (d.data.type==="Feedback") return 11; return 12; })
      .attr("fill", d=>{ if (d.data.type==="Skill" && d.data.isGap) return COL.red; if (d.data.type==="Skill" && d.data.isStrength) return COL.green; if (d.data.type==="Skill") return COL.slate; if (d.data.type==="Interview") return COL.violet; if (d.data.type==="Feedback") return "#9B59B6"; return COL.muted; })
      .attr("stroke","#fff").attr("stroke-width",2);
    leafNodes.append("text").attr("text-anchor","middle").attr("y", d=>{ const r = d.data.type==="Skill"?14:d.data.type==="Feedback"?11:14; return r+14; })
      .attr("font-size",10).attr("font-weight","500")
      .attr("fill", d=>{ if (d.data.isGap) return COL.red; if (d.data.isStrength) return COL.green; if (d.data.type==="Interview") return COL.violet; return COL.slate; })
      .text(d=>d.data.name.length>16?d.data.name.slice(0,15)+"…":d.data.name);
    leafNodes.filter(d=>d.data.type==="Skill" && d.data.proficiency).append("g").attr("transform","translate(-17,-28)").each(function(d){
      const g=d3.select(this);
      [1,2,3,4,5].forEach((n,i)=>{ g.append("circle").attr("cx",i*7).attr("cy",0).attr("r",2.5).attr("fill", n<=d.data.proficiency ? COL.teal : COL.line); });
    });
    leafNodes.filter(d=>d.data.type==="Interview").append("rect").attr("x",-22).attr("y",17).attr("width",44).attr("height",14).attr("rx",7).attr("fill",d=>d.data.result==="PASSED"?COL.greenL:COL.redL).attr("stroke",d=>d.data.result==="PASSED"?COL.green:COL.red).attr("stroke-width",0.5);
    leafNodes.filter(d=>d.data.type==="Interview").append("text").attr("text-anchor","middle").attr("y",28).attr("font-size",8).attr("font-weight","700").attr("fill",d=>d.data.result==="PASSED"?COL.green:COL.red).text(d=>d.data.result||"");
    const allX = root.descendants().map(d=>d.x);
    const allY = root.descendants().map(d=>d.y);
    const padX=80, padY=60;
    const dW=d3.max(allX)-d3.min(allX)||1, dH=d3.max(allY)-d3.min(allY)||1;
    const scale = Math.min(0.95,(W-padX*2)/dW,(H-padY*2)/dH);
    const tx = W/2 - (d3.min(allX)+dW/2)*scale;
    const ty = padY - d3.min(allY)*scale + 20;
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx,ty).scale(scale));
    svg.on("click",()=>setSelected(null));
  },[treeData]);

  function doZoom(factor) {
    if (!svgRef.current) return;
    d3.select(svgRef.current).transition().duration(250).call(d3.zoom().scaleExtent([0.2,2.5]).on("zoom",e=>{ if (gRef.current) d3.select(gRef.current).attr("transform", e.transform); }).scaleBy, factor);
  }

  const empCount = treeData.children?.length || 0;

  return (
    <div style={{ display:"flex", height:"100%", flexDirection:"column" }}>
      <div style={{ background:COL.navy, padding:"10px 18px", display:"flex", alignItems:"center", gap:14, flexShrink:0, flexWrap:"wrap" }}>
        <div style={{ fontWeight:700, fontSize:15, color:"#fff" }}>Graph Explorer</div>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)" }}>hierarchical tree view</div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:11, color:"rgba(255,255,255,0.5)" }}>Skill</span>
          <select value={skillFilter} onChange={e=>{setSkillFilter(e.target.value);setSelected(null);}} style={{ padding:"5px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.08)", color:"#fff", fontSize:12 }}>
            <option value="ALL">All skills</option>
            {SKILLS_LIST.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:11, color:"rgba(255,255,255,0.5)" }}>Status</span>
          <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setSelected(null);}} style={{ padding:"5px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.08)", color:"#fff", fontSize:12 }}>
            {STATUSES.map(s=><option key={s} value={s}>{s==="ALL"?"All statuses":s}</option>)}
          </select>
        </div>
        <button onClick={()=>setShowAdvSearch(v=>!v)}
          style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 12px", borderRadius:8,
            border:`1px solid ${showAdvSearch?COL.teal:"rgba(255,255,255,0.15)"}`,
            background: showAdvSearch ? COL.teal : "rgba(255,255,255,0.08)",
            color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer" }}>
          🔍 Advanced search
          {(nameQuery || locationFilter!=="ALL") && <span style={{ background:COL.amber, borderRadius:10, width:7, height:7, display:"inline-block" }}/>}
        </button>
        <div style={{ marginLeft:"auto", display:"flex", gap:16 }}>
          {[[empCount,"employees","rgba(255,255,255,0.9)"],[treeData.children?.filter(e=>e.status==="AVAILABLE").length||0,"available",COL.teal],[treeData.children?.filter(e=>e.bench_days>=45).length||0,"critical",COL.red]].map(([n,label,color])=>(
            <div key={label} style={{ textAlign:"center" }}><div style={{ fontSize:17, fontWeight:700, color, lineHeight:1 }}>{n}</div><div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", marginTop:2 }}>{label}</div></div>
          ))}
        </div>
      </div>
      {showAdvSearch && (
        <div style={{ background:COL.navyM, padding:"12px 18px", display:"flex", alignItems:"center", gap:16,
          flexShrink:0, flexWrap:"wrap", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.5)" }}>Name</span>
            <input value={nameQuery} onChange={e=>setNameQuery(e.target.value)} placeholder="Search by name..."
              style={{ padding:"6px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)",
                background:"rgba(255,255,255,0.08)", color:"#fff", fontSize:12, width:180 }} />
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.5)" }}>Location</span>
            <select value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}
              style={{ padding:"6px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)",
                background:"rgba(255,255,255,0.08)", color:"#fff", fontSize:12 }}>
              {LOCATIONS.map(l=><option key={l} value={l}>{l==="ALL"?"All locations":l}</option>)}
            </select>
          </div>
          {(nameQuery || locationFilter!=="ALL") && (
            <button onClick={()=>{ setNameQuery(""); setLocationFilter("ALL"); }}
              style={{ padding:"6px 12px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)",
                background:"transparent", color:"rgba(255,255,255,0.7)", fontSize:12, cursor:"pointer" }}>
              Clear
            </button>
          )}
        </div>
      )}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
          {empCount===0 && (
            <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:10 }}>
              <div style={{ fontSize:32, color:COL.line }}>⬡</div>
              <div style={{ fontSize:14, fontWeight:600, color:COL.slate }}>No employees match these filters</div>
            </div>
          )}
          <svg ref={svgRef} style={{ width:"100%", height:"100%" }} />
          {empCount>0 && !selected && (
            <div style={{ position:"absolute", bottom:14, left:"50%", transform:"translateX(-50%)", background:"rgba(13,27,62,0.82)", borderRadius:10, padding:"8px 18px", fontSize:12, color:"rgba(255,255,255,0.7)", pointerEvents:"none", whiteSpace:"nowrap" }}>
              Click an employee node to expand its skills, interviews, and feedback
            </div>
          )}
          <div style={{ position:"absolute", bottom:14, right:14, display:"flex", flexDirection:"column", gap:4 }}>
            {[["＋",1.35],["－",0.75]].map(([lbl,f])=>(
              <button key={lbl} onClick={()=>doZoom(f)} style={{ width:32, height:32, borderRadius:7, border:`1px solid ${COL.line}`, background:COL.card, cursor:"pointer", fontSize:15, fontWeight:700, color:COL.slate, display:"flex", alignItems:"center", justifyContent:"center" }}>{lbl}</button>
            ))}
          </div>
        </div>
        {selected && <Detail node={selected} employees={liveEmployees} onClose={()=>setSelected(null)} onSoftblock={emp=>{ setSbCompanyName(""); setSbJobPosition(""); setSoftblockModal({emp}); }} onRelease={executeRelease} />}
      </div>
      {softblockModal && (
        <div className="modal-overlay" onClick={()=>setSoftblockModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Soft-block {softblockModal.emp.name}</div>
            <div className="form-group"><label className="form-label">Company Name</label><input className="form-input" value={sbCompanyName} onChange={e=>setSbCompanyName(e.target.value)} placeholder="e.g. Acme" /></div>
            <div className="form-group"><label className="form-label">Job Position</label><input className="form-input" value={sbJobPosition} onChange={e=>setSbJobPosition(e.target.value)} placeholder="e.g. Software Engineer" /></div>
            <div style={{ fontSize:12, color:COL.muted, marginBottom:4 }}>Soft-block period: {SOFTBLOCK_DAYS} days from today</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setSoftblockModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={!sbCompanyName.trim() || !sbJobPosition.trim()} onClick={()=>executeSoftblock(softblockModal.emp, sbCompanyName.trim(), sbJobPosition.trim())}>Confirm soft-block</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Ingestion({ user }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  
  useEffect(() => {
    fetch(`${API_BASE}/ingestion/uploads`, { credentials: "include" })
      .then(r => parseJsonSafe(r))
      .then(d => { if (Array.isArray(d)) setHistory(d); })
      .catch(e => console.error(e));
  }, []);
  
  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/ingestion/upload`, {
        method: "POST",
        credentials: "include",
        body: formData
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      // Refetch history to get the exact real-time dates and values
      const histRes = await fetch(`${API_BASE}/ingestion/uploads`, { credentials: "include" });
      if (histRes.ok) {
        const histData = await parseJsonSafe(histRes);
        if (Array.isArray(histData)) setHistory(histData);
      }
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSyncGraph() {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/ingestion/sync-pending`, { method: "POST", credentials: "include" });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Graph sync failed");
      const historyRes = await fetch(`${API_BASE}/ingestion/uploads`, { credentials: "include" });
      const uploads = await parseJsonSafe(historyRes);
      if (Array.isArray(uploads)) setHistory(uploads);
    } catch (error) {
      setError(error.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleClearDatabase() {
    if (!window.confirm("Clear all ingested documents and employee records from MongoDB, the Neo4j graph, and upload history? This action cannot be undone.")) return;
    setClearing(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/ingestion/clear`, {
        method: "POST",
        credentials: "include"
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Failed to clear database");
      alert(data.message || "Database cleared successfully");
      setHistory([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setClearing(false);
    }
  }
  
  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Document Ingestion</div>
          <div className="page-sub">Upload CSV or Excel files to populate the Knowledge Graph & Databases.</div>
        </div>
        <button 
          onClick={handleClearDatabase} 
          disabled={clearing}
          className="btn btn-ghost" 
          style={{ color: "#DC2626", borderColor: "#FECACA", background: "#FEF2F2" }}
        >
          {clearing ? "Clearing..." : "Clear Database"}
        </button>
      </div>
      
      <div className="card" style={{ marginBottom: 24, maxWidth: 600 }}>
        <div className="card-title">Upload New Document</div>
        {error && <div style={{ color: "#C0392B", background: "#FDECEA", padding: "10px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
        <form onSubmit={handleUpload} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={e => setFile(e.target.files[0])} />
          <button type="submit" className="btn btn-primary" disabled={!file || uploading} style={{ alignSelf: "flex-start" }}>
            {uploading ? "Uploading & Processing..." : "Upload & Ingest"}
          </button>
        </form>
      </div>
      
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Upload History</div>
          <button className="btn btn-ghost btn-sm" onClick={handleSyncGraph} disabled={syncing || uploading || clearing}>{syncing ? "Syncing..." : "Retry graph sync"}</button>
        </div>
        {history.length === 0 ? (
          <div className="empty">No uploads yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Date</th>
                  <th>Rows</th>
                  <th>Nodes Added</th>
                  <th>Relationships Added</th>
                  <th>User</th>
                  <th>Storage</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td style={{ fontWeight: 600 }}>{h.filename}</td>
                    <td>{new Date(h.uploadedAt).toLocaleString()}</td>
                    <td>{h.totalRows}</td>
                    <td>{h.totalNodes}</td>
                    <td>{h.totalRelationships}</td>
                    <td>{h.username}</td>
                    <td>{h.mongo_saved ? "Saved in MongoDB · " : ""}{h.neo4j_synced ? "Graph synced" : "Graph sync pending"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function GraphView({ user, employees, setEmployees, setAlerts }) {
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    pendingGraphRoot,
    setPendingGraphRoot,
    selectSearchResult,
    generateKnowledgeGraph,
    loadGraph,
    graph,
    setGraph,
    rootNode,
    expandedNodeIds,
    expandNodeInGraph,
    collapseNodeInGraph,
    isLoading,
    selectedNode,
    setSelectedNode,
    setFilters,
    clearExplorer,
  } = useOntologyExplorer();

  const graphRef = useRef(null);
  const filterRequestId = useRef(0);
  const [sbForm, setSbForm] = useState({ company_name: '', job_position: '' });
  const [showSoftblockForm, setShowSoftblockForm] = useState(false);
  const [graphActionLoading, setGraphActionLoading] = useState(false);
  const [graphActionError, setGraphActionError] = useState('');
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [employeeMessage, setEmployeeMessage] = useState("");
  const deploymentStatuses = getDeploymentStatuses(
    employees, [selectedNode?.deployment_status, editingEmployee?.deployment_status]
  );

  function selectEmployeeNode(node) {
    const employee = employees.find(emp => emp.id === node.id || emp.name === node.label);
    setSelectedNode({ ...node, ...employee });
    setEditingEmployee(null);
    setShowSoftblockForm(false);
    setEmployeeMessage("");
    setGraphActionError("");
  }

  function applySavedEmployee(employee) {
    setEmployees(prev => prev.map(emp => emp.id === employee.id || emp.name === employee.name ? employee : emp));
    setSelectedNode(prev => prev ? { ...prev, ...employee } : prev);
    setGraph(prev => ({ ...prev, nodes: prev.nodes.map(node =>
      node.id === employee.id || node.label === employee.name ? { ...node, ...employee } : node) }));
  }

  async function saveEmployee(event) {
    event.preventDefault();
    setSavingEmployee(true);
    setEmployeeMessage("");
    try {
      const res = await fetch(`${API_BASE}/employees/${encodeURIComponent(selectedNode.id)}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingEmployee),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || !data?.employee) throw new Error(data?.error || "Unable to save employee");
      applySavedEmployee(data.employee);
      setEditingEmployee(null);
      // Refresh visible relationships after a client or project assignment changes.
      const graphRes = await fetch(`${API_BASE}/expand/${encodeURIComponent(rootNode)}`, { credentials: "include" });
      const updatedGraph = await parseJsonSafe(graphRes);
      if (graphRes.ok && updatedGraph?.nodes) setGraph(updatedGraph);
      setEmployeeMessage(data.neo4j_pending ? "Saved. Graph sync is pending." : "Employee saved.");
    } catch (error) {
      setEmployeeMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingEmployee(false);
    }
  }

  async function handleFilterChange(filters, benchRange, clearSearch = false) {
    const requestId = ++filterRequestId.current;
    setFilters({ ...filters, ...benchRange });
    const params = new URLSearchParams();
    if (benchRange.min > 0) params.append('benchMin', benchRange.min);
    if (benchRange.max < 365) params.append('benchMax', benchRange.max);
    if (filters.client) params.append('client', filters.client);
    if (filters.level) params.append('level', filters.level);
    if (filters.status) params.append('status', filters.status);
    if (filters.skills && filters.skills.length > 0) params.append('skills', filters.skills.join(','));

    // Check if any filter is actually active
    const hasFilter = [...params.keys()].some(k => !['benchMin','benchMax'].includes(k)) || params.has('benchMin') || params.has('benchMax');
    if (clearSearch || !hasFilter) {
      // No filters active – clear filter results and reset the graph
      clearExplorer();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/employees?${params.toString()}`, { credentials: "include" });
      if (!res.ok || requestId !== filterRequestId.current) return;
      const employees = (await parseJsonSafe(res)) || [];
      if (requestId !== filterRequestId.current) return;
      // Map employees into search-result cards (same shape as /search)
      const results = employees.slice(0, 20).map(e => ({
        id: e.name || e.id,
        label: e.name || e.id,
        type: 'Employee',
        subtext: `${e.deployment_status || e.status || 'AVAILABLE'}${e.bench_aging != null ? ` · ${e.bench_aging}d on bench` : ''}${e.location ? ` · ${e.location}` : ''}`,
      }));
      setSearchResults(results);
      if (results.length > 0) setPendingGraphRoot(results[0].id);
      else setPendingGraphRoot(null);
      // Clear the text search so results panel shows filter results
      setSearchQuery('');
    } catch (err) {
      console.error("Filter fetch error:", err);
    }
  }
  async function handleAction(action, empId) {
    if (!user) return alert("Please log in first");
    const todayStr = new Date().toISOString().split("T")[0];
    setGraphActionLoading(true);
    setGraphActionError('');
    try {
      const payload = action === 'softblock' ? { company_name: sbForm.company_name.trim(), job_position: sbForm.job_position.trim() } : {};
      const res = await fetch(`${API_BASE}/employees/${encodeURIComponent(empId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const resData = await parseJsonSafe(res);
        if (resData?.employee) applySavedEmployee(resData.employee);
        setEmployeeMessage(resData?.neo4j_pending ? "Saved. Graph sync is pending." : "Employee saved.");

        if (setAlerts) {
          if (action === "softblock") {
            const newAlert = resData?.alert || {
              id: "SB" + String(Date.now()).slice(-6),
              type: "SOFTBLOCK",
              employee: selectedNode.label || selectedNode.id,
              employee_id: empId,
              job_description: payload.job_position,
              company_name: payload.company_name,
              softblocked_by: user?.name || "Admin",
              expiry_date: new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
              sent_at: todayStr,
              recipient: "hr@company.com"
            };
            setAlerts(prev => [newAlert, ...prev]);
          } else if (action === "release") {
            const newAlert = resData?.alert || {
              id: "REL" + String(Date.now()).slice(-6),
              type: "RELEASE",
              employee: selectedNode.label || selectedNode.id,
              employee_id: empId,
              job_description: selectedNode.softblock_job || "Opportunity",
              sent_at: todayStr,
              recipient: "hr@company.com"
            };
            setAlerts(prev => [newAlert, ...prev]);
          }
        }
        
        setShowSoftblockForm(false);
        setSbForm({ company_name: '', job_position: '' });
      } else {
        const d = await parseJsonSafe(res);
        setGraphActionError(d?.error || "Action failed");
      }
    } catch (e) {
      setGraphActionError("Error: " + e.message);
    } finally {
      setGraphActionLoading(false);
    }
  }


  return (
    <div style={{ display: "flex", height: "calc(100vh - 108px)" }}>
      <DatasetFilters onFilterChange={handleFilterChange} API_BASE={API_BASE} employees={employees} />
      
      <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingLeft: 24, overflow: "hidden" }}>
        <div className="page-header" style={{ marginBottom: 12 }}>
          <div className="page-title">Knowledge Graph</div>
          <div className="page-sub">Explore the unified talent ontology from Neo4j. Type to search, pick a root node, and generate the graph.</div>
          
          <div style={{ marginTop: 14 }}>
            <SearchBar 
              searchQuery={searchQuery}
              onQueryChange={setSearchQuery}
              searchResults={searchResults}
              pendingGraphRoot={pendingGraphRoot}
              onSelectResult={selectSearchResult}
              onGenerateGraph={generateKnowledgeGraph}
              isLoading={isLoading}
            />
          </div>
        </div>

        <div style={{ flex: 1, position: "relative", background: "#ffffff", borderRadius: 12, border: "1px solid #E2E6EF", overflow: "hidden" }}>
          <OntologyGraph 
            ref={graphRef}
            graph={graph}
            selectedNode={selectedNode}
            rootNode={rootNode}
            expandedNodeIds={expandedNodeIds}
            onNodeExpand={expandNodeInGraph}
            onNodeCollapse={collapseNodeInGraph}
            onNodeSelect={selectEmployeeNode}
            isLoading={isLoading}
          />
          
          {selectedNode && selectedNode.type === 'Employee' && (
            <div style={{
              position: "absolute", top: 16, right: 16, width: 320, background: "#ffffff",
              border: "1px solid #E2E6EF", borderRadius: 12, padding: 20,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 10,
              maxHeight: "calc(100% - 32px)", overflowY: "auto"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, color: "#1E2233" }}>{selectedNode.label || selectedNode.id}</h3>
                  <span style={{ fontSize: 11, color: "#64748B" }}>{selectedNode.type || 'Employee'}</span>
                </div>
                <button onClick={() => setSelectedNode(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#8B929E" }}>&times;</button>
              </div>
              
              <div style={{ marginBottom: 8, fontSize: 13, color: "#4B5563" }}>
                <strong>Status:</strong> <span style={{ color: selectedNode.status === 'AVAILABLE' ? '#1A7A50' : '#B8710F' }}>{selectedNode.status || 'AVAILABLE'}</span>
              </div>
              <div style={{ marginBottom: 8, fontSize: 13 }}><strong>Deployment:</strong> {selectedNode.deployment_status || "Unspecified"}</div>
              <div style={{ marginBottom: 8, fontSize: 13 }}><strong>Client:</strong> {selectedNode.client_name || "None"}</div>
              <div style={{ marginBottom: 8, fontSize: 13 }}><strong>Project:</strong> {selectedNode.current_project || "None"}</div>
              {employeeMessage && <div role="status" style={{ fontSize: 13, margin: "12px 0" }}>{employeeMessage}</div>}
              {editingEmployee ? (
                <form onSubmit={saveEmployee} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                  <label className="form-label">Deployment status
                    <select className="form-select" value={editingEmployee.deployment_status} onChange={e => setEditingEmployee(prev => ({ ...prev, deployment_status: e.target.value }))}>
                      <option value="">Unspecified</option>
                      {deploymentStatuses.map(status => <option key={status} value={status}>{status.charAt(0) + status.slice(1).toLowerCase()}</option>)}
                    </select>
                  </label>
                  {[["client_name", "Client"], ["current_project", "Current project"], ["performance", "Performance"]].map(([field, label]) => (
                    <label key={field} className="form-label">{label}
                      <input className="form-input" value={editingEmployee[field]} onChange={e => setEditingEmployee(prev => ({ ...prev, [field]: e.target.value }))} />
                    </label>
                  ))}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={savingEmployee}>{savingEmployee ? "Saving..." : "Save changes"}</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={savingEmployee} onClick={() => setEditingEmployee(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingEmployee({
                  deployment_status: selectedNode.deployment_status || "",
                  client_name: selectedNode.client_name || "",
                  current_project: selectedNode.current_project || "",
                  performance: selectedNode.performance || "",
                })}>Edit employee</button>
              )}
              {selectedNode.available_since && (
                <div style={{ marginBottom: 16, fontSize: 13, color: "#4B5563" }}>
                  <strong>Bench Since:</strong> {selectedNode.available_since}
                </div>
              )}
              {selectedNode.status === 'SOFTBLOCKED' && selectedNode.softblock_job && (
                <div style={{ marginBottom: 8, fontSize: 13, color: "#4B5563" }}>
                  <strong>Soft-blocked for:</strong> {[selectedNode.softblock_job, selectedNode.softblock_company].filter(Boolean).join(' @ ')}
                </div>
              )}
              {graphActionError && <div role="alert" style={{ color: T.red, fontSize: 12 }}>{graphActionError}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                {(!selectedNode.status || selectedNode.status === 'AVAILABLE') ? (
                  showSoftblockForm ? (
                    <div style={{ padding: 12, background: "#FFFBEB", borderRadius: 8 }}>
                      <div style={{ fontWeight: 600, color: "#B8710F", marginBottom: 8 }}>Soft-block Details</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                        <input type="text" className="form-input" placeholder="Company Name" value={sbForm.company_name} onChange={e => setSbForm(prev => ({...prev, company_name: e.target.value}))} />
                        <input type="text" className="form-input" placeholder="Job Position" value={sbForm.job_position} onChange={e => setSbForm(prev => ({...prev, job_position: e.target.value}))} />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-primary btn-sm" disabled={graphActionLoading || !sbForm.company_name.trim() || !sbForm.job_position.trim()} onClick={() => handleAction('softblock', selectedNode.id)}>{graphActionLoading ? 'Saving…' : 'Confirm Soft-block'}</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setShowSoftblockForm(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowSoftblockForm(true)} className="btn btn-amber" style={{ width: "100%", justifyContent: "center" }}>
                      ◐ Soft-block Employee
                    </button>
                  )
                ) : (
                  <>
                    <button disabled={graphActionLoading} onClick={() => handleAction('release', selectedNode.id)} className="btn" style={{ background: "#FDECEA", color: "#C0392B", width: "100%", justifyContent: "center" }}>
                      Release Employee
                    </button>
                  </>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminRequests() {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState("pending");

  useEffect(() => {
    const url = filter === "pending" ? `${API_BASE}/admin/requests` : `${API_BASE}/admin/requests/all`;
    fetch(url, { credentials: "include" })
      .then(r => parseJsonSafe(r))
      .then(d => setRequests(Array.isArray(d) ? d : []))
      .catch(e => console.error(e));
  }, [filter]);

  async function handleAction(reqId, action) {
    try {
      const res = await fetch(`${API_BASE}/admin/requests/${reqId}/${action}`, {
        method: "POST", credentials: "include"
      });
      if (res.ok) {
        setRequests(prev => prev.map(r => r.id === reqId ? {...r, status: action === "approve" ? "approved" : "rejected"} : r));
      }
    } catch (err) { console.error(err); }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Admin Change Requests</div>
        <div className="page-sub">Review and approve Explorer change requests.</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className={`btn ${filter === "pending" ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter("pending")}>Pending</button>
        <button className={`btn ${filter === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter("all")}>All Requests</button>
      </div>
      {requests.length === 0 ? (
        <div className="card"><div className="empty">No {filter} requests.</div></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Employee</th>
                  <th>Requested By</th>
                  <th>Date</th>
                  <th>Details</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id}>
                    <td><span style={{ textTransform: "uppercase", fontWeight: 600, fontSize: 12, color: r.type === "softblock" ? "#B8710F" : r.type === "release" ? "#1A7A50" : "#5B4FCF" }}>{r.type}</span></td>
                    <td style={{ fontWeight: 600 }}>{r.employee_name || r.employee_id}</td>
                    <td>{r.requested_by}</td>
                    <td>{r.requested_at ? new Date(r.requested_at).toLocaleString() : "—"}</td>
                    <td style={{ fontSize: 12 }}>{r.payload?.job_label || r.payload?.manager_name || "—"}</td>
                    <td><span style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: r.status === "pending" ? "#FBF3E0" : r.status === "approved" ? "#E2F5EC" : "#FDECEA", color: r.status === "pending" ? "#B8710F" : r.status === "approved" ? "#1A7A50" : "#C0392B" }}>{r.status}</span></td>
                    <td>
                      {r.status === "pending" && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn btn-primary" style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => handleAction(r.id, "approve")}>Approve</button>
                          <button className="btn btn-ghost" style={{ padding: "6px 14px", fontSize: 12, color: "#C0392B" }} onClick={() => handleAction(r.id, "reject")}>Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────
const PAGES = [
  { id:"dashboard", icon:"⬛", label:"Dashboard" },
  { id:"employees", icon:"👥", label:"Employees" },
  { id:"jobs", icon:"💼", label:"Jobs" },
  { id:"interviews", icon:"💬", label:"Interviews" },
  { id:"alerts", icon:"🔔", label:"Alerts" },
  { id:"graph", icon:"⬡", label:"Graph" },
  { id:"ingestion", icon:"📥", label:"Ingestion" },
];

export default function TalentLens() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login"); // login, signup
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [page, setPage] = useState("dashboard");

  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: "include" })
      .then(r => parseJsonSafe(r))
      .then(d => { if (d && d.user) setUser(d.user); })
      .catch(e => console.error("Auth check failed", e));
  }, []);

  async function handleAuth(e) {
    e.preventDefault();
    setAuthError("");
    const endpoint = authMode === "login" ? "/auth/login" : "/auth/signup";
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(authForm),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Authentication failed");
      if (data && data.user) setUser(data.user);
      setAuthForm({ name: "", email: "", password: "" });
    } catch (err) {
      setAuthError(err.message);
    }
  }

  async function handleLogout() {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
      setUser(null);
      setJobs([]);
      setAlerts([]);
      knownAlertIds.current = null;
      setNewAlertToast(null);
    } catch (err) {
      console.error(err);
    }
  }

  const [employees, setEmployees] = useState([]);
  const [jobs, setJobs] = useState(INITIAL_JOBS);
  const [alerts, setAlerts] = useState([]);
  const [newAlertToast, setNewAlertToast] = useState(null);
  const knownAlertIds = useRef(null);
  const [graphEmployees, setGraphEmployees] = useState([]);
  const [notifiedExpiries, setNotifiedExpiries] = useState([]);
  const [tick, setTick] = useState(0);
  const [apiConnected, setApiConnected] = useState(false);

  useEffect(() => {
    if (!knownAlertIds.current) return;
    const incoming = alerts.filter(a => a.id && !knownAlertIds.current.has(a.id));
    alerts.forEach(a => { if (a.id) knownAlertIds.current.add(a.id); });
    if (incoming.length) {
      const latest = incoming[incoming.length - 1];
      const action = latest.type === "SOFTBLOCK" ? "soft-blocked" : latest.type === "RELEASE" ? "released" : latest.type === "SNOOZE" ? "snoozed" : latest.type === "INGESTION" ? "ingested" : latest.type === "JOB_CREATED" ? "created" : latest.type === "JOB_DELETED" ? "deleted" : "has a new alert";
      setNewAlertToast(incoming.length === 1 ? `${latest.employee} ${action}` : `${incoming.length} new alerts and employee changes`);
    }
  }, [alerts]);

  useEffect(() => {
    if (!newAlertToast) return;
    const timer = setTimeout(() => setNewAlertToast(null), 6000);
    return () => clearTimeout(timer);
  }, [newAlertToast]);

  // periodic re-check so a running session catches date rollovers too
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // Fetch employees and alerts from Neo4j backend
  useEffect(() => {
    if (user) {
      fetch(`${API_BASE}/employees`, { credentials: "include" })
        .then(res => parseJsonSafe(res))
        .then(data => {
          if (Array.isArray(data)) setEmployees(data);
        })
        .catch(console.error);

      fetch(`${API_BASE}/jobs`, { credentials: "include" })
        .then(res => parseJsonSafe(res))
        .then(data => { if (Array.isArray(data)) setJobs(data); })
        .catch(console.error);
        
      fetch(`${API_BASE}/alerts`, { credentials: "include" })
        .then(res => parseJsonSafe(res))
        .then(data => {
          if (Array.isArray(data)) {
            if (!knownAlertIds.current) {
              knownAlertIds.current = new Set(data.map(a => a.id).filter(Boolean));
              if (data.length) setNewAlertToast(`${data.length} alerts are ready to review`);
            }
            setAlerts(data);
          }
        })
        .catch(console.error);
    }
  }, [user, page]);

  // poll the backend so changes made from another app/script show up automatically
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/employees`, { credentials: "include" });
        if (!res.ok) return;
        const apiEmployees = await parseJsonSafe(res);
        if (cancelled || !Array.isArray(apiEmployees)) return;
        setEmployees(prev => [
          ...apiEmployees,
          ...prev.filter(local => local.local_only && !apiEmployees.some(saved => saved.id === local.id || saved.name === local.name)),
        ]);
        setGraphEmployees(prev => prev.map(local => {
          const match = apiEmployees.find(a => a.id === local.id);
          if (!match) return local;
          return {
            ...local,
            status: match.status,
            location: match.location ?? local.location,
            bench_days: match.available_since ? daysSince(match.available_since) : local.bench_days,
            softblock_job: match.softblock_job ?? null,
            softblock_company: match.softblock_company ?? null,
            softblock_manager: match.softblock_manager ?? null,
            softblock_start: match.softblock_start ?? null,
            softblock_expiry: match.softblock_expiry ?? null,
          };
        }));
        setApiConnected(true);
      } catch (err) {
        setApiConnected(false);
      }
      try {
        const res2 = await fetch(`${API_BASE}/alerts`, { credentials: "include" });
        if (res2.ok) {
          const apiAlerts = await parseJsonSafe(res2);
          if (!cancelled && Array.isArray(apiAlerts)) {
            if (!knownAlertIds.current) {
              knownAlertIds.current = new Set(apiAlerts.map(a => a.id).filter(Boolean));
              if (apiAlerts.length) setNewAlertToast(`${apiAlerts.length} alerts are ready to review`);
            }
            setAlerts(apiAlerts);
          }
        }
      } catch (err) { /* backend not reachable yet, ignore */ }
      try {
        const jobsResponse = await fetch(`${API_BASE}/jobs`, { credentials: "include" });
        if (jobsResponse.ok) {
          const savedJobs = await parseJsonSafe(jobsResponse);
          if (!cancelled && Array.isArray(savedJobs)) setJobs(savedJobs);
        }
      } catch (err) { /* keep the last loaded jobs while the backend is unavailable */ }
    }
    poll();
    const interval = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user]);

  // fire a soft-block-expiry reminder for anyone whose 15-day window has
  // passed and hasn't already been notified for this expiry date
  useEffect(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    const newAlerts = [];
    const newKeys = [];
    graphEmployees.forEach(e => {
      if (e.status === "SOFTBLOCKED" && e.softblock_expiry && e.softblock_expiry <= todayStr) {
        const key = e.id + "|" + e.softblock_expiry;
        if (!notifiedExpiries.includes(key)) {
          newAlerts.push({
            id: "EXP" + String(Date.now()) + Math.random().toString(36).slice(2,6),
            type: "SOFTBLOCK_EXPIRY",
            employee: e.name,
            employee_id: e.id,
            job_description: e.softblock_job,
            softblocked_by: e.softblock_manager,
            expiry_date: e.softblock_expiry,
            sent_at: todayStr,
            recipient: "hr@company.com",
          });
          newKeys.push(key);
        }
      }
    });
    if (newAlerts.length > 0) {
      setAlerts(prev => [...prev, ...newAlerts]);
      setNotifiedExpiries(prev => [...prev, ...newKeys]);
    }
  }, [graphEmployees, notifiedExpiries, tick]);

  async function handleUnblockFromAlert(alert) {
    const empIdentifier = alert.employee_id || alert.employee;
    try {
      const res = await fetch(`${API_BASE}/employees/${encodeURIComponent(empIdentifier)}/release`, { method: "POST", credentials: "include" });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Release failed");
      setAlerts(prev => [data.alert, ...prev.filter(a => a.id !== data.alert.id)]);
    } catch (error) {
      window.alert(error.message);
      return;
    }
    setEmployees(prev => prev.map(e => (e.id === empIdentifier || e.name === alert.employee)
      ? { ...e, status:"AVAILABLE", softblock_job:null, softblock_company:null, softblock_manager:null, softblock_start:null, softblock_expiry:null }
      : e));
    setGraphEmployees(prev => prev.map(e => (e.id === empIdentifier || e.name === alert.employee)
      ? { ...e, status:"AVAILABLE", softblock_job:null, softblock_company:null, softblock_manager:null, softblock_start:null, softblock_expiry:null }
      : e));
  }

  async function handleSnoozeFromAlert(alert) {
    let newExpiry;
    try {
      const res = await fetch(`${API_BASE}/employees/${encodeURIComponent(alert.employee_id || alert.employee)}/snooze`, { method: "POST", credentials: "include" });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Snooze failed");
      newExpiry = data.expiry_date;
      setAlerts(prev => [data.alert, ...prev.filter(a => a.id !== data.alert.id)]);
    } catch (error) {
      window.alert(error.message);
      return;
    }
    setEmployees(prev => prev.map(e => (e.id === alert.employee_id || e.name === alert.employee)
      ? { ...e, softblock_expiry:newExpiry }
      : e));
    setGraphEmployees(prev => prev.map(e => (e.id === alert.employee_id || e.name === alert.employee)
      ? { ...e, softblock_expiry:newExpiry }
      : e));
  }

  const alertsNeeded = alerts.length;
  return (
    <>
      <style>{css}</style>
      {!user && (
        <div className="modal-overlay" style={{ zIndex: 1000, background: "#0D1B3E" }}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-title">{authMode === "login" ? "Login to TalentLens" : "Create Account"}</div>
            {authError && <div style={{ color: "#C0392B", background: "#FDECEA", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{authError}</div>}
            <form onSubmit={handleAuth}>
              {authMode === "signup" && (
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input className="form-input" type="text" value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} required />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} required minLength={8} />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "12px 16px", marginTop: 10 }}>
                {authMode === "login" ? "Login" : "Sign Up"}
              </button>
            </form>
            <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: "#8B929E" }}>
              {authMode === "login" ? (
                <>Don't have an account? <span style={{ color: "#0A7C88", cursor: "pointer", fontWeight: 600 }} onClick={() => {setAuthMode("signup"); setAuthError("");}}>Sign up</span></>
              ) : (
                <>Already have an account? <span style={{ color: "#0A7C88", cursor: "pointer", fontWeight: 600 }} onClick={() => {setAuthMode("login"); setAuthError("");}}>Login</span></>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="app">
        {newAlertToast && <div role="status" onClick={() => { setPage("alerts"); setNewAlertToast(null); }} style={{ position:"fixed", top:18, right:18, zIndex:1200, background:T.navy, color:"#fff", padding:"14px 18px", borderRadius:10, boxShadow:"0 10px 30px rgba(0,0,0,.2)", cursor:"pointer", maxWidth:320 }}>
          <div style={{ fontWeight:700, marginBottom:4 }}>New activity</div>
          <div style={{ fontSize:13 }}>{newAlertToast}</div>
          <div style={{ fontSize:11, color:"#A8E4E7", marginTop:7 }}>Open alerts →</div>
        </div>}
        <div className="sidebar">
          <div className="sidebar-logo"><div className="sidebar-logo-text">TalentLens</div><div className="sidebar-logo-sub">bench management</div></div>
          <div className="nav-section">Navigation</div>
          {PAGES.map(p => (
            <div key={p.id} className={`nav-item ${page===p.id?"active":""}`} onClick={() => setPage(p.id)}>
              <span>{p.icon}</span><span>{p.label}</span>
              {p.id === "alerts" && alertsNeeded > 0 && <span className="badge">{alertsNeeded}</span>}
            </div>
          ))}
        </div>
        <div className="main">
          <div className="ticker">
            <div className="ticker-stat"><div className="ticker-label">On bench</div><div style={{ fontSize:18, fontWeight:700, color:"#fff" }}>{employees.filter(e=>e.status==="AVAILABLE").length}</div></div>
            <div className="ticker-divider"/>
            <div className="ticker-stat"><div className="ticker-label">Soft-blocked</div><div style={{ fontSize:18, fontWeight:700, color:T.amber }}>{employees.filter(e=>e.status==="SOFTBLOCKED").length}</div></div>
            <div className="ticker-divider"/>
            <div className="ticker-stat"><div className="ticker-label">Critical (45d+)</div><div style={{ fontSize:18, fontWeight:700, color:T.red }}>{employees.filter(e=>e.status!=="MAPPED"&&daysSince(e.available_since)>=45).length}</div></div>
            <div className="ticker-divider"/>
            <div className="ticker-stat"><div className="ticker-label">Open jobs</div><div style={{ fontSize:18, fontWeight:700, color:T.green }}>{jobs.filter(j=>j.status==="OPEN").length}</div></div>
            <div style={{ marginLeft:"auto" }}><span style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>✦ TalentLens</span></div>
          </div>
          <div className="page">
            {page === "dashboard" && <Dashboard employees={employees} jobs={jobs} alerts={alerts} user={user} onLogout={handleLogout} />}
            {page === "employees" && <Employees employees={employees} setEmployees={setEmployees} user={user} setAlerts={setAlerts} />}
            {page === "jobs" && <Jobs jobs={jobs} setJobs={setJobs} employees={employees} />}
            {page === "interviews" && <Interviews employees={employees} setEmployees={setEmployees} />}
            {page === "alerts" && <Alerts employees={employees} alerts={alerts} onUnblock={handleUnblockFromAlert} onSnooze={handleSnoozeFromAlert} />}
            {page === "graph" && <GraphView user={user} employees={employees} setEmployees={setEmployees} setAlerts={setAlerts} />}
            {page === "ingestion" && <Ingestion user={user} />}
          </div>
        </div>
      </div>
    </>
  );
}
