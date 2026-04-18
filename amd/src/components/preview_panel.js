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
 * Preview panel component - displays student submission content.
 *
 * Manages the left-panel document preview. For PDF files, delegates to the
 * PdfViewer component (PDF.js). For images and text, uses an iframe fallback.
 * Also renders a compact file selector in the right panel.
 *
 * @module     local_unifiedgrader/components/preview_panel
 * @copyright  2026 South African Theological Seminary
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {BaseComponent} from 'core/reactive';
import {getString} from 'core/str';
import PdfViewer from 'local_unifiedgrader/components/pdf_viewer';

export default class extends BaseComponent {

    /**
     * Component creation hook.
     */
    create() {
        this.name = 'preview_panel';
        this.selectors = {
            NO_SUBMISSION: '[data-region="no-submission"]',
            PDF_VIEWER_WRAPPER: '[data-region="pdf-viewer-wrapper"]',
            DOCUMENT_PREVIEW: '[data-region="document-preview"]',
            PREVIEW_IFRAME: '[data-region="preview-iframe"]',
        };
        this._container = null;
        this._currentFileId = null;
        /** @type {?PdfViewer} */
        this._pdfViewer = null;
    }

    /**
     * Register state watchers.
     *
     * @return {Array}
     */
    getWatchers() {
        return [
            {watch: 'submission:updated', handler: this._renderSubmission},
            {watch: 'ui.loading:updated', handler: this._toggleLoading},
        ];
    }

    /**
     * Called when state is first ready.
     *
     * @param {object} state Current state.
     */
    stateReady(state) {
        // Cache reference to the main container for cross-panel file selector access.
        this._container = this.element.closest('.local-unifiedgrader-container');

        // Initialize the PDF viewer component on its wrapper element.
        const pdfViewerEl = this.getElement('[data-region="pdf-viewer"]');
        if (pdfViewerEl) {
            this._pdfViewer = new PdfViewer({
                element: pdfViewerEl,
                reactive: this.reactive,
            });
        }

        if (state.submission) {
            this._renderSubmission({state});
        }
    }

    /**
     * Render submission content.
     *
     * @param {object} args Watcher args.
     * @param {object} args.state Current state.
     */
    _renderSubmission({state}) {
        const submission = state.submission;
        const noSubEl = this.getElement(this.selectors.NO_SUBMISSION);
        const pdfWrapper = this.getElement(this.selectors.PDF_VIEWER_WRAPPER);
        const docPreview = this.getElement(this.selectors.DOCUMENT_PREVIEW);

        // Save pending annotations before switching students/submissions.
        if (this._pdfViewer) {
            this._pdfViewer.saveAnnotationsNow();
        }

        // Reset visibility.
        noSubEl.classList.add('d-none');
        noSubEl.classList.remove('d-flex');
        pdfWrapper.classList.add('d-none');
        docPreview.classList.add('d-none');
        this._currentFileId = null;
        this._removePortfolioPopout();

        // Reset file selector in the right panel.
        this._renderFileSelector([]);

        if (!submission || submission.status === 'nosubmission' || submission.status === 'reopened'
                || !submission.status) {
            noSubEl.classList.remove('d-none');
            noSubEl.classList.add('d-flex');
            return;
        }

        // Handle files.
        const files = submission.files || [];
        const isForum = this.reactive.state.activity?.type === 'forum';
        // Forums always have post content; for other types, rely on the backend flag
        // that checks whether non-file submission plugins produced content.
        const hasContent = isForum
            ? (submission.status && submission.status !== 'nosubmission')
            : !!submission.hascontent;
        const hasPortfolio = !!(submission.portfoliourl);

        // Render the right-column pill selector. Includes "Portfolio" when
        // present, "Submission" when other content exists, plus each file.
        this._renderFileSelector(files, hasContent, isForum, hasPortfolio);

        // Byblos portfolio submissions take priority — render the portfolio
        // iframe as the default view. Other content remains accessible via pills.
        if (hasPortfolio) {
            this._showPortfolio(submission.portfoliourl);
            return;
        }

        if (files.length > 0) {
            // Auto-preview the first previewable file.
            const firstPreviewable = files.find(f => this._isPreviewable(f));
            if (firstPreviewable) {
                this._previewFile(firstPreviewable);
                return;
            }
            // Files exist but none are previewable — fall through to show
            // submission content (online text, audio, etc.) if available.
        }

        // Show submission content in an iframe via a proper Moodle page.
        // This ensures submission plugin CSS, JS, and AMD modules load correctly
        // (e.g. ytsubmission's YouTube player, online text, etc.).
        if (hasContent || submission.status === 'submitted') {
            this._showSubmissionContent();
            return;
        }
    }

    /**
     * Render compact file selector buttons in the right panel.
     *
     * @param {Array} files Array of file objects.
     * @param {boolean} hasContent Whether the submission has text content (e.g. forum posts).
     * @param {boolean} isForum Whether the current activity is a forum.
     * @param {boolean} hasPortfolio Whether the submission has a Byblos portfolio URL.
     */
    _renderFileSelector(files, hasContent = false, isForum = false, hasPortfolio = false) {
        if (!this._container) {
            return;
        }
        const wrapper = this._container.querySelector('[data-region="file-selector"]');
        const list = this._container.querySelector('[data-region="file-selector-list"]');
        if (!wrapper || !list) {
            return;
        }

        list.innerHTML = '';

        // Show the pill bar whenever a portfolio is present (so it has a pill),
        // there is other content, or there are files to choose between.
        if (files.length === 0 && !hasPortfolio) {
            wrapper.classList.add('d-none');
            return;
        }

        wrapper.classList.remove('d-none');

        // Portfolio pill — primary view when a Byblos portfolio is submitted.
        if (hasPortfolio) {
            const pill = document.createElement('span');
            pill.className = 'btn-group btn-group-sm';
            pill.dataset.fileid = 'portfolio';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-sm btn-outline-secondary d-flex align-items-center gap-1';
            const icon = document.createElement('i');
            icon.className = 'fa fa-book';
            icon.setAttribute('aria-hidden', 'true');
            btn.appendChild(icon);
            const label = document.createElement('span');
            label.className = 'small';
            label.textContent = 'Portfolio';
            getString('portfolio_pill', 'local_unifiedgrader')
                .then((str) => { label.textContent = str; })
                .catch(() => {});
            btn.appendChild(label);
            btn.addEventListener('click', () => {
                if (this._pdfViewer) {
                    this._pdfViewer.saveAnnotationsNow();
                }
                const url = this.reactive.state.submission?.portfoliourl;
                if (url) {
                    this._showPortfolio(url);
                    this._currentFileId = null;
                    this._highlightFileButton('portfolio');
                }
            });

            pill.appendChild(btn);
            list.appendChild(pill);
        }

        // Add a content pill when there is both content and file attachments,
        // so the teacher can switch between viewing content and previewing files.
        if (hasContent && files.length > 0) {
            const contentPill = document.createElement('span');
            contentPill.className = 'btn-group btn-group-sm';
            contentPill.dataset.fileid = 'content';

            const contentBtn = document.createElement('button');
            contentBtn.type = 'button';
            contentBtn.className = 'btn btn-sm btn-outline-secondary d-flex align-items-center gap-1';
            const contentIcon = document.createElement('i');
            contentIcon.className = isForum ? 'fa fa-comments' : 'fa fa-desktop';
            contentIcon.setAttribute('aria-hidden', 'true');
            contentBtn.appendChild(contentIcon);
            const contentLabel = document.createElement('span');
            contentLabel.className = 'small';
            const stringKey = isForum ? 'forum_posts_pill' : 'submission_content_pill';
            contentLabel.textContent = isForum ? 'Posts' : 'Submission';
            getString(stringKey, 'local_unifiedgrader')
                .then((str) => { contentLabel.textContent = str; })
                .catch(() => {});
            contentBtn.appendChild(contentLabel);
            contentBtn.addEventListener('click', () => {
                // Save annotations before switching to content view.
                if (this._pdfViewer) {
                    this._pdfViewer.saveAnnotationsNow();
                }
                this._showSubmissionContent();
                this._currentFileId = null;
                this._highlightFileButton('content');
            });

            contentPill.appendChild(contentBtn);
            list.appendChild(contentPill);
        }

        files.forEach((file) => {
            const pill = document.createElement('span');
            pill.className = 'btn-group btn-group-sm';
            pill.dataset.fileid = file.fileid;

            // Preview button (filename).
            const previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className = 'btn btn-sm btn-outline-secondary d-flex align-items-center';
            const name = document.createElement('span');
            name.className = 'small text-truncate';
            name.style.maxWidth = '180px';
            name.textContent = file.filename;
            previewBtn.appendChild(name);
            previewBtn.addEventListener('click', () => {
                if (this._isPreviewable(file)) {
                    this._previewFile(file);
                } else {
                    window.open(file.url, '_blank');
                }
            });

            // Download button (icon).
            const dlLink = document.createElement('a');
            dlLink.href = file.url;
            dlLink.download = file.filename;
            dlLink.className = 'btn btn-sm btn-outline-secondary d-flex align-items-center';
            getString('download_original_submission', 'local_unifiedgrader', file.filename)
                .then((str) => { dlLink.title = str; })
                .catch(() => { dlLink.title = file.filename; });
            const dlIcon = document.createElement('i');
            dlIcon.className = 'fa fa-download';
            dlIcon.setAttribute('aria-hidden', 'true');
            dlLink.appendChild(dlIcon);

            pill.appendChild(previewBtn);
            pill.appendChild(dlLink);
            list.appendChild(pill);
        });
    }

    /**
     * Preview a file in the left panel.
     *
     * Routes PDF files to the PdfViewer component and other files to the iframe.
     *
     * @param {object} file File info object.
     */
    _previewFile(file) {
        const pdfWrapper = this.getElement(this.selectors.PDF_VIEWER_WRAPPER);
        const docPreview = this.getElement(this.selectors.DOCUMENT_PREVIEW);

        // Hide both viewers first.
        pdfWrapper.classList.add('d-none');
        docPreview.classList.add('d-none');

        // Remove the portfolio pop-out button when switching to a file preview.
        this._removePortfolioPopout();

        if ((file.mimetype === 'application/pdf' || file.convertible) && this._pdfViewer) {
            // Use PDF.js viewer for PDF files (and files converted to PDF).
            pdfWrapper.classList.remove('d-none');
            // Pass file context for annotation persistence.
            const state = this.reactive.state;
            this._pdfViewer.setFileContext(
                parseInt(state.activity.cmid, 10),
                parseInt(state.currentUser.id, 10),
                parseInt(file.fileid, 10),
            );
            this._pdfViewer.setFileInfo(file);
            this._pdfViewer.loadPdf(file.previewurl || file.url);
        } else if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
            // Use styled media player page for audio/video.
            const iframe = this.getElement(this.selectors.PREVIEW_IFRAME);
            const cmid = this.reactive.state.activity?.cmid;
            iframe.src = `${M.cfg.wwwroot}/local/unifiedgrader/preview_media.php`
                + `?fileid=${file.fileid}&cmid=${cmid}`;
            docPreview.classList.remove('d-none');
        } else {
            // Use iframe for images, text, etc.
            const iframe = this.getElement(this.selectors.PREVIEW_IFRAME);
            iframe.src = file.previewurl || file.url;
            docPreview.classList.remove('d-none');
        }

        this._currentFileId = file.fileid;

        // Highlight the active file button in the right-panel selector.
        this._highlightFileButton(file.fileid);
    }

    /**
     * Show submission content (e.g. forum posts) in the iframe preview.
     */
    _showSubmissionContent() {
        const pdfWrapper = this.getElement(this.selectors.PDF_VIEWER_WRAPPER);
        const docPreview = this.getElement(this.selectors.DOCUMENT_PREVIEW);
        pdfWrapper.classList.add('d-none');
        docPreview.classList.add('d-none');

        // Remove the portfolio pop-out button if it was added previously.
        this._removePortfolioPopout();

        const iframe = this.getElement(this.selectors.PREVIEW_IFRAME);
        const cmid = this.reactive.state.activity?.cmid;
        const userid = this.reactive.state.submission?.userid;
        if (cmid && userid) {
            let url = `${M.cfg.wwwroot}/local/unifiedgrader/preview_submission.php`
                + `?cmid=${cmid}&userid=${userid}`;
            // Include attempt number for quiz multi-attempt support.
            const attemptnumber = this.reactive.state.submission?.attemptnumber;
            if (attemptnumber !== undefined && attemptnumber !== null && attemptnumber >= 0) {
                url += `&attempt=${attemptnumber}`;
            }
            iframe.src = url;
            docPreview.classList.remove('d-none');
        }
    }

    /**
     * Render a Byblos portfolio in the iframe preview, with a pop-out button
     * that lets the teacher open the portfolio in a new tab.
     *
     * @param {string} url The portfolio URL (with embedded=1 for chrome-free render).
     */
    _showPortfolio(url) {
        const pdfWrapper = this.getElement(this.selectors.PDF_VIEWER_WRAPPER);
        const docPreview = this.getElement(this.selectors.DOCUMENT_PREVIEW);
        pdfWrapper.classList.add('d-none');

        const iframe = this.getElement(this.selectors.PREVIEW_IFRAME);
        iframe.src = url;
        docPreview.classList.remove('d-none');

        // Add (or refresh) the pop-out button overlaid on the iframe area.
        this._addPortfolioPopout(url);
    }

    /**
     * Add a pop-out button to open the portfolio in a new tab.
     * The button is overlaid in the top-right of the preview area.
     *
     * @param {string} url The portfolio URL.
     */
    _addPortfolioPopout(url) {
        this._removePortfolioPopout();

        const docPreview = this.getElement(this.selectors.DOCUMENT_PREVIEW);
        if (!docPreview) {
            return;
        }

        const popoutUrl = url.replace(/([?&])embedded=1(&|$)/, (m, p1, p2) => (p2 ? p1 : '')) || url;

        const btn = document.createElement('a');
        btn.dataset.region = 'portfolio-popout';
        btn.href = popoutUrl;
        btn.target = '_blank';
        btn.rel = 'noopener noreferrer';
        btn.className = 'btn btn-sm btn-light border shadow-sm position-absolute';
        btn.style.top = '8px';
        btn.style.right = '16px';
        btn.style.zIndex = '10';

        const icon = document.createElement('i');
        icon.className = 'fa fa-external-link-alt';
        icon.setAttribute('aria-hidden', 'true');
        btn.appendChild(icon);

        getString('portfolio_popout', 'local_unifiedgrader').then((s) => {
            btn.setAttribute('title', s);
            btn.setAttribute('aria-label', s);
            return s;
        }).catch(() => {
            btn.setAttribute('title', 'Open portfolio in new tab');
        });

        // Ensure the preview wrapper is positioned so absolute children anchor correctly.
        if (getComputedStyle(docPreview).position === 'static') {
            docPreview.style.position = 'relative';
        }
        docPreview.appendChild(btn);
    }

    /**
     * Remove the portfolio pop-out button if present.
     */
    _removePortfolioPopout() {
        const docPreview = this.getElement(this.selectors.DOCUMENT_PREVIEW);
        if (!docPreview) {
            return;
        }
        const existing = docPreview.querySelector('[data-region="portfolio-popout"]');
        if (existing) {
            existing.remove();
        }
    }

    /**
     * Highlight the active file button in the file selector.
     *
     * @param {number|string} fileid The file ID to highlight.
     */
    _highlightFileButton(fileid) {
        if (!this._container) {
            return;
        }
        const list = this._container.querySelector('[data-region="file-selector-list"]');
        if (!list) {
            return;
        }
        list.querySelectorAll('[data-fileid]').forEach((pill) => {
            const isActive = pill.dataset.fileid === String(fileid);
            pill.querySelectorAll('button, a').forEach((el) => {
                el.classList.toggle('btn-outline-secondary', !isActive);
                el.classList.toggle('btn-primary', isActive);
            });
        });
    }

    /**
     * Check if a file can be previewed inline.
     *
     * @param {object} file File info object with mimetype and convertible properties.
     * @return {boolean}
     */
    _isPreviewable(file) {
        if (file.convertible) {
            return true;
        }
        const mimetype = file.mimetype || '';
        if ([
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'text/plain',
        ].includes(mimetype)) {
            return true;
        }
        // Audio and video types are previewable via HTML5 media elements.
        return mimetype.startsWith('audio/') || mimetype.startsWith('video/');
    }

    /**
     * Toggle loading state.
     *
     * @param {object} args Watcher args.
     * @param {object} args.state Current state.
     */
    _toggleLoading({state}) {
        this.element.style.opacity = state.ui.loading ? '0.5' : '1';
        this.element.style.pointerEvents = state.ui.loading ? 'none' : '';
    }
}
