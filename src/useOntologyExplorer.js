import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').trim().replace(/\/+$/, '');

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

export function useOntologyExplorer(initialFilters = {}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [pendingGraphRoot, setPendingGraphRoot] = useState(null);
  const [graph, setGraph] = useState({ nodes: [], links: [] });
  const [rootNode, setRootNode] = useState(null);
  const [expandedNodeIds, setExpandedIds] = useState(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [filters, setFilters] = useState(initialFilters);
  const searchRequestId = useRef(0);
  const graphEpoch = useRef(0);

  const clearExplorer = useCallback(() => {
    searchRequestId.current++;
    graphEpoch.current++;
    setSearchQuery('');
    setSearchResults([]);
    setPendingGraphRoot(null);
    setGraph({ nodes: [], links: [] });
    setRootNode(null);
    setExpandedIds(new Set());
    setSelectedNode(null);
    setIsLoading(false);
  }, []);

  // Debounced search watcher
  useEffect(() => {
    const requestId = ++searchRequestId.current;
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setPendingGraphRoot(null);
      return;
    }

    const timer = setTimeout(() => {
      handleSearch(searchQuery.trim(), requestId);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, filters]);

  // Step 1: Search nodes
  const handleSearch = useCallback(async (query, requestId) => {
    if (!query) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`, {
        credentials: 'include',
      });
      const results = (await parseJsonSafe(res)) || [];
      if (requestId !== searchRequestId.current) return;
      setSearchResults(results);
      if (results.length > 0) {
        setPendingGraphRoot(results[0].id);
      } else {
        setPendingGraphRoot(null);
      }
    } catch (err) {
      if (requestId !== searchRequestId.current) return;
      console.error('Search failed:', err);
      setSearchResults([]);
      setPendingGraphRoot(null);
    } finally {
      if (requestId === searchRequestId.current) setIsLoading(false);
    }
  }, []);

  // Step 2: Select a search result card
  const selectSearchResult = useCallback((result) => {
    if (!result) return;
    setPendingGraphRoot(result.id);
  }, []);

  // Helper: Merge graphs without duplicating IDs
  const mergeGraphs = useCallback((currentGraph, newNodes = [], newLinks = []) => {
    const existingNodeIds = new Set(currentGraph.nodes.map((n) => n.id));
    const mergedNodes = [...currentGraph.nodes];

    newNodes.forEach((node) => {
      if (!existingNodeIds.has(node.id)) {
        existingNodeIds.add(node.id);
        mergedNodes.push(node);
      }
    });

    const existingLinkKeys = new Set(
      currentGraph.links.map((l) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return `${s}->${t}`;
      })
    );

    const mergedLinks = [...currentGraph.links];
    newLinks.forEach((link) => {
      const s = typeof link.source === 'object' ? link.source.id : link.source;
      const t = typeof link.target === 'object' ? link.target.id : link.target;
      const key = `${s}->${t}`;
      if (!existingLinkKeys.has(key)) {
        existingLinkKeys.add(key);
        mergedLinks.push(link);
      }
    });

    return { nodes: mergedNodes, links: mergedLinks };
  }, []);

  // Step 3: User clicks "Generate Knowledge Graph"
  const generateKnowledgeGraph = useCallback(async () => {
    if (!pendingGraphRoot) return;
    const targetRoot = pendingGraphRoot;
    const epoch = graphEpoch.current;

    // Clear search results and pending root
    setSearchResults([]);
    setPendingGraphRoot(null);
    setSearchQuery('');
    setSelectedNode(null);
    setRootNode(targetRoot);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/expand/${encodeURIComponent(targetRoot)}`, {
        credentials: 'include',
      });
      const data = await parseJsonSafe(res);
      if (epoch !== graphEpoch.current) return;

      if (data && data.nodes && data.nodes.length > 0) {
        setGraph(data);
        setExpandedIds(new Set([targetRoot]));
      } else {
        // Fallback root
        setGraph({
          nodes: [{ id: targetRoot, label: targetRoot, type: 'Employee' }],
          links: [],
        });
        setExpandedIds(new Set([targetRoot]));
      }
    } catch (err) {
      if (epoch !== graphEpoch.current) return;
      console.error('Failed to generate graph:', err);
      setGraph({
        nodes: [{ id: targetRoot, label: targetRoot, type: 'Employee' }],
        links: [],
      });
      setExpandedIds(new Set([targetRoot]));
    } finally {
      if (epoch === graphEpoch.current) setIsLoading(false);
    }
  }, [pendingGraphRoot]);

  // Load a graph directly (e.g. from filter selection)
  const loadGraph = useCallback(async (rootId) => {
    if (!rootId) return;
    const epoch = graphEpoch.current;
    setRootNode(rootId);
    setSelectedNode(null);
    setSearchResults([]);
    setPendingGraphRoot(null);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/expand/${encodeURIComponent(rootId)}`, {
        credentials: 'include',
      });
      const data = await parseJsonSafe(res);
      if (epoch !== graphEpoch.current) return;

      if (data && data.nodes && data.nodes.length > 0) {
        setGraph(data);
        setExpandedIds(new Set([rootId]));
      } else {
        setGraph({
          nodes: [{ id: rootId, label: rootId, type: 'Employee' }],
          links: [],
        });
        setExpandedIds(new Set([rootId]));
      }
    } catch (err) {
      if (epoch !== graphEpoch.current) return;
      console.error('Failed to load graph:', err);
    } finally {
      if (epoch === graphEpoch.current) setIsLoading(false);
    }
  }, []);

  // Step 4: Expand a non-root node
  const expandNodeInGraph = useCallback(async (node) => {
    const nodeId = typeof node === 'object' ? node.id : node;
    if (!nodeId) return;
    const epoch = graphEpoch.current;

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/expand/${encodeURIComponent(nodeId)}`, {
        credentials: 'include',
      });
      const data = await parseJsonSafe(res);
      if (epoch !== graphEpoch.current) return;

      if (data && (data.nodes || data.links)) {
        setGraph((prev) => mergeGraphs(prev, data.nodes || [], data.links || []));
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.add(nodeId);
          return next;
        });
      }
    } catch (err) {
      if (epoch !== graphEpoch.current) return;
      console.error('Expand node error:', err);
    } finally {
      if (epoch === graphEpoch.current) setIsLoading(false);
    }
  }, [mergeGraphs]);

  // Step 5: Collapse an expanded node using BFS reachable analysis
  const collapseNodeInGraph = useCallback((node) => {
    const nodeId = typeof node === 'object' ? node.id : node;
    if (!nodeId) return;

    setGraph((prev) => {
      const { nodes, links } = prev;

      // 1. Build adjacency map
      const adj = new Map();
      nodes.forEach((n) => adj.set(n.id, []));
      links.forEach((l) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        if (adj.has(s)) adj.get(s).push(t);
        if (adj.has(t)) adj.get(t).push(s);
      });

      // 2. BFS from the collapsed node to find all its descendants
      const descendants = new Set();
      const queue = [...(adj.get(nodeId) || [])];
      while (queue.length > 0) {
        const curr = queue.shift();
        if (!descendants.has(curr) && curr !== nodeId && curr !== rootNode) {
          descendants.add(curr);
          (adj.get(curr) || []).forEach((nbr) => {
            if (!descendants.has(nbr) && nbr !== nodeId && nbr !== rootNode) {
              queue.push(nbr);
            }
          });
        }
      }

      // 3. BFS from root with the collapsed node cut out to see what's still reachable
      const reachableFromRootWithoutNode = new Set();
      if (rootNode && rootNode !== nodeId) {
        const rQueue = [rootNode];
        reachableFromRootWithoutNode.add(rootNode);

        while (rQueue.length > 0) {
          const curr = rQueue.shift();
          (adj.get(curr) || []).forEach((nbr) => {
            if (nbr !== nodeId && !reachableFromRootWithoutNode.has(nbr)) {
              reachableFromRootWithoutNode.add(nbr);
              rQueue.push(nbr);
            }
          });
        }
      }

      // 4. Remove descendants that are exclusively reachable through the collapsed node
      const nodesToRemove = new Set();
      descendants.forEach((dId) => {
        if (!reachableFromRootWithoutNode.has(dId)) {
          nodesToRemove.add(dId);
        }
      });

      const remainingNodes = nodes.filter((n) => !nodesToRemove.has(n.id));
      const remainingNodeIds = new Set(remainingNodes.map((n) => n.id));

      const remainingLinks = links.filter((l) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return remainingNodeIds.has(s) && remainingNodeIds.has(t);
      });

      return {
        nodes: remainingNodes,
        links: remainingLinks,
      };
    });

    // 5. Remove node from expandedNodeIds
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, [rootNode]);

  return {
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
    filters,
    setFilters,
    clearExplorer,
  };
}
