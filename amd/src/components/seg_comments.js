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
 * Segment-anchored comments component (Phase 2, grader side).
 *
 * Lets a grader highlight any phrase in the translated submission and attach a
 * comment "over the page" — a floating popover anchored at the selection, in the
 * same idiom as the PDF annotation composer. It works in the ordinary single
 * (translation-only) view: the grader no longer has to open the side-by-side
 * view to comment. The comment always anchors to the student's ORIGINAL source
 * text — the selected translated phrase is mapped back to its source segment
 * id(s) via the alignment, and the server (local_nida) computes the durable
 * char-offset anchor from those ids.
 *
 * Design:
 *  - The translated body is translation_panel's own DOM (source.html, full
 *    reading layout). This component never rebuilds it; it only wraps the phrases
 *    that already carry a comment in a highlight span, and reads the live
 *    selection. Wrapping is bracketed by an observer disconnect so it never
 *    re-triggers the mutation watcher.
 *  - The composer is a document.body-level fixed popover (escapes the scrolling
 *    preview's overflow), positioned at the selection rect and clamped to the
 *    viewport, dismissed on outside-click / Esc / scroll.
 *  - The alignment (segments + n:m groups) is re-fetched here (translation_panel
 *    owns its own copy and is not edited); a selected translation phrase resolves
 *    to source ids through the groups, exactly as the old side-by-side click did.
 *
 * @module     local_unifiedgrader/components/seg_comments
 * @copyright  2026 South African Theological Seminary
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {BaseComponent} from 'core/reactive';
import {get_string as getString} from 'core/str';
import Ajax from 'core/ajax';
import Notification from 'core/notification';

/** Highlight class placed on translated phrases that carry a comment. */
const MARK_CLASS = 'local-unifiedgrader-seg-commented';

export default class extends BaseComponent {

    /**
     * Component creation hook.
     */
    create() {
        this.name = 'seg_comments';
        /** @type {?HTMLElement} The preview-content wrapper. */
        this._preview = null;
        /** @type {?HTMLElement} The translation-view region (owned by translation_panel). */
        this._view = null;
        /** @type {?MutationObserver} Watches the translation-view for content/visibility. */
        this._observer = null;
        /** @type {boolean} Whether the translated view is currently active. */
        this._active = false;
        /** @type {number} The user whose data is currently loaded. */
        this._loadedUser = 0;
        /** @type {Array<object>} Parsed per-source alignment {type, fileid, segments, groups}. */
        this._sources = [];
        /** @type {Array<object>} Loaded comments for the current student/attempt. */
        this._comments = [];
        /** @type {?HTMLElement} The floating composer popover, when open. */
        this._pop = null;
        /** @type {?Function} Remover for the armed outside-click/scroll listeners. */
        this._dismiss = null;
        /** @type {number} Pending requestAnimationFrame id for arming the dismissers. */
        this._dismissRaf = 0;
    }

    /**
     * Register state watchers.
     *
     * @return {Array}
     */
    getWatchers() {
        return [
            {watch: 'submission:updated', handler: this._onSubmissionUpdated},
        ];
    }

    /**
     * Called when state is first ready.
     */
    stateReady() {
        this._preview = this.element.closest('[data-region="preview-content"]');
        this._view = this._preview?.querySelector('[data-region="translation-view"]');

        if (!this._isAssign() || !this._view) {
            return;
        }

        // A drag-select that ends inside the translated body opens the composer;
        // a plain click on an existing highlight opens that comment. Both are
        // delegated to the container so they survive translation_panel re-renders.
        this._view.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this._view.addEventListener('click', (e) => this._onMarkerClick(e));
        // Keyboard activation for the (role=button) inline markers.
        this._view.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.' + MARK_CLASS)) {
                e.preventDefault();
                this._onMarkerClick(e);
            }
        });

        // React to the translated body being rendered/toggled/hidden. Only childList
        // is watched: translation_panel fills the view when shown and empties it when
        // hidden, so every real transition is a childList change — while class-only
        // churn (e.g. parallel-mode hover sync-highlight) must NOT re-run markers.
        this._observer = new MutationObserver(() => this._sync());
        this._observer.observe(this._view, {childList: true, subtree: true});
        this._sync();
    }

    /**
     * Whether the current activity is an assignment.
     *
     * @return {boolean}
     */
    _isAssign() {
        return this.reactive.state.activity?.type === 'assign';
    }

    /**
     * Reset everything when a new submission loads.
     */
    _onSubmissionUpdated() {
        this._sources = [];
        this._comments = [];
        this._loadedUser = 0;
        this._closeComposer();
        this._active = false;
    }

    /**
     * Whether the translated view is visible and carries renderable sources.
     *
     * @return {boolean}
     */
    _isViewLive() {
        return !!this._view
            && !this._view.classList.contains('d-none')
            && !!this._view.querySelector('[data-source-type]');
    }

    /**
     * Reconcile to the current translated-view state: load data and (re)draw the
     * comment highlights when live, tear down when hidden.
     */
    async _sync() {
        if (this._isViewLive()) {
            if (!this._active) {
                this._active = true;
            }
            await this._ensureData();
            this._renderMarkers();
        } else if (this._active) {
            this._active = false;
            this._closeComposer();
        }
    }

    /**
     * Ensure the alignment sources and comments are loaded for the current student.
     */
    async _ensureData() {
        const userid = parseInt(this.reactive.state.submission?.userid, 10) || 0;
        if (!userid) {
            return;
        }
        if (this._loadedUser === userid && this._sources.length) {
            return;
        }
        this._loadedUser = userid;
        await Promise.all([this._fetchSources(userid), this._fetchComments(userid)]);
    }

    /**
     * Re-fetch the translation payload to obtain per-source alignment groups.
     *
     * @param {number} userid The student whose data to load.
     */
    async _fetchSources(userid) {
        const args = this._args(userid);
        if (!args) {
            return;
        }
        try {
            const result = await Ajax.call([{
                methodname: 'local_unifiedgrader_get_submission_translation',
                args,
                failurealert: false,
            }])[0];
            // Stale-response guard.
            if (parseInt(this.reactive.state.submission?.userid, 10) !== userid) {
                return;
            }
            this._sources = (result.sources || []).map((s) => this._parseSource(s));
        } catch (e) {
            this._sources = [];
        }
    }

    /**
     * Load the stored comments for the current student/attempt.
     *
     * @param {number} userid The student whose comments to load.
     */
    async _fetchComments(userid) {
        const args = this._args(userid);
        if (!args) {
            return;
        }
        try {
            const result = await Ajax.call([{
                methodname: 'local_unifiedgrader_get_segment_comments',
                args,
                failurealert: false,
            }])[0];
            if (parseInt(this.reactive.state.submission?.userid, 10) !== userid) {
                return;
            }
            this._comments = result.comments || [];
        } catch (e) {
            this._comments = [];
        }
    }

    /**
     * Build the {cmid, userid, attempt} args for the current submission.
     *
     * @param {number} userid The student user id.
     * @return {?object} The args, or null when unavailable.
     */
    _args(userid) {
        const cmid = parseInt(this.reactive.state.activity?.cmid, 10);
        if (!cmid || !userid) {
            return null;
        }
        const attempt = Number.isInteger(this.reactive.state.submission?.attemptnumber)
            ? this.reactive.state.submission.attemptnumber : -1;
        return {cmid, userid, attempt};
    }

    /**
     * Parse one source entry's alignment into {type, fileid, segments, groups}.
     *
     * @param {object} source A source entry from get_submission_translation.
     * @return {object}
     */
    _parseSource(source) {
        const out = {
            type: source.type || 'onlinetext',
            fileid: parseInt(source.fileid, 10) || 0,
            segments: [],
            groups: [],
        };
        if (source.alignment) {
            try {
                const parsed = JSON.parse(source.alignment);
                if (parsed && Array.isArray(parsed.segments)) {
                    out.segments = parsed.segments;
                }
                if (parsed && Array.isArray(parsed.groups)) {
                    out.groups = parsed.groups;
                }
            } catch (e) {
                // Leave empty — the source simply cannot be commented on.
            }
        }
        return out;
    }

    // --- Selection → new comment ------------------------------------------------

    /**
     * A drag-select that ends inside a translated source: resolve it to source
     * segment ids and open the composer at the selection.
     *
     * @param {Event} e The mouseup event.
     */
    _onMouseUp(e) {
        // Ignore mouseups inside our own popover (typing/select in the textarea).
        if (this._pop && this._pop.contains(e.target)) {
            return;
        }
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
            return;
        }
        const text = sel.toString().trim();
        if (this._norm(text).length < 2) {
            return;
        }
        const range = sel.getRangeAt(0);
        const wrapper = this._wrapperOf(range.commonAncestorContainer);
        if (!wrapper) {
            return;
        }
        const target = this._targetForSelection(wrapper, text);
        if (!target) {
            // Selected text that did not resolve to any aligned phrase.
            return;
        }
        target.rect = range.getBoundingClientRect();
        this._openComposer(target, null);
    }

    /**
     * Resolve a selected translated phrase to a pending-comment target.
     *
     * @param {HTMLElement} wrapper The source wrapper the selection lies in.
     * @param {string} text The selected text.
     * @return {?object} {sourcetype, fileid, srcsegids, phrase} or null.
     */
    _targetForSelection(wrapper, text) {
        const source = this._sourceForWrapper(wrapper);
        if (!source) {
            return null;
        }
        const selection = this._norm(text);
        const txids = [];
        source.segments.forEach((seg) => {
            const tx = this._norm(seg.tx);
            if (tx.length >= 2 && this._overlaps(selection, tx)) {
                txids.push(parseInt(seg.id, 10));
            }
        });
        if (!txids.length) {
            return null;
        }
        const srcsegids = this._txToSrc(txids, source.groups);
        if (!srcsegids.length) {
            return null;
        }
        const sourcetype = wrapper.dataset.sourceType || 'onlinetext';
        return {
            sourcetype,
            fileid: sourcetype === 'file' ? source.fileid : 0,
            srcsegids,
            phrase: text,
        };
    }

    /**
     * Whether a selection string and a segment string overlap enough to count the
     * segment as selected: one contains the other, or they share a long boundary
     * run (a partial select of the phrase at either end of the drag).
     *
     * @param {string} selection The normalised selected text.
     * @param {string} seg The normalised segment text.
     * @return {boolean}
     */
    _overlaps(selection, seg) {
        if (selection.includes(seg) || seg.includes(selection)) {
            return true;
        }
        const min = 6;
        // A prefix of the segment ending the selection, or a suffix starting it.
        for (let len = seg.length; len >= min; len--) {
            if (selection.includes(seg.slice(0, len)) || selection.includes(seg.slice(-len))) {
                return true;
            }
        }
        return false;
    }

    /**
     * Map translation-segment ids to their SOURCE segment ids via the n:m groups.
     * A tx id with no naming group falls back to the same id (the 1:1 case).
     *
     * @param {Array<number>} txids The translation segment ids.
     * @param {Array} groups The n:m alignment groups ([[srcIds], [txIds]]).
     * @return {Array<number>} The source segment ids, ascending and unique.
     */
    _txToSrc(txids, groups) {
        const wanted = new Set(txids);
        const out = new Set();
        const grouped = new Set();
        (Array.isArray(groups) ? groups : []).forEach((group) => {
            const srcIds = Array.isArray(group[0]) ? group[0].map(Number) : [];
            const txIds = Array.isArray(group[1]) ? group[1].map(Number) : [];
            txIds.forEach((t) => grouped.add(t));
            if (txIds.some((t) => wanted.has(t))) {
                srcIds.forEach((s) => out.add(s));
            }
        });
        // tx ids not named by any group map to themselves (1:1).
        txids.forEach((t) => {
            if (!grouped.has(t)) {
                out.add(t);
            }
        });
        return Array.from(out).sort((a, b) => a - b);
    }

    // --- Existing comment markers ----------------------------------------------

    /**
     * Wrap every translated phrase that carries a comment in a highlight span, so
     * the grader sees where comments are and can click one to re-open it. The wrap
     * is bracketed by an observer disconnect so it never re-triggers _sync().
     */
    _renderMarkers() {
        if (!this._view || !this._observer) {
            return;
        }
        this._observer.disconnect();
        try {
            // Clear previous markers (unwrap).
            this._view.querySelectorAll('.' + MARK_CLASS).forEach((el) => this._unwrap(el));

            this._view.querySelectorAll('[data-source-type]').forEach((wrapper) => {
                const body = wrapper.querySelector('.local-unifiedgrader-translation-body');
                if (!body) {
                    return;
                }
                const source = this._sourceForWrapper(wrapper);
                if (!source) {
                    return;
                }
                const sourcetype = wrapper.dataset.sourceType || 'onlinetext';
                this._comments
                    .filter((c) => (c.sourcetype || 'onlinetext') === sourcetype)
                    .forEach((c) => {
                        const phrase = this._translatedPhraseFor(c, source);
                        if (phrase) {
                            this._highlight(body, phrase, c.id);
                        }
                    });
            });
        } finally {
            this._observer.observe(this._view, {childList: true, subtree: true});
        }
    }

    /**
     * The translated text of a comment's anchored phrase: match its source
     * anchortext to the source segments, map those to translation segments via the
     * groups, and join their translated text.
     *
     * @param {object} comment The stored comment.
     * @param {object} source The parsed source (segments + groups).
     * @return {string} The translated phrase text, or '' when unresolvable.
     */
    _translatedPhraseFor(comment, source) {
        const anchor = this._norm(comment.anchortext);
        if (anchor.length < 2) {
            return '';
        }
        // Source segment ids whose text is part of the anchor.
        const srcids = new Set();
        source.segments.forEach((seg) => {
            const src = this._norm(seg.src);
            if (src.length >= 2 && (anchor.includes(src) || src.includes(anchor))) {
                srcids.add(parseInt(seg.id, 10));
            }
        });
        if (!srcids.size) {
            return '';
        }
        // Map source ids to translation ids via the groups (reverse of _txToSrc).
        const txids = new Set();
        const grouped = new Set();
        (Array.isArray(source.groups) ? source.groups : []).forEach((group) => {
            const s = Array.isArray(group[0]) ? group[0].map(Number) : [];
            const t = Array.isArray(group[1]) ? group[1].map(Number) : [];
            s.forEach((id) => grouped.add(id));
            if (s.some((id) => srcids.has(id))) {
                t.forEach((id) => txids.add(id));
            }
        });
        srcids.forEach((id) => {
            if (!grouped.has(id)) {
                txids.add(id);
            }
        });
        // Concatenate the translated segments in id order.
        const parts = [];
        source.segments
            .filter((seg) => txids.has(parseInt(seg.id, 10)) && seg.tx)
            .forEach((seg) => parts.push(seg.tx));
        return this._stripTags(parts.join(' ')).trim();
    }

    /**
     * Highlight the first run of `phrase` inside `body`, tolerant to whitespace
     * differences, wrapping the matched text range in a marker span. No-op when
     * the phrase cannot be located (the comment still lives in the list model).
     *
     * @param {HTMLElement} body The translated body element.
     * @param {string} phrase The translated phrase to find.
     * @param {number} id The comment id (stored on the marker).
     */
    _highlight(body, phrase, id) {
        const target = this._norm(phrase);
        if (target.length < 2) {
            return;
        }
        // Flatten the body's text nodes and remember each character's origin so a
        // match in the normalised stream maps back to a concrete DOM range.
        const nodes = [];
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let raw = '';
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            nodes.push({node: n, start: raw.length});
            raw += n.nodeValue;
        }
        // Build a whitespace-tolerant regex from the phrase's tokens.
        const tokens = target.split(' ').filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (!tokens.length) {
            return;
        }
        const re = new RegExp(tokens.join('\\s+'), 'i');
        const match = re.exec(raw);
        if (!match) {
            return;
        }
        const from = match.index;
        const to = from + match[0].length;
        const start = this._locate(nodes, from);
        const end = this._locate(nodes, to);
        if (!start || !end) {
            return;
        }
        // Skip when this region is already inside a marker: overlapping comment
        // phrases must not nest wrappers (which would corrupt across render cycles).
        if (start.node.parentElement && start.node.parentElement.closest('.' + MARK_CLASS)) {
            return;
        }
        this._wrapRange(start, end, body, id);
    }

    /**
     * Map a character offset in the flattened text stream to a {node, offset}.
     *
     * @param {Array<{node: Text, start: number}>} nodes The flattened text map.
     * @param {number} pos The absolute character offset.
     * @return {?{node: Text, offset: number}}
     */
    _locate(nodes, pos) {
        for (let i = nodes.length - 1; i >= 0; i--) {
            if (pos >= nodes[i].start) {
                return {node: nodes[i].node, offset: pos - nodes[i].start};
            }
        }
        return null;
    }

    /**
     * Wrap the text between two {node, offset} points in marker spans, splitting
     * boundary text nodes and wrapping each intervening text node in its own span
     * (a range may cross inline tags). All spans carry the same comment id.
     *
     * @param {{node: Text, offset: number}} start The start point.
     * @param {{node: Text, offset: number}} end The end point.
     * @param {HTMLElement} body The containing body (walk boundary).
     * @param {number} id The comment id.
     */
    _wrapRange(start, end, body, id) {
        // Collect the text nodes from start to end inclusive.
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        const between = [];
        let inside = false;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n === start.node) {
                inside = true;
            }
            if (inside) {
                between.push(n);
            }
            if (n === end.node) {
                break;
            }
        }
        // Process last-to-first so splitting earlier nodes cannot shift later ones.
        for (let i = between.length - 1; i >= 0; i--) {
            const node = between[i];
            const s = node === start.node ? start.offset : 0;
            const e = node === end.node ? end.offset : node.nodeValue.length;
            if (e <= s) {
                continue;
            }
            const range = document.createRange();
            range.setStart(node, s);
            range.setEnd(node, e);
            const span = document.createElement('span');
            span.className = MARK_CLASS;
            span.dataset.segcommentId = id;
            span.setAttribute('role', 'button');
            span.setAttribute('tabindex', '0');
            range.surroundContents(span);
        }
    }

    /**
     * Unwrap a marker span, restoring its text into the parent (and normalising).
     *
     * @param {HTMLElement} span The marker span.
     */
    _unwrap(span) {
        const parent = span.parentNode;
        if (!parent) {
            return;
        }
        while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
        parent.normalize();
    }

    /**
     * Click on an existing highlight: open its comment in the composer.
     *
     * @param {Event} e The click event.
     */
    _onMarkerClick(e) {
        // A drag-select can also emit a click; let mouseup handle the new comment.
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
            return;
        }
        const mark = e.target.closest('.' + MARK_CLASS);
        if (!mark || !this._view.contains(mark)) {
            return;
        }
        const id = parseInt(mark.dataset.segcommentId, 10);
        const comment = this._comments.find((c) => parseInt(c.id, 10) === id);
        if (!comment) {
            return;
        }
        const target = {
            sourcetype: comment.sourcetype || 'onlinetext',
            fileid: comment.fileid || 0,
            srcsegids: [],
            phrase: comment.anchortext,
            rect: mark.getBoundingClientRect(),
        };
        this._openComposer(target, comment);
    }

    // --- The floating composer --------------------------------------------------

    /**
     * Open the composer popover for a target phrase, either as a new comment
     * (existing null) or showing/editing an existing one.
     *
     * @param {object} target {sourcetype, fileid, srcsegids, phrase, rect}.
     * @param {?object} existing The existing comment, or null for a new one.
     */
    async _openComposer(target, existing) {
        this._closeComposer();

        const pop = document.createElement('div');
        pop.className = 'local-unifiedgrader-segcomment-pop card shadow';
        pop.setAttribute('role', 'dialog');

        const header = document.createElement('div');
        header.className = 'small text-muted fst-italic px-2 pt-2';
        header.textContent = await this._str(
            'segcomment_anchor', 'Commenting on: “{$a}”', this._truncate(target.phrase, 80));
        pop.appendChild(header);

        const textarea = document.createElement('textarea');
        textarea.className = 'form-control form-control-sm m-2';
        textarea.rows = 3;
        textarea.value = existing ? this._htmlToText(existing.commenttext) : '';
        textarea.placeholder = await this._str('segcomment_placeholder', 'Write a comment on the selected phrase…');
        pop.appendChild(textarea);

        const foot = document.createElement('div');
        foot.className = 'd-flex align-items-center gap-2 px-2 pb-2';

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'btn btn-primary btn-sm';
        save.textContent = await this._str('segcomment_save', 'Save comment');
        save.addEventListener('click', () => this._save(target, existing, textarea.value));
        foot.appendChild(save);

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-outline-secondary btn-sm';
        cancel.textContent = await this._str('segcomment_cancel', 'Cancel');
        cancel.addEventListener('click', () => this._closeComposer());
        foot.appendChild(cancel);

        if (existing && parseInt(existing.authorid, 10) === this._myId()) {
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'btn btn-link btn-sm p-0 text-danger ms-auto';
            del.textContent = await this._str('segcomment_delete', 'Delete');
            del.addEventListener('click', () => this._delete(existing));
            foot.appendChild(del);
        }
        pop.appendChild(foot);

        // Ctrl/Cmd+Enter saves, Esc cancels; keep typing out of global shortcuts.
        textarea.addEventListener('keydown', (ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
                ev.preventDefault();
                this._save(target, existing, textarea.value);
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                this._closeComposer();
            }
        });

        document.body.appendChild(pop);
        this._pop = pop;
        this._position(pop, target.rect);
        textarea.focus();
        this._armDismiss();
    }

    /**
     * Position a fixed popover at a selection rect: below it, flipped above when
     * there is no room, and clamped to the viewport (mirrors the annotation
     * composer / penalty_popout placement).
     *
     * @param {HTMLElement} pop The popover element.
     * @param {DOMRect} rect The anchor rect (viewport coords).
     */
    _position(pop, rect) {
        const margin = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = pop.offsetWidth || 320;
        const h = pop.offsetHeight || 160;

        let left = (rect ? rect.left : margin);
        if (left + w > vw - margin) {
            left = vw - w - margin;
        }
        left = Math.max(margin, left);

        let top = rect ? rect.bottom + 6 : margin;
        if (top + h > vh - margin) {
            const above = (rect ? rect.top : margin) - 6 - h;
            top = above >= margin ? above : Math.max(margin, vh - h - margin);
        }
        pop.style.left = Math.round(left) + 'px';
        pop.style.top = Math.round(top) + 'px';
    }

    /**
     * Arm the outside-click / scroll dismissers for the open popover (deferred one
     * frame so the opening interaction does not immediately close it).
     */
    _armDismiss() {
        this._disarmDismiss();
        const pop = this._pop;
        const onDown = (ev) => {
            if (this._pop && !this._pop.contains(ev.target)) {
                this._closeComposer();
            }
        };
        const onScroll = () => this._closeComposer();
        this._dismissRaf = requestAnimationFrame(() => {
            this._dismissRaf = 0;
            // Superseded by a newer popover before the frame fired: install nothing.
            if (this._pop !== pop) {
                return;
            }
            document.addEventListener('mousedown', onDown, true);
            this._view?.addEventListener('scroll', onScroll, true);
            this._dismiss = () => {
                document.removeEventListener('mousedown', onDown, true);
                this._view?.removeEventListener('scroll', onScroll, true);
            };
        });
    }

    /**
     * Remove the outside-click / scroll dismissers and cancel any pending arm, so a
     * fast re-open cannot orphan a previous popover's listeners.
     */
    _disarmDismiss() {
        if (this._dismissRaf) {
            cancelAnimationFrame(this._dismissRaf);
            this._dismissRaf = 0;
        }
        if (this._dismiss) {
            this._dismiss();
            this._dismiss = null;
        }
    }

    /**
     * Close and remove the composer popover.
     */
    _closeComposer() {
        this._disarmDismiss();
        if (this._pop) {
            this._pop.remove();
            this._pop = null;
        }
    }

    /**
     * Save the composer: create the comment (an edit is delete-then-create, since
     * the P2 contract has no update external). Re-anchors from the source ids on a
     * new comment, or from the existing comment's phrase on an edit.
     *
     * @param {object} target The pending target.
     * @param {?object} existing The existing comment being edited, or null.
     * @param {string} value The textarea value.
     */
    async _save(target, existing, value) {
        const commenttext = (value || '').trim();
        if (!commenttext) {
            return;
        }
        const cmid = parseInt(this.reactive.state.activity?.cmid, 10);
        const userid = this._loadedUser;
        const attempt = Number.isInteger(this.reactive.state.submission?.attemptnumber)
            ? this.reactive.state.submission.attemptnumber : -1;
        if (!cmid || !userid) {
            return;
        }

        // For an edit, re-derive the source ids from the stored phrase.
        let srcsegids = target.srcsegids;
        if (existing) {
            const rederived = this._srcIdsForComment(existing);
            if (!rederived.length) {
                return;
            }
            srcsegids = rederived;
        }
        if (!srcsegids.length) {
            return;
        }

        try {
            // Create first, then delete the old row on an edit — so a failure
            // after the delete can never lose the comment (worst case: a duplicate).
            const created = await Ajax.call([{
                methodname: 'local_unifiedgrader_save_segment_comment',
                args: {
                    cmid,
                    userid,
                    attempt,
                    sourcetype: target.sourcetype,
                    fileid: target.fileid,
                    srcsegids,
                    commenttext,
                    commentformat: 1,
                },
            }])[0];
            this._comments.push(this._toListShape(created));
            if (existing) {
                await Ajax.call([{
                    methodname: 'local_unifiedgrader_delete_segment_comment',
                    args: {id: existing.id},
                }])[0];
                this._comments = this._comments.filter((c) => c.id !== existing.id);
            }
            this._closeComposer();
            this._renderMarkers();
        } catch (error) {
            Notification.exception(error);
        }
    }

    /**
     * Delete an existing comment (author-scoped, confirmed).
     *
     * @param {object} comment The comment to delete.
     */
    async _delete(comment) {
        const confirmed = window.confirm(await this._str('segcomment_deleteconfirm', 'Delete this comment?'));
        if (!confirmed) {
            return;
        }
        try {
            await Ajax.call([{
                methodname: 'local_unifiedgrader_delete_segment_comment',
                args: {id: comment.id},
            }])[0];
            this._comments = this._comments.filter((c) => c.id !== comment.id);
            this._closeComposer();
            this._renderMarkers();
        } catch (error) {
            Notification.exception(error);
        }
    }

    /**
     * Re-derive a comment's source segment ids from the current alignment, by
     * matching its anchortext to the source segments — needed because the stored
     * positional ids are not durable across a re-translation.
     *
     * @param {object} comment The comment to re-anchor.
     * @return {Array<number>} The source segment ids (may be empty).
     */
    _srcIdsForComment(comment) {
        const anchor = this._norm(comment.anchortext);
        if (anchor.length < 2) {
            return [];
        }
        for (const source of this._sources) {
            if (source.type !== (comment.sourcetype || 'onlinetext')) {
                continue;
            }
            const ids = [];
            source.segments.forEach((seg) => {
                const src = this._norm(seg.src);
                if (src.length >= 2 && (anchor.includes(src) || src.includes(anchor))) {
                    ids.push(parseInt(seg.id, 10));
                }
            });
            if (ids.length) {
                return Array.from(new Set(ids)).sort((a, b) => a - b);
            }
        }
        return [];
    }

    /**
     * Normalise a saved row (from save) into the list-render shape (from get).
     *
     * @param {object} row The created row returned by save_segment_comment.
     * @return {object}
     */
    _toListShape(row) {
        return {
            id: row.id,
            segmentid: row.segmentid,
            currentsegmentid: 0,
            sourcetype: row.sourcetype,
            fileid: row.fileid,
            startoffset: row.startoffset,
            endoffset: row.endoffset,
            anchortext: row.anchortext,
            commenttext: row.commenttext,
            commentformat: row.commentformat,
            authorid: row.authorid,
            authorfullname: '',
            timecreated: row.timecreated,
            timemodified: row.timemodified,
        };
    }

    // --- Small helpers ----------------------------------------------------------

    /**
     * The nearest source wrapper for a node, when it lies inside the view.
     *
     * @param {Node} node A DOM node.
     * @return {?HTMLElement} The [data-source-type] wrapper, or null.
     */
    _wrapperOf(node) {
        const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!el || !this._view.contains(el)) {
            return null;
        }
        return el.closest('[data-source-type]');
    }

    /**
     * Resolve the parsed source entry for a wrapper by its DOM index.
     *
     * @param {HTMLElement} wrapper The source wrapper element.
     * @return {?object} The parsed source, or null.
     */
    _sourceForWrapper(wrapper) {
        const wrappers = Array.from(this._view.querySelectorAll('[data-source-type]'));
        const index = wrappers.indexOf(wrapper);
        if (index < 0 || index >= this._sources.length) {
            return this._sources.find((s) => s.type === wrapper.dataset.sourceType) || null;
        }
        return this._sources[index];
    }

    /**
     * The current grader's user id.
     *
     * @return {number}
     */
    _myId() {
        return parseInt(this.reactive.state.currentUser?.id, 10) || 0;
    }

    /**
     * Reduce whitespace to single spaces and trim, for tolerant text matching.
     *
     * @param {string} value The raw text.
     * @return {string}
     */
    _norm(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    /**
     * Strip HTML tags to plain text. Parsed with DOMParser (an inert document) so
     * no resource loads or event handlers can fire, even though the inputs here
     * (server clean_text'd segment/comment HTML) are already sanitised.
     *
     * @param {string} html The HTML.
     * @return {string}
     */
    _stripTags(html) {
        const doc = new DOMParser().parseFromString(html || '', 'text/html');
        return doc.body.textContent || '';
    }

    /**
     * Strip HTML to plain text (for prefilling the composer on edit).
     *
     * @param {string} html The comment HTML.
     * @return {string}
     */
    _htmlToText(html) {
        return this._stripTags(html).trim();
    }

    /**
     * Truncate text for the composer header.
     *
     * @param {string} value The text.
     * @param {number} max The maximum length.
     * @return {string}
     */
    _truncate(value, max) {
        const v = (value || '').trim();
        return v.length > max ? v.slice(0, max - 1) + '…' : v;
    }

    /**
     * Resolve a UG string, falling back to a supplied English default.
     *
     * @param {string} key The string key.
     * @param {string} fallback The English default used when the string is absent.
     * @param {*} [a] Optional placeholder value.
     * @return {Promise<string>}
     */
    async _str(key, fallback, a) {
        try {
            return await getString(key, 'local_unifiedgrader', a);
        } catch (e) {
            if (a !== undefined && a !== null) {
                return String(fallback).replace('{$a}', a);
            }
            return fallback;
        }
    }
}
