/**
 * dsh-sidebar-tab-actions — Node half.
 *
 * The plugin is browser-only: everything it contributes is a menu entry in the
 * right Sidebar's tab strip, which lives in the Web client. The host half exists
 * because a profile row resolves the package's `exports["."]` first, and a row
 * whose package cannot be imported fails to load.
 */

/** Cordis plugin name used in loader diagnostics. */
export const name = 'dsh-sidebar-tab-actions'

/** Contributes nothing on the host side. */
export function apply() {}
