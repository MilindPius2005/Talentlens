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
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const isLoading = isSearching || isLoadingGraph;
  const [selectedNode, setSelectedNode] = useState(null);
  const [filters, setFilters] = useState(initialFilters);
  const searchRequestId = useRef(0);
  const graphEpoch = useRef(0);
  const searchController = useRef(null);
  const graphControllers = useRef(new Map());

  const abortGraphRequests = useCallback(() => {
    graphEpoch.current++;
    graphControllers.current.forEach(controller => controller.abort());
    graphControllers.current.clear();
  }, []);

  useEffect(() => () => {
    searchRequestId.current++;
    searchController.current?.abort();
    abortGraphRequests();
  }, [abortGraphRequests]);

  const clearExplorer = useCallback(() => {
    searchRequestId.current++;
    searchController.current?.abort();
    abortGraphRequests();
    setSearchQuery('');
    setSearchResults([]);
    setPendingGraphRoot(null);
    setGraph({ nodes: [], links: [] });
    setRootNode(null);
    setExpandedIds(new Set());
    setSelectedNode(null);
    setIsSearching(false);
    setIsLoadingGraph(false);
  }, [abortGraphRequests]);

  // Debounced search watcher
  useEffect(() => {
    const requestId = ++searchRequestId.current;
    searchController.current?.abort();
    setIsSearching(false);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setPendingGraphRoot(null);
      return;
    }

    const controller = new AbortController();
    searchController.current = controller;
    const timer = setTimeout(() => {
      handleSearch(searchQuery.trim(), requestId, controller.signal);
    }, 300);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery]);

  // Step 1: Search nodes
  const handleSearch = useCallback(async (query, requestId, signal) => {
    if (!query) return;
    setIsSearching(true);
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`, {
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await parseJsonSafe(res);
      const results = Array.isArray(data) ? data : [];
      if (signal.aborted || requestId !== searchRequestId.current) return;
      setSearchResults(results);
      if (results.length > 0) {
        setPendingGraphRoot(results[0].id);
      } else {
        setPendingGraphRoot(null);
      }
    } catch (err) {
      if (signal.aborted || requestId !== searchRequestId.current) return;
      console.error('Search failed:', err);
      setSearchResults([]);
      setPendingGraphRoot(null);
    } finally {
      if (requestId === searchRequestId.current) setIsSearching(false);
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
        return JSON.stringify([s, t, l.type]);
      })
    );

    const mergedLinks = [...currentGraph.links];
    newLinks.forEach((link) => {
      const s = typeof link.source === 'object' ? link.source.id : link.source;
      const t = typeof link.target === 'object' ? link.target.id : link.target;
      const key = JSON.stringify([s, t, link.type]);
      if (!existingLinkKeys.has(key)) {
        existingLinkKeys.add(key);
        mergedLinks.push(link);
      }
    });

    return { nodes: mergedNodes, links: mergedLinks };
  }, []);

  // A new root cancels every request for the previous graph.
  const loadGraph = useCallback(async (rootId) => {
    if (!rootId) return;
    abortGraphRequests();
    const epoch = graphEpoch.current;
    const controller = new AbortController();
    graphControllers.current.set(rootId, controller);
    setRootNode(rootId);
    setSelectedNode(null);
    setSearchResults([]);
    setPendingGraphRoot(null);
    setSearchQuery('');
    setGraph({ nodes: [], links: [] });
    setExpandedIds(new Set());
    setIsLoadingGraph(true);
    try {
      const res = await fetch(`${API_BASE}/expand/${encodeURIComponent(rootId)}`, {
        credentials: 'include', signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Graph request failed (${res.status})`);
      const data = await parseJsonSafe(res);
      if (controller.signal.aborted || epoch !== graphEpoch.current) return;
      setGraph(data?.nodes?.length ? data : {
        nodes: [{ id: rootId, label: rootId, type: 'Employee' }], links: [],
      });
      setExpandedIds(new Set([rootId]));
    } catch (error) {
      if (!controller.signal.aborted && epoch === graphEpoch.current) console.error('Failed to load graph:', error);
    } finally {
      if (epoch === graphEpoch.current) {
        graphControllers.current.delete(rootId);
        setIsLoadingGraph(graphControllers.current.size > 0);
      }
    }
  }, [abortGraphRequests]);

  const generateKnowledgeGraph = useCallback(() => {
    if (pendingGraphRoot) return loadGraph(pendingGraphRoot);
  }, [pendingGraphRoot, loadGraph]);

  // Repeated clicks on a node share the request already in flight.
  const expandNodeInGraph = useCallback(async node => {
    const nodeId = typeof node === 'object' ? node.id : node;
    if (!nodeId || graphControllers.current.has(nodeId)) return;
    const epoch = graphEpoch.current;
    const controller = new AbortController();
    graphControllers.current.set(nodeId, controller);
    setIsLoadingGraph(true);
    try {
      const res = await fetch(`${API_BASE}/expand/${encodeURIComponent(nodeId)}`, {
        credentials: 'include', signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Graph request failed (${res.status})`);
      const data = await parseJsonSafe(res);
      if (controller.signal.aborted || epoch !== graphEpoch.current) return;
      if (data && (data.nodes || data.links)) {
        setGraph(previous => mergeGraphs(previous, data.nodes || [], data.links || []));
        setExpandedIds(previous => new Set([...previous, nodeId]));
      }
    } catch (error) {
      if (!controller.signal.aborted && epoch === graphEpoch.current) console.error('Expand node error:', error);
    } finally {
      if (epoch === graphEpoch.current) {
        graphControllers.current.delete(nodeId);
        setIsLoadingGraph(graphControllers.current.size > 0);
      }
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
      for (let index = 0; index < queue.length; index++) {
        const curr = queue[index];
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

        for (let index = 0; index < rQueue.length; index++) {
          const curr = rQueue[index];
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
