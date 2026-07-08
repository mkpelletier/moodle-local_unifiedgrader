// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Minimal allowlist HTML sanitizer.
 *
 * DEFENSE IN DEPTH, not a general-purpose sanitizer: the translation_panel
 * component's html/alignment strings are already sanitised server-side by
 * local_nida (clean_text()) before they reach the browser. This exists purely
 * as a second, independent layer so a future regression that accidentally
 * skips the server-side pass does not translate directly into script
 * execution client-side — the threat model is "guard against our own future
 * mistake", not "safely render arbitrary hostile HTML from an untrusted
 * origin". Scope is deliberately narrow (a small tag/attribute allowlist
 * matching what translated course/assignment text actually needs) rather than
 * attempting full parity with a general sanitizer library.
 *
 * Parses via the browser's own HTML parser inside a detached <template>
 * element: per the HTML spec, template content is inert — scripts never
 * execute and images/frames never load while it is parsed or walked — so the
 * untrusted string is never live DOM at any point. The sanitised result is
 * returned as real DOM nodes (never re-serialised back to an HTML string), so
 * there is no second parse/serialise round-trip in which a mutation-XSS style
 * mismatch between two different parsers could reopen a bypass.
 *
 * @module     local_unifiedgrader/lib/html_sanitizer
 * @copyright  2026 South African Theological Seminary
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

// Tags that may survive with their own attributes/children. Anything else is
// unwrapped (its children are kept, the tag itself is dropped) unless it is
// in DROP_ENTIRELY.
const ALLOWED_TAGS = new Set([
    'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr',
]);

// Tags whose entire subtree is dropped rather than unwrapped: their content is
// either executable (script, foreign-content elements that can carry their
// own scripting model) or not meaningful to keep as plain markup.
const DROP_ENTIRELY = new Set([
    'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
    'form', 'svg', 'math', 'link', 'meta', 'base', 'template',
]);

// Attributes allowed on every kept tag.
const GLOBAL_ATTRS = new Set(['title', 'lang', 'dir']);

// Attributes allowed on specific tags, in addition to GLOBAL_ATTRS.
const TAG_ATTRS = {
    a: new Set(['href']),
    img: new Set(['src', 'alt']),
    td: new Set(['colspan', 'rowspan']),
    th: new Set(['colspan', 'rowspan']),
};

// href/src are only kept when the value matches this scheme allowlist —
// http(s), mailto, or a relative/scheme-relative/fragment URL. This is what
// stops the classic javascript:/data:/vbscript: attribute-based XSS vector
// even on an otherwise-allowed tag.
const URL_ATTRS = new Set(['href', 'src']);
const SAFE_URL_RE = /^(?:https?:|mailto:|\/(?!\/)|\.|#)/i;

/**
 * Sanitise a single source node, appending the result (if any) to targetParent.
 * Recurses into children for both kept and unwrapped elements.
 *
 * @param {Node} node The source node from the inert parse tree.
 * @param {Node} targetParent The sanitised parent to append into.
 * @return {void}
 */
const appendSanitized = (node, targetParent) => {
    if (node.nodeType === Node.TEXT_NODE) {
        targetParent.appendChild(document.createTextNode(node.textContent));
        return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        // Comments, processing instructions, CDATA, etc. carry no display value
        // and are dropped outright.
        return;
    }

    const tag = node.tagName.toLowerCase();
    if (DROP_ENTIRELY.has(tag)) {
        return;
    }
    if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap: this tag is not recognised, but its text is still legitimate
        // translated content — keep the children, drop only the wrapper.
        node.childNodes.forEach((child) => appendSanitized(child, targetParent));
        return;
    }

    const clean = document.createElement(tag);
    copyAllowedAttributes(node, clean);
    node.childNodes.forEach((child) => appendSanitized(child, clean));
    targetParent.appendChild(clean);
};

/**
 * Copy only allowlisted attributes from source to target, rejecting any
 * event-handler attribute and any URL-bearing attribute with an unsafe scheme.
 *
 * @param {Element} source The original (untrusted) element.
 * @param {Element} target The freshly-created, otherwise-empty clean element.
 * @return {void}
 */
const copyAllowedAttributes = (source, target) => {
    const tag = target.tagName.toLowerCase();
    const allowedForTag = TAG_ATTRS[tag] || new Set();

    Array.from(source.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        // Event handlers (onclick, onerror, ...) and inline style (a CSS
        // exfiltration/spoofing vector) are never copied, regardless of tag.
        if (name.startsWith('on') || name === 'style') {
            return;
        }
        if (!GLOBAL_ATTRS.has(name) && !allowedForTag.has(name)) {
            return;
        }
        const value = attr.value;
        if (URL_ATTRS.has(name) && !SAFE_URL_RE.test(value.trim())) {
            return;
        }
        target.setAttribute(name, value);
    });
};

/**
 * Sanitise an HTML string into a safe, detached DocumentFragment ready to
 * append to the live DOM.
 *
 * @param {string} html Untrusted (but already server-cleaned) HTML.
 * @return {DocumentFragment}
 */
export default function sanitizeToFragment(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');

    const out = document.createDocumentFragment();
    template.content.childNodes.forEach((node) => appendSanitized(node, out));
    return out;
}
