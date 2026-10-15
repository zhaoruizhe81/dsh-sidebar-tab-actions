/**
 * Smoke test for dsh-sidebar-tab-actions.
 *
 * Runs in plain Node with no dependencies: the browser half is loaded exactly the
 * way the client module system loads it — a `window.__ModuleLoader__.load` call
 * whose factory returns the module's exports — with a stub `require` standing in
 * for the loader's module table. What is asserted here is the plugin's own logic:
 * target computation, the pane read, the pin store's write set, and the
 * registration wiring. React rendering belongs to React and is covered by the
 * manual checklist in README.md.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/** The captured `{ id, factory }` handoff. */
let handoff

/** Bare minimum stand-ins for the shared module table. */
const table = {
  'react': { useState: (init) => [init(), () => {}], useMemo: (fn) => fn() },
  // Faithful to the automatic runtime's real signature: `(type, props, key)`.
  // A stub that swallows the key would hide a label passed in its place.
  'react/jsx-runtime': {
    jsx: (type, props, key) => ({ type, props, key }),
    jsxs: (type, props, key) => ({ type, props, key }),
    Fragment: Symbol('Fragment'),
  },
  '@deepseek-ai/dsh-client-ui-primitives': {
    MenuItemButton: () => null,
    IconPinOutlineRegular: () => null,
    IconPinFillRegular: () => null,
  },
  // Identity, so the test can drive the declared actions directly.
  '@deepseek-ai/dsh-client-store': { defineStore: (spec) => spec },
}

globalThis.window = { __ModuleLoader__: { load: (value) => { handoff = value } } }
await import('../lib/client.js')

/** Materialize the module the way the loader's factory would. */
const load = () => handoff.factory((specifier) => {
  if (!(specifier in table)) throw new Error(`unexpected module request: ${specifier}`)
  return table[specifier]
})

const plugin = load()
const { targetsFor, readPane, readPinnedIds, badgeCss, PLUGIN_ID, NS, PIN_PERSIST, PINNED_ATTR, zh, en } = plugin.__internals

describe('module handoff', () => {
  it('registers under the package name', () => {
    assert.equal(handoff.id, 'dsh-sidebar-tab-actions')
    assert.equal(PLUGIN_ID, 'dsh-sidebar-tab-actions')
  })

  it('exports a cordis plugin with the services it reads', () => {
    assert.equal(typeof plugin.apply, 'function')
    assert.deepEqual(plugin.inject, ['slots', 'sidebarRight', 'locale'])
  })

  it('ships both built-in locale dictionaries with the same keys', () => {
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
    assert.deepEqual(Object.keys(zh).sort(), ['closeAll', 'closeLeft', 'closeOthers', 'closeRight', 'pin', 'unpin'])
  })
})

describe('targetsFor', () => {
  const none = new Set()

  it('splits a pane around the open tab', () => {
    assert.deepEqual(targetsFor(['a', 'b', 'c', 'd'], 'c', none), {
      left: ['a', 'b'],
      right: ['d'],
      others: ['a', 'b', 'd'],
      all: ['a', 'b', 'c', 'd'],
    })
  })

  it('excludes pinned tabs from every set', () => {
    assert.deepEqual(targetsFor(['a', 'b', 'c', 'd'], 'c', new Set(['b'])), {
      left: ['a'],
      right: ['d'],
      others: ['a', 'd'],
      all: ['a', 'c', 'd'],
    })
  })

  it('gives the first tab no left set and the last tab no right set', () => {
    assert.deepEqual(targetsFor(['a', 'b', 'c'], 'a', none).left, [])
    assert.deepEqual(targetsFor(['a', 'b', 'c'], 'a', none).right, ['b', 'c'])
    assert.deepEqual(targetsFor(['a', 'b', 'c'], 'c', none).right, [])
  })

  it('keeps the open tab out of others but inside all', () => {
    const targets = targetsFor(['a', 'b'], 'a', none)
    assert.deepEqual(targets.others, ['b'])
    assert.deepEqual(targets.all, ['a', 'b'])
  })

  it('empties every set when the open tab is not in the pane', () => {
    assert.deepEqual(targetsFor(['a', 'b'], 'zz', none), { left: [], right: [], others: [], all: [] })
  })

  it('empties every set when every tab is pinned', () => {
    assert.deepEqual(targetsFor(['a', 'b'], 'a', new Set(['a', 'b'])), { left: [], right: [], others: [], all: [] })
  })

  it('closes nothing but itself when every other tab is pinned', () => {
    assert.deepEqual(targetsFor(['a', 'b', 'c'], 'b', new Set(['a', 'c'])).all, ['b'])
  })

  it('never mutates the pinned set it is given', () => {
    const pinned = new Set(['b'])
    targetsFor(['a', 'b', 'c'], 'a', pinned)
    assert.deepEqual([...pinned], ['b'])
  })
})

describe('readPane', () => {
  /** A fake strip holding the given chips, one of which may be marked quiet. */
  function fakeDocument(tabs, quietTab) {
    const box = { querySelectorAll: () => chips }
    const chips = tabs.map((id) => ({
      id,
      getAttribute: (name) => name === 'data-dockkit-tab' ? id : null,
      hasAttribute: (name) => name === 'data-dockkit-tab-quiet' && id === quietTab,
      closest: (selector) => selector === '[data-dockkit-strip-tabs]' ? box : null,
    }))
    return {
      querySelector: (selector) => {
        const wanted = /\[data-dockkit-tab="([^"]*)"\]/.exec(selector)?.[1]
        return chips.find((chip) => chip.id === wanted) ?? null
      },
    }
  }

  it('reads the pane in strip order and reports the tab closable', () => {
    assert.deepEqual(readPane(fakeDocument(['tab1', 'tab2', 'tab3']), 'tab2'), {
      ids: ['tab1', 'tab2', 'tab3'],
      closable: true,
    })
  })

  it('reports the lone quiet chip unclosable', () => {
    assert.deepEqual(readPane(fakeDocument(['tab1'], 'tab1'), 'tab1'), { ids: ['tab1'], closable: false })
  })

  it('reports a chip that is not mounted as an empty pane', () => {
    assert.deepEqual(readPane(fakeDocument(['tab1', 'tab2']), 'tab9'), { ids: [], closable: false })
  })

  it('reports a chip outside any strip as an empty pane', () => {
    const orphan = { closest: () => null }
    assert.deepEqual(readPane({ querySelector: () => orphan }, 'tab1'), { ids: [], closable: false })
  })

  it('escapes a tab id before it reaches the selector', () => {
    let seen = null
    readPane({ querySelector: (selector) => { seen = selector; return null } }, 'tab"1')
    assert.equal(seen, '[data-dockkit-tab="tab\\"1"]')
  })
})

describe('readPinnedIds', () => {
  /** Run one read against a fake storage. */
  function readWith(store, sessionId) {
    const previous = globalThis.localStorage
    globalThis.localStorage = store
    try {
      return [...readPinnedIds(sessionId)]
    } finally {
      if (previous === undefined) delete globalThis.localStorage
      else globalThis.localStorage = previous
    }
  }

  it('reads the state object the store persists', () => {
    const key = `${PIN_PERSIST}.session-1`
    assert.equal(key, 'dsh.sidebar-tab-actions.pins.v1.session-1')
    const store = { getItem: (name) => name === key ? JSON.stringify({ pinned: ['tab2', 'tab5'] }) : null }
    assert.deepEqual(readWith(store, 'session-1'), ['tab2', 'tab5'])
  })

  it('answers an absent key with no pins', () => {
    assert.deepEqual(readWith({ getItem: () => null }, 'session-9'), [])
  })

  it('survives an unreadable value', () => {
    assert.deepEqual(readWith({ getItem: () => '{not json' }, 'session-9'), [])
    assert.deepEqual(readWith({ getItem: () => 'null' }, 'session-9'), [])
  })

  it('answers no pins when the state carries no list', () => {
    assert.deepEqual(readWith({ getItem: () => JSON.stringify({ pinned: 'tab1' }) }, 'session-9'), [])
  })

  it('survives a storage that refuses to read', () => {
    assert.deepEqual(readWith({ getItem: () => { throw new Error('quota') } }, 'session-9'), [])
  })
})

describe('badge stylesheet', () => {
  it('targets only the marked chip and draws a masked glyph', () => {
    assert.equal(PINNED_ATTR, 'data-dsh-tab-pinned')
    assert.match(badgeCss, /^\[data-dockkit-tab\]\[data-dsh-tab-pinned\]::before \{/)
    assert.match(badgeCss, /mask-image: url\("data:image\/svg\+xml;utf8,/)
    assert.match(badgeCss, /background-color: currentColor/)
  })
})

describe('apply', () => {
  /** A stub context recording everything the plugin registers. */
  function context() {
    const calls = { locale: [], effects: [], injected: [], registered: [], closed: [] }
    const ctx = {
      locale: {
        bind: (namespace) => (key) => `${namespace}:${key}`,
        register: (namespace, dictionaries) => { calls.locale.push([namespace, dictionaries]); return () => {} },
      },
      effect: (factory, label) => { calls.effects.push(label); return factory() },
      slots: {
        inject: (name, factory) => { calls.injected.push(name); return factory() },
        register: (options, component) => { calls.registered.push([options, component]); return () => {} },
      },
      sidebarRight: { close: (tabId) => calls.closed.push(tabId) },
    }
    return { ctx, calls }
  }

  it('registers one entry into the tab menu seat with a per-session persisted store', () => {
    const { ctx, calls } = context()
    plugin.apply(ctx)
    assert.deepEqual(calls.injected, ['sidebar.right.tab.menu.item'])
    assert.equal(calls.registered.length, 1)
    const [options, component] = calls.registered[0]
    assert.equal(typeof component, 'function')
    assert.equal(options.name, 'sidebar.right.tab.menu.item')
    assert.equal(options.id, PLUGIN_ID)
    assert.equal(options.locale, NS)
    assert.equal(options.order, 60)
    assert.equal(options.store.persist, PIN_PERSIST)
    assert.deepEqual(Object.keys(options.store.actions), ['togglePin'])
    assert.deepEqual(calls.locale, [[NS, { zh, en }]])
  })

  it('toggles one tab id in and out of the pin set', () => {
    const { ctx, calls } = context()
    plugin.apply(ctx)
    const { store } = calls.registered[0][0]
    const draft = { pinned: [] }
    store.actions.togglePin(draft, 'tab3')
    store.actions.togglePin(draft, 'tab7')
    assert.deepEqual(draft.pinned, ['tab3', 'tab7'])
    store.actions.togglePin(draft, 'tab3')
    assert.deepEqual(draft.pinned, ['tab7'])
  })

  it('closes every id it is handed, through the on-screen Session', () => {
    const { ctx, calls } = context()
    plugin.apply(ctx)
    const face = calls.registered[0][0].inject()
    face.closeTabs(['tab1', 'tab2'])
    assert.deepEqual(calls.closed, ['tab1', 'tab2'])
    assert.doesNotThrow(() => face.syncChips())
  })

  it('skips the chip decorator where there is no DOM', () => {
    const { ctx, calls } = context()
    plugin.apply(ctx)
    assert.equal(calls.effects.includes('dsh-sidebar-tab-actions: chip badges'), false)
  })

  it('survives a throwing close without dropping the rest', () => {
    const { ctx, calls } = context()
    ctx.sidebarRight.close = (tabId) => {
      calls.closed.push(tabId)
      if (tabId === 'tab2') throw new Error('no Session on screen')
    }
    plugin.apply(ctx)
    const face = calls.registered[0][0].inject()
    assert.doesNotThrow(() => face.closeTabs(['tab1', 'tab2', 'tab3']))
    assert.deepEqual(calls.closed, ['tab1', 'tab2', 'tab3'])
  })
})

describe('TabMenuItems', () => {
  /** Register the plugin against a stub context and hand back its component and inject face. */
  function mount() {
    const registered = []
    const ctx = {
      locale: { bind: () => (key) => dict[key], register: () => () => {} },
      effect: (factory) => factory(),
      slots: { inject: (name, factory) => factory(), register: (options, component) => { registered.push([options, component]); return () => {} } },
      sidebarRight: { close: () => {} },
    }
    // The component's own cases need a document only for the pane read; the chip
    // decorator has its own suite and its own fake DOM.
    plugin.apply(ctx, { badge: false })
    return { Component: registered[0][1], face: registered[0][0].inject() }
  }

  const dict = {
    pin: '固定标签',
    unpin: '取消固定',
    closeOthers: '关闭其他标签',
    closeRight: '关闭右侧标签',
    closeLeft: '关闭左侧标签',
    closeAll: '关闭所有标签',
  }

  /** Point the component's `document` lookup at a fake strip: tab1..tab4. */
  function strip(quietTab) {
    const box = { querySelectorAll: () => chips }
    const chips = ['tab1', 'tab2', 'tab3', 'tab4'].map((id) => ({
      getAttribute: (name) => name === 'data-dockkit-tab' ? id : null,
      hasAttribute: (name) => name === 'data-dockkit-tab-quiet' && id === quietTab,
      closest: (selector) => selector === '[data-dockkit-strip-tabs]' ? box : null,
    }))
    return {
      querySelector: (selector) => {
        const wanted = /\[data-dockkit-tab="([^"]*)"\]/.exec(selector)?.[1]
        return chips.find((chip) => chip.getAttribute('data-dockkit-tab') === wanted) ?? null
      },
    }
  }

  /**
   * Render the component outside React: the stub hooks are plain functions, so
   * the tree comes back directly and its rows can be inspected and fired.
   * @param pinned - the pin set the store selector reports.
   * @param tabId - the tab whose menu it is.
   * @param quietTab - a chip marked quiet, when the case needs one.
   * @returns the rows, in order, with the empty slots dropped.
   */
  function rows(pinned, tabId, quietTab) {
    const previous = globalThis.document
    globalThis.document = strip(quietTab)
    try {
      const { Component, face } = mount()
      const tree = Component({
        tab: { id: tabId, kind: 'files', contentId: 'x', title: '文件' },
        dismiss: () => {},
        useStore: (selector) => selector({ pinned }),
        actions: { togglePin: () => {} },
        closeTabs: face.closeTabs,
        syncChips: face.syncChips,
        t: (key) => dict[key],
      })
      return tree.props.children.filter((row) => row !== null)
    } finally {
      if (previous === undefined) delete globalThis.document
      else globalThis.document = previous
    }
  }

  /** Labels of the rows that render, in order. */
  const labels = (rendered) => rendered.map((row) => row.props.children)

  it('leads with the pin row, which starts a new group', () => {
    const rendered = rows([], 'tab2')
    assert.deepEqual(labels(rendered), ['固定标签', '关闭其他标签', '关闭右侧标签', '关闭左侧标签', '关闭所有标签'])
    assert.equal(rendered[0].props.separatorBefore, true)
    assert.equal(rendered[0].key, 'pin')
  })

  it('gives every row a visible label and a pin icon', () => {
    for (const row of rows([], 'tab2')) {
      assert.equal(typeof row.props.children, 'string')
      assert.ok(row.props.children.length > 0)
    }
    const [pin] = rows([], 'tab2')
    assert.ok(pin.props.icon !== undefined && pin.props.icon !== null)
  })

  it('hides the left row for the first tab and the right row for the last', () => {
    assert.equal(labels(rows([], 'tab1')).includes('关闭左侧标签'), false)
    assert.equal(labels(rows([], 'tab4')).includes('关闭右侧标签'), false)
  })

  it('hides every close row when a pinned tab is the only target', () => {
    assert.deepEqual(labels(rows(['tab1', 'tab3', 'tab4'], 'tab2')), ['固定标签', '关闭所有标签'])
  })

  it('hides every close row for the lone quiet chip', () => {
    assert.deepEqual(labels(rows([], 'tab1', 'tab1')), ['固定标签'])
  })

  it('flips the pin label with the tab`s own state', () => {
    assert.deepEqual(labels(rows(['tab2'], 'tab2'))[0], '取消固定')
  })

  it('dismisses before acting, then closes exactly that row`s targets', () => {
    const previous = globalThis.document
    globalThis.document = strip()
    const seen = []
    try {
      const { Component } = mount()
      const tree = Component({
        tab: { id: 'tab2', kind: 'files', contentId: 'x', title: '文件' },
        dismiss: () => seen.push('dismiss'),
        useStore: (selector) => selector({ pinned: ['tab1'] }),
        actions: { togglePin: (id) => seen.push(`pin:${id}`) },
        closeTabs: (ids) => seen.push(`close:${ids.join(',')}`),
        syncChips: () => seen.push('sync'),
        t: (key) => dict[key],
      })
      const rowFor = (label) => tree.props.children.find((row) => row !== null && row.props.children === label)

      rowFor('关闭其他标签').props.onSelect()
      assert.deepEqual(seen, ['dismiss', 'close:tab3,tab4'])

      seen.length = 0
      rowFor('固定标签').props.onSelect()
      assert.deepEqual(seen, ['dismiss', 'pin:tab2', 'sync'])

      seen.length = 0
      rowFor('关闭所有标签').props.onSelect()
      assert.deepEqual(seen, ['dismiss', 'close:tab2,tab3,tab4'])
    } finally {
      if (previous === undefined) delete globalThis.document
      else globalThis.document = previous
    }
  })

  it('marks the close-all row destructive', () => {
    const all = rows([], 'tab2').find((row) => row.props.children === '关闭所有标签')
    assert.equal(all.props.danger, true)
  })
})

describe('chip badge', () => {
  const PIN = 'data-dsh-tab-pinned'

  /** A mutation record as the platform delivers it: both node lists, always. */
  const mutation = ({ added = [], removed = [] } = {}) => ({ addedNodes: added, removedNodes: removed })

  /**
   * A fake right Sidebar: one strip of chips under a Session host, plus the
   * pieces the decorator injects through (`createElement`, the style registry).
   * @param stored - the persisted state per Session id, keyed as the store writes it.
   * @returns the document, its observable parts, and the globals to install.
   */
  function fakeDom(stored) {
    const styles = []
    const observers = []
    const session = { getAttribute: () => 'session-1' }
    const box = { querySelectorAll: () => chips }
    const chips = ['tab1', 'tab2', 'tab3', 'tab4'].map((id) => {
      const attrs = new Set(['data-dockkit-tab'])
      return {
        id,
        nodeType: 1,
        attrs,
        getAttribute: (name) => name === 'data-dockkit-tab' ? id : null,
        hasAttribute: (name) => attrs.has(name),
        setAttribute: (name) => { attrs.add(name) },
        removeAttribute: (name) => { attrs.delete(name) },
        matches: (selector) => selector === '[data-dockkit-tab]',
        querySelector: () => null,
        closest: (selector) => selector === '[data-dockkit-strip-tabs]'
          ? box
          : selector === '[data-sidebar-right-session]' ? session : null,
      }
    })
    const document = {
      body: { name: 'body' },
      head: { appendChild: (element) => { styles.push(element) } },
      createElement: () => ({
        dataset: {},
        textContent: '',
        remove() {
          const at = styles.indexOf(this)
          if (at >= 0) styles.splice(at, 1)
        },
      }),
      querySelector: (selector) => {
        const styled = /^style\[data-plugin-css="(.*)"\]$/.exec(selector)
        if (styled !== null) return styles.find((element) => element.dataset.pluginCss === styled[1]) ?? null
        const wanted = /\[data-dockkit-tab="([^"]*)"\]/.exec(selector)?.[1]
        return chips.find((chip) => chip.id === wanted) ?? null
      },
      querySelectorAll: (selector) => selector === '[data-dockkit-tab]'
        ? chips
        : selector === `[${PIN}]` ? chips.filter((chip) => chip.attrs.has(PIN)) : [],
    }
    class FakeObserver {
      constructor(callback) {
        this.callback = callback
        observers.push(this)
      }

      observe(target, options) {
        this.target = target
        this.options = options
      }

      disconnect() {
        this.disconnected = true
      }
    }
    return {
      document,
      chips,
      styles,
      observers,
      marked: () => chips.filter((chip) => chip.attrs.has(PIN)).map((chip) => chip.id),
      localStorage: { getItem: (name) => stored[name] ?? null },
      FakeObserver,
    }
  }

  /** Run `body` against a fake DOM, restoring the real globals afterwards. */
  async function withDom(stored, body) {
    const dom = fakeDom(stored)
    const previous = {
      document: globalThis.document,
      MutationObserver: globalThis.MutationObserver,
      localStorage: globalThis.localStorage,
    }
    globalThis.document = dom.document
    globalThis.MutationObserver = dom.FakeObserver
    globalThis.localStorage = dom.localStorage
    try {
      return await body(dom)
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[name]
        else globalThis[name] = value
      }
    }
  }

  /** Apply the plugin inside a fake DOM, returning the badge's own disposer. */
  function mount() {
    const effects = []
    const ctx = {
      locale: { bind: () => (key) => key, register: () => () => {} },
      effect: (factory, label) => {
        const dispose = factory()
        effects.push([label, dispose])
        return dispose
      },
      slots: { inject: (name, factory) => factory(), register: () => () => {} },
      sidebarRight: { close: () => {} },
    }
    plugin.apply(ctx)
    const badge = effects.find(([label]) => label.includes('chip badges'))
    return { dispose: badge?.[1], labels: effects.map(([label]) => label) }
  }

  it('injects one stylesheet and marks exactly the stored pins', async () => {
    await withDom({ 'dsh.sidebar-tab-actions.pins.v1.session-1': JSON.stringify({ pinned: ['tab3'] }) }, async (dom) => {
      mount()
      assert.equal(dom.styles.length, 1)
      assert.equal(dom.styles[0].dataset.pluginCss, 'dsh-sidebar-tab-actions/chips.css')
      assert.match(dom.styles[0].textContent, /data-dsh-tab-pinned/)
      assert.deepEqual(dom.marked(), ['tab3'])
    })
  })

  it('marks nothing for a Session with no stored pins', async () => {
    await withDom({}, async (dom) => {
      mount()
      assert.deepEqual(dom.marked(), [])
      assert.equal(dom.styles.length, 1)
    })
  })

  it('watches the body and keeps a guarded write from re-entering', async () => {
    await withDom({ 'dsh.sidebar-tab-actions.pins.v1.session-1': JSON.stringify({ pinned: ['tab1', 'tab2'] }) }, async (dom) => {
      const { dispose } = mount()
      assert.equal(dom.observers.length, 1)
      assert.equal(dom.observers[0].target, dom.document.body)
      assert.deepEqual(dom.observers[0].options, { childList: true, subtree: true })
      assert.deepEqual(dom.marked(), ['tab1', 'tab2'])
      // A second pass writes nothing: the marks are already correct.
      dom.observers[0].callback([mutation({ added: [dom.chips[0]] })])
      assert.deepEqual(dom.marked(), ['tab1', 'tab2'])
      void dispose
    })
  })

  it('schedules a pass only for a mutation that can hold a chip', async () => {
    await withDom({ 'dsh.sidebar-tab-actions.pins.v1.session-1': JSON.stringify({ pinned: ['tab2'] }) }, async (dom) => {
      mount()
      const [observer] = dom.observers
      // Undo the mark by hand, then prove an unrelated mutation does not restore it.
      dom.chips[1].removeAttribute(PIN)
      const noise = { nodeType: 1, matches: () => false, querySelector: () => null }
      observer.callback([mutation({ added: [noise] })])
      await Promise.resolve()
      assert.deepEqual(dom.marked(), [])
      // A chip-bearing mutation does.
      observer.callback([mutation({ removed: [dom.chips[2]] })])
      await Promise.resolve()
      assert.deepEqual(dom.marked(), ['tab2'])
    })
  })

  it('ignores text nodes and leaves everything on dispose', async () => {
    await withDom({ 'dsh.sidebar-tab-actions.pins.v1.session-1': JSON.stringify({ pinned: ['tab4'] }) }, async (dom) => {
      const { dispose } = mount()
      assert.deepEqual(dom.marked(), ['tab4'])
      dom.observers[0].callback([mutation({ added: [{ nodeType: 3 }] })])
      assert.deepEqual(dom.marked(), ['tab4'])
      assert.equal(typeof dispose, 'function')
      dispose()
      assert.equal(dom.styles.length, 0)
      assert.deepEqual(dom.marked(), [])
      assert.equal(dom.observers[0].disconnected, true)
    })
  })

  it('drops the badge when the row config turns it off', async () => {
    await withDom({ 'dsh.sidebar-tab-actions.pins.v1.session-1': JSON.stringify({ pinned: ['tab1'] }) }, async (dom) => {
      const effects = []
      const ctx = {
        locale: { bind: () => (key) => key, register: () => () => {} },
        effect: (factory, label) => { effects.push(label); return factory() },
        slots: { inject: (name, factory) => factory(), register: () => () => {} },
        sidebarRight: { close: () => {} },
      }
      plugin.apply(ctx, { badge: false })
      assert.equal(effects.includes('dsh-sidebar-tab-actions: chip badges'), false)
      assert.equal(dom.styles.length, 0)
      assert.deepEqual(dom.marked(), [])
    })
  })
})
