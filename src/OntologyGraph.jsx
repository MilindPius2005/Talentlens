import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as d3 from 'd3';

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

function getLinkNodeId(value) {
  return typeof value === 'object' ? value.id : value;
}

// Compute a top-down tree layout: root at top, children spread downward.
function buildLayout(nodes, links, rootNodeId, width, height) {
  if (!nodes.length) return new Map();

  const validIds = new Set(nodes.map((n) => n.id));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  links.forEach((l) => {
    const s = getLinkNodeId(l.source);
    const t = getLinkNodeId(l.target);
    if (!validIds.has(s) || !validIds.has(t)) return;
    adj.get(s).push(t);
    adj.get(t).push(s);
  });

  const start = (rootNodeId && validIds.has(rootNodeId)) ? rootNodeId : nodes[0].id;

  // BFS to get parent-child tree structure
  const depthMap = new Map();
  const parentMap = new Map();
  const childrenMap = new Map();
  const queue = [start];
  depthMap.set(start, 0);
  childrenMap.set(start, []);
  while (queue.length) {
    const cur = queue.shift();
    const d = depthMap.get(cur);
    for (const nbr of (adj.get(cur) || [])) {
      if (!depthMap.has(nbr)) {
        depthMap.set(nbr, d + 1);
        parentMap.set(nbr, cur);
        if (!childrenMap.has(cur)) childrenMap.set(cur, []);
        childrenMap.get(cur).push(nbr);
        if (!childrenMap.has(nbr)) childrenMap.set(nbr, []);
        queue.push(nbr);
      }
    }
  }
  // Handle disconnected nodes
  nodes.forEach((n) => { if (!depthMap.has(n.id)) depthMap.set(n.id, 1); });

  // Group by depth
  const layers = new Map();
  nodes.forEach((n) => {
    const d = depthMap.get(n.id);
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(n);
  });

  const maxDepth = Math.max(...depthMap.values());
  const verticalGap = Math.max(120, Math.min(180, (height - 120) / Math.max(maxDepth, 1)));
  const startY = 80; // root starts near the top

  // Calculate subtree widths for balanced spacing
  function subtreeWidth(nodeId) {
    const children = childrenMap.get(nodeId) || [];
    if (children.length === 0) return 1;
    return children.reduce((sum, c) => sum + subtreeWidth(c), 0);
  }

  const positions = new Map();
  const minHGap = 100; // minimum horizontal gap between sibling nodes

  // Position tree recursively
  function positionSubtree(nodeId, leftX, depth) {
    const y = startY + depth * verticalGap;
    const children = childrenMap.get(nodeId) || [];
    if (children.length === 0) {
      positions.set(nodeId, { x: leftX + minHGap / 2, y });
      return minHGap;
    }
    let totalWidth = 0;
    const childWidths = [];
    for (const c of children) {
      const w = Math.max(minHGap, subtreeWidth(c) * minHGap);
      childWidths.push(w);
      totalWidth += w;
    }
    let cx = leftX;
    for (let i = 0; i < children.length; i++) {
      positionSubtree(children[i], cx, depth + 1);
      cx += childWidths[i];
    }
    // Center the parent above its children
    const firstChild = positions.get(children[0]);
    const lastChild = positions.get(children[children.length - 1]);
    const parentX = (firstChild.x + lastChild.x) / 2;
    positions.set(nodeId, { x: parentX, y });
    return totalWidth;
  }

  const totalTreeWidth = Math.max(minHGap, subtreeWidth(start) * minHGap);
  const offsetX = (width - totalTreeWidth) / 2;
  positionSubtree(start, offsetX, 0);

  // Handle disconnected nodes (place them in a row below the tree)
  let disconnectedX = 50;
  nodes.forEach((n) => {
    if (!positions.has(n.id)) {
      positions.set(n.id, { x: disconnectedX, y: startY + (maxDepth + 1) * verticalGap });
      disconnectedX += minHGap;
    }
  });

  return positions;
}

const OntologyGraph = forwardRef(function OntologyGraph(
  { graph, selectedNode, rootNode, onNodeSelect, onNodeExpand, onNodeCollapse, expandedNodeIds, isLoading = false },
  ref
) {
  const wrapperRef  = useRef(null);
  const svgRef      = useRef(null);
  const zoomRef     = useRef(null);
  const containerRef= useRef(null);
  const layoutRef   = useRef(new Map());
  const positionsRef= useRef(new Map()); // dragged positions (mutable)
  const nodesDataRef= useRef([]);
  const linksDataRef= useRef([]);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Track whether this is a brand-new graph so we auto-center exactly once
  const prevGraphKeyRef = useRef('');

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
    const scale = Math.min(1.15, Math.max(0.4, Math.min((W - pad * 2) / gw, (H - pad * 2) / gh)));
    const tx = W / 2 - scale * (b.minX + gw / 2);
    const ty = H / 2 - scale * (b.minY + gh / 2);
    d3.select(svgRef.current).transition().duration(500)
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
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${W} ${H}`);

    // Defs
    const defs = svg.append('defs');
    const shad = defs.append('filter').attr('id', 'node-shadow').attr('height', '130%');
    shad.append('feDropShadow').attr('dx', 0).attr('dy', 3).attr('stdDeviation', 4).attr('flood-opacity', 0.1);

    const container = svg.append('g').attr('class', 'zoom-container');
    containerRef.current = container;

    // Zoom — user can pan/zoom freely, but we NEVER programmatically jump unless it's a new graph
    const zoom = d3.zoom()
      .scaleExtent([0.25, 3])
      .on('zoom', (ev) => {
        container.attr('transform', ev.transform);
        setZoomLevel(ev.transform.k);
      });
    zoomRef.current = zoom;
    svg.call(zoom);

    // Disable double-click-to-zoom (avoids accidental zoom jumps)
    svg.on('dblclick.zoom', null);

    const nodes = (graph.nodes || []).map((n) => ({ ...n }));
    const links = (graph.links || []).map((l) => ({ ...l }));
    nodesDataRef.current = nodes;
    linksDataRef.current = links;

    if (!nodes.length) {
      layoutRef.current   = new Map();
      positionsRef.current= new Map();
      return;
    }

    const nodeIds   = new Set(nodes.map((n) => n.id));
    const validLinks= links.filter((l) =>
      nodeIds.has(getLinkNodeId(l.source)) && nodeIds.has(getLinkNodeId(l.target))
    );

    // Compute stable layout
    const layout = buildLayout(nodes, validLinks, rootNode, W, H);
    layoutRef.current = layout;

    // Initialize draggable positions from layout (only for NEW graph)
    const graphKey = nodes.map((n) => n.id).sort().join('|');
    const isNewGraph = graphKey !== prevGraphKeyRef.current;
    if (isNewGraph) {
      positionsRef.current = new Map(layout);
      prevGraphKeyRef.current = graphKey;
    }

    const positions = positionsRef.current;

    // ── Layers ──
    const linkLayer      = container.append('g').attr('class', 'links-layer');
    const linkLabelLayer = container.append('g').attr('class', 'link-labels-layer');
    const nodeLayer      = container.append('g').attr('class', 'nodes-layer');

    // ── Links ──
    const linkEls = linkLayer.selectAll('path')
      .data(validLinks)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', '#CBD5E1')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.8);

    // Link labels
    const linkLabelGs = linkLabelLayer.selectAll('g.ll')
      .data(validLinks)
      .join('g').attr('class', 'll')
      .style('pointer-events', 'none');
    linkLabelGs.append('rect').attr('rx', 4).attr('ry', 4)
      .attr('fill', '#FFFFFF').attr('stroke', '#E2E8F0').attr('stroke-width', 1).attr('height', 16);
    linkLabelGs.append('text')
      .attr('font-size', '9px').attr('font-weight', '600').attr('fill', '#64748B')
      .attr('text-anchor', 'middle').attr('dy', 11)
      .text((d) => (d.type || '').replace(/^HAS_/, '').replace(/_/g, ' '));

    function updateLinks() {
      linkEls.attr('d', (d) => {
        const s = positions.get(getLinkNodeId(d.source)) || { x: W / 2, y: H / 2 };
        const t = positions.get(getLinkNodeId(d.target)) || { x: W / 2, y: H / 2 };
        const my = (s.y + t.y) / 2;
        return `M${s.x},${s.y} C${s.x},${my} ${t.x},${my} ${t.x},${t.y}`;
      });
      linkLabelGs.each(function (d) {
        const s = positions.get(getLinkNodeId(d.source)) || { x: W / 2, y: H / 2 };
        const t = positions.get(getLinkNodeId(d.target)) || { x: W / 2, y: H / 2 };
        const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
        const g  = d3.select(this);
        const txt= g.select('text');
        const bx = txt.node() ? txt.node().getBBox() : { width: 36 };
        const p  = 6;
        g.select('rect').attr('x', -bx.width / 2 - p / 2).attr('y', 0).attr('width', bx.width + p);
        g.attr('transform', `translate(${mx},${my - 8})`);
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
    nodeGs.append('circle').attr('class', 'c-ring')
      .attr('r', (d) => getStyle(d.type).radius + 10)
      .attr('fill', 'none')
      .attr('stroke', '#10B981').attr('stroke-width', 2.5).attr('stroke-dasharray', '5 4')
      .style('pointer-events', 'none')
      .attr('opacity', (d) => expandedNodeIds?.has(d.id) ? 1 : 0);

    // Selection ring
    nodeGs.append('circle').attr('class', 's-ring')
      .attr('r', (d) => getStyle(d.type).radius + 5)
      .attr('fill', 'none')
      .attr('stroke', (d) => d.id === selectedNode?.id ? '#2563EB' : 'transparent')
      .attr('stroke-width', 3)
      .style('pointer-events', 'none');

    // Main circle
    nodeGs.append('circle').attr('class', 'node-circle')
      .attr('r', (d) => getStyle(d.type).radius)
      .attr('fill', (d) => getStyle(d.type).color)
      .attr('stroke', '#FFFFFF').attr('stroke-width', 3)
      .attr('filter', 'url(#node-shadow)');

    // Initials
    nodeGs.append('text').attr('class', 'node-init')
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
    const lblG = nodeGs.append('g').attr('class', 'node-lbl')
      .attr('transform', (d) => `translate(0,${getStyle(d.type).radius + 18})`);
    lblG.append('text').attr('class', 'n-title')
      .attr('text-anchor', 'middle')
      .attr('font-size', (d) => d.id === rootNode ? '13px' : '11.5px')
      .attr('font-weight', (d) => d.id === rootNode ? '700' : '600')
      .attr('fill', '#0F172A')
      .style('paint-order', 'stroke').style('stroke', '#FFFFFF')
      .style('stroke-width', '3px').style('stroke-linejoin', 'round')
      .text((d) => { const n = d.label || d.id; return n.length > 22 ? n.slice(0, 20) + '…' : n; });
    lblG.append('text').attr('class', 'n-sub')
      .attr('text-anchor', 'middle').attr('y', 15)
      .attr('font-size', '10px').attr('font-weight', '500')
      .attr('fill', (d) => {
        if (expandedNodeIds?.has(d.id)) return '#059669';
        if (d.id === rootNode) return '#2563EB';
        return '#64748B';
      })
      .text((d) => {
        if (expandedNodeIds?.has(d.id)) return 'expanded ↓';
        if (d.id === rootNode) return '● Root';
        return d.type || 'Node';
      });

    // ── Click ──
    function handleClick(event, d) {
      event.stopPropagation();
      if (onNodeSelect) onNodeSelect(d);
      const isExp = expandedNodeIds?.has(d.id);
      const sty   = getStyle(d.type);
      if (isExp) {
        d3.select(event.currentTarget).select('circle.node-circle')
          .transition().duration(100).attr('r', sty.radius * 1.25)
          .transition().duration(130).attr('r', sty.radius)
          .on('end', () => { if (onNodeCollapse) onNodeCollapse(d); });
      } else if (!isExp) {
        if (onNodeExpand) onNodeExpand(d);
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
              <div style="font-size:10px;color:#94A3B8;margin-top:4px">${expandedNodeIds?.has(d.id) ? 'Click to collapse' : 'Click to expand'}</div>
            `);
        }
      })
      .on('mouseleave', () => {
        linkEls.attr('stroke', '#CBD5E1').attr('stroke-width', 2);
        if (!tooltip.empty()) tooltip.style('display', 'none');
      });

    // ── Drag ──
    const drag = d3.drag()
      .on('start', function () { d3.select(this).raise(); })
      .on('drag', function (ev, d) {
        positions.set(d.id, { x: ev.x, y: ev.y });
        d3.select(this).attr('transform', `translate(${ev.x},${ev.y})`);
        updateLinks();
      });
    nodeGs.call(drag);

    // Auto-center only on brand-new graph load
    if (isNewGraph) {
      const t = window.setTimeout(doCenter, 400);
      return () => window.clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]); // ← ONLY graph data triggers full redraw

  // ─── LIGHTWEIGHT STYLE UPDATE EFFECT ─────────────────────────────────
  // Handles expand/collapse ring + selection ring changes WITHOUT redrawing.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.selectAll('g.ng').each(function (d) {
      const g = d3.select(this);
      const isExp = expandedNodeIds?.has(d.id);
      const isSel = d.id === selectedNode?.id;

      g.select('circle.c-ring')
        .attr('opacity', isExp ? 1 : 0);
      g.select('circle.s-ring')
        .attr('stroke', isSel ? '#2563EB' : 'transparent');
      g.select('text.n-sub')
        .attr('fill', isExp ? '#059669' : d.id === rootNode ? '#2563EB' : '#64748B')
        .text(isExp ? 'expanded ↓' : d.id === rootNode ? '● Root' : d.type || 'Node');
    });
  }, [expandedNodeIds, selectedNode, rootNode]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#FAFBFF' }}>
      <svg ref={svgRef} style={{ display: 'block', width: '100%', height: '100%' }} />

      {/* Empty state */}
      {(!graph.nodes || graph.nodes.length === 0) && !isLoading && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', color: '#94A3B8', pointerEvents: 'none' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🕸️</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Search a node to begin</div>
          <div style={{ fontSize: 13 }}>Type a name or use filters on the left, then click <b>Generate Knowledge Graph</b>.</div>
        </div>
      )}

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
            ⊙ Fit ({Math.round(zoomLevel * 100)}%)
          </button>
          <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 2 }}>• Drag to move</span>
        </div>
      )}
    </div>
  );
});

export default OntologyGraph;
