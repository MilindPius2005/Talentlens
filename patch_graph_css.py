with open("src/TalentLens.tsx", "r") as f:
    content = f.read()

graph_css = """
  /* Graph CSS from Knowledge Graphs */
  .graph-stage { position: relative; width: 100%; height: 100%; overflow: hidden; background-image: linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px); background-size: 34px 34px; }
  .graph-svg { display: block; width: 100%; height: 100%; }
  .graph-link { stroke: rgba(148,163,184,0.45); stroke-width: 1.4; }
  .graph-node { stroke: rgba(255,255,255,0.78); stroke-width: 1.4; filter: drop-shadow(0 8px 18px rgba(0,0,0,0.35)); cursor: pointer; transition: r 180ms ease, stroke-width 180ms ease, opacity 180ms ease; }
  .graph-node:hover { stroke-width: 3; }
  .graph-node.selected { stroke: #ffffff; stroke-width: 4; }
  .graph-node.root { stroke: #f8fafc; }
  .graph-node.expanded { filter: drop-shadow(0 0 6px rgba(88,166,255,0.55)); }
  .graph-label { pointer-events: auto; cursor: pointer; fill: #ffffff; paint-order: stroke; stroke: rgba(7,10,14,0.9); stroke-width: 4px; stroke-linejoin: round; font-size: 11px; font-weight: 600; }
"""

if ".graph-stage" not in content:
    content = content.replace("const css = `", "const css = `\n" + graph_css)
    with open("src/TalentLens.tsx", "w") as f:
        f.write(content)
    print("Graph CSS injected!")
