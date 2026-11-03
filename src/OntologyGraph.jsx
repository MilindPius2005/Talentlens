import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import * as d3 from 'd3';
import { buildLayout, getLinkNodeId } from './graphLayout';

const NODE_STYLES = {
  Employee:   { color: '#3B82F6', border: '#2563EB', radius: 34, ring: '#60A5FA' },
  Client:     { color: '#F97316', border: '#EA580C', radius: 28, ring: '#FB923C' },
  SkillGroup: { color: '#10B981', border: '#059669', radius: 28, ring: '#34D399' },
  Skill:      { color: '#10B981', border: '#059669', radius: 24, ring: '#34D399' },
  MiscSkill:  { color: '#14B8A6', border: '#0D9488', radius: 22, ring: '#2DD4BF' },
  Location:   { color: '#06B6D4', border: '#0891B2', radius: 26, ring: '#22D3EE' },
  Domain:     { color: '#EC4899', border: '#DB2777', radius: 26, ring: '#F472B6' },
  Level:      { color: '#6366F1', border: '#4F46E5', radius: 24, ring: '#818CF8' },
  Project:    { color: '#8B5CF6', border: '#7C3AED', radius: 26, ring: '#A78BFA' },
  Module:     { color: '#F43F5E', border: '#E11D48', radius: 24, ring: '#FB7185' },
  Department: { color: '#8B5CF6', border: '#7C3AED', radius: 26, ring: '#A78BFA' },
  default:    { color: '#64748B', border: '#475569', radius: 24, ring: '#94A3B8' },
};

function getStyle(type) {
  return NODE_STYLES[type] || NODE_STYLES.default;
}

const OntologyGraph = forwardRef(function OntologyGraph(
  { graph, selectedNode, rootNode, onNodeSelect, onNodeExpand, onNodeCollapse, expandedNodeIds, isLoading = false },
  ref
) {
  const wrapperRef  = useRef(null);
  const svgRef      = useRef(null);
  const zoomRef     = useRef(null);
  const containerRef= useRef(null);
  const positionsRef= useRef(new Map()); // dragged positions (mutable)
  const draggedPositionsRef = useRef(new Map());
  const zoomLabelRef = useRef(null);
  const interactions = useRef({});
  interactions.current = { onNodeSelect, onNodeExpand, onNodeCollapse, expandedNodeIds };

  // Track whether this is a brand-new graph so we auto-center exactly once
  const prevRootRef = useRef(null);

  // ---------- imperative handle ----------
  useImperativeHandle(ref, () => ({
    centerGraph() { doCenter(); },
    resetZoom() {
      if (svgRef.current && zoomRef.current)
        d3.select(svgRef.current).transition().duration(300)
          .call(zoomRef.current.transform, d3.zoomIdentity);
    },
  }));

  function doCenter() {
    const wrapper = wrapperRef.current;
    if (!wrapper || !svgRef.current || !zoomRef.current) return;
    const pos = Array.from(positionsRef.current.values());
    if (!pos.length) return;

    const W = wrapper.clientWidth  || 900;
    const H = wrapper.clientHeight || 650;
    const b = pos.reduce(
      (a, p) => ({ minX: Math.min(a.minX, p.x), maxX: Math.max(a.maxX, p.x), minY: Math.min(a.minY, p.y), maxY: Math.max(a.maxY, p.y) }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );
    const gw = Math.max(b.maxX - b.minX, 1);
    const gh = Math.max(b.maxY - b.minY, 1);
    const pad = 100;
    const scale = Math.min(1.15, Math.max(0.1, Math.min((W - pad * 2) / gw, (H - pad * 2) / gh)));
    const tx = W / 2 - scale * (b.minX + gw / 2);
    const ty = H / 2 - scale * (b.minY + gh / 2);
    d3.select(svgRef.current).transition().duration(180)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  // ─── MAIN DRAW EFFECT ────────────────────────────────────────────────
  // Only re-runs when the graph DATA changes (node/link list).
  // Expand/collapse state is handled separately below.
  useEffect(() => {
    const wrapper  = wrapperRef.current;
    const svgEl    = svgRef.current;
    if (!wrapper || !svgEl) return;

    const W = wrapper.clientWidth  || 900;
    const H = wrapper.clientHeight || 650;

    const svg = d3.select(svgEl);
    svg.attr('viewBox', `0 0 ${W} ${H}`);

    // Keep the SVG, zoom behavior and existing DOM elements across expansions.
    let container = svg.select('g.zoom-container');
    if (container.empty()) {
      const defs = svg.append('defs');
      const shad = defs.append('filter').attr('id', 'node-shadow').attr('height', '130%');
      shad.append('feDropShadow').attr('dx', 0).attr('dy', 3).attr('stdDeviation', 4).attr('flood-opacity', 0.1);
      container = svg.append('g').attr('class', 'zoom-container');
      container.append('g').attr('class', 'links-layer');
      container.append('g').attr('class', 'link-labels-layer').style('pointer-events', 'none');
      container.append('g').attr('class', 'nodes-layer');
      const zoom = d3.zoom().scaleExtent([0.1, 3]).on('zoom', (ev) => {
        container.attr('transform', ev.transform);
        container.select('.link-labels-layer').style('display', ev.transform.k < 0.5 ? 'none' : null);
        if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(ev.transform.k * 100)}%`;
      });
      zoomRef.current = zoom;
      svg.call(zoom).on('dblclick.zoom', null);
    }
    containerRef.current = container;

    const nodes = (graph.nodes || []).map((n) => ({ ...n }));
    const links = (graph.links || []).map((l) => ({ ...l }));
    if (!nodes.length) {
      container.selectAll('.links-layer > *, .link-labels-layer > *, .nodes-layer > *').remove();
      positionsRef.current = new Map();
      draggedPositionsRef.current.clear();
      prevRootRef.current = null;
      return;
    }

    const nodeIds   = new Set(nodes.map((n) => n.id));
    const validLinks= links.filter((l) =>
      nodeIds.has(getLinkNodeId(l.source)) && nodeIds.has(getLinkNodeId(l.target))
    );

    // Compute stable layout
    const layout = buildLayout(nodes, validLinks, rootNode, W, H);
    const isNewGraph = prevRootRef.current !== rootNode || !positionsRef.current.size;
    if (isNewGraph) draggedPositionsRef.current.clear();
    prevRootRef.current = rootNode;
    positionsRef.current = layout;
    for (const [id, position] of draggedPositionsRef.current) {
      if (nodeIds.has(id)) layout.set(id, position);
      else draggedPositionsRef.current.delete(id);
    }
    const positions = positionsRef.current;

    // ── Layers ──
    const linkLayer      = container.select('.links-layer');
    const linkLabelLayer = container.select('.link-labels-layer');
    const nodeLayer      = container.select('.nodes-layer');
    const linkKey = d => JSON.stringify([getLinkNodeId(d.source), getLinkNodeId(d.target), d.type]);

    // ── Links ──
    const linkEls = linkLayer.selectAll('path')
      .data(validLinks, linkKey)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', '#CBD5E1')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.8);

    // Link labels
    const linkLabelGs = linkLabelLayer.selectAll('g.ll')
      .data(validLinks, linkKey)
      .join('g').attr('class', 'll')
      .style('pointer-events', 'none');
    linkLabelGs.selectAll('rect').data(d => [d]).join('rect').attr('rx', 4).attr('ry', 4)
      .attr('fill', '#FFFFFF').attr('stroke', '#E2E8F0').attr('stroke-width', 1).attr('height', 16);
    linkLabelGs.selectAll('text').data(d => [d]).join('text')
      .attr('font-size', '9px').attr('font-weight', '600').attr('fill', '#64748B')
      .attr('text-anchor', 'middle').attr('dy', 11)
      .text((d) => (d.type || '').replace(/^HAS_/, '').replace(/_/g, ' '));

    // Size label backgrounds once. Dragging never reads browser layout.
    linkLabelGs.select('rect')
      .attr('width', d => Math.max(16, (d.type || '').replace(/^HAS_/, '').replace(/_/g, ' ').length * 5.8 + 8))
      .attr('x', d => -Math.max(16, (d.type || '').replace(/^HAS_/, '').replace(/_/g, ' ').length * 5.8 + 8) / 2);
    const incidentPaths = new Map(), incidentLabels = new Map();
    function indexLinks(selection, index) {
      selection.each(function(d) {
        for (const id of new Set([getLinkNodeId(d.source), getLinkNodeId(d.target)])) {
          if (!index.has(id)) index.set(id, []);
          index.get(id).push(this);
        }
      });
    }
    indexLinks(linkEls, incidentPaths);
    indexLinks(linkLabelGs, incidentLabels);
    function updateLinks(nodeId) {
      const paths = nodeId == null ? linkEls : d3.selectAll(incidentPaths.get(nodeId) || []);
      const labels = nodeId == null ? linkLabelGs : d3.selectAll(incidentLabels.get(nodeId) || []);
      paths.attr('d', (d) => {
        const s = positions.get(getLinkNodeId(d.source)) || { x: W / 2, y: H / 2 };
        const t = positions.get(getLinkNodeId(d.target)) || { x: W / 2, y: H / 2 };
        const my = (s.y + t.y) / 2;
        return `M${s.x},${s.y} C${s.x},${my} ${t.x},${my} ${t.x},${t.y}`;
      });
      labels.each(function (d) {
        const s = positions.get(getLinkNodeId(d.source)) || { x: W / 2, y: H / 2 };
        const t = positions.get(getLinkNodeId(d.target)) || { x: W / 2, y: H / 2 };
        const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
        d3.select(this).attr('transform', `translate(${mx},${my - 8})`);
      });
    }
    updateLinks();

    // ── Node groups ──
    const nodeGs = nodeLayer.selectAll('g.ng')
      .data(nodes, (d) => d.id)
      .join('g').attr('class', 'ng')
      .attr('cursor', 'pointer')
      .attr('transform', (d) => {
        const p = positions.get(d.id) || { x: W / 2, y: H / 2 };
        return `translate(${p.x},${p.y})`;
      });

    // Collapse ring (shown when expanded & not root)
    nodeGs.selectAll('circle.c-ring').data(d => [d]).join('circle').attr('class', 'c-ring')
      .attr('r', (d) => getStyle(d.type).radius + 10)
      .attr('fill', 'none')
      .attr('stroke', '#10B981').attr('stroke-width', 2.5).attr('stroke-dasharray', '5 4')
      .style('pointer-events', 'none')
      .attr('opacity', (d) => expandedNodeIds?.has(d.id) ? 1 : 0);

    // Main circle
    nodeGs.selectAll('circle.node-circle').data(d => [d]).join('circle').attr('class', 'node-circle')
      .attr('r', (d) => getStyle(d.type).radius)
      .attr('fill', (d) => d.type === 'Employee' && d.status === 'SOFTBLOCKED' ? '#B8710F' : getStyle(d.type).color)
      .attr('stroke', '#FFFFFF').attr('stroke-width', 3)
      .attr('filter', nodes.length > 200 ? null : 'url(#node-shadow)');

    // Initials
    nodeGs.selectAll('text.node-init').data(d => [d]).join('text').attr('class', 'node-init')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('font-size', (d) => (d.id === rootNode || d.type === 'Employee') ? '14px' : '11px')
      .attr('font-weight', '700').attr('fill', '#FFFFFF').attr('pointer-events', 'none')
      .text((d) => {
        const t = d.label || d.id || '';
        if (d.type === 'Employee' || d.id === rootNode) {
          const pts = t.split(' ').filter(Boolean);
          return pts.length >= 2 ? (pts[0][0] + pts[1][0]).toUpperCase() : t.slice(0, 2).toUpperCase();
        }
        return t.length > 5 ? t.slice(0, 3) + '…' : t;
      });

    // Label group
    const lblG = nodeGs.selectAll('g.node-lbl').data(d => [d]).join('g').attr('class', 'node-lbl')
      .attr('transform', (d) => `translate(0,${getStyle(d.type).radius + 18})`);
    lblG.selectAll('text.n-title').data(d => [d]).join('text').attr('class', 'n-title')
      .attr('text-anchor', 'middle')
      .attr('font-size', (d) => d.id === rootNode ? '13px' : '11.5px')
      .attr('font-weight', (d) => d.id === rootNode ? '700' : '600')
      .attr('fill', '#0F172A')
      .style('paint-order', 'stroke').style('stroke', '#FFFFFF')
      .style('stroke-width', '3px').style('stroke-linejoin', 'round')
      .text((d) => { const n = d.label || d.id; return n.length > 22 ? n.slice(0, 20) + '…' : n; });
    lblG.selectAll('text.n-sub').data(d => [d]).join('text').attr('class', 'n-sub')
      .attr('text-anchor', 'middle').attr('y', 15)
      .attr('font-size', '10px').attr('font-weight', '500')
      .attr('fill', (d) => {
        if (expandedNodeIds?.has(d.id)) return '#059669';
        if (d.id === rootNode) return '#2563EB';
        return '#64748B';
      })
      .text((d) => {
        if (d.type === 'Employee' && d.status === 'SOFTBLOCKED') return 'Soft-blocked';
        if (expandedNodeIds?.has(d.id)) return 'expanded ↓';
        if (d.id === rootNode) return '● Root';
        return d.type || 'Node';
      });

    // ── Click ──
    function handleClick(event, d) {
      event.stopPropagation();
      interactions.current.onNodeSelect?.(d);
      const isExp = interactions.current.expandedNodeIds?.has(d.id);
      const sty   = getStyle(d.type);
      if (isExp) {
        d3.select(event.currentTarget).select('circle.node-circle')
          .transition().duration(100).attr('r', sty.radius * 1.25)
          .transition().duration(130).attr('r', sty.radius)
          .on('end', () => interactions.current.onNodeCollapse?.(d));
      } else if (!isExp) {
        interactions.current.onNodeExpand?.(d);
      }
    }
    nodeGs.on('click', handleClick);

    // ── Tooltip ──
    const tooltip = d3.select(wrapper).select('.g-tooltip');
    nodeGs
      .on('mouseenter', (ev, d) => {
        linkEls
          .attr('stroke', (l) => getLinkNodeId(l.source) === d.id || getLinkNodeId(l.target) === d.id ? '#2563EB' : '#CBD5E1')
          .attr('stroke-width', (l) => getLinkNodeId(l.source) === d.id || getLinkNodeId(l.target) === d.id ? 3 : 2);
        if (!tooltip.empty()) {
          tooltip.style('display', 'block')
            .style('left', `${ev.offsetX + 16}px`)
            .style('top',  `${ev.offsetY - 10}px`)
            .html(`
              <div style="font-weight:700;font-size:13px;color:#0F172A;margin-bottom:2px">${d.label || d.id}</div>
              <div style="font-size:11px;color:#64748B">${d.type || 'Node'}</div>
              ${d.id === rootNode ? `<div style="font-size:11px;color:#2563EB;margin-top:2px;font-weight:600">★ Root Node</div>` : ''}
              <div style="font-size:10px;color:#94A3B8;margin-top:4px">${interactions.current.expandedNodeIds?.has(d.id) ? 'Click to collapse' : 'Click to expand'}</div>
            `);
        }
      })
      .on('mouseleave', () => {
        linkEls.attr('stroke', '#CBD5E1').attr('stroke-width', 2);
        if (!tooltip.empty()) tooltip.style('display', 'none');
      });

    // ── Drag ──
    let dragFrame;
    const drag = d3.drag()
      .clickDistance(4)
      .subject((event, node) => positions.get(node.id))
      .on('drag', function (ev, d) {
        positions.set(d.id, { x: ev.x, y: ev.y });
        draggedPositionsRef.current.set(d.id, { x: ev.x, y: ev.y });
        d3.select(this).attr('transform', `translate(${ev.x},${ev.y})`);
        if (dragFrame) cancelAnimationFrame(dragFrame);
        dragFrame = requestAnimationFrame(() => { dragFrame = null; updateLinks(d.id); });
      });
    nodeGs.call(drag);

    // Auto-center only on brand-new graph load
    const centerFrame = isNewGraph ? requestAnimationFrame(doCenter) : null;
    return () => {
      if (centerFrame) cancelAnimationFrame(centerFrame);
      if (dragFrame) cancelAnimationFrame(dragFrame);
      nodeGs.interrupt();
      nodeGs.selectAll('*').interrupt();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, rootNode]);

  // ─── LIGHTWEIGHT STYLE UPDATE EFFECT ─────────────────────────────────
  // Handles expand/collapse ring + selection ring changes WITHOUT redrawing.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.selectAll('g.ng').each(function (d) {
      const g = d3.select(this);
      const isExp = expandedNodeIds?.has(d.id);
      g.select('circle.c-ring')
        .attr('opacity', isExp ? 1 : 0);
      g.select('text.n-sub')
        .attr('fill', isExp ? '#059669' : d.id === rootNode ? '#2563EB' : '#64748B')
        .text(d.type === 'Employee' && d.status === 'SOFTBLOCKED' ? 'Soft-blocked' : isExp ? 'expanded ↓' : d.id === rootNode ? '● Root' : d.type || 'Node');
    });
  }, [expandedNodeIds, selectedNode, rootNode]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#FAFBFF' }}>
      <svg ref={svgRef} style={{ display: 'block', width: '100%', height: '100%' }} />

      {isLoading && (
        <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.95)', border: '1px solid #E2E8F0', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, color: '#0A7C88', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', zIndex: 15 }}>
          ✦ Loading graph…
        </div>
      )}

      {/* Tooltip */}
      <div className="g-tooltip" style={{ position: 'absolute', display: 'none', pointerEvents: 'none', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 20, fontFamily: 'inherit' }} />

      {/* Controls */}
      {graph.nodes && graph.nodes.length > 0 && (
        <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', alignItems: 'center', gap: 6, background: '#FFFFFF', padding: '6px 10px', borderRadius: 10, border: '1px solid #E2E8F0', boxShadow: '0 4px 12px rgba(0,0,0,0.07)', zIndex: 10 }}>
          <button onClick={() => d3.select(svgRef.current).transition().duration(220).call(zoomRef.current.scaleBy, 1.25)}
            style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #CBD5E1', background: '#F8FAFC', fontWeight: 700, cursor: 'pointer', fontSize: 16 }}>+</button>
          <button onClick={() => d3.select(svgRef.current).transition().duration(220).call(zoomRef.current.scaleBy, 0.8)}
            style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #CBD5E1', background: '#F8FAFC', fontWeight: 700, cursor: 'pointer', fontSize: 16 }}>−</button>
          <button onClick={doCenter}
            style={{ padding: '0 10px', height: 28, borderRadius: 6, border: '1px solid #CBD5E1', background: '#F8FAFC', fontSize: 11, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
            ⊙ Fit (<span ref={zoomLabelRef}>100%</span>)
          </button>
          <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 2 }}>• Drag to move</span>
        </div>
      )}
    </div>
  );
});

export default memo(OntologyGraph);
