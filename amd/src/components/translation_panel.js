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
 * Translation panel component — grader "View translation / View original" toggle.
 *
 * For assignment activities it asks local_nida (via the
 * get_submission_translation external) whether an English translation of the
 * student's submission exists. When it does, it exposes a toggle that swaps the
 * submission preview for the translated HTML inside an advisory-banner container,
 * disables annotation tools while translated (annotations belong on the original
 * only), and offers a split "parallel" sub-mode with segment sync-highlighting
 * when alignment data is present.
 *
 * The component degrades silently when local_nida is absent (the external
 * returns status 'unavailable').
 *
 * @module     local_unifiedgrader/components/translation_panel
 * @copyright  2026 South African Theological Seminary
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {BaseComponent} from 'core/reactive';
import {get_string as getString} from 'core/str';
import Ajax from 'core/ajax';
import Notification from 'core/notification';

/** Advisory fallback strings (English) used when local_nida strings are absent. */
const FALLBACKS = {
    advisory: 'Machine translation — advisory only. Do not grade solely from this view.',
    mixed: 'Mixed languages detected — the translation may be partly unreliable.',
    pending: 'Translation pending.',
    notext: 'This file contains no extractable text and cannot be translated.',
    failed: 'This file could not be translated.',
    unsupported: 'This file type is not supported for translation.',
    truncated: 'This document was long and only the first part was translated.',
};

export default class extends BaseComponent {

    /**
     * Component creation hook.
     */
    create() {
        this.name = 'translation_panel';
        this.selectors = {
            TOGGLE: '[data-action="translation-toggle"]',
            TOGGLE_LABEL: '[data-region="translation-toggle-label"]',
            PARALLEL: '[data-action="translation-parallel"]',
            PARALLEL_LABEL: '[data-region="translation-parallel-label"]',
            LANG: '[data-region="translation-lang"]',
            LANG_TOGGLE: '[data-action="translation-lang-toggle"]',
            LANG_CODE: '[data-region="translation-lang-code"]',
            LANG_SELECT: '[data-region="translation-lang-select"]',
            ADVISORY: '[data-region="translation-advisory"]',
            MIXED: '[data-region="translation-mixed"]',
            HINT: '[data-region="translation-hint"]',
        };
        /** @type {Array<{code: string, label: string}>} The override language options. */
        this._langOptions = [];
        /** @type {?HTMLElement} The shared preview-content wrapper. */
        this._preview = null;
        /** @type {?object} The last translation payload from the server. */
        this._data = null;
        /** @type {boolean} Whether the translated view is currently shown. */
        this._showing = false;
        /** @type {boolean} Whether the split parallel sub-mode is active. */
        this._parallel = false;
        /** @type {number} The user whose translation is currently loaded. */
        this._loadedUser = 0;
        /** @type {?string} Source-pager selection: 'content', 'portfolio' or a {files}.id. */
        this._activeFileid = null;
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
     *
     * @param {object} state Current state.
     */
    stateReady(state) {
        this._preview = this.element.closest('[data-region="preview-content"]');

        const toggle = this.getElement(this.selectors.TOGGLE);
        if (toggle) {
            toggle.addEventListener('click', (e) => this._onToggleClick(e));
        }
        const parallel = this.getElement(this.selectors.PARALLEL);
        if (parallel) {
            parallel.addEventListener('click', (e) => this._onParallelClick(e));
        }

        // Language-designation badge: read the override options once and wire the
        // click-to-reveal selector. The badge lives in the document-viewer toolbar
        // (replacing the old marking-panel language-confirm card).
        const container = this.element.closest('.local-unifiedgrader-container');
        if (container && container.dataset.langoptions) {
            try {
                this._langOptions = JSON.parse(container.dataset.langoptions) || [];
            } catch (e) {
                this._langOptions = [];
            }
        }
        const langToggle = this.getElement(this.selectors.LANG_TOGGLE);
        if (langToggle) {
            langToggle.addEventListener('click', () => this._toggleLangSelect());
        }
        const langSelect = this.getElement(this.selectors.LANG_SELECT);
        if (langSelect) {
            langSelect.addEventListener('change', () => this._confirmLang(langSelect.value));
        }

        // Follow the right-pane source pager (Submission / file pills): the
        // translated view shows ONE source at a time, exactly like the standard
        // viewers, and swaps sheets when the grader pages. The list element
        // persists across re-renders, so a single delegated listener suffices.
        const pilllist = container?.querySelector('[data-region="file-selector-list"]');
        if (pilllist) {
            pilllist.addEventListener('click', (e) => this._onSourcePillClick(e));
        }

        if (this._isAssign() && state.submission && state.submission.userid) {
            this._fetch();
        }
    }

    /**
     * A click in the right-pane source pager. Record the chosen source and, when
     * the translated view is active, swap the translated sheet to match and
     * re-hide the original viewer the preview panel just revealed (its own pill
     * handler runs first — target before ancestors — and shows it synchronously).
     *
     * @param {Event} e The click event.
     */
    _onSourcePillClick(e) {
        // Ignore the per-file download anchors — only the preview buttons page.
        if (e.target.closest('a')) {
            return;
        }
        const pill = e.target.closest('[data-fileid]');
        if (!pill) {
            return;
        }
        this._activeFileid = String(pill.dataset.fileid);
        if (!this._showing) {
            return;
        }
        // Re-hide whatever viewer the preview panel revealed for the new source,
        // but keep the previous restore bookkeeping when nothing was visible
        // (e.g. a non-previewable file opened in a new tab instead).
        const previous = this._hiddenRegions;
        this._hideOriginalViewers();
        if (!this._hiddenRegions.length && previous && previous.length) {
            this._hiddenRegions = previous;
        }
        this._renderTranslationBody();
    }

    /**
     * The source pager's current selection: 'content', 'portfolio' or a stored
     * {files}.id as a string. Falls back to the highlighted pill, or null when
     * there is no pager (single-source submissions).
     *
     * @return {?string}
     */
    _activeSourceKey() {
        if (this._activeFileid !== null) {
            return this._activeFileid;
        }
        const container = this.element.closest('.local-unifiedgrader-container');
        const active = container?.querySelector('[data-region="file-selector-list"] .btn-primary');
        const pill = active ? active.closest('[data-fileid]') : null;
        return pill ? String(pill.dataset.fileid) : null;
    }

    /**
     * The payload sources the translated view should render: only the source
     * the pager has selected — a file matched by its {files}.id, otherwise the
     * non-file content — mirroring the standard view's one-source-at-a-time
     * paging. Falls back to every source when nothing matches, so the view can
     * never go silently blank.
     *
     * @return {Array<object>}
     */
    _sourcesForActive() {
        const sources = this._data?.sources || [];
        const key = this._activeSourceKey();
        if (key === null) {
            return sources;
        }
        let matched;
        if (key === 'content' || key === 'portfolio') {
            matched = sources.filter((s) => (s.type || 'onlinetext') !== 'file');
        } else {
            matched = sources.filter((s) => (s.type || 'onlinetext') === 'file'
                && String(parseInt(s.fileid, 10) || 0) === key);
        }
        return matched.length ? matched : sources;
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
     * React to a new submission being loaded: reset our own view and re-fetch the
     * translation status for the new student/attempt.
     *
     * The preview_panel component (which runs its own submission:updated watcher)
     * owns the original PDF/document viewer visibility, so this reset must NOT
     * restore viewer visibility — only tear down the translated view.
     */
    _onSubmissionUpdated() {
        this._resetForNewSubmission();
        this._data = null;
        if (this._isAssign() && this.reactive.state.submission?.userid) {
            this._fetch();
        }
    }

    /**
     * Tear down the translated view for a new submission without touching the
     * original viewer visibility (preview_panel re-renders that itself).
     */
    _resetForNewSubmission() {
        this.element.classList.add('d-none');
        const view = this._preview?.querySelector('[data-region="translation-view"]');
        if (view) {
            view.classList.add('d-none');
            view.innerHTML = '';
        }
        // Clear our annotation-toolbar hide marker (preview_panel/pdf_viewer will
        // set the correct toolbar state for the new submission).
        this._setAnnotationToolbar(true);
        this._showing = false;
        this._parallel = false;
        this._hiddenRegions = null;
        this._activeFileid = null;
        this._setPills(false);
    }

    /**
     * Fetch the translation status for the current submission from the server.
     */
    _fetch() {
        const state = this.reactive.state;
        const cmid = parseInt(state.activity.cmid, 10);
        const userid = parseInt(state.submission.userid, 10);
        const attempt = Number.isInteger(state.submission.attemptnumber)
            ? state.submission.attemptnumber : -1;
        if (!cmid || !userid) {
            return;
        }

        Ajax.call([{
            methodname: 'local_unifiedgrader_get_submission_translation',
            args: {cmid, userid, attempt},
            failurealert: false,
        }])[0].then((result) => {
            // Stale-response guard — ignore if the grader has since navigated away.
            if (parseInt(this.reactive.state.submission?.userid, 10) !== userid) {
                return result;
            }
            this._data = result;
            this._loadedUser = userid;
            this._dispatchMetadata(result);
            this._updateControls(result);
            return result;
        }).catch(() => {
            this._hidePanel();
        });
    }

    /**
     * Notify the language-confirm component of the language metadata via a
     * DOM CustomEvent so both components share a single server round-trip.
     *
     * @param {object} result The translation payload.
     */
    _dispatchMetadata(result) {
        const container = this.element.closest('.local-unifiedgrader-container');
        if (!container) {
            return;
        }
        container.dispatchEvent(new CustomEvent('unifiedgrader:translationloaded', {
            bubbles: true,
            detail: {
                userid: this._loadedUser,
                status: result.status,
                hasmetadata: result.hasmetadata,
                detectedlang: result.detectedlang,
                resolvedlang: result.resolvedlang,
                agreement: result.agreement,
            },
        }));
    }

    /**
     * Show or hide the toggle controls based on the fetched status.
     *
     * @param {object} result The translation payload.
     */
    _updateControls(result) {
        const status = result.status;
        // Only offer the toggle when a translation is (or will be) available.
        if (status === 'nottranslated' || status === 'unavailable' || status === 'noattempt') {
            this._hidePanel();
            return;
        }

        this._showPanel();
        this._setToggleLabel(false);

        // Offer the parallel sub-mode only when a source carries alignment data.
        const parallelBtn = this.getElement(this.selectors.PARALLEL);
        if (parallelBtn) {
            parallelBtn.classList.toggle('d-none', !this._hasAlignment(result));
        }

        this._renderLangBadge(result);
    }

    /**
     * Show the submission-language designation as a compact badge in the toolbar
     * (language code, e.g. "FR"). Hidden under blind marking (no metadata). When
     * detection and the student profile disagree (agreement 0) or the language is
     * unresolved, the badge is styled as needing attention and clicking it reveals
     * an inline override selector — preserving the confirm capability without the
     * old full-width card.
     *
     * @param {object} result The translation payload.
     */
    _renderLangBadge(result) {
        const badge = this.getElement(this.selectors.LANG);
        if (!badge) {
            return;
        }
        // No language metadata (blind marking or nida absent): show nothing.
        if (!result.hasmetadata || this._langOptions.length === 0) {
            badge.classList.add('d-none');
            return;
        }

        const resolved = result.resolvedlang || '';
        const shown = resolved || result.detectedlang || '';
        const needsConfirm = result.agreement === 0 || resolved === '';

        const code = this.getElement(this.selectors.LANG_CODE);
        if (code) {
            code.textContent = (shown || '?').toUpperCase();
        }
        const toggle = this.getElement(this.selectors.LANG_TOGGLE);
        if (toggle) {
            // Amber outline when the grader still needs to confirm the language.
            toggle.classList.toggle('btn-outline-warning', needsConfirm);
            toggle.classList.toggle('btn-light', !needsConfirm);
            toggle.classList.toggle('border', !needsConfirm);
        }

        const select = this.getElement(this.selectors.LANG_SELECT);
        if (select) {
            select.innerHTML = '';
            this._langOptions.forEach((opt) => {
                const option = document.createElement('option');
                option.value = opt.code;
                option.textContent = opt.label;
                if (opt.code === shown) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
            // Reveal the selector straight away only when confirmation is needed.
            select.classList.toggle('d-none', !needsConfirm);
        }

        badge.classList.remove('d-none');
    }

    /**
     * Toggle the inline override selector's visibility.
     */
    _toggleLangSelect() {
        const select = this.getElement(this.selectors.LANG_SELECT);
        if (select) {
            select.classList.toggle('d-none');
        }
    }

    /**
     * Persist a grader's language override via confirm_student_language, then
     * refresh the badge from the returned resolved language.
     *
     * @param {string} lang The chosen language code.
     */
    _confirmLang(lang) {
        const state = this.reactive.state;
        const cmid = parseInt(state.activity?.cmid, 10);
        const userid = this._loadedUser;
        const attempt = Number.isInteger(state.submission?.attemptnumber)
            ? state.submission.attemptnumber : -1;
        if (!cmid || !userid || !lang) {
            return;
        }
        Ajax.call([{
            methodname: 'local_unifiedgrader_confirm_student_language',
            args: {cmid, userid, attempt, lang},
        }])[0].then((res) => {
            if (res.saved && this._data) {
                this._data.resolvedlang = res.resolvedlang || lang;
                this._data.agreement = 1;
                this._renderLangBadge(this._data);
            }
            return res;
        }).catch(Notification.exception);
    }

    /**
     * Whether any source in the payload carries usable alignment data.
     *
     * @param {object} result The translation payload.
     * @return {boolean}
     */
    _hasAlignment(result) {
        return (result.sources || []).some((s) => this._parseAlignment(s) !== null);
    }

    /**
     * Parse a source's alignment JSON, returning null when unusable.
     *
     * local_nida returns pre-sanitised per-segment inner HTML (no spans) plus the
     * n:m alignment groups; the segment marker spans are created client-side in
     * _renderParallel(). See the frozen alignment contract.
     *
     * @param {object} source A single source entry.
     * @return {?object} {segments: [{id, src, tx}], groups: [[srcIds], [txIds]]} or null.
     */
    _parseAlignment(source) {
        if (!source || !source.alignment) {
            return null;
        }
        let parsed;
        try {
            parsed = JSON.parse(source.alignment);
        } catch (e) {
            return null;
        }
        if (parsed && Array.isArray(parsed.segments) && parsed.segments.length) {
            return {
                segments: parsed.segments,
                groups: Array.isArray(parsed.groups) ? parsed.groups : [],
            };
        }
        return null;
    }

    /**
     * Toggle button handler: switch between original and translated views.
     *
     * @param {Event} e The click event.
     */
    _onToggleClick(e) {
        e.preventDefault();
        if (this._showing) {
            this._restoreOriginal();
        } else {
            this._showTranslation();
        }
    }

    /**
     * Parallel button handler: toggle the split sync-highlight sub-mode.
     *
     * @param {Event} e The click event.
     */
    _onParallelClick(e) {
        e.preventDefault();
        this._parallel = !this._parallel;
        if (this._showing) {
            this._renderTranslationBody();
        }
    }

    /**
     * Switch the preview to the translated view.
     */
    async _showTranslation() {
        if (!this._data || !this._preview) {
            return;
        }
        // Remember and hide the original viewers.
        this._hideOriginalViewers();
        // Disable annotation tools — annotations belong on the original only.
        this._setAnnotationToolbar(false);

        const view = this._preview.querySelector('[data-region="translation-view"]');
        if (view) {
            view.classList.remove('d-none');
        }
        this._showing = true;
        this._setToggleLabel(true);
        await this._setPills(true);
        await this._renderTranslationBody();
    }

    /**
     * Restore the original (untranslated) preview.
     */
    _restoreOriginal() {
        if (!this._preview) {
            return;
        }
        const view = this._preview.querySelector('[data-region="translation-view"]');
        if (view) {
            view.classList.add('d-none');
            view.innerHTML = '';
        }
        this._restoreOriginalViewers();
        this._setAnnotationToolbar(true);
        this._showing = false;
        this._setToggleLabel(false);
        this._setPills(false);
    }

    /**
     * Render the translated body.
     *
     * Visual continuity with the original viewers: no alert boxes are stacked
     * above the document (the advisory lives in the toolbar as a pill — see
     * _setPills); each source renders as a centred white "paper" sheet on the
     * grey workspace backdrop, mirroring the PDF viewer's page metaphor.
     */
    async _renderTranslationBody() {
        const view = this._preview?.querySelector('[data-region="translation-view"]');
        if (!view || !this._data) {
            return;
        }
        view.innerHTML = '';

        // Pending: show a placeholder and stop.
        if (this._data.status === 'pending') {
            const pending = await this._banner('pending', 'alert-info');
            pending.classList.add('m-3');
            view.appendChild(pending);
            return;
        }

        for (const source of this._sourcesForActive()) {
            view.appendChild(await this._renderSource(source));
        }
    }

    /**
     * Render a single source (online text or file) as a paper sheet.
     *
     * @param {object} source A source entry.
     * @return {Promise<HTMLElement>}
     */
    async _renderSource(source) {
        const slot = document.createElement('div');
        slot.className = 'local-unifiedgrader-translation-slot';
        slot.dataset.sourceType = source.type;
        // The stored-file id lets seg_comments map this sheet back to its payload
        // source by identity (the sheets rendered are a pager-dependent subset,
        // so DOM order cannot be used).
        slot.dataset.fileid = String(parseInt(source.fileid, 10) || 0);

        const alignment = this._parseAlignment(source);
        const parallel = this._parallel && alignment;

        const page = document.createElement('div');
        page.className = 'local-unifiedgrader-translation-page'
            + (parallel ? ' local-unifiedgrader-translation-page-wide' : '');
        slot.appendChild(page);

        // Filename as a slim running header on the sheet itself.
        if (source.filename) {
            const heading = document.createElement('div');
            heading.className = 'small text-muted border-bottom pb-2 mb-3';
            heading.textContent = source.filename;
            page.appendChild(heading);
        }

        // Per-file verdict (notext / failed / unsupported / truncated) as a quiet
        // note on the sheet, not an alert box.
        if (source.verdict && FALLBACKS[source.verdict]) {
            const note = document.createElement('div');
            note.className = 'small text-muted fst-italic mb-2';
            note.textContent = await this._resolveString(source.verdict);
            page.appendChild(note);
        }

        if (parallel) {
            page.appendChild(this._renderParallel(alignment));
        } else {
            const body = document.createElement('div');
            body.className = 'local-unifiedgrader-translation-body';
            body.innerHTML = source.html || '';
            page.appendChild(body);
        }
        return slot;
    }

    /**
     * Toggle the toolbar pills (machine-translation advisory, mixed-language,
     * select-to-comment hint) to match whether the translated view is showing.
     * The long advisory/mixed strings become tooltips on the compact pills.
     *
     * @param {boolean} showing Whether the translated view is active.
     */
    async _setPills(showing) {
        const pending = !this._data || this._data.status === 'pending';
        const advisory = this.getElement(this.selectors.ADVISORY);
        if (advisory) {
            advisory.classList.toggle('d-none', !showing || pending);
            if (showing && !pending && !advisory.title) {
                advisory.title = await this._resolveString('advisory');
            }
        }
        const mixed = this.getElement(this.selectors.MIXED);
        if (mixed) {
            mixed.classList.toggle('d-none', !showing || pending || !this._data?.mixedflag);
            if (showing && !mixed.title) {
                mixed.title = await this._resolveString('mixed');
            }
        }
        const hint = this.getElement(this.selectors.HINT);
        if (hint) {
            hint.classList.toggle('d-none',
                !showing || pending || !this._data || !this._hasAlignment(this._data));
        }
    }

    /**
     * Render a split original/translation pane with segment sync-highlighting.
     *
     * The server sends per-segment inner HTML already sanitised by local_nida
     * (clean_text, no spans). We wrap each segment in its OWN data-nida-seg span
     * created here — wrapping already-clean HTML is XSS-safe — then wire the
     * cross-column highlight through _wireHighlight().
     *
     * @param {object} alignment {segments: [{id, src, tx}], groups: [[srcIds], [txIds]]}.
     * @return {HTMLElement}
     */
    _renderParallel(alignment) {
        const row = document.createElement('div');
        row.className = 'row g-2';

        const makeCol = (role) => {
            const col = document.createElement('div');
            col.className = 'col-6';
            col.dataset.alignCol = role;
            const inner = document.createElement('div');
            inner.className = 'local-unifiedgrader-translation-body';
            col.appendChild(inner);
            return {col, inner};
        };

        const src = makeCol('src');
        const tx = makeCol('tx');

        const appendSeg = (inner, id, html) => {
            const span = document.createElement('span');
            span.dataset.nidaSeg = id;
            span.className = 'local-unifiedgrader-seg';
            // html is server-cleaned per-segment inner HTML — safe to assign.
            span.innerHTML = html || '';
            inner.appendChild(span);
            inner.appendChild(document.createTextNode(' '));
        };

        for (const seg of alignment.segments) {
            if (seg.src) {
                appendSeg(src.inner, seg.id, seg.src);
            }
            if (seg.tx) {
                appendSeg(tx.inner, seg.id, seg.tx);
            }
        }

        row.appendChild(src.col);
        row.appendChild(tx.col);
        this._wireHighlight(row, alignment.groups);
        return row;
    }

    /**
     * Wire hover/click sync-highlight across the two parallel columns.
     *
     * Source and translation segment ids are independent numberings joined by the
     * n:m `groups` ([[srcIds], [txIds]] pairs). Activating a segment lights up its
     * whole group in both columns; a segment not named in any group falls back to
     * lighting the same id in the other column (the 1:1 case).
     *
     * @param {HTMLElement} row The parallel-view row containing both columns.
     * @param {Array} groups The n:m alignment groups.
     */
    _wireHighlight(row, groups) {
        const groupList = Array.isArray(groups) ? groups : [];

        const linkedFor = (col, id) => {
            const out = {src: new Set(), tx: new Set()};
            let matched = false;
            groupList.forEach((group) => {
                const srcIds = Array.isArray(group[0]) ? group[0].map(Number) : [];
                const txIds = Array.isArray(group[1]) ? group[1].map(Number) : [];
                const here = col === 'src' ? srcIds : txIds;
                if (here.includes(id)) {
                    matched = true;
                    srcIds.forEach((s) => out.src.add(s));
                    txIds.forEach((t) => out.tx.add(t));
                }
            });
            if (!matched) {
                out.src.add(id);
                out.tx.add(id);
            }
            return out;
        };

        const paint = (col, id, on) => {
            const targets = linkedFor(col, id);
            ['src', 'tx'].forEach((role) => {
                const column = row.querySelector('[data-align-col="' + role + '"]');
                if (!column) {
                    return;
                }
                targets[role].forEach((segid) => {
                    column.querySelectorAll('[data-nida-seg="' + segid + '"]').forEach((el) => {
                        el.classList.toggle('local-unifiedgrader-seg-active', on);
                    });
                });
            });
        };

        row.querySelectorAll('[data-nida-seg]').forEach((el) => {
            const col = el.closest('[data-align-col]')?.dataset.alignCol;
            const id = parseInt(el.getAttribute('data-nida-seg'), 10);
            if (!col || Number.isNaN(id)) {
                return;
            }
            el.addEventListener('mouseenter', () => paint(col, id, true));
            el.addEventListener('mouseleave', () => paint(col, id, false));
            el.addEventListener('click', () => {
                row.querySelectorAll('.local-unifiedgrader-seg-active')
                    .forEach((n) => n.classList.remove('local-unifiedgrader-seg-active'));
                paint(col, id, true);
            });
        });
    }

    /**
     * Build an advisory/notice banner node, resolving the string from
     * local_nida when available and falling back to UG's own strings.
     *
     * @param {string} key One of the FALLBACKS keys.
     * @param {string} alertClass Bootstrap alert modifier class.
     * @return {Promise<HTMLElement>}
     */
    async _banner(key, alertClass) {
        const div = document.createElement('div');
        div.className = 'alert ' + alertClass + ' py-2 px-3 small mb-2';
        div.setAttribute('role', 'status');
        div.textContent = await this._resolveString(key);
        return div;
    }

    /**
     * Resolve a banner string: try local_nida, then UG, then the hardcoded English.
     *
     * @param {string} key The string key.
     * @return {Promise<string>}
     */
    async _resolveString(key) {
        const nidaKeys = {
            advisory: 'machinetranslationadvisory',
            mixed: 'mixedlanguagenotice',
            pending: 'translationpending',
        };
        if (nidaKeys[key]) {
            try {
                return await getString(nidaKeys[key], 'local_nida');
            } catch (e) {
                // Fall through to UG string.
            }
        }
        try {
            return await getString('translation_' + key, 'local_unifiedgrader');
        } catch (e) {
            return FALLBACKS[key] || '';
        }
    }

    /**
     * Set the toggle button label to "View original" or "View translation".
     *
     * @param {boolean} showing Whether the translated view is active.
     */
    _setToggleLabel(showing) {
        const label = this.getElement(this.selectors.TOGGLE_LABEL);
        if (!label) {
            return;
        }
        const key = showing ? 'view_original' : 'view_translation';
        getString(key, 'local_unifiedgrader')
            .then((s) => { label.textContent = s; return s; })
            .catch(() => { label.textContent = showing ? 'View original' : 'View translation'; });

        const parallelLabel = this.getElement(this.selectors.PARALLEL_LABEL);
        if (parallelLabel) {
            getString('view_parallel', 'local_unifiedgrader')
                .then((s) => { parallelLabel.textContent = s; return s; })
                .catch(() => { parallelLabel.textContent = 'Side-by-side'; });
        }
    }

    /**
     * Show the translation controls bar.
     */
    _showPanel() {
        this.element.classList.remove('d-none');
    }

    /**
     * Hide the translation controls bar and restore the original view.
     */
    _hidePanel() {
        this.element.classList.add('d-none');
        const badge = this.getElement(this.selectors.LANG);
        if (badge) {
            badge.classList.add('d-none');
        }
        this._restoreOriginal();
    }

    /**
     * Hide the original PDF/document viewers, remembering which were visible.
     */
    _hideOriginalViewers() {
        if (!this._preview) {
            return;
        }
        this._hiddenRegions = [];
        ['pdf-viewer-wrapper', 'document-preview', 'text-annot-view'].forEach((region) => {
            const el = this._preview.querySelector('[data-region="' + region + '"]');
            if (el && !el.classList.contains('d-none')) {
                el.classList.add('d-none');
                this._hiddenRegions.push(region);
            }
        });
    }

    /**
     * Restore the original viewers hidden by _hideOriginalViewers().
     */
    _restoreOriginalViewers() {
        if (!this._preview || !this._hiddenRegions) {
            return;
        }
        this._hiddenRegions.forEach((region) => {
            const el = this._preview.querySelector('[data-region="' + region + '"]');
            if (el) {
                el.classList.remove('d-none');
            }
        });
        this._hiddenRegions = null;
    }

    /**
     * Enable or disable the PDF annotation toolbar.
     *
     * @param {boolean} enabled Whether the toolbar should be shown/usable.
     */
    _setAnnotationToolbar(enabled) {
        if (!this._preview) {
            return;
        }
        const toolbar = this._preview.querySelector('[data-region="annotation-toolbar"]');
        if (!toolbar) {
            return;
        }
        if (enabled) {
            // Only re-show if it was hidden by us (a PDF was loaded, so it was visible).
            if (toolbar.dataset.hiddenByTranslation === '1') {
                toolbar.classList.remove('d-none');
                delete toolbar.dataset.hiddenByTranslation;
            }
        } else if (!toolbar.classList.contains('d-none')) {
            toolbar.classList.add('d-none');
            toolbar.dataset.hiddenByTranslation = '1';
        }
    }
}
