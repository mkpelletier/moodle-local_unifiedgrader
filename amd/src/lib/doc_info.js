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
 * Shared renderer for the "document info" popout.
 *
 * Both the PDF annotation toolbar and the translated / online-text preview show
 * an ⓘ popout; this builds the same grouped key/value layout for both from a
 * single unified info object, so the two stay consistent. Groups and rows whose
 * value is absent are omitted, so each context surfaces only what applies to its
 * submission (no Translation group without Nida, no Document group for pure
 * online text, and so on).
 *
 * @module     local_unifiedgrader/lib/doc_info
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * A value counts as present (and worth a row) when it isn't null/undefined and
 * isn't an empty string. Zero is deliberately kept — "Comments: 0" is meaningful.
 *
 * @param {*} value
 * @return {boolean}
 */
const isPresent = (value) => value !== null && value !== undefined && value !== '';

/**
 * Build a single key/value row.
 *
 * @param {string} label
 * @param {string} value
 * @return {HTMLElement}
 */
function makeRow(label, value) {
    const row = document.createElement('div');
    row.className = 'docinfo-row';
    const lbl = document.createElement('span');
    lbl.className = 'docinfo-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'docinfo-value';
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    return row;
}

/**
 * Build a group (optional header + its present rows), or null when every row in
 * the group is absent.
 *
 * @param {?string} title Group header, or null/'' for the leading ungrouped rows.
 * @param {Array<[string, *]>} pairs Label/value pairs.
 * @return {?DocumentFragment}
 */
function makeGroup(title, pairs) {
    const present = pairs.filter(([, value]) => isPresent(value));
    if (!present.length) {
        return null;
    }
    const frag = document.createDocumentFragment();
    if (title) {
        const header = document.createElement('div');
        header.className = 'docinfo-group';
        header.textContent = title;
        frag.appendChild(header);
    }
    present.forEach(([label, value]) => frag.appendChild(makeRow(label, String(value))));
    return frag;
}

/**
 * Render the unified document-info popout into a container.
 *
 * @param {HTMLElement} container The popout element to fill (cleared first).
 * @param {object} info Unified info. All fields optional:
 *   {number|string} wordcount
 *   {number|string} pages
 *   {?object} document {created, modified, mimetype, filesize} (pre-formatted strings)
 *   {number|string} comments
 *   {?object} translation {originallang, translatedwords, langpair, confidence}
 * @param {object} labels Pre-resolved label strings (see the callers for keys).
 */
export default function renderDocInfo(container, info, labels) {
    container.innerHTML = '';

    const groups = [
        makeGroup(null, [
            [labels.wordcount, info.wordcount],
            [labels.pages, info.pages],
        ]),
        info.document ? makeGroup(labels.groupDocument, [
            [labels.created, info.document.created],
            [labels.modified, info.document.modified],
            [labels.mimetype, info.document.mimetype],
            [labels.filesize, info.document.filesize],
        ]) : null,
        makeGroup(labels.groupFeedback, [
            [labels.comments, info.comments],
        ]),
        info.translation ? makeGroup(labels.groupTranslation, [
            [labels.originallang, info.translation.originallang],
            [labels.translatedwords, info.translation.translatedwords],
            [labels.langpair, info.translation.langpair],
            [labels.confidence, info.translation.confidence],
        ]) : null,
    ].filter(Boolean);

    groups.forEach((group) => container.appendChild(group));

    if (!container.children.length && labels.empty) {
        const empty = document.createElement('div');
        empty.className = 'docinfo-row text-muted';
        empty.textContent = labels.empty;
        container.appendChild(empty);
    }
}
