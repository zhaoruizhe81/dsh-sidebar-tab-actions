/**
 * dsh-sidebar-tab-actions — browser half.
 *
 * The right Sidebar's tab strip ships one context-menu entry of its own, "关闭标签",
 * and one extension seat for anything else: `sidebar.right.tab.menu.item`. This
 * plugin is the only occupant of that seat, and it turns the menu into the set of
 * actions a tab strip is expected to offer — pin, close others, close to the
 * right, close to the left, close all.
 *
 * Three facts about the host decide the shape of this file:
 *
 * 1. The seat hands over `{ tab, dismiss }` plus the framework shares. An item
 *    that acts MUST call `dismiss()` — the menu belongs to the docking kit and
 *    closes on its own actions only.
 * 2. Every rendered item MUST carry `role="menuitem"`, or the kit's probe reads
 *    the menu as empty and paints nothing. `MenuItemButton` is the shared
 *    primitive that already is one, so this file hand-rolls no markup.
 * 3. There is no API for "the tabs in this pane". The kit's chip markup is the
 *    contract instead: `[data-dockkit-tab]` chips in document order inside
 *    `[data-dockkit-strip-tabs]`, which is how the kit itself reads its own strip
 *    (`ui-dockkit/src/components/TabLayout.tsx`).
 *
 * No build step: this file IS the artifact. It is emitted in the same closure
 * factory shape the upstream rolldown preset produces, and it requires only
 * baseline module-table entries (`packages/client/web/src/platform.ts`).
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-tab-actions',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const { jsx, jsxs, Fragment } = require('react/jsx-runtime');
    const { MenuItemButton, IconPinOutlineRegular, IconPinFillRegular } = require('@deepseek-ai/dsh-client-ui-primitives');
    const { defineStore } = require('@deepseek-ai/dsh-client-store');

    //#region identity and storage keys

    /** Package name, stamped on the injected style tag. */
    const PLUGIN_ID = 'dsh-sidebar-tab-actions';
    /** Locale namespace for this plugin's copy. */
    const NS = 'sidebarTabActions';
    /** `defineStore` persist prefix; the engine appends `.<scopeKey>` (the Session id). */
    const PIN_PERSIST = 'dsh.sidebar-tab-actions.pins.v1';
    /** Marks a pinned chip; the stylesheet below draws the pin glyph from it. */
    const PINNED_ATTR = 'data-dsh-tab-pinned';
    /** Identity of the one stylesheet this plugin injects. */
    const STYLE_TAG_ID = PLUGIN_ID + '/chips.css';

    /** Shared empty set: a miss is never mutated. */
    const NO_PINS = new Set();

    //#endregion

    //#region the kit's chip markup

    /** Attributes the docking kit writes on one pane's strip and its chips. */
    const TAB_ATTR = 'data-dockkit-tab';
    const STRIP_TABS_ATTR = 'data-dockkit-strip-tabs';
    /** Written only on a lone chip whose close route is withheld. */
    const QUIET_ATTR = 'data-dockkit-tab-quiet';
    /** The Session a rendered rightbar belongs to. */
    const SESSION_ATTR = 'data-sidebar-right-session';

    /** Escape an id for use inside an attribute selector. */
    function escapeAttribute(value) {
      return value.replace(/["\\]/g, '\\$&');
    }

    /**
     * Read the pane holding `tabId`, as its chips appear on screen.
     *
     * The kit draws `pane.tabs` in order, so document order IS the layout order.
     * A floating panel is never a candidate: it renders a
     * `data-dockkit-float-title` header instead of a chip, and it has no context
     * menu at all, so its chips cannot reach this code.
     * @param document - the document to read.
     * @param tabId - the tab whose menu is open.
     * @returns the pane's tab ids in order, and whether the open tab has a close route.
     */
    function readPane(document, tabId) {
      const chip = document.querySelector('[' + TAB_ATTR + '="' + escapeAttribute(tabId) + '"]');
      if (chip === null) return { ids: [], closable: false };
      const box = chip.closest('[' + STRIP_TABS_ATTR + ']');
      if (box === null) return { ids: [], closable: false };
      const ids = [];
      for (const sibling of box.querySelectorAll(':scope > [' + TAB_ATTR + ']')) {
        const id = sibling.getAttribute(TAB_ATTR);
        if (id !== null) ids.push(id);
      }
      // The lone docked guide is the one tab the kit refuses to close, and it is
      // the only chip the kit marks quiet, so that mark is the whole closability
      // answer this menu needs.
      const closable = !chip.hasAttribute(QUIET_ATTR);
      return { ids, closable };
    }

    /**
     * Split one pane's tab order into the four bulk-close target sets.
     *
     * Pinned tabs are excluded from every set. That exclusion is the whole point
     * of pinning here: the docking kit owns the chip's own close control and the
     * menu row it draws, and neither consults this plugin.
     * @param orderedIds - the pane's tab ids, in strip order.
     * @param selfId - the tab whose menu is open.
     * @param pinned - ids that must survive.
     * @returns the ids each menu entry would close; `all` includes `selfId`.
     */
    function targetsFor(orderedIds, selfId, pinned) {
      const index = orderedIds.indexOf(selfId);
      if (index < 0) return { left: [], right: [], others: [], all: [] };
      const left = [];
      const right = [];
      const others = [];
      const all = [];
      for (let at = 0; at < orderedIds.length; at++) {
        const id = orderedIds[at];
        if (pinned.has(id)) continue;
        if (id !== selfId) others.push(id);
        if (at < index) left.push(id);
        else if (at > index) right.push(id);
        all.push(id);
      }
      return { left, right, others, all };
    }

    //#endregion

    //#region the pinned-chip badge

    // The glyph is `IconPinFillArtwork` from the shared icon set
    // (`ui-primitives/src/icons/index.tsx`), used as a mask so it takes the
    // chip's own `currentColor` — a data-URI SVG does not inherit it.
    const PIN_GLYPH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
      + '<path d="M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z" fill="#000" stroke="#000" stroke-linejoin="round"/>'
      + '<path d="M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z" fill="#000"/>'
      + '</svg>';
    const PIN_MASK = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(PIN_GLYPH) + '")';

    /**
     * One rule, scoped to the marked chip. The chip is a flex row
     * (`dockkit.module.css` `.tab`), so `::before` lands ahead of its title span
     * and inherits the chip's colour, active or not.
     */
    const badgeCss = '[data-dockkit-tab][' + PINNED_ATTR + ']::before {'
      + 'content: "";'
      + 'flex: 0 0 auto;'
      + 'width: 12px;'
      + 'height: 12px;'
      + 'margin-right: 4px;'
      + 'background-color: currentColor;'
      + 'opacity: 0.7;'
      + '-webkit-mask-image: ' + PIN_MASK + ';'
      + '-webkit-mask-position: center;'
      + '-webkit-mask-size: contain;'
      + '-webkit-mask-repeat: no-repeat;'
      + 'mask-image: ' + PIN_MASK + ';'
      + 'mask-position: center;'
      + 'mask-size: contain;'
      + 'mask-repeat: no-repeat;'
      + '}';

    /**
     * Read this plugin's own persisted pin set for one Session.
     *
     * It reads its own key and no one else's: `defineStore` writes the whole state
     * object under `<PIN_PERSIST>.<scopeKey>`, and this decorator runs outside
     * React, where no store subscription reaches it.
     * @param sessionId - the Session the chips belong to.
     * @returns its pinned tab ids, empty when absent or unreadable.
     */
    function readPinnedIds(sessionId) {
      if (typeof localStorage === 'undefined') return NO_PINS;
      try {
        const raw = localStorage.getItem(PIN_PERSIST + '.' + sessionId);
        if (raw === null) return NO_PINS;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return NO_PINS;
        return Array.isArray(parsed.pinned) ? new Set(parsed.pinned) : NO_PINS;
      } catch (error) {
        return NO_PINS;
      }
    }

    /** Whether a mutated node is, or contains, something that can hold a chip. */
    function holdsChips(node) {
      if (node.nodeType !== 1) return false;
      if (node.matches('[' + TAB_ATTR + ']')) return true;
      return node.querySelector('[' + TAB_ATTR + ']') !== null;
    }

    /**
     * Keep the `data-dsh-tab-pinned` mark in step with the stored pin sets.
     *
     * This is the plugin's only DOM-level piece, and it is deliberately one-way:
     * it writes a single attribute it owns and injects one stylesheet. React never
     * renders that attribute, so it survives every re-render; a chip node React
     * replaces arrives through the observer as an added node.
     *
     * Every failure mode here is silent by design — an unresolvable Session, an
     * unreadable key, no mask support — and costs only the badge, never a menu row.
     * @param document - the document to decorate.
     * @returns the badge, whose `install()` returns its own disposer.
     */
    function createChipBadge(document) {
      let style = null;
      let observer = null;
      let scheduled = false;

      /** Re-read every mounted chip, writing only the marks that changed. */
      function sync() {
        const chips = document.querySelectorAll('[' + TAB_ATTR + ']');
        if (chips.length === 0) return;
        const bySession = new Map();
        for (const chip of chips) {
          const host = chip.closest('[' + SESSION_ATTR + ']');
          const sessionId = host === null ? null : host.getAttribute(SESSION_ATTR);
          const tabId = chip.getAttribute(TAB_ATTR);
          let pinned = null;
          if (sessionId !== null) {
            if (!bySession.has(sessionId)) bySession.set(sessionId, readPinnedIds(sessionId));
            pinned = bySession.get(sessionId);
          }
          const marked = pinned !== null && tabId !== null && pinned.has(tabId);
          // Guarded writes: an unconditional set would re-enter the observer.
          if (marked && !chip.hasAttribute(PINNED_ATTR)) chip.setAttribute(PINNED_ATTR, '');
          else if (!marked && chip.hasAttribute(PINNED_ATTR)) chip.removeAttribute(PINNED_ATTR);
        }
      }

      /** Coalesce a burst of mutations into one pass. */
      function schedule() {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          sync();
        });
      }

      return {
        sync,
        install() {
          if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]') === null) {
            style = document.createElement('style');
            style.dataset.plugin = PLUGIN_ID;
            style.dataset.pluginCss = STYLE_TAG_ID;
            style.textContent = badgeCss;
            document.head.appendChild(style);
          }
          // Filtered in the callback, not in the pass: a streaming transcript
          // mutates constantly and none of it can hold a chip.
          observer = new MutationObserver((records) => {
            for (const record of records) {
              for (const node of record.addedNodes) if (holdsChips(node)) return schedule();
              for (const node of record.removedNodes) if (holdsChips(node)) return schedule();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          sync();
          return () => {
            if (observer !== null) {
              observer.disconnect();
              observer = null;
            }
            if (style !== null) {
              style.remove();
              style = null;
            }
            for (const chip of document.querySelectorAll('[' + PINNED_ATTR + ']')) {
              chip.removeAttribute(PINNED_ATTR);
            }
          };
        },
      };
    }

    //#endregion

    //#region copy

    const zh = {
      pin: '固定标签',
      unpin: '取消固定',
      closeOthers: '关闭其他标签',
      closeRight: '关闭右侧标签',
      closeLeft: '关闭左侧标签',
      closeAll: '关闭所有标签',
    };

    const en = {
      pin: 'Pin Tab',
      unpin: 'Unpin Tab',
      closeOthers: 'Close Other Tabs',
      closeRight: 'Close Tabs to the Right',
      closeLeft: 'Close Tabs to the Left',
      closeAll: 'Close All Tabs',
    };

    //#endregion

    //#region the menu entries

    /**
     * The extra rows of one tab's context menu.
     *
     * Mounted only while the menu is open, so the pane is read once on mount
     * rather than kept live: the menu dismisses on the first action, and a drag
     * cannot start while it is up.
     * @param props - owner `{ tab, dismiss }`, the store share, the inject face, and the locale seat.
     * @returns the rows.
     */
    function TabMenuItems(props) {
      const { tab, dismiss, useStore, actions, closeTabs, syncChips, t } = props;
      const pinnedList = useStore((state) => state.pinned);
      const [pane] = React.useState(() => readPane(document, tab.id));
      const pinned = React.useMemo(() => new Set(pinnedList), [pinnedList]);
      const isPinned = pinned.has(tab.id);
      const targets = React.useMemo(() => targetsFor(pane.ids, tab.id, pinned), [pane, tab.id, pinned]);

      /** One close row, absent when it has nothing it may close. */
      const closeRow = (key, label, ids, danger) => ids.length === 0 || !pane.closable ? null : jsx(MenuItemButton, {
        danger,
        children: label,
        onSelect: () => {
          dismiss();
          closeTabs(ids);
        },
      }, key);

      return jsxs(Fragment, {
        children: [
          jsx(MenuItemButton, {
            separatorBefore: true,
            icon: isPinned ? jsx(IconPinFillRegular, { size: 14 }) : jsx(IconPinOutlineRegular, { size: 14 }),
            children: isPinned ? t('unpin') : t('pin'),
            onSelect: () => {
              dismiss();
              actions.togglePin(tab.id);
              syncChips();
            },
          }, 'pin'),
          closeRow('others', t('closeOthers'), targets.others, false),
          closeRow('right', t('closeRight'), targets.right, false),
          closeRow('left', t('closeLeft'), targets.left, false),
          closeRow('all', t('closeAll'), targets.all, true),
        ],
      });
    }

    //#endregion

    //#region plugin body

    /** Services this plugin's browser half reads. */
    const inject = ['slots', 'sidebarRight', 'locale'];

    /**
     * Client plugin body: register the dictionaries, the pin store, the chip
     * decorator, and the menu entries.
     * @param ctx - client root context carrying the slot registry, the sidebar face, and copy.
     * @param config - optional row config; `{ badge: false }` drops the chip mark.
     */
    function apply(ctx, config) {
      const options = config === null || config === undefined ? {} : config;

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sidebar-tab-actions: dictionaries');

      // Per-Session pin sets: the seat is session-scoped, so the engine creates
      // one instance per Session and persists it under `<PIN_PERSIST>.<id>`.
      const pins = defineStore({
        init: () => ({ pinned: [] }),
        persist: PIN_PERSIST,
        actions: {
          togglePin(draft, tabId) {
            draft.pinned = draft.pinned.includes(tabId)
              ? draft.pinned.filter((id) => id !== tabId)
              : draft.pinned.concat([tabId]);
          },
        },
      });

      const badge = options.badge === false || typeof document === 'undefined'
        ? null
        : createChipBadge(document);
      if (badge !== null) ctx.effect(() => badge.install(), 'dsh-sidebar-tab-actions: chip badges');

      ctx.effect(() => ctx.slots.inject('sidebar.right.tab.menu.item', () => ctx.slots.register({
        name: 'sidebar.right.tab.menu.item',
        id: PLUGIN_ID,
        order: 60,
        locale: NS,
        store: pins,
        inject: () => ({
          /**
           * Close a list of tabs of the Session on screen.
           *
           * The controller owns the pane rules, so a tab it declines to close (the
           * sole docked guide) is a no-op there and nothing about it is recorded.
           * @param ids - tab ids to close.
           */
          closeTabs: (ids) => {
            for (const id of ids) {
              try {
                ctx.sidebarRight.close(id);
              } catch (error) {
                console.error('[dsh-sidebar-tab-actions] close failed:', error);
              }
            }
          },
          /** Re-mark the mounted chips after a pin changed. */
          syncChips: () => {
            if (badge !== null) badge.sync();
          },
        }),
      }, TabMenuItems)), 'dsh-sidebar-tab-actions: menu items');
    }

    //#endregion

    exports.inject = inject;
    exports.apply = apply;
    // Test-only surface: the pure pieces a Node smoke test can exercise without
    // React or a DOM. Nothing in the running client reads it.
    exports.__internals = {
      targetsFor,
      readPane,
      readPinnedIds,
      badgeCss,
      PLUGIN_ID,
      NS,
      PIN_PERSIST,
      PINNED_ATTR,
      STYLE_TAG_ID,
      zh,
      en,
    };

    return module.exports;
  },
});
