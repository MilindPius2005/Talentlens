import React from 'react';

const TYPE_BADGE_COLORS = {
  Employee:   { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  SkillGroup: { bg: '#ECFDF5', text: '#059669', border: '#A7F3D0' },
  Skill:      { bg: '#ECFDF5', text: '#059669', border: '#A7F3D0' },
  Client:     { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' },
  Location:   { bg: '#F0FDFA', text: '#0D9488', border: '#99F6E4' },
  Domain:     { bg: '#FDF2F8', text: '#DB2777', border: '#FBCFE8' },
  Level:      { bg: '#EEF2FF', text: '#4F46E5', border: '#C7D2FE' },
  Project:    { bg: '#F5F3FF', text: '#7C3AED', border: '#DDD6FE' },
  Module:     { bg: '#FFF1F2', text: '#E11D48', border: '#FECDD3' },
  default:    { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' },
};

function getBadgeStyle(type) {
  return TYPE_BADGE_COLORS[type] || TYPE_BADGE_COLORS.default;
}

export default function SearchBar({
  searchQuery,
  onQueryChange,
  searchResults = [],
  pendingGraphRoot,
  onSelectResult,
  onGenerateGraph,
  isLoading = false,
}) {
  const isFilterResult = !searchQuery && searchResults.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 640 }}>
      {/* Search Input Row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', fontSize: 16 }}>
            🔍
          </span>
          <input
            type="text"
            className="form-input"
            value={searchQuery}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by name, skill, client… or use filters on the left"
            style={{
              width: '100%',
              paddingLeft: 38,
              paddingRight: searchQuery ? 36 : 14,
              height: 42,
              borderRadius: 10,
              border: '1.5px solid #CBD5E1',
              fontSize: 14,
              background: '#FFFFFF',
              color: '#1E2233',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              outline: 'none',
              transition: 'border-color 150ms ease',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => onQueryChange('')}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer', padding: '2px 6px' }}
              title="Clear search"
            >
              &times;
            </button>
          )}
        </div>

        {searchResults.length > 0 && (
          <button
            onClick={onGenerateGraph}
            disabled={!pendingGraphRoot || isLoading}
            style={{
              padding: '0 18px', height: 42, borderRadius: 10,
              background: !pendingGraphRoot || isLoading ? '#94A3B8' : '#0A7C88',
              color: '#FFFFFF', fontWeight: 600, fontSize: 13, border: 'none',
              cursor: !pendingGraphRoot || isLoading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: '0 2px 6px rgba(10,124,136,0.25)', whiteSpace: 'nowrap',
              transition: 'background 150ms ease',
            }}
          >
            {isLoading ? <span>Loading…</span> : <span>✦ Generate Knowledge Graph</span>}
          </button>
        )}
      </div>

      {/* Results panel */}
      {searchResults.length > 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 6,
          background: '#F8FAFC', border: '1px solid #E2E8F0',
          borderRadius: 12, padding: 10, maxHeight: 300,
          overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 6px', marginBottom: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748B', letterSpacing: 0.5 }}>
              {isFilterResult ? '🔽 Filter Results' : '🔍 Search Results'} ({searchResults.length}) — Click to Select Root
            </span>
            {isFilterResult && (
              <span style={{ fontSize: 10, color: '#10B981', fontWeight: 600, background: '#ECFDF5', padding: '2px 8px', borderRadius: 6, border: '1px solid #A7F3D0' }}>
                From sidebar filters
              </span>
            )}
          </div>

          {searchResults.map((result) => {
            const isSelected = result.id === pendingGraphRoot;
            const badge = getBadgeStyle(result.type);

            return (
              <button
                key={result.id}
                type="button"
                onClick={() => onSelectResult(result)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: isSelected ? '#EFF6FF' : '#FFFFFF',
                  border: isSelected ? '2px solid #2563EB' : '1px solid #E2E8F0',
                  boxShadow: isSelected ? '0 0 0 2px rgba(37,99,235,0.15)' : 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 120ms ease',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: isSelected ? '#1E3A8A' : '#0F172A' }}>
                    {result.label || result.id}
                  </div>
                  <div style={{ fontSize: 11, color: isSelected ? '#3B82F6' : '#64748B' }}>
                    {isSelected ? '✓ Selected to generate graph' : (result.subtext || 'Click to select')}
                  </div>
                </div>

                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 9px',
                  borderRadius: 6,
                  background: badge.bg,
                  color: badge.text,
                  border: `1px solid ${badge.border}`,
                  letterSpacing: 0.2,
                }}>
                  {result.type}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
