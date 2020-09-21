/**
 * @param {string|HTMLElement} selectorOrEl
 * @param {Object} options
 * @param {string} options.fontFamily Defaults to "Consolas", REALLY should be monospace
 */
export default async function literal(selectorOrEl, { fontFamily = "Consolas" } = {}) {
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
			font-family: "${fontFamily}";
			position: relative;
			user-select: none;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
		}
		#lit-${id}-meter {
			position: absolute;
			width: auto;
			height: auto;
			font-family: "${fontFamily}";
			visibility: hidden;
			top: 0;
			left: 0;
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

	/** @type {Map<RenderFn, { text: string, children: Map<string, RenderFn> }} */
	const cache = new Map()

	/**
	 * @param {RenderFn} f
	 * @param {number} width
	 * @param {number} height
	 */
	function render(f, width, height) {
		/** @type {Map<string, RenderFn>} */
		let children = new Map()
		let nextChar = 0xd7ff
		let text = f({
			width,
			height,
			registerChild(childFn) {
				const char = String.fromCharCode(nextChar++)
				children.set(char, childFn)
				return char
			},
			invalidate() {
				cache.delete(f)
				requestAnimationFrame(renderToDom)
			},
		})
		// cache.set(f, { text, children })

		for (const [char, f] of children.entries()) {
			const dimensions = extractDimensions(char, text, width)
			text = insertComp(char, text, render(f, ...dimensions))
		}
		return text
	}

	/** @type {RenderFn} */
	let root
	function renderToDom() {
		const final = render(root, width, height)
		pre.innerHTML = insertNewlines(final, width, height)
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
 * @param {string} char
 * @param {string} str
 * @param {number} parentWidth
 */
function extractDimensions(char, str, parentWidth) {
	const re = new RegExp(`(${char}+)`, "mg")
	let match,
		w,
		h = 0

	while ((match = re.exec(str))) {
		h++
		let l = match[1].length
		if (!w) w = l
		if (l != w) throw new Error(`Irregular shape detected for child with placeholder: "${char}"`)
	}

	if (h == 1 && w > parentWidth) {
		// it's not one long line it's a big block
		h = Math.floor(w / parentWidth)
		w = parentWidth
	}

	return [w, h]
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

/** @typedef {() => RenderFn} Component */

/** @typedef {(context: Context) => string} RenderFn */

/**
 * @typedef {Object} Context
 * @prop {number} width
 * @prop {number} height
 * @prop {(f: RenderFn) => string} registerChild
 * @prop {() => void} invalidate
 */
