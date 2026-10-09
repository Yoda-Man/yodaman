/**
 * Runs Holocron's WASM layout engine off the main thread, so arranging a large
 * graph never freezes the viewer. One message in (the graph), one message out
 * (positions, or an error the caller turns into a fallback).
 *
 * The engine is served from public/vendor/holocron-layout/ (see
 * scripts/sync-holocron-layout.js) and imported at runtime, not bundled: it is
 * compiled output from the Holocron repository, and it locates its .wasm file
 * next to itself.
 */
import { runLayout } from './engineRunner.mjs'

const ENGINE_BASE = new URL('/vendor/holocron-layout/', globalThis.location.origin)
let engine

async function loadEngine() {
  if (!engine) {
    engine = (async () => {
      const [{ default: createModule }, { bindLayoutEngine }] = await Promise.all([
        import(/* @vite-ignore */ new URL('layout_engine.mjs', ENGINE_BASE).href),
        import(/* @vite-ignore */ new URL('bindLayoutEngine.js', ENGINE_BASE).href),
      ])
      return bindLayoutEngine(await createModule())
    })()
  }
  return engine
}

globalThis.onmessage = async ({ data }) => {
  try {
    const positions = runLayout(await loadEngine(), data)
    globalThis.postMessage({ ok: true, positions }, [positions.buffer])
  } catch (err) {
    // A failed load must not be cached: the next request should retry.
    engine = undefined
    globalThis.postMessage({ ok: false, error: err?.message || String(err) })
  }
}
