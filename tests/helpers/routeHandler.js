/**
 * Finds an Express route handler by method and path, searching mounted
 * sub-routers as well as the top level.
 *
 * Since the W-6 split, route groups (/git, /stardust, ...) live in their own
 * Router mounted on the main one, so a flat scan of `router.stack` no longer
 * finds them. Tests that reach directly for a handler need to recurse.
 */
function findRouteHandler(router, method, routePath) {
    function search(stack) {
        for (const item of stack) {
            if (item.route?.path === routePath && item.route?.methods[method]) {
                return item.route.stack[0].handle;
            }
            const nested = item.handle?.stack ? search(item.handle.stack) : null;
            if (nested) return nested;
        }
        return null;
    }

    const handler = search(router.stack);
    if (!handler) throw new Error(`no ${method.toUpperCase()} route registered at ${routePath}`);
    return handler;
}

module.exports = { findRouteHandler };
