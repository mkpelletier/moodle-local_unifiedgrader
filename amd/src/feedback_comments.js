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
 * Standalone submission comments widget for the student feedback view.
 *
 * This module manages loading, displaying, posting, and deleting submission
 * comments in the student feedback view (view_feedback.php). It uses the same
 * web services as the teacher grading interface but does not depend on the
 * Moodle reactive framework.
 *
 * @module     local_unifiedgrader/feedback_comments
 * @copyright  2026 South African Theological Seminary
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Ajax from 'core/ajax';
import Notification from 'core/notification';

/** @type {number} Current logged-in user ID. */
let currentUserId = 0;

/**
 * Initialise the feedback comments widget.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid Student user ID.
 */
export const init = (cmid, userid) => {
    const container = document.querySelector('[data-region="feedback-comments"]');
    if (!container) {
        return;
    }

    currentUserId = parseInt(M.cfg.userId, 10);

    const listEl = container.querySelector('[data-region="comments-list"]');
    const input = container.querySelector('[data-region="comment-input"]');
    const postBtn = container.querySelector('[data-action="post-comment"]');

    // Load comments on init.
    loadComments(cmid, userid, listEl, container);

    // Wire input events.
    if (input && postBtn) {
        input.addEventListener('input', () => {
            postBtn.disabled = !input.value.trim();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
                e.preventDefault();
                postComment(cmid, userid, input, postBtn, listEl, container);
            }
        });

        postBtn.addEventListener('click', () => {
            postComment(cmid, userid, input, postBtn, listEl, container);
        });
    }
};

/**
 * Load comments from the server and render them.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid Student user ID.
 * @param {HTMLElement} listEl The comments list container element.
 * @param {HTMLElement} container The card container element.
 */
async function loadComments(cmid, userid, listEl, container) {
    try {
        const result = await Ajax.call([{
            methodname: 'local_unifiedgrader_get_submission_comments',
            args: {cmid, userid},
        }])[0];

        renderComments(result.comments, listEl, cmid, userid);
        updateBadge(container, result.count);
    } catch (error) {
        Notification.exception(error);
    }
}

/**
 * Render the comments list.
 *
 * @param {Array} comments Array of comment objects.
 * @param {HTMLElement} listEl The comments list container element.
 * @param {number} cmid Course module ID.
 * @param {number} userid Student user ID.
 */
function renderComments(comments, listEl, cmid, userid) {
    if (!listEl) {
        return;
    }

    if (!comments || comments.length === 0) {
        listEl.innerHTML =
            '<div class="text-center text-muted py-4">' +
            '<i class="fa fa-comments-o d-block mb-2" style="font-size: 1.5rem;"></i>' +
            'No comments yet</div>';
        return;
    }

    listEl.innerHTML = '';
    comments.forEach((comment) => {
        listEl.appendChild(createBubble(comment, cmid, userid, listEl));
    });
    listEl.scrollTop = listEl.scrollHeight;
}

/**
 * Create a chat bubble element for a single comment.
 *
 * @param {object} comment Comment data object.
 * @param {number} cmid Course module ID.
 * @param {number} userid Student user ID.
 * @param {HTMLElement} listEl The comments list container element.
 * @return {HTMLElement} The bubble DOM element.
 */
function createBubble(comment, cmid, userid, listEl) {
    const isOwn = parseInt(comment.userid, 10) === currentUserId;

    const bubble = document.createElement('div');
    bubble.className = 'comment-bubble ' + (isOwn ? 'comment-bubble-own' : 'comment-bubble-other');

    // Meta row: name + time + delete.
    const meta = document.createElement('div');
    meta.className = 'comment-meta';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'fw-semibold';
    nameSpan.textContent = isOwn ? 'You' : comment.fullname;

    const timeSpan = document.createElement('span');
    timeSpan.textContent = comment.time;

    if (isOwn) {
        meta.appendChild(timeSpan);
        meta.appendChild(nameSpan);
    } else {
        meta.appendChild(nameSpan);
        meta.appendChild(timeSpan);
    }

    if (comment.candelete) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-link btn-sm p-0 text-danger comment-delete-btn';
        deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = '<i class="fa fa-trash-o"></i>';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteComment(cmid, userid, comment.id, listEl);
        });
        meta.appendChild(deleteBtn);
    }

    bubble.appendChild(meta);

    // Content body bubble.
    const body = document.createElement('div');
    body.className = 'comment-body';
    body.innerHTML = comment.content;
    bubble.appendChild(body);

    return bubble;
}

/**
 * Post a new comment.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid Student user ID.
 * @param {HTMLInputElement} input The text input element.
 * @param {HTMLButtonElement} postBtn The post button element.
 * @param {HTMLElement} listEl The comments list container element.
 * @param {HTMLElement} container The card container element.
 */
async function postComment(cmid, userid, input, postBtn, listEl, container) {
    const content = input.value.trim();
    if (!content) {
        return;
    }

    input.value = '';
    postBtn.disabled = true;

    try {
        await Ajax.call([{
            methodname: 'local_unifiedgrader_add_submission_comment',
            args: {cmid, userid, content},
        }])[0];

        await loadComments(cmid, userid, listEl, container);
    } catch (error) {
        Notification.exception(error);
    }
}

/**
 * Delete a comment.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid Student user ID.
 * @param {number} commentid Comment ID to delete.
 * @param {HTMLElement} listEl The comments list container element.
 */
async function deleteComment(cmid, userid, commentid, listEl) {
    try {
        await Ajax.call([{
            methodname: 'local_unifiedgrader_delete_submission_comment',
            args: {cmid, commentid},
        }])[0];

        const container = listEl.closest('[data-region="feedback-comments"]');
        await loadComments(cmid, userid, listEl, container);
    } catch (error) {
        Notification.exception(error);
    }
}

/**
 * Update the comment count badge.
 *
 * @param {HTMLElement} container The card container element.
 * @param {number} count Comment count.
 */
function updateBadge(container, count) {
    if (!container) {
        return;
    }
    let badge = container.querySelector('[data-region="comment-count-badge"]');
    if (count > 0) {
        if (!badge) {
            // Create badge if it doesn't exist (e.g. was 0 on initial render).
            const header = container.querySelector('.card-header');
            if (header) {
                badge = document.createElement('span');
                badge.className = 'badge bg-secondary';
                badge.setAttribute('data-region', 'comment-count-badge');
                header.appendChild(badge);
            }
        }
        if (badge) {
            badge.textContent = count;
        }
    } else if (badge) {
        badge.remove();
    }
}
