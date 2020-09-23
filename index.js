/**
 * @typedef {Object} Component
 * @property {string} text
 * @property {RenderFn} render
 * @property {Map<string, Component>} children
 * @property {boolean} dirty
 * @property {number} width
 * @property {number} height
 * @property {Map<string, Array<() => void>>} hooks
 */

/**
 * @typedef {Object} RenderOptions
 * @property {RenderFn} render
 * @property {number} width
 * @property {number} height
 */

/** @typedef {(context: Context) => string} RenderFn */

/**
 * @typedef {Object} Context
 * @property {number} width
 * @property {number} height
 * @property {(f: RenderFn) => string} registerChild
 * @property {() => void} invalidate
 * @property {(key: string, f: () => void) => void} registerHook
 * @property {(key: Object, f: (e: Event) => void) => HTMLInputElement} registerInput
 */

/**
 * @param {string|HTMLElement} selectorOrEl
 * @param {Object} options
 * @param {string} options.fontFamily Defaults to "monospace, monospace", REALLY should be monospace
 */
export default async function literal(selectorOrEl, { fontFamily = "monospace, monospace" } = {}) {
	/** @type {HTMLElement} */
	const el = typeof selectorOrEl == "string" ? document.querySelector(selectorOrEl) : selectorOrEl
	if (!el || !el instanceof HTMLElement) throw new Error(`Invalid element or css selector supplied`)

	if (el.children.length) throw new Error("The supplied element should be empty")

	const { width: elWidth, height: elHeight } = el.getBoundingClientRect()
	const id = Math.random().toString(36).slice(2)

	const styles = document.createElement("style")
	styles.textContent = `
		#lit-${id} {
			width: auto;
			height: auto;
			margin: 0;
			padding: 0;
			font-family: ${fontFamily};
			position: relative;
			user-select: none;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
		}
		#lit-${id}-meter, input.lit-${id} {
			position: absolute;
			width: auto;
			height: auto;
			font-family: ${fontFamily};
			top: -1000000px;
			left: -1000000px;
		}`
	document.head.appendChild(styles)

	// TODO: re-render on resize
	const pre = document.createElement("pre")
	pre.id = "lit-" + id
	el.appendChild(pre)

	const meter = document.createElement("div")
	meter.id = `lit-${id}-meter`
	meter.innerText = "@"
	pre.appendChild(meter)

	// wait a frame to get a stable measurement
	await new Promise(resolve => requestAnimationFrame(resolve))

	const { width: charWidth, height: charHeight } = meter.getBoundingClientRect()
	meter.remove()

	const width = Math.floor(elWidth / charWidth),
		height = Math.floor(elHeight / charHeight)

	/** @type {Component} */
	let cache

	// /** @type {WeakMap<Component, Array<() => void>} */
	// const keydownHandlers = new WeakMap()

	/** @type {Map<Object, [HTMLInputElement, () => void]>} */
	const inputEls = new Map()

	// TODO: less naive implementation
	document.addEventListener("keydown", e => {
		if (!cache) return
		const f =
			/** @param {Component} comp */
			comp => {
				triggerHook(comp, "keydown", e)
				comp.children.forEach(child => f(child))
			}
		f(cache)
	})

	/**
	 * @param {RenderOptions} options
	 * @param {Component=} cache
	 * @returns {Component}
	 */
	function render(options, cache) {
		if (!cache || cache.dirty) {
			cache && triggerHook(cache, "beforeupdate")

			/** @type {Map<string, RenderFn>} */
			let childFns = new Map()
			let nextChar = 0xd800

			/** @type {Component} */
			const component = {
				text: "",
				children: new Map(),
				dirty: false,
				hooks: new Map(),
				...options,
			}

			component.text = component.render({
				width: component.width,
				height: component.height,
				registerChild(childFn) {
					if (component.text)
						throw new Error("Cannot register new children after the component has been rendered")
					const char = String.fromCharCode(nextChar++)
					childFns.set(char, childFn)
					return char
				},
				invalidate() {
					component.dirty = true
					scheduleRender()
				},
				registerHook: (key, f) => addHook(component, key, f),
				registerInput(key, f) {
					// const [inpt, old] = inputEls.get(key) ?? [document.createElement("input"), f]
					// inpt.classList.add("lit-" + id)
					// inpt.removeEventListener("input", old)
					// inpt.addEventListener("input", f)
					// inpt.tabIndex = 1
					// document.body.append(inpt)
					// inputEls.set(key, [inpt, f])
					// return inpt
				},
			})

			for (const [char, f] of childFns.entries()) {
				const [width, height] = extractDimensions(char, component)
				component.children.set(char, render({ height, width, render: f }))
			}

			return component
		} else {
			for (const [char, child] of cache.children.entries()) {
				cache.children.set(
					char,
					render(
						{
							width: child.width,
							height: child.height,
							render: child.render,
						},
						child,
					),
				)
			}

			return cache
		}
	}

	/** @type {RenderFn} */
	let root

	function renderToDom() {
		rafId = 0
		cache = render({ width, height, render: root }, cache)
		const final = collapseTree(cache)
		pre.innerHTML = insertNewlines(final, width, height)
	}

	/** @type {number} */
	let rafId = 0
	function scheduleRender() {
		if (!rafId) rafId = requestAnimationFrame(renderToDom)
	}

	return (
		/** @param {RenderFn} f */
		f => {
			root = f
			requestAnimationFrame(renderToDom)
		}
	)
}

/**
 * @param {Component} component
 * @param {string} key
 * @param {() => void} f
 */
function addHook(component, key, f) {
	const arr = component.hooks.get(key)
	if (arr) arr.push(f)
	else component.hooks.set(key, [f])
}

/**
 * @param {Component} component
 * @param {string} key
 * @param {any[]} args
 */
function triggerHook(component, key, ...args) {
	component.hooks.get(key)?.forEach(f => f(...args))
}

/**
 * @param {string} char
 * @param {Component} component
 * @returns {[number, number]}
 */
function extractDimensions(char, { text, width }) {
	const re = new RegExp(`(${char}+)`, "mg")
	let match,
		w,
		h = 0

	while ((match = re.exec(text))) {
		h++
		let l = match[1].length
		if (!w) w = l
		if (l != w) throw new Error(`Irregular shape detected for child with placeholder: "${char}"`)
	}

	if (h == 1 && w > width) {
		// it's not one long line it's a big block
		h = Math.floor(w / width)
		w = width
	}

	return [w, h]
}

/**
 * @param {Component} comp
 */
function collapseTree(comp) {
	let text = comp.text
	for (const [char, child] of comp.children) {
		text = insertComp(char, text, collapseTree(child))
	}
	return text
}

/**
 * @param {string} char
 * @param {string} parent
 * @param {string} child
 */
function insertComp(char, parent, child) {
	const re = new RegExp(`(${char}+)`, "mg")
	let match
	while ((match = re.exec(parent))) {
		let w = match[1].length
		parent = parent.replace(match[1], child.slice(0, w))
		child = child.slice(w)
	}
	return parent
}

/**
 * @param {string} str
 * @param {number} width
 * @param {number} height
 */
function insertNewlines(str, width, height) {
	const acc = []
	for (let i = 0; i < height; i++) {
		acc.push(str.slice(i * width, (i + 1) * width))
	}
	return acc.join("\n")
}
