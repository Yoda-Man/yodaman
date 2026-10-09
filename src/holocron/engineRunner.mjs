/**
 * One call into Holocron's WASM layout engine: copy the graph in, lay it out,
 * copy the positions out, free the engine's buffers.
 *
 * Kept free of worker and DOM APIs so the same code runs in the layout worker
 * and in Node, where tests drive the real compiled engine through it.
 *
 * Buffer layout (Holocron 04-WASM-Spec.md §4.2):
 *   node: x, y, z, mass, cluster, import flag, reserved   (7 float32)
 *   edge: source, target, weight                          (3 int32)
 */
export const NODE_STRIDE = 7;
export const EDGE_STRIDE = 3;

const SETTERS = {
  convergenceDelta: 'set_convergence_threshold',
  repulsionK: 'set_repulsion_k',
  attractionK: 'set_attraction_k',
  damping: 'set_damping',
  maxIterations: 'set_max_iterations',
  sceneRadius: 'set_scene_radius',
};

/**
 * @param {object} engine  A module bound by bindLayoutEngine.
 * @param {{nodes: Float32Array, edges: Int32Array, nodeCount: number, edgeCount: number, config?: object}} input
 * @returns {Float32Array} nodeCount × (x, y, z), owned by the caller.
 */
export function runLayout(engine, { nodes, edges, nodeCount, edgeCount, config = {} }) {
  for (const [key, setter] of Object.entries(SETTERS)) {
    if (config[key] !== undefined) engine[setter](config[key]);
  }

  const init = engine.init_graph(nodeCount, edgeCount);
  if (init !== 0) throw new Error(`Layout engine could not allocate the graph (code ${init})`);
  try {
    // Heap views are read after init_graph: allocation can grow memory, which
    // replaces the buffer behind them.
    new Float32Array(engine.HEAPF32.buffer, engine.get_node_input_ptr(), nodeCount * NODE_STRIDE).set(nodes);
    if (edgeCount > 0) {
      new Int32Array(engine.HEAP32.buffer, engine.get_edge_input_ptr(), edgeCount * EDGE_STRIDE).set(edges);
    }
    const result = engine.compute_layout();
    if (result !== 0) throw new Error(`Layout engine failed (code ${result})`);
    // slice(): the view points into engine memory, which free_memory releases.
    return new Float32Array(engine.HEAPF32.buffer, engine.get_positions_ptr(), nodeCount * 3).slice();
  } finally {
    engine.free_memory();
  }
}
